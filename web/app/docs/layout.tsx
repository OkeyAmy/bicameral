import Link from "next/link";
import type { ReactNode } from "react";

/** Every docs page shares this sidebar. Sections are ordered as you'd read them. */
const SECTIONS: { href: string; label: string; blurb: string }[] = [
  { href: "/docs", label: "Overview", blurb: "What this is" },
  { href: "/docs/reading-the-board", label: "Reading the board", blurb: "The Floor, ticker, tape, roster" },
  { href: "/docs/how-it-works", label: "How a decision happens", blurb: "The loop, end to end" },
  { href: "/docs/risk-gate", label: "The risk gate", blurb: "What the model can't do" },
  { href: "/docs/mandates", label: "Mandates", blurb: "Trading markets that don't exist yet" },
  { href: "/docs/contracts", label: "Contracts", blurb: "Architecture and addresses" },
  { href: "/docs/funding", label: "Funding an agent", blurb: "Collateral and fuel" },
  { href: "/docs/try-it", label: "Run one yourself", blurb: "Tokens, deploy, fund, keeper" },
  { href: "/docs/verify", label: "Verify it yourself", blurb: "Every claim, re-derivable" },
  { href: "/docs/platform", label: "What Somnia provides", blurb: "The host primitives used" },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="wrap docs">
      <aside className="docs-nav">
        <div className="docs-nav-inner">
          <div className="eyebrow-lg" style={{ marginBottom: 16 }}>
            Documentation
          </div>
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="docs-link">
              <span className="docs-link-label">{s.label}</span>
              <span className="docs-link-blurb">{s.blurb}</span>
            </Link>
          ))}
        </div>
      </aside>

      <article className="docs-body">{children}</article>
    </div>
  );
}
