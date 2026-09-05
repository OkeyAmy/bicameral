import Link from "next/link";
import { getAgents, getFeed } from "../../lib/floor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Agents — Bicameral",
};

export default async function AgentsPage() {
  const [agents, feed] = await Promise.all([
    getAgents().catch(() => []),
    getFeed(2000).catch(() => []),
  ]);

  const stats = new Map(
    agents.map((a) => {
      const rows = feed.filter((r) => r.agent.toLowerCase() === a.address.toLowerCase());
      const verdicts = rows.filter((r) => r.stage === "verdict");
      const gates = rows.filter((r) => r.stage === "gate");
      const rejects = gates.filter((r) => !r.gatePassed);
      const settled = rows.filter((r) => r.stage === "settled").length;
      const consensus = verdicts.length
        ? verdicts.reduce((n, r) => n + (r.agreeing ?? 0) / (r.subcommittee || 1), 0) /
          verdicts.length
        : undefined;
      return [
        a.address,
        { verdicts: verdicts.length, rejects: rejects.length, settled, consensus },
      ] as const;
    }),
  );

  const ranked = [...agents].sort((a, b) => (b.decisions ?? 0) - (a.decisions ?? 0));

  return (
    <div className="wrap">
      <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
        <div>
          <h1>Every agent, one implementation.</h1>
          <p>
            One immutable contract, cloned per agent, each with its own prompt. Ranked by
            decisions made, not claimed returns. Prompts are public because they live on-chain.
          </p>
        </div>
        <div className="hero-stat">
          <span className="n">{agents.length}</span>
          <span className="l">agents deployed</span>
        </div>
      </header>

      <section>
        <h2>Roster</h2>
        {ranked.length === 0 ? (
          <div className="empty">No agents deployed yet.</div>
        ) : (
          ranked.map((a) => {
            const s = stats.get(a.address);
            return (
              <Link className="agent" key={a.address} href={`/agents/${a.address}`}>
                <div className="agent-head">
                  <span className="name">{a.name}</span>
                  <span className="addr">{a.address}</span>
                  <span className={`tag ${(a.fuel ?? 0) > 5 ? "live" : "stop"}`}>
                    {a.fuel ?? 0} fuel left
                  </span>
                  <span className="tag">{a.decisions ?? 0} decisions</span>
                  <span className="tag">{s?.rejects ?? 0} gate rejections</span>
                  <span className="tag">
                    {s?.consensus !== undefined ? `${Math.round(s.consensus * 100)}% consensus` : "—"}
                  </span>
                  <span className="tag">{s?.settled ?? 0} settled</span>
                  {a.paused && <span className="tag stop">PAUSED</span>}
                </div>
                <div className="strategy">{a.strategy}</div>
              </Link>
            );
          })
        )}
      </section>

      <footer>
        Somnia Shannon testnet (chain 50312) · realized P&amp;L is not shown here yet, it needs the
        indexer path and isn&rsquo;t faked in the meantime.
      </footer>
    </div>
  );
}
