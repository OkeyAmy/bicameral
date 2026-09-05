// Read-only. Prints every live Event Contract window the venue is running right
// now, grouped venue × asset × cadence. No key required for the chain path.
//
//   pnpm discover
//
// This is also the smoke test for the claim the whole UI rests on: nothing about
// the market universe is hardcoded. Whatever DreamDEX lists shows up here.
import { discoverLiveWindows, groupWindows, cadenceLabel, STATUS_LABEL } from "./markets.js";
import { done } from "./config.js";

const { windows, source, indexerError } = await discoverLiveWindows();

if (indexerError) {
  console.log(`indexer unavailable (${indexerError.slice(0, 80)}) — served from chain logs\n`);
}

console.log(`${windows.length} live window(s) · source: ${source}\n`);

if (windows.length === 0) {
  console.log("No live markets. The venue may be between windows — retry shortly.");
  done(0);
}

const byAsset = groupWindows(windows);
const assets = [...byAsset.keys()].sort();

for (const asset of assets) {
  const byCadence = byAsset.get(asset)!;
  const cadences = [...byCadence.keys()].sort((a, b) => a - b);
  console.log(`${asset}`);
  for (const intervalSec of cadences) {
    const rows = byCadence.get(intervalSec)!;
    console.log(`  ${cadenceLabel(intervalSec)}  (${rows.length} window(s))`);
    for (const w of rows) {
      const mins = Math.floor(w.secondsLeft / 60);
      const secs = w.secondsLeft % 60;
      const status = w.onchainStatus !== undefined ? STATUS_LABEL[w.onchainStatus] : "—";
      const vol = w.volume !== undefined ? `  vol=${w.volume}` : "";
      const trades = w.tradeCount !== undefined ? `  trades=${w.tradeCount}` : "";
      console.log(
        `    closes in ${String(mins).padStart(3)}m${String(secs).padStart(2, "0")}s` +
          `  status=${status}${vol}${trades}\n` +
          `      pool=${w.pool}\n` +
          `      marketId=${w.marketId}`,
      );
    }
  }
  console.log("");
}

console.log(
  "Assets and cadences above are read from the venue at runtime — none of them\n" +
    "appear anywhere in this repo's source.",
);

done(0);
