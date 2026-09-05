// The indexer.
//
// Walks the chain logs emitted by the factory and every agent, joins them into
// one row per decision, and writes `results/receipts.jsonl` — the evidence corpus
// a judge can re-verify with `pnpm verify`.
//
// It invents nothing. Every field traces to a log the chain emitted, and the
// verifier re-derives all of it from a public RPC without reading this file.
//
//   pnpm index
import { writeFileSync, mkdirSync } from "node:fs";
import { decodeEventLog, type Address, type Log } from "viem";
import { pub, done } from "./config.js";
import { factoryAbi, traderAbi, FACTORY } from "./contracts.js";

import { RESULTS as RESULTS_DIR, join } from "./paths.js";
const OUT_DIR = RESULTS_DIR();
const LOG_WINDOW = 1000n; // Somnia caps getLogs at 1000 blocks
const MAX_WINDOWS = Number(process.env.INDEX_WINDOWS ?? 400);

interface DecisionRow {
  agent: Address;
  agentName?: string;
  marketId: string;
  requestId: string;
  pool?: string;
  marketState?: string;
  promptDeadline?: number;
  openedBlock?: number;
  openedTx?: string;
  verdict?: number;
  verdictLabel?: string;
  agreeing?: number;
  subcommittee?: number;
  gateReason?: number;
  gateLabel?: string;
  orderKind?: number;
  orderPrice?: string;
  orderQty?: string;
  orderId?: string;
  orderTx?: string;
  filled?: boolean;
  requestStatus?: number;
  expired?: boolean;
  settled?: { outcomeIdx: number; amount: string; tx: string }[];
}

const VERDICTS = ["ABSTAIN", "BUY_UP", "BUY_DOWN"];
const GATE = [
  "PASS",
  "model abstained",
  "market finalized",
  "expiry headroom too short",
  "no resting liquidity on the side needed",
  "price outside allowed band",
  "size snapped to zero on the lot grid",
  "size below venue minimum",
  "max concurrent positions reached",
  "max notional at risk reached",
  "insufficient collateral",
];

async function scanLogs(addresses: Address[]): Promise<Log[]> {
  if (addresses.length === 0) return [];
  const head = await pub.getBlockNumber();
  const out: Log[] = [];
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const to = head - BigInt(i) * LOG_WINDOW;
    if (to <= LOG_WINDOW) break;
    try {
      const logs = await pub.getLogs({
        address: addresses,
        fromBlock: to - (LOG_WINDOW - 1n),
        toBlock: to,
      });
      out.push(...logs);
    } catch {
      // best effort; a failed window must not abort the pass
    }
  }
  return out;
}

const factory = FACTORY();

// ------------------------------------------------------------------ agents

const factoryLogs = await scanLogs([factory]);
const agents: Address[] = [];
const agentNames = new Map<string, string>();
const agentOwners = new Map<string, string>();
const agentStrategies = new Map<string, string>();

for (const l of factoryLogs) {
  try {
    const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
    if (ev.eventName !== "AgentDeployed") continue;
    const a = (ev.args as any).agent as Address;
    agents.push(a);
    agentNames.set(a.toLowerCase(), (ev.args as any).name);
    agentOwners.set(a.toLowerCase(), (ev.args as any).owner);
    agentStrategies.set(a.toLowerCase(), (ev.args as any).strategy);
  } catch {
    /* not one of ours */
  }
}

console.log(`${agents.length} agent(s) found from AgentDeployed logs`);

// ----------------------------------------------------------------- decisions

const rows = new Map<string, DecisionRow>();
const key = (agent: string, marketId: string, requestId: string) =>
  `${agent.toLowerCase()}:${marketId}:${requestId}`;

const agentLogs = await scanLogs(agents);
console.log(`${agentLogs.length} agent log(s)`);

