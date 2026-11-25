/* Interactive tour: one explainer per component, picked from the component cards above the stage (they advance on
   their own until the visitor picks one); the map lights the picked component (page.js listens to "ft:component"). */
(function () {
  const D = FT.draw, S = FT.scene, C = D.C;
  const tabs = [...document.querySelectorAll("#contribList [data-i]")];
  const panels = [...document.querySelectorAll("#stage .stage-panel")];
  const playBtn = document.getElementById("tourPlay");
  if (!tabs.length) return;

  // ------------------------------------------------------------ tab bar
  const STEP = 10; // seconds per step while touring (a tab's data-step overrides it)
  const stepOf = i => +tabs[i].dataset.step || STEP;
  let cur = 0, touring = !FT.reduced, elapsed = 0, inView = false;
  function select(i) {
    cur = i; elapsed = 0;
    tabs.forEach((t, k) => { t.classList.toggle("on", k === i); t.setAttribute("aria-selected", k === i); t.querySelector(".bar").style.width = "0"; });
    panels.forEach((p, k) => p.classList.toggle("on", k === i));
    viz.forEach((z, k) => z && (k === i ? z.anim.resume() : z.anim.pause()));
    document.dispatchEvent(new CustomEvent("ft:component", { detail: +tabs[i].dataset.c }));   // the map's component (1, 3, 4)
  }
  function setTouring(on) {
    touring = on;
    playBtn.innerHTML = on
      ? '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="2.6" height="9" rx=".6"/><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6"/></svg><span>Tour</span>'
      : '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z"/></svg><span>Tour</span>';
    playBtn.setAttribute("aria-label", on ? "Pause tour" : "Play tour");
    if (!on) tabs.forEach(t => t.querySelector(".bar").style.width = "0");
  }
  tabs.forEach((t, i) => t.addEventListener("click", () => { setTouring(false); select(i); }));
  playBtn.addEventListener("click", () => setTouring(!touring));
  new IntersectionObserver(es => { inView = es[0].isIntersecting; }, { threshold: 0.35 }).observe(document.getElementById("stage"));
  let lastT = performance.now();
  (function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (touring && inView && !document.hidden) {
      elapsed += dt;
      tabs[cur].querySelector(".bar").style.width = Math.min(100, (elapsed / stepOf(cur)) * 100) + "%";
      if (elapsed >= stepOf(cur)) select((cur + 1) % tabs.length);
    }
    requestAnimationFrame(tick);
  })(lastT);
  setTouring(touring);

  function pills(id, onChange) {
    const el = document.getElementById(id);
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      onChange(b.dataset.v);
    }));
  }

  // --------------------------------------------------------- 3 retarget
  // Real data: one episode on the Wuji hand (static/hero/retarget_<ep>.json, tools/export_retarget_curve.py)
  // drawn under its video (static/media/wuji_<ep>.mp4: the same three runs, left to right). The cursor
  // follows the video; drag on the chart to scrub, and slow the video down to watch it moment by moment.
  // Episode 12 also shows a rewind: the optimizer's log of it, and the same optimizer run with rewind
  // off (same seed), which never lifts the cube.
  function retarget() {
    const cv = document.getElementById("tvRetarget"), video = document.getElementById("rtVideo");
    if (!cv || !video) return null;
    const EP = {
      ep07: { video: "static/media/wuji_ep07.mp4", poster: "static/media/wuji_ep07.jpg", data: "static/hero/retarget_ep07.json" },
      ep12: { video: "static/media/wuji_ep12.mp4", poster: "static/media/wuji_ep12.jpg", data: "static/hero/retarget_ep12.json" }
    };
    const cache = {};
    let ep = "ep07", data = null, scrub = false, wantPlay = false, active = false;
    pills("rSpeed", v => { video.playbackRate = +v; });
    pills("rEp", v => show(v));
    const LINES = [
      ["reference", "kinematic reference", "#55606e", true],
      ["baseline", "damped servos + feedforward", C.reached],
      ["ours", "ours: CPU optimizer", C.robot],
      ["without", "ours with rewind off (not in the video)", "#8592a6", [2, 3]]
    ];
    // the clips are small: fetch each whole, so seeking works on any server (with or without range requests)
    function get(k) {
      return cache[k] || (cache[k] = Promise.all([
        fetch(EP[k].video).then(r => r.blob()).then(b => URL.createObjectURL(b)).catch(() => EP[k].video),
        fetch(EP[k].data).then(r => r.json())
      ]));
    }
    function show(k) {
      ep = k;
      data = null;
      const rate = video.playbackRate;
      video.poster = EP[k].poster;
      get(k).then(([src, d]) => {
        if (ep !== k) return;
        data = d;
        video.src = src;
        video.playbackRate = rate;
        video.currentTime = 0;
        if (wantPlay) video.play().catch(() => {});
        anim.kick();
      });
    }
    const PAD_L = 42, PAD_R = 18;                    // the plot's left and right margins (also used to draw)
    function seek(e) {
      if (!data) return;
      const r = cv.getBoundingClientRect();
      const t = Math.max(0, Math.min(data.duration, (e.clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R) * data.duration));
      video.pause();
      video.currentTime = t;
      anim.kick();
    }
    cv.addEventListener("pointerdown", e => { scrub = true; try { cv.setPointerCapture(e.pointerId); } catch (_) {} seek(e); });
    cv.addEventListener("pointermove", e => { if (scrub) seek(e); });
    const release = () => { if (!scrub) return; scrub = false; if (wantPlay) video.play().catch(() => {}); };
    cv.addEventListener("pointerup", release);
    cv.addEventListener("pointercancel", release);
    const at = (arr, t) => { const f = Math.max(0, Math.min(arr.length - 1.001, t / data.dt)), i = Math.floor(f); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); };
    const FONT = '500 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';

    const anim = FT.animate(cv, () => {
      const { ctx, w, h } = FT.fit(cv);
      ctx.clearRect(0, 0, w, h);
      if (!data) return;
      const dur = data.duration, t = Math.min(dur, video.currentTime || 0);
      const cm = v => Math.max(0, v).toFixed(1);       // a cube resting 1 mm into the desk reads 0.0
      const lines = LINES.filter(([k]) => data[k]);
      const ev = (data.events || [])[0];
      // status line
      const end = t >= dur - 0.05, rew = ev && t >= ev.at_s && t < ev.at_s + 1.6;
      let head, headCol = "#6e6e73";
      if (end) {
        head = `end · ours: cube in the bowl (lifted ${(data.lift_mm.ours / 10).toFixed(1)} cm) · baseline${data.without ? " and rewind off" : ""}: lifted ${(data.lift_mm.baseline / 10).toFixed(1)} cm, fail${data.without ? "" : "s"}`;
        headCol = "#1d1d1f";
      } else if (rew) {
        const kept = ev.tries[ev.tries.length - 1];
        head = w < 560
          ? `rewind at ${ev.at_s} s: back to ${ev.kept_from_s} s, search again`
          : `t = ${ev.at_s} s: the cube is ${Math.round(ev.now_mm)} mm off → rewind to ${ev.kept_from_s} s and search again (horizon ${kept.horizon_s} s): ${Math.round(ev.kept_error_mm)} mm`;
        headCol = "#c8323a";
      } else {
        head = w < 560
          ? `t = ${t.toFixed(2)} s · ours ${cm(at(data.ours, t))} · baseline ${cm(at(data.baseline, t))} cm`
          : `t = ${t.toFixed(2)} s · cube height: reference ${cm(at(data.reference, t))} · baseline ${cm(at(data.baseline, t))} · ours ${cm(at(data.ours, t))} cm`;
      }
      D.label(ctx, 16, 22, head, headCol, 1);
      // legend
      ctx.font = FONT;
      const items = [...lines.map(([, n, c, d]) => [n, c, d]), [`searching the next ${data.horizon_s} s (${data.candidates} × ${data.iterations})`, D.rgba(C.robot, 0.45), false, "band"]];
      if (ev) items.push(["rewind", "#c8323a", false, "dot"]);
      let lx = 16, ly = 44;
      items.forEach(([n, c, dash, kind]) => {
        const iw = 34 + ctx.measureText(n).width;
        if (lx > 16 && lx + iw > w - 8) { lx = 16; ly += 18; }
        ctx.save();
        if (kind === "band") { ctx.fillStyle = c; ctx.fillRect(lx, ly - 5, 16, 10); }
        else if (kind === "dot") { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(lx + 8, ly, 4, 0, 7); ctx.fill(); }
        else { ctx.strokeStyle = c; ctx.lineWidth = 2; if (dash) ctx.setLineDash(Array.isArray(dash) ? dash : [4, 3]); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 16, ly); ctx.stroke(); }
        ctx.restore();
        D.label(ctx, lx + 22, ly, n, "#4a515b", 0.95); lx += iw;
      });
      const L = PAD_L, R = PAD_R, Tp = ly + (ev ? 50 : 34), B = 76, W = w - L - R, H = h - Tp - B, YMAX = 15;
      const X = tt => L + tt / dur * W, Y = v => Tp + H - Math.max(-0.5, v) / YMAX * H;
      // grid
      ctx.save();
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
      ctx.fillStyle = "#8a919c"; ctx.strokeStyle = "rgba(0,0,0,.07)"; ctx.lineWidth = 1;
      for (const v of [0, 5, 10, 15]) { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + W, Y(v)); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(v, L - 8, Y(v) + 4); }
      ctx.textAlign = "center";
      for (let s = 0; s <= dur + 1e-6; s += 1) ctx.fillText(`${s} s`, X(s), Tp + H + 18);
      ctx.textAlign = "left"; ctx.fillText("cube height, cm", L, Tp - 10);
      // what the optimizer is searching right now: the next horizon_s, committed commit_s at a time
      ctx.fillStyle = D.rgba(C.robot, 0.08);
      ctx.fillRect(X(t), Tp, Math.max(0, X(Math.min(dur, t + data.horizon_s)) - X(t)), H);
      ctx.fillStyle = D.rgba(C.robot, 0.5);
      for (let c = 0; c * data.commit_s <= dur; c++) {
        ctx.globalAlpha = c * data.commit_s <= t ? 0.9 : 0.25;
        ctx.fillRect(X(c * data.commit_s) - 0.5, Tp + H + 3, 1, 5);
      }
      ctx.restore();
      // the rewind, once the video reaches it: the stretch searched again, and the jump back
      if (ev && t >= ev.at_s) {
        const a = Math.min(1, (t - ev.at_s) / 0.35);
        const x0 = X(ev.kept_from_s), x1 = X(ev.at_s), yTop = Tp - 22;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = "rgba(229,84,91,.07)";
        ctx.fillRect(x0, Tp, x1 - x0, H);
        ctx.strokeStyle = "#c8323a"; ctx.fillStyle = "#c8323a"; ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x1, Tp + H); ctx.lineTo(x1, yTop + 6); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, yTop + 6); ctx.quadraticCurveTo((x0 + x1) / 2, yTop - 10, x0 + 2, yTop + 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, yTop + 9); ctx.lineTo(x0 - 1, yTop + 1); ctx.lineTo(x0 + 6, yTop + 4); ctx.closePath(); ctx.fill();
        ctx.font = FONT; ctx.textAlign = "center";
        ctx.fillText(`rewind ${ev.at_s} → ${ev.kept_from_s} s`, (x0 + x1) / 2, yTop - 10);
        if (data.without) { ctx.beginPath(); ctx.arc(x1, Y(at(data.without, ev.at_s)), 4.5, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      // the runs: faint in full, solid up to the cursor
      for (const [key, , col, dash] of lines) {
        const arr = data[key];
        for (const solid of [false, true]) {
          ctx.save();
          ctx.strokeStyle = col; ctx.lineWidth = solid ? (key === "ours" ? 3 : 2.2) : 1.5; ctx.lineJoin = "round";
          ctx.globalAlpha = solid ? 1 : 0.16;
          if (dash) ctx.setLineDash(Array.isArray(dash) ? dash : [5, 4]);
          ctx.beginPath();
          const n = solid ? Math.min(arr.length, Math.floor(t / data.dt) + 1) : arr.length;
          for (let i = 0; i < n; i++) { const x = X(i * data.dt), y = Y(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          if (solid) ctx.lineTo(X(t), Y(at(arr, t)));
          ctx.stroke();
          ctx.restore();
        }
        ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(t), Y(at(arr, t)), key === "ours" ? 5 : 4, 0, 7); ctx.fill(); ctx.restore();
      }
      // cursor
      ctx.save(); ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.moveTo(X(t), Tp - 2); ctx.lineTo(X(t), Tp + H); ctx.stroke(); ctx.restore();
    });
    anim.pause();
    return {
      anim: {
        pause() { wantPlay = false; video.pause(); anim.pause(); },
        resume() {
          wantPlay = true;
          if (!active) { active = true; show(ep); } else video.play().catch(() => {});
          anim.resume();
        }
      }
    };
  }

  const three = window.FTTour3D || {};
  // ---------------------------------------------------------- 4 robot
  function robot() {
    const v = document.getElementById("tvRobot");
    if (!v) return null;
    return { anim: { pause() { v.pause(); }, resume() { if (!v.src) v.src = v.dataset.src; if (!FT.reduced) v.play().catch(() => {}); } } };
  }
  const viz = [three.foresee, retarget(), robot()];
  select(0);
})();
