"use client";

import { useEffect, useRef } from "react";

/**
 * The hero centerpiece: three validator nodes broadcasting rings of consensus
 * toward a shared centre, rendered as a monospace ascii dither field. It is a
 * literal picture of the pitch, three independent validators converging on one
 * answer, not decoration borrowed from anywhere else.
 */
export function AsciiField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ramp = " .:-=+*#%@";
    const cell = 15;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    let raf = 0;

    function resize() {
      const parent = canvas!.parentElement;
      width = parent ? parent.clientWidth : 600;
      height = parent ? parent.clientHeight : 500;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(width / cell);
      rows = Math.floor(height / cell);
    }

    resize();
    window.addEventListener("resize", resize);

    const cx = () => width / 2;
    const cy = () => height / 2;
    const radius = () => Math.min(width, height) * 0.32;
    const anchors = [90, 210, 330].map((deg) => (deg * Math.PI) / 180);
    const period = 4200; // ms for one ring cycle, tuned so the three meet at centre together

    function frame(t: number) {
      ctx!.clearRect(0, 0, width, height);
      ctx!.font = `${cell}px var(--font-geist-mono, monospace)`;
      ctx!.textBaseline = "top";

      const phase = (t % period) / period; // 0..1
      const ringR = radius() * (1 - phase); // shrinks toward centre
      const flash = phase > 0.94 ? (1 - phase) / 0.06 : 0; // brief bloom on arrival

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * cell + cell / 2;
          const y = row * cell + cell / 2;

          let b = 0.05 + 0.04 * Math.sin(x * 0.02 + t * 0.0006) * Math.sin(y * 0.02 - t * 0.0004);

          for (const a of anchors) {
            const ax = cx() + Math.cos(a) * radius();
            const ay = cy() + Math.sin(a) * radius();
            const d = Math.hypot(x - ax, y - ay);
            const ringDist = Math.abs(d - (radius() - ringR));
            b = Math.max(b, Math.exp(-(ringDist * ringDist) / 220));
          }

          b = Math.max(b, flash * Math.exp(-(Math.hypot(x - cx(), y - cy()) ** 2) / 3200));
          b = Math.min(1, b);

          if (b < 0.06) continue;
          const char = ramp[Math.min(ramp.length - 1, Math.floor(b * ramp.length))];
          ctx!.fillStyle = `rgba(240, 169, 59, ${Math.min(1, b + 0.08).toFixed(3)})`;
          ctx!.fillText(char, x - cell / 2, y - cell / 2);
        }
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    }

    if (reduced) {
      frame(period * 0.94);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
