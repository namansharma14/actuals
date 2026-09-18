/**
 * The Workbench's browser code, in three pieces so the embed never carries the app's.
 *
 * WB_CORE_JS drives the page itself: which view the main pane shows, the list and its filter,
 * the sheets, the trust popover, the keys and the count-up. It touches no network.
 * WB_APP_JS adds everything that needs the local server: the session view, the label, the fix
 * plan and its apply and undo, the scope re-run, the card on a canvas and the live view.
 * WB_EMBED_JS adds the inlined per-session views and marks labels read-only.
 *
 * Vanilla, no dependencies, relative URLs only. Every mutating call carries the per-launch
 * token, which is embedded in the app page and nowhere else.
 */

export const WB_CORE_JS = `
(function () {
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var W = { loadSession: null, onLive: null, onSheet: null, onScope: null, onSave: null };
  window.__wb = W;
  var root = $(".wb"), main = $("#wb-main"), rows = $("#wb-rows"), body = $("#wb-session-body");
  var panes = { top: $("#panel-report"), session: $("#instrument"), live: $("#panel-live") };
  var sheet = $("#wb-sheet"), scrim = $("#wb-scrim"), sheetTitle = $("#wb-sheet-title"), trust = $("#wb-trust");
  var sel = null, pane = "top", sheetOn = null;
  var motion = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  W.$ = $; W.$$ = $$; W.body = function () { return body; };

  function setHash(h) { try { history.replaceState(null, "", location.pathname + location.search + h); } catch (e) {} }
  function narrow() { return window.innerWidth <= 900; }
  function show(name) {
    pane = name;
    for (var k in panes) if (panes[k]) panes[k].hidden = k !== name;
    if (root && narrow()) root.setAttribute("data-nav", "main");
    if (main) main.scrollTop = 0;
    W.pane = name;
  }
  function markRow() {
    $$(".wb-row", rows).forEach(function (b) {
      var on = b.hasAttribute("data-top") ? pane === "top" : (b.getAttribute("data-session") === sel && pane === "session");
      b.setAttribute("aria-current", on ? "true" : "false");
    });
  }
  function openTop() { sel = null; show("top"); markRow(); setHash(""); }
  function openLive() { if (!panes.live) return; show("live"); markRow(); if (W.onLive) W.onLive(); }
  function openSession(id) {
    if (!id || !W.loadSession || !body) return;
    W.loadSession(id, function (html, err) {
      body.innerHTML = html || '<p class="wb-note">' + (err || "this session is not in this report") + "</p>";
      sel = id; show("session"); markRow(); setHash("#session=" + id);
      if (W.afterSession) W.afterSession(id);
    });
  }
  W.openTop = openTop; W.openSession = openSession; W.openLive = openLive;

  // the filter, over the rows already on the page
  var q = $("#wb-q"), count = $("#wb-count");
  function visible() { return $$(".wb-row[data-session]", rows).filter(function (b) { return !b.hidden; }); }
  function runFilter() {
    var v = q ? q.value.trim().toLowerCase() : "";
    var n = 0;
    $$(".wb-row[data-session]", rows).forEach(function (b) {
      var on = !v || (b.getAttribute("data-title") || "").indexOf(v) >= 0;
      b.hidden = !on; if (on) n += 1;
    });
    if (count) count.textContent = n + (n === 1 ? " session" : " sessions");
  }
  if (q) q.addEventListener("input", runFilter);

  // the sheets
  function openSheet(name) {
    if (!sheet) return;
    sheetOn = name; sheet.hidden = false; if (scrim) scrim.hidden = false;
    var f = $("#wb-fixes"), sh = $("#wb-share");
    if (f) f.hidden = name !== "fixes";
    if (sh) sh.hidden = name !== "share";
    if (sheetTitle) sheetTitle.textContent = name === "fixes" ? "Fixes for this repo" : "Share the sticker";
    sheet.scrollTop = 0;
    if (W.onSheet) W.onSheet(name);
  }
  function closeSheet() { sheetOn = null; if (sheet) sheet.hidden = true; if (scrim) scrim.hidden = true; }
  W.openSheet = openSheet;

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var s = t.closest("[data-sheet]"); if (s) { openSheet(s.getAttribute("data-sheet")); return; }
    var top = t.closest(".wb-row[data-top]"); if (top) { openTop(); return; }
    var row = t.closest(".wb-row[data-session]"); if (row) { openSession(row.getAttribute("data-session")); return; }
    if (t.closest("#tab-live")) { openLive(); return; }
    if (t.closest("#wb-sheet-close") || t.closest("#wb-scrim")) { closeSheet(); return; }
    var nav = t.closest("#wb-nav");
    if (nav && root) { root.setAttribute("data-nav", root.getAttribute("data-nav") === "list" ? "main" : "list"); return; }
    var run = t.closest(".wb-run-head");
    if (run) {
      var files = run.parentNode ? run.parentNode.querySelector(".wb-run-files") : null;
      if (files) { files.hidden = !files.hidden; run.setAttribute("aria-expanded", files.hidden ? "false" : "true"); }
      return;
    }
    var lb = t.closest(".wb-lbtn");
    if (lb) { $$(".wb-lbtn", body).forEach(function (x) { x.setAttribute("data-on", x === lb ? "1" : "0"); }); readyLabel(); return; }
  });

  function readyLabel() {
    var save = $("#wb-lsave", body);
    if (save) save.setAttribute("data-ready", $$('.wb-lbtn[data-on="1"]', body).length ? "1" : "0");
  }
  function cycleLabel() {
    var btns = $$(".wb-lbtn", body);
    if (!btns.length) return;
    var i = -1;
    for (var n = 0; n < btns.length; n++) if (btns[n].getAttribute("data-on") === "1") i = n;
    var next = btns[(i + 1) % btns.length];
    btns.forEach(function (x) { x.setAttribute("data-on", x === next ? "1" : "0"); });
    readyLabel();
  }
  W.readyLabel = readyLabel;

  // the keys, never while typing
  document.addEventListener("keydown", function (ev) {
    var t = ev.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = ev.key, list = visible(), i = -1;
    for (var n = 0; n < list.length; n++) if (list[n].getAttribute("data-session") === sel) i = n;
    if (k === "j" || k === "ArrowDown") { ev.preventDefault(); if (list.length) openSession(list[Math.min(list.length - 1, i + 1)].getAttribute("data-session")); }
    else if (k === "k" || k === "ArrowUp") { ev.preventDefault(); if (i <= 0) openTop(); else openSession(list[i - 1].getAttribute("data-session")); }
    else if (k === "Escape") { if (sheetOn) closeSheet(); else if (trust && trust.open) trust.open = false; else openTop(); }
    else if (k === "f") { ev.preventDefault(); openSheet("fixes"); }
    else if (k === "s") { ev.preventDefault(); openSheet("share"); }
    else if (k === "v") { if (panes.live) { ev.preventDefault(); openLive(); } }
    else if (k === "l") { if (pane === "session") { ev.preventDefault(); cycleLabel(); } }
  });

  // the hero is already at its value in the HTML; the count-up only runs when script and motion do
  var hero = $("#wb-hero");
  if (hero && motion) {
    var target = String(hero.getAttribute("data-to") || "");
    var to = parseInt(target.replace(/,/g, ""), 10);
    if (!isNaN(to)) {
      var suffix = target.replace(/^[0-9,]+/, ""), t0 = 0, done = false;
      var step = function (now) {
        if (done) return;
        if (!t0) t0 = now;
        var p = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - p, 3);
        hero.textContent = Math.round(to * e) + suffix;
        if (p < 1) requestAnimationFrame(step); else done = true;
      };
      requestAnimationFrame(step);
      // whatever happens to the frame loop, the figure lands on its real value and stays there
      setTimeout(function () { done = true; hero.textContent = target; }, 1500);
    }
  }

  W.start = function () {
    if (root) root.setAttribute("data-nav", "main");
    runFilter();
    var qs = null; try { qs = new URLSearchParams(location.search); } catch (e) { qs = null; }
    var panel = qs ? qs.get("panel") : null;
    var id = (qs ? qs.get("session") : null) || (location.hash.indexOf("#session=") === 0 ? decodeURIComponent(location.hash.slice(9)) : null);
    if (panel === "fixes") { openTop(); openSheet("fixes"); return; }
    if (panel === "share") { openTop(); openSheet("share"); return; }
    if (panel === "live" && panes.live) { openLive(); return; }
    if (id && panel !== "top") { openSession(id); return; }
    openTop();
  };
})();
`;

