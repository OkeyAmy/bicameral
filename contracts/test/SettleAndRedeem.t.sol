// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {BicameralTrader} from "../src/BicameralTrader.sol";
import {RiskGate} from "../src/RiskGate.sol";
import {MarketRef} from "../src/IMarketRegistry.sol";
import {
    MockCollateral,
    MockOutcomeToken,
    MockMarket,
    MockPool,
    MockMarketsModule,
    MockRegistry
} from "./mocks/MockVenue.sol";

/// @notice This is the exact bug that shipped: the first live decision lost
///         (the agent held only the settled-losing side), and `settleAndRedeem`
///         reverted with `NothingToRedeem` instead of closing the position —
///         because the loop skipped the losing outcome's BALANCE CHECK, not
///         just its redeem call, so the revert fired before `hasPosition` was
///         ever cleared. `openPositions`/`openNotionalOf` were stuck forever.
///
///         Confirmed against the live deployed agent (0x603b92c5…) on Shannon
///         testnet: `hasPosition` read `true` and `openNotionalOf` read
///         `4400000` hours after the market settled, with no way to clear
///         either. These tests are that production incident, reproduced.
contract SettleAndRedeemTest is Test {
    using stdStorage for StdStorage;

    BicameralTrader agent;
    MockCollateral collateral;
    MockOutcomeToken outcome;
    MockMarket market;
    MockPool pool;
    MockMarketsModule marketsModule;
    MockRegistry registry;

    bytes32 constant MARKET_ID = bytes32(uint256(1));
    uint256 constant YES_ID = 1;
    uint256 constant NO_ID = 2;
    uint256 constant FIVE_CONTRACTS = 5_000_000;

    function setUp() public {
        collateral = new MockCollateral();
        outcome = new MockOutcomeToken();
        market = new MockMarket();
        pool = new MockPool(address(collateral), address(market), address(outcome), YES_ID, NO_ID);
        marketsModule = new MockMarketsModule(outcome, collateral);
        registry = new MockRegistry();

        registry.set(
            MARKET_ID,
            MarketRef({
                pool: address(pool),
                marketsModule: address(marketsModule),
                operatorId: 1,
                venueId: bytes32(uint256(1)),
                asset: keccak256("ETH"),
                intervalSec: 3600,
                expiry: uint64(block.timestamp)
            })
        );

        agent = new BicameralTrader();
        agent.initialize(
            address(this),
            "test-agent",
            "test strategy",
            RiskGate.Params({
                minPrice: 20_000,
                maxPrice: 980_000,
                maxSize: FIVE_CONTRACTS,
                minHeadroom: 180,
                maxConcurrent: 3,
                maxNotional: 50_000_000
            }),
            address(0xdead), // platform — unused by settleAndRedeem
            address(registry),
            address(collateral),
            0,
            0,
            3,
            2,
            60,
            900
        );

        // Simulate the state left behind by a real fill: the agent holds
        // outcome tokens and the position bookkeeping this test is checking.
        _openPosition();
    }

    /// @dev Mirrors what `_placeOrder` leaves behind, without re-running the
    ///      whole inference→gate→order path — that path is covered elsewhere.
    ///      Storage slots are located by `stdstore` (forge-std probes the real
    ///      layout via the getter), never guessed by index.
    function _openPosition() private {
        outcome.mint(address(agent), NO_ID, FIVE_CONTRACTS);

        stdstore.target(address(agent)).sig("hasPosition(bytes32)").with_key(MARKET_ID).checked_write(
            true
        );
        stdstore.target(address(agent)).sig("openPositions()").checked_write(1);
        stdstore.target(address(agent)).sig("openNotionalOf(bytes32)").with_key(MARKET_ID)
            .checked_write(4_400_000);
    }

    // --------------------------------------------------------------- losses

    /// @notice THE bug. Agent bought DOWN, market resolves UP: the agent holds
    ///         only the losing side. This must CLOSE the position, not revert.
    function test_TotalLoss_ClosesThePosition() public {
        market.resolve(true); // UP wins; agent holds DOWN (NO_ID) only

        assertTrue(agent.hasPosition(MARKET_ID), "precondition: position is open");

        agent.settleAndRedeem(MARKET_ID);

        assertFalse(agent.hasPosition(MARKET_ID), "position must close on a total loss");
        assertEq(agent.openPositions(), 0, "openPositions must decrement");
        assertEq(agent.openNotionalOf(MARKET_ID), 0, "notional must clear");
        assertEq(marketsModule.callCount(), 0, "a worthless token must not be redeemed");
    }

    /// @notice The regression check: this exact sequence reverted in production.
    function test_TotalLoss_DoesNotRevert() public {
        market.resolve(true);
        agent.settleAndRedeem(MARKET_ID); // must not revert
    }

    // ----------------------------------------------------------------- wins

    function test_Win_RedeemsAndClosesPosition() public {
        market.resolve(false); // DOWN wins; agent holds DOWN (NO_ID)

        agent.settleAndRedeem(MARKET_ID);

        assertFalse(agent.hasPosition(MARKET_ID));
        assertEq(agent.openPositions(), 0);
        assertEq(collateral.balanceOf(address(agent)), FIVE_CONTRACTS, "winnings must be redeemed");
        assertEq(marketsModule.callCount(), 1);
    }

    // --------------------------------------------------------------- voided

    function test_Voided_RedeemsBothSidesAtHalf() public {
        outcome.mint(address(agent), YES_ID, FIVE_CONTRACTS); // agent also holds some UP
        market.voidMarket();

        agent.settleAndRedeem(MARKET_ID);

        assertFalse(agent.hasPosition(MARKET_ID));
        assertEq(marketsModule.callCount(), 2, "both sides must be redeemed when voided");
    }

    // ------------------------------------------------------------ no-op case

    /// @notice Calling this on a market the agent never touched must still
    ///         fail — permissionless does not mean "always succeeds".
    function test_NoPositionAndNothingRedeemed_Reverts() public {
        bytes32 untouchedMarket = bytes32(uint256(2));
        registry.set(
            untouchedMarket,
            MarketRef({
                pool: address(pool),
                marketsModule: address(marketsModule),
                operatorId: 1,
                venueId: bytes32(uint256(1)),
                asset: keccak256("ETH"),
                intervalSec: 3600,
                expiry: uint64(block.timestamp)
            })
        );
        market.resolve(true);

        vm.expectRevert(BicameralTrader.NothingToRedeem.selector);
        agent.settleAndRedeem(untouchedMarket);
    }

    function test_UnknownMarket_Reverts() public {
        vm.expectRevert(BicameralTrader.UnknownMarket.selector);
        agent.settleAndRedeem(bytes32(uint256(999)));
    }
}
