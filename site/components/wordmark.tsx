import Link from "next/link";
import "./components.css";

/** The product's own mark, and the one machine face the chrome earns. Never a page name beside it. */
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link className="ac-word" href={href}>
      ACTUALS
    </Link>
  );
}
