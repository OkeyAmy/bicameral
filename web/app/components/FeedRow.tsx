import type { FeedRow } from "../../lib/floor";

const EXPLORER = "https://shannon-explorer.somnia.network";

/** One decision-feed row, shared between the Floor and an agent's detail page. */
export function FeedRowView({ r, showAgent = true }: { r: FeedRow; showAgent?: boolean }) {
  const stageClass =
    r.stage === "gate"
      ? r.gatePassed
        ? "pass"
        : "reject"
      : r.stage === "order" || r.stage === "settled"
        ? "pass"
        : r.stage === "expired" || r.stage === "failed"
          ? "reject"
          : "pending";

  return (
    <div className={`feed-row ${stageClass}`}>
      <span className="blk">#{r.block}</span>
      {showAgent ? (
        <span className="who">{r.agentName ?? r.agent.slice(0, 10)}</span>
      ) : (
        <span className="who" />
      )}
      <span className="what">
        {r.stage === "asked" && <>asked the on-chain LLM…</>}
        {r.stage === "verdict" && (
          <>
            <b>
              {r.agreeing}/{r.subcommittee} validators agreed
            </b>{" "}
            → {r.verdictLabel}
          </>
        )}
        {r.stage === "gate" && (
          <>
            gate <b>{r.gatePassed ? "PASS" : "REJECT"}</b>
            {!r.gatePassed && <> - {r.gateLabel}</>}
            {r.gatePassed && r.price !== undefined && (
              <>
                {" "}
                @ {r.price.toFixed(3)} × {r.quantity}
              </>
            )}
          </>
        )}
        {r.stage === "order" && (
          <>
            order filled <b>{r.quantity}</b> @ {r.price?.toFixed(3)}
          </>
        )}
        {r.stage === "settled" && <>settled and redeemed</>}
        {r.stage === "expired" && <>request timed out, pending slot cleared</>}
        {r.stage === "failed" && <>no consensus reached</>}
      </span>
      <span>
        {r.tx && (
          <a className="tag" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer">
            tx
          </a>
        )}
      </span>
    </div>
  );
}
