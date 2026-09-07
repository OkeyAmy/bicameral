// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBinaryPool, OrderBookLevel, BinaryPoolParams, OrderBookParams} from "./IEventContracts.sol";
import {ILlmInferenceAgent} from "./ISomniaAgents.sol";

/// @title AgentToolLib — the missing adapter between Somnia Agents and DreamDEX Event Contracts
/// @notice Somnia ships on-chain LLM inference. DreamDEX ships an on-chain binary
///         CLOB. Nothing connects them: there is no adapter, no example, and no
///         reference contract anywhere in either project. This library is that
///         connector.
///
///         It does three jobs:
///           1. Renders live pool state into a compact prompt a deterministic
///              model can act on (`describeMarket`).
///           2. Defines the closed vocabulary the model is constrained to
///              (`allowedVerdicts`) and parses it back (`parseVerdict`).
///           3. Expresses DreamDEX order placement as a Somnia `OnchainTool`
///              signature string and safely decodes the calldata the model
///              yields back (`ORDER_TOOL_SIGNATURE`, `decodeOrderCall`).
///
///         Import this instead of rediscovering 1e6 probability units, nanosecond
///         expiries and `PostOnlyWouldCross()` the hard way.
library AgentToolLib {
    /// @dev Probability prices are 1e6 fixed point on the venue: 900000 == 0.90.
    uint256 internal constant PRICE_SCALE = 1_000_000;

    /// @dev Order `kind`, from IEventContracts.sol NatSpec. "YES" == Up.
    uint8 internal constant BUY_YES = 0;
    uint8 internal constant SELL_YES = 1;
    uint8 internal constant BUY_NO = 2;
    uint8 internal constant SELL_NO = 3;

    /// @dev Order types.
    uint8 internal constant LIMIT = 0;
    uint8 internal constant FOK = 1;
    uint8 internal constant IOC = 2;
    uint8 internal constant POST_ONLY = 3;

    enum Verdict {
        Abstain,
        BuyUp,
        BuyDown
    }

    error UnknownVerdict(string raw);
    error BadToolCalldata();

    // ------------------------------------------------------------------ prompt

    /// @notice A live snapshot of one market, rendered for a language model.
    /// @dev Deliberately numeric and terse. The venue's question text is
    ///      documented as unstable across releases, so nothing here parses it —
    ///      the model sees prices, depth and time, not prose.
    function describeMarket(address pool, uint64 nowSec) internal view returns (string memory) {
        IBinaryPool p = IBinaryPool(pool);

        OrderBookLevel[] memory bids = p.getBookLevels(true, 3);
        OrderBookLevel[] memory asks = p.getBookLevels(false, 3);

        uint64 expirySec = uint64(p.marketExpiryNs() / 1e9);
        uint256 secondsLeft = expirySec > nowSec ? expirySec - nowSec : 0;

        string memory book = string.concat(
            "up_bids=[", _levels(bids), "] up_asks=[", _levels(asks), "]"
        );

        string memory mid;
        if (bids.length > 0 && asks.length > 0) {
            uint256 m = (bids[0].price + asks[0].price) / 2;
            mid = string.concat(
                " mid_up=", _prob(m), " spread=", _prob(asks[0].price - bids[0].price)
            );
        } else {
            mid = " mid_up=none spread=none";
        }

        return string.concat(
            book,
            mid,
            " seconds_to_expiry=",
            _uint(secondsLeft),
            " (prices are probability that UP wins, 0..1)"
        );
    }

    /// @notice The system prompt every agent shares. The user's own strategy is
    ///         appended as the user turn; this half is not user-controlled.
    function systemPrompt() internal pure returns (string memory) {
        return
        "You are a decisive on-chain trading agent on a binary prediction market. UP and DOWN share one book; "
        "a DOWN price is 1 minus the UP price. Every inference you run costs real fuel, and an ABSTAIN still "
        "spends that fuel while producing no trade, so decisiveness is profit and laziness is a tax. "
        "You are given the live book and the time remaining. Apply the strategy you are given exactly. "
        "Pick the side with the best-risk edge: judge whether the strategy clearly points to UP or DOWN here, "
        "then answer with exactly one of: BUY_UP, BUY_DOWN, ABSTAIN. Reserve ABSTAIN for the narrow case where "
        "the strategy gives no answer at all AND no side has any read - never abstain merely because the edge is "
        "small or the price is midrange. Default to taking the side your strategy favors. "
        "Output nothing except the single token.";
    }

    /// @notice The closed set the model is constrained to. Passing this to
    ///         `inferString` is what makes the output safe to act on: the model
    ///         cannot return free text, so there is no parser to fool.
    function allowedVerdicts() internal pure returns (string[] memory out) {
        out = new string[](3);
        out[0] = "BUY_UP";
        out[1] = "BUY_DOWN";
        out[2] = "ABSTAIN";
    }

    /// @notice Parse a model answer into a verdict.
    /// @dev `allowedValues` constrains the model's CHOICE, not its BYTES: a real
    ///      inference routinely comes back as "BUY_UP\n" or "\"BUY_UP\"". Rejecting
    ///      those would throw away a paid-for consensus over a stray character.
    ///
    ///      So surrounding whitespace and quotes are trimmed — and nothing else.
    ///      Case still matters, and a string that merely CONTAINS a valid token is
    ///      still rejected. Those are the properties that make this an injection
    ///      defence, and trimming leaves both intact.
    function parseVerdict(string memory raw) internal pure returns (Verdict) {
        bytes32 h = keccak256(bytes(_trim(raw)));
        if (h == keccak256("BUY_UP")) return Verdict.BuyUp;
        if (h == keccak256("BUY_DOWN")) return Verdict.BuyDown;
        if (h == keccak256("ABSTAIN")) return Verdict.Abstain;
        revert UnknownVerdict(raw);
    }

    /// @dev Non-reverting variant for the callback path: a model answer we cannot
    ///      read is a real, publishable outcome, not a reason to throw away the
    ///      whole decision record.
    function tryParseVerdict(string memory raw) internal pure returns (bool ok, Verdict v) {
        bytes32 h = keccak256(bytes(_trim(raw)));
        if (h == keccak256("BUY_UP")) return (true, Verdict.BuyUp);
        if (h == keccak256("BUY_DOWN")) return (true, Verdict.BuyDown);
        if (h == keccak256("ABSTAIN")) return (true, Verdict.Abstain);
        return (false, Verdict.Abstain);
    }

    /// @dev Strips ASCII whitespace and wrapping quotes from both ends.
    function _trim(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 start = 0;
        uint256 end = b.length;
        while (start < end && _skippable(b[start])) start++;
        while (end > start && _skippable(b[end - 1])) end--;
        if (start == 0 && end == b.length) return s;
        bytes memory out = new bytes(end - start);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[start + i];
        }
        return string(out);
    }

    function _skippable(bytes1 c) private pure returns (bool) {
        return c == 0x20 // space
            || c == 0x09 // tab
            || c == 0x0a // \n
            || c == 0x0d // \r
            || c == 0x22 // "
            || c == 0x27; // '
    }

    /// @notice ABI-encoded payload for the LLM Inference agent's `inferString`.
    function encodeInferString(string memory strategy, string memory marketState)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            ILlmInferenceAgent.inferString.selector,
            string.concat("STRATEGY: ", strategy, "\nMARKET: ", marketState),
            systemPrompt(),
            false, // chainOfThought off: one token out, and it keeps cost down
            allowedVerdicts()
        );
    }

    /// @notice Decode what a subcommittee returned. Results are ABI-encoded like
    ///         any EVM return value.
    function decodeVerdict(bytes memory result) internal pure returns (Verdict) {
        return parseVerdict(abi.decode(result, (string)));
    }

    /// @notice Non-reverting decode for the callback path.
    /// @return ok false if the bytes are not a string, or not a known verdict.
    /// @return v the verdict when ok.
    /// @return raw the decoded text, so an unreadable answer can be published
    ///         rather than silently discarded.
    function tryDecodeVerdict(bytes memory result)
        internal
        pure
        returns (bool ok, Verdict v, string memory raw)
    {
        if (result.length < 64) return (false, Verdict.Abstain, "");
        raw = abi.decode(result, (string));
        (ok, v) = tryParseVerdict(raw);
    }

    // ------------------------------------------------- on-chain tool (stretch)

    /// @notice DreamDEX order placement expressed as a Somnia `OnchainTool`.
    /// @dev Used with `inferToolsChat`, where the model yields ABI-encoded
    ///      calldata the caller executes. Kept deliberately narrow: the model may
    ///      choose side, price and size, and nothing else. Expiry, order type,
    ///      self-match policy and builder fees are not the model's to pick.
    string internal constant ORDER_TOOL_SIGNATURE =
        "placeBinaryOrder(uint8 kind, uint256 price, uint256 quantity)";

    string internal constant ORDER_TOOL_DESCRIPTION =
        "Place one order on the binary market. kind: 0=BUY_UP 1=SELL_UP 2=BUY_DOWN 3=SELL_DOWN. "
        "price: probability that UP wins, in millionths (900000 = 0.90). quantity: contracts in collateral base units.";

    /// @notice Safely decode calldata the model yielded for the order tool.
    /// @dev Reverts rather than returning garbage if the selector or length is
    ///      wrong. The caller must still run every value through the risk gate —
    ///      this only proves the bytes are shaped like an order.
    function decodeOrderCall(bytes memory toolCall)
        internal
        pure
        returns (uint8 kind, uint256 price, uint256 quantity)
    {
        if (toolCall.length != 4 + 32 * 3) revert BadToolCalldata();
        bytes4 sel;
        assembly {
            sel := mload(add(toolCall, 32))
        }
        if (sel != bytes4(keccak256(bytes(ORDER_TOOL_SIGNATURE)))) revert BadToolCalldata();

        bytes memory args = new bytes(toolCall.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = toolCall[i + 4];
        }
        (kind, price, quantity) = abi.decode(args, (uint8, uint256, uint256));
    }

    // ---------------------------------------------------------------- helpers

    /// @notice Snap a price to the venue's tick grid. Off-grid prices are a
    ///         classic silent failure.
    function snapPrice(uint256 price, uint256 tickSize) internal pure returns (uint256) {
        if (tickSize == 0) return price;
        return (price / tickSize) * tickSize;
    }

    /// @notice Snap a size to the venue's lot grid. Sub-lot amounts floor to zero.
    function snapSize(uint256 qty, uint256 lotSize) internal pure returns (uint256) {
        if (lotSize == 0) return qty;
        return (qty / lotSize) * lotSize;
    }

    function _levels(OrderBookLevel[] memory ls) private pure returns (string memory out) {
        for (uint256 i = 0; i < ls.length; i++) {
            out = string.concat(
                out, i == 0 ? "" : ",", _prob(ls[i].price), "@", _uint(ls[i].quantity)
            );
        }
    }

    /// @dev Renders a 1e6 price as 0.xxx — small, unambiguous, and cheap.
    function _prob(uint256 price) private pure returns (string memory) {
        uint256 milli = price / 1000; // 0..1000
        if (milli >= 1000) return "1.000";
        return string.concat("0.", _pad3(milli));
    }

    function _pad3(uint256 v) private pure returns (string memory) {
        if (v >= 100) return _uint(v);
        if (v >= 10) return string.concat("0", _uint(v));
        return string.concat("00", _uint(v));
    }

    function _uint(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        for (uint256 t = v; t != 0; t /= 10) {
            digits++;
        }
        bytes memory b = new bytes(digits);
        while (v != 0) {
            b[--digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }
}
