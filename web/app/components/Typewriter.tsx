"use client";

import { useEffect, useRef, useState } from "react";

/** Types a string out once it scrolls into view. Own implementation, not vibe4trading's. */
export function Typewriter({ text, speed = 55 }: { text: string; speed?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState("");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    if (shown.length >= text.length) return;
    const id = window.setTimeout(() => setShown(text.slice(0, shown.length + 1)), speed);
    return () => window.clearTimeout(id);
  }, [started, shown, text, speed]);

  return (
    <span ref={ref}>
      {shown}
      <span className="caret">_</span>
    </span>
  );
}
