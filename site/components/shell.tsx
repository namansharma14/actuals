import Link from "next/link";
import { COMMAND } from "../lib/constants";
import { CommandPill } from "./command-pill";
import { NavScroll } from "./nav-scroll";
import "./components.css";

/**
 * The chrome every page but the landing wears, on the landing's system: the wordmark and
 * the one word at the landing's gutter, so nothing jumps between pages; one footer row with
 * the same word and the command at its small size. No bar, no eyebrow, no page name beside
 * the wordmark, no dropdown.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ac-shell">
      <NavScroll />
      <header className="ac-nav">
        <Link className="ac-word" href="/" prefetch={false}>
          ACTUALS
        </Link>
        <nav className="ac-words">
          <Link href="/how-to-use">how to use</Link>
        </nav>
      </header>

      <main className="ac-main">{children}</main>

      <footer className="ac-foot">
        <Link className="ac-word" href="/" prefetch={false}>
          ACTUALS
        </Link>
        <p className="ac-foot-line">the receipt for your coding agents</p>
        <nav className="ac-words ac-words-foot">
          <Link href="/how-to-use">how to use</Link>
        </nav>
        <CommandPill command={COMMAND} size="foot" />
      </footer>
    </div>
  );
}
