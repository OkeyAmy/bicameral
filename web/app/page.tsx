import Link from "next/link";
import { getWindows, getAgents } from "../lib/floor";
import { Clock } from "./Countdown";
import { MarketTable } from "./components/MarketTable";
import { AsciiField } from "./components/AsciiField";
import { Typewriter } from "./components/Typewriter";
import { Reveal } from "./components/Reveal";

// Live board: never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPLORER = "https://shannon-explorer.somnia.network";

export default async function Landing() {
  // The landing Floor shows the live market board and the headline counts, then
  // hands off. Per-decision history belongs on the routes built for it —
  // `/agents` for the roster, `/agents/[addr]` for one agent's full record —
  // where it can be read in context instead of stacking up under the pitch.
  // The nav ticker already carries "something just happened" everywhere.
  const [{ windows, head }, agents] = await Promise.all([
    getWindows(),
    getAgents().catch(() => []),
  ]);

  const totalDecisions = agents.reduce((n, a) => n + (a.decisions ?? 0), 0);
  const liveAgents = agents.filter((a) => !a.paused).length;

  return (
    <main className="landing">
      {/* ============================================================ hero */}
      <section className="scene hero-scene">
        <div className="scene-inner">
          <div className="eyebrow-lg">Somnia × DreamDEX Event Contracts</div>

          <div className="hero-art">
            <AsciiField />
            <span className="float-label l1">on-chain LLM</span>
            <span className="float-label l2">no server · no hot key</span>
            <span className="float-label l3">3/3 validator consensus</span>
            <span className="float-label l4">dreamdex event contracts</span>
          </div>

          <h1 className="headline">
            A trading agent
            <br />
            that lives inside a smart contract.
          </h1>
          <p className="lede">
            Other AI agents run on someone&rsquo;s laptop and post conclusions to a chain. This one
            has no laptop. Three validators run Somnia&rsquo;s on-chain LLM, agree on an answer,
            and the same transaction trades on DreamDEX.
          </p>

          <div className="cta-row">
            <a href="#floor" className="cta">
              Enter the Floor
            </a>
            <Link href="/agents" className="cta cta-ghost">
              View agents
            </Link>
          </div>
        </div>
      </section>

      {/* ========================================================= problem */}
      <Reveal className="scene">
        <div className="scene-inner">
          <p className="lede" style={{ fontSize: "clamp(15px, 2vw, 20px)", color: "var(--ink)" }}>
            You can&rsquo;t check what the model was asked.
            <br />
            You can&rsquo;t check if the record was cherry-picked.
            <br />
            You can&rsquo;t check if a human quietly stepped in.
          </p>
          <h2 className="headline" style={{ marginTop: 34 }}>
            <Typewriter text="Every trust guarantee is social." />
          </h2>
        </div>
      </Reveal>

      {/* ======================================================== solution */}
      <Reveal className="scene">
        <div className="scene-inner">
          <h2 className="headline">
            <Typewriter text="So make it verifiable instead." />
          </h2>
          <p className="lede" style={{ marginTop: 24 }}>
            Three validators run the same model and reach consensus before an answer is accepted.
            The contract asks the question and trades on the answer in one transaction, with a
            public receipt anyone can reopen.
          </p>
        </div>
      </Reveal>

      {/* ==================================================== how it works */}
      <Reveal className="scene">
        <div className="scene-inner" style={{ maxWidth: 1040 }}>
          <h2 className="headline">
            <Typewriter text="How a decision happens" />
          </h2>
          <div className="step-grid">
            <div className="step-card">
              <div className="num">01</div>
              <h3>Prompt, in English</h3>
              <p>Stored on-chain as plain text, the only thing an owner controls.</p>
            </div>
            <div className="step-card">
              <div className="num">02</div>
              <h3>On-chain inference</h3>
              <p>The contract asks Somnia&rsquo;s LLM. Validators agree on one answer.</p>
            </div>
            <div className="step-card">
              <div className="num">03</div>
              <h3>Solidity risk gate</h3>
              <p>Immutable bounds on size, price, and expiry can overrule the model. Rejections show, never hidden.</p>
            </div>
            <div className="step-card">
              <div className="num">04</div>
              <h3>DreamDEX order</h3>
              <p>One transaction places and later redeems the order. No keeper ever holds a key that can trade.</p>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ============================================================ floor */}
      <section className="scene floor-scene" id="floor">
        <div className="scene-inner">
          <div className="status">
            <div className="status-inner">
              <span>
                <span className="pulse" />
                Somnia Shannon
              </span>
              <span>
                block <b>{head.toString()}</b>
              </span>
              <span>
                windows <b>{windows.length}</b>
              </span>
              <span>
                agents <b>{liveAgents}</b>
              </span>
              <span>
                decisions <b>{totalDecisions}</b>
              </span>
              <span>
                utc <Clock />
              </span>
              <span style={{ marginLeft: "auto" }}>source: chain logs · no key</span>
            </div>
          </div>

          <div className="wrap" style={{ paddingTop: 40 }}>
            <div className="eyebrow-lg" style={{ textAlign: "left" }}>
              The Floor
            </div>
            <p className="sub" style={{ marginTop: 10 }}>
              Nothing here is hardcoded, it&rsquo;s whatever DreamDEX is running right now, read
              from <code>MarketCreated</code> logs with no key and no indexer.
            </p>

            <section>
              <div className="section-head">
                <div>
                  <h2>Open windows</h2>
                  <p className="sub">
                    Every tradable DreamDEX Event Contract right now. Up and Down share one book,
                    so a Down price is always one minus the Up price.
                  </p>
                </div>
                {agents.length > 0 && (
                  <Link href="/agents" className="tag">
                    {agents.length} agent{agents.length === 1 ? "" : "s"} trading →
                  </Link>
                )}
              </div>

              {windows.length === 0 ? (
                <div className="empty">
                  No live windows right now, the venue may be between windows.
                  <br />
                  Verify independently: <code>pnpm discover</code>
                </div>
              ) : (
                <MarketTable windows={windows} />
              )}
            </section>

            <footer>
              Somnia Shannon testnet (chain 50312) · DreamDEX Event Contracts · every number on
              this page is re-derivable with <code>pnpm index &amp;&amp; pnpm verify</code>
            </footer>
          </div>
        </div>
      </section>

      {/* ========================================================== final */}
      <Reveal className="scene">
        <div className="scene-inner">
          <h2 className="headline">
            <Typewriter text="Delegate without custody." />
          </h2>
          <p className="lede">
            No key to hand over. The contract holds its own collateral, bounded by Solidity, not
            a prompt.
          </p>
          <div className="cta-row">
            <a href="#floor" className="cta">
              Watch it decide
            </a>
            <Link href="/agents" className="cta cta-ghost">
              Read every prompt
            </Link>
          </div>
        </div>
      </Reveal>

      <footer style={{ textAlign: "center", padding: "0 24px 48px" }}>
        <p className="eyebrow-lg">Somnia Shannon testnet (chain 50312) · DreamDEX Event Contracts</p>
      </footer>
    </main>
  );
}