for (const l of agentLogs) {
  let ev;
  try {
    ev = decodeEventLog({ abi: traderAbi, data: l.data, topics: l.topics });
  } catch {
    continue;
  }
  const a = l.address as Address;
  const args = ev.args as any;
  const name = agentNames.get(a.toLowerCase());

  const touch = (marketId: string, requestId: string): DecisionRow => {
    const k = key(a, marketId, requestId);
    if (!rows.has(k)) {
      rows.set(k, { agent: a, agentName: name, marketId, requestId });
    }
    return rows.get(k)!;
  };

  switch (ev.eventName) {
    case "WindowOpened": {
      const r = touch(args.marketId, String(args.requestId));
      r.pool = args.pool;
      r.marketState = args.marketState;
      r.promptDeadline = Number(args.deadline);
      r.openedBlock = Number(l.blockNumber);
      r.openedTx = l.transactionHash ?? undefined;
      break;
    }
    case "VerdictReceived": {
      const r = touch(args.marketId, String(args.requestId));
      r.verdict = Number(args.verdict);
      r.verdictLabel = VERDICTS[Number(args.verdict)];
      r.agreeing = Number(args.agreeing);
      r.subcommittee = Number(args.subcommittee);
      break;
    }
    case "GateDecision": {
      const r = touch(args.marketId, String(args.requestId));
      r.gateReason = Number(args.reasonCode);
      r.gateLabel = GATE[Number(args.reasonCode)] ?? "unknown";
      r.orderKind = Number(args.kind);
      r.orderPrice = String(args.price);
      r.orderQty = String(args.quantity);
      break;
    }
    case "RequestFailed": {
      const r = touch(args.marketId, String(args.requestId));
      r.requestStatus = Number(args.status);
      break;
    }
    case "RequestExpired": {
      const r = touch(args.marketId, String(args.requestId));
      r.expired = true;
      break;
    }
    case "OrderPlaced": {
      // OrderPlaced carries no requestId, so attach it to the most recent open
      // row for that market on that agent.
      const candidates = [...rows.values()]
        .filter((r) => r.agent.toLowerCase() === a.toLowerCase() && r.marketId === args.marketId)
        .sort((x, y) => (y.openedBlock ?? 0) - (x.openedBlock ?? 0));
      const r = candidates[0];
      if (r) {
        r.orderId = String(args.orderId);
        r.orderTx = l.transactionHash ?? undefined;
        r.filled = true;
      }
      break;
    }
    case "Redeemed": {
      const candidates = [...rows.values()].filter(
        (r) => r.agent.toLowerCase() === a.toLowerCase() && r.marketId === args.marketId,
      );
      for (const r of candidates) {
        r.settled ??= [];
        r.settled.push({
          outcomeIdx: Number(args.outcomeIdx),
          amount: String(args.amount),
          tx: l.transactionHash ?? "",
        });
      }
      break;
    }
  }
}

// -------------------------------------------------------------------- write

const all = [...rows.values()].sort((a, b) => (a.openedBlock ?? 0) - (b.openedBlock ?? 0));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, "receipts.jsonl"),
  all.map((r) => JSON.stringify(r)).join("\n") + (all.length ? "\n" : ""),
);

// Roster is written separately so the web app can render /agents without a key.
writeFileSync(
  join(OUT_DIR, "agents.json"),
  JSON.stringify(
    agents.map((a) => ({
      address: a,
      name: agentNames.get(a.toLowerCase()),
      owner: agentOwners.get(a.toLowerCase()),
      strategy: agentStrategies.get(a.toLowerCase()),
    })),
    null,
    2,
  ),
);

// --------------------------------------------------------------- summary

const decisions = all.length;
const withVerdict = all.filter((r) => r.verdict !== undefined);
const unanimous = withVerdict.filter((r) => r.agreeing === r.subcommittee).length;
const rejected = all.filter((r) => r.gateReason !== undefined && r.gateReason !== 0);
const placed = all.filter((r) => r.filled).length;
const expired = all.filter((r) => r.expired).length;
const failed = all.filter((r) => r.requestStatus !== undefined).length;

const byReason = new Map<string, number>();
for (const r of rejected) byReason.set(r.gateLabel!, (byReason.get(r.gateLabel!) ?? 0) + 1);

console.log(`
decisions          ${decisions}
verdicts returned  ${withVerdict.length}
full consensus     ${unanimous} of ${withVerdict.length}
gate rejections    ${rejected.length}
orders placed      ${placed}
requests failed    ${failed}
requests expired   ${expired}`);

if (byReason.size) {
  console.log("\nrejections by rule:");
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }
}

console.log(`\nwrote results/receipts.jsonl (${decisions} rows) and results/agents.json`);
done(0);
