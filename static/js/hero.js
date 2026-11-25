/* Drawing helpers shared by the tour panels (FT.draw). */

FT.draw = (function () {
  const C = {
    past: "#8592a6", fore: "#f2a93b", target: "#22b37a", reached: "#e5545b", robot: "#3ea8e5",
    ink: "#e9edf3"
  };
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  // Scene -> pixels.
  function view(w, h, o) {
    o = o || {};
    const sw = Math.min(w - 2 * (o.pad || 24), o.maxW || 1140);
    const x0 = (w - sw) / 2;
    const desk = h * (o.desk || 0.84);
    const sy = (desk - h * (o.top || 0.1)) / 0.8;
    const s = FT.clamp(sw * 0.045, 16, o.maxObj || 38);
    return {
      sw, x0, desk, sy, s,
      X: x => x0 + x * sw,
      Y: y => desk - y * sy,
      // object centre for a bottom-anchored pose
      P: p => [x0 + p[0] * sw, desk - p[1] * sy - s / 2]
    };
  }
  function desk(ctx, v, w, dark) {
    const g = ctx.createLinearGradient(0, v.desk, 0, v.desk + 60);
    g.addColorStop(0, dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, v.desk, w, 60);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, v.desk + 0.5); ctx.lineTo(w, v.desk + 0.5); ctx.stroke();
    // bowl
    const B = FT.scene.BOWL, bx = v.X(B.x), bw = B.w * v.sw / 2, bh = B.h * v.sy;
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - bw, v.desk - bh);
    ctx.bezierCurveTo(bx - bw * 0.95, v.desk + 1, bx + bw * 0.95, v.desk + 1, bx + bw, v.desk - bh);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(bx, v.desk - bh, bw, bh * 0.16, 0, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.16)"; ctx.stroke();
  }
  function object(ctx, v, p, alpha, tilt, dark) {
    const [cx, cy] = v.P(p), s = v.s;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(tilt || 0);
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.shadowColor = dark ? "rgba(233,237,243,0.35)" : "rgba(0,0,0,0.15)";
    ctx.shadowBlur = dark ? 18 : 8;
    FT.roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.18);
    ctx.fillStyle = dark ? "#e9edf3" : "#ffffff"; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  // A side-view pinch: wrist above, thumb left, index (+ middle) right.
  function hand(ctx, v, p, open, o) {
    const [gx, gy] = v.P(p), r = v.s / 2;
    const squeeze = o.squeeze || 0;
    const d = r * (1 + 1.35 * open) - squeeze * r * (1 - open);
    const lift = r * 0.08;
    const W = [gx - r * 0.25, gy - r * 3.3];
    const Pm = [gx - r * 0.05, gy - r * 2.05];
    const T = [gx - d, gy + lift], I = [gx + d, gy + lift];
    const TJ = [gx - d - r * 0.55, gy - r * 0.95], IJ = [gx + d + r * 0.5, gy - r * 1.05];
    const M = [I[0] + r * 0.3, I[1] + r * 0.22], MJ = [IJ[0] + r * 0.32, IJ[1] + r * 0.15];
    ctx.save();
    ctx.globalAlpha = o.alpha;
    ctx.strokeStyle = o.color; ctx.fillStyle = o.color;
    ctx.lineJoin = "round";
    if (o.robot) {
      ctx.lineCap = "butt"; ctx.lineWidth = Math.max(3, r * 0.34);
      ctx.globalAlpha = o.alpha * 0.35;
      line(ctx, [W, Pm]); line(ctx, [Pm, MJ, M]);
      ctx.globalAlpha = o.alpha;
      line(ctx, [W, Pm]); line(ctx, [Pm, TJ, T]); line(ctx, [Pm, IJ, I]);
      ctx.lineWidth = 1.2; ctx.fillStyle = "#0b0e13";
      for (const q of [Pm, TJ, IJ]) { ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2.5, r * 0.18), 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = o.color;
      for (const q of [T, I]) { FT.roundRect(ctx, q[0] - r * 0.17, q[1] - r * 0.24, r * 0.34, r * 0.48, 2); ctx.fill(); }
    } else {
      ctx.lineCap = "round"; ctx.lineWidth = Math.max(1.4, r * 0.14);
      if (o.dash) ctx.setLineDash([4, 4]);
      ctx.globalAlpha = o.alpha * 0.45; line(ctx, [Pm, MJ, M]);
      ctx.globalAlpha = o.alpha;
      line(ctx, [W, Pm]); line(ctx, [Pm, TJ, T]); line(ctx, [Pm, IJ, I]);
      ctx.setLineDash([]);
      for (const q of [T, I]) { ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2.4, r * 0.2), 0, 7); ctx.fill(); }
      for (const q of [W, Pm, TJ, IJ]) { ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1.6, r * 0.11), 0, 7); ctx.fill(); }
    }
    ctx.restore();
    return { T, I, W };
  }
  function line(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  function path(ctx, v, pts, off) {
    const o = off || 0;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = v.X(p[0]), y = v.Y(p[1]) - v.s / 2 + o; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  }
  function label(ctx, x, y, text, color, alpha, align) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
    ctx.fillStyle = color; ctx.textAlign = align || "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  // The full foresight picture at time t.
  function foresight(ctx, v, t, o) {
    const S = FT.scene;
    // observed trail
    ctx.save();
    for (let i = 0; i < 34; i++) {
      const tt = t - 1.7 + i * 0.05;
      if (tt < 0) continue;
      const p = S.objAt(tt), a = (i / 34) * 0.7 * o.past;
      ctx.globalAlpha = a; ctx.fillStyle = C.past;
      ctx.beginPath(); ctx.arc(v.X(p[0]), v.Y(p[1]) - v.s / 2, 2.1, 0, 7); ctx.fill();
    }
    ctx.restore();
    if (o.fore <= 0.01) return null;
    const F = FT.futures(t, o.K, { verifier: o.verifier });
    ctx.save();
    ctx.lineWidth = 1.3;
    for (const s of F.samples) {
      const bad = s.rejected && o.verifier;
      ctx.globalAlpha = o.fore * (bad ? 0.5 : 0.42);
      ctx.strokeStyle = bad ? C.reached : C.fore;
      ctx.setLineDash(bad ? [3, 4] : []);
      path(ctx, v, s.pts); ctx.stroke();
      if (bad) {
        const x = v.X(s.hitX), y = v.Y(s.hitY) - 1;
        ctx.setLineDash([]); ctx.globalAlpha = o.fore * 0.85; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
        ctx.lineWidth = 1.3;
      }
    }
    ctx.setLineDash([]);
    if (F.fused) {
      ctx.globalAlpha = o.fore; ctx.strokeStyle = C.fore; ctx.lineWidth = 2.6;
      path(ctx, v, F.fused); ctx.stroke();
      const e = F.fused[F.fused.length - 1], e2 = F.fused[F.fused.length - 3];
      const ex = v.X(e[0]), ey = v.Y(e[1]) - v.s / 2, ang = Math.atan2(ey - (v.Y(e2[1]) - v.s / 2), ex - v.X(e2[0]));
      ctx.fillStyle = C.fore; ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * 7, ey + Math.sin(ang) * 7);
      ctx.lineTo(ex + Math.cos(ang + 2.5) * 7, ey + Math.sin(ang + 2.5) * 7);
      ctx.lineTo(ex + Math.cos(ang - 2.5) * 7, ey + Math.sin(ang - 2.5) * 7);
      ctx.closePath(); ctx.fill();
    }
    if (o.truth) {
      const tr = [];
      for (let i = 0; i <= 22; i++) tr.push(S.objAt(Math.min(t + (i / 22) * 1.7, S.T)));
      ctx.globalAlpha = 0.9; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.4; ctx.setLineDash([2, 5]);
      path(ctx, v, tr); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    return F;
  }
  function tiltAt(t) {
    const S = FT.scene, a = S.objAt(t), b = S.objAt(t + 0.05);
    return S.held(t) ? FT.clamp((b[0] - a[0]) * 6 - (b[1] - a[1]) * 2, -0.35, 0.35) : 0;
  }
  return { C, rgba, view, desk, object, hand, path, label, foresight, tiltAt };
})();

