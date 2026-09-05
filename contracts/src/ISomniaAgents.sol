// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Somnia Agents — platform interface
/// @notice Structs and signatures copied verbatim from the Somnia docs
///         (https://docs.somnia.network/agents/invoking-agents/from-solidity).
///         They must match the deployed platform ABI exactly, so do not "tidy" them.
///
///         Platform (Shannon testnet): 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
///         Platform (mainnet):         0x5E5205CF39E766118C01636bED000A54D93163E6

enum ConsensusType {
    Majority,
    Threshold
}

enum ResponseStatus {
    None, // 0 - uninitialized storage
    Pending, // 1 - awaiting responses
    Success, // 2 - consensus reached
    Failed, // 3 - validators reported failure
    TimedOut // 4 - request timed out

}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    /// @notice Lets the caller override subcommittee size, threshold, consensus
    ///         type and timeout. We use it for a short timeout — the platform
    ///         default is 15 minutes, which is long enough to straddle a whole
    ///         trading window.
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    /// @notice Operations-reserve FLOOR only. Not the amount to send.
    ///         msg.value must be floor + per_agent_price * subcommitteeSize,
    ///         or runners skip the request and it times out.
    function getRequestDeposit() external view returns (uint256);

    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}

/// @notice The LLM Inference base agent. Payloads are ABI-encoded calls to these.
interface ILlmInferenceAgent {
    /// @param allowedValues constrains the model to one of these exact strings.
    ///        Passing a closed set is what makes the output safe to act on.
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);

    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256 response);
}

/// @notice The JSON API base agent (used only by the optional second input).
interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata selector, uint8 decimals)
        external
        returns (uint256);
}
