import type { ReactNode } from "react";

/**
 * Rendered by Next.js during any soft navigation while the target page's
 * server render streams in. Without it the browser shows nothing for the
 * ~seconds a floor page takes to build, which reads (correctly) as a broken
 * link. It also means the nav + ticker keep animating under it, so the page
 * stays visibly alive.
 */
export default function Loading(): ReactNode {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-glyph" aria-hidden="true" />
      <span>reading chain</span>
    </div>
  );
}