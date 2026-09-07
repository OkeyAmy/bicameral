// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BicameralTrader} from "./BicameralTrader.sol";
import {RiskGate} from "./RiskGate.sol";
import {IMarketRegistry, IBinaryModule, MarketRef} from "./IMarketRegistry.sol";
import {IERC20Like} from "./IEventContracts.sol";

/// @title BicameralFactory — clones, registry, and the starter-fuel treasury
/// @notice Three jobs in one contract because they share one audience:
///
///   1. **Clones.** Every agent is an EIP-1167 minimal proxy of ONE immutable
///      implementation, so every agent on the public board provably runs
///      identical code with a different prompt. That is what makes comparing
///      their P&L meaningful rather than apples-to-oranges.
///
///   2. **Registry.** The public Floor and the keeper both enumerate agents and
///      markets from this contract's events. There is no database anywhere else.
///
///   3. **Treasury.** A stranger who finds the link has a wallet and no testnet
///      funds. Sending them to a faucet ends the funnel, so each new agent gets
///      a starter grant: enough STT for a first run of decisions, plus a small
///      collateral float. Capped per address and globally, with an off-switch.
contract BicameralFactory is IMarketRegistry {
    // ------------------------------------------------------------------ types

    /// @notice What an agent is allowed to touch. Empty array means "any".
    /// @dev This is how "any user can want anything" is expressed without
    ///      hardcoding a market universe: a mandate is a filter over whatever the
    ///      venue is listing, re-resolved every cycle. When DreamDEX lists a new
    ///      asset or cadence, every open-mandate agent starts trading it with no
    ///      redeploy.
    struct Mandate {
        bytes32[] assets;
        uint32[] cadences;
        bytes32[] venues;
    }

    struct AgentInfo {
        address owner;
        string name;
        bytes32 strategyHash;
        uint64 deployedAt;
        bool sponsored;
    }

    // ----------------------------------------------------------------- config

    address public immutable implementation;
    address public owner;

    address public platform; // Somnia Agents
    address public collateral; // tUSDC on testnet
    address public marketsModule; // DreamDEX BinaryMarketsModule
    uint256 public llmAgentId;

    uint256 public perAgentReward;
    uint256 public subcommitteeSize = 3;
    uint256 public consensusThreshold = 2;
    uint256 public requestTimeout = 60; // NOT the platform's 15-minute default
    uint32 public defaultReevalInterval = 900;

    // ---------------------------------------------------------- treasury caps

    bool public sponsorshipOpen = true;
    uint256 public fuelGrant; // STT per new agent
    uint256 public collateralGrant; // tUSDC per new agent
    uint256 public maxAgentsPerAddress = 3;
    uint256 public maxSponsoredAgents = 200;
    uint256 public sponsoredCount;

    // ------------------------------------------------------------------ state

    address[] public agents;
    mapping(address => AgentInfo) public agentInfo;
    mapping(address => uint256) public agentsOf;
    mapping(address => Mandate) private _mandates;

    mapping(bytes32 => MarketRef) private _markets;
    bytes32[] private _marketIds;

    // ----------------------------------------------------------------- events

    event AgentDeployed(
        address indexed agent,
        address indexed owner,
        string name,
        string strategy,
        bytes32 strategyHash,
        bytes32[] assets,
        uint32[] cadences,
        bytes32[] venues,
        bool sponsored
    );
    event MarketRegistered(
        bytes32 indexed marketId, address pool, bytes32 asset, uint32 intervalSec, uint64 expiry
    );
    event TreasuryFunded(address indexed from, uint256 stt, uint256 collateralAmount);
    event SponsorshipToggled(bool open);
    event GrantPaid(address indexed agent, uint256 stt, uint256 collateralAmount);
    event GrantSkipped(address indexed agent, string reason);

    error NotOwner();
    error TooManyAgents();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address platform_,
        address collateral_,
        address marketsModule_,
        uint256 llmAgentId_,
        uint256 perAgentReward_,
        address implementation_
    ) {
        owner = msg.sender;
        platform = platform_;
        collateral = collateral_;
        marketsModule = marketsModule_;
        llmAgentId = llmAgentId_;
        perAgentReward = perAgentReward_;
        implementation = implementation_;
    }

    // ------------------------------------------------------------- deployment

    /// @notice Deploy an agent. Free: the treasury covers the first decisions.
    function deployAgent(
        string calldata name,
        string calldata strategy,
        RiskGate.Params calldata risk,
        bytes32[] calldata assets,
        uint32[] calldata cadences,
        bytes32[] calldata venues,
        uint32 reevalInterval
    ) external returns (address agent) {
        if (agentsOf[msg.sender] >= maxAgentsPerAddress) revert TooManyAgents();
        agentsOf[msg.sender]++;

        agent = _clone(implementation);

        BicameralTrader(payable(agent)).initialize(
            msg.sender,
            name,
            strategy,
            risk,
            platform,
            address(this),
            collateral,
            llmAgentId,
            perAgentReward,
            subcommitteeSize,
            consensusThreshold,
            requestTimeout,
            reevalInterval == 0 ? defaultReevalInterval : reevalInterval
        );

        BicameralTrader(payable(agent)).setMandate(assets, cadences, venues);

        Mandate storage m = _mandates[agent];
        m.assets = assets;
        m.cadences = cadences;
        m.venues = venues;

        bool sponsored = _grant(agent);

        agents.push(agent);
        agentInfo[agent] = AgentInfo({
            owner: msg.sender,
            name: name,
            strategyHash: keccak256(bytes(strategy)),
            deployedAt: uint64(block.timestamp),
            sponsored: sponsored
        });

        emit AgentDeployed(
            agent,
            msg.sender,
            name,
            strategy,
            keccak256(bytes(strategy)),
            assets,
            cadences,
            venues,
            sponsored
        );
    }

    /// @dev Degrades gracefully: a dry treasury must never fail the deploy, it
    ///      just means the owner funds the agent manually.
    function _grant(address agent) private returns (bool) {
        if (!sponsorshipOpen) {
            emit GrantSkipped(agent, "sponsorship closed");
            return false;
        }
        if (sponsoredCount >= maxSponsoredAgents) {
            emit GrantSkipped(agent, "sponsored cap reached");
            return false;
        }
        if (address(this).balance < fuelGrant) {
            emit GrantSkipped(agent, "treasury out of STT");
            return false;
        }

        sponsoredCount++;
        uint256 col;
        if (collateralGrant > 0 && IERC20Like(collateral).balanceOf(address(this)) >= collateralGrant)
        {
            col = collateralGrant;
            IERC20Like(collateral).transfer(agent, col);
        }
        if (fuelGrant > 0) {
            (bool ok,) = payable(agent).call{value: fuelGrant}("");
            // A failed grant must NEVER fail the deploy — this function's whole
            // contract is that a dry or misbehaving treasury degrades to manual
            // funding. A require here would contradict that and brick deployAgent.
            if (!ok) {
                emit GrantSkipped(agent, "fuel transfer failed");
                return false;
            }
        }
        emit GrantPaid(agent, fuelGrant, col);
        return true;
    }

    /// @dev EIP-1167 minimal proxy. Inlined rather than pulling a dependency.
    function _clone(address impl) private returns (address instance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    // --------------------------------------------------------------- registry

    /// @notice Register a live window so agents may trade it. PERMISSIONLESS.
    /// @dev Safe to leave open because nothing here is taken on trust. The pool,
    ///      collateral, operatorId and venueId are read from the venue's own
    ///      `BinaryMarketsModule.markets(marketId)` — the authoritative on-chain
    ///      record — not from the caller. A caller can only ask us to mirror a
    ///      market the venue already created; they cannot invent one, and they
    ///      cannot point an agent at a pool of their own that would receive the
    ///      collateral the agent approves.
    ///
    ///      `asset` and `intervalSec` are not in that struct, so they are taken
    ///      from the caller and used ONLY for mandate filtering — they can never
    ///      redirect funds. Worst case a mis-labelled market is filtered wrongly.
    function registerMarket(bytes32 marketId, bytes32 asset, uint32 intervalSec)
        public
        returns (address pool)
    {
        (
            ,
            ,
            ,
            address marketCollateral,
            uint32 operatorId,
            bytes32 venueId,
            ,
            ,
            ,
            address poolAddr,
            ,
            ,
            ,
            uint64 expiry
        ) = IBinaryModule(marketsModule).markets(marketId);

        require(poolAddr != address(0), "unknown market");
        require(marketCollateral == collateral, "wrong collateral");

        if (_markets[marketId].pool == address(0)) _marketIds.push(marketId);

        _markets[marketId] = MarketRef({
            pool: poolAddr,
            marketsModule: marketsModule,
            operatorId: operatorId,
            venueId: venueId,
            asset: asset,
            intervalSec: intervalSec,
            expiry: expiry
        });

        emit MarketRegistered(marketId, poolAddr, asset, intervalSec, expiry);
        return poolAddr;
    }

    function registerMarkets(
        bytes32[] calldata ids,
        bytes32[] calldata assets_,
        uint32[] calldata cadences_
    ) external {
        require(ids.length == assets_.length && ids.length == cadences_.length, "length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            registerMarket(ids[i], assets_[i], cadences_[i]);
        }
    }

    function marketRef(bytes32 marketId) external view returns (MarketRef memory) {
        return _markets[marketId];
    }

    function isRegistered(bytes32 marketId) external view returns (bool) {
        return _markets[marketId].pool != address(0);
    }

    function registeredCount() external view returns (uint256) {
        return _marketIds.length;
    }

    function registeredAt(uint256 i) external view returns (bytes32) {
        return _marketIds[i];
    }

    // --------------------------------------------------------------- treasury

    function fundTreasury(uint256 collateralAmount) external payable {
        if (collateralAmount > 0) {
            require(
                IERC20Like(collateral).transferFrom(msg.sender, address(this), collateralAmount),
                "collateral transferFrom failed"
            );
        }
        emit TreasuryFunded(msg.sender, msg.value, collateralAmount);
    }

    receive() external payable {
        emit TreasuryFunded(msg.sender, msg.value, 0);
    }

    function setSponsorship(bool open, uint256 fuelGrant_, uint256 collateralGrant_)
        external
        onlyOwner
    {
        sponsorshipOpen = open;
        fuelGrant = fuelGrant_;
        collateralGrant = collateralGrant_;
        emit SponsorshipToggled(open);
    }

    function setCaps(uint256 perAddress, uint256 maxSponsored) external onlyOwner {
        maxAgentsPerAddress = perAddress;
        maxSponsoredAgents = maxSponsored;
    }

    function setAgentDefaults(
        uint256 llmAgentId_,
        uint256 perAgentReward_,
        uint256 subcommitteeSize_,
        uint256 consensusThreshold_,
        uint256 requestTimeout_,
        uint32 defaultReevalInterval_
    ) external onlyOwner {
        llmAgentId = llmAgentId_;
        perAgentReward = perAgentReward_;
        subcommitteeSize = subcommitteeSize_;
        consensusThreshold = consensusThreshold_;
        requestTimeout = requestTimeout_;
        defaultReevalInterval = defaultReevalInterval_;
    }

    function sweep(address payable to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "sweep failed");
    }

    // ------------------------------------------------------------------ views

    function agentCount() external view returns (uint256) {
        return agents.length;
    }

    function mandateOf(address agent) external view returns (Mandate memory) {
        return _mandates[agent];
    }
}
