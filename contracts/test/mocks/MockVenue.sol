// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IBinaryPool,
    IBinaryMarket,
    IBinaryMarketsModule,
    IOutcomeToken6909,
    IERC20Like,
    BinaryPoolParams,
    OrderBookParams,
    OrderBookLevel
} from "../../src/IEventContracts.sol";
import {IMarketRegistry, MarketRef} from "../../src/IMarketRegistry.sol";

/// @notice The smallest possible stand-ins for the DreamDEX contracts, sized
///         only for what `settleAndRedeem` touches. Not a general-purpose venue
///         mock — the point is testing OUR settlement logic, not re-implementing
///         theirs.
contract MockCollateral is IERC20Like {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockOutcomeToken is IOutcomeToken6909 {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isOperator;

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[to][id] += amount;
    }

    function burn(address from, uint256 id, uint256 amount) external {
        balanceOf[from][id] -= amount;
    }

    function setOperator(address spender, bool approved) external returns (bool) {
        isOperator[msg.sender][spender] = approved;
        return true;
    }
}

contract MockMarket is IBinaryMarket {
    bool public isResolved;
    bool public isVoided;
    uint256[] private _payouts;

    /// @param upWins true = UP resolves, false = DOWN resolves.
    function resolve(bool upWins) external {
        isResolved = true;
        _payouts = new uint256[](2);
        _payouts[upWins ? 0 : 1] = 1e7;
    }

    function voidMarket() external {
        isVoided = true;
        _payouts = new uint256[](2);
        _payouts[0] = 5e6;
        _payouts[1] = 5e6;
    }

    function payoutNumerators() external view returns (uint256[] memory) {
        return _payouts;
    }
}

/// @notice Just enough of `IBinaryPool` for `getBinaryPoolParams()`. Every other
///         `IBinaryPool` method reverts — `settleAndRedeem` never calls them.
contract MockPool is IBinaryPool {
    BinaryPoolParams private _params;

    constructor(address collateralToken, address market, address outcomeToken, uint256 yesId, uint256 noId) {
        _params = BinaryPoolParams({
            collateralToken: collateralToken,
            market: market,
            outcomeToken: outcomeToken,
            yesId: yesId,
            noId: noId,
            oneCollateral: 1e6,
            setBacking: 0,
            feeRecipient: address(0),
            makerFeeBpsTimes1k: 0,
            takerFeeBpsTimes1k: 0,
            maxBuilderFeeBpsTimes1k: 0,
            settlementFeeBpsTimes1k: 0,
            settlement: address(0),
            marketNonce: 0,
            finalized: false
        });
    }

    function getBinaryPoolParams() external view returns (BinaryPoolParams memory) {
        return _params;
    }

    function placeBinaryOrder(uint8, uint256, uint256, uint64, uint8, uint8, address, uint96, uint64)
        external
        pure
        returns (bool, uint128)
    {
        revert("not implemented");
    }

    function cancelOrder(uint128) external pure {
        revert("not implemented");
    }

    function getBookLevels(bool, uint64) external pure returns (OrderBookLevel[] memory) {
        revert("not implemented");
    }

    function getOrderBookParameters() external pure returns (OrderBookParams memory) {
        revert("not implemented");
    }

    function marketExpiryNs() external pure returns (uint64) {
        revert("not implemented");
    }

    function finalized() external pure returns (bool) {
        return false;
    }

    function deposit(address, uint256) external pure {
        revert("not implemented");
    }

    function withdraw(address, uint256) external pure {
        revert("not implemented");
    }

    function getWithdrawableBalance(address, address) external pure returns (uint256) {
        return 0;
    }
}

/// @notice Records redeem() calls and pays out from a collateral balance it
///         holds, mirroring the real module's "redeem burns outcome tokens and
///         pays collateral" behavior closely enough for these tests.
contract MockMarketsModule is IBinaryMarketsModule {
    MockOutcomeToken public outcome;
    MockCollateral public collateral;

    struct Call {
        uint32 operatorId;
        bytes32 venueId;
        bytes32 marketId;
        uint8 outcomeIdx;
        uint256 amount;
    }

    Call[] public calls;

    constructor(MockOutcomeToken outcome_, MockCollateral collateral_) {
        outcome = outcome_;
        collateral = collateral_;
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount)
        external
    {
        calls.push(Call(operatorId, venueId, marketId, outcomeIdx, amount));
        outcome.burn(msg.sender, outcomeIdx == 0 ? 1 : 2, amount);
        collateral.mint(msg.sender, amount);
    }
}

contract MockRegistry is IMarketRegistry {
    mapping(bytes32 => MarketRef) private _refs;
    bytes32[] private _ids;

    function set(bytes32 marketId, MarketRef calldata ref) external {
        if (_refs[marketId].pool == address(0)) _ids.push(marketId);
        _refs[marketId] = ref;
    }

    function marketRef(bytes32 marketId) external view returns (MarketRef memory) {
        return _refs[marketId];
    }

    function isRegistered(bytes32 marketId) external view returns (bool) {
        return _refs[marketId].pool != address(0);
    }

    function registeredCount() external view returns (uint256) {
        return _ids.length;
    }

    function registeredAt(uint256 i) external view returns (bytes32) {
        return _ids[i];
    }
}
