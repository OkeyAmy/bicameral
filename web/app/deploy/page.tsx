import { getWindows, factoryAddress } from "../../lib/floor";
import { factoryAbi } from "@bicameral/runner/src/contracts.js";
import { DeployForm } from "./DeployForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Deploy — Bicameral",
};

const EXAMPLES = [
  {
    label: "Fade the extremes",
    risk: "Loses if a real breakout keeps running past the edge instead of reverting.",
    prompt:
      "Fade the crowd and always decide. If the UP price is above 0.75 buy DOWN; if it is below 0.25 buy UP; otherwise bet against whichever side is above 0.62 or below 0.38. Never abstain unless the price is within 0.02 of an edge the strategy can't read.",
  },
  {
    label: "Ride the momentum",
    risk: "Loses if the trend reverses right before expiry and the price snaps back.",
    prompt:
      "Ride the momentum and never sit out. Bet on whichever side, UP or DOWN, has shown rising price and volume, or is trending from the current mid. If UP is above 0.55 buy UP, if below 0.45 buy DOWN, otherwise buy whichever side the current mid leans away from.",
  },
  {
    label: "Coin flip",
    risk: "Has no edge by design, expect it to roughly break even before fees.",
    prompt: "Flip a coin: choose UP or DOWN at random for this window, with no analysis of price or volume. Never abstain.",
  },
];

// Reused from contracts/test/RiskGate.t.sol's canonical defaults, so the
// number this page shows is the number the deployed agent actually runs
// with, not a UI-only estimate.
const RISK = {
  minPrice: 20_000,
  maxPrice: 980_000,
  maxSize: 5_000_000,
  minHeadroom: 180,
  maxConcurrent: 3,
  maxNotional: 50_000_000,
};

export default async function DeployPage() {
  const factory = factoryAddress();
  const { windows } = factory ? await getWindows() : { windows: [] };
  const assets = [...new Set(windows.map((w) => w.asset))].sort();
  const cadences = [...new Set(windows.map((w) => w.intervalSec))].sort((a, b) => a - b);

  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
        <div>
          <h1>Deploy an agent.</h1>
          <p>
            Write a strategy in English. Everything else, the on-chain LLM call, the risk gate,
            the DreamDEX order, is the same immutable contract every agent on this board runs.
          </p>
        </div>
      </header>

      {!factory ? (
        <div className="empty">
          Deploy isn&rsquo;t live yet, the factory contract hasn&rsquo;t been deployed to
          testnet. Check back soon.
        </div>
      ) : (
        <DeployForm
          factory={factory}
          abi={factoryAbi}
          examples={EXAMPLES}
          risk={RISK}
          assets={assets}
          cadences={cadences}
        />
      )}
    </div>
  );
}
