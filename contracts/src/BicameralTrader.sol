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
} from "./IEventContracts.sol";
import {
    IAgentRequester,
    ConsensusType,
    ResponseStatus,
    Request,
    Response
} from "./ISomniaAgents.sol";
import {AgentToolLib} from "./AgentToolLib.sol";
import {RiskGate} from "./RiskGate.sol";
import {IMarketRegistry, MarketRef} from "./IMarketRegistry.sol";

/// @title BicameralTrader — a trading agent that is a contract, not a process
/// @notice The whole loop lives here: read the DreamDEX book on-chain, ask
///         Somnia's on-chain LLM, run the answer through a deterministic Solidity
///         gate, place the order, redeem at settlement. There is no server, no
///         bot process, and no key held anywhere that can trade.
///
///         Two chambers, hence the name: the model proposes, Solidity disposes.
///         `RiskGate` takes no input from the model about its own bounds.
contract BicameralTrader {
    // ------------------------------------------------------------------ types

    struct Pending {
        uint256 requestId;
        address pool;
        uint64 startedAt;
        uint64 deadline;
    }

    // ----------------------------------------------------------------- config

    /// @dev All immutable-after-init. A mutable prompt or mutable bounds would
    ///      make the published track record meaningless, which is the exact
    ///      criticism this project levels at off-chain agents.
    address public owner;
    string public name;
    string public strategy; // the user's prompt, public by construction
    bytes32 public strategyHash;
    RiskGate.Params public risk;

    IAgentRequester public platform;
    IMarketRegistry public registry;
    IERC20Like public collateral;
    uint256 public llmAgentId;

    /// @dev Per-agent LLM price from the Somnia gas-fees table. Sent on top of
    ///      the operations-reserve floor; anything unclaimed is rebated.
    uint256 public perAgentReward;
    uint256 public subcommitteeSize;
    uint256 public consensusThreshold;
    uint256 public requestTimeout;

    /// @dev How often a window may be re-evaluated. Live cadences are 1h and 4h,
    ///      so deciding once per window would leave the agent idle for hours.
    uint32 public reevalInterval;

    bool public paused;
    bool private _initialized;
    bool private _mandateSet;
    address public factory;

    /// @notice The mandate: a filter over whatever the venue is listing, empty
    ///         array meaning "any". This is how a user says what they want to
    ///         trade without anything being hardcoded — when DreamDEX lists a new
    ///         asset or cadence, an open-mandate agent starts trading it with no
    ///         redeploy. Immutable after the factory sets it.
    bytes32[] public mandateAssets;
    uint32[] public mandateCadences;
    bytes32[] public mandateVenues;

    // ------------------------------------------------------------------ state

    mapping(bytes32 => Pending) public inFlight; // marketId => request in flight
    mapping(uint256 => bytes32) public requestMarket; // requestId => marketId
    mapping(bytes32 => uint64) public lastDecisionAt;
    mapping(bytes32 => uint256) public openNotionalOf;
    mapping(bytes32 => bool) public hasPosition;

    bytes32[] public touchedMarkets;
    mapping(bytes32 => bool) private _touched;

    uint8 public openPositions;
    uint256 public openNotional;
    uint256 public decisionCount;

    // ----------------------------------------------------------------- events

    event Initialized(address indexed owner, string name, bytes32 strategyHash);
    event WindowOpened(
        bytes32 indexed marketId,
        uint256 indexed requestId,
        address pool,
        string marketState,
        uint64 deadline
    );
    event VerdictReceived(
        bytes32 indexed marketId,
        uint256 indexed requestId,
        uint8 verdict,
        uint256 agreeing,
        uint256 subcommittee
    );
    event GateDecision(
        bytes32 indexed marketId,
        uint256 indexed requestId,
        uint8 reasonCode,
        uint8 kind,
        uint256 price,
        uint256 quantity
    );
    event OrderPlaced(
        bytes32 indexed marketId, uint128 orderId, uint8 kind, uint256 price, uint256 quantity
    );
    event OrderRejected(bytes32 indexed marketId, uint256 indexed requestId, uint8 reasonCode);
    event RequestFailed(bytes32 indexed marketId, uint256 indexed requestId, uint8 status);
    event VerdictUnparseable(bytes32 indexed marketId, uint256 indexed requestId, string raw);
    event RequestExpired(bytes32 indexed marketId, uint256 indexed requestId);
    event Redeemed(bytes32 indexed marketId, uint8 outcomeIdx, uint256 amount);
    event Paused(bool paused);
    event Funded(address indexed from, uint256 collateralAmount);
    event Fueled(address indexed from, uint256 amount);

    // ----------------------------------------------------------------- errors

    error AlreadyInitialized();
    error NotOwner();
    error NotPlatform();
    error IsPaused();
    error UnknownMarket();
    error RequestInFlight();
    error TooSoon(uint64 nextAllowed);
    error InsufficientFuel(uint256 needed, uint256 have);
    error NotExpiredYet();
    error NothingToRedeem();
    error OutsideMandate();
    error MandateAlreadySet();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ------------------------------------------------------------------- init

    /// @dev Clones cannot use constructors, so this must be one-shot guarded.
    ///      Without the guard anyone can re-initialize someone else's agent and
    ///      take ownership of its funds.
    function initialize(
        address owner_,
        string calldata name_,
        string calldata strategy_,
        RiskGate.Params calldata risk_,
        address platform_,
        address registry_,
        address collateral_,
        uint256 llmAgentId_,
        uint256 perAgentReward_,
        uint256 subcommitteeSize_,
        uint256 consensusThreshold_,
        uint256 requestTimeout_,
        uint32 reevalInterval_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        require(bytes(strategy_).length > 0 && bytes(strategy_).length <= 500, "strategy length");
        require(subcommitteeSize_ >= 1 && subcommitteeSize_ <= 10, "subcommittee size");
        require(consensusThreshold_ >= 1 && consensusThreshold_ <= subcommitteeSize_, "threshold");
        require(reevalInterval_ >= 60, "reeval too fast");
        RiskGate.validate(risk_);

        factory = msg.sender;
        owner = owner_;
        name = name_;
        strategy = strategy_;
        strategyHash = keccak256(bytes(strategy_));
        risk = risk_;
        platform = IAgentRequester(platform_);
        registry = IMarketRegistry(registry_);
        collateral = IERC20Like(collateral_);
        llmAgentId = llmAgentId_;
        perAgentReward = perAgentReward_;
        subcommitteeSize = subcommitteeSize_;
        consensusThreshold = consensusThreshold_;
        requestTimeout = requestTimeout_;
        reevalInterval = reevalInterval_;

        emit Initialized(owner_, name_, strategyHash);
    }

    /// @dev Set once, by the factory, immediately after initialize. Separated
    ///      only because initialize is already at the compiler's argument limit.
    function setMandate(
        bytes32[] calldata assets,
        uint32[] calldata cadences,
        bytes32[] calldata venues
    ) external {
        if (_mandateSet) revert MandateAlreadySet();
        if (msg.sender != factory) revert NotOwner();
        _mandateSet = true;
        mandateAssets = assets;
        mandateCadences = cadences;
        mandateVenues = venues;
    }

    /// @notice True if this agent is allowed to touch that market.
    /// @dev Empty filter = any. Evaluated against the registry's typed fields,
    ///      never against the market's question text (documented as unstable).
    function withinMandate(MarketRef memory ref) public view returns (bool) {
        if (!_matchB32(mandateAssets, ref.asset)) return false;
        if (!_matchB32(mandateVenues, ref.venueId)) return false;
        if (mandateCadences.length > 0) {
            bool hit;
            for (uint256 i = 0; i < mandateCadences.length; i++) {
                if (mandateCadences[i] == ref.intervalSec) {
                    hit = true;
                    break;
                }
            }
            if (!hit) return false;
        }
        return true;
    }

    function _matchB32(bytes32[] storage set, bytes32 v) private view returns (bool) {
        if (set.length == 0) return true;
        for (uint256 i = 0; i < set.length; i++) {
            if (set[i] == v) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- funding

    /// @notice Pull collateral from the caller. The agent holds its own funds;
    ///         the owner can always withdraw them.
    function fundCollateral(uint256 amount) external {
        require(collateral.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Funded(msg.sender, amount);
    }

    /// @dev Also the landing pad for the platform's automatic rebates. Without a
    ///      payable receive the rebate transfer fails and the funds are stranded.
    receive() external payable {
        emit Fueled(msg.sender, msg.value);
    }

    /// @notice Total deposit for one inference request: operations-reserve floor
    ///         plus what runners actually charge. Paying only the floor means
    ///         `perAgentBudget == 0` and every runner skips the request.
    function requestCost() public view returns (uint256) {
        return platform.getAdvancedRequestDeposit(subcommitteeSize)
            + perAgentReward * subcommitteeSize;
    }

    /// @notice How many more decisions this agent can afford. Rendered as a
    ///         LOW FUEL badge in the UI — an agent with collateral but no STT
    ///         looks broken for reasons nobody can see.
    function fuelRemaining() external view returns (uint256) {
        uint256 cost = requestCost();
        return cost == 0 ? 0 : address(this).balance / cost;
    }

    // ------------------------------------------------------------ the trigger

    /// @notice Ask the on-chain LLM what to do about one market.
    /// @dev PERMISSIONLESS on purpose. A keeper calls this every cycle, but the
    ///      keeper holds no authority: it cannot trade, cannot change the
    ///      strategy, and cannot make the agent do anything the gate forbids.
    ///      Anyone — including a judge — can call it and the agent behaves
    ///      identically. That is what "no server makes a decision" means.
    function openWindow(bytes32 marketId) external returns (uint256 requestId) {
        if (paused) revert IsPaused();

        MarketRef memory ref = registry.marketRef(marketId);
        if (ref.pool == address(0)) revert UnknownMarket();
        if (!withinMandate(ref)) revert OutsideMandate();

        Pending memory p = inFlight[marketId];
        if (p.requestId != 0 && uint64(block.timestamp) < p.deadline) revert RequestInFlight();

        uint64 next = lastDecisionAt[marketId] + reevalInterval;
        if (lastDecisionAt[marketId] != 0 && uint64(block.timestamp) < next) revert TooSoon(next);

        IBinaryPool pool = IBinaryPool(ref.pool);
        if (pool.finalized()) revert UnknownMarket();

        uint64 expirySec = uint64(pool.marketExpiryNs() / 1e9);
        if (expirySec <= block.timestamp || expirySec - block.timestamp < risk.minHeadroom) {
            revert NotExpiredYet();
        }

        uint256 cost = requestCost();
        if (address(this).balance < cost) revert InsufficientFuel(cost, address(this).balance);

        string memory marketState = AgentToolLib.describeMarket(ref.pool, uint64(block.timestamp));
        bytes memory payload = AgentToolLib.encodeInferString(strategy, marketState);

        requestId = platform.createAdvancedRequest{value: cost}(
            llmAgentId,
            address(this),
            this.handleResponse.selector,
            payload,
            subcommitteeSize,
            consensusThreshold,
            ConsensusType.Threshold,
            requestTimeout
        );

        uint64 deadline = uint64(block.timestamp + requestTimeout);
        inFlight[marketId] = Pending(requestId, ref.pool, uint64(block.timestamp), deadline);
        requestMarket[requestId] = marketId;
        lastDecisionAt[marketId] = uint64(block.timestamp);
        decisionCount++;
        _touch(marketId);

        emit WindowOpened(marketId, requestId, ref.pool, marketState, deadline);
    }

    // --------------------------------------------------------- the callback

    /// @dev Guarded three ways: only the platform may call, only for a request we
    ///      created, and the pending slot is cleared BEFORE any external call.
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external {
        if (msg.sender != address(platform)) revert NotPlatform();

        bytes32 marketId = requestMarket[requestId];
        if (marketId == bytes32(0)) revert UnknownMarket();
        Pending memory p = inFlight[marketId];
        if (p.requestId != requestId) revert UnknownMarket();

        delete inFlight[marketId];
        delete requestMarket[requestId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit RequestFailed(marketId, requestId, uint8(status));
            return;
        }

        // An answer we cannot read is a real outcome worth publishing, not a
        // reason to revert. Reverting here would delete the decision from the
        // feed and from the receipts corpus while still having spent the STT.
        (bool ok, AgentToolLib.Verdict verdict, string memory raw) =
            AgentToolLib.tryDecodeVerdict(responses[0].result);

        if (!ok) {
            emit VerdictUnparseable(marketId, requestId, raw);
            return;
        }

        emit VerdictReceived(
            marketId, requestId, uint8(verdict), responses.length, details.subcommittee.length
        );

        _act(marketId, requestId, p.pool, verdict);
    }

    function _act(bytes32 marketId, uint256 requestId, address poolAddr, AgentToolLib.Verdict v)
        private
    {
        IBinaryPool pool = IBinaryPool(poolAddr);

        // Re-read everything. State moves between openWindow and the callback:
        // the docs warn reads can flip to Locked mid-flight.
        RiskGate.Snapshot memory s;
        OrderBookLevel[] memory bids = pool.getBookLevels(true, 1);
        OrderBookLevel[] memory asks = pool.getBookLevels(false, 1);
        s.bestBid = bids.length > 0 ? bids[0].price : 0;
        s.bestAsk = asks.length > 0 ? asks[0].price : 0;

        OrderBookParams memory grid = pool.getOrderBookParameters();
        s.tickSize = grid.tickSize;
        s.lotSize = grid.lotSize;
        s.minQuantity = grid.minQuantity;

        s.expirySec = uint64(pool.marketExpiryNs() / 1e9);
        s.nowSec = uint64(block.timestamp);
        s.finalized = pool.finalized();
        s.openPositions = openPositions;
        s.openNotional = openNotional;
        s.collateralAvailable = collateral.balanceOf(address(this));

        (uint8 reason, RiskGate.Order memory order) = RiskGate.evaluate(risk, s, v);
        emit GateDecision(marketId, requestId, reason, order.kind, order.price, order.quantity);

        if (reason != RiskGate.OK) {
            emit OrderRejected(marketId, requestId, reason);
            return;
        }

        _placeOrder(marketId, poolAddr, order, s.expirySec);
    }

    function _placeOrder(
        bytes32 marketId,
        address poolAddr,
        RiskGate.Order memory order,
        uint64 expirySec
    ) private {
        IBinaryPool pool = IBinaryPool(poolAddr);

        uint256 cost = (order.quantity * order.price) / AgentToolLib.PRICE_SCALE;
        collateral.approve(poolAddr, cost);
        pool.deposit(address(collateral), cost);

        // Expiry is NANOseconds and must satisfy 0 < expireNs <= marketExpiryNs().
        // Clamp to the market's own expiry: the pool is the only authority here.
        uint64 expireNs = uint64(uint256(expirySec) * 1e9);

        (bool success, uint128 orderId) = pool.placeBinaryOrder(
            order.kind,
            order.price,
            order.quantity,
            expireNs,
            AgentToolLib.IOC, // taker: cross or cancel, never rest invisible escrow
            0, // selfMatchingOption: venue default
            address(0), // no builder
            0, // no builder fee
            0 // userData
        );

        if (success) {
            // Count POSITIONS PER MARKET, not per order. An agent re-evaluating a
            // window every reevalInterval places several orders into the same
            // market; counting each one would ratchet openPositions up until
            // R_MAX_CONCURRENT silently strangles an agent that holds nothing.
            if (!hasPosition[marketId]) {
                hasPosition[marketId] = true;
                openPositions++;
            }
            openNotional += cost;
            openNotionalOf[marketId] += cost;
            emit OrderPlaced(marketId, orderId, order.kind, order.price, order.quantity);
        }
    }

    // -------------------------------------------------------------- upkeep

    /// @notice Clear a request that never came back. PERMISSIONLESS.
    /// @dev Without this one timeout wedges the agent for the rest of the run and
    ///      the failure is silent — no revert, no event, just an agent that has
    ///      quietly stopped trading.
    function expirePending(bytes32 marketId) external {
        Pending memory p = inFlight[marketId];
        require(p.requestId != 0, "nothing pending");
        require(uint64(block.timestamp) >= p.deadline, "not past deadline");
        delete inFlight[marketId];
        delete requestMarket[p.requestId];
        emit RequestExpired(marketId, p.requestId);
    }

    /// @notice Redeem a settled position. PERMISSIONLESS — anyone may settle the
    ///         agent, and the proceeds can only land in the agent.
    function settleAndRedeem(bytes32 marketId) external {
        MarketRef memory ref = registry.marketRef(marketId);
        if (ref.pool == address(0)) revert UnknownMarket();

        BinaryPoolParams memory params = IBinaryPool(ref.pool).getBinaryPoolParams();
        IBinaryMarket market = IBinaryMarket(params.market);
        require(market.isResolved() || market.isVoided(), "not settled");

        IOutcomeToken6909 outcome = IOutcomeToken6909(params.outcomeToken);

        // The markets module must be an operator on the ERC-6909 singleton before
        // it can move our outcome tokens. Done lazily and idempotently here,
        // because the outcome token address is only known from a pool's params —
        // it is not available at initialize() time. Discovering this at settlement
        // without the call would strand the position.
        if (!outcome.isOperator(address(this), ref.marketsModule)) {
            outcome.setOperator(ref.marketsModule, true);
        }

        uint256[] memory payouts = market.payoutNumerators();

        bool voided = market.isVoided();
        bool hadPosition = hasPosition[marketId];
        uint256 redeemed;

        // Check the BALANCE first, regardless of payout — a position holding
        // only the losing side (payout 0) is a real, finished position, not
        // nothing. Only the external `redeem()` call itself is skipped for a
        // losing balance, since claiming a token worth zero has nothing to
        // claim. A voided market pays both sides at 0.5, so it is not "losing"
        // on either side and both get redeemed.
        for (uint8 idx = 0; idx < payouts.length; idx++) {
            uint256 tokenId = idx == 0 ? params.yesId : params.noId;
            uint256 bal = outcome.balanceOf(address(this), tokenId);
            if (bal == 0) continue;
            if (!voided && payouts[idx] == 0) continue; // held the losing side: nothing to claim
            IBinaryMarketsModule(ref.marketsModule).redeem(
                ref.operatorId, ref.venueId, marketId, idx, bal
            );
            redeemed += bal;
            emit Redeemed(marketId, idx, bal);
        }

        // Nothing to do at all: no position was ever open here, and nothing
        // came back. Calling this on a market the agent never touched should
        // fail rather than silently succeed.
        if (!hadPosition && redeemed == 0) revert NothingToRedeem();

        // The position is CLOSED the moment the market is settled — whether it
        // paid out or was a total loss. A settled market can never pay again,
        // so there is nothing left to wait for either way.
        if (hadPosition) {
            hasPosition[marketId] = false;
            if (openPositions > 0) openPositions--;
        }
        uint256 n = openNotionalOf[marketId];
        if (n > 0) {
            openNotional = openNotional > n ? openNotional - n : 0;
            openNotionalOf[marketId] = 0;
        }
    }

    /// @notice Cancel a resting order. PERMISSIONLESS: unfilled remainders lock
    ///         escrow invisibly, so anyone should be able to free it.
    function cancelOrder(address poolAddr, uint128 orderId) external {
        IBinaryPool(poolAddr).cancelOrder(orderId);
    }

    // --------------------------------------------------------------- owner

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function withdrawCollateral(uint256 amount, address to) external onlyOwner {
        require(collateral.transfer(to, amount), "transfer failed");
    }

    function withdrawFuel(uint256 amount, address payable to) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "fuel withdraw failed");
    }

    /// @notice Pull collateral back out of a pool's escrow.
    function withdrawFromPool(address poolAddr, uint256 amount) external onlyOwner {
        IBinaryPool(poolAddr).withdraw(address(collateral), amount);
    }

    // --------------------------------------------------------------- views

    function touchedMarketCount() external view returns (uint256) {
        return touchedMarkets.length;
    }

    function _touch(bytes32 marketId) private {
        if (!_touched[marketId]) {
            _touched[marketId] = true;
            touchedMarkets.push(marketId);
        }
    }
}
