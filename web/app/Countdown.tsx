"use client";

import { useEffect, useState } from "react";

/**
 * A ticking countdown.
 *
 * This is the cheapest and most convincing liveness signal on the page: even when
 * no agent is mid-decision, the board is visibly moving. It counts to an absolute
 * unix timestamp, so it stays correct across a re-render or a tab left open.
 */
export function Countdown({ to, className }: { to: number; className?: string }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, to - now);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <span className={className}>
      {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
    </span>
  );
}

/** Wall clock, so a viewer can see the page itself is alive. */
export function Clock() {
  const [t, setT] = useState<string>("");
  useEffect(() => {
    const tick = () => setT(new Date().toISOString().slice(11, 19) + "Z");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <b suppressHydrationWarning>{t || "—"}</b>;
}
