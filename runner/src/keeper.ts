// The keeper.
//
// It pokes and it records. It NEVER decides.
//
// There is no strategy logic in this file and there must never be. Every call it
// makes is permissionless — `registerMarket`, `openWindow`, `expirePending`,
// `settleAndRedeem` — so anyone, including a judge, can run this and the agents
// behave identically. The keeper holds a key only to pay its own gas: it cannot
// trade, cannot move collateral, and cannot change a strategy.
//
// That is what "no server holds a key and no server makes a decision" means. If
// you ever find yourself writing `if (price > x)` here, the project has lost the
// thing that makes it worth building.
//
//   DRY_RUN=true pnpm keeper     # logs what it would do, sends nothing
import { keccak256, toHex, type Address } from "viem";
import { pub, done } from "./config.js";
import { discoverLiveWindows, cadenceLabel, type LiveWindow } from "./markets.js";
import { factoryAbi, traderAbi, FACTORY, wallet, DRY_RUN } from "./contracts.js";

const POLL_MS = Number(process.env.KEEPER_POLL_MS ?? 60_000);
const factory = FACTORY();
const w = DRY_RUN ? null : wallet();

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Assets are hashed so the mandate filter never carries a venue string on-chain. */
const assetHash = (asset: string) => keccak256(toHex(asset));

async function send(fn: string, args: unknown[], to: Address): Promise<string | null> {
  if (DRY_RUN || !w) {
    log(`  DRY_RUN would call ${fn}(${args.map(String).join(", ")}) on ${to}`);
    return null;
  }
  const hash = await w.writeContract({
    address: to,
    abi: fn.startsWith("register") ? factoryAbi : traderAbi,
    functionName: fn,
    args: args as never,
    chain: null,
  });
  log(`  sent ${fn} → ${hash}`);
  return hash;
}

/**
 * Mirror live windows into the factory registry.
 *
 * Permissionless and safe: the factory reads pool, collateral, operatorId and
 * venueId from the venue's own `markets(marketId)` and rejects anything that
 * disagrees. We only supply `asset` and `intervalSec`, which are used for mandate
 * filtering and can never redirect funds.
 */
async function registerNew(windows: LiveWindow[]) {
  for (const win of windows) {
    const known = (await pub.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "isRegistered",
      args: [win.marketId],
    })) as boolean;
    if (known) continue;

    log(`register ${win.asset} ${cadenceLabel(win.intervalSec)} ${win.marketId.slice(0, 10)}…`);
    await send("registerMarket", [win.marketId, assetHash(win.asset), win.intervalSec], factory);
  }
}

async function agentList(): Promise<Address[]> {
  const n = (await pub.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "agentCount",
  })) as bigint;

  const out: Address[] = [];
  for (let i = 0n; i < n; i++) {
    out.push(
      (await pub.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "agents",
        args: [i],
      })) as Address,
    );
  }
  return out;
}

/**
 * Simulate before sending. openWindow reverts for a long list of legitimate
 * reasons — throttle not elapsed, request already in flight, out of fuel, market
 * outside the agent's mandate, expiry headroom too short. Those are not errors,
 * they are the agent correctly declining, so we skip quietly rather than burning
 * gas on a revert. One broken agent must never stop the others.
 */
async function pokeAgent(agent: Address, windows: LiveWindow[]) {
  // Each openWindow spends requestCost() of the AGENT's STT. Simulating four
  // windows all passes when the agent can only afford two, and sends 3 and 4 then
  // revert on-chain. So track fuel across the loop and stop cleanly instead.
  let fuel = Number(
    (await pub.readContract({
      address: agent,
      abi: traderAbi,
      functionName: "fuelRemaining",
    })) as bigint,
  );

  for (const win of windows) {
    if (fuel <= 0) {
      log(`  skip ${agent.slice(0, 8)}…: out of fuel (0 decisions affordable)`);
      return;
    }

    try {
      await pub.simulateContract({
        address: agent,
        abi: traderAbi,
        functionName: "openWindow",
        args: [win.marketId],
        account: w?.account?.address ?? "0x000000000000000000000000000000000000dEaD",
      });
    } catch (err: any) {
      const reason = String(err?.shortMessage ?? err?.message ?? err).split("\n")[0];
      log(`  skip ${agent.slice(0, 8)}… ${win.asset} ${cadenceLabel(win.intervalSec)}: ${reason.slice(0, 90)}`);
      continue;
    }

    log(`poke ${agent.slice(0, 8)}… → ${win.asset} ${cadenceLabel(win.intervalSec)} (fuel ${fuel})`);
    await send("openWindow", [win.marketId], agent);
    fuel -= 1;
  }
}

/** Free an agent wedged behind a request that never came back. */
async function clearStale(agent: Address, windows: LiveWindow[]) {
  for (const win of windows) {
    try {
      await pub.simulateContract({
        address: agent,
        abi: traderAbi,
        functionName: "expirePending",
        args: [win.marketId],
        account: w?.account?.address ?? "0x000000000000000000000000000000000000dEaD",
      });
    } catch {
      continue; // nothing pending, or not past its deadline yet
    }
    log(`expire stale request ${agent.slice(0, 8)}… ${win.marketId.slice(0, 10)}…`);
    await send("expirePending", [win.marketId], agent);
  }
}

/** Redeem anything that has settled. Also permissionless. */
async function settle(agent: Address) {
  const n = (await pub.readContract({
    address: agent,
    abi: traderAbi,
    functionName: "touchedMarketCount",
  })) as bigint;

  for (let i = 0n; i < n; i++) {
    const marketId = (await pub.readContract({
      address: agent,
      abi: traderAbi,
      functionName: "touchedMarkets",
      args: [i],
    })) as `0x${string}`;

    try {
      await pub.simulateContract({
        address: agent,
        abi: traderAbi,
        functionName: "settleAndRedeem",
        args: [marketId],
        account: w?.account?.address ?? "0x000000000000000000000000000000000000dEaD",
      });
    } catch {
      continue; // not settled, or nothing to redeem
    }
    log(`redeem ${agent.slice(0, 8)}… ${marketId.slice(0, 10)}…`);
    await send("settleAndRedeem", [marketId], agent);
  }
}

async function cycle() {
  const { windows, source } = await discoverLiveWindows();
  log(`cycle: ${windows.length} live window(s) via ${source}`);
  if (windows.length === 0) return;

  await registerNew(windows);

  const agents = await agentList();
  log(`${agents.length} agent(s) registered`);

  for (const agent of agents) {
    try {
      await clearStale(agent, windows);
      await pokeAgent(agent, windows);
      await settle(agent);
    } catch (err: any) {
      // One agent failing must never stop the loop — at consumer volume there
      // will always be one out of fuel or mid-upgrade.
      log(`  agent ${agent.slice(0, 8)}… errored: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
}

log(`keeper starting · factory=${factory} · DRY_RUN=${DRY_RUN} · poll=${POLL_MS}ms`);
if (DRY_RUN) log("DRY_RUN is on: nothing will be sent. Set DRY_RUN=false in .env to go live.");

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  log("stopping after this cycle…");
});

while (!stopping) {
  try {
    await cycle();
  } catch (err: any) {
    log(`cycle failed: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

done(0);
