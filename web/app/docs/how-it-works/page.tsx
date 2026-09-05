import Link from "next/link";

export const metadata = { title: "How a decision happens — Bicameral" };

const EXPLORER = "https://shannon-explorer.somnia.network";

export default function HowItWorks() {
  return (
    <>
      <h1>How a decision happens</h1>
      <p className="docs-lede">
        One loop, five on-chain steps, no off-chain decision anywhere in it. Every step emits an
        event, which is why the whole record can be rebuilt from logs by anyone.
      </p>

      <h2>1 · Someone pokes the agent</h2>
      <p>
        <code>openWindow(marketId)</code> is <strong>permissionless</strong>. A keeper calls it
        every cycle, but the keeper holds no authority: it cannot trade, cannot move collateral,
        and cannot change a strategy. Anyone can call it — including you — and the agent behaves
        identically.
      </p>
      <p>
        That is what &ldquo;no server makes a decision&rdquo; means precisely. There <em>is</em> a
        keeper process; it just has nothing to decide.
      </p>

      <h2>2 · The contract reads the live book</h2>
      <p>
        Before asking anything, the contract reads the current order book, the tick and lot grid,
        and the market&rsquo;s own expiry — all on-chain, from the pool itself. It refuses
        immediately if the market is finalized or too close to expiry.
      </p>
      <p>
        It then renders that state into a compact prompt. Deliberately numeric: the venue&rsquo;s
        own question text is documented as unstable across releases, so nothing here parses prose.
        The model sees prices, depth and time.
      </p>
      <pre className="docs-code">
{`up_bids=[0.877@200000000,0.869@330000000,0.863@460000000]
up_asks=[0.900@200000000,0.908@330000000,0.918@460000000]
mid_up=0.888 spread=0.023 seconds_to_expiry=1695
(prices are probability that UP wins, 0..1)`}
      </pre>
      <p className="docs-note">
        That is the real prompt body from the first live decision, taken from the{" "}
        <code>WindowOpened</code> event.
      </p>

      <h2>3 · Validators run the model and must agree</h2>
      <p>
        The contract calls Somnia&rsquo;s LLM Inference agent with the user&rsquo;s strategy, the
        market state, and a <strong>closed set of allowed answers</strong>:
      </p>
      <pre className="docs-code">{`BUY_UP · BUY_DOWN · ABSTAIN`}</pre>
      <p>
        Three validators each run the model independently. The answer is only accepted if enough of
        them agree. The result is delivered back to the contract in{" "}
        <code>handleResponse</code>, which checks that the caller really is the agent platform and
        that the request is one it actually made.
      </p>
      <p>
        An unreadable answer is <em>published</em>, not discarded — it emits{" "}
        <code>VerdictUnparseable</code>. The inference was already paid for; a decision that
        vanishes from the record would be worse than one recorded as unreadable.
      </p>

      <h2>4 · The gate decides whether that answer becomes an order</h2>
      <p>
        The verdict goes through <Link href="/docs/risk-gate">the risk gate</Link>: pure Solidity,
        with bounds fixed at deploy that no model output can change. The gate re-reads the book
        (state moves between the question and the answer) and computes the price and size itself.
      </p>
      <p>
        If it refuses, that refusal is emitted and shown publicly. If it passes, the same
        transaction places the order on the DreamDEX pool.
      </p>

      <h2>5 · Settlement</h2>
      <p>
        After expiry, <code>settleAndRedeem(marketId)</code> — also permissionless — claims the
        winning outcome tokens back to collateral. Voided markets pay both sides at 0.5, so it
        redeems both rather than stranding half the position.
      </p>

      <h2>What it looks like on-chain</h2>
      <p>
        The first live decision, in nine blocks, start to finish. These are the actual events:
      </p>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>What it recorded</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>WindowOpened</code>
            </td>
            <td>book snapshot above, request id, 60s deadline</td>
          </tr>
          <tr>
            <td>
              <code>VerdictReceived</code>
            </td>
            <td>
              <strong>3 of 3</strong> validators agreed → <code>BUY_DOWN</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>GateDecision</code>
            </td>
            <td>
              reason <code>0</code> (PASS) → price 0.880, size 5
            </td>
          </tr>
          <tr>
            <td>
              <code>OrderPlaced</code>
            </td>
            <td>real order on the DreamDEX pool</td>
          </tr>
          <tr>
            <td>
              <code>Fueled</code>
            </td>
            <td>0.0248 STT rebated automatically by the platform</td>
          </tr>
        </tbody>
      </table>
      <p>
        The strategy was <em>&ldquo;fade the crowd: if Up is above 0.80, buy Down.&rdquo;</em> The
        book showed Up asks at 0.900–0.918. It bought Down. The reasoning holds up against the
        input.
      </p>
      <p>
        <a
          href={`${EXPLORER}/tx/0xf065de39798856d9884a4da0e2d393810254c675544624703712d304479d1768`}
          target="_blank"
          rel="noreferrer"
        >
          The opening transaction ↗
        </a>
      </p>
    </>
  );
}
