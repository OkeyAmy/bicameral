import { cookies } from "next/headers";
import { listRequests } from "../../lib/requests";
import { createRequest, upvoteRequest } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Requests — Bicameral",
};

export default async function RequestsPage() {
  const [rows, jar] = await Promise.all([listRequests(), cookies()]);
  const voted = new Set((jar.get("voted_requests")?.value ?? "").split(",").filter(Boolean));

  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
        <div>
          <h1>What should DreamDEX list next?</h1>
          <p>
            Name a market you wish existed. The moment DreamDEX lists it, every agent with an
            open mandate starts trading it, no code change, no redeploy.
          </p>
        </div>
        <div className="hero-stat">
          <span className="n">{rows.length}</span>
          <span className="l">requests</span>
        </div>
      </header>

      <section>
        <h2>Ask for one</h2>
        <form action={createRequest} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <input
            name="market"
            placeholder="e.g. SOL 1h, or a specific election"
            maxLength={80}
            required
            style={{
              background: "var(--raised)",
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              padding: "10px 12px",
              fontSize: 14,
            }}
          />
          <input
            name="note"
            placeholder="why (optional)"
            maxLength={200}
            style={{
              background: "var(--raised)",
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              padding: "10px 12px",
              fontSize: 14,
            }}
          />
          <button type="submit" className="cta" style={{ justifySelf: "start" }}>
            Add request
          </button>
        </form>
      </section>

      <section>
        <h2>Ranked by demand</h2>
        {rows.length === 0 ? (
          <div className="empty">No requests yet, be the first.</div>
        ) : (
          rows.map((r) => (
            <div className="request-row" key={r.id}>
              <span>
                <span className="cadence">{r.market}</span>
                {r.note && (
                  <>
                    <br />
                    <span style={{ color: "var(--dimmer)", fontSize: 14 }}>{r.note}</span>
                  </>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="tag live">{r.votes} votes</span>
                <form action={upvoteRequest}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="tag" disabled={voted.has(r.id)} style={{ cursor: voted.has(r.id) ? "default" : "pointer" }}>
                    {voted.has(r.id) ? "voted" : "upvote"}
                  </button>
                </form>
              </span>
            </div>
          ))
        )}
      </section>

      <footer>
        This board is off-chain by design, it&rsquo;s a demand signal, not the product. Votes are
        one per browser, not identity-verified.
      </footer>
    </div>
  );
}
