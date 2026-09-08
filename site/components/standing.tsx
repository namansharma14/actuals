import "./components.css";

/**
 * The plan, what is left, and the credits, as one line rather than a panel. These numbers
 * are ours, not the report's, so none of them carries a mark.
 */
export function Standing({ plan, left, credits }: { plan: string; left: string; credits: number }) {
  return (
    <p className="ac-standing">
      <span className="ac-standing-plan">{plan}</span> {left}{" "}
      {credits > 0 ? `${credits} run ${credits === 1 ? "credit" : "credits"} in hand.` : "No run credits in hand."}
    </p>
  );
}
