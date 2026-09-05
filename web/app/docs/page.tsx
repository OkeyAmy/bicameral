import Link from "next/link";

export const metadata = { title: "Docs — Bicameral" };

export default function DocsOverview() {
  return (
    <>
      <h1>Bicameral</h1>
      <p className="docs-lede">
        A trading agent that lives entirely inside a smart contract. The prompt, the LLM call, the
        decision, and the DreamDEX order all happen on-chain, in validator consensus. There is no
        server, no bot process, and no key anywhere that can trade.
      </p>

      <h2>The problem</h2>
      <p>
        Every other &ldquo;AI trading agent&rdquo; is a process on somebody&rsquo;s laptop that
        posts its conclusions to a chain. You can see the trades. You cannot see:
      </p>
      <ul>
        <li>what the model was actually asked,</li>
        <li>whether the published record was cherry-picked,</li>
        <li>whether a human quietly stepped in on the bad days.</li>
      </ul>
      <p>
        Every trust guarantee is social. You are trusting their server, and there is nothing you
        can check.
      </p>

      <h2>The approach</h2>
      <p>
        Move the whole loop on-chain. The strategy is stored in the contract as plain English.
        When a window opens, the contract reads the live order book, asks Somnia&rsquo;s on-chain
        LLM, and three validators independently run the same model and must agree before the
        answer is accepted. A deterministic Solidity gate then decides whether that answer is
        allowed to become an order, and the same transaction places it on DreamDEX.
      </p>
      <p>
        The name is the architecture: <strong>two chambers</strong>. The model proposes, Solidity
        disposes. The model picks a direction and nothing else — never a price, never a size — so
        it cannot name a bad number.
      </p>

      <div className="docs-callout">
        <strong>Everything on this site is re-derivable.</strong> Nothing is cached in a database
        we control, and nothing about the market universe is hardcoded. See{" "}
        <Link href="/docs/verify">Verify it yourself</Link>.
      </div>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/how-it-works">How a decision happens</Link> — the loop, event by event,
          with the real transaction from the first live run.
        </li>
        <li>
          <Link href="/docs/risk-gate">The risk gate</Link> — the eleven reasons an agent refuses
          to trade, and why refusals are published.
        </li>
        <li>
          <Link href="/docs/mandates">Mandates</Link> — how an agent trades markets that
          didn&rsquo;t exist when it was deployed.
        </li>
        <li>
          <Link href="/docs/platform">What Somnia provides</Link> — the host primitives this is
          built on.
        </li>
      </ul>

      <h2>The pages</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Page</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Link href="/">Floor</Link>
            </td>
            <td>The landing page and the live market board.</td>
          </tr>
          <tr>
            <td>
              <Link href="/windows">Windows</Link>
            </td>
            <td>
              Every tradable Event Contract right now. Each market has its own page with a deep
              book and the agent decisions taken on it.
            </td>
          </tr>
          <tr>
            <td>
              <Link href="/agents">Agents</Link>
            </td>
            <td>
              The roster, ranked by decisions made rather than claimed returns. Each agent has its
              own page with its full public record.
            </td>
          </tr>
          <tr>
            <td>
              <Link href="/requests">Requests</Link>
            </td>
            <td>
              A demand board for markets the venue doesn&rsquo;t list yet. Deliberately off-chain.
            </td>
          </tr>
          <tr>
            <td>
              <Link href="/deploy">Deploy</Link>
            </td>
            <td>The only wallet-gated page. Write a strategy in English and launch an agent.</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