export const WB_EMBED_JS = `
(function () {
  var W = window.__wb, E = window.__actualsEmbed || { drawers: {} };
  if (!W) return;
  W.loadSession = function (id, done) { done(E.drawers[id] || null, "this session is not in this preview"); };
  W.afterSession = function () {
    var body = W.body(); if (!body) return;
    var save = W.$("#wb-lsave", body); if (save) save.hidden = true;
    var note = W.$(".wb-lnote", body); if (note) note.setAttribute("readonly", "readonly");
    var msg = W.$(".wb-lmsg", body); if (msg) msg.textContent = "labels are saved in the app";
    W.$$(".wb-lbtn", body).forEach(function (b) { b.disabled = true; });
  };
  W.start();
})();
`;

export const WB_APP_JS = `
(function () {
  var W = window.__wb, A = window.__actuals;
  if (!W || !A) return;
  var $ = W.$, $$ = W.$$;
  function api(path, payload) {
    var init = { method: payload ? "POST" : "GET", headers: { "x-actuals-token": A.token } };
    if (payload) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(payload); }
    return fetch(path, init).then(function (res) {
      return res.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!res.ok) throw new Error((j && j.error) || (res.status + " " + res.statusText));
        return j;
      });
    });
  }

  W.loadSession = function (id, done) {
    api("/api/session/" + encodeURIComponent(id)).then(function (j) { done(j.html, null); }).catch(function (e) { done(null, e.message); });
  };
  W.afterSession = function () { W.readyLabel(); };

  document.addEventListener("click", function (ev) {
    var t = ev.target; if (!t || !t.closest) return;
    var seg = t.closest("[data-project]");
    if (seg) {
      if (seg.getAttribute("aria-pressed") === "true") return;
      seg.disabled = true;
      api("/api/run", { project: seg.getAttribute("data-project") }).then(function () { location.hash = ""; location.reload(); }).catch(function (e) { seg.disabled = false; seg.title = e.message; });
      return;
    }
    var save = t.closest("#wb-lsave");
    if (save) {
      var body = W.body(); if (!body) return;
      var picked = $('.wb-lbtn[data-on="1"]', body), msg = $(".wb-lmsg", body), note = $(".wb-lnote", body);
      if (!picked) { if (msg) msg.textContent = "pick a state first"; return; }
      save.disabled = true; if (msg) msg.textContent = "saving, then re-running";
      api("/api/label", { target: save.getAttribute("data-session"), target_kind: "session", state: picked.getAttribute("data-label"), note: note ? note.value : "" })
        .then(function () { location.reload(); })
        .catch(function (e) { if (msg) msg.textContent = e.message; save.disabled = false; });
      return;
    }
    var act = t.closest("[data-act]");
    if (act) { fixAct(act); return; }
  });

  // fixes: the real diff is fetched when the sheet opens, so the change is on screen before the one confirm
  var plansLoaded = false;
  W.onSheet = function (name) {
    if (name === "fixes" && !plansLoaded) { plansLoaded = true; loadPlans(); }
    if (name === "share") drawCard();
  };
  function loadPlans() {
    $$(".wb-fixact").forEach(function (box) {
      if (box.getAttribute("data-applied") === "1") return;
      var id = box.getAttribute("data-fix"), fix = box.parentNode;
      api("/api/fix/plan", { id: id }).then(function (j) {
        var b = fix ? fix.querySelector(".wb-diff-b") : null;
        if (b && j.diff) b.innerHTML = diffHtml(j.diff);
        var note = fix ? fix.querySelector(".wb-fnote") : null;
        if (note && j.files) note.textContent = j.files.length ? j.files.length + (j.files.length === 1 ? " file" : " files") + " would change" : "nothing left to change";
      }).catch(function () { /* the snippet from the report stays on screen */ });
    });
  }
  function lesc(x) { return String(x).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function diffHtml(text) {
    return String(text).split("\\n").map(function (line) {
      var sign = line.charAt(0) === "+" ? "+" : line.charAt(0) === "-" ? "-" : line.charAt(0) === "@" ? "@" : "";
      var cls = sign === "+" ? " add" : sign === "-" ? " cut" : "";
      return '<div class="wb-dl' + cls + '"><span class="wb-ds">' + lesc(sign) + '</span><span class="wb-dt">' + lesc(sign ? line.slice(1) : line) + "</span></div>";
    }).join("");
  }
  function fixAct(btn) {
    var box = btn.closest(".wb-fixact"); if (!box) return;
    var id = box.getAttribute("data-fix"), note = box.querySelector(".wb-fnote"), fix = box.parentNode;
    var tag = fix ? fix.querySelector(".wb-tag") : null;
    var what = btn.getAttribute("data-act");
    btn.disabled = true;
    api("/api/fix/" + what, { id: id }).then(function (j) {
      btn.disabled = false;
      var on = what === "apply" && j.applied !== false;
      box.setAttribute("data-applied", on ? "1" : "0");
      btn.setAttribute("data-act", on ? "undo" : "apply");
      btn.textContent = on ? "undo" : "apply to this repo";
      btn.className = on ? "wb-fbtn ghost" : "wb-fbtn";
      if (tag) { tag.textContent = on ? "applied" : "ready"; tag.className = "wb-tag"; }
      if (note) note.textContent = (j.notes && j.notes.join(" ")) || (on ? "applied · undo restores byte for byte" : "");
    }).catch(function (e) { btn.disabled = false; if (note) note.textContent = e.message; });
  }

  // the card: the same drawing the command writes, rasterized here for copy and save
  var drawn = null;
  function drawCard() {
    var cv = $("#sticker"), msg = $("#stk-msg");
    if (!cv || !A.sticker || drawn) return;
    drawn = new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { var ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height); res(true); };
      im.onerror = function () { rej(new Error("could not draw the card")); };
      im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(A.sticker.svg);
    });
    drawn.catch(function (e) { if (msg) msg.textContent = e.message; });
  }
  function png() { return drawn.then(function () { return new Promise(function (res, rej) { var cv = $("#sticker"); cv.toBlob(function (b) { if (b) res(b); else rej(new Error("could not render the card")); }, "image/png"); }); }); }
  $$("[data-stk]").forEach(function (b) {
    b.addEventListener("click", function () {
      var msg = $("#stk-msg"), what = b.getAttribute("data-stk");
      function say(t) { if (msg) msg.textContent = t; }
      if (!drawn) drawCard();
      png().then(function (blob) {
        if (what === "copy") {
          if (!navigator.clipboard || !window.ClipboardItem) throw new Error("this browser cannot copy images; save the PNG instead");
          return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(function () { say("copied"); setTimeout(function () { say("1080 by 1080 PNG · aggregates only"); }, 1500); });
        }
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "actuals-sticker.png"; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); say("saved actuals-sticker.png");
      }).catch(function (e) { say(e.message); });
    });
  });

  // the live view: the session running now, drawn to time as the hooks record it. Redraw whole on
  // each frame, so there is nothing to animate and reduced motion is honoured for free.
  var liveOn = false, es = null, liveTree = null, liveSelId = null, liveDetailId = null, liveErr = null;
  W.onLive = function () { startLive(); };
  function startLive() {
    if (liveOn) return; liveOn = true;
    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource("/api/live/stream?token=" + encodeURIComponent(A.token));
        es.onopen = function () { liveErr = null; };
        es.onmessage = function (ev) { liveErr = null; try { drawLive(JSON.parse(ev.data)); } catch (e) {} };
        es.onerror = function () { liveErr = "reconnecting to the live feed"; paintErr(); };
        return;
      } catch (e) {}
    }
    (function poll() { api("/api/live").then(function (s) { liveErr = null; drawLive(s); }).catch(function () { liveErr = "reconnecting to the live feed"; paintErr(); }); setTimeout(poll, 2000); })();
  }
  function lhm(iso) { return iso && iso.length >= 16 ? String(iso).slice(11, 16) : ""; }
  function lmoney(n) { if (n === null || n === undefined) return "n/a"; var a = Math.abs(n); return "$" + (a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2)); }
  function lfate(r) { if (r.fate === "died") return "var(--warn)"; return r.depth <= 1 ? "var(--d1)" : r.depth === 2 ? "var(--d2)" : "var(--d3)"; }
  function llanes(runs) {
    var sorted = runs.slice().sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.depth - b.depth; });
    var ends = [], out = [];
    sorted.forEach(function (run) {
      var st = Date.parse(run.start), en = Date.parse(run.end), lane = -1;
      for (var i = 0; i < ends.length; i++) { if (ends[i] <= st) { lane = i; break; } }
      if (lane === -1) { lane = ends.length; ends.push(en); } else ends[lane] = en;
      out.push({ run: run, lane: lane });
    });
    return { placed: out, lanes: ends.length };
  }
  function lcurve(runs, t0, t1) {
    var ev = []; runs.forEach(function (r) { ev.push([Date.parse(r.start), 1]); ev.push([Date.parse(r.end), -1]); });
    ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var lvl = 0, pts = [[t0, 0]]; ev.forEach(function (e) { pts.push([e[0], lvl]); lvl += e[1]; pts.push([e[0], lvl]); }); pts.push([t1, 0]);
    return pts;
  }
  function runById(id) { if (!liveTree) return null; for (var i = 0; i < liveTree.runs.length; i++) if (liveTree.runs[i].id === id) return liveTree.runs[i]; return null; }
  function runName(r) { var mins = Math.max(0, Math.round((Date.parse(r.end) - Date.parse(r.start)) / 60000)); return (r.agent_type || "agent") + " · " + String(r.fate).replace(/_/g, " ") + " · " + mins + " min"; }
  function highlight(id) {
    $$("#live-tree rect[data-run]").forEach(function (x) { x.setAttribute("data-sel", x.getAttribute("data-run") === id ? "1" : "0"); });
    $$("#live-runs li").forEach(function (li) { var on = li.getAttribute("data-run") === id; li.setAttribute("aria-selected", on ? "true" : "false"); li.tabIndex = on ? 0 : -1; });
  }
  function openRunDetail(id) {
    var r = runById(id), d = $("#live-detail"); if (!r || !d) return;
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    liveDetailId = id; liveSelId = id;
    var mins = Math.max(0, Math.round((Date.parse(r.end) - Date.parse(r.start)) / 60000));
    var started = r.parent ? (function () { var p = runById(r.parent); return "started by " + lesc(p ? (p.agent_type || "an agent") : ("agent " + String(r.parent).slice(0, 8))); })() : "top level (you started it)";
    var why = r.fate === "died" ? "open when the session ended" : r.fate === "still_running" ? "still running now" : "returned to its parent";
    var files = r.files || [], hidden = r.files_hidden || 0;
    d.innerHTML = '<div class="ld-head">' + lesc(r.agent_type || "agent") + ' <span class="ld-fate' + (r.fate === "died" ? " warn" : "") + '">' + lesc(String(r.fate).replace(/_/g, " ")) + "</span></div>"
      + '<div class="ld-meta">' + started + (liveTree && liveTree.model ? " · " + lesc(liveTree.model) : "") + " · depth " + r.depth + " · " + mins + " min · " + why + "</div>"
      + '<div class="ld-fh">written so far (' + (files.length + hidden) + (files.length >= 40 ? "+" : "") + ") · fate on the next run</div>"
      + (files.length ? '<ul class="ld-files">' + files.map(function (f) { return "<li>" + lesc(f) + "</li>"; }).join("") + "</ul>" : hidden ? '<p class="wb-fnote">' + hidden + (hidden === 1 ? " file" : " files") + ' written (paths hidden in this preview)</p>' : '<p class="wb-fnote">no files written yet</p>');
    if (t0) d.setAttribute("data-render-ms", String(Math.round((performance.now() - t0) * 100) / 100));
    highlight(id);
  }
  function paintErr() { var empty = $("#live-empty"); if (empty && liveErr) { empty.hidden = false; empty.textContent = liveErr + "…"; } }
  function drawLive(snap) {
    var clock = $("#ls-clock"), cost = $("#ls-cost"), model = $("#ls-model"), empty = $("#live-empty");
    var plot = $("#live-tree"), runsEl = $("#live-runs"), detail = $("#live-detail"), title = $("#ls-clock-title");
    var tree = snap && snap.tree; liveTree = tree || null; liveErr = null;
    if (!tree || !tree.runs || !tree.runs.length) {
      if (empty) { empty.hidden = false; empty.textContent = snap && snap.watching ? "No agent is running in this repo yet. Start Claude Code here and the tree draws itself." : "The status line is off. Run actuals watch in a terminal to record the live tree, then reopen this view."; }
      if (title) title.textContent = "Waiting for a session.";
      if (clock) clock.textContent = snap && snap.watching ? "waiting" : "not connected";
      if (cost) cost.textContent = "$0.00"; if (model) model.textContent = "0 agents";
      if (plot) plot.innerHTML = ""; if (runsEl) runsEl.innerHTML = ""; if (detail) detail.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    if (title) title.textContent = tree.runs.length + (tree.runs.length === 1 ? " agent run" : " agent runs") + (tree.ended ? ", ended." : ", live.");
    if (clock) clock.textContent = lhm(tree.started_at) + " to " + lhm(tree.now) + (tree.ended ? " ended" : "");
    if (cost) cost.textContent = lmoney(tree.cost_usd);
    if (model) model.textContent = tree.model || (tree.runs.length + " agents");
    var PW = 1088, L = 8, PLOT = PW - L, CH = 46, RH = 12, gap = 8;
    var t0 = Date.parse(tree.started_at), t1 = Date.parse(tree.now), span = Math.max(1, t1 - t0);
    var X = function (ms) { return L + ((ms - t0) / span) * PLOT; };
    var packed = llanes(tree.runs);
    var pts = lcurve(tree.runs, t0, t1), peak = 0; pts.forEach(function (p) { if (p[1] > peak) peak = p[1]; }); var ymax = Math.max(1, peak);
    var Yc = function (v) { return 6 + (CH - 6) * (1 - v / ymax); };
    var curve = "M" + pts.map(function (p) { return X(p[0]).toFixed(1) + " " + Yc(p[1]).toFixed(1); }).join(" L");
    var G0 = CH + gap, H = G0 + Math.max(1, packed.lanes) * RH + 8;
    var bars = packed.placed.map(function (p) {
      var x = X(Date.parse(p.run.start)), w = Math.max(3, X(Date.parse(p.run.end)) - x), y = G0 + p.lane * RH;
      return '<rect data-run="' + lesc(p.run.id) + '" x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="7" rx="1" fill="' + lfate(p.run) + '" style="cursor:pointer"><title>' + lesc(runName(p.run)) + "</title></rect>";
    }).join("");
    if (plot) plot.innerHTML = '<svg viewBox="0 0 ' + PW + " " + H + '" width="' + PW + '" height="' + H + '" style="width:100%;min-width:560px;height:auto;display:block" role="img" aria-label="' + tree.runs.length + ' agent runs, live"><path d="' + curve + '" fill="none" stroke="var(--d1)" stroke-width="1.2" opacity="0.8"></path>' + bars + "</svg>";
    if (runsEl) runsEl.innerHTML = tree.runs.map(function (r) { return '<li role="option" data-run="' + lesc(r.id) + '" tabindex="-1" aria-selected="false"><i class="lr-dot" style="background:' + lfate(r) + '"></i><span class="lr-t">' + lesc(r.agent_type || "agent") + '</span><span class="lr-f' + (r.fate === "died" ? " warn" : "") + '">' + lesc(String(r.fate).replace(/_/g, " ")) + "</span></li>"; }).join("");
    if (liveDetailId && runById(liveDetailId)) openRunDetail(liveDetailId);
    else if (tree.runs.length) openRunDetail(tree.runs[tree.runs.length - 1].id);
    else if (detail) detail.innerHTML = '<p class="wb-fnote">Pick a run to see its detail.</p>';
    if (liveSelId) highlight(liveSelId);
  }
  (function wireLive() {
    var treeEl = $("#live-tree"), runsEl = $("#live-runs"), hoverEl = $("#live-hover");
    function overRun(ev) { var el = ev.target && ev.target.closest ? ev.target.closest("[data-run]") : null; return el ? el.getAttribute("data-run") : null; }
    if (treeEl) {
      treeEl.addEventListener("click", function (ev) { var id = overRun(ev); if (id) openRunDetail(id); });
      treeEl.addEventListener("mousemove", function (ev) { var id = overRun(ev); if (id && hoverEl) { var r = runById(id); if (r) { hoverEl.hidden = false; hoverEl.textContent = runName(r); hoverEl.style.left = (ev.clientX + 12) + "px"; hoverEl.style.top = (ev.clientY + 14) + "px"; } } else if (hoverEl) hoverEl.hidden = true; });
      treeEl.addEventListener("mouseleave", function () { if (hoverEl) hoverEl.hidden = true; });
    }
    if (runsEl) {
      runsEl.addEventListener("click", function (ev) { var id = overRun(ev); if (id) openRunDetail(id); });
      runsEl.addEventListener("keydown", function (ev) {
        if (!liveTree || !liveTree.runs.length) return;
        var ids = liveTree.runs.map(function (r) { return r.id; }), i = ids.indexOf(liveSelId); if (i < 0) i = 0;
        if (ev.key === "ArrowDown") { ev.preventDefault(); liveSelId = ids[Math.min(ids.length - 1, i + 1)]; highlight(liveSelId); focusSel(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); liveSelId = ids[Math.max(0, i - 1)]; highlight(liveSelId); focusSel(); }
        else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); if (liveSelId) openRunDetail(liveSelId); }
      });
      function focusSel() { var els = runsEl.querySelectorAll("li[data-run]"); for (var k = 0; k < els.length; k++) if (els[k].getAttribute("data-run") === liveSelId) { els[k].focus(); return; } }
    }
  })();

  // the server exits a while after the last page closes
  setInterval(function () { api("/api/ping", { t: Date.now() }).catch(function () {}); }, 10000);
  W.start();
})();
`;
