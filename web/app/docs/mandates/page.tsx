import Link from "next/link";

export const metadata = { title: "Mandates — Bicameral" };

export default function MandatesDocs() {
  return (
    <>
      <h1>Mandates</h1>
      <p className="docs-lede">
        A mandate is a filter over whatever the venue is currently listing — not a fixed list of
        markets. It is why an agent deployed today can trade a market that didn&rsquo;t exist when
        it was deployed, with no redeploy and no code change.
      </p>

      <h2>Nothing about the market universe is hardcoded</h2>
      <p>
        No asset list. No cadence list. No pool addresses. No market ids. Discovery reads{" "}
        <code>MarketCreated</code> logs at request time, so the board is whatever DreamDEX happens
        to be running.
      </p>
      <p>This is not a theoretical benefit. It was observed within a day:</p>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Measured</th>
            <th>What the venue was running</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-09-04</td>
            <td>BTC and ETH, at 1h and 4h cadences</td>
          </tr>
          <tr>
            <td>2026-09-05</td>
            <td>
              the same, <strong>plus 24h and 1080h</strong> — which appeared on the board on their
              own
            </td>
          </tr>
        </tbody>
      </table>
      <p className="docs-note">
        The examples in the docs and starter code suggest 15-minute windows. None were live. That
        is exactly why none of it is written down in the source.
      </p>

      <h2>The shape</h2>
      <pre className="docs-code">
{`struct Mandate {
    bytes32[] assets;    // empty = any asset
    uint32[]  cadences;  // empty = any cadence
    bytes32[] venues;    // empty = any venue
}`}
      </pre>
      <p>
        An empty array means &ldquo;any&rdquo;. So{" "}
        <em>&ldquo;only 15-minute BTC&rdquo;</em> and <em>&ldquo;everything that&rsquo;s
        live&rdquo;</em> are the same contract with different mandate bytes — no branching, no
        per-asset code.
      </p>
      <p>
        Each cycle the filter is re-resolved against the live market list, the on-chain status is
        confirmed, and surviving windows are handed to <code>openWindow</code>. The mandate is
        immutable after deploy, for the same reason the risk bounds are: a mutable mandate would
        make the published record meaningless.
      </p>

      <h2>What about markets the venue doesn&rsquo;t list?</h2>
      <p>
        Someone will want SOL, or an election, or a sports result. Mandates only work over markets
        that <strong>exist</strong> — we cannot mint markets, only the venue can, and the honest
        answer is not to fake one.
      </p>
      <p>
        So <Link href="/requests">the requests board</Link> is designed to collect that demand:
        name a market you wish existed, others upvote, ranked by votes. It is a signal pointed at
        the venue. If DreamDEX lists it, every open-mandate agent starts trading it immediately and
        automatically — which is the whole payoff of building mandates this way.
      </p>
      <p className="docs-note">
        The board itself is staged (its current page reads &ldquo;COMING SOON&rdquo;), but the
        mechanism is fully intended: a JSON file, one vote per browser by cookie, not
        identity-verified, and it says so on the page. It is a demand signal, not the product.
      </p>
    </>
  );
}
