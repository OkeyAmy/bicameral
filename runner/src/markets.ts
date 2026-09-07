// Live market discovery.
//
// This is the single source of truth for "what windows exist right now", used by
// the keeper and by the web Floor. Two independent paths, because the template's
// SKILL.md warns plainly: "The indexer can be down."
//
//   1. indexer  — listLiveBinaryMarkets(). Richer: exposes venue, volume, trade
//                 count, last price, and supports server-side filter + ordering.
//   2. chain    — MarketCreated logs. Always available. Carries NO venueId, so it
//                 is scoped by collateral instead (see config.COLLATERAL).
//
// We try the indexer first and fall back to chain logs. Either way the caller gets
// the same shape, and NEITHER path enumerates assets or cadences — those are
// whatever the venue happens to be running.
import type { Address } from "viem";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { pub, COLLATERAL, exchange, INDEXER_URL } from "./config.js";

export type MarketStatus = 0 | 1 | 2 | 3 | 4 | 5;
export const STATUS_LABEL: Record<number, string> = {
  0: "Listed",
  1: "Trading",
  2: "Locked",
  3: "Settling",
  4: "Resolved",
  5: "Voided",
};

export interface LiveWindow {
  marketId: `0x${string}`;
  pool: Address;
  /** Whatever the venue calls it. We never enumerate this. */
  asset: string;
  /** Window length in seconds. Multiple cadences run per asset. */
  intervalSec: number;
  /** Unix seconds. */
  expiry: number;
  secondsLeft: number;
  collateral: Address;
  venueId?: `0x${string}`;
  operatorId?: number;
  /** Present on the indexer path only. */
  volume?: number;
  tradeCount?: number;
  lastPrice?: number;
  /** Filled in by validateOnchain(). */
  onchainStatus?: MarketStatus;
  source: "indexer" | "chain";
}

/** Somnia caps getLogs at 1000 blocks per call. */
const LOG_WINDOW = 1000n;
const LOG_WINDOWS_BACK = 40;

/**
 * The MarketCreated ABI comes from the SDK so we never restate the venue's event
 * signature ourselves. The SDK does not re-export it from its main entry, so this
 * reaches into dist the same way the official template does.
 */
/**
 * Mirrors the SDK's own `marketCreatorEventsAbi` entry, verified field-for-field
 * against `@somnia-chain/markets-sdk@0.29.0`.
 *
 * Note what is NOT here: `venueId` and `operatorId`. The template's SKILL.md is
 * explicit — "MarketCreated carries no venueId, so there is nothing to filter
 * venues on" — which is why chain-path discovery scopes by collateral, and why
 * redemption reads those two fields from `BinaryMarketsModule.markets(marketId)`
 * instead.
 */
const MARKET_CREATED_FALLBACK = {
  type: "event",
  name: "MarketCreated",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "market", type: "address", indexed: true },
    { name: "pool", type: "address", indexed: true },
    { name: "yesId", type: "uint256", indexed: false },
    { name: "noId", type: "uint256", indexed: false },
    { name: "collateral", type: "address", indexed: false },
    { name: "asset", type: "string", indexed: false },
    { name: "strike", type: "uint256", indexed: false },
    { name: "tradingStart", type: "uint64", indexed: false },
    { name: "expiry", type: "uint64", indexed: false },
    { name: "oracleQuestionId", type: "uint256", indexed: false },
    { name: "question", type: "string", indexed: false },
    { name: "intervalSec", type: "uint64", indexed: false },
  ],
} as const;

