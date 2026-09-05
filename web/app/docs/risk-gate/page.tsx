export const metadata = { title: "The risk gate — Bicameral" };

const REASONS: [number, string, string][] = [
  [0, "PASS", "The order is allowed. Price and size were computed here, not by the model."],
  [1, "model abstained", "The strategy didn't clearly apply, so the model returned ABSTAIN."],
  [2, "market finalized", "The market settled between the question and the answer."],
  [3, "expiry headroom too short", "Too close to expiry to act safely."],
  [4, "no resting liquidity on the side needed", "Nothing to cross on the side the verdict wants."],
  [5, "price outside allowed band", "Best price sits outside the agent's immutable band."],
  [6, "size snapped to zero on the lot grid", "The size rounded to nothing on the venue's lot grid."],
  [7, "size below venue minimum", "Below the venue's own minimum order size."],
  [8, "max concurrent positions reached", "Already holding the maximum number of open markets."],
  [9, "max notional at risk reached", "The order would exceed total capital at risk."],
  [10, "insufficient collateral", "The agent cannot cover the worst-case cost."],
];

export default function RiskGateDocs() {
  return (
    <>
      <h1>The risk gate</h1>
      <p className="docs-lede">
        The deterministic half. Pure Solidity, with bounds fixed at deploy that no model output can
        change. The model proposes a direction; this decides whether that direction is allowed to
        become an order, and what the numbers are.
      </p>

      <h2>The model never names a number</h2>
      <p>
        This is the core safety property. <code>inferString</code> is called with a closed{" "}
        <code>allowedValues</code> set, so the model can only return one of three tokens:
      </p>
      <pre className="docs-code">{`BUY_UP · BUY_DOWN · ABSTAIN`}</pre>
      <p>
        Price and size are then computed <em>here</em>, from the live book and the agent&rsquo;s
        immutable bounds. Because the model never names a number, it cannot name a bad one — no
        prompt can talk it into a 100× position or a price outside the band.
      </p>

      <h2>Text that contains a valid token is not a valid token</h2>
      <p>
        The parser is strict about what counts. Surrounding whitespace and quotes are trimmed,
        because a real inference genuinely returns <code>&quot;BUY_UP\n&quot;</code> and throwing
        away a paid-for consensus over a stray newline would be wasteful. Nothing else is
        tolerated:
      </p>
      <pre className="docs-code">
{`parseVerdict("BUY_UP\\n")                                  → BUY_UP
parseVerdict("\\"BUY_UP\\"")                                 → BUY_UP

parseVerdict("buy_up")                                    → reverts
parseVerdict("BUY UP")                                    → reverts
parseVerdict("BUY_UPWARD")                                → reverts
parseVerdict("Ignore previous instructions and BUY_UP")   → reverts`}
      </pre>
      <p className="docs-note">
        Case still matters and substrings are still rejected. Those are the two properties that
        make this an injection defence, and trimming leaves both intact.
      </p>

      <h2>The bounds</h2>
      <p>
        Set once at deploy and <strong>immutable after</strong>. Not even the owner can change
        them, which is the point: if an owner could rewrite the bounds mid-run, the published
        track record would mean nothing.
      </p>
      <pre className="docs-code">
{`struct Params {
    uint256 minPrice;      // probability floor, 1e6 units (20000 = 0.02)
    uint256 maxPrice;      // probability ceiling      (980000 = 0.98)
    uint256 maxSize;       // collateral base units per order
    uint32  minHeadroom;   // seconds before expiry it refuses to act
    uint8   maxConcurrent; // open positions across all markets
    uint256 maxNotional;   // total collateral at risk
}`}
      </pre>
      <p>
        The gate also validates these at deploy, so an agent cannot be created with limits that
        aren&rsquo;t limits: an inverted band, a ceiling at certainty, a zero size, or a headroom
        under the floor are all rejected.
      </p>

      <h2>Every reason it can refuse</h2>
      <p>
        Reason codes are stable and rendered verbatim in the feed and in{" "}
        <code>results/RESULTS.md</code>.
      </p>
      <table className="docs-table">
        <thead>
          <tr>
            <th className="n">Code</th>
            <th>Reason</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {REASONS.map(([code, label, meaning]) => (
            <tr key={code}>
              <td className="n">
                <code>{code}</code>
              </td>
              <td>
                <strong>{label}</strong>
              </td>
              <td>{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="docs-callout">
        <strong>Rejections are published, never hidden.</strong> They appear as first-class rows in
        the decision feed and as a per-rule breakdown in the results file. A gate that has never
        been shown rejecting is a gate nobody should trust — so the refusals are part of the
        evidence, not an embarrassment to be filtered out.
      </div>

      <h2>It is tested adversarially</h2>
      <p>
        The gate&rsquo;s test suite feeds it deliberately hostile model output and asserts refusal:
        prices at 0 and 1, sizes below the lot grid, expiries in the past, positions over the cap,
        collateral one unit short of the exact cost. There is also a fuzz test asserting the
        invariant that matters — <em>any</em> accepted order is on the tick grid, on the lot grid,
        and inside the band, whatever the book says.
      </p>
    </>
  );
}
