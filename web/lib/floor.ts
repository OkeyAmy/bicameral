// Server-side data for the public Floor.
//
// KEYLESS BY DESIGN, but not chain-log-only. `SomniaMarkets` (the SDK's write
// class) requires a privateKey at construction, and a public web server must
// not hold one — but the indexer READS this page needs (`listLiveBinaryMarkets`,
// `getBinaryMarket`) are plain functions that only take a public indexer URL;
// see `runner/src/markets.ts`'s `indexerMarketsModule()` for how this file
// avoids the SDK's key-requiring class wrapper to reach them. So this page
// tries the indexer first (`discoverLiveWindows`) and only falls back to raw
// `MarketCreated` chain logs if the indexer itself is unreachable.
//
// That fallback matters because chain logs alone are NOT a full substitute:
// `discoverFromChain`'s log scan only reaches back roughly an hour (fixed
// block-count window on a chain producing blocks this fast), so any window
// older than that — most 4h/24h/1080h cadences — is invisible on that path
// alone. It exists purely as a last resort for "the indexer is down", not as
// this page's primary source, and it also carries no venueId or volume, so
// those columns are absent when it's the one serving the page.
import {
  discoverLiveWindows,
  findMarketCreated,
  findMarketInIndexer,
  cadenceLabel,
  type LiveWindow,
} from "@bicameral/runner/src/markets.js";
import { pub } from "@bicameral/runner/src/config.js";
import { binaryPoolAbi } from "@bicameral/runner/src/abi.js";
import { factoryAbi, traderAbi } from "@bicameral/runner/src/contracts.js";
import { decodeEventLog, pad, type Address } from "viem";

export { cadenceLabel };
export type { LiveWindow };

export interface WindowView extends LiveWindow {
  bestBid?: number;
  bestAsk?: number;
  bidDepth?: string;
  askDepth?: string;
  status?: number;
  tradable: boolean;
  emptyBook: boolean;
}

// ------------------------------------------------------------------- cache
//
// Stale-while-revalidate for the expensive reads below. Every one of these
// ends in a full on-chain log scan (tens of seconds on Somnia's block rate),
// and they run on every page render — so without this a visitor's click comes
// back as a frozen tab and right-click-open-in-new-tab becomes the only way to
// navigate. Same shape as the ticker route: once anything is cached it is
// served instantly and refreshed in the background, so a live page never blocks
// a visitor on a scan it doesn't need to see.
const SWR_STALE_MS = 15_000;
const swrCache = new Map<string, { at: number; value: unknown }>();
const swrInflight = new Map<string, Promise<unknown>>();

async function swr<T>(key: string, build: () => Promise<T>): Promise<T> {
  const hit = swrCache.get(key);

  if (hit) {
    // Serve whatever copy we have IMMEDIATELY — a floor that's 15s behind is
    // alive; a floor that's frozen is dead. If it's old and no refresh is
    // already underway, kick one off in the background and keep the stale copy
    // for this and every concurrent request, so a page with multiple reads
    // never waits on its own refresh.
    if (Date.now() - hit.at >= SWR_STALE_MS && !swrInflight.has(key)) {
      const p = build()
        .then((value) => {
          swrCache.set(key, { at: Date.now(), value });
          return value;
        })
        .catch(() => hit.value)
        .finally(() => {
          swrInflight.delete(key);
        });
      swrInflight.set(key, p);
    }
    return hit.value as T;
  }

  // Cold start: no copy at all, so callers share a single in-flight build
  // instead of each paying their own scan.
  const pending = swrInflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = build()
    .then((value) => {
      swrCache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      swrInflight.delete(key);
    });
  swrInflight.set(key, p);
  return p;
}

/**
 * viem types `eventName` as possibly-undefined when the ABI is a plain `Abi`
 * rather than a const-asserted literal (ours is loaded from Foundry artifacts at
 * runtime, so it cannot be const). One narrow helper instead of casts everywhere.
 */
function decode(abi: any, l: any): { name: string; args: any } | null {
  try {
    const ev = decodeEventLog({ abi, data: l.data, topics: l.topics }) as any;
    return ev?.eventName ? { name: String(ev.eventName), args: ev.args ?? {} } : null;
  } catch {
    return null;
  }
}

