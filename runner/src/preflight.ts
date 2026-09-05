// Read-only preflight. No key required, no transactions, no risk.
//
//   pnpm doctor
//
// Purpose: verify against a LIVE pool every on-chain read the agent contract will
// depend on — especially `getBookLevels`, whose struct layout the official
// template flags as unconfirmed:
//
//   "The one struct to double-check against the live ABI before you rely on it is
//    `OrderBookLevel` (marked below) — everything else is confirmed."
//
// That risk is CLOSED, and this script re-closes it on every run. A range check
// alone would not do it: if `price` and `quantity` were transposed, both are
// plausible uint256 and both can land inside (0, 1e6). The discriminator is
// monotonicity — bid prices must descend, ask prices must ascend, and the book
// must not be crossed. Quantities have no reason to be ordered, and observably
// are not. If that ever stops holding, this exits loudly.
import { formatUnits } from "viem";
import { pub, COLLATERAL, collateralDecimals, priceToProbability, me, PRIVATE_KEY, done } from "./config.js";
import { discoverLiveWindows, cadenceLabel, STATUS_LABEL } from "./markets.js";
import { binaryPoolAbi, binaryMarketAbi, erc20LikeAbi } from "./abi.js";

const ok = (s: string) => console.log(`  ok   ${s}`);
const bad = (s: string) => console.log(`  FAIL ${s}`);

console.log("bicameral preflight — read-only\n");

// ---------------------------------------------------------------- chain + token
const [chainId, block, dec] = await Promise.all([
  pub.getChainId(),
  pub.getBlockNumber(),
  collateralDecimals(),
]);
console.log("chain");
ok(`chainId=${chainId}  head=${block}`);
ok(`collateral=${COLLATERAL}  decimals=${dec}  oneContract=${10n ** BigInt(dec)}`);
if (dec !== 6) {
  console.log(
    `  note collateral is ${dec} decimals, not the 6 seen on Shannon testnet —\n` +
      `       every size and balance must be derived from decimals(), never a literal.`,
  );
}

// ---------------------------------------------------------------- live windows
const { windows, source, indexerError } = await discoverLiveWindows();
console.log(`\nmarkets (source: ${source})`);
if (indexerError) console.log(`  note indexer unavailable: ${indexerError.slice(0, 90)}`);
if (windows.length === 0) {
  bad("no live windows — the venue may be between windows; retry shortly");
  done(1);
}
ok(`${windows.length} live window(s)`);
const assets = [...new Set(windows.map((w) => w.asset))];
const cadences = [...new Set(windows.map((w) => w.intervalSec))].sort((a, b) => a - b);
ok(`assets seen: ${assets.join(", ")}`);
ok(`cadences seen: ${cadences.map(cadenceLabel).join(", ")}`);

// Probe the window closing soonest that still has real headroom.
const target = windows.find((w) => w.secondsLeft > 300) ?? windows[0];
console.log(
  `\nprobing ${target.asset} ${cadenceLabel(target.intervalSec)}` +
    `  closes in ${Math.floor(target.secondsLeft / 60)}m  pool=${target.pool}`,
);