let _marketCreated: any;
async function marketCreatedEvent() {
  if (_marketCreated) return _marketCreated;

  // Prefer the SDK's own definition. Its export map (0.29.0) does not expose
  // `./dist/eventsAbi.js` and the main entry does not re-export
  // `marketCreatorEventsAbi`, so resolve the package entry and reach the sibling
  // file by path — the same trick the official template uses.
  //
  // This CANNOT work inside a webpack bundle: `require.resolve` there returns a
  // numeric module id, not a path. The web app externalizes the SDK so this path
  // still runs natively, but if it ever doesn't, fall back rather than crash the
  // public page.
  try {
    const req = createRequire(import.meta.url);
    const entry = req.resolve("@somnia-chain/markets-sdk");
    if (typeof entry !== "string") throw new Error("bundled resolver");
    const mod: any = await import(new URL("eventsAbi.js", pathToFileURL(entry)).href);
    const abi = mod.marketCreatorEventsAbi ?? mod.default?.marketCreatorEventsAbi;
    const ev = abi?.find((e: any) => e.name === "MarketCreated");
    if (ev) {
      _marketCreated = ev;
      return ev;
    }
  } catch {
    /* fall through */
  }

  _marketCreated = MARKET_CREATED_FALLBACK;
  return _marketCreated;
}

/**
 * Indexer GraphQL reads, no key and no SDK class required.
 *
 * `SomniaMarketsClient.listLiveBinaryMarkets` (reached via `exchange().client`)
 * needs `exchange()`, which throws without a `PRIVATE_KEY` — but the read
 * itself is nothing but a POST to a public Hasura endpoint (confirmed by
 * reading `IndexerRead.sendGraphql` in the SDK source: plain `fetch`, no
 * signing, `indexerUrl` is its only required argument). The class requires a
 * key so its WRITE surface can sign; this read never touches it.
 *
 * This does NOT reach into the SDK's `dist/` to call its free function —
 * that was tried first and failed specifically on this app's Next.js server
 * (`createRequire(import.meta.url).resolve(...)` threw "Cannot find module"
 * there despite resolving fine under plain tsx; likely `serverExternalPackages`
 * handling dynamic runtime resolution differently from the static imports it's
 * designed for). Same principle as `MARKET_CREATED_FALLBACK` above: hardcode
 * the small, stable public contract (here, a GraphQL fragment over documented
 * Hasura columns) rather than depend on a dependency's internal file layout.
 */
const BINARY_MARKET_FIELDS = `
  id marketId marketAddress poolAddress collateral asset intervalSec expiry
  venueId operatorId cumulativeQuoteVolume tradeCount lastPrice
`;

async function gqlFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(`indexer: ${json.errors[0]?.message ?? "GraphQL error"}`);
  return json.data as T;
}

const LIVE_BINARY_MARKETS_QUERY = `
  query LiveBinaryMarkets($where: Market_bool_exp!, $orderBy: [Market_order_by!], $limit: Int!, $offset: Int!) {
    Market(where: $where, order_by: $orderBy, limit: $limit, offset: $offset) { ${BINARY_MARKET_FIELDS} }
  }
`;

const MARKET_BY_PK_QUERY = `
  query MarketByPk($id: String!) {
    Market_by_pk(id: $id) { ${BINARY_MARKET_FIELDS} }
  }
`;

function toLiveWindow(m: any, now: number): LiveWindow {
  return {
    marketId: m.marketId,
    pool: m.pool ?? m.poolAddress,
    asset: String(m.asset),
    intervalSec: Number(m.intervalSec),
    expiry: Number(m.expiry),
    secondsLeft: Number(m.expiry) - now,
    collateral: m.collateral ?? COLLATERAL,
    venueId: m.venueId,
    operatorId: m.operatorId !== undefined ? Number(m.operatorId) : undefined,
    volume: m.cumulativeQuoteVolume !== undefined ? Number(m.cumulativeQuoteVolume) : undefined,
    tradeCount: m.tradeCount !== undefined ? Number(m.tradeCount) : undefined,
    lastPrice: m.lastPrice != null ? Number(m.lastPrice) : undefined,
    source: "indexer" as const,
  };
}

/**
 * How many `getLogs` calls run at once.
 *
 * On a chain this fast, block count and wall-clock time part ways quickly —
 * covering even a few hours of history means dozens of 1000-block windows at
 * Somnia's throughput. Correct for that by batching the calls concurrently
 * rather than shrinking how far back discovery looks: the venue is free to run
 * windows this repo has never seen, so the reach should not be traded away for
 * speed. See `web/lib/floor.ts`'s `scan()` for the same pattern.
 */
const SCAN_CONCURRENCY = 25;