const STATUS = ["Listed", "Trading", "Locked", "Settling", "Resolved", "Voided"];
export const statusLabel = (s?: number) => (s === undefined ? "—" : (STATUS[s] ?? "?"));

/** Every live window, with its book. Nothing about assets or cadences is fixed. */
export async function getWindows(): Promise<{ windows: WindowView[]; head: bigint }> {
  return swr("windows", loadWindows);
}

async function loadWindows(): Promise<{ windows: WindowView[]; head: bigint }> {
  const [{ windows: raw }, head] = await Promise.all([discoverLiveWindows(), pub.getBlockNumber()]);

  const windows = await Promise.all(
    raw.map(async (w): Promise<WindowView> => {
      try {
        const [bids, asks, finalized] = await Promise.all([
          pub.readContract({
            address: w.pool,
            abi: binaryPoolAbi,
            functionName: "getBookLevels",
            args: [true, 1n],
          }) as Promise<any[]>,
          pub.readContract({
            address: w.pool,
            abi: binaryPoolAbi,
            functionName: "getBookLevels",
            args: [false, 1n],
          }) as Promise<any[]>,
          pub.readContract({
            address: w.pool,
            abi: binaryPoolAbi,
            functionName: "finalized",
          }) as Promise<boolean>,
        ]);

        const emptyBook = bids.length === 0 && asks.length === 0;
        return {
          ...w,
          bestBid: bids[0] ? Number(bids[0].price) / 1e6 : undefined,
          bestAsk: asks[0] ? Number(asks[0].price) / 1e6 : undefined,
          bidDepth: bids[0] ? String(Number(bids[0].quantity) / 1e6) : undefined,
          askDepth: asks[0] ? String(Number(asks[0].quantity) / 1e6) : undefined,
          status: finalized ? 4 : 1,
          tradable: !finalized && w.secondsLeft > 120,
          emptyBook,
        };
      } catch {
        return { ...w, tradable: false, emptyBook: true };
      }
    }),
  );

  return { windows, head };
}

export interface BookLevel {
  price: number;
  quantity: number;
}

export interface WindowDetail extends WindowView {
  bids: BookLevel[];
  asks: BookLevel[];
  marketContract?: Address;
  finalized: boolean;
  resolved?: boolean;
  voided?: boolean;
}

/**
 * Find one market by id, whether or not it is still live.
 *
 * A live board's `expiry > now` filter is correct for a list of tradable
 * windows, wrong for a permalink — a market's page (and the decision history
 * on it) would 404 the moment it settles, exactly when there is the most to
 * look at. So this checks the live set first (cheap: `discoverLiveWindows()`
 * is already cached by `getWindows()`'s `swr`), then two no-age-limit lookups
 * in order: `findMarketInIndexer` (one keyless indexer read, any age) and only
 * then `findMarketCreated` (a `MarketCreated` chain-log scan, `marketId` being
 * an indexed topic keeps it cheap even over a wide range) if the indexer has
 * no row — e.g. the indexer is down, or briefly hasn't ingested a market that
 * was just created.
 */
async function findMarket(marketId: string): Promise<LiveWindow | null> {
  const { windows: raw } = await discoverLiveWindows();
  const live = raw.find((m) => m.marketId.toLowerCase() === marketId.toLowerCase());
  if (live) return live;

  const id = marketId as `0x${string}`;
  return (await findMarketInIndexer(id)) ?? findMarketCreated(id);
}

/**
 * One market, with a deep book rather than just the top level.
 *
 * `getWindows` reads one level per side because a table row only shows the
 * best bid and ask; a detail page can show the ladder, so this asks for more.
 */
