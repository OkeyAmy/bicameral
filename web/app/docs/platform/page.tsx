import Link from "next/link";

export const metadata = { title: "What Somnia provides — Bicameral" };

export default function PlatformDocs() {
  return (
    <>
      <h1>What Somnia provides</h1>
      <p className="docs-lede">
        This project exists because of two host primitives that don&rsquo;t normally coexist: a
        chain that can run an LLM in consensus, and a fully on-chain order book to trade on. Here
        is exactly what the platform gives, and which parts are used.
      </p>

      <h2>Somnia Agents — on-chain inference</h2>
      <p>
        A smart contract can call out to a model and get an answer back that a{" "}
        <strong>committee of validators agreed on</strong> — the answer is only accepted when a
        majority threshold (two of three, by default) matches. That is the primitive the entire
        project rests on: without it, the &ldquo;AI&rdquo; half would have to run on a server and
        every trust guarantee would be social again.
      </p>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th className="n">Cost / validator</th>
            <th>Used here?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>LLM Inference</strong>
              <br />
              <span className="docs-dim">
                <code>inferString</code>, <code>inferNumber</code>, <code>inferChat</code>,{" "}
                <code>inferToolsChat</code>
              </span>
            </td>
            <td className="n">0.07 STT</td>
            <td>
              <strong>Yes</strong> — <code>inferString</code> with a closed{" "}
              <code>allowedValues</code> set, which is what makes the answer safe to act on.
            </td>
          </tr>
          <tr>
            <td>
              JSON API Request
              <br />
              <span className="docs-dim">fetch and parse any public endpoint</span>
            </td>
            <td className="n">0.03 STT</td>
            <td className="docs-dim">
              Not in the current build. It would let an agent read an off-chain price feed as a
              second input.
            </td>
          </tr>
          <tr>
            <td>
              LLM Parse Website
              <br />
              <span className="docs-dim">scrape a page, extract structure</span>
            </td>
            <td className="n">0.10 STT</td>
            <td className="docs-dim">Not used — nothing here needs to read the open web.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Requests are asynchronous: the contract calls{" "}
        <code>createAdvancedRequest</code> and the answer arrives later in a callback. We set a{" "}
        <strong>60-second timeout</strong> rather than the platform&rsquo;s 15-minute default,
        because 15 minutes is long enough to straddle an entire trading window.
      </p>

      <h3>Tool-calling is available, and deliberately not used yet</h3>
      <p>
        <code>inferToolsChat</code> lets the model return ABI-encoded calldata for on-chain tools
        rather than text — the adapter already defines the order-placement tool signature and a
        strict decoder for it. It is not on the live path. Letting a model produce calldata
        directly is a much larger surface than letting it pick one of three tokens, and the{" "}
        <Link href="/docs/risk-gate">closed-vocabulary design</Link> is the safety property worth
        keeping.
      </p>

      <h2>DreamDEX Event Contracts — the venue</h2>
      <p>
        Binary markets on a fully on-chain central limit order book. Up and Down share a single
        book, so a Down price is always one minus the Up price, and prices are the market&rsquo;s
        implied probability.
      </p>
      <p>The full lifecycle is used, through the raw Solidity interface rather than an SDK:</p>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Call</th>
            <th>What it does here</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>getBookLevels</code>
            </td>
            <td>Reads the live book, both to build the prompt and to price the order.</td>
          </tr>
          <tr>
            <td>
              <code>getOrderBookParameters</code>
            </td>
            <td>Tick, lot and minimum size — every order is snapped to this grid.</td>
          </tr>
          <tr>
            <td>
              <code>marketExpiryNs</code>
            </td>
            <td>
              The only authority on expiry. The gate reads the pool, never a cached row.
            </td>
          </tr>
          <tr>
            <td>
              <code>placeBinaryOrder</code>
            </td>
            <td>The order itself, IOC, priced and sized by the gate.</td>
          </tr>
          <tr>
            <td>
              <code>markets(marketId)</code>
            </td>
            <td>
              Authoritative record — pool, collateral, operator and venue id. It is what makes
              permissionless market registration safe.
            </td>
          </tr>
          <tr>
            <td>
              <code>redeem</code> · <code>payoutNumerators</code>
            </td>
            <td>Settlement. Voided markets pay both sides, so both are redeemed.</td>
          </tr>
        </tbody>
      </table>

      <h3>Mint-a-pair solves the cold start</h3>
      <p>
        A <code>Buy Up</code> at <em>p</em> crossing a <code>Buy Down</code> at <em>1−p</em> needs
        no seller and no inventory — the pool mints a fresh pair and gives one side to each buyer.
        Two agents that genuinely disagree can therefore fill each other on a completely empty
        book. Fees are zero across maker, taker and settlement, so published P&amp;L is pure market
        outcome with no fee drag.
      </p>

      <h2>Somnia&rsquo;s block rate shapes the client too</h2>
      <p>
        The RPC caps <code>getLogs</code> at 1000 blocks, and Somnia produces blocks fast enough
        that a contract a few hours old is already tens of thousands of blocks back. Reading its
        own history means many windows no matter how tightly the range is bounded.
      </p>
      <p>
        So discovery bounds scans to the factory&rsquo;s own deploy block — there is nothing to
        find before that — and then runs the remaining window reads <strong>concurrently</strong>{" "}
        rather than one at a time. Designing for Ethereum&rsquo;s block rate here would produce a
        page that takes minutes to load.
      </p>

      <div className="docs-callout">
        <strong>Neither half works alone.</strong> On-chain inference with nothing to trade is a
        demo. An on-chain order book with an off-chain model is every other trading bot. The
        combination is what makes &ldquo;the AI made this trade&rdquo; a checkable fact rather than
        a claim.
      </div>
    </>
  );
}
