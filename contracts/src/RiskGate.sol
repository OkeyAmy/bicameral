// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentToolLib} from "./AgentToolLib.sol";

/// @title RiskGate — the deterministic half
/// @notice Every model output passes through here before any order is placed.
///         This is pure Solidity with no model input to its own bounds: nothing
///         a language model can say changes what this allows. The prompt is the
///         user's; the limits are the contract's.
///
///         Rejections are a first-class outcome, not an error. The agent emits
///         them, the public feed renders them, and `RESULTS.md` counts them —
///         a gate that never rejects is a gate nobody can trust.
library RiskGate {
    /// @notice Immutable after the agent is initialized. If an owner could edit
    ///         these mid-run the published track record would mean nothing.
    struct Params {
        uint256 minPrice; // 1e6 probability floor, e.g. 20000 = 0.02
        uint256 maxPrice; // 1e6 probability ceiling, e.g. 980000 = 0.98
        uint256 maxSize; // collateral base units per order
        uint32 minHeadroom; // seconds before expiry the agent refuses to act
        uint8 maxConcurrent; // live positions across all markets
        uint256 maxNotional; // collateral base units at risk across all markets
    }

    /// @notice Everything read from the chain at decision time. Never from a log,
    ///         never from an indexer row: the pool is the only authority.
    struct Snapshot {
        uint256 bestBid; // 0 if no bid
        uint256 bestAsk; // 0 if no ask
        uint256 tickSize;
        uint256 lotSize;
        uint256 minQuantity;
        uint64 expirySec; // derived from marketExpiryNs()
        uint64 nowSec;
        bool finalized;
        uint8 openPositions;
        uint256 openNotional;
        uint256 collateralAvailable;
    }

    /// @dev Reason codes are stable and rendered verbatim in the UI. Append only.
    uint8 internal constant OK = 0;
    uint8 internal constant R_ABSTAINED = 1;
    uint8 internal constant R_FINALIZED = 2;
    uint8 internal constant R_NO_HEADROOM = 3;
    uint8 internal constant R_NO_BOOK = 4;
    uint8 internal constant R_PRICE_BAND = 5;
    uint8 internal constant R_SIZE_ZERO = 6;
    uint8 internal constant R_BELOW_MIN_QTY = 7;
    uint8 internal constant R_MAX_CONCURRENT = 8;
    uint8 internal constant R_MAX_NOTIONAL = 9;
    uint8 internal constant R_INSUFFICIENT_COLLATERAL = 10;

    function reasonLabel(uint8 code) internal pure returns (string memory) {
        if (code == OK) return "PASS";
        if (code == R_ABSTAINED) return "model abstained";
        if (code == R_FINALIZED) return "market finalized";
        if (code == R_NO_HEADROOM) return "expiry headroom too short";
        if (code == R_NO_BOOK) return "no resting liquidity on the side needed";
        if (code == R_PRICE_BAND) return "price outside allowed band";
        if (code == R_SIZE_ZERO) return "size snapped to zero on the lot grid";
        if (code == R_BELOW_MIN_QTY) return "size below venue minimum";
        if (code == R_MAX_CONCURRENT) return "max concurrent positions reached";
        if (code == R_MAX_NOTIONAL) return "max notional at risk reached";
        if (code == R_INSUFFICIENT_COLLATERAL) return "insufficient collateral";
        return "unknown";
    }

    struct Order {
        uint8 kind;
        uint256 price;
        uint256 quantity;
    }

    /// @notice Turn a model verdict into an order, or refuse.
    /// @dev The model chooses direction only. Price and size are computed here
    ///      from the live book and the immutable params — the model never names
    ///      a number, so it cannot name a bad one.
    function evaluate(Params memory p, Snapshot memory s, AgentToolLib.Verdict v)
        internal
        pure
        returns (uint8 reason, Order memory order)
    {
        if (v == AgentToolLib.Verdict.Abstain) return (R_ABSTAINED, order);
        if (s.finalized) return (R_FINALIZED, order);

        // Headroom is checked against the pool's own expiry, never a cached row.
        if (s.expirySec <= s.nowSec || s.expirySec - s.nowSec < p.minHeadroom) {
            return (R_NO_HEADROOM, order);
        }

        if (s.openPositions >= p.maxConcurrent) return (R_MAX_CONCURRENT, order);

        // We take liquidity, so we need the opposite side to exist. Buying UP
        // lifts the ask; buying DOWN is the mirror of the bid (down = 1 - up).
        uint256 price;
        if (v == AgentToolLib.Verdict.BuyUp) {
            if (s.bestAsk == 0) return (R_NO_BOOK, order);
            order.kind = AgentToolLib.BUY_YES;
            price = s.bestAsk;
        } else {
            if (s.bestBid == 0) return (R_NO_BOOK, order);
            order.kind = AgentToolLib.BUY_NO;
            // A BUY_NO is quoted in UP terms on the shared book: crossing the
            // best bid means paying (1 - bestBid) for the DOWN side.
            price = s.bestBid;
        }

        price = AgentToolLib.snapPrice(price, s.tickSize);
        if (price < p.minPrice || price > p.maxPrice) return (R_PRICE_BAND, order);
        order.price = price;

        uint256 qty = AgentToolLib.snapSize(p.maxSize, s.lotSize);
        if (qty == 0) return (R_SIZE_ZERO, order);
        if (qty < s.minQuantity) return (R_BELOW_MIN_QTY, order);

        // Worst-case cost of a buy is quantity * price, in collateral units.
        uint256 cost = (qty * price) / AgentToolLib.PRICE_SCALE;
        if (cost > s.collateralAvailable) return (R_INSUFFICIENT_COLLATERAL, order);
        if (s.openNotional + cost > p.maxNotional) return (R_MAX_NOTIONAL, order);

        order.quantity = qty;
        return (OK, order);
    }

    /// @notice Sanity bounds enforced at initialization so no agent can be
    ///         deployed with limits that are not limits.
    function validate(Params memory p) internal pure {
        require(p.minPrice > 0 && p.minPrice < p.maxPrice, "bad price band");
        require(p.maxPrice < AgentToolLib.PRICE_SCALE, "maxPrice >= 1.0");
        require(p.maxSize > 0, "maxSize 0");
        require(p.minHeadroom >= 120, "headroom < 120s");
        require(p.maxConcurrent > 0 && p.maxConcurrent <= 16, "bad maxConcurrent");
        require(p.maxNotional >= p.maxSize, "maxNotional < maxSize");
    }
}