export async function getWindow(marketId: string): Promise<WindowDetail | null> {
  const w = await findMarket(marketId);
  if (!w) return null;

  const levels = (rows: any[]): BookLevel[] =>
    rows.map((l) => ({ price: Number(l.price) / 1e6, quantity: Number(l.quantity) / 1e6 }));

  try {
    const [bids, asks, finalized, params] = await Promise.all([
      pub.readContract({
        address: w.pool,
        abi: binaryPoolAbi,
        functionName: "getBookLevels",
        args: [true, 8n],
      }) as Promise<any[]>,
      pub.readContract({
        address: w.pool,
        abi: binaryPoolAbi,
        functionName: "getBookLevels",
        args: [false, 8n],
      }) as Promise<any[]>,
      pub.readContract({
        address: w.pool,
        abi: binaryPoolAbi,
        functionName: "finalized",
      }) as Promise<boolean>,
      pub
        .readContract({
          address: w.pool,
          abi: binaryPoolAbi,
          functionName: "getBinaryPoolParams",
        })
        .catch(() => null) as Promise<any>,
    ]);

    const b = levels(bids);
    const a = levels(asks);

    return {
      ...w,
      bids: b,
      asks: a,
      bestBid: b[0]?.price,
      bestAsk: a[0]?.price,
      bidDepth: b[0] ? String(b[0].quantity) : undefined,
      askDepth: a[0] ? String(a[0].quantity) : undefined,
      marketContract: params?.market,
      finalized,
      status: finalized ? 4 : 1,
      tradable: !finalized && w.secondsLeft > 120,
      emptyBook: b.length === 0 && a.length === 0,
    };
  } catch {
    return {
      ...w,
      bids: [],
      asks: [],
      finalized: false,
      tradable: false,
      emptyBook: true,
    };
  }
}

// ------------------------------------------------------------------ agents

export interface AgentView {
  address: Address;
  name: string;
  owner: string;
  strategy: string;
  fuel?: number;
  decisions?: number;
  paused?: boolean;
}

const LOG_WINDOW = 1000n;

/**
 * The block our own history could possibly start at — nothing to find before
 * the factory existed, so scans never walk past it. Kept as an env var rather
 * than discovered on every request: a binary-search-for-deploy-block call would
 * itself cost several round-trips on every page load for a number that never
 * changes once set.
 */
function deployFloor(): bigint {
  const v = process.env.FACTORY_DEPLOY_BLOCK;
  return v ? BigInt(v) : 0n;
}

/**
 * How many `getLogs` calls run at once.
 *
 * Somnia is high-throughput enough that block count and wall-clock time part
 * ways fast: the factory's own deploy is under three hours old by the clock,
 * but already ~145,000 blocks back. At the RPC's 1000-block cap that is ~150
 * calls for a contract that new — a number that keeps climbing daily, on any
 * chain this fast, no matter how tightly the block range is bounded. So this
 * batches the calls concurrently rather than trying to shrink the count:
 * correct for the venue's actual throughput instead of assuming Ethereum's.
 */
const SCAN_CONCURRENCY = 25;

async function scan(addresses: Address[], windowsBack: number, topics?: (`0x${string}` | null)[]) {
  if (!addresses.length) return [];
  const head = await pub.getBlockNumber();
  const floor = deployFloor();

  // `floor` is a real anchor, not an estimate — it must always be reached in
  // full, however many windows that takes. `windowsBack` is a cap for when the
  // floor is unknown, not a ceiling on the floor itself.
  //
  // Getting this backwards (Math.min instead of Math.max) is exactly what
  // broke: the factory's own AgentDeployed event silently fell out of every
  // scan the moment the chain grew past windowsBack × 1000 blocks since
  // deploy — a fixed cap turning into a slow-motion outage on a chain this
  // fast, not a one-time bug. Reached in a live incident 2026-09-05: the
  // agent roster read empty hours after it had read correctly, with the
  // agent, the events, and the RPC all unchanged — only elapsed chain height.
  const needed = floor > 0n ? Math.ceil(Number(head - floor) / 1000) + 1 : windowsBack;
  const iterations = floor > 0n ? Math.max(needed, 1) : windowsBack;

  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let i = 0; i < iterations; i++) {
    const to = head - BigInt(i) * LOG_WINDOW;
    if (to <= LOG_WINDOW || to < floor) break;
    ranges.push({ fromBlock: to - (LOG_WINDOW - 1n), toBlock: to });
  }

  // viem's typed `getLogs` has no `topics` parameter at all (only `event` /
  // `events` + `args`, which don't cleanly express "any of these 7 events,
  // filtered on their shared first indexed param") — so a raw `topics` filter
  // goes straight to `eth_getLogs` instead. `l.blockNumber` then arrives as a
  // "0x..." string rather than a bigint, same as every other raw-RPC log
  // already flowing through `decode()` below; `Number("0x...")` parses it fine.
  const out: any[] = [];
  for (let i = 0; i < ranges.length; i += SCAN_CONCURRENCY) {
    const batch = ranges.slice(i, i + SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        topics
          ? (pub.request as any)({
              method: "eth_getLogs",
              params: [
                {
                  address: addresses,
                  topics,
                  fromBlock: `0x${r.fromBlock.toString(16)}`,
                  toBlock: `0x${r.toBlock.toString(16)}`,
                },
              ],
            }).catch(() => [])
          : pub.getLogs({ address: addresses, ...r }).catch(() => []),
      ),
    );
    for (const logs of results) out.push(...logs);
  }
  return out;
}

