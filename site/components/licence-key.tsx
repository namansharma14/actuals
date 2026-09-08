"use client";

import { useActionState, useState } from "react";
import { issueLicence, type LicenceState } from "../app/account/actions";
import "./components.css";

const empty: LicenceState = {};

/** Only the hash is kept, so a key already issued can only ever be shown as its shape. */
const MASKED = `ak_${"\u2022".repeat(24)}`;

/**
 * The hero of the account. On first issue the key is shown once, large, with the exact line
 * to paste beneath it and its own copy button. Afterwards it is masked, with the day it was
 * issued and a reissue that asks twice.
 */
export function LicenceKey({ masked, issuedAt }: { masked: boolean; issuedAt: string | null }) {
  const [state, action, pending] = useActionState(issueLicence, empty);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);

  const line = state.key ? `actuals licence ${state.key}` : "";

  if (state.key) {
    return (
      <section className="ac-block ac-key">
        <p className="ac-question">Your licence key</p>
        <p className="ac-lede">Here it is, once. Copy it now, because this page will not show it again.</p>
        <div className="ac-key-value">{state.key}</div>
        <div className="ac-key-paste">
          <code>{line}</code>
          <button
            type="button"
            className="ac-key-copy"
            aria-label="copy the line to paste"
            onClick={() => {
              void navigator.clipboard.writeText(line).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                },
                () => undefined,
              );
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <p className="ac-note">The command sends this key and nothing else. It is the only credential it has.</p>
      </section>
    );
  }

  return (
    <section className="ac-block ac-key">
      <p className="ac-question">Your licence key</p>
      {masked ? (
        <>
          <div className="ac-key-value ac-key-masked">{MASKED}</div>
          <p className="ac-note">
            Issued {issuedAt ?? "earlier"}. If you lose it, issue a new one and the old one stops working.
          </p>
        </>
      ) : (
        <p className="ac-lede">
          One key, pasted once, is how the command proves a hosted page is yours. It is the only credential it has.
        </p>
      )}

      {state.error ? <p className="ac-err">{state.error}</p> : null}

      <form action={action} className="ac-key-do">
        {masked && !asking ? (
          <button type="button" className="ac-quiet" onClick={() => setAsking(true)}>
            Issue a new key
          </button>
        ) : null}
        {masked && asking ? (
          <>
            <p className="ac-warn-line">The key you have now stops working the moment a new one is issued.</p>
            <div className="ac-key-row">
              <button className="ac-btn" type="submit" disabled={pending}>
                {pending ? "Working" : "Issue a new key"}
              </button>
              <button type="button" className="ac-quiet ac-quiet-faint" onClick={() => setAsking(false)}>
                Keep the one I have
              </button>
            </div>
          </>
        ) : null}
        {!masked ? (
          <button className="ac-btn" type="submit" disabled={pending}>
            {pending ? "Working" : "Issue a key"}
          </button>
        ) : null}
      </form>
    </section>
  );
}
