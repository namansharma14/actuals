"use client";

import { useActionState } from "react";
import { registerInterest, type InterestState } from "../app/pricing/actions";
import "./components.css";

const empty: InterestState = {};

/**
 * One line, one address, one message later. The action is untouched; the words are the
 * site's, so the same sentence is printed wherever the field appears.
 */
export function InterestField({ tier, name }: { tier: "pro" | "max"; name: string }) {
  const [state, action, pending] = useActionState(registerInterest, empty);
  const id = `interest-${tier}`;

  if (state.done) return <p className="ac-note ac-note-done">Noted. One message when it opens, and nothing else.</p>;

  return (
    <form action={action} className="ac-field">
      <input type="hidden" name="tier" value={tier} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="ac-trap" />
      <label htmlFor={id}>Where to send the one message</label>
      <div className="ac-field-row">
        <input
          id={id}
          type="email"
          name="email"
          required
          maxLength={254}
          placeholder="you@example.com"
          autoComplete="email"
        />
        <button className="ac-btn" type="submit" disabled={pending}>
          {pending ? "Saving" : `Tell me when ${name} opens`}
        </button>
      </div>
      {state.error ? <p className="ac-err">{state.error}</p> : null}
    </form>
  );
}
