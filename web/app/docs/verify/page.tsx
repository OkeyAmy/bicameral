export const metadata = { title: "Verify it yourself — Bicameral" };

export default function VerifyDocs() {
  return (
    <>
      <h1>Verify it yourself</h1>
      <p className="docs-lede">
        The whole point of moving the loop on-chain is that you don&rsquo;t have to take any of
        this on faith. Every number on this site is re-derivable from a public RPC, by you, without
        asking us for anything.
      </p>

      <h2>Run it with an empty .env</h2>
      <p>
        Every read this project depends on is <strong>keyless</strong>. No private key, no API key,
        no account:
      </p>
      <pre className="docs-code">
{`pnpm install
pnpm build:contracts   # compiles the vendored DreamDEX interface + the agent
pnpm test:contracts    # the risk-gate and adapter suites
pnpm discover          # every live Event Contract window, from chain logs
pnpm preflight         # verifies every on-chain read the agent makes
pnpm web               # this site, at localhost:3000`}
      </pre>
      <p>
        <code>discover</code> reads <code>MarketCreated</code> logs directly, so it works even when
        the venue&rsquo;s indexer is down. This site uses that same keyless path — the SDK requires
        a private key at construction, and a public web server must not hold one.
      </p>

      <h2>What preflight proves</h2>
      <p>
        The official DreamDEX template flags one struct as unconfirmed:{" "}
        <em>&ldquo;the one struct to double-check against the live ABI before you rely on it is{" "}
        <code>OrderBookLevel</code>.&rdquo;</em>
      </p>
      <p>
        Checking that the values merely look plausible is not enough — if{" "}
        <code>price</code> and <code>quantity</code> were transposed, both are plausible{" "}
        <code>uint256</code> and both can land inside a valid range. The discriminator is
        monotonicity, so that is what gets asserted:
      </p>
      <pre className="docs-code">
{`ok   every level has 0 < price < 1e6 and quantity >= 0
ok   price arrays are monotonic by side — field 0 really is price, not quantity
ok   best bid 331000 < best ask 357000 — book is not crossed
ok   OrderBookLevel layout CONFIRMED: (price, quantity)`}
      </pre>
      <p className="docs-note">
        Bid prices must descend and ask prices must ascend. That only holds if field 0 is really
        price. Quantities have no reason to be ordered, and observably are not.
      </p>

      <h2>Rebuild the evidence</h2>
      <pre className="docs-code">
{`pnpm index    # chain logs → results/receipts.jsonl
pnpm verify   # re-derive every published number from a public RPC`}
      </pre>
      <p>
        <code>verify</code> never trusts the file it reads. For every row claiming an order, it
        fetches that transaction from the chain and checks the agent really sent it and the decoded
        arguments really match what was published. It asserts that a row claiming a gate pass
        carries an order and a row claiming a rejection does not, and that no row claims more
        agreeing validators than the subcommittee that actually ran.
      </p>
      <p>
        It exits non-zero on any mismatch, and writes <code>results/RESULTS.md</code> in the same
        pass — so a number in the results file that this script cannot re-derive cannot exist.
      </p>

      <h2>What gets published</h2>
      <ul>
        <li>decisions attempted and completed end to end</li>
        <li>consensus rate, with every timeout and disagreement listed</li>
        <li>gate rejections, broken down by rule</li>
        <li>latency as median and p95, measured from block timestamps</li>
        <li>every DreamDEX transaction hash</li>
        <li>realized P&amp;L, including the losses</li>
      </ul>
      <p>
        Counts and percentiles only — never &ldquo;fast&rdquo;, never &ldquo;reliable&rdquo;. A
        curated record would defeat the entire point of building it this way.
      </p>

      <div className="docs-callout">
        <strong>Nothing is hardcoded, so nothing can be quietly stale.</strong> No asset list, no
        cadence list, no pool addresses, no market ids. If the venue lists something new it shows
        up here on its own — and if the venue stops running something, it disappears. What you see
        is what the chain says.
      </div>
    </>
  );
}
