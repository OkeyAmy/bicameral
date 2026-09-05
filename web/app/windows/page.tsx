import { getWindows, cadenceLabel } from "../../lib/floor";
import { MarketTable } from "../components/MarketTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Windows — Bicameral",
};

export default async function WindowsPage() {
  const { windows } = await getWindows();

  const assets = [...new Set(windows.map((w) => w.asset))].sort();
  const cadences = [...new Set(windows.map((w) => w.intervalSec))].sort((a, b) => a - b);
  const withBook = windows.filter((w) => !w.emptyBook).length;

  return (
    <div className="wrap">
      <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
        <div>
          <h1>Every window the venue is running.</h1>
          <p>
            DreamDEX Event Contracts are binary markets: Up and Down share a single order book, so
            a Down price is always one minus the Up price. Read live from{" "}
            <code>MarketCreated</code> logs, with no key and no indexer.
          </p>
        </div>
        <div className="hero-stat">
          <span className="n">{windows.length}</span>
          <span className="l">live windows</span>
        </div>
      </header>

      <section>
        <div className="stat-row" style={{ borderBottom: 0, paddingLeft: 0 }}>
          <span className="tag">{assets.length ? assets.join(" · ") : "no assets"}</span>
          <span className="tag">
            {cadences.length ? cadences.map(cadenceLabel).join(" · ") : "no cadences"}
          </span>
          <span className="tag live">{withBook} with resting liquidity</span>
        </div>
      </section>

      <section>
        <h2>Open windows</h2>
        <p className="sub">
          Nothing here is a fixed list. Assets and cadences are whatever DreamDEX happens to be
          running, so a newly listed market appears on its own, with no code change on this side.
        </p>

        {windows.length === 0 ? (
          <div className="empty">
            No live windows right now, the venue may be between windows.
            <br />
            Verify independently: <code>pnpm discover</code>
          </div>
        ) : (
          <MarketTable windows={windows} />
        )}
      </section>

      <footer>
        Somnia Shannon testnet (chain 50312) · every row is re-derivable with{" "}
        <code>pnpm discover</code>
      </footer>
    </div>
  );
}
