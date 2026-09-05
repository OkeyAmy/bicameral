// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskGate} from "../src/RiskGate.sol";
import {AgentToolLib} from "../src/AgentToolLib.sol";

/// @notice The gate is the security story: a language model proposes, and this
///         pure Solidity decides. So these tests feed it ADVERSARIAL model output
///         and assert refusal. A gate that has never been shown rejecting is a
///         gate nobody should trust — and "X of N model outputs rejected" only
///         means something in RESULTS.md if the rejection paths are tested.
///
///         Expected values below are derived from the interface spec
///         (1e6 probability prices, lot/tick grids from getOrderBookParameters),
///         not from whatever the implementation happens to return.
contract RiskGateTest is Test {
    uint256 constant ONE = 1_000_000; // one contract, 6-decimal collateral

    function _params() internal pure returns (RiskGate.Params memory p) {
        p = RiskGate.Params({
            minPrice: 20_000, // 0.02
            maxPrice: 980_000, // 0.98
            maxSize: 5 * ONE, // 5 contracts
            minHeadroom: 180, // 3 minutes, sized for a 1h cadence
            maxConcurrent: 3,
            maxNotional: 50 * ONE
        });
    }

    function _snap() internal view returns (RiskGate.Snapshot memory s) {
        s = RiskGate.Snapshot({
            bestBid: 539_000, // 0.539 — measured from the live BTC 1h book
            bestAsk: 551_000, // 0.551
            tickSize: 1_000,
            lotSize: 1_000,
            minQuantity: 1_000,
            expirySec: uint64(block.timestamp + 3600),
            nowSec: uint64(block.timestamp),
            finalized: false,
            openPositions: 0,
            openNotional: 0,
            collateralAvailable: 100 * ONE
        });
    }

    // ------------------------------------------------------------ happy paths

    function test_BuyUp_liftsTheAsk() public view {
        (uint8 reason, RiskGate.Order memory o) =
            RiskGate.evaluate(_params(), _snap(), AgentToolLib.Verdict.BuyUp);

        assertEq(reason, RiskGate.OK, "should pass");
        assertEq(o.kind, AgentToolLib.BUY_YES, "BUY_UP must encode as kind 0");
        assertEq(o.price, 551_000, "must cross at the best ask");
        assertEq(o.quantity, 5 * ONE, "size is maxSize snapped to the lot grid");
    }

    function test_BuyDown_mirrorsTheBid() public view {
        (uint8 reason, RiskGate.Order memory o) =
            RiskGate.evaluate(_params(), _snap(), AgentToolLib.Verdict.BuyDown);

        assertEq(reason, RiskGate.OK, "should pass");
        assertEq(o.kind, AgentToolLib.BUY_NO, "BUY_DOWN must encode as kind 2");
        assertEq(o.price, 539_000, "DOWN is quoted in UP terms on the shared book");
    }

    // --------------------------------------------------- adversarial refusals

    function test_Abstain_isRefusedNotTraded() public view {
        (uint8 reason,) = RiskGate.evaluate(_params(), _snap(), AgentToolLib.Verdict.Abstain);
        assertEq(reason, RiskGate.R_ABSTAINED);
    }

    function test_FinalizedMarket_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.finalized = true;
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_FINALIZED);
    }

    function test_ExpiryInsideHeadroom_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.expirySec = s.nowSec + 179; // one second inside a 180s floor
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_NO_HEADROOM);
    }

    function test_ExpiryInThePast_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.expirySec = s.nowSec;
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_NO_HEADROOM);
    }

    function test_EmptyBook_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.bestAsk = 0;
        (uint8 up,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(up, RiskGate.R_NO_BOOK, "cannot lift an ask that isn't there");

        s = _snap();
        s.bestBid = 0;
        (uint8 down,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyDown);
        assertEq(down, RiskGate.R_NO_BOOK);
    }

    function test_PriceAboveBand_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.bestAsk = 990_000; // 0.99, outside a 0.98 ceiling
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_PRICE_BAND, "0.99 must not be tradable");
    }

    function test_PriceBelowBand_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.bestBid = 10_000; // 0.01, below a 0.02 floor
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyDown);
        assertEq(reason, RiskGate.R_PRICE_BAND);
    }

    function test_SizeSnappingToZero_isRefused() public view {
        RiskGate.Params memory p = _params();
        RiskGate.Snapshot memory s = _snap();
        p.maxSize = 999; // sub-lot: the venue floors this to zero
        s.lotSize = 1_000;
        (uint8 reason,) = RiskGate.evaluate(p, s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_SIZE_ZERO, "sub-lot sizes must never be sent");
    }

    function test_SizeBelowVenueMinimum_isRefused() public view {
        RiskGate.Params memory p = _params();
        RiskGate.Snapshot memory s = _snap();
        p.maxSize = 1_000;
        s.lotSize = 1_000;
        s.minQuantity = 5_000;
        (uint8 reason,) = RiskGate.evaluate(p, s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_BELOW_MIN_QTY);
    }

    function test_MaxConcurrentPositions_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        s.openPositions = 3; // == maxConcurrent
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_MAX_CONCURRENT);
    }

    function test_InsufficientCollateral_isRefused() public view {
        RiskGate.Snapshot memory s = _snap();
        // 5 contracts at 0.551 costs 2_755_000 base units.
        s.collateralAvailable = 2_754_999;
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_INSUFFICIENT_COLLATERAL);
    }

    function test_MaxNotional_isRefused() public view {
        RiskGate.Params memory p = _params();
        RiskGate.Snapshot memory s = _snap();
        p.maxNotional = 5 * ONE;
        s.openNotional = 3 * ONE; // 3 + 2.755 > 5
        (uint8 reason,) = RiskGate.evaluate(p, s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.R_MAX_NOTIONAL);
    }

    /// @notice The exact cost boundary, because off-by-one here silently
    ///         underfunds an order and the venue does not revert to tell you.
    function test_ExactCollateralBoundary_passes() public view {
        RiskGate.Snapshot memory s = _snap();
        s.collateralAvailable = 2_755_000; // 5 * 551000 / 1e6
        (uint8 reason,) = RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.OK, "exactly enough must be enough");
    }

    // ------------------------------------------------------ price snapping

    function test_OffGridPriceIsSnappedDown() public view {
        RiskGate.Snapshot memory s = _snap();
        s.bestAsk = 551_777; // not on a 1000 tick
        (uint8 reason, RiskGate.Order memory o) =
            RiskGate.evaluate(_params(), s, AgentToolLib.Verdict.BuyUp);
        assertEq(reason, RiskGate.OK);
        assertEq(o.price, 551_000, "off-grid prices must snap to the tick grid");
    }

    // ----------------------------------------------- params cannot be toothless

    /// @dev External wrapper: library calls are inlined, so expectRevert needs a
    ///      real call frame to observe.
    function validate(RiskGate.Params memory p) external pure {
        RiskGate.validate(p);
    }

    function test_Validate_rejectsInvertedBand() public {
        RiskGate.Params memory p = _params();
        p.minPrice = 900_000;
        p.maxPrice = 100_000;
        vm.expectRevert(bytes("bad price band"));
        this.validate(p);
    }

    function test_Validate_rejectsCertaintyCeiling() public {
        RiskGate.Params memory p = _params();
        p.maxPrice = 1_000_000; // 1.0 is not a tradable probability
        vm.expectRevert(bytes("maxPrice >= 1.0"));
        this.validate(p);
    }

    function test_Validate_rejectsHeadroomFloorBypass() public {
        RiskGate.Params memory p = _params();
        p.minHeadroom = 119; // nobody may deploy under the floor
        vm.expectRevert(bytes("headroom < 120s"));
        this.validate(p);
    }

    function test_Validate_rejectsZeroSize() public {
        RiskGate.Params memory p = _params();
        p.maxSize = 0;
        vm.expectRevert(bytes("maxSize 0"));
        this.validate(p);
    }

    function test_Validate_rejectsNotionalBelowSize() public {
        RiskGate.Params memory p = _params();
        p.maxNotional = p.maxSize - 1;
        vm.expectRevert(bytes("maxNotional < maxSize"));
        this.validate(p);
    }

    function test_Validate_acceptsSaneParams() public view {
        this.validate(_params());
    }

    // ---------------------------------------------------------------- fuzz

    /// @notice Whatever the book says, an accepted order is always inside the
    ///         band and on the grid. This is the invariant the whole design
    ///         rests on: the model picks a direction, never a number.
    function testFuzz_AcceptedOrdersAlwaysRespectBounds(uint256 bid, uint256 ask) public view {
        bid = bound(bid, 1, 999_999);
        ask = bound(ask, 1, 999_999);
        RiskGate.Params memory p = _params();
        RiskGate.Snapshot memory s = _snap();
        s.bestBid = bid;
        s.bestAsk = ask;

        (uint8 r1, RiskGate.Order memory o1) = RiskGate.evaluate(p, s, AgentToolLib.Verdict.BuyUp);
        if (r1 == RiskGate.OK) {
            assertGe(o1.price, p.minPrice);
            assertLe(o1.price, p.maxPrice);
            assertEq(o1.price % s.tickSize, 0, "price must sit on the tick grid");
            assertEq(o1.quantity % s.lotSize, 0, "size must sit on the lot grid");
        }

        (uint8 r2, RiskGate.Order memory o2) = RiskGate.evaluate(p, s, AgentToolLib.Verdict.BuyDown);
        if (r2 == RiskGate.OK) {
            assertGe(o2.price, p.minPrice);
            assertLe(o2.price, p.maxPrice);
            assertEq(o2.price % s.tickSize, 0);
        }
    }
}
