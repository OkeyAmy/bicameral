// Seed the board with personality agents.
//
//   pnpm seed
//
// This is P0, not a nicety. Three reasons, all load-bearing:
//
//   1. A public board with one agent is worse than no public board. A judge who
//      opens the link cold at 2am must find a populated, moving page.
//   2. The venue's cold-start mechanism is mint-a-pair: a Buy Up at p crossing a
//      Buy Down at 1-p needs no seller and no inventory. Agents that genuinely
//      DISAGREE therefore fill each other even on an empty book. So the roster is
//      built to disagree.
//   3. `coin-flipper` and `yolo-momentum` earn their place by losing and by
//      getting rejected. A visible loser proves the record is not curated, and a
//      prompt that keeps tripping the gate populates the REJECT rows that carry
//      the security story. Publishing a strategy that fails is a stronger claim
//      than publishing five that win.
import { parseUnits } from "viem";
import { pub, collateralDecimals, done } from "./config.js";
import { factoryAbi, FACTORY, wallet, DRY_RUN } from "./contracts.js";

interface Personality {
  name: string;
  strategy: string;
  /** 1e6 probability band */
  minPrice: bigint;
  maxPrice: bigint;
  /** contracts */
  size: number;
  reevalSec: number;
  note: string;
}

const ROSTER: Personality[] = [
  {
    name: "fade-extremes",
    strategy:
      "Fade the crowd. If the UP price is above 0.80, buy DOWN. If it is below 0.20, buy UP. Otherwise abstain.",
    minPrice: 20_000n,
    maxPrice: 980_000n,
    size: 5,
    reevalSec: 900,
    note: "contrarian: takes the opposite side of a confident book",
  },
  {
    name: "momentum-chase",
    strategy:
      "Follow the book. If the UP price is above 0.55, buy UP. If it is below 0.45, buy DOWN. Otherwise abstain.",
    minPrice: 20_000n,
    maxPrice: 980_000n,
    size: 5,
    reevalSec: 900,
    note: "trend-following: deliberately opposed to fade-extremes so the two cross",
  },
  {
    name: "spread-sitter",
    strategy:
      "Only act when the market is genuinely uncertain. If the UP price is between 0.45 and 0.55, buy UP. Otherwise abstain.",
    minPrice: 400_000n,
    maxPrice: 600_000n,
    size: 3,
    reevalSec: 1800,
    note: "narrow band: will be rejected by the gate whenever the book leaves its range",
  },
  {
    name: "coin-flipper",
    strategy:
      "Ignore the book entirely. Alternate: buy UP when the seconds remaining is an even number, buy DOWN when it is odd.",
    minPrice: 20_000n,
    maxPrice: 980_000n,
    size: 2,
    reevalSec: 900,
    note: "a control. It should lose, in public, and that is the point",
  },
  {
    name: "always-abstain",
    strategy: "Never trade. Always answer ABSTAIN regardless of the market.",
    minPrice: 20_000n,
    maxPrice: 980_000n,
    size: 1,
    reevalSec: 1800,
    note: "the null hypothesis: proves ABSTAIN is a real, recorded outcome",
  },
  {
    name: "yolo-momentum",
    strategy:
      "Always take a side, never abstain. Buy UP if the UP price is above 0.50, otherwise buy DOWN, no matter how extreme the price is.",
    minPrice: 20_000n,
    maxPrice: 980_000n,
    size: 5,
    reevalSec: 900,
    note: "trips the price-band rule at the extremes: populates the REJECT rows",
  },
];

const factory = FACTORY();
const w = DRY_RUN ? null : wallet();
const dec = await collateralDecimals();

console.log(`seeding ${ROSTER.length} agents on factory ${factory}`);
console.log(DRY_RUN ? "DRY_RUN=true — nothing will be sent\n" : "");

for (const p of ROSTER) {
  const size = parseUnits(String(p.size), dec);
  const risk = {
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    maxSize: size,
    minHeadroom: 180,
    maxConcurrent: 3,
    maxNotional: size * 10n,
  };

  // Empty mandate arrays = "any". These agents trade whatever the venue lists,
  // which is the whole point: a new asset or cadence needs no redeploy.
  const args = [p.name, p.strategy, risk, [], [], [], p.reevalSec] as const;

  console.log(`${p.name}`);
  console.log(`  ${p.note}`);
  console.log(`  size=${p.size} band=${Number(p.minPrice) / 1e6}–${Number(p.maxPrice) / 1e6} reeval=${p.reevalSec}s`);

  if (DRY_RUN || !w) {
    console.log("  DRY_RUN would deployAgent(...)\n");
    continue;
  }

  const hash = await w.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "deployAgent",
    args: args as never,
    chain: null,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  deployed in ${hash} (block ${receipt.blockNumber})\n`);
}

console.log("done. Run `pnpm keeper` to start poking them.");
done(0);
