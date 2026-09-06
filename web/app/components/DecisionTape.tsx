import type { FeedRow } from "../../lib/floor";

const EXPLORER = "https://shannon-explorer.somnia.network";

/**
 * The decision tape — Binance/KuCoin "Market Trades" convention, not a
 * narrative log. That panel carries its whole story in color and numbers:
 * green price = buy, red = sell, right-aligned monospace amounts, a
 * timestamp. No sentence describing the trade ever appears, and nobody
 * finds it confusing — the convention IS the explanation.
 *
 * Ported to what we actually have: a decision is UP (green) or DOWN (red),
 * consensus is a plain fraction (3/3), the gate's verdict is a colored
 * PASS/— mark, price and size are tabular numbers, and the link out is a
 * glyph, not the word "tx". One row per DECISION, not one row per pipeline
 * stage — a real trade tape shows one row per trade, and stacking four rows
 * per event was exactly what read as noise instead of a fact.
 */
export function DecisionTape({ rows, showAgent = true }: { rows: FeedRow[]; showAgent?: boolean }) {
  const decisions = groupByDecision(rows);

  if (decisions.length === 0) {
    return <div className="empty">Nothing yet — a row appears the moment an agent acts.</div>;
  }

  return (
    <div className="tape-wrap">
      <table className="tape">
        <thead>
          <tr>
            <th className="n">Blk</th>
            {showAgent && <th>Agent</th>}
            <th className="tape-side-col">Side</th>
            <th className="n">Consensus</th>
            <th className="n">Price</th>
            <th className="n">Size</th>
            <th className="tape-side-col">Gate</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <tr key={d.requestId} className={d.pending ? "tape-pending" : ""}>
              <td className="n dim">{d.block}</td>
              {showAgent && <td className="tape-agent">{d.agentName}</td>}
              <td>
                <span className={`tape-side ${d.side}`}>{sideGlyph(d.side)}</span>
              </td>
              <td className="n">
                {d.agreeing !== undefined ? (
                  <span className={d.agreeing === d.subcommittee ? "up" : "down"}>
                    {d.agreeing}/{d.subcommittee}
                  </span>
                ) : (
                  <span className="dim">···</span>
                )}
              </td>
              <td className="n">{d.price !== undefined ? d.price.toFixed(3) : "—"}</td>
              <td className="n">{d.quantity !== undefined ? d.quantity : "—"}</td>
              <td>
                {d.gatePassed === undefined ? (
                  <span className="dim">···</span>
                ) : (
                  <span className={`tape-mark ${d.gatePassed ? "up" : "down"}`}>
                    {d.gatePassed ? "✓" : "✕"}
                  </span>
                )}
              </td>
              <td className="tape-link">
                {d.tx && (
                  <a href={`${EXPLORER}/tx/${d.tx}`} target="_blank" rel="noreferrer" title={d.tx}>
                    ↗
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sideGlyph(side: DecisionRow["side"]) {
  if (side === "up") return "▲ UP";
  if (side === "down") return "▼ DOWN";
  if (side === "abstain") return "· ABSTAIN";
  return "···";
}

interface DecisionRow {
  requestId: string;
  block: number;
  agentName: string;
  side: "up" | "down" | "abstain" | "pending";
  agreeing?: number;
  subcommittee?: number;
  price?: number;
  quantity?: number;
  gatePassed?: boolean;
  tx?: string;
  pending: boolean;
}

/** Fold every stage row of one decision (asked/verdict/gate/order/…) into one. */
function groupByDecision(rows: FeedRow[]): DecisionRow[] {
  const byRequest = new Map<string, DecisionRow>();

  // Oldest first, so later stages correctly overwrite earlier partial state.
  const ordered = [...rows].sort((a, b) => a.block - b.block);

  for (const r of ordered) {
    const key = `${r.agent}:${r.requestId}`;
    const existing = byRequest.get(key);
    const d: DecisionRow = existing ?? {
      requestId: key,
      block: r.block,
      agentName: r.agentName ?? r.agent.slice(0, 8),
      side: "pending",
      pending: true,
      tx: r.tx,
    };

    d.block = r.block; // last stage's block = most recent activity on this row
    if (r.tx) d.tx = r.tx;

    switch (r.stage) {
      case "verdict":
        d.agreeing = r.agreeing;
        d.subcommittee = r.subcommittee;
        d.side =
          r.verdictLabel === "BUY_UP" ? "up" : r.verdictLabel === "BUY_DOWN" ? "down" : "abstain";
        break;
      case "gate":
        d.gatePassed = r.gatePassed;
        if (r.gatePassed) {
          d.price = r.price;
          d.quantity = r.quantity;
        }
        break;
      case "order":
        d.price = r.price;
        d.quantity = r.quantity;
        d.pending = false;
        break;
      case "settled":
      case "expired":
      case "failed":
        d.pending = false;
        break;
    }

    byRequest.set(key, d);
  }

  return [...byRequest.values()].sort((a, b) => b.block - a.block);
}
