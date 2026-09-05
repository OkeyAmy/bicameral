import Link from "next/link";
import { Ticker } from "./Ticker";

/** Brand + nav + live activity ticker, shared across every route. */
export function SiteHeader() {
  return (
    <div className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          BICAMERAL
        </Link>
        <nav>
          <Link href="/">Floor</Link>
          <Link href="/windows">Windows</Link>
          <Link href="/agents">Agents</Link>
          <Link href="/requests">Requests</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/deploy">Deploy</Link>
        </nav>
      </div>
      <Ticker />
    </div>
  );
}
