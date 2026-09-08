"use client";

/**
 * The landing's pinned beats, driven by the scroll (vision section 0, 2026-09-07: the scroll-driven
 * beats stay, the 3D tree and the night section go). Frame zero and the command beat share one
 * pinned track whose last quarter is the chapter's arrival: the report's frame draws itself around
 * the hero window and rides its chart onto the paper; the drawer slides the live report into the
 * frame; the frame shrinks to the status strip, then closes to the card; the receipt waits at the
 * end, in the page. Every value
 * is eased toward a target the scroll sets; `?snap=1` lands every ease at once so a frame is the
 * settled state. Without this script, reduced motion, or on a phone, the page is the static stack
 * scene.css lays out under `html:not([data-scene="pinned"])`.
 */
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { SceneData } from "./drawing-data";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const mix = (a: number, b: number, m: number): number => a + (b - a) * m;

export function Scene({ data }: { data: SceneData }) {
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = matchMedia("(max-width: 900px)").matches;
    const Q = new URLSearchParams(location.search);
    const instant = reduced || Q.has("snap");
    const html = document.documentElement;

    /* the window opens on the tallest tree on every device: the embed's own window is scrolled, never the page (a
       fragment in the iframe's src would scroll the page to it as well) */
    const win = document.querySelector<HTMLElement>("[data-window]");
    const embed = win?.querySelector("iframe") ?? null;
    const embedAt = win?.dataset.embedAt ?? "";
    const scrollEmbed = () => {
      try {
        const doc = embed?.contentDocument;
        const target = doc && embedAt ? doc.getElementById(embedAt) : null;
        if (target && embed?.contentWindow) embed.contentWindow.scrollTo(0, Math.max(0, target.offsetTop - 12));
      } catch {
        /* a cross-origin embed cannot be scrolled; the report is served from this origin */
      }
    };
    if (embed) {
      embed.addEventListener("load", scrollEmbed);
      scrollEmbed();
    }
    /* phones and reduced motion take the static stack, every figure at value; the drawer's final frame loads as it nears */
    if (narrow || reduced) {
      html.setAttribute("data-scene", "drawing");
      if (reduced) html.setAttribute("data-reduced", "1");
      if (!narrow) {
        /* the hero window's bottom edge lands on a whole row here too */
        const fitStatic = () => {
          try {
            const doc = embed?.contentDocument;
            const svg = Array.from(doc?.querySelectorAll<SVGSVGElement>("#instrument svg") ?? []).find((s) => s.getBoundingClientRect().height > 0);
            if (!win || !embed || !svg || !doc) return;
            const viewH = embed.clientHeight;
            const rows = [...Array.from(svg.querySelectorAll<SVGElement>("rect, line")), ...Array.from(doc.body.querySelectorAll<HTMLElement>("span, b, p, h1, h2, h3, li, td, text"))];
            let best = 0;
            rows.forEach((r) => {
              const b = r.getBoundingClientRect();
              if (b.height >= 3 && b.height <= 48 && b.width >= 6 && b.top >= 0 && b.bottom <= viewH - 6 && b.bottom > best) best = b.bottom;
            });
            if (best > 240) win.style.height = `${Math.round(best + 6 + (win.getBoundingClientRect().height - viewH))}px`;
          } catch {
            /* a cross-origin embed keeps its own layout */
          }
        };
        embed?.addEventListener("load", () => {
          scrollEmbed();
          setTimeout(fitStatic, 120);
          setTimeout(fitStatic, 700);
        });
        if (embed?.contentDocument?.readyState === "complete") setTimeout(fitStatic, 120);
      }
      const staticFrame = document.querySelector<HTMLIFrameElement>("[data-drawer-static] iframe[data-src]");
      let io: IntersectionObserver | null = null;
      if (staticFrame) {
        const load = () => {
          if (staticFrame.src) return;
          staticFrame.addEventListener(
            "load",
            () => {
              try {
                const doc = staticFrame.contentDocument;
                const panel = doc?.querySelector<HTMLElement>(".drawer");
                const secs = Array.from(doc?.querySelectorAll<HTMLElement>(".dr-sec") ?? []);
                const runsSec = secs.find((s) => (s.textContent ?? "").includes("drawn to time"));
                const first = doc?.querySelector<HTMLDetailsElement>("details.dr-run");
                if (!panel || !runsSec) return;
                if (first) first.open = true;
                panel.scrollTo(0, Math.max(0, runsSec.offsetTop - 18));
                /* the crop ends on a whole row */
                const pr = panel.getBoundingClientRect();
                const maxH = staticFrame.getBoundingClientRect().height;
                let best = 0;
                runsSec.querySelectorAll<HTMLElement>("details.dr-run").forEach((row) => {
                  const rb = row.getBoundingClientRect().bottom - pr.top;
                  if (rb <= maxH && rb > best) best = rb;
                });
                if (best > 120) staticFrame.style.height = `${Math.round(best)}px`;
              } catch {
                /* a cross-origin embed keeps its own scroll */
              }
            },
            { once: true },
          );
          staticFrame.src = staticFrame.dataset.src ?? "";
        };
        io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              load();
              io?.disconnect();
            }
          },
          { rootMargin: "60% 0px" },
        );
        io.observe(staticFrame);
      }
      return () => {
        io?.disconnect();
        embed?.removeEventListener("load", scrollEmbed);
        html.removeAttribute("data-scene");
        html.removeAttribute("data-reduced");
      };
    }
    html.setAttribute("data-scene", "pinned");
    gsap.registerPlugin(ScrollTrigger);
    /* the hero window's bottom edge lands on a whole row of the report's chart: the window's height is set from the
       last bar row that fits, measured inside the embed once it has opened on the instrument */
    const fitWindowRows = () => {
      try {
        const doc = embed?.contentDocument;
        /* the instrument keeps a wide and a narrow chart and shows one; the visible one has a size */
        const svg = Array.from(doc?.querySelectorAll<SVGSVGElement>("#instrument svg") ?? []).find((s) => s.getBoundingClientRect().height > 0);
        if (!win || !embed || !svg || !doc) return;
        const viewH = embed.clientHeight;
        /* every row-like thing the window shows: a bar of the chart, or a line of the report's own type */
        const rows = [...Array.from(svg.querySelectorAll<SVGElement>("rect, line")), ...Array.from(doc.body.querySelectorAll<HTMLElement>("span, b, p, h1, h2, h3, li, td, text"))];
        let best = 0;
        rows.forEach((r) => {
          const b = r.getBoundingClientRect();
          if (b.height >= 3 && b.height <= 48 && b.width >= 6 && b.top >= 0 && b.bottom <= viewH - 6 && b.bottom > best) best = b.bottom;
        });
        if (best > 240) {
          const chrome = win.getBoundingClientRect().height - viewH;
          win.style.height = `${Math.round(best + 6 + chrome)}px`;
        }
      } catch {
        /* a cross-origin embed keeps its own layout */
      }
    };
    let fitted = false;
    const fitNow = () => {
      fitWindowRows();
      fitted = Boolean(win?.style.height);
    };
    const onEmbedReady = () => {
      scrollEmbed();
      setTimeout(fitNow, 80);
      setTimeout(fitNow, 600);
    };
    embed?.addEventListener("load", onEmbedReady);
    if (embed?.contentDocument?.readyState === "complete") onEmbedReady();

    /* ------------------------------------------------------------- the page's parts */
    const openSec = document.querySelector<HTMLElement>("[data-beat='open']");
    const brightSec = document.querySelector<HTMLElement>("[data-beat='bright']");
    const drawerSec = document.querySelector<HTMLElement>("[data-beat='drawer']");
    const statusSec = document.querySelector<HTMLElement>("[data-beat='status']");
    const cardSec = document.querySelector<HTMLElement>("[data-beat='card']");
    const cardCopy = document.querySelector<HTMLElement>("[data-card-copy]");
    const cardEl = document.querySelector<HTMLButtonElement>("[data-frame-card]");
    const cardBack = cardEl?.querySelector<HTMLElement>(".sc-card-back") ?? null;
    const statusCopy = document.querySelector<HTMLElement>("[data-status-copy]");
    const statusTyped = document.querySelector<HTMLElement>("[data-status-typed]");
    const statusCaret = document.querySelector<HTMLElement>("[data-status-caret]");
    const statusText = statusTyped?.textContent ?? "";
    const statusFine = document.querySelector<HTMLElement>("[data-status-fine]");
    const drawerCopy = document.querySelector<HTMLElement>("[data-drawer-copy]");
    const frameEmbed = document.querySelector<HTMLElement>("[data-frame-embed]");
    const drawerFrame = frameEmbed?.querySelector("iframe") ?? null;
    const heroCopy = document.querySelector<HTMLElement>("[data-hero-copy]");
    const cmdCopy = document.querySelector<HTMLElement>("[data-cmd-copy]");
    const pill = document.querySelector<HTMLElement>("[data-pill]");
    const term = document.querySelector<HTMLElement>("[data-term]");
    const typedEl = document.querySelector<HTMLElement>("[data-typed]");
    const caret = document.querySelector<HTMLElement>("[data-caret]");
    const outLines = Array.from(document.querySelectorAll<HTMLElement>("[data-term] [data-k]"));
    const nav = document.querySelector<HTMLElement>("[data-nav]");
    const frameEl = document.querySelector<HTMLElement>("[data-frame]");
    const frameDoc = document.querySelector<HTMLElement>("[data-frame-doc]");
    const frameBody = document.querySelector<HTMLElement>(".sc-frame-body");
    const frameBar = document.querySelector<HTMLElement>(".sc-frame-bar");
    const figsEl = document.querySelector<HTMLElement>(".sc-figs");
    const keptHead = document.querySelector<HTMLElement>(".sc-kept-head");
    const paper = document.querySelector<HTMLElement>("[data-paper]");
    const paperCopy = document.querySelector<HTMLElement>("[data-paper-copy]");
    const figs = Array.from(document.querySelectorAll<HTMLElement>("[data-fig]"));
    const keptRows = Array.from(document.querySelectorAll<HTMLElement>("[data-row]"));
    if (!openSec || !brightSec) return;

    /* the drawer's embed is not reachable until it is on its way in: no focus lands in a document nobody can see */
    if (drawerFrame) {
      drawerFrame.setAttribute("aria-hidden", "true");
      drawerFrame.inert = true;
    }

    let pillRect: DOMRect | null = null;
    let winRect: DOMRect | null = null;
    let figsNatural = 0;
    let rowBottoms: number[] = [];
    const onResize = () => {
      pillRect = null;
      winRect = null;
      figsNatural = 0;
      rowBottoms = [];
      if (win) win.style.height = "";
      fitted = false;
      fitTries = 0;
    };
    window.addEventListener("resize", onResize);

    /* ------------------------------------------------------------- the scroll owns state */
    let op = 0;
    let afterOpen = false;
    let bp = 0;
    let inBright = false;
    let afterBright = false;
    let dp = 0;
    let inDrawer = false;
    let afterDrawer = false;
    let drawer = 0;
    let drawerTarget = 0;
    let drawerOpened = false;
    let sp = 0;
    let inStatus = false;
    let afterStatus = false;
    let strip = 0;
    let stripTarget = 0;
    let cp = 0;
    let inCard = false;
    let afterCard = false;
    let card = 0;
    let cardTarget = 0;
    let bright = 0;
    let brightTarget = 0;
    let rowCrop = 0;
    const st = (el: HTMLElement, onUpdate: (p: number, active: boolean) => void) =>
      ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => onUpdate(self.progress, self.isActive),
        onToggle: (self) => onUpdate(self.progress, self.isActive),
        onRefresh: (self) => onUpdate(self.progress, self.isActive),
      });
    const triggers = [
      st(openSec, (p, a) => {
        op = p;
        afterOpen = !a && p >= 1;
      }),
      st(brightSec, (p, a) => {
        bp = p;
        inBright = a;
        afterBright = !a && p >= 1;
      }),
    ];
    if (drawerSec) {
      triggers.push(
        st(drawerSec, (p, a) => {
          dp = p;
          inDrawer = a;
          afterDrawer = !a && p >= 1;
        }),
      );
    }
    if (statusSec) {
      triggers.push(
        st(statusSec, (p, a) => {
          sp = p;
          inStatus = a;
          afterStatus = !a && p >= 1;
        }),
      );
    }
    if (cardSec) {
      triggers.push(
        st(cardSec, (p, a) => {
          cp = p;
          inCard = a;
          afterCard = !a && p >= 1;
        }),
      );
    }
    /* the card: tilts under the pointer, flips to its post on a click or a press */
    const onCardMove = (e: PointerEvent) => {
      if (!cardEl) return;
      const r = cardEl.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cardEl.style.setProperty("--ty", `${(px * 10).toFixed(2)}deg`);
      cardEl.style.setProperty("--tx", `${(-py * 8).toFixed(2)}deg`);
    };
    const onCardLeave = () => {
      cardEl?.style.setProperty("--tx", "0deg");
      cardEl?.style.setProperty("--ty", "0deg");
    };
    const onCardClick = () => {
      if (!cardEl) return;
      const flipped = cardEl.getAttribute("aria-pressed") !== "true";
      cardEl.setAttribute("aria-pressed", flipped ? "true" : "false");
      cardBack?.setAttribute("aria-hidden", flipped ? "false" : "true");
    };
    cardEl?.addEventListener("pointermove", onCardMove);
    cardEl?.addEventListener("pointerleave", onCardLeave);
    cardEl?.addEventListener("click", onCardClick);

    const gut = () => parseFloat(getComputedStyle(html).getPropertyValue("--gut")) || 72;
    let typing: ReturnType<typeof setInterval> | null = null;
    let typedDone = false;
    const type = () => {
      const text = "npx actuals";
      if (!typedEl) return;
      if (instant) {
        typedEl.textContent = text;
        typedDone = true;
        return;
      }
      let i = 0;
      caret?.classList.add("on");
      typing = setInterval(() => {
        i += 1;
        typedEl.textContent = text.slice(0, i);
        if (i >= text.length) {
          if (typing) clearInterval(typing);
          typing = null;
          typedDone = true;
          caret?.classList.remove("on");
        }
      }, 45);
    };
    /* the command beat: the copy fades as the pill lands; the pill squares into one terminal line; the command
       types itself once; the output resolves one line per beat and the box grows a line at a time */
    const CMD_END = 0.7;
    const command = (vh: number, vw: number) => {
      const opc = clamp01(op / CMD_END);
      const m = clamp01((opc - 0.26) / 0.2);
      const fadeOut = clamp01((opc - 0.26) / 0.1);
      const fadeIn = clamp01((opc - 0.37) / 0.1);
      if (heroCopy) {
        heroCopy.style.opacity = String(1 - fadeOut);
        heroCopy.style.transform = `translateY(${(-24 * fadeOut).toFixed(1)}px)`;
      }
      if (cmdCopy && heroCopy) {
        cmdCopy.style.top = `${heroCopy.offsetTop}px`;
        cmdCopy.style.opacity = String(fadeIn);
        cmdCopy.style.transform = `translateY(${(24 * (1 - fadeIn)).toFixed(1)}px)`;
      }
      if (!pill || !term) return;
      if (m === 0 || !pillRect) pillRect = pill.getBoundingClientRect();
      const g = gut();
      const LH = 22.75;
      let resolved = 0;
      outLines.forEach((el) => {
        const k = Number(el.dataset.k);
        const r = clamp01((opc - 0.5 - k * 0.058) / 0.05);
        el.style.setProperty("--k", String(r));
        resolved += r;
      });
      const full = outLines.length + 1;
      const tw = Math.min(vw - 2 * g, 640);
      const th = LH + 36 + LH * resolved;
      const tt = Math.min(pillRect.top + 24, vh - (full * LH + 36) - g);
      term.style.left = `${mix(pillRect.left, g, m).toFixed(1)}px`;
      term.style.top = `${mix(pillRect.top, tt, m).toFixed(1)}px`;
      term.style.width = `${mix(pillRect.width, tw, m).toFixed(1)}px`;
      term.style.height = `${mix(pillRect.height, th, m).toFixed(1)}px`;
      term.style.borderRadius = `${mix(pillRect.height / 2, 8, m).toFixed(1)}px`;
      term.style.fontSize = `${mix(21, 13, m).toFixed(2)}px`;
      term.style.padding = `${mix(13, 18, m).toFixed(1)}px ${mix(26, 22, m).toFixed(1)}px`;
      /* the terminal belongs to the command beat: it leaves as the paper comes */
      const gone = clamp01(brightTarget / 0.1);
      term.style.opacity = String(clamp01((m - 0.1) / 0.3) * (1 - gone));
      term.style.visibility = gone >= 1 ? "hidden" : "";
      pill.style.opacity = String(1 - clamp01(m / 0.3));
      pill.style.pointerEvents = m > 0.3 ? "none" : "";
      term.classList.toggle("is-term", m >= 0.4);
      if (m >= 0.4 && !typedDone && !typing) type();
    };
    let fitTries = 0;
    const readState = () => {
      const vh = window.innerHeight;
      if (!fitted && fitTries < 240 && embed?.contentDocument?.readyState === "complete") {
        fitTries += 1;
        if (fitTries % 12 === 0) fitNow();
      }
      /* the night: the drawing regrows under the scroll along the session's time, its four annotations arriving as
         their moments pass; the three lines light as the growth reaches them */
      /* the chapter's ride begins in the arrival track's last quarter, over the hero window, so no position between
         the command beat and the chapter is empty */
      const bpp = afterBright ? 1 : inBright ? 0.28 + 0.72 * bp : afterOpen ? 0.28 : 0.28 * clamp01((op - 0.75) / 0.25);
      brightTarget = bpp;
      /* the drawer's beat begins once the chapter has ended under it (the beats overlap by one viewport) */
      drawerTarget = afterDrawer ? 1 : inDrawer ? clamp01((dp - 0.3) / 0.7) : 0;
      stripTarget = afterStatus ? 1 : inStatus ? sp : 0;
      cardTarget = afterCard ? 1 : inCard ? cp : 0;
      /* each beat's copy arrives with its beat and stays on its stage as the stage scrolls away, so no frame between
         two beats is empty on the left */
      cardCopy?.classList.toggle("on", cardTarget > 0.02);
      statusCopy?.classList.toggle("on", stripTarget > 0.02 && !inCard && !afterCard);
      if (statusTyped) {
        const tp = clamp01((stripTarget - 0.38) / 0.32);
        const shown = statusText.slice(0, Math.round(statusText.length * tp));
        if (statusTyped.textContent !== shown) statusTyped.textContent = shown;
        statusCaret?.classList.toggle("on", tp > 0 && tp < 1);
      }
      statusFine?.classList.toggle("on", stripTarget >= 0.75 && !afterStatus);
      /* the drawer's embed loads as the chapter passes its middle, so it is there before its beat */
      if (drawerFrame && !drawerFrame.src && drawerFrame.dataset.src && (bpp > 0.5 || inDrawer || afterDrawer)) drawerFrame.src = drawerFrame.dataset.src;
      drawerCopy?.classList.toggle("on", drawerTarget > 0.2 && !inStatus && !afterStatus);
      /* once the real drawer is in, it shows its runs drawn to time with one agent run open: the report's own
         controls, used as a reader would use them */
      if (drawerTarget > 0.4 && !drawerOpened && drawerFrame?.contentDocument?.readyState === "complete") {
        try {
          const doc = drawerFrame.contentDocument;
          const panel = doc.querySelector<HTMLElement>(".drawer");
          const secs = Array.from(doc.querySelectorAll<HTMLElement>(".dr-sec"));
          const runsSec = secs.find((s) => (s.textContent ?? "").includes("drawn to time"));
          const first = doc.querySelector<HTMLDetailsElement>("details.dr-run");
          if (panel && runsSec) {
            if (first) first.open = true;
            panel.scrollTo(0, Math.max(0, runsSec.offsetTop - 18));
            drawerOpened = true;
            /* the crop ends on a whole row: the last run row whose bottom fits the frame's body */
            const pr = panel.getBoundingClientRect();
            const bodyH = window.innerHeight - 104 - gut() - 36;
            let best = 0;
            runsSec.querySelectorAll<HTMLElement>("details.dr-run").forEach((row) => {
              const rb = row.getBoundingClientRect().bottom - pr.top;
              if (rb <= bodyH && rb > best) best = rb;
            });
            rowCrop = best > 120 ? Math.round(best) : 0;
          }
        } catch {
          drawerOpened = true;
        }
      }
      const atHero = op / CMD_END < 0.3;
      const inCmd = !atHero && brightTarget <= 0;
      /* the window dims a step for the command beat and comes back whole as the frame draws itself around it */
      if (win) win.style.opacity = String(inCmd ? 0.55 : 1);
      command(vh, window.innerWidth);
      nav?.classList.toggle("is-scrolled", window.scrollY > 24);
    };

    /* ------------------------------------------------------------- frame */
    let last = performance.now();
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      readState();
      const k = instant ? 1 : 1 - Math.pow(0.002, dt);
      bright += (brightTarget - bright) * k;
      drawer += (drawerTarget - drawer) * k;
      strip += (stripTarget - strip) * k;
      card += (cardTarget - card) * k;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const g = gut();
      /* the bright chapter: the panel leads, the frame follows inside it carrying the chart, and its document scrolls */
      const ride = clamp01(bright / 0.28);
      const leave = clamp01((drawer - 0.02) / 0.3);
      if (paper) {
        paper.style.transform = afterBright ? `translateX(${(leave * 100).toFixed(2)}%)` : `translateX(${((1 - ride) * 100).toFixed(2)}%)`;
        paper.classList.toggle("is-in", ride > 0 && !(afterBright && leave >= 1));
        paper.classList.toggle("is-full", ride >= 1 && !(afterBright && leave > 0));
      }
      {
        const panelEdge = ride > 0 ? (afterBright ? vw * leave : vw * (1 - ride)) : vw;
        nav?.classList.toggle("on-paper-links", panelEdge <= vw - g - 240);
        nav?.classList.toggle("on-paper-word", panelEdge <= g + 8);
      }
      if (paperCopy) {
        const words = clamp01((bright - 0.24) / 0.1) * (1 - clamp01(drawer / 0.12));
        paperCopy.style.opacity = String(words);
        paperCopy.style.transform = `translateY(${(16 * (1 - words)).toFixed(1)}px)`;
      }
      const chapter = inBright || afterBright || bright > 0;
      const drawerOn = afterBright && !afterCard;
      if (frameEl && chapter && (!afterBright || drawerOn)) {
        /* the frame's first box is the hero window: the report's frame draws itself around the window and carries
           its chart into the light, measured once while the arrival is pinned */
        if (!winRect && win) winRect = win.getBoundingClientRect();
        const L0 = winRect ? winRect.left : vw * 0.5;
        const T0 = Math.max(92, winRect ? winRect.top : 104);
        const W0 = winRect ? winRect.width : vw * 0.45;
        const H0 = winRect ? winRect.height : vh - 200;
        const edge = afterBright ? vw * leave : vw * (1 - ride);
        /* the panel column: where the frame rests once the paper is in; the leaving edge does not move it */
        const PL = Math.max(vw * 0.5, vw * (1 - ride) + 40);
        const PT = 104;
        const PW = vw - PL - g;
        const PH = vh - PT - g;
        const right = mix(L0 + W0, PL + PW, ride);
        /* the strip: the frame collapses to one line first (right edge fixed), then takes the strip's width */
        const shrink = clamp01((strip - 0.1) / 0.3);
        const shrinkH = clamp01(shrink / 0.6);
        const shrinkW = clamp01((shrink - 0.6) / 0.4);
        /* the card: the square forms over the middle of its beat and holds for the last three tenths */
        const square = clamp01((card - 0.05) / 0.5);
        const STRIP_W = Math.min(720, vw - 2 * g);
        /* the square: 568 px, so the sticker's 23-unit labels render at 12 px or more (their floor as marks) */
        const SQ = Math.min(568, vh * 0.64);
        const colC = (PL + (vw - g)) / 2;
        const L1 = mix(L0, PL, ride);
        const L2 = mix(L1, right - STRIP_W, shrinkW);
        const L = mix(L2, colC - SQ / 2, square);
        const T = mix(mix(mix(T0, PT, ride), vh * 0.5 - 22, shrinkH), vh * 0.5 - SQ / 2, square);
        const W = Math.max(120, mix(right - L2, SQ, square));
        let Hh = mix(mix(mix(H0, PH, ride), 44, shrinkH), SQ, square);
        /* the live report and the chrome switch together as the paper's edge passes the frame's centre */
        const embedOn = afterBright && edge > L + W / 2;
        /* the live report's crop ends on a whole row */
        if (rowCrop > 0 && afterBright && shrink <= 0 && square <= 0) Hh = Math.min(Hh, 36 + rowCrop);
        if (statusFine) {
          statusFine.style.left = `${(L + 16).toFixed(1)}px`;
          statusFine.style.top = `${(T + Hh + 14).toFixed(1)}px`;
        }
        frameEl.style.left = `${L.toFixed(1)}px`;
        frameEl.style.top = `${T.toFixed(1)}px`;
        frameEl.style.width = `${W.toFixed(1)}px`;
        frameEl.style.height = `${Hh.toFixed(1)}px`;
        frameEl.classList.toggle("on", ride > 0.02);
        /* the frame and its content are one object: the palette (border, bar, fills) switches as a unit the moment
           the frame's centre passes the panel's edge, and each palette is masked to its own ground */
        const onPaperNow = ride > 0 && L + W / 2 > edge && leave < 0.5;
        frameEl.classList.toggle("is-paper", onPaperNow);
        /* while it rides in, the dark frame is a border around the night's drawing, not a fill over it */
        frameEl.classList.toggle("is-riding", ride > 0 && ride < 1 && !afterBright);
        const sliding = (ride > 0 && ride < 1) || (afterBright && leave > 0 && leave < 1);
        /* while the paper slides under the nav, the nav is an opaque ground so its words never sit on a mixed blur */
        nav?.classList.toggle("is-sliding", sliding);
        frameEl.style.clipPath = sliding ? (onPaperNow ? `inset(0 0 0 ${Math.max(0, edge - L).toFixed(1)}px)` : `inset(0 ${Math.max(0, L + W - edge).toFixed(1)}px 0 0)`) : "";
        frameEl.classList.toggle("is-strip", shrink > 0.85 && square < 0.5);
        frameEl.classList.toggle("is-card", square > 0.5);
        frameEl.classList.toggle("is-live", (embedOn && strip < 0.05) || square > 0.5);
        frameEl.style.borderRadius = `${mix(mix(8, 6, shrink), 4, square).toFixed(1)}px`;
        if (drawerFrame) {
          const reach = embedOn && strip < 0.05;
          if (drawerFrame.inert === reach) {
            drawerFrame.inert = !reach;
            drawerFrame.setAttribute("aria-hidden", reach ? "false" : "true");
          }
        }
        /* into the strip, the live report and its chrome fade as one piece over the frame's own fill */
        const fadeOut = 1 - clamp01((strip - 0.1) / 0.28);
        if (frameEmbed) {
          frameEmbed.style.transform = embedOn ? "translateX(0)" : "translateX(100%)";
          frameEmbed.style.opacity = String(fadeOut);
        }
        if (frameBar) frameBar.style.opacity = String(square > 0 ? 1 - square : fadeOut);
        if (frameDoc && ride > 0) {
          /* the figures arrive over the chapter's first tenth: their block grows from nothing, so the chart sits at
             the top until they come and moves down as they do; a counting figure is never shown clipped */
          if (figsEl) {
            const arrive = clamp01((bright - 0.24) / 0.1);
            if (!figsNatural) {
              figsEl.style.height = "";
              figsNatural = figsEl.scrollHeight;
            }
            figsEl.style.height = arrive < 1 ? `${(figsNatural * arrive).toFixed(1)}px` : "";
            figsEl.style.opacity = String(clamp01((arrive - 0.85) / 0.15));
          }
          const view = Hh - 36;
          const docH = frameDoc.scrollHeight;
          const target = clamp01((bright - 0.5) / 0.42) * Math.max(0, docH - view);
          /* the crop ends on whole rows: the document rests where a row's bottom meets the frame's floor */
          if (!rowBottoms.length && keptRows.length && bright > 0.5) rowBottoms = keptRows.map((r) => r.offsetTop + r.offsetHeight);
          let doc = target;
          if (rowBottoms.length) {
            const stops = [0, ...rowBottoms.map((b) => b - view).filter((s) => s > 0 && s < docH - view), Math.max(0, docH - view)];
            doc = stops.reduce((best, s) => (s <= target + 0.5 && s > best ? s : best), 0);
          }
          if (frameBody) frameBody.scrollTop = doc;
          /* the document is there the moment the frame is on paper: the chart at value at once, the figures arriving after */
          frameDoc.style.opacity = String((onPaperNow ? 1 : 0) * (1 - clamp01((drawer - 0.2) / 0.15)));
          if (keptHead) keptHead.style.opacity = keptRows[0]?.style.opacity || "0";
        }
      } else frameEl?.classList.remove("on");
      figs.forEach((el) => {
        const kind = el.dataset.fig;
        const cnt = clamp01((bright - 0.26) / 0.3);
        const cost = data.head.cost * cnt;
        const commits = Math.round(data.head.commits * cnt);
        if (kind === "cost") el.textContent = `$${Math.round(cost).toLocaleString("en-US")}`;
        else if (kind === "commits") el.textContent = String(commits);
        else if (kind === "per") el.textContent = `$${(commits > 0 ? cost / commits : 0).toFixed(2)}`;
      });
      keptRows.forEach((el) => {
        el.style.opacity = String(clamp01((bright - 0.48 - Number(el.dataset.row) * 0.05) / 0.05));
      });
      html.dataset.sceneState = `bright ${bright.toFixed(2)} drawer ${drawer.toFixed(2)} strip ${strip.toFixed(2)} card ${card.toFixed(2)} afterOpen ${afterOpen} afterBright ${afterBright} afterDrawer ${afterDrawer}`;
    };
    gsap.ticker.add(frame);
    ScrollTrigger.refresh();

    return () => {
      gsap.ticker.remove(frame);
      triggers.forEach((t) => t.kill());
      window.removeEventListener("resize", onResize);
      cardEl?.removeEventListener("pointermove", onCardMove);
      cardEl?.removeEventListener("pointerleave", onCardLeave);
      cardEl?.removeEventListener("click", onCardClick);
      embed?.removeEventListener("load", scrollEmbed);
      embed?.removeEventListener("load", onEmbedReady);
      if (typing) clearInterval(typing);
      html.removeAttribute("data-scene");
      delete html.dataset.sceneState;
    };
  }, [data]);
  return null;
}
