"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One button, one answer. The redirect grants nothing; the payment notice is what changes a
 * plan. Signing in mid-purchase comes straight back here and finishes the same checkout,
 * which is what `resume` is for.
 */
export function BuyButton({
  plan,
  label,
  enabled,
  notConfigured,
  resume,
}: {
  plan: string;
  label: string;
  enabled: boolean;
  notConfigured: string;
  /** The answer a returning visitor was buying when they were asked to sign in. */
  resume?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const fired = useRef(false);

  const start = useCallback(() => {
    setState("working");
    void fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    })
      .then(async (res) => {
        const body = (await res.json()) as { url?: string; message?: string };
        if (res.status === 401) {
          const back = encodeURIComponent(`/pricing?buy=${plan}`);
          window.location.href = `/sign-in?redirect_url=${back}`;
          return;
        }
        if (!res.ok || !body.url) throw new Error(body.message ?? "the checkout could not start");
        window.location.href = body.url;
      })
      .catch((err: unknown) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "the checkout could not start");
      });
  }, [plan]);

  /* A returning visitor finishes the checkout they started, once. The query is cleared
     from the address first, so someone who declines to sign in and comes back is not sent
     to sign-in again on every load. */
  useEffect(() => {
    if (!enabled || resume !== plan || fired.current) return;
    fired.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("buy");
      window.history.replaceState(null, "", url.pathname + (url.search || ""));
      if (window.sessionStorage.getItem("actuals-buy-resumed") === plan) return;
      window.sessionStorage.setItem("actuals-buy-resumed", plan);
    } catch {
      /* no storage, no harm */
    }
    start();
  }, [enabled, plan, resume, start]);

  if (!enabled) {
    return (
      <span className="ac-unavailable" aria-disabled="true">
        {notConfigured}
      </span>
    );
  }

  return (
    <>
      <button type="button" className="ac-btn" disabled={state === "working"} onClick={start}>
        {state === "working" ? "Opening…" : label}
      </button>
      {state === "error" ? <p className="ac-err">{message}</p> : null}
    </>
  );
}
