/* Shared helpers: canvas sizing, a visibility-aware animation loop, small maths. */
window.FT = (function () {
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * d));
    const h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  // One requestAnimationFrame for every drawing; each runs only while its element is on screen.
  const jobs = [];
  let running = false;
  function tick(now) {
    running = false;
    const t = now / 1000;
    for (const j of jobs) {
      if (!j.visible || j.paused) continue;
      const dt = j.last == null ? 0 : Math.min(0.05, t - j.last);
      j.last = t;
      j.draw(t, dt);
    }
    schedule();
  }
  function schedule() {
    if (running || document.hidden) return;
    if (jobs.some(j => j.visible && !j.paused)) { running = true; requestAnimationFrame(tick); }
  }
  function animate(el, draw) {
    const job = { el, draw, visible: false, paused: false, last: null };
    jobs.push(job);
    const io = new IntersectionObserver(es => {
      for (const e of es) { job.visible = e.isIntersecting; if (!job.visible) job.last = null; }
      schedule();
    }, { rootMargin: "80px" });
    io.observe(el);
    return {
      pause() { job.paused = true; job.last = null; },
      resume() { job.paused = false; schedule(); },
      kick() { schedule(); }
    };
  }
  document.addEventListener("visibilitychange", () => { for (const j of jobs) j.last = null; schedule(); });

  // Deterministic hash noise: smooth value noise in [-1, 1].
  function hash(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }
  function vnoise(seed, ch, t) {
    const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
    return hash(seed, ch, i) * (1 - s) + hash(seed, ch, i + 1) * s;
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  // Piecewise Hermite through keyframes [t, x, y, stop]; "stop" keys get zero velocity.
  function track(keys) {
    const n = keys.length;
    const tang = keys.map((k, i) => {
      if (k[3] || i === 0 || i === n - 1) return [0, 0];
      const a = keys[i - 1], b = keys[i + 1], dt = b[0] - a[0];
      return [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
    });
    return function (t) {
      if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
      if (t >= keys[n - 1][0]) return [keys[n - 1][1], keys[n - 1][2]];
      let i = 0;
      while (i < n - 2 && t > keys[i + 1][0]) i++;
      const a = keys[i], b = keys[i + 1], h = b[0] - a[0], s = (t - a[0]) / h;
      const h00 = 2 * s * s * s - 3 * s * s + 1, h10 = s * s * s - 2 * s * s + s;
      const h01 = -2 * s * s * s + 3 * s * s, h11 = s * s * s - s * s;
      return [
        h00 * a[1] + h10 * h * tang[i][0] + h01 * b[1] + h11 * h * tang[i + 1][0],
        h00 * a[2] + h10 * h * tang[i][1] + h01 * b[2] + h11 * h * tang[i + 1][1]
      ];
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  return { reduced, fit, animate, vnoise, hash, clamp, lerp, smooth, track, roundRect, css };
})();

/* The pick-and-place every illustration on the page shares.
   Units: x in [0, 1] across the scene, y = height above the desk (desk = 0). */
FT.scene = (function () {
  const T = 8.8;                  // loop length, seconds
  const GRASP = [1.45, 5.75];     // the hand holds the object in this window
  const BOWL = { x: 0.8, w: 0.13, h: 0.085, floor: 0.035 };
  const obj = FT.track([
    [0.0, 0.2, 0, 1], [1.45, 0.2, 0, 1],
    [2.25, 0.235, 0.36, 0], [3.35, 0.47, 0.6, 0], [4.45, 0.72, 0.46, 0],
    [5.25, 0.8, 0.12, 0], [5.75, 0.8, BOWL.floor, 1], [T, 0.8, BOWL.floor, 1]
  ]);
  const hand = FT.track([
    [0.0, 0.05, 0.78, 0], [0.75, 0.13, 0.42, 0], [1.45, 0.2, 0, 1],
    [2.25, 0.235, 0.36, 0], [3.35, 0.47, 0.6, 0], [4.45, 0.72, 0.46, 0],
    [5.25, 0.8, 0.12, 0], [5.75, 0.8, BOWL.floor, 1],
    [6.35, 0.83, 0.2, 0], [7.4, 0.95, 0.78, 1], [T, 0.95, 0.78, 1]
  ]);
  function wrapT(t) { return ((t % T) + T) % T; }
  function objAt(t) { return obj(FT.clamp(t, 0, T)); }
  // How open the hand is: 1 open, 0 closed on the object.
  function openAt(t) {
    if (t < GRASP[0] - 0.45) return 1;
    if (t < GRASP[0]) return 1 - FT.smooth((t - (GRASP[0] - 0.45)) / 0.45);
    if (t < GRASP[1]) return 0;
    return FT.smooth((t - GRASP[1]) / 0.4);
  }
  function held(t) { return t >= GRASP[0] && t < GRASP[1]; }
  // How uncertain the future is: high while the hand is near or holding, low when the object is untouched.
  function activity(t) {
    if (t < GRASP[0] - 0.8) return 0.12;
    if (t < GRASP[0]) return FT.lerp(0.12, 1, FT.smooth((t - (GRASP[0] - 0.8)) / 0.8));
    if (t < GRASP[1]) return 1;
    return FT.lerp(1, 0.08, FT.smooth((t - GRASP[1]) / 0.6));
  }
  function insideBowl(x) { return Math.abs(x - BOWL.x) < BOWL.w * 0.42; }
  function floorAt(x) { return insideBowl(x) ? BOWL.floor - 0.004 : 0; }
  return { T, GRASP, BOWL, objAt, handAt: t => hand(FT.clamp(t, 0, T)), openAt, held, activity, wrapT, floorAt, insideBowl };
})();

/* Sampled futures with a physics check, shared by the hero and the "Foresee" panel. */
FT.futures = function (t, K, opts) {
  const S = FT.scene;
  const H = opts.horizon || 1.7, N = 22;
  const act = S.activity(t);
  const out = [];
  for (let k = 0; k < K; k++) {
    const pts = [];
    let rejected = false, hitX = null, hitY = null;
    // slowly drifting per-sample parameters
    const ph = t * 0.55 + k * 7.31;
    const ax = FT.vnoise(k + 11, 1, ph) * 0.11, ay = FT.vnoise(k + 11, 2, ph) * 0.14;
    const bx = FT.vnoise(k + 11, 3, ph) * 0.05, by = FT.vnoise(k + 11, 4, ph) * 0.09 - 0.02;
    for (let i = 0; i <= N; i++) {
      const h = (i / N) * H;
      const base = S.objAt(Math.min(t + h, S.T));
      const g = Math.pow(h / H, 1.35) * act;
      const x = base[0] + g * (ax + bx * Math.sin(2.1 * h + k));
      const y = base[1] + g * (ay + by * Math.sin(2.7 * h + 2 * k));
      if (!rejected && y < S.floorAt(x) - 0.012) { rejected = true; hitX = x; hitY = S.floorAt(x); }
      pts.push([x, y]);
    }
    out.push({ pts, rejected, hitX, hitY });
  }
  const keep = opts.verifier ? out.filter(s => !s.rejected) : out;
  let fused = null;
  if (keep.length) {
    fused = keep[0].pts.map((_, i) => {
      let x = 0, y = 0;
      for (const s of keep) { x += s.pts[i][0]; y += s.pts[i][1]; }
      x /= keep.length; y /= keep.length;
      if (opts.verifier) y = Math.max(y, S.floorAt(x));  // the desk is a hard rule
      return [x, y];
    });
  }
  return { samples: out, fused };
};
