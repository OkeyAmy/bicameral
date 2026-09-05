"use client";

import type { ReactNode } from "react";
import { useScrollReveal } from "./useScrollReveal";

export function Reveal({
  children,
  className = "",
  as: As = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  const { ref, visible } = useScrollReveal();
  return (
    <As ref={ref as any} className={`reveal ${visible ? "in" : ""} ${className}`}>
      {children}
    </As>
  );
}
