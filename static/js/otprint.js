/* Contact transport as a contact print (#otPrint), at one moment of a real recording, from the solver's own numbers
   (tools/export_otprint.py on a capture of the OT reference: the plan, y* and m of its first transport round, the Wuji
   hand before that round and after the solve).
   1 The touch leaves a print: the person's hand presses, lifts away, and the object keeps a print of its contact mass,
     one colour per finger (the mass under each bone point, spread on the surface).
   2 Each robot point takes its share: a thread runs from every point on the Wuji hand's bones that the plan gives mass
     to, to its share y* (a ring on the print), in its finger's colour; almost all of it stays on the same finger.
   3 The hand settles onto it: the Wuji hand goes from the shape-only pose to the solved one, and the threads shorten.
   The equation under the stage lights the term each step is about. */
(function () {
  if (!window.Clay || !window.THREE) return;
  const T = THREE, C = Clay;
  // the print's scene on a canvas of its own: load(stem, key) builds it, draw(t) shows loop time t; onStep(s, x, settle) is
  // called every frame for the page around it. Also used by the walk's contact transport stop (rtwalk.js).
  function makePrint(canvas, onStep) {
  const st = C.stage(canvas, { fov: 26, el: 0.3, fit: 1.0, wide: 1.25 });
  const FINGER = [0x5b3fb0, 0x9150c0, 0xc8508f, 0xe7735c, 0xeea23a, 0x9b8f80].map(c => new T.Color(c));
  const BASE = new T.Color(0xece6da), LINK = new T.Color(0x6b7480), WHITE = new T.Color(0xffffff);
  const LOOP = 13.5, STEPS = [0, 3.2, 6.9];
  const VIEW = { mustard: [3.4, 0.35], croissant: [2.5, 0.35], walk_mustard: [1.4, 0.35], walk_drill: [1.6, 0.35], walk_rubic: [-1.2, 0.35] };   // across the fingers, the print in view (az, el); walk_*: the walk's contact transport stop
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const span = (t, a, b) => ease((t - a) / (b - a));
  let S = null;

  const holder = new T.Group(); st.root.add(holder);
  const sph = new T.SphereGeometry(1, 14, 10), cyl = new T.CylinderGeometry(1, 1, 1, 10, 1, true);
  function inst(geo, n, order) {
    const d = new T.InstancedMesh(geo, new T.MeshBasicMaterial({ depthTest: false, transparent: true }), n);
    d.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3); d.renderOrder = order; d.frustumCulled = false;
    holder.add(d); return d;
  }

  function build({ meta: m, buf }, key) {
    holder.clear();
    const L = m.layout, A = k => C.arr(buf, L[k]);
    // the object, with the print in its vertex colours
    const ov = A("object_v"), NV = ov.length / 3, pr = A("object_print");
    const og = C.geometry(new Float32Array(ov), A("object_f"));
    const colors = new Float32Array(NV * 3); og.setAttribute("color", new T.BufferAttribute(colors, 3));
    const object = new T.Mesh(og, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, side: T.DoubleSide }));
    holder.add(object);                                       // held in the air: no shadow on a desk far below
    // the person's hand
    const hand = new T.Mesh(C.geometry(new Float32Array(A("human_v")), A("human_f")),
      new T.MeshStandardMaterial({ color: 0xd99a74, roughness: 0.6, transparent: true, opacity: 0 }));
    hand.renderOrder = 3; holder.add(hand);
    // the Wuji hand, its finger links tinted by finger
    const pb = A("links_before"), pa = A("links_after"), linkMat = {};
    const links = m.links.map((l, k) => {
      const mt = linkMat[l.finger] || (linkMat[l.finger] = new T.MeshStandardMaterial({ color: LINK.clone().lerp(FINGER[l.finger], l.finger === 5 ? 0 : 0.26),
        roughness: 0.42, metalness: 0.18, transparent: true, opacity: 0 }));
      const x = new T.Mesh(C.geometry(new Float32Array(A(`link_${k}_v`)), A(`link_${k}_f`)), mt); holder.add(x);
      return x;
    });
    // the transport: robot points the plan gives mass to, their shares y*, and the masses
    const rl = A("robot_labels"), mm = A("m"), rb = A("robot_before"), ra = A("robot_after"), ys = A("ystar");
    const keep = [...mm.keys()].filter(j => mm[j] > 0.1);
    const fingerOf = lab => lab === 15 ? 5 : Math.floor(lab / 3);
    const v = (a, j) => new T.Vector3(a[j * 3], a[j * 3 + 1], a[j * 3 + 2]);
    const pts = keep.map((j, n) => ({ c: FINGER[fingerOf(rl[j])], b: v(rb, j), a: v(ra, j), y: v(ys, j), w: Math.min(1, mm[j]), d: n / keep.length }));
    const rDots = inst(sph, pts.length, 12), yRim = inst(sph, pts.length, 10), yCore = inst(sph, pts.length, 11), threads = inst(cyl, pts.length, 9);
    for (let k = 0; k < pts.length; k++) { yRim.setColorAt(k, pts[k].c); yCore.setColorAt(k, WHITE); rDots.setColorAt(k, pts[k].c); threads.setColorAt(k, pts[k].c); }
    // per vertex: the print's colour and strength, and when its finger's print comes up
    const tint = new Float32Array(NV * 3), amount = new Float32Array(NV), lag = new Float32Array(NV), col = new T.Color();
    for (let i = 0; i < NV; i++) {
      let s = 0, best = 0, bf = 0; col.setRGB(0, 0, 0);
      for (let f = 0; f < 6; f++) { const w = pr[i * 6 + f] / 255; if (!w) continue; s += w; col.r += FINGER[f].r * w; col.g += FINGER[f].g * w; col.b += FINGER[f].b * w; if (w > best) { best = w; bf = f; } }
      if (s > 0) { tint[i * 3] = col.r / s; tint[i * 3 + 1] = col.g / s; tint[i * 3 + 2] = col.b / s; }
      amount[i] = ease((s - 0.08) / 0.5); lag[i] = bf / 6;   // a print with an edge, not a glow
    }
    // the view: the print in front, the fingers wrapping it from the side
    const cc = new T.Vector3(...m.contact_center), hc = new T.Vector3(...m.hand_center);
    const center = cc.clone().lerp(hc, 0.3), [az, el] = VIEW[key] || [Math.atan2(hc.x - cc.x, cc.y - hc.y) + 1.15, 0.32];
    center.z += 0.012;                                        // the look point a little above: the hand clears the clip switch
    st.frameOn(center, 0.125, m.desk_z);
    st.view.az = az; st.view.el = el;
    return { m, object, colors, tint, amount, lag, NV, hand, links, pb, pa, pts, rDots, yRim, yCore, threads };
  }

  // ---- one frame of the story at loop time t
  const m4 = new T.Matrix4(), qa = new T.Quaternion(), qb = new T.Quaternion(), p3 = new T.Vector3(), up = new T.Vector3(0, 1, 0), dir = new T.Vector3(), qq = new T.Quaternion(), sc = new T.Vector3();
  let lastPrint = -1;
  function draw(t) {
    const x = S;
    const handIn = span(t, 0.0, 0.7), handOut = span(t, 1.9, 3.1), print = span(t, 0.7, 2.9), out = span(t, LOOP - 1.0, LOOP - 0.1);
    const robotIn = span(t, 2.9, 3.9), threadT = (t - 3.9) / 2.6, settle = span(t, 6.9, 9.0);
    // the print
    const P = print * (1 - out);
    if (Math.abs(P - lastPrint) > 1e-3) {
      for (let i = 0; i < x.NV; i++) {
        const a = x.amount[i] * ease(P * 1.5 - x.lag[i] * 0.5);
        x.colors[i * 3] = BASE.r + (x.tint[i * 3] - BASE.r) * a; x.colors[i * 3 + 1] = BASE.g + (x.tint[i * 3 + 1] - BASE.g) * a; x.colors[i * 3 + 2] = BASE.b + (x.tint[i * 3 + 2] - BASE.b) * a;
      }
      x.object.geometry.attributes.color.needsUpdate = true; lastPrint = P;
    }
    // the person's hand comes, presses, and lifts into a ghost
    x.hand.material.opacity = handIn * (0.92 - 0.8 * handOut) * (1 - out);
    // the Wuji hand: in after the touch, shape-only pose, then the solved one
    const ro = robotIn * (1 - out);
    for (const mt of new Set(x.links.map(l => l.material))) { mt.opacity = ro; mt.depthWrite = ro > 0.98; }
    x.links.forEach((l, k) => {
      const b = k * 7;
      l.position.set(x.pb[b] + (x.pa[b] - x.pb[b]) * settle, x.pb[b + 1] + (x.pa[b + 1] - x.pb[b + 1]) * settle, x.pb[b + 2] + (x.pa[b + 2] - x.pb[b + 2]) * settle);
      qa.set(x.pb[b + 4], x.pb[b + 5], x.pb[b + 6], x.pb[b + 3]); qb.set(x.pa[b + 4], x.pa[b + 5], x.pa[b + 6], x.pa[b + 3]);
      l.quaternion.copy(qa).slerp(qb, settle); l.visible = ro > 0.01;
    });
    // robot points, their shares and the threads between them
    x.pts.forEach((p, k) => {
      const g = ease((threadT - p.d * 0.5) / 0.5) * (1 - out), r = p3.copy(p.b).lerp(p.a, settle);
      const rd = (0.0012 + 0.0011 * p.w) * ro;
      m4.makeScale(rd, rd, rd).setPosition(r); x.rDots.setMatrixAt(k, m4);
      const yr = (0.0021 + 0.0008 * p.w) * g, yc = yr * 0.55;
      m4.makeScale(yr, yr, yr).setPosition(p.y); x.yRim.setMatrixAt(k, m4);
      m4.makeScale(yc, yc, yc).setPosition(p.y); x.yCore.setMatrixAt(k, m4);
      // the thread grows from the robot point toward its share
      dir.copy(p.y).sub(r); const len = dir.length() * g, th = (0.00035 + 0.0004 * p.w) * (g > 0 ? 1 : 0);
      dir.normalize(); qq.setFromUnitVectors(up, dir);
      m4.compose(sc.copy(r).addScaledVector(dir, len / 2), qq, new T.Vector3(th, Math.max(len, 1e-6), th)); x.threads.setMatrixAt(k, m4);
    });
    for (const d of [x.rDots, x.yRim, x.yCore, x.threads]) d.instanceMatrix.needsUpdate = true;
    x.rDots.material.opacity = 1; x.threads.material.opacity = 0.9;
    if (onStep) onStep(t < STEPS[1] ? 0 : t < STEPS[2] ? 1 : 2, x, settle, t);
  }
  let loading = null;
  function load(stem, key, done) {
    const p = loading = C.load(stem).then(d => {
      if (p !== loading) return;
      const keepView = S ? { az: st.view.dragAz, el: st.view.dragEl } : null;
      S = build(d, key); lastPrint = -1;
      if (keepView) Object.assign(st.view, { dragAz: keepView.az, dragEl: keepView.el });
      if (done) done(d.meta);
    }).catch(e => console.error(e));
    return p;
  }
  return { st, load, draw: t => { if (S) draw(t); }, ready: () => !!S, LOOP, STEPS };
  }
  window.FTPrint = makePrint;

  // ---- the figure (#otPrint)
  const fig = document.getElementById("otPrint");
  if (!fig) return;
  let clock = 0, paused = !!(window.FT && FT.reduced), want = fig.dataset.clip || "mustard";
  const P = makePrint(fig.querySelector("canvas"), (s, x, settle, t) => {
    if (s !== step) setStep(s);
    if (dist) dist.textContent = `${(x.m.dist_mm.before + (x.m.dist_mm.after - x.m.dist_mm.before) * settle).toFixed(1)} mm`;
    bar.style.width = `${(100 * t / LOOP).toFixed(2)}%`;
  });
  const st = P.st, LOOP = P.LOOP, STEPS = P.STEPS;

  // ---- the page around it
  const stepBtns = [...fig.querySelectorAll(".otp-steps button")], eq = fig.querySelector(".otp-eq"), bar = fig.querySelector(".otc-bar i");
  const dist = fig.querySelector("[data-k=dist]"), playBtn = fig.querySelector(".otc-play");
  let step = -1;
  function setStep(s) {
    step = s;
    stepBtns.forEach((b, k) => { b.classList.toggle("on", k === s); b.classList.toggle("done", k < s); });
    eq.dataset.s = s;
  }
  stepBtns.forEach((b, k) => b.addEventListener("click", () => { clock = STEPS[k] + (k ? 0.01 : 0); if (k === 2) clock = 6.9; if (P.ready()) { P.draw(clock); st.once(performance.now() / 1000); } }));
  function setPaused(p) { paused = p; playBtn.classList.toggle("paused", p); playBtn.setAttribute("aria-label", p ? "Play" : "Pause"); }
  playBtn.addEventListener("click", () => setPaused(!paused));
  setPaused(paused);
  const clipBtns = [...fig.querySelectorAll(".otp-clips button")];
  clipBtns.forEach(b => b.addEventListener("click", () => {
    clipBtns.forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    open(b.dataset.clip);
  }));
  function fill(m) {
    fig.querySelectorAll("[data-k=finger]").forEach(e => { e.textContent = `${+(100 * m.share.same_finger).toFixed(1)}%`; });
    fig.querySelectorAll("[data-k=range]").forEach(e => { e.textContent = `${m.dist_mm.before.toFixed(0)} → ${m.dist_mm.after.toFixed(0)} mm`; });
  }
  function open(key) {
    want = key;
    P.load(`otprint_${key}`, key, meta => { clock = 0; fill(meta); fig.classList.add("ready"); });
  }
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); open(want); } }, { rootMargin: "300px" });
  io.observe(fig);
  st.loop((sec, dt) => {
    if (!P.ready()) return;
    if (!paused) clock = (clock + dt) % LOOP;
    P.draw(clock);
  });
  fig.snap = t => { clock = t; if (P.ready()) { P.draw(t); st.once(performance.now() / 1000); } };   // one frame now, for checking
  fig.view = (az, el) => { if (P.ready()) { st.view.az = az; st.view.el = el; st.once(performance.now() / 1000); } };
})();
