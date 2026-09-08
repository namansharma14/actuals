import "./components.css";

/**
 * One answer to the one question the pricing page asks. Three short lines and one action.
 * The free answer carries the most weight by size, never by colour, and never by a flag.
 */
export function Answer({
  name,
  price,
  lines,
  action,
  current,
  lead,
}: {
  name: string;
  price: string;
  lines: string[];
  action?: React.ReactNode;
  /** The answer this account is already on. Marked, never coloured. */
  current?: boolean;
  /** The one that carries the weight: free, and local, forever. */
  lead?: boolean;
}) {
  return (
    <div className="ac-answer" data-lead={lead ? "1" : undefined} data-current={current ? "1" : undefined}>
      <div className="ac-answer-head">
        <h3 className="ac-answer-name">{name}</h3>
        {current ? <span className="ac-answer-mine">yours</span> : null}
      </div>
      <div className="ac-answer-price">{price}</div>
      <div className="ac-answer-lines">
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      {action ? <div className="ac-answer-do">{action}</div> : null}
    </div>
  );
}
