export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Requests — Bicameral",
};

export default function RequestsPage() {
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
          <span className="tag live">COMING SOON</span>
        </div>
      </header>

      <section>
        <h2>What this will be</h2>
        <p>
          A public board where anyone can suggest a market and vote it up. Ranked by demand, it
          becomes a live signal for what DreamDEX should list next — and since agent mandates
          are asset filters, not hardcoded lists, a newly listed market gets traded automatically
          the moment it exists on-chain.
        </p>
      </section>

      <footer>
        This board is off-chain by design, it&rsquo;s a demand signal, not the product.
      </footer>
    </div>
  );
}

/* -----------------------------------------------------------------------
 * Working implementation, parked pending launch. Re-enable by restoring this
 * body and the imports below.
 *
 * import { cookies } from "next/headers";
 * import Link from "next/link";
 * import { listRequests } from "../../lib/requests";
 * import { createRequest, upvoteRequest } from "./actions";
 *
 * function timeAgo(ts: number): string {
 *   const s = Math.floor((Date.now() - ts) / 1000);
 *   if (s < 60) return "just now";
 *   const m = Math.floor(s / 60);
 *   if (m < 60) return `${m}m ago`;
 *   const h = Math.floor(m / 60);
 *   if (h < 24) return `${h}h ago`;
 *   return `${Math.floor(h / 24)}d ago`;
 * }
 *
 * export default async function RequestsPage({
 *   searchParams,
 * }: {
 *   searchParams: Promise<{ sort?: string }>;
 * }) {
 *   const [rows, jar, { sort }] = await Promise.all([listRequests(), cookies(), searchParams]);
 *   const voted = new Set((jar.get("voted_requests")?.value ?? "").split(",").filter(Boolean));
 *
 *   const sorted =
 *     sort === "new" ? [...rows].sort((a, b) => b.createdAt - a.createdAt) : rows;
 *
 *   return (
 *     <div className="wrap" style={{ paddingTop: 40 }}>
 *       <header className="hero" style={{ borderBottom: "1px solid var(--line)" }}>
 *         <div>
 *           <h1>What should DreamDEX list next?</h1>
 *           <p>
 *             Name a market you wish existed. The moment DreamDEX lists it, every agent with an
 *             open mandate starts trading it, no code change, no redeploy.
 *           </p>
 *         </div>
 *         <div className="hero-stat">
 *           <span className="n">{rows.length}</span>
 *           <span className="l">requests</span>
 *         </div>
 *       </header>
 *
 *       <section>
 *         <h2>Suggest a market</h2>
 *         <form action={createRequest} className="req-form">
 *           <input
 *             name="market"
 *             className="req-input"
 *             placeholder="e.g. SOL 1h, or a specific election"
 *             maxLength={80}
 *             required
 *           />
 *           <input
 *             name="note"
 *             className="req-input"
 *             placeholder="Why would you trade this? (optional)"
 *             maxLength={200}
 *           />
 *           <button type="submit" className="cta" style={{ justifySelf: "start" }}>
 *             Add request
 *           </button>
 *         </form>
 *       </section>
 *
 *       <section>
 *         <div className="section-head">
 *           <h2>Ranked by demand</h2>
 *         </div>
 *         <div className="req-tabs">
 *           <Link href="/requests" className={`req-tab ${sort !== "new" ? "active" : ""}`}>
 *             Top
 *           </Link>
 *           <Link href="/requests?sort=new" className={`req-tab ${sort === "new" ? "active" : ""}`}>
 *             New
 *           </Link>
 *         </div>
 *
 *         {sorted.length === 0 ? (
 *           <div className="empty">No requests yet, be the first.</div>
 *         ) : (
 *           <div className="req-list">
 *             {sorted.map((r) => {
 *               const hasVoted = voted.has(r.id);
 *               return (
 *                 <div className="req-card" key={r.id}>
 *                   <form action={upvoteRequest}>
 *                     <input type="hidden" name="id" value={r.id} />
 *                     <button
 *                       type="submit"
 *                       className={`req-vote ${hasVoted ? "voted" : ""}`}
 *                       disabled={hasVoted}
 *                       aria-label={hasVoted ? "You voted for this" : "Vote for this"}
 *                     >
 *                       <span className="req-chevron">▲</span>
 *                       <span className="req-count">{r.votes}</span>
 *                     </button>
 *                   </form>
 *                   <div className="req-body">
 *                     <span className="req-title">{r.market}</span>
 *                     {r.note && <span className="req-note">{r.note}</span>}
 *                     <span className="req-meta">{timeAgo(r.createdAt)}</span>
 *                   </div>
 *                 </div>
 *               );
 *             })}
 *           </div>
 *         )}
 *       </section>
 *
 *       <footer>
 *         This board is off-chain by design, it&rsquo;s a demand signal, not the product. Votes are
 *         one per browser, not identity-verified.
 *       </footer>
 *     </div>
 *   );
 * }
 * ----------------------------------------------------------------------- */