/** Path 2: chain logs. No venue filter available; scoped by collateral. */
export async function discoverFromChain(now = Math.floor(Date.now() / 1000)): Promise<LiveWindow[]> {
  const event = await marketCreatedEvent();
  const head = await pub.getBlockNumber();

  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let i = 0; i < LOG_WINDOWS_BACK; i++) {
    const to = head - BigInt(i) * LOG_WINDOW;
    if (to <= LOG_WINDOW) break;
    ranges.push({ fromBlock: to - (LOG_WINDOW - 1n), toBlock: to });
  }

  const args: any[] = [];
  for (let i = 0; i < ranges.length; i += SCAN_CONCURRENCY) {
    const batch = ranges.slice(i, i + SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) => pub.getLogs({ event, ...r }).catch(() => [])),
    );
    for (const logs of results) args.push(...logs.map((l: any) => l.args));
  }

  return args
    .filter(
      (m) =>
        Number(m.expiry) > now &&
        String(m.collateral).toLowerCase() === COLLATERAL.toLowerCase(),
    )
    .map((m) => ({
      marketId: m.marketId,
      pool: m.pool,
      asset: String(m.asset),
      intervalSec: Number(m.intervalSec),
      expiry: Number(m.expiry),
      secondsLeft: Number(m.expiry) - now,
      collateral: m.collateral,
      venueId: m.venueId,
      operatorId: m.operatorId !== undefined ? Number(m.operatorId) : undefined,
      source: "chain" as const,
    }))
    .sort((a, b) => a.secondsLeft - b.secondsLeft);
}

/**
 * Find one market by id, whether or not it is still live.
 *
 * `discoverFromChain()` filters to `expiry > now` — correct for a board of
 * tradable windows, wrong for a permalink. A market's own page (and the
 * decision history on it) would 404 the moment it settles, which is exactly
 * when there is the most to look at.
 *
 * `marketId` is an INDEXED topic on `MarketCreated`, so this asks the node to
 * filter server-side for that exact value rather than fetching every event in
 * range and filtering client-side — each call returns at most one match, so a
 * wide historical lookback stays cheap. This also recovers the real asset
 * string from the original log, which a hash-based lookup (e.g. through the
 * factory's registry, which only stores `keccak256(asset)`) cannot.
 */
export async function findMarketCreated(marketId: `0x${string}`): Promise<LiveWindow | null> {
  const event = await marketCreatedEvent();
  const head = await pub.getBlockNumber();
  const now = Math.floor(Date.now() / 1000);

  const LOOKBACK_WINDOWS = 400; // generous: recent settled markets, not full chain history

  for (let i = 0; i < LOOKBACK_WINDOWS; i += SCAN_CONCURRENCY) {
    const batch = Array.from({ length: Math.min(SCAN_CONCURRENCY, LOOKBACK_WINDOWS - i) }, (_, j) => {
      const idx = i + j;
      const to = head - BigInt(idx) * LOG_WINDOW;
      return to > LOG_WINDOW ? { fromBlock: to - (LOG_WINDOW - 1n), toBlock: to } : null;
    }).filter((r): r is { fromBlock: bigint; toBlock: bigint } => r !== null);

    if (batch.length === 0) break;

    const results = await Promise.all(
      batch.map((r) =>
        pub
          .getLogs({ event, args: { marketId } as any, ...r })
          .catch(() => []),
      ),
    );

    for (const logs of results) {
      if (logs.length > 0) {
        const m = (logs[0] as any).args;
        return {
          marketId: m.marketId,
          pool: m.pool,
          asset: String(m.asset),
          intervalSec: Number(m.intervalSec),
          expiry: Number(m.expiry),
          secondsLeft: Number(m.expiry) - now,
          collateral: m.collateral,
          venueId: m.venueId,
          operatorId: m.operatorId !== undefined ? Number(m.operatorId) : undefined,
          source: "chain" as const,
        };
      }
    }
  }

  return null;
}