/** The one factory `/deploy` sends new agents to. */
export function factoryAddress(): Address | null {
  const v = process.env.FACTORY_ADDRESS;
  return v ? (v as Address) : null;
}

/**
 * Every factory this site has ever pointed at — the current one plus any
 * retired ones — so redeploying the factory (to ship a contract fix, say)
 * doesn't erase agents that were live under the old address. `FACTORY_ADDRESS`
 * is always included even if `KNOWN_FACTORIES` forgets to list it.
 */
export function knownFactories(): Address[] {
  const listed = (process.env.KNOWN_FACTORIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Address[];
  const active = factoryAddress();
  return active && !listed.includes(active) ? [...listed, active] : listed;
}

export async function getAgents(): Promise<AgentView[]> {
  return swr("agents", loadAgents);
}

async function loadAgents(): Promise<AgentView[]> {
  const factories = knownFactories();
  if (!factories.length) return [];

  const logs = await scan(factories, 200);
  const agents: AgentView[] = [];

  for (const l of logs) {
    const ev = decode(factoryAbi, l);
    if (!ev || ev.name !== "AgentDeployed") continue;
    agents.push({
      address: ev.args.agent,
      name: ev.args.name,
      owner: ev.args.owner,
      strategy: ev.args.strategy,
    });
  }

  return Promise.all(
    agents.map(async (a) => {
      try {
        const [fuel, decisions, paused] = await Promise.all([
          pub.readContract({
            address: a.address,
            abi: traderAbi,
            functionName: "fuelRemaining",
          }) as Promise<bigint>,
          pub.readContract({
            address: a.address,
            abi: traderAbi,
            functionName: "decisionCount",
          }) as Promise<bigint>,
          pub.readContract({
            address: a.address,
            abi: traderAbi,
            functionName: "paused",
          }) as Promise<boolean>,
        ]);
        return { ...a, fuel: Number(fuel), decisions: Number(decisions), paused };
      } catch {
        return a;
      }
    }),
  );
}

// ----------------------------------------------------------------- decisions

export interface FeedRow {
  agent: Address;
  agentName?: string;
  marketId: string;
  requestId: string;
  block: number;
  stage: "asked" | "verdict" | "gate" | "order" | "settled" | "expired" | "failed";
  verdictLabel?: string;
  agreeing?: number;
  subcommittee?: number;
  gateLabel?: string;
  gatePassed?: boolean;
  price?: number;
  quantity?: number;
  tx?: string;
}

const VERDICTS = ["ABSTAIN", "BUY_UP", "BUY_DOWN"];
const GATE = [
  "PASS",
  "model abstained",
  "market finalized",
  "expiry headroom too short",
  "no resting liquidity",
  "price outside allowed band",
  "size snapped to zero",
  "size below venue minimum",
  "max concurrent positions",
  "max notional at risk",
  "insufficient collateral",
];

export async function getFeed(limit = 60): Promise<FeedRow[]> {
  return swr(`feed:${limit}`, () => loadFeed(limit));
}

async function loadFeed(limit: number): Promise<FeedRow[]> {
  const agents = await getAgents();
  if (!agents.length) return [];

  const names = new Map(agents.map((a) => [a.address.toLowerCase(), a.name]));
  const logs = await scan(
    agents.map((a) => a.address),
    120,
  );

  return decodeFeed(logs, names).slice(0, limit);
}

/**
 * Every decision that ever touched one market, across every agent — not a
 * slice of the global feed filtered client-side.
 *
 * `getFeed(limit)` caps at `limit` MOST RECENT rows across ALL agents and
 * markets combined, so a market's own history can silently fall out of that
 * cap the moment enough *other* activity happens elsewhere on the board —
 * exactly the failure a window's own detail page cannot afford, since that
 * page's whole job is to answer "what happened here". `marketId` is an
 * indexed topic on every one of `BicameralTrader`'s decision events (same
 * position, first indexed param, on all seven) — passing it as `topics[1]`
 * with `topics[0]` left open lets the node filter server-side for this one
 * market regardless of which event fired, the same trick `findMarketCreated`
 * uses for `MarketCreated`.
 */
export async function getMarketFeed(marketId: string): Promise<FeedRow[]> {
  return swr(`market-feed:${marketId.toLowerCase()}`, () => loadMarketFeed(marketId));
}

async function loadMarketFeed(marketId: string): Promise<FeedRow[]> {
  const agents = await getAgents();
  if (!agents.length) return [];

  const names = new Map(agents.map((a) => [a.address.toLowerCase(), a.name]));
  const logs = await scan(
    agents.map((a) => a.address),
    120,
    [null, pad(marketId as `0x${string}`, { size: 32 }).toLowerCase() as `0x${string}`],
  );

  return decodeFeed(logs, names);
}

function decodeFeed(logs: any[], names: Map<string, string>): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const l of logs) {
    const ev = decode(traderAbi, l);
    if (!ev) continue;
    const args = ev.args;
    const base = {
      agent: l.address as Address,
      agentName: names.get(String(l.address).toLowerCase()),
      marketId: args.marketId ?? "",
      requestId: String(args.requestId ?? ""),
      block: Number(l.blockNumber),
      tx: l.transactionHash ?? undefined,
    };

    switch (ev.name) {
      case "WindowOpened":
        rows.push({ ...base, stage: "asked" });
        break;
      case "VerdictReceived":
        rows.push({
          ...base,
          stage: "verdict",
          verdictLabel: VERDICTS[Number(args.verdict)],
          agreeing: Number(args.agreeing),
          subcommittee: Number(args.subcommittee),
        });
        break;
      case "GateDecision":
        rows.push({
          ...base,
          stage: "gate",
          gateLabel: GATE[Number(args.reasonCode)] ?? "unknown",
          gatePassed: Number(args.reasonCode) === 0,
          price: Number(args.price) / 1e6,
          quantity: Number(args.quantity) / 1e6,
        });
        break;
      case "OrderPlaced":
        rows.push({
          ...base,
          stage: "order",
          price: Number(args.price) / 1e6,
          quantity: Number(args.quantity) / 1e6,
        });
        break;
      case "Redeemed":
        rows.push({ ...base, stage: "settled" });
        break;
      case "RequestExpired":
        rows.push({ ...base, stage: "expired" });
        break;
      case "RequestFailed":
        rows.push({ ...base, stage: "failed" });
        break;
    }
  }

  // `OrderPlaced` and `Redeemed` carry no requestId in their args — the
  // contract only needs marketId to act, so it never emits one. Without this,
  // those two stages fall into their own request-id-less bucket wherever the
  // caller groups rows into one decision per requestId (as the decision tape
  // does), which reads as a second, mostly-empty decision next to the real
  // one. Attach them to the most recent `asked` row for the same agent+market
  // at or before this block — the same join `runner/src/indexer.ts` already
  // uses for exactly this reason.
  const opened = rows.filter((r) => r.stage === "asked");
  for (const r of rows) {
    if ((r.stage === "order" || r.stage === "settled") && !r.requestId) {
      const anchor = opened
        .filter((w) => w.agent === r.agent && w.marketId === r.marketId && w.block <= r.block)
        .sort((a, b) => b.block - a.block)[0];
      if (anchor) r.requestId = anchor.requestId;
    }
  }

  return rows.sort((a, b) => b.block - a.block);
}