/* Hero title: the name always reads "Dexterous Foretargeting from Human Videos"; the tabs under it light its parts.
   forecasting   -> "Fore" glows (amber)
   retargeting   -> "retargeting" glows (blue)
   foretargeting -> the whole name, in NYU violet
   It also talks to the 3D stage (the forecast ghosts, the take). */
(function () {
  const word = document.getElementById("wordmark");
  const tabs = [...document.querySelectorAll("#decoder .decoder-tabs button")];
  if (!word || !tabs.length) return;

  word.textContent = "";
  const part = {};
  for (const [k, t] of [["fo", "Fo"], ["re", "re"], ["tail", "targeting"]]) {
    const s = document.createElement("span");
    s.className = "wp"; s.textContent = t; s.setAttribute("aria-hidden", "true");
    word.appendChild(s); part[k] = s;
  }
  // per state: the pieces lit; the rest stays as plain text
  const lit = { fore: ["fo", "re"], robot: ["re", "tail"], all: ["fo", "re", "tail"] };
  const order = ["fore", "robot", "all"];
  let i = 0, timer = 0;
  const STEP_MS = 4000;
  function next() { i = (i + 1) % order.length; show(order[i]); }
  // a click or hover shows that reading for one full step, then the cycle carries on from there
  function restart() { clearInterval(timer); timer = setInterval(next, STEP_MS); }
  function show(k, byUser) {
    for (const n in part) part[n].classList.toggle("lit", lit[k].includes(n));
    word.dataset.tone = k;
    tabs.forEach(t => { const on = t.dataset.k === k; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
    const H = window.FTHero;
    if (H) {
      H.ghosts(k === "fore");
      if (byUser && k === "robot") H.take(1);
      if (byUser && k === "fore") H.take(0);
    }
  }
  tabs.forEach(t => {
    const pick = () => {
      if (order[i] === t.dataset.k && timer) return;
      i = order.indexOf(t.dataset.k);
      show(t.dataset.k, true);
      if (!FT.reduced) restart();
    };
    t.addEventListener("click", pick);
    t.addEventListener("mouseenter", pick);
  });
  if (FT.reduced) { show("all"); return; }
  show("fore");
  restart();
})();
