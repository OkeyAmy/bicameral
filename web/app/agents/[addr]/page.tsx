import { notFound } from "next/navigation";
import type { Address } from "viem";
import { getAgents, getFeed } from "../../../lib/floor";
import { DecisionTape } from "../../components/DecisionTape";
import { OwnerPanel } from "../../components/OwnerPanel";
import { traderAbi } from "@bicameral/runner/src/contracts.js";
import { COLLATERAL_ADDRESS } from "../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPLORER = "https://shannon-explorer.somnia.network";

export default async function AgentDetail({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  const [agents, feed] = await Promise.all([
    getAgents().catch(() => []),
    getFeed(2000).catch(() => []),
  ]);

  const agent = agents.find((a) => a.address.toLowerCase() === addr.toLowerCase());
  if (!agent) notFound();

  const rows = feed.filter((r) => r.agent.toLowerCase() === addr.toLowerCase());
  const verdicts = rows.filter((r) => r.stage === "verdict");
  const rejects = rows.filter((r) => r.stage === "gate" && !r.gatePassed).length;
  const settled = rows.filter((r) => r.stage === "settled").length;
  const consensus = verdicts.length
    ? Math.round(
        (verdicts.reduce((n, r) => n + (r.agreeing ?? 0) / (r.subcommittee || 1), 0) /
          verdicts.length) *
          100,
      )
    : undefined;

  return (
    <div className="wrap">
      <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
        <div>
          <h1>{agent.name}</h1>
          <p>{agent.strategy}</p>
          <p>
            <a href={`${EXPLORER}/address/${agent.address}`} target="_blank" rel="noreferrer" className="addr">
              {agent.address}
            </a>
            {" · owner "}
            <a href={`${EXPLORER}/address/${agent.owner}`} target="_blank" rel="noreferrer" className="addr">
              {agent.owner}
            </a>
          </p>
        </div>
        <div className="hero-stat">
          <span className="n">{agent.decisions ?? 0}</span>
          <span className="l">decisions made</span>
        </div>
      </header>

      <section>
        <h2>At a glance</h2>
        <div className="stat-row">
          <span className="tag live">{agent.fuel ?? 0} fuel left</span>
          <span className="tag">{rejects} gate rejections</span>
          <span className="tag">{settled} settled</span>
          <span className="tag">{consensus !== undefined ? `${consensus}% consensus` : "—"}</span>
          {agent.paused && <span className="tag stop">PAUSED</span>}
        </div>
      </section>

      <OwnerPanel
        agent={agent.address as Address}
        owner={agent.owner as Address}
        traderAbi={traderAbi}
        collateral={COLLATERAL_ADDRESS as Address | null}
      />

      <section>
        <h2>History</h2>
        <DecisionTape rows={rows} showAgent={false} />
      </section>

      <footer>
        Somnia Shannon testnet (chain 50312) · this history is re-derivable independently with{" "}
        <code>pnpm index &amp;&amp; pnpm verify</code>
      </footer>
    </div>
  );
}
