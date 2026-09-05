import Link from "next/link";
import { Countdown } from "../Countdown";
import type { WindowView } from "../../lib/floor";
import { cadenceLabel } from "../../lib/floor";

/**
 * The open-windows board, as a dense market table.
 *
 * Shaped like a CoinGecko/CoinMarketCap listing: column headers, one row per
 * market, numerics right-aligned on tabular figures so digits line up down the
 * column, and the venue's own action at the end of the row.
 *
 * Where those tables put a 7-day sparkline, this puts an implied-probability
 * bar. A binary Event Contract has no price history to draw — it has a single
 * number between 0 and 1 — so the honest visual is the split itself, not a
 * fabricated chart.
 */
export function MarketTable({ windows }: { windows: WindowView[] }) {
  const rows = [...windows].sort(
    (a, b) => a.asset.localeCompare(b.asset) || a.intervalSec - b.intervalSec,
  );

  return (
    <div className="mkt-wrap">
      <table className="mkt">
        <thead>
          <tr>
            <th className="mkt-rank">#</th>
            <th>Market</th>
            <th className="n">Up</th>
            <th className="n">Down</th>
            <th className="n">Spread</th>
            <th className="n">Bid</th>
            <th className="n">Ask</th>
            <th className="mkt-prob">Implied probability</th>
            <th className="n">Closes in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((w, i) => {
            const up = w.bestAsk;
            const down = w.bestBid !== undefined ? 1 - w.bestBid : undefined;
            const spread =
              w.bestAsk !== undefined && w.bestBid !== undefined
                ? w.bestAsk - w.bestBid
                : undefined;
            const pct = up !== undefined ? Math.max(2, Math.min(98, up * 100)) : null;

            return (
              <tr key={w.marketId}>
                <td className="mkt-rank">{i + 1}</td>

                <td>
                  <Link className="mkt-link" href={`/windows/${w.marketId}`}>
                    <span className="mkt-name">{w.asset}</span>
                    <span className="mkt-cadence">{cadenceLabel(w.intervalSec)}</span>
                  </Link>
                </td>

                <td className="n up">{up !== undefined ? up.toFixed(3) : "—"}</td>
                <td className="n down">{down !== undefined ? down.toFixed(3) : "—"}</td>
                <td className="n dim">{spread !== undefined ? spread.toFixed(3) : "—"}</td>
                <td className="n dim">{w.bidDepth ?? "0"}</td>
                <td className="n dim">{w.askDepth ?? "0"}</td>

                <td className="mkt-prob">
                  {pct === null ? (
                    <span className="mkt-empty">no resting liquidity</span>
                  ) : (
                    <span className="probbar" title={`UP ${up!.toFixed(3)}`}>
                      <span className="probbar-up" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </td>

                <td className="n mkt-clock">
                  <Countdown to={w.expiry} />
                </td>

                <td className="mkt-act">
                  <Link className={`tag ${w.tradable ? "live" : "warn"}`} href={`/windows/${w.marketId}`}>
                    {w.tradable ? "TRADING" : "CLOSING"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
