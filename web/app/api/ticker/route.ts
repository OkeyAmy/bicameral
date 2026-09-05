import { NextResponse } from "next/server";
import { getFeed, getWindows } from "../../../lib/floor";

export const dynamic = "force-dynamic";

export interface TickerItem {
  /** Short label, e.g. "fade-extremes" or "BTC 1h". */
  who: string;
  /** What happened, e.g. "3/3 agreed → BUY_DOWN". */
  what: string;
  /** "pass" | "reject" | "pending" | "market" — drives the dot colour. */
  tone: "pass" | "reject" | "pending" | "market";
  href?: string;
}

const EXPLORER = "https://shannon-explorer.somnia.network";

/**
 * Stale-while-revalidate.
 *
 * The ticker sits on every route, and building it means a full log scan (~7s
 * against a chain this fast). A plain TTL cache is the wrong shape here: the
 * client polls on an interval, so any TTL shorter than that interval is never
 * hit, and every poll pays the full scan.
 *
 * So: once there is anything cached, serve it IMMEDIATELY and refresh in the
 * background. A ticker whose job is "show that something is alive" would rather
 * be 30 seconds stale and instant than perfectly fresh and blocking.
 */
let cache: { at: number; items: TickerItem[] } | null = null;
let refreshing: Promise<TickerItem[]> | null = null;
const STALE_MS = 30_000;

export async function GET() {
  if (cache) {
    // Kick off a refresh if the copy we're about to serve is old, but don't
    // wait for it — this response goes out now either way.
    if (Date.now() - cache.at > STALE_MS && !refreshing) {
      refreshing = build()
        .then((items) => {
          cache = { at: Date.now(), items };
          return items;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return NextResponse.json({ items: cache.items, cached: true });
  }

  // Cold start: nothing to serve yet, so this one has to wait.
  const items = await build();
  cache = { at: Date.now(), items };
  return NextResponse.json({ items, cached: false });
}

async function build(): Promise<TickerItem[]> {
  const items: TickerItem[] = [];

  try {
    const [feed, { windows }] = await Promise.all([
      getFeed(14).catch(() => []),
      getWindows().catch(() => ({ windows: [] as any[], head: 0n })),
    ]);

    for (const r of feed) {
      let what: string;
      let tone: TickerItem["tone"] = "pending";

      switch (r.stage) {
        case "asked":
          what = "asked the on-chain LLM";
          break;
        case "verdict":
          what = `${r.agreeing}/${r.subcommittee} agreed → ${r.verdictLabel}`;
          tone = "pass";
          break;
        case "gate":
          what = r.gatePassed ? `gate PASS @ ${r.price?.toFixed(3)}` : `gate REJECT · ${r.gateLabel}`;
          tone = r.gatePassed ? "pass" : "reject";
          break;
        case "order":
          what = `order filled ${r.quantity} @ ${r.price?.toFixed(3)}`;
          tone = "pass";
          break;
        case "settled":
          what = "settled and redeemed";
          tone = "pass";
          break;
        case "expired":
          what = "request timed out";
          tone = "reject";
          break;
        case "failed":
          what = "no consensus reached";
          tone = "reject";
          break;
        default:
          continue;
      }

      items.push({
        who: r.agentName ?? `${r.agent.slice(0, 10)}…`,
        what,
        tone,
        href: r.tx ? `${EXPLORER}/tx/${r.tx}` : undefined,
      });
    }

    // Live markets keep the ticker moving even before any agent has acted —
    // an empty ticker on a fresh deployment would read as broken.
    for (const w of windows.slice(0, 6)) {
      const cadence =
        w.intervalSec % 3600 === 0
          ? `${w.intervalSec / 3600}h`
          : `${Math.round(w.intervalSec / 60)}m`;
      items.push({
        who: `${w.asset} ${cadence}`,
        what: w.emptyBook
          ? "open · no resting liquidity"
          : `UP ${w.bestAsk?.toFixed(3) ?? "—"} / DOWN ${w.bestBid ? (1 - w.bestBid).toFixed(3) : "—"}`,
        tone: "market",
        href: `${EXPLORER}/address/${w.pool}`,
      });
    }
  } catch {
    /* a broken ticker must never take a page down with it */
  }

  return items;
}
