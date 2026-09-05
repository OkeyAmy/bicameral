"use client";

import { useEffect, useState } from "react";
import type { TickerItem } from "../api/ticker/route";

/**
 * The nav ticker — a continuous marquee of what the system just did.
 *
 * Its job is liveness: on a page where the interesting events are minutes
 * apart, something has to be visibly moving or a first-time visitor assumes
 * nothing works. It carries real rows (agent verdicts, gate calls, fills) and
 * falls back to live market quotes so it still moves before any agent has acted.
 *
 * The track renders its items TWICE and animates to -50%. At that point the
 * second copy sits exactly where the first started, so the loop is seamless
 * with no jump and no JS driving the animation.
 */
export function Ticker() {
  const [items, setItems] = useState<TickerItem[] | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/ticker");
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.items)) setItems(data.items);
      } catch {
        /* keep whatever is on screen rather than blanking it */
      }
    };

    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!items || items.length === 0) {
    return (
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track ticker-idle">
          <span className="ticker-item">
            <span className="ticker-dot market" />
            <span className="ticker-who">reading chain logs</span>
          </span>
        </div>
      </div>
    );
  }

  // Slower when there is more to read, so scroll speed stays constant.
  const seconds = Math.max(28, items.length * 5);

  return (
    <div className="ticker">
      <div
        className="ticker-track"
        style={{ animationDuration: `${seconds}s` }}
        /* Screen readers get one static copy, not an infinite scroll. */
        aria-label="Recent on-chain activity"
      >
        {[0, 1].map((copy) => (
          <div className="ticker-run" key={copy} aria-hidden={copy === 1}>
            {items.map((it, i) => {
              const body = (
                <>
                  <span className={`ticker-dot ${it.tone}`} />
                  <span className="ticker-who">{it.who}</span>
                  <span className="ticker-what">{it.what}</span>
                </>
              );
              return it.href ? (
                <a
                  className="ticker-item"
                  key={`${copy}-${i}`}
                  href={it.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {body}
                </a>
              ) : (
                <span className="ticker-item" key={`${copy}-${i}`}>
                  {body}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
