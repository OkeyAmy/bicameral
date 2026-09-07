"use client";

import { useEffect, useRef, useState } from "react";
import type { TickerItem } from "../api/ticker/route";

/**
 * The nav ticker — a continuous marquee of what the system just did.
 *
 * Its job is liveness: on a page where the interesting events are minutes
 * apart, something has to be visibly moving or a first-time visitor assumes
 * nothing works. It carries real rows (agent verdicts, gate calls, fills) and
 * falls back to live market quotes so it still moves before any agent has acted.
 *
 * This is driven by requestAnimationFrame rather than a CSS animation, on
 * purpose:
 *  - a CSS marquee dies when the track re-renders (every 20s refetch) or when
 *    `prefers-reduced-motion` strips the animation, and it stops under the
 *    cursor;
 *  - a JS loop translates a fixed offset and, the moment the offset exceeds the
 *    width of one copy, wraps it by exactly that width. The DOM is identical at
 *    both ends of the wrap (same items, duplicated), so the loop is seamless
 *    and *cannot* stop at the end — the offset always lands back inside one
 *    copy. Refetching keeps the current position and just tabs in new items.
 */
export function Ticker() {
  const [items, setItems] = useState<TickerItem[] | null>(null);
  const [reduced, setReduced] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

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

  useEffect(() => {
    const track = trackRef.current;
    if (!track || reduced) return;

    let raf = 0;
    let prev = 0;

    // Fixed pixel speed: the copy width already grows with the feed, so a
    // fixed speed reads the same at any length and never "runs to the end".
    const SPEED = 40; // px per second
    const measure = () => track.firstElementChild?.clientWidth ?? 0;

    const frame = (t: number) => {
      const dt = prev ? t - prev : 16;
      prev = t;

      const w = measure();
      if (w > 0) {
        offsetRef.current -= (SPEED * dt) / 1000;
        // Wrap seamlessly: once we've scrolled past a full copy, add its width
        // back. The duplicate content makes the jump invisible and the loop
        // endless — the offset always lands back inside one copy.
        if (offsetRef.current <= -w) offsetRef.current += w;
        track.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      track.style.transform = "";
    };
  }, [items, reduced]);

  const body = (it: TickerItem) => (
    <>
      <span className={`ticker-dot ${it.tone}`} />
      <span className="ticker-who">{it.who}</span>
      <span className="ticker-what">{it.what}</span>
    </>
  );

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

  return (
    <div className="ticker">
      <div
        className="ticker-track"
        ref={trackRef}
        /* Screen readers get one static copy, not an infinite scroll. */
        aria-label="Recent on-chain activity"
      >
        {reduced
          ? [0]
          : [0, 1].map((copy) => (
              <div className="ticker-run" key={copy} aria-hidden={copy === 1}>
                {items.map((it, i) =>
                  it.href ? (
                    <a
                      className="ticker-item"
                      key={`${copy}-${i}`}
                      href={it.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {body(it)}
                    </a>
                  ) : (
                    <span className="ticker-item" key={`${copy}-${i}`}>
                      {body(it)}
                    </span>
                  ),
                )}
              </div>
            ))}
      </div>
    </div>
  );
}