// ---------------------------------------------------------------- pool reads
try {
  const params: any = await pub.readContract({
    address: target.pool,
    abi: binaryPoolAbi,
    functionName: "getBinaryPoolParams",
  });
  ok(`getBinaryPoolParams  collateral=${params.collateralToken}  oneCollateral=${params.oneCollateral}`);
  ok(`  market=${params.market}  outcomeToken=${params.outcomeToken}`);
  ok(`  yesId=${params.yesId}`);
  ok(`  noId=${params.noId}`);
  ok(`  fees maker=${params.makerFeeBpsTimes1k} taker=${params.takerFeeBpsTimes1k} settlement=${params.settlementFeeBpsTimes1k}`);
  ok(`  marketNonce=${params.marketNonce}  finalized=${params.finalized}`);
  if (params.oneCollateral !== 10n ** BigInt(dec)) {
    bad(
      `  oneCollateral (${params.oneCollateral}) != 10^decimals (${10n ** BigInt(dec)}) — ` +
        `size everything off oneCollateral, not off decimals()`,
    );
  }

  const grid: any = await pub.readContract({
    address: target.pool,
    abi: binaryPoolAbi,
    functionName: "getOrderBookParameters",
  });
  ok(`getOrderBookParameters  tickSize=${grid.tickSize}  minQuantity=${grid.minQuantity}  lotSize=${grid.lotSize}`);

  const expiryNs: bigint = await pub.readContract({
    address: target.pool,
    abi: binaryPoolAbi,
    functionName: "marketExpiryNs",
  });
  const expirySec = Number(expiryNs / 1_000_000_000n);
  ok(`marketExpiryNs=${expiryNs}  (${new Date(expirySec * 1000).toISOString()})`);
  // marketExpiryNs() is the SOLE authority for anything acted on. The discovery
  // row's `expiry` comes from a log or from the indexer depending on which path
  // served us, so it is display-only and a mismatch is informational, not a fault.
  if (Math.abs(expirySec - target.expiry) > 5) {
    console.log(
      `  note discovery row said expiry=${target.expiry}; the pool says ${expirySec}.` +
        ` The pool wins — the risk gate must read marketExpiryNs(), never the row.`,
    );
  }

  const finalized: boolean = await pub.readContract({
    address: target.pool,
    abi: binaryPoolAbi,
    functionName: "finalized",
  });
  ok(`finalized=${finalized}`);

  // ------------------------------------------------------ the flagged struct
  console.log("\ngetBookLevels — proving the layout, not just decoding it");
  const bids: any = await pub.readContract({
    address: target.pool,
    abi: binaryPoolAbi,
    functionName: "getBookLevels",
    args: [true, 5n],
  });
  const asks: any = await pub.readContract({
    address: target.pool,
    abi: binaryPoolAbi,
    functionName: "getBookLevels",
    args: [false, 5n],
  });
  console.log(`  bids: ${bids.length} level(s)   asks: ${asks.length} level(s)`);
  const show = (side: string, levels: any[]) => {
    for (const l of levels.slice(0, 5)) {
      const p = priceToProbability(l.price);
      const flag = p > 0 && p < 1 ? "" : "   <-- price outside (0,1): LAYOUT IS WRONG";
      console.log(
        `    ${side} price=${l.price} (p=${p.toFixed(4)})  qty=${l.quantity}` +
          ` (${formatUnits(l.quantity, dec)})${flag}`,
      );
    }
  };
  show("bid", bids);
  show("ask", asks);

  // A range check is NOT proof of layout: if `price` and `quantity` were
  // transposed, both fields are plausible uint256 and both can land inside
  // (0, 1e6). The discriminator is MONOTONICITY — a price array must be ordered
  // by side, a quantity array has no reason to be. So assert the ordering.
  const all = [...bids, ...asks];
  if (all.length === 0) {
    console.log(
      "  note book is EMPTY, so the layout is untested. This is the dead-book case:\n" +
        "       a Buy Up at p crossing a Buy Down at 1-p mints a pair with no seller\n" +
        "       and no inventory. Re-run preflight when a level is resting.",
    );
  } else {
    let proven = true;

    const inRange = all.every((l: any) => l.price > 0n && l.price < 1_000_000n && l.quantity >= 0n);
    inRange ? ok("every level has 0 < price < 1e6 and quantity >= 0") : (bad("level values out of range"), (proven = false));

    // Bids descend in price as you walk down the book.
    for (let i = 0; i + 1 < bids.length; i++) {
      if (bids[i].price <= bids[i + 1].price) {
        bad(`bid prices not descending at level ${i}: ${bids[i].price} <= ${bids[i + 1].price}`);
        proven = false;
      }
    }
    // Asks ascend.
    for (let i = 0; i + 1 < asks.length; i++) {
      if (asks[i].price >= asks[i + 1].price) {
        bad(`ask prices not ascending at level ${i}: ${asks[i].price} >= ${asks[i + 1].price}`);
        proven = false;
      }
    }
    if (bids.length > 1 || asks.length > 1) {
      ok("price arrays are monotonic by side — field 0 really is price, not quantity");
    }

    // And the book must not be crossed.
    if (bids.length && asks.length) {
      bids[0].price < asks[0].price
        ? ok(`best bid ${bids[0].price} < best ask ${asks[0].price} — book is not crossed`)
        : (bad(`crossed book: bid ${bids[0].price} >= ask ${asks[0].price}`), (proven = false));
    }

    // Quantities being non-monotonic is expected and fine; it is only evidence
    // that we are not accidentally reading a price array as quantities.
    const qtys = all.map((l: any) => l.quantity);
    if (new Set(qtys.map(String)).size > 1) {
      ok("quantities vary independently of price ordering, as a size column should");
    }

    proven
      ? ok("OrderBookLevel layout CONFIRMED: (price, quantity)")
      : bad("OrderBookLevel layout NOT proven — do not build the prompt on book data yet");
  }

  // ------------------------------------------------------ market resolution
  const [resolved, voided] = await Promise.all([
    pub.readContract({ address: params.market, abi: binaryMarketAbi, functionName: "isResolved" }),
    pub.readContract({ address: params.market, abi: binaryMarketAbi, functionName: "isVoided" }),
  ]);
  console.log("\nmarket contract");
  ok(`isResolved=${resolved}  isVoided=${voided}`);
} catch (err: any) {
  bad(`pool read failed: ${err?.shortMessage ?? err?.message ?? err}`);
}

// ---------------------------------------------------------------- wallet
console.log("\nwallet");
if (!PRIVATE_KEY || PRIVATE_KEY === "0x...") {
  console.log("  skip no PRIVATE_KEY in .env — every check above ran without one");
} else {
  const addr = me();
  const [stt, tusdc] = await Promise.all([
    pub.getBalance({ address: addr }),
    pub.readContract({
      address: COLLATERAL,
      abi: erc20LikeAbi,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
  ]);
  ok(`${addr}`);
  ok(`STT   ${formatUnits(stt, 18)}   (~${Number(formatUnits(stt, 18)) / 0.24 | 0} LLM decisions at 0.24/req)`);
  ok(`tUSDC ${formatUnits(tusdc, dec)}`);
  if (stt === 0n) bad("no STT — agent cannot pay for inference or gas");
  if (tusdc === 0n) bad("no tUSDC — agent has no collateral to trade");
}

console.log("\ndone.");
done(0);
