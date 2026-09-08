import Link from "next/link";
import { COMMAND } from "../lib/constants";
import { CommandPill } from "./command-pill";
import { NavScroll } from "./nav-scroll";
import "./components.css";
import { hostedEnabled } from "../lib/hosted";

/**
 * The chrome every page but the landing wears, on the landing's system: the wordmark and
 * three words at the landing's gutter, so nothing jumps between pages; one footer row with
 * the same three words and the command at its small size. No bar, no eyebrow, no page name
 * beside the wordmark, no dropdown.
 *
 * The third word is `sign in` for a visitor (the word every product people know uses) and
 * the person's handle once signed in. Sign-in is a step, never a destination: it returns
 * the person to where they were headed.
 */
export function Shell({
  children,
  signedInAs,
  signOut,
}: {
  children: React.ReactNode;
  signedInAs?: string | null;
  signOut?: React.ReactNode;
}) {
  const third = signedInAs ? (
    <span className="ac-nav-me">
      <Link href="/account">{signedInAs}</Link>
      {signOut ? <span className="ac-nav-out">{signOut}</span> : null}
    </span>
  ) : (
    <Link href="/sign-in">sign in</Link>
  );

  return (
    <div className="ac-shell">
      <NavScroll />
      <header className="ac-nav">
        <Link className="ac-word" href="/" prefetch={false}>
          ACTUALS
        </Link>
        <nav className="ac-words">
          <Link href="/how-to-use">how to use</Link>
          {hostedEnabled() ? third : null}
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
          {hostedEnabled() ? <Link href={signedInAs ? "/account" : "/sign-in"}>{signedInAs ?? "sign in"}</Link> : null}
        </nav>
        <CommandPill command={COMMAND} size="foot" />
      </footer>
    </div>
  );
}