/**
 * Path 1: indexer. Richer rows, server-side ordering, exposes venue.
 *
 * Keyless: a plain GraphQL POST to `INDEXER_URL` (see `gqlFetch` above), not
 * `exchange().client`, so this runs on a public web server with no
 * `PRIVATE_KEY` in its environment. Throws (falls through to
 * `discoverLiveWindows`'s chain-log fallback) only if the indexer itself is
 * unreachable or its schema no longer matches `BINARY_MARKET_FIELDS`.
 */
export async function discoverFromIndexer(
  now = Math.floor(Date.now() / 1000),
): Promise<LiveWindow[]> {
  const data = await gqlFetch<{ Market: any[] }>(LIVE_BINARY_MARKETS_QUERY, {
    where: { marketType: { _eq: "BINARY" }, expiry: { _gt: String(now) } },
    orderBy: { expiry: "asc" },
    limit: 100,
    offset: 0,
  });

  return data.Market.map((m) => toLiveWindow(m, now))
    .filter((m) => m.secondsLeft > 0)
    .sort((a, b) => a.secondsLeft - b.secondsLeft);
}

/**
 * One market by id, straight from the indexer, no age limit and no key.
 *
 * The `Market` row's primary key IS `marketId` for binary markets (confirmed
 * against the SDK's own `getMarket`/`toMarket`), so this answers a permalink
 * lookup for a market of ANY age in one request — unlike `findMarketCreated`,
 * whose `LOOKBACK_WINDOWS` chain-log scan only reaches ~10 hours back. Returns
 * `null` on any failure (unreachable indexer, not found) so callers fall back
 * to the chain-log path rather than throw.
 */
export async function findMarketInIndexer(marketId: `0x${string}`): Promise<LiveWindow | null> {
  try {
    const data = await gqlFetch<{ Market_by_pk: any | null }>(MARKET_BY_PK_QUERY, {
      id: marketId.toLowerCase(),
    });
    if (!data.Market_by_pk) return null;
    return toLiveWindow(data.Market_by_pk, Math.floor(Date.now() / 1000));
  } catch {
    return null;
  }
}

/**
 * Indexer first, chain logs on any failure. Callers should not care which ran —
 * but `source` is reported so the UI can show which path served the page.
 */
export async function discoverLiveWindows(): Promise<{
  windows: LiveWindow[];
  source: "indexer" | "chain";
  indexerError?: string;
}> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const windows = await discoverFromIndexer(now);
    if (windows.length > 0) return { windows, source: "indexer" };
    // An empty indexer response is indistinguishable from a stale indexer, so
    // confirm against the chain before reporting "no markets".
    const fallback = await discoverFromChain(now);
    return fallback.length > 0
      ? { windows: fallback, source: "chain" }
      : { windows: [], source: "indexer" };
  } catch (err: any) {
    const windows = await discoverFromChain(now);
    return { windows, source: "chain", indexerError: String(err?.message ?? err) };
  }
}

/**
 * The indexed status trails the chain by seconds, so anything we are about to act
 * on — or render as tradable — gets confirmed on-chain first.
 */
export async function validateOnchain(w: LiveWindow): Promise<LiveWindow> {
  try {
    const ex = exchange();
    const onchain: any = await (ex as any).client.getMarketOnchain(w.marketId);
    return { ...w, onchainStatus: Number(onchain.status) as MarketStatus };
  } catch {
    return w;
  }
}

/**
 * Group for display: venue × asset × cadence. The keys come from the data, never
 * from a list we maintain — a new asset or cadence appears here on its own.
 */
export function groupWindows(windows: LiveWindow[]) {
  const byAsset = new Map<string, Map<number, LiveWindow[]>>();
  for (const w of windows) {
    if (!byAsset.has(w.asset)) byAsset.set(w.asset, new Map());
    const byCadence = byAsset.get(w.asset)!;
    if (!byCadence.has(w.intervalSec)) byCadence.set(w.intervalSec, []);
    byCadence.get(w.intervalSec)!.push(w);
  }
  return byAsset;
}

export const cadenceLabel = (intervalSec: number): string =>
  intervalSec % 3600 === 0 ? `${intervalSec / 3600}h` : `${Math.round(intervalSec / 60)}m`;
