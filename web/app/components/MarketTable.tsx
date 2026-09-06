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
 * The outcome cell is Polymarket's convention, not a sparkline or a bar: two
 * bold pill buttons, UP and DOWN, the live probability printed directly ON
 * each one. That reads at a glance in a way a thin progress bar doesn't —
 * Polymarket puts the number on the button because that IS the market, and
 * green-for-yes/red-for-no is already the exact convention used everywhere
 * else on this site, so nothing new has to be learned to read it here.
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
            <th className="mkt-outcomes-col">Outcome</th>
            <th className="n">Spread</th>
            <th className="n">Bid</th>
            <th className="n">Ask</th>
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

            return (
              <tr key={w.marketId}>
                <td className="mkt-rank">{i + 1}</td>

                <td>
                  <Link className="mkt-link" href={`/windows/${w.marketId}`}>
                    <span className="mkt-name">{w.asset}</span>
                    <span className="mkt-cadence">{cadenceLabel(w.intervalSec)}</span>
                  </Link>
                </td>

                <td className="mkt-outcomes-col">
                  {up === undefined && down === undefined ? (
                    <span className="mkt-empty">no resting liquidity</span>
                  ) : (
                    <Link href={`/windows/${w.marketId}`} className="outcome-pair">
                      <span className="outcome-btn up">
                        UP {up !== undefined ? up.toFixed(3) : "—"}
                      </span>
                      <span className="outcome-btn down">
                        DOWN {down !== undefined ? down.toFixed(3) : "—"}
                      </span>
                    </Link>
                  )}
                </td>

                <td className="n dim">{spread !== undefined ? spread.toFixed(3) : "—"}</td>
                <td className="n dim">{w.bidDepth ?? "0"}</td>
                <td className="n dim">{w.askDepth ?? "0"}</td>

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
