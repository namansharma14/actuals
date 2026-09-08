import Link from "next/link";
import "./components.css";

/**
 * The frame for a screen with one job (sign in, connect a computer): the wordmark, the
 * person's handle when there is one, and a centred column. No nav beyond the wordmark, no
 * footer. The words on the screen say why it exists.
 */
export function Focus({ children, handle }: { children: React.ReactNode; handle?: string | null }) {
  return (
    <div className="ac-shell ac-focus">
      <header className="ac-focus-bar">
        <Link className="ac-word" href="/">
          ACTUALS
        </Link>
        {handle ? <span className="ac-focus-handle">{handle}</span> : null}
      </header>
      <main className="ac-focus-main">{children}</main>
    </div>
  );
}
