import Link from "next/link";
import { notFound } from "next/navigation";
import { getWindow, getMarketFeed, cadenceLabel } from "../../../lib/floor";
import { Countdown } from "../../Countdown";
import { DecisionTape } from "../../components/DecisionTape";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPLORER = "https://shannon-explorer.somnia.network";

export default async function WindowDetail({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;
  const w = await getWindow(marketId);
  if (!w) notFound();

  // Every decision that touched THIS market — queried directly by marketId,
  // not filtered out of the global recent-N feed, which would silently miss
  // this market's own history once enough other activity pushed it out.
  const feed = await getMarketFeed(marketId).catch(() => []);

  const up = w.bestAsk;
  const down = w.bestBid !== undefined ? 1 - w.bestBid : undefined;
  const spread = w.bestAsk !== undefined && w.bestBid !== undefined ? w.bestAsk - w.bestBid : undefined;
  const pct = up !== undefined ? Math.max(2, Math.min(98, up * 100)) : null;

  return (
    <div className="wrap">
      <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
        <div>
          <p className="sub" style={{ marginBottom: 10 }}>
            <Link href="/windows">← all windows</Link>
          </p>
          <h1>
            {w.asset} {cadenceLabel(w.intervalSec)}
          </h1>
          <p>
            Will {w.asset} be up at the end of this {cadenceLabel(w.intervalSec)} window? Up and
            Down share one book; the price is the market&rsquo;s implied probability that Up wins.
          </p>
          <p>
            <a
              className="addr"
              href={`${EXPLORER}/address/${w.pool}`}
              target="_blank"
              rel="noreferrer"
            >
              pool {w.pool}
            </a>
          </p>
        </div>
        <div className="hero-stat">
          <span className="n">
            <Countdown to={w.expiry} />
          </span>
          <span className="l">to expiry</span>
        </div>
      </header>

      <section>
        <h2>At a glance</h2>
        <div className="stat-row">
          <span className={`tag ${w.tradable ? "live" : "warn"}`}>
            {w.finalized ? "FINALIZED" : w.tradable ? "TRADING" : "CLOSING"}
          </span>
          <span className="tag tag-up">Up {up !== undefined ? up.toFixed(3) : "—"}</span>
          <span className="tag tag-down">Down {down !== undefined ? down.toFixed(3) : "—"}</span>
          <span className="tag">spread {spread !== undefined ? spread.toFixed(3) : "—"}</span>
          <span className="tag">{cadenceLabel(w.intervalSec)} cadence</span>
        </div>

        {pct !== null && (
          <div style={{ marginTop: 22 }}>
            <span className="probbar" style={{ height: 10 }}>
              <span className="probbar-up" style={{ width: `${pct}%` }} />
            </span>
          </div>
        )}
      </section>

      <section>
        <h2>Order book</h2>
        <p className="sub">
          Quoted in Up terms, deepest levels shown. Crossing a bid with an opposite-side buy mints
          a fresh Up/Down pair, so two disagreeing traders can fill each other with no seller and
          no inventory.
        </p>

        {w.bids.length === 0 && w.asks.length === 0 ? (
          <div className="empty">No resting liquidity on either side of this book yet.</div>
        ) : (
          <div className="mkt-wrap">
            <table className="mkt" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th className="n">Bid size</th>
                  <th className="n">Bid</th>
                  <th className="n">Ask</th>
                  <th className="n">Ask size</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(w.bids.length, w.asks.length) }).map((_, i) => (
                  <tr key={i}>
                    <td className="n dim">{w.bids[i] ? w.bids[i].quantity : ""}</td>
                    <td className="n up">{w.bids[i] ? w.bids[i].price.toFixed(3) : ""}</td>
                    <td className="n down">{w.asks[i] ? w.asks[i].price.toFixed(3) : ""}</td>
                    <td className="n dim">{w.asks[i] ? w.asks[i].quantity : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Decisions</h2>
        <DecisionTape rows={feed} showMarket={false} />
      </section>

      <footer>
        marketId <code>{w.marketId}</code> · Somnia Shannon testnet (chain 50312)
      </footer>
    </div>
  );
}
