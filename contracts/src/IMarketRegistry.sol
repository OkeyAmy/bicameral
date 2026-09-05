// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Everything an agent needs to trade and later redeem one window.
/// @dev `marketId`, `operatorId` and `venueId` are published only in the venue's
///      `MarketCreated` log — `getBinaryPoolParams()` does not carry them — so
///      they must be captured at discovery time or redemption is impossible.
///      `asset` and `intervalSec` come from the same log as typed fields; the
///      question text is documented as unstable and is never parsed.
struct MarketRef {
    address pool;
    address marketsModule;
    uint32 operatorId;
    bytes32 venueId;
    bytes32 asset; // keccak of the venue's own asset string, whatever it is
    uint32 intervalSec; // cadence: the venue runs several
    uint64 expiry;
}

/// @notice The venue's own registry. `markets(marketId)` is the authoritative
///         on-chain record of a market — including `originOperatorId` and
///         `originVenueId`, which redemption needs and which the `MarketCreated`
///         log does NOT carry.
/// @dev Because this exists, market registration in the factory can be
///      permissionless: we do not trust the caller's pool address, we look it up
///      here and reject anything that disagrees.
interface IBinaryModule {
    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256 oracleQuestionId,
            uint8 outcomeSlotCount,
            uint8 voidPolicy,
            address collateral,
            uint32 originOperatorId,
            bytes32 originVenueId,
            address oracleAdapter,
            address creator,
            address market,
            address pool,
            uint256 yesId,
            uint256 noId,
            uint64 tradingStart,
            uint64 expiry
        );
}

interface IMarketRegistry {
    function marketRef(bytes32 marketId) external view returns (MarketRef memory);
    function isRegistered(bytes32 marketId) external view returns (bool);
    function registeredCount() external view returns (uint256);
    function registeredAt(uint256 index) external view returns (bytes32);
}
