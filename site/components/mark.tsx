import "./components.css";

/**
 * The mark that says how a number was made. Every figure derived from a report carries one;
 * numbers that are ours (prices, credits, runs left) carry none. Never boxed, never
 * coloured, never a pill.
 */
export type MarkKind = "measured" | "estimated" | "example";

export function Mark({ kind }: { kind: MarkKind }) {
  return <span className="ac-mark">{kind}</span>;
}
