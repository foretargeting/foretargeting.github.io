/* Page behaviour: nav, reveals, the contribution loop, video players, bars, the demo wall. */
(function () {
  // ---------------------------------------------------------------- nav
  const nav = document.getElementById("nav");
  const dots = document.getElementById("dots");
  const links = dots ? [...dots.querySelectorAll("a")] : [];
  const secs = links.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle("solid", y > 30);
    if (dots) dots.classList.toggle("on", y > window.innerHeight * 0.5);
    let active = null;
    for (const s of secs) if (s.offsetTop - window.innerHeight * 0.4 <= y) active = s.id;
    links.forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + active));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  // a section's longer intro (the grey lede under its one-line summary) folds away behind a small "More" at the summary's
  // end and opens in place
  document.querySelectorAll(".sec .wrap > p.sum + p.lede").forEach((lede, i) => {
    const sum = lede.previousElementSibling, b = document.createElement("button");
    if (!lede.id) lede.id = `lede${i}`;
    b.type = "button"; b.className = "lede-t"; b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", lede.id);
    b.innerHTML = "<span>More</span><i aria-hidden=\"true\"></i>";
    sum.append(" ", b); lede.classList.add("lede-c");
    b.addEventListener("click", () => {
      const open = lede.classList.toggle("open"); b.setAttribute("aria-expanded", String(open)); b.querySelector("span").textContent = open ? "Less" : "More";
      setTimeout(() => window.dispatchEvent(new Event("resize")), 380);   // stages sized to the screen (the hand stage) refit
    });
  });
  const tl = document.getElementById("tldr");
  if (tl) new IntersectionObserver(es => { if (!es[0].isIntersecting) tl.classList.remove("centred"); }).observe(tl);
  onScroll();
  // a section shorter than the screen lands centred under the bar (not pinned to the top with a gap below); a taller one
  // lands at its top as before
  // a long jump passes sections that load and change height on the way, so the landing can drift: once the scroll stops,
  // put the section back where it should land (its top at its scroll margin, or centred as set by the click)
  function settle(sec) {
    let want = null, last = -1, n = 0;
    const tick = () => {
      if (Math.abs(window.scrollY - last) > 0.5 && n++ < 40) { last = window.scrollY; return setTimeout(tick, 120); }
      if (window.FTFit) window.FTFit();
      if (want == null) want = sec.dataset.landAt != null ? +sec.dataset.landAt : (parseFloat(getComputedStyle(sec).scrollMarginTop) || 0);   // a scroll margin of -34 px lands the top 34 px above the screen
      const off = sec.getBoundingClientRect().top - want;
      if (Math.abs(off) > 3) window.scrollTo({ top: window.scrollY + off, behavior: "auto" });
    };
    setTimeout(tick, 200);
  }
  links.forEach(a => a.addEventListener("click", e => {
    if (window.FTFit) window.FTFit();                  // fit the section's main figure to the screen first (fit.js), its content may have loaded since
    const sec = document.querySelector(a.getAttribute("href")), box = sec && sec.querySelector(".wrap");
    if (!box) return;
    delete sec.dataset.landAt; settle(sec);
    if (sec.id === "tldr" && window.innerWidth > 760) {   // a full-screen section: centre its content in itself and land on its top
      e.preventDefault(); sec.classList.add("centred"); sec.dataset.landAt = "0";
      window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY, behavior: window.FT && FT.reduced ? "auto" : "smooth" });
      history.replaceState(null, "", a.getAttribute("href")); return;
    }
    const bar = nav ? nav.getBoundingClientRect().height : 0;
    if (window.innerWidth <= 760) return;
    e.preventDefault();
    // every section fills the screen under the bar (its content centred in it, CSS): land with its top under the bar
    const top = sec.getBoundingClientRect().top + window.scrollY - bar;
    sec.dataset.landAt = String(bar);
    window.scrollTo({ top: Math.max(0, top), behavior: window.FT && FT.reduced ? "auto" : "smooth" });
    history.replaceState(null, "", a.getAttribute("href"));
  }));

  // ------------------------------------------------------------ reveals
  const revealIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    if (e.target.style.transitionDelay) setTimeout(() => { e.target.style.transitionDelay = ""; }, 1400);   // the stagger is for the entrance only
    revealIO.unobserve(e.target);
    e.target.dispatchEvent(new CustomEvent("revealed"));
  }), { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  // the text and figures of every section rise in as they come into view (the hero stays put); cards in a row follow
  // one another by 80 ms
  const AUTO = ["section > .wrap > h2", "section > .wrap > p", "section > .wrap > h3", "section .head2", "section .gen-h", "section .gen-lede",
    "section > .wrap > figure", "section > .wrap > .stats > .kn", ".contribs > *", "#limits li", "section .rates", "section .bib"];
  document.querySelectorAll(AUTO.join(",")).forEach(el => {
    if (el.closest(".hero, .reveal") || el.classList.contains("reveal")) return;
    el.classList.add("reveal");
    const sibs = [...el.parentElement.children].filter(x => x.classList.contains("reveal") && x.tagName === el.tagName && x.className === el.className);
    const k = sibs.indexOf(el);
    if (k > 0 && sibs.length > 1) el.style.transitionDelay = `${Math.min(k, 4) * 80}ms`;
  });
  document.querySelectorAll(".contribs > .reveal").forEach((el, k) => { el.style.transitionDelay = `${k * 90}ms`; });
  document.querySelectorAll(".reveal").forEach(el => revealIO.observe(el));

  // ---------------------------------------------------------------- numbers that count up when they come into view
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const countIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    countIO.unobserve(e.target);
    const el = e.target, to = parseFloat(el.dataset.target), dec = +(el.dataset.decimals || 0), suf = el.dataset.suffix || "";
    if (reduced) return;
    const t0 = performance.now(), dur = 1300;
    const tick = now => { const p = Math.min(1, (now - t0) / dur), v = to * (1 - Math.pow(1 - p, 3)); el.textContent = v.toFixed(dec) + suf; if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  document.querySelectorAll(".num[data-target]").forEach(el => {
    if (!reduced) el.textContent = (0).toFixed(+(el.dataset.decimals || 0)) + (el.dataset.suffix || "");   // the markup holds the final value
    countIO.observe(el);
  });

  // ---------------------------------------------------------- loop diagram
  // (the map and its component cards left the page with the step-by-step overview, overview.js; kept for an older layout)
  (function () {
  if (!document.getElementById("loopSvg")) return;
  const svg = document.getElementById("loopSvg");
  const list = document.getElementById("contribList");
  const sets = {
    1: { n: "AWBS", e: ["e1", "e3", "e4", "e5"], c: "#f2a93b", core: true },
    3: { n: "BR", e: ["e6"], c: "#3ea8e5" },
    4: { n: "RX", e: ["e7"], c: "#7b61c9" }
  };
  const core = svg.querySelector(".core");
  function highlight(k) {
    svg.querySelectorAll(".hl").forEach(el => el.classList.remove("hl"));
    svg.querySelectorAll(".node rect").forEach(r => { r.style.stroke = ""; r.style.strokeWidth = ""; });
    svg.querySelectorAll(".edge").forEach(el => { el.style.stroke = ""; el.setAttribute("marker-end", "url(#arr)"); });
    list.querySelectorAll("li").forEach(li => li.classList.toggle("on", li.dataset.c === String(k)));
    if (window.FTLoop3D) FTLoop3D.active(k);
    core.classList.toggle("hl", !!(k && sets[k].core));
    svg.style.setProperty("--c", k ? sets[k].c : "");
    if (k && sets[k].b) svg.querySelectorAll(`[data-b="${sets[k].b}"]`).forEach(el => el.classList.add("hl"));
    setPackets(k);
    if (!k) { svg.classList.remove("dim"); return; }
    const s = sets[k];
    svg.classList.add("dim");
    for (const n of s.n) {
      const g = svg.querySelector(`.node[data-n="${n}"]`);
      g.classList.add("hl");
      const r = g.querySelector("rect"); r.style.stroke = s.c; r.style.strokeWidth = "2";
    }
    for (const e of s.e) svg.querySelectorAll(`[data-e="${e}"]`).forEach(el => {
      el.classList.add("hl");
      if (!el.classList.contains("edge")) return;
      el.style.stroke = s.c;
      el.setAttribute("marker-end", `url(#arr-c${k})`);
    });
  }

  // packets: two dots ride each highlighted edge, and a soft ring marks each arrival
  const pkLayer = document.getElementById("loopPackets");
  const SVGNS = "http://www.w3.org/2000/svg";
  let packets = [], pings = [], pkT = 0, pkLast = null, pkRaf = 0;
  function setPackets(k) {
    pkLayer.textContent = "";
    packets = []; pings = [];
    if (!k || FT.reduced) return;
    const s = sets[k];
    s.e.forEach((e, i) => {
      const path = svg.querySelector(`.edge[data-e="${e}"]`), len = path.getTotalLength();
      const end = path.getPointAtLength(len);
      for (let j = 0; j < 2; j++) {
        const g = document.createElementNS(SVGNS, "g");
        g.innerHTML = `<circle r="7" fill="${s.c}" opacity=".16"/><circle r="3.2" fill="${s.c}"/>`;
        g.setAttribute("opacity", "0");
        pkLayer.appendChild(g);
        packets.push({ g, path, len, end, c: s.c, ping: j === 0, dur: Math.max(1.2, len / 115), off: j / 2 + i * 0.23, u: 1 });
      }
    });
    kickPk();
  }
  function pkTick(now) {
    pkRaf = 0;
    if (!loopVisible || document.hidden || !packets.length) { pkLast = null; return; }
    const t = now / 1000, dt = pkLast == null ? 0 : Math.min(0.05, t - pkLast);
    pkLast = t; pkT += dt;
    for (const p of packets) {
      const u = (pkT / p.dur + p.off) % 1;
      if (u < p.u && p.ping && pkT > 0.3) {
        const el = document.createElementNS(SVGNS, "circle");
        el.setAttribute("cx", p.end.x); el.setAttribute("cy", p.end.y);
        el.setAttribute("fill", "none"); el.setAttribute("stroke", p.c); el.setAttribute("stroke-width", "1.5");
        pkLayer.appendChild(el);
        pings.push({ el, t0: pkT });
      }
      p.u = u;
      const pt = p.path.getPointAtLength(u * p.len);
      p.g.setAttribute("transform", `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
      p.g.setAttribute("opacity", Math.max(0, Math.min(1, u / 0.1, (1 - u) / 0.1)).toFixed(3));
    }
    pings = pings.filter(q => {
      const a = (pkT - q.t0) / 0.7;
      if (a >= 1) { q.el.remove(); return false; }
      q.el.setAttribute("r", (3 + 11 * a).toFixed(1));
      q.el.setAttribute("opacity", (0.55 * (1 - a)).toFixed(3));
      return true;
    });
    pkRaf = requestAnimationFrame(pkTick);
  }
  function kickPk() { if (!pkRaf && loopVisible && !document.hidden && packets.length) pkRaf = requestAnimationFrame(pkTick); }
  document.addEventListener("visibilitychange", kickPk);

  // the component cards are the tour's tabs (tour.js): the map follows the picked one
  let loopVisible = false;
  document.addEventListener("ft:component", e => highlight(e.detail));
  new IntersectionObserver(es => { loopVisible = es[0].isIntersecting; pkLast = null; kickPk(); }, { threshold: 0.3 }).observe(svg);
  highlight(1);
  })();

  // -------------------------------------------------------------- players
  const ICON_PLAY = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="2.6" height="9" rx=".6"/><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6"/></svg>';
  const fmt = s => { s = Math.max(0, s || 0); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };

  document.querySelectorAll("[data-player]").forEach(root => {
    const vid = root.querySelector("video");
    const vp = root.querySelector(".viewport");
    const pp = root.querySelector(".pp"), track = root.querySelector(".track"), fill = root.querySelector(".fill"), tl = root.querySelector(".t");
    const clipSeg = root.querySelector("[data-clips]");
    const focusSeg = root.querySelector("[data-focus]");
    const cap = root.querySelector(".caption");
    let geo = { w: +root.dataset.w, h: +root.dataset.h, cols: +root.dataset.cols || 1, rows: +root.dataset.rows || 1 };
    let focus = "all", userPaused = false, visible = false;

    function layout() {
      const pw = geo.w / geo.cols, ph = geo.h / geo.rows;
      vid.style.aspectRatio = geo.w + " / " + geo.h;
      if (focus === "all") {
        vp.style.paddingTop = (geo.h / geo.w * 100) + "%";
        vid.style.width = "100%";
        vid.style.transform = "translate(0,0)";
      } else {
        const k = +focus, c = k % geo.cols, r = Math.floor(k / geo.cols);
        vp.style.paddingTop = (ph / pw * 100) + "%";
        vid.style.width = (geo.cols * 100) + "%";
        vid.style.transform = `translate(${-c / geo.cols * 100}%, ${-r / geo.rows * 100}%)`;
      }
    }
    function bindFocus() {
      if (!focusSeg) return;
      focusSeg.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
        focus = b.dataset.f;
        focusSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        layout();
      }));
    }
    function load(base, keepTime) {
      const t = keepTime ? vid.currentTime : 0;
      vid.poster = base + ".jpg";
      vid.src = base + ".mp4";
      if (t) vid.currentTime = t;
      if (visible && !userPaused) vid.play().catch(() => {});
    }
    function pickClip(b) {
      clipSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      if (b.dataset.w) geo = { w: +b.dataset.w, h: +b.dataset.h, cols: +b.dataset.cols || 3, rows: +b.dataset.rows || 1 };
      if (b.dataset.labels && focusSeg) {
        focusSeg.innerHTML = '<button class="on" data-f="all">all</button>' +
          b.dataset.labels.split("|").map((l, i) => `<button data-f="${i}">${l}</button>`).join("");
        bindFocus();
      }
      focus = "all";
      if (focusSeg) focusSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.f === "all"));
      if (cap && b.dataset.caption != null) cap.innerHTML = b.dataset.caption;
      layout();
      load(b.dataset.src);
    }
    if (clipSeg) {
      clipSeg.querySelectorAll("button").forEach(b => b.addEventListener("click", () => pickClip(b)));
      bindFocus();
      pickClip(clipSeg.querySelector("button.on") || clipSeg.querySelector("button"));
    } else {
      bindFocus();
      layout();
      load(vid.dataset.src);
    }

    function setIcon() { if (pp) pp.innerHTML = vid.paused ? ICON_PLAY : ICON_PAUSE; }
    if (pp) pp.addEventListener("click", () => {
      if (vid.paused) { userPaused = false; vid.play().catch(() => {}); } else { userPaused = true; vid.pause(); }
    });
    vid.addEventListener("click", () => pp && pp.click());
    vid.addEventListener("play", setIcon); vid.addEventListener("pause", setIcon); setIcon();
    function upd() {
      const d = vid.duration || 0;
      if (fill) fill.style.width = d ? (vid.currentTime / d * 100) + "%" : "0";
      if (tl) tl.textContent = fmt(vid.currentTime) + " / " + fmt(d);
    }
    vid.addEventListener("timeupdate", upd); vid.addEventListener("loadedmetadata", upd);
    (function raf() { if (!vid.paused) upd(); requestAnimationFrame(raf); })();
    if (track) track.addEventListener("click", e => {
      const r = track.getBoundingClientRect();
      if (vid.duration) vid.currentTime = FT.clamp((e.clientX - r.left) / r.width, 0, 1) * vid.duration;
    });
    new IntersectionObserver(es => {
      visible = es[0].isIntersecting;
      if (visible && !userPaused && !FT.reduced) vid.play().catch(() => {});
      if (!visible) vid.pause();
    }, { threshold: 0.25 }).observe(vp);
  });

  // robot cards: plain looping clips
  document.querySelectorAll("video[data-auto]").forEach(v => {
    new IntersectionObserver(es => { es[0].isIntersecting && !FT.reduced ? v.play().catch(() => {}) : v.pause(); }, { threshold: 0.3 }).observe(v);
  });

  // folded details: figures inside measure themselves on resize, so tell them when they open
  document.querySelectorAll("details.more").forEach(d => d.addEventListener("toggle", () => {
    if (d.open) requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }));

  // robot deployment: one tab per task; a hidden task's clips stop
  document.querySelectorAll(".deploy").forEach(d => {
    const tabs = d.querySelectorAll(".task-tabs button"), panels = d.querySelectorAll(".task");
    const pick = d.querySelector(".simg-pick select");   // the dropdown presses the (hidden) task button
    if (pick) pick.addEventListener("change", () => { const b = d.querySelector('.task-tabs button[data-task="' + pick.value + '"]'); if (b) b.click(); });
    tabs.forEach(b => b.addEventListener("click", () => {
      tabs.forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
      panels.forEach(p => {
        p.hidden = p.dataset.task !== b.dataset.task;
        if (p.hidden) p.querySelectorAll("video").forEach(v => v.pause());
      });
    }));
  });

  // ------------------------------------------------------------------ bars
  document.querySelectorAll("[data-bars]").forEach(b => {
    const max = +b.dataset.max;
    const go = () => b.querySelectorAll("[data-v]").forEach(f => { f.style.width = Math.min(100, +f.dataset.v / max * 100) + "%"; });
    const host = b.closest(".reveal");
    if (host && !host.classList.contains("in")) host.addEventListener("revealed", go, { once: true }); else go();
  });

  // ------------------------------------------------------------------ wall
  const wall = document.getElementById("wall");
  if (wall) {
    const groups = [...wall.querySelectorAll(".wall-g")];
    groups.forEach((g, gi) => {
      const ok = +g.dataset.ok, n = +g.dataset.n, box = g.querySelector(".wall");
      const order = [...Array(n).keys()].sort((a, b) => FT.hash(gi, a, 5) - FT.hash(gi, b, 5));
      const fail = new Set(order.slice(0, n - ok));
      for (let i = 0; i < n; i++) { const c = document.createElement("i"); c.dataset.s = fail.has(i) ? "fail" : "ok"; box.appendChild(c); }
    });
    const host = wall.closest(".reveal");
    const run = () => groups.forEach((g, gi) => g.querySelectorAll("i").forEach((c, i) => {
      setTimeout(() => { c.classList.add("in", c.dataset.s); }, FT.reduced ? 0 : gi * 160 + i * 18);
    }));
    host.addEventListener("revealed", run, { once: true });
  }

  // ---------------------------------------------------------------- a long section as pages, one screen each
  // .pages > .page[data-title]: a bar of the titles above, one page shown at a time (its figures refit on the switch)
  document.querySelectorAll(".pages").forEach(box => {
    const pages = [...box.children].filter(x => x.classList.contains("page")), bar = document.createElement("div");
    bar.className = "pages-bar"; bar.setAttribute("role", "tablist");
    pages.forEach((pg, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab");
      if (pg.dataset.thumb) {                          // a picture card: a peek at what the page shows
        bar.classList.add("cards");
        b.innerHTML = `<img src="${pg.dataset.thumb}" alt="" loading="lazy"><span class="pc-t"><small>${i + 1}</small><span class="pc-n">${pg.dataset.title}</span></span>`;
      } else b.textContent = pg.dataset.title;
      b.addEventListener("click", () => show(i));
      bar.appendChild(b); pg.setAttribute("role", "tabpanel");
    });
    if (bar.classList.contains("cards")) box.before(bar); else box.prepend(bar);   // picture cards keep their size when the pages shrink to fit
    // the end of each page points on to the next one
    if (box.hasAttribute("data-next")) pages.forEach((pg, i) => {
      const nx = pages[i + 1]; if (!nx) return;
      const a = document.createElement("button");
      a.type = "button"; a.className = "page-next";
      a.innerHTML = `${nx.dataset.thumb ? `<img src="${nx.dataset.thumb}" alt="" loading="lazy">` : ""}<span><small>Next · ${i + 2} of ${pages.length}</small>${nx.dataset.title}</span><b aria-hidden="true">→</b>`;
      a.addEventListener("click", () => { show(i + 1); bar.scrollIntoView({ behavior: FT.reduced ? "auto" : "smooth", block: "nearest" }); });
      pg.appendChild(a);
    });
    function show(i) {
      pages.forEach((pg, k) => { pg.hidden = k !== i; if (k !== i) pg.querySelectorAll("video").forEach(v => v.pause()); });
      [...bar.children].forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-selected", String(k === i)); });
      pages[i].querySelectorAll(".reveal:not(.in)").forEach(el => el.classList.add("in"));
      requestAnimationFrame(() => { if (window.FTFit) window.FTFit(); window.dispatchEvent(new Event("resize")); });
    }
    show(0);
  });
  // the deployment's results beside the globe: real robot or simulation
  document.querySelectorAll(".dg-seg").forEach(seg => {
    const side = seg.closest(".dg-side"), bs = [...seg.querySelectorAll("button")];
    const tb = side.closest(".dg-wrap") && side.closest(".dg-wrap").querySelector(".dg-tasks");
    const show = k => { bs.forEach(b => b.classList.toggle("on", b.dataset.r === k)); side.dataset.r = k; if (tb) tb.dataset.r = k; if (window.FTFit) requestAnimationFrame(window.FTFit); };
    bs.forEach(b => b.addEventListener("click", () => show(b.dataset.r)));
    show("real");
  });

  document.querySelectorAll(".fc-vid video").forEach(v => v.addEventListener("loadedmetadata", () => { if (window.FTFit) window.FTFit(); }, { once: true }));
  // the live demo: Irmak's keyboard simulator in a frame, loaded when the section comes near; a clip on touch screens
  const simBox = document.getElementById("liveDemo");
  if (simBox) {
    const frame = simBox.querySelector("iframe"), clip = simBox.querySelector(".sim-touch");
    if (matchMedia("(hover: none) and (pointer: coarse)").matches) { frame.remove(); clip.hidden = false; }
    else {
      new IntersectionObserver(es => { if (es[0].isIntersecting && !frame.src) frame.src = frame.dataset.src; }, { rootMargin: "600px 0px" }).observe(simBox);
      new IntersectionObserver(es => { if (!es[0].isIntersecting && frame.contentWindow) frame.contentWindow.postMessage({ sim: "pause" }, location.origin); }).observe(simBox);
    }
  }

  // the forecasts: one recording at a time under the same three-model video
  document.querySelectorAll(".fc-seg").forEach(seg => {
    const v = seg.closest(".fc-fig").querySelector("video"), bs = [...seg.querySelectorAll("button")];
    bs.forEach(b => b.addEventListener("click", () => {
      bs.forEach(x => x.classList.toggle("on", x === b));
      v.poster = `static/media/fc_${b.dataset.v}.jpg`; v.src = `static/media/fc_${b.dataset.v}.mp4`;
      const fig = seg.closest(".fc-fig"), add = (b.dataset.add || "").split(",");   // the three models' ADD for this recording
      fig.querySelectorAll(".fc-heads i").forEach((el, k) => { el.textContent = add[k] ? add[k] + " mm" : ""; });
      if (!FT.reduced) v.play().catch(() => {});
    }));
  });

  // ---------------------------------------------------------------- the success tables as bar charts
  // Each table's averages are drawn as one sorted bar chart per group (ours in colour, the oracle hatched), read from
  // the table itself so the numbers live in one place; the table opens under "Task by task".
  const pct = t => { t = t.trim(); const f = t.match(/^(\d+)\/(\d+)$/); return f ? 100 * f[1] / f[2] : t === "–" || t === "" ? null : parseFloat(t); };
  function barChart(groups) {
    const box = document.createElement("div"); box.className = "hb";
    for (const g of groups) {
      const gr = document.createElement("div"); gr.className = "hb-g";
      if (g.title) gr.innerHTML = `<div class="hb-gh">${g.title}</div>`;
      for (const r of g.rows) {
        const row = document.createElement("div");
        row.className = "hb-r" + (r.ours ? " ours" : "") + (r.oracle ? " oracle" : "") + (r.v == null ? " na" : "");
        row.innerHTML = `<span class="hb-l">${r.label}${r.note ? `<small>${r.note}</small>` : ""}</span><span class="hb-t"><i style="--w:${r.v == null ? 0 : Math.max(0.6, r.v)}%"></i></span><span class="hb-v">${r.v == null ? "–" : (Math.abs(r.v - Math.round(r.v)) < 0.05 ? Math.round(r.v) : r.v.toFixed(1)) + "%"}</span>`;
        gr.appendChild(row);
      }
      box.appendChild(gr);
    }
    new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { box.classList.add("in"); io.disconnect(); } }, { threshold: 0.3 }).observe(box);
    return box;
  }
  function stageChart(rows) {
    const fmt = v => v == null ? "–" : (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)) + "%";
    const box = document.createElement("div"); box.className = "hb hb3";
    box.innerHTML = `<div class="hb3-h"><span></span><span>Stage 1</span><span>Stage 2</span><span>Stage 3</span></div>` + rows.map(r =>
      `<div class="hb-r hb3-r${r.ours ? " ours" : ""}"><span class="hb-l">${r.label}<small>${r.note}</small></span>` +
      r.v.map(v => `<span class="hb3-c"><span class="hb-t"><i style="--w:${v == null ? 0 : Math.max(0.6, v)}%"></i></span><span class="hb-v">${fmt(v)}</span></span>`).join("") + `</div>`).join("");
    new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { box.classList.add("in"); io.disconnect(); } }, { threshold: 0.3 }).observe(box);
    return box;
  }
  document.querySelectorAll(".rates").forEach(box => {
    const table = box.querySelector("table"), tb = table && table.querySelector("tbody"); if (!tb) return;
    const avg = tb.querySelector("tr.avg"), heads = [...table.querySelectorAll("thead tr:last-child th")].map(th => (th.querySelector(".hl") || th).textContent.trim());
    const tasks = [...tb.querySelectorAll("tr:not(.avg)")];
    let groups;
    if (box.classList.contains("sim")) {          // two hands, three methods each: the mean over the tasks
      const cells = [...avg.querySelectorAll("td")].map(td => pct(td.textContent)), names = heads.filter(h => h !== "Task");
      const grp = [...table.querySelectorAll("thead th.grp")].map(th => th.textContent.trim());
      groups = grp.map((title, gi) => ({ title: title + ", mean over the " + tasks.length + " tasks", rows: [0, 1, 2].map(j => {
        const k = gi * 3 + j, n = names[k] || "";
        return { label: n.replace(" (oracle)", "").replace("State BC + Foretargeting", "State BC + Foretargeting"), note: /oracle/i.test(n) ? "oracle: trained on actions human data lacks" : "", v: cells[k], ours: /Foretargeting/.test(n), oracle: /oracle/i.test(n) };
      }).sort((x, y) => (y.v || 0) - (x.v || 0)) }));
    } else {                                     // methods x three stages: the mean over the tasks each method ran
      const methods = heads.slice(1), cols = [...avg.querySelectorAll("td")];
      const ran = methods.map((_, m) => tasks.filter(tr => tr.querySelectorAll("td")[m].querySelector(".v")).length);
      groups = null;                              // one row per method, its three stages side by side
      const rows = methods.map((name, m) => ({ label: name, note: ran[m] + (ran[m] === 1 ? " task" : " tasks"), ours: /Foretargeting/.test(name),
        v: [0, 1, 2].map(st => { const v = cols[m].querySelectorAll(".st .v")[st]; return v ? 100 * parseFloat(v.textContent) / 20 : null; }) }))
        .sort((x, y) => (y.ours - x.ours) || ((y.v[0] || 0) - (x.v[0] || 0)));
      box._stages = rows;
    }
    const chart = groups ? barChart(groups) : stageChart(box._stages), scroll = box.querySelector(".rates-scroll");
    scroll.before(chart);
    box.classList.add("folded");
    const b = document.createElement("button");
    b.type = "button"; b.className = "lede-t rates-more"; b.setAttribute("aria-expanded", "false");
    b.innerHTML = `<span>Task by task (${tasks.length})</span><i aria-hidden="true"></i>`;
    scroll.after(b);
    b.addEventListener("click", () => {
      const open = !box.classList.toggle("folded"); b.setAttribute("aria-expanded", String(open));
      b.querySelector("span").textContent = open ? "Hide the tasks" : `Task by task (${tasks.length})`;
    });
  });

  // ---------------------------------------------------------------- every task's clip, small and side by side, under the results
  (function () {
    const box = document.querySelector("#results .dg-tasks"), pop = document.getElementById("dgPop");
    if (!box || !pop) return;
    const realSel = pop.querySelector(".dg-real .simg-pick select"), simSel = pop.querySelector("#simGallery .simg-pick select");
    const tile = (kind, task, label, src, poster) => `<button type="button" class="vt ${kind}${src ? "" : " none"}" data-kind="${kind}" data-task="${task}">` +
      (src ? `<video muted loop playsinline preload="none" poster="${poster}" data-src="${src}"></video>` : `<span class="vt-ph">video soon</span>`) +
      `<span class="vt-l">${label}</span></button>`;
    const real = realSel ? [...realSel.options].map(o => {
      const v = pop.querySelector(`.dg-real .task[data-task="${o.value}"] .run.fore video`), src = v && (v.getAttribute("src") || v.dataset.src);
      return tile("real", o.value, o.textContent.trim(), src, v ? v.getAttribute("poster") || "" : "");
    }).join("") : "";
    const sim = simSel ? [...simSel.options].map(o => tile("sim", o.value, o.textContent.trim(), `static/media/sim/${o.value}_wuji_fore.mp4`, `static/media/sim/${o.value}_wuji_fore.jpg`)).join("") : "";
    box.innerHTML = `<div class="vg real"><div class="vg-k">Foretargeting on the real robot, one trial per task, 4×. Click one for its other views and BC.</div><div class="vg-g">${real}</div></div>` +
      `<div class="vg sim"><div class="vg-k">Foretargeting on Wuji Hand 2.2 in simulation. Click one for the baselines and the human hand.</div><div class="vg-g">${sim}</div></div>`;
    const vids = [...box.querySelectorAll("video")];
    const io = new IntersectionObserver(es => es.forEach(e => {
      const v = e.target;
      if (e.isIntersecting && v.offsetParent) { if (!v.src) v.src = v.dataset.src; v.play().catch(() => {}); } else v.pause();
    }), { threshold: 0.2 });
    vids.forEach(v => io.observe(v));
    // the toggle above shows one grid: re-check which clips play
    new MutationObserver(() => vids.forEach(v => { io.unobserve(v); io.observe(v); })).observe(box, { attributes: true, attributeFilter: ["data-r"] });
    box.addEventListener("click", e => {
      const b = e.target.closest(".vt"); if (!b || b.classList.contains("none")) return;
      if (window.FTDeployOpen) window.FTDeployOpen({ kind: b.dataset.kind, task: b.dataset.task, hand: "wuji" });
    });
  })();

  // ---------------------------------------------------------------- Paper, arXiv, Video, Code and Data are not out yet: hover or click says so
  document.querySelectorAll("a[data-soon]").forEach(a => {
    a.removeAttribute("title");   // the pop-up says it; no second browser tooltip
    const tipOf = () => {
      let tip = a.querySelector(".soon-tip");
      if (!tip) { tip = document.createElement("span"); tip.className = "soon-tip"; tip.setAttribute("role", "status"); tip.textContent = "Coming soon"; a.appendChild(tip); }
      return tip;
    };
    const show = ms => {
      const tip = tipOf();
      document.querySelectorAll(".soon-tip.on").forEach(t => { if (t !== tip) t.classList.remove("on"); });   // one at a time
      tip.classList.add("on");
      clearTimeout(a._soon); if (ms) a._soon = setTimeout(() => tip.classList.remove("on"), ms);
    };
    a.addEventListener("click", e => { e.preventDefault(); show(1600); });
    a.addEventListener("mouseenter", () => show(0));
    a.addEventListener("mouseleave", () => { clearTimeout(a._soon); const t = a.querySelector(".soon-tip"); if (t) t.classList.remove("on"); });
  });

  // ---------------------------------------------------------------- bibtex
  const copy = document.getElementById("bibCopy"), bib = document.getElementById("bib");
  const bibText = bib ? bib.textContent.replace(/^Cop(y|ied)/, "").trim() : "";
  // phones: the same entry laid out narrow (one author per line), so nothing wraps raggedly; Copy always gives the original
  if (bib && copy) {
    const pad = " ".repeat(13), au = (bibText.match(/author\s*=\s*\{([^}]*)\}/) || [])[1];
    const narrow = au && ["@article{foretargeting2026,", "  title   = {Dexterous Foretargeting", pad + "from Human Videos},",
      "  author  = {" + au.replace(/\s+/g, " ").split(" and ").map((n, i, A) => (i ? pad : "") + n + (i < A.length - 1 ? " and" : "},")).join("\n"),
      "  journal = {arXiv preprint},", "  year    = {2026}", "}"].join("\n");
    const body = document.createTextNode(""); [...bib.childNodes].forEach(n => n !== copy && n.remove()); bib.appendChild(body);
    const mq = matchMedia("(max-width: 640px)"), lay = () => { body.textContent = narrow && mq.matches ? narrow : bibText; bib.classList.toggle("narrow", !!narrow && mq.matches); };
    lay(); mq.addEventListener ? mq.addEventListener("change", lay) : mq.addListener(lay);
  }
  if (copy) copy.addEventListener("click", () => {
    const text = bibText;
    navigator.clipboard && navigator.clipboard.writeText(text).then(() => { copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", 1400); });
  });
})();
