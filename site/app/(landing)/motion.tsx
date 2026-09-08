"use client";

/**
 * The scroll is the timeline. Everything here is progressive: the page is complete before
 * this runs, and with `prefers-reduced-motion` it never runs at all.
 *
 * One clock: Lenis drives the scroll, GSAP's ticker drives Lenis, ScrollTrigger reads it.
 * Devices used, one family per beat, never the same twice in a row: kinetic lines on the
 * heads; a scrubbed print for the terminal; counts on entry for the bill; a pinned scrub for
 * the tree, which is the peak and gets the most scroll room; a fade-and-rise for the fixes;
 * a typed line for the meter; and the receipt, this page's own move, which stamps a line as
 * each section passes.
 */
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

const FINE = "(hover: hover) and (pointer: fine)";

function fmt(n: number, pre: string, post: string, dp: number): string {
  const v = dp > 0 ? n.toFixed(dp) : Math.round(n).toLocaleString("en-US");
  return `${pre}${v}${post}`;
}

export function Motion() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const html = document.documentElement;
    html.setAttribute("data-lp-live", "1");
    gsap.registerPlugin(ScrollTrigger);

    /* ?snap=1 is the capture rig's settle flag: no smoothed scroll, so a frame is the settled state */
    const snap = new URLSearchParams(location.search).has("snap");
    const lenis = snap ? null : new Lenis({ lerp: 0.12, wheelMultiplier: 1 });
    lenis?.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis?.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      /* ------------------------------------------------------ the nav's ground */
      const nav = document.querySelector<HTMLElement>(".lp-nav");
      if (nav) {
        ScrollTrigger.create({
          start: 24,
          end: "max",
          onToggle: (self) => nav.classList.toggle("is-glass", self.isActive),
        });
      }

      /* ------------------------------------------- kinetic lines, scrubbed both ways */
      document.querySelectorAll<HTMLElement>(".lp-kin").forEach((head) => {
        const lines = head.querySelectorAll<HTMLElement>(".lp-line-in");
        const inHero = head.closest(".lp-hero") !== null;
        if (inHero) {
          gsap.from(lines, { yPercent: 110, duration: 0.9, ease: "power3.out", stagger: 0.09 });
          return;
        }
        gsap.fromTo(
          lines,
          { yPercent: 110 },
          { yPercent: 0, ease: "none", stagger: 0.12, scrollTrigger: { trigger: head, start: "top 92%", end: "top 62%", scrub: 0.5 } },
        );
      });

      /* ------------------------------------- fade and rise groups, scrubbed both ways */
      document.querySelectorAll<HTMLElement>("[data-in]").forEach((group) => {
        const kids = Array.from(group.children) as HTMLElement[];
        gsap.fromTo(
          kids,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, ease: "none", stagger: 0.1, scrollTrigger: { trigger: group, start: "top 92%", end: "top 64%", scrub: 0.5 } },
        );
      });

      /* ------------------------------------------------- counts, scrubbed both ways */
      document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
        const target = Number(el.dataset.count);
        const pre = el.dataset.pre ?? "";
        const post = el.dataset.post ?? "";
        const dp = Number(el.dataset.dp ?? 0);
        const final = el.textContent ?? "";
        const o = { v: target };
        gsap.fromTo(o, { v: 0 }, {
          v: target,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top 94%", end: "top 66%", scrub: 0.4 },
          onUpdate: () => (el.textContent = o.v >= target ? final : fmt(o.v, pre, post, dp)),
        });
      });

      /* ----------------------------------------------------- the hero's pointer */
      const hero = document.querySelector<HTMLElement>(".lp-hero");
      const win = document.querySelector<HTMLElement>(".lp-carry-win .lp-win");
      const copy = document.querySelector<HTMLElement>(".lp-hero-copy");
      if (hero && win && copy && matchMedia(FINE).matches) {
        const wx = gsap.quickTo(win, "x", { duration: 0.9, ease: "power3" });
        const wy = gsap.quickTo(win, "y", { duration: 0.9, ease: "power3" });
        const cx = gsap.quickTo(copy, "x", { duration: 1.1, ease: "power3" });
        const move = (e: MouseEvent) => {
          const px = e.clientX / innerWidth - 0.5;
          const py = e.clientY / innerHeight - 0.5;
          wx(px * -14);
          wy(py * -10);
          cx(px * 6);
        };
        const carry = hero.parentElement as HTMLElement;
        carry.addEventListener("mousemove", move);
        carry.addEventListener("mouseleave", () => {
          wx(0);
          wy(0);
          cx(0);
        });
      }
      if (win) gsap.from(win, { autoAlpha: 0, y: 28, scale: 0.985, duration: 1.1, ease: "power3.out", delay: 0.25 });

      /* --------------------------------------------------- the terminal prints */
      const out = document.querySelectorAll<HTMLElement>(".lp-term-out [data-out]");
      if (out.length) {
        gsap.set(out, { autoAlpha: 0 });
        gsap
          .timeline({ scrollTrigger: { trigger: ".lp-run", start: "top 70%", end: "top 15%", scrub: 0.4 } })
          .to(out, { autoAlpha: 1, duration: 0.2, stagger: 0.2, ease: "none" });
      }

      /* ------------------------------------------- deferred embeds load when their section arrives */
      document.querySelectorAll<HTMLIFrameElement>("iframe[data-src]:not([data-frame-embed] iframe)").forEach((f) => {
        ScrollTrigger.create({
          trigger: f,
          start: "top 120%",
          once: true,
          onEnter: () => {
            if (!f.src && f.dataset.src) f.src = f.dataset.src;
          },
        });
      });

      /* --------------------------------------------------------- the window covers */
      document.querySelectorAll<HTMLElement>('[data-cover="open"]').forEach((b) => {
        b.addEventListener("click", () => b.classList.add("is-open"));
      });

      /* ------------------------------------------------------------ the peak */
      const peak = document.querySelector<HTMLElement>(".lp-peak");
      const line = document.querySelector<SVGPathElement>(".lp-tree-line");
      const area = document.querySelector<SVGPathElement>(".lp-tree-area");
      const bars = Array.from(document.querySelectorAll<SVGRectElement>(".lp-tree-bar"));
      const peakN = document.querySelector<HTMLElement>("[data-peak]");
      const peakLine = document.querySelector<SVGLineElement>(".lp-tree-peakline");
      const peakDot = document.querySelector<SVGCircleElement>(".lp-tree-peakdot");
      if (peak && line && area && peakN) {
        const len = line.getTotalLength();
        const read = document.querySelector<HTMLElement>(".lp-peak-read");
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
        gsap.set(area, { clipPath: "inset(0 100% 0 0)" });
        gsap.set(bars, { scaleX: 0, transformOrigin: "left center" });
        gsap.set([peakLine, peakDot], { autoAlpha: 0 });
        if (read) gsap.set(read, { autoAlpha: 0, y: 8 });
        const peakAt = Number(peakDot?.getAttribute("cx") ?? 0) / 1000;
        const o = { v: 0 };
        /* the drawing starts while the stage is still sliding in, so the pin never opens on
           an empty screen, and it is complete a little before the stage lets go */
        const tl = gsap.timeline({
          scrollTrigger: { trigger: peak, start: "top 70%", end: "bottom 108%", scrub: 0.5 },
        });
        tl.to(line, { strokeDashoffset: 0, duration: 1, ease: "none" }, 0);
        tl.to(area, { clipPath: "inset(0 0% 0 0)", duration: 1, ease: "none" }, 0);
        bars.forEach((b) => {
          const a = Number(b.dataset.a ?? 0);
          tl.to(b, { scaleX: 1, duration: 0.04, ease: "none" }, a * 0.96);
        });
        if (read) tl.to(read, { autoAlpha: 1, y: 0, duration: 0.06 }, Math.max(0, peakAt - 0.16));
        tl.to(o, { v: 20, duration: 0.12, ease: "none", onUpdate: () => (peakN.textContent = String(Math.round(o.v))) }, Math.max(0, peakAt - 0.1));
        tl.to([peakLine, peakDot], { autoAlpha: 1, duration: 0.05 }, peakAt);

        /* the pointer: any bar names its run */
        const tip = document.querySelector<HTMLElement>(".lp-tip");
        const treeBox = document.querySelector<HTMLElement>(".lp-peak-tree");
        if (tip && treeBox && matchMedia(FINE).matches) {
          bars.forEach((b) => {
            b.addEventListener("mouseenter", () => {
              const d = b.dataset;
              tip.innerHTML = `<b>run ${d.run}</b> · depth ${d.depth} · ${d.minutes} min · <span data-fate="${d.fate}">${
                d.fate === "unknown" ? "no fate found" : d.fate
              }</span><i>${d.start} to ${d.end} UTC</i>`;
              tip.hidden = false;
            });
            b.addEventListener("mousemove", (e) => {
              const r = treeBox.getBoundingClientRect();
              const x = Math.min(e.clientX - r.left + 14, r.width - 260);
              tip.style.transform = `translate(${x}px, ${e.clientY - r.top - 54}px)`;
            });
            b.addEventListener("mouseleave", () => (tip.hidden = true));
          });
        }
      }

      /* -------------------------------------------------------- the meter types */
      const status = document.querySelector<HTMLElement>("[data-status]");
      if (status) {
        const text = status.textContent ?? "";
        status.textContent = "";
        status.classList.add("is-typing");
        ScrollTrigger.create({
          trigger: status,
          start: "top 85%",
          once: true,
          onEnter: () => {
            let i = 0;
            const id = setInterval(() => {
              i += 1;
              status.textContent = text.slice(0, i);
              if (i >= text.length) {
                clearInterval(id);
                status.classList.remove("is-typing");
              }
            }, 26);
          },
        });
      }

      /* ------------------------------------------------------------- the receipt */
      const receipt = document.querySelector<HTMLElement>(".lp-receipt");
      if (receipt && matchMedia("(min-width: 1100px)").matches) {
        const lines = (at: string) => Array.from(receipt.querySelectorAll<HTMLElement>(`[data-at="${at}"]`));
        const onCount = () => receipt.querySelectorAll(".is-on").length;
        let peekTimer: ReturnType<typeof setTimeout> | null = null;
        /* a fresh line brings the receipt out for a moment, then it tucks back to its tab */
        const peek = (ms: number) => {
          receipt.classList.add("is-peek");
          if (peekTimer) clearTimeout(peekTimer);
          peekTimer = setTimeout(() => receipt.classList.remove("is-peek"), ms);
        };
        document.querySelectorAll<HTMLElement>("[data-receipt]").forEach((sec) => {
          const at = sec.dataset.receipt ?? "";
          const mine = lines(at);
          if (!mine.length) return;
          ScrollTrigger.create({
            trigger: sec,
            start: at === "hero" ? "top 20%" : "top 55%",
            onEnter: () => {
              mine.forEach((l, i) => setTimeout(() => l.classList.add("is-on"), i * 140));
              /* the hero's lines are printed but the receipt itself only appears, and first
                 peeks, once the run section has passed: nothing peeks at frame zero */
              if (at !== "hero") {
                receipt.classList.add("is-live");
                peek(1600 + mine.length * 140);
              }
            },
            onLeaveBack: () => {
              mine.forEach((l) => l.classList.remove("is-on"));
              if (onCount() === 0) receipt.classList.remove("is-live");
            },
          });
        });
      }
    });

    /* phones and the drawing: the tree regrows as the night's section scrolls through */
    const drawing = document.querySelector<HTMLElement>("[data-drawing]");
    const night = document.querySelector<HTMLElement>("[data-beat='night']");
    if (drawing && night && document.documentElement.dataset.scene !== "webgl") {
      drawing.style.setProperty("--grow", "0");
      ScrollTrigger.create({
        trigger: drawing,
        start: "top 92%",
        end: "top 58%",
        onUpdate: (self) => drawing.style.setProperty("--grow", self.progress.toFixed(3)),
        onLeave: () => drawing.style.setProperty("--grow", "1"),
      });
    }
    ScrollTrigger.refresh();
    const onLoad = () => ScrollTrigger.refresh();
    window.addEventListener("load", onLoad);

    return () => {
      window.removeEventListener("load", onLoad);
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis?.destroy();
      html.removeAttribute("data-lp-live");
    };
  }, []);

  return null;
}
