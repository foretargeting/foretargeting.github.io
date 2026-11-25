/* World-model figure, on a held-out real Aria recording (both hands moving a big box the model never saw in training;
   static/hero/wmdelta.*, tools/export_wmdelta.py) with the model's own predictions on it: our
   interaction_surface checkpoint (the live app's), run on every window of the recording through wm_step.onnx.
   Left column "in": what one window gives the model, one card each: both hands' 21 MANO landmarks over the 6 frames, the
   object's 512 input points in its own frame, the object's 3 observed poses (axes), and the interaction-surface features
   (wrist and fingertips to the nearest surface point).
   Middle: the architecture as an animated diagram; its rectified-flow panel moves dots along straight paths from noise
   to the 3 changes in 4 Euler steps.
   Right column "out": three windows of the clip. The model outputs the next 3 poses (t + 0.1, 0.2, 0.3 s) as a change from
   the pose at t; the card plays that change out on the box step by step (amber), with the hands the model is given for those
   frames as ghosts; the two lines under it are the model's change and the recording's, as glyphs.
   Each column is one canvas laid over its cards, one viewport per card. */
(function () {
  const fig = document.getElementById("wmFig");
  if (!fig) return;
  const reduced = window.FT && FT.reduced;
  arch();
  if (!window.THREE || !window.Clay) return;
  const T = THREE, C = Clay;
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12],
                 [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]];
  const PROBE_LM = [0, 4, 8, 12, 16, 20];          // wrist + fingertips, the landmarks the surface features start from
  const WIN = [-6, -3, 0, 3, 6, 9];                // window frames about t (30 Hz): 3 observed, 3 next
  const SIDES = ["left", "right"];
  const AMBER = 0xf2a93b;
  const PLAY = 2.4, HOLD = 1.6;                    // output cards: seconds to play the change out, then to hold it

  const near = new IntersectionObserver(es => { if (es[0].isIntersecting) { near.disconnect(); load(); } }, { rootMargin: "300px" });
  near.observe(fig);

  function load() {
    const STEM = (new URLSearchParams(location.search).get("wm") || "wmdelta").replace(/[^a-z_]/g, "");   // ?wm=wmdelta_cleaner: another held-out example (for stills and loops)
    Promise.all([fetch(`static/hero/${STEM}.json`).then(r => r.json()), fetch(`static/hero/${STEM}.bin`).then(r => r.arrayBuffer())])
      .then(([meta, buf]) => build(meta, buf)).catch(e => console.error(e));
  }

  function build(meta, buf) {
    const L = meta.layout, N = meta.n, FPS = meta.fps, KS = meta.samples;
    const op = C.arr(buf, L.obj_p), oq = C.arr(buf, L.obj_q), pred = C.arr(buf, L.pred), cloud = C.arr(buf, L.cloud);
    const hv = { left: C.arr(buf, L.left_v), right: C.arr(buf, L.right_v) }, lmA = { left: C.arr(buf, L.left_lm), right: C.arr(buf, L.right_lm) };
    const NHF = L.left_v.shape[0], HE = meta.hand_every, HU = meta.hand_unit;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, 0.01, 20), root = new T.Group();
    root.rotation.x = -Math.PI / 2;
    scene.add(root, new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.7));
    const key = new T.DirectionalLight(0xffffff, 0.9); key.position.set(-0.4, 1.6, 0.8); scene.add(key, key.target);
    const rim = new T.DirectionalLight(0xfff1df, 0.35); rim.position.set(1.2, 0.6, -1); scene.add(rim);

    // ---- things a card may show
    const skin = C.clay(0xd9ac8f, { transparent: false });
    const hands = {};
    SIDES.forEach(s => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(778 * 3), 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(C.arr(buf, L[s + "_f"])), 1));
      hands[s] = new T.Mesh(g, skin); hands[s].frustumCulled = false;
    });
    // output cards: the hands the model is given for the next 0.3 s, as ghosts that move ahead with the amber box
    const ghostMat = new T.MeshStandardMaterial({ color: 0xd9ac8f, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.7 });
    const ghosts = {};
    SIDES.forEach(s => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(778 * 3), 3));
      g.setIndex(hands[s].geometry.index);
      ghosts[s] = new T.Mesh(g, ghostMat); ghosts[s].frustumCulled = false; ghosts[s].renderOrder = 5;
    });
    const seen = C.clay(0xd8d2c6, { transparent: false }), faintObj = new T.MeshStandardMaterial({ color: 0xd8d2c6, transparent: true, opacity: 0.45, depthWrite: false });
    const bGeo = C.geometry(C.arr(buf, L.mesh_v), C.arr(buf, L.mesh_f)), box = new T.Mesh(bGeo, seen);
    const amberMat = o => new T.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.25, transparent: true, opacity: o, depthWrite: false });
    const mover = new T.Mesh(bGeo, amberMat(0.55)), stamps = [0, 1, 2].map(() => new T.Mesh(bGeo, amberMat(0.16)));
    // the path the model's change takes: through the box's centre at t and at the three predicted steps
    const trail = new T.Line(new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(12), 3)), new T.LineBasicMaterial({ color: 0xc77d14, depthTest: false }));
    const knotGeo = new T.SphereGeometry(0.006, 12, 8), knots = [0, 1, 2, 3].map(() => new T.Mesh(knotGeo, new T.MeshBasicMaterial({ color: 0xc77d14, depthTest: false })));
    trail.renderOrder = 7; trail.frustumCulled = false; knots.forEach(k => { k.renderOrder = 8; });
    // the desk top (z = 0)
    const desk = new T.Mesh(new T.CircleGeometry(0.34, 64), new T.MeshBasicMaterial({ color: 0xf1e6d4 }));
    const cloudC = new T.Box3().setFromBufferAttribute(new T.BufferAttribute(cloud, 3)).getCenter(new T.Vector3());
    const cloudPts = new T.Points(new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(cloud, 3)), new T.PointsMaterial({ color: 0x6b6457, size: 3.5, sizeAttenuation: false }));
    // axes: a pose's frame (x red, y green, z blue)
    const triad = (len, o) => {
      const g = new T.Group();
      [[1, 0, 0, 0xe5545b], [0, 1, 0, 0x22b37a], [0, 0, 1, 0x3ea8e5]].forEach(([x, y, z, c]) => {
        const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(x * len, y * len, z * len)]), new T.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false }));
        l.renderOrder = 6; g.add(l);
      });
      return g;
    };
    const histTriads = [0.4, 0.7, 1].map(o => triad(0.2, o));
    // landmark skeletons, one per hand and window frame: observed dark, next light
    const skel = [];
    SIDES.forEach(side => WIN.forEach(df => {
      const col = df <= 0 ? 0x8a5a44 : 0xd9a07f, o = df <= 0 ? 0.35 + 0.1 * (df + 6) : 0.75 - 0.06 * (df - 3);
      const lines = new T.LineSegments(new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(BONES.length * 6), 3)),
        new T.LineBasicMaterial({ color: col, transparent: true, opacity: o, depthTest: false }));
      const pts = new T.Points(new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(63), 3)),
        new T.PointsMaterial({ color: col, size: df === 0 ? 7 : 5, sizeAttenuation: false, transparent: true, opacity: o, depthTest: false }));
      lines.renderOrder = pts.renderOrder = 6;
      const g = new T.Group(); g.add(lines, pts); g.userData = { side, df, lines, pts };
      skel.push(g);
    }));
    const probeGeo = new T.SphereGeometry(0.0045, 12, 8);
    const probes = [];
    SIDES.forEach(side => PROBE_LM.forEach(j => {
      const dot = new T.Mesh(probeGeo, new T.MeshBasicMaterial({ color: 0x22b37a, depthTest: false }));
      const ln = new T.Line(new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(6), 3)), new T.LineBasicMaterial({ color: 0x22b37a, transparent: true, opacity: 0.8, depthTest: false }));
      dot.renderOrder = ln.renderOrder = 6;
      const g = new T.Group(); g.add(dot, ln); g.userData = { side, j, dot, ln };
      probes.push(g);
    }));
    const all = [...SIDES.map(s => hands[s]), ...SIDES.map(s => ghosts[s]), box, mover, ...stamps, trail, ...knots, desk, cloudPts, ...histTriads, ...skel, ...probes];
    root.add(...all);

    // ---- the recording (f: clip frame at 30 Hz, may be fractional)
    const clampF = f => Math.max(0, Math.min(N - 1.001, f));
    const qa = new T.Quaternion(), qb = new T.Quaternion();
    function objAt(f, o) {
      f = clampF(f); const i = Math.floor(f), s = f - i, j = i * 3, k = (i + 1) * 3;
      o.position.set(op[j] + (op[k] - op[j]) * s, op[j + 1] + (op[k + 1] - op[j + 1]) * s, op[j + 2] + (op[k + 2] - op[j + 2]) * s);
      qa.set(oq[i * 4 + 1], oq[i * 4 + 2], oq[i * 4 + 3], oq[i * 4]); qb.set(oq[i * 4 + 5], oq[i * 4 + 6], oq[i * 4 + 7], oq[i * 4 + 4]);
      o.quaternion.copy(qa).slerp(qb, s);
      return o;
    }
    function lmAt(side, f, out) {
      f = clampF(f); const i = Math.floor(f), s = f - i, A = lmA[side], a = i * 63, b = (i + 1) * 63;
      for (let v = 0; v < 63; v++) out[v] = A[a + v] + (A[b + v] - A[a + v]) * s;
      return out;
    }
    function setHand(side, f, mat, mesh = hands[side]) {
      const g = Math.max(0, Math.min(NHF - 1.001, clampF(f) / HE)), i = Math.floor(g), s = g - i, A = hv[side], a = i * 778 * 3, b = (i + 1) * 778 * 3;
      const out = mesh.geometry.attributes.position.array;
      for (let v = 0; v < 778 * 3; v++) out[v] = (A[a + v] + (A[b + v] - A[a + v]) * s) * HU;
      mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.computeVertexNormals();
      mesh.material = mat;
    }
    // the model's pose j (0..2 = t + 0.1, 0.2, 0.3 s) for the window at clip frame i (the first noise draw: the one a
    // rollout commits)
    function predAt(i, j, o, k = 0) {
      const b = ((i * KS + k) * 3 + j) * 7;
      if (isNaN(pred[b])) return null;
      o.position.set(pred[b], pred[b + 1], pred[b + 2]); o.quaternion.set(pred[b + 4], pred[b + 5], pred[b + 6], pred[b + 3]);
      return o;
    }
    // the change from the pose at t: dp in cm (desk axes), angle of R_t^T R in degrees
    const tmpA = new T.Object3D(), tmpB = new T.Object3D();
    function change(i, j, fromRecording) {
      objAt(i, tmpA);
      if (fromRecording) objAt(i + 3 * (j + 1), tmpB); else if (!predAt(i, j, tmpB)) return null;
      const dp = tmpB.position.clone().sub(tmpA.position).multiplyScalar(100);
      const dq = tmpA.quaternion.clone().invert().multiply(tmpB.quaternion);
      return { dp, ang: 2 * Math.acos(Math.min(1, Math.abs(dq.w))) * 180 / Math.PI };
    }
    // the same change in words
    // the same change as a glyph: up / down / sideways in cm, then the turn
    function glyph(c) {
      const h = Math.hypot(c.dp.x, c.dp.y), z = c.dp.z, m = c.dp.length();
      if (m < 1.5 && c.ang < 5) return "still";
      const move = Math.abs(z) >= Math.max(1.5, 0.8 * h) ? `${z > 0 ? "↑" : "↓"} ${Math.abs(z).toFixed(0)} cm` : `→ ${h.toFixed(0)} cm`;
      return c.ang >= 8 ? `${move} · ↻ ${c.ang.toFixed(0)}°` : move;
    }

    // ---- what each card shows at clip frame f (input cards: one moving f; output cards: their own window)
    const show = (...objs) => { all.forEach(o => { o.visible = false; }); objs.forEach(o => { o.visible = true; }); };
    const lmk = new Float32Array(63), wp = new T.Vector3(), tp = new T.Vector3(), cp = new T.Vector3();
    const steps = [new T.Object3D(), new T.Object3D(), new T.Object3D(), new T.Object3D()];
    const TILE = {
      hands(f) {
        show(box, ...skel);
        objAt(f, box); box.material = faintObj;
        skel.forEach(g => {
          lmAt(g.userData.side, f + g.userData.df, lmk);
          g.userData.pts.geometry.attributes.position.array.set(lmk); g.userData.pts.geometry.attributes.position.needsUpdate = true;
          const a = g.userData.lines.geometry.attributes.position.array;
          BONES.forEach(([p, q], n) => { a.set([lmk[p * 3], lmk[p * 3 + 1], lmk[p * 3 + 2], lmk[q * 3], lmk[q * 3 + 1], lmk[q * 3 + 2]], n * 6); });
          g.userData.lines.geometry.attributes.position.needsUpdate = true;
        });
        return box.position;
      },
      cloud(f, s) {
        show(cloudPts);
        cloudPts.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), s * 0.5);
        cloudPts.position.copy(cloudC).applyQuaternion(cloudPts.quaternion).negate();
        return new T.Vector3(0, 0, -0.04);
      },
      history(f) {
        show(box, ...histTriads);
        objAt(f, box); box.material = faintObj;
        histTriads.forEach((g, i) => objAt(f + WIN[i], g));
        return box.position;
      },
      contact(f) {
        show(...SIDES.map(s => hands[s]), box, ...probes);
        SIDES.forEach(s => setHand(s, f, skin)); objAt(f, box); box.material = seen; box.updateMatrix();
        const lm = { left: lmAt("left", f, new Float32Array(63)), right: lmAt("right", f, new Float32Array(63)) };
        probes.forEach(p => {
          const A = lm[p.userData.side], j = p.userData.j;
          wp.set(A[j * 3], A[j * 3 + 1], A[j * 3 + 2]);
          let best = Infinity;
          for (let i = 0; i < 512; i++) { tp.set(cloud[i * 3], cloud[i * 3 + 1], cloud[i * 3 + 2]).applyMatrix4(box.matrix); const d = tp.distanceToSquared(wp); if (d < best) { best = d; cp.copy(tp); } }
          p.userData.dot.position.copy(wp);
          p.userData.ln.geometry.attributes.position.array.set([wp.x, wp.y, wp.z, cp.x, cp.y, cp.z]);
          p.userData.ln.geometry.attributes.position.needsUpdate = true;
        });
        return box.position;
      },
      // u in [0, 3]: how far the change has played out (1 = at t + 0.1 s, 3 = at t + 0.3 s)
      out(i, u) {
        show(...SIDES.map(s => hands[s]), ...SIDES.map(s => ghosts[s]), box, desk, trail, mover);
        SIDES.forEach(s => { setHand(s, i, skin); setHand(s, i + 3 * u, ghostMat, ghosts[s]); }); objAt(i, box); box.material = seen;
        desk.position.set(box.position.x, box.position.y, -0.001);
        objAt(i, steps[0]);
        for (let j = 0; j < 3; j++) if (!predAt(i, j, steps[j + 1])) steps[j + 1].copy(steps[j]);
        const a = trail.geometry.attributes.position.array;
        steps.forEach((s, k) => { a.set([s.position.x, s.position.y, s.position.z], k * 3); knots[k].position.copy(s.position); knots[k].visible = k <= u + 1e-6; });
        trail.geometry.setDrawRange(0, Math.min(4, Math.floor(u) + 2)); trail.geometry.attributes.position.needsUpdate = true;
        const k = Math.min(2, Math.floor(u)), s = u - k;
        mover.position.lerpVectors(steps[k].position, steps[k + 1].position, s);
        mover.quaternion.copy(steps[k].quaternion).slerp(steps[k + 1].quaternion, s);
        stamps.forEach((m, j) => { m.visible = u >= j + 1; m.position.copy(steps[j + 1].position); m.quaternion.copy(steps[j + 1].quaternion); });
        return box.position;
      }
    };

    // ---- output sentences, read off the model's change and the recording's
    // one output card; its example moments are a menu inside it, stepped through once per play until one is picked
    const outCard = fig.querySelector(".wm-card3.o"), exSel = outCard && outCard.querySelector(".wm-ex select"), exBtns = exSel ? [...exSel.options] : [];
    exBtns.forEach(b => {
      const i = Math.round(+b.dataset.at * FPS), m = change(i, 2, false), r = change(i, 2, true);
      b.dataset.say = `<span class="m">model</span> ${glyph(m)}<br><span class="r">recorded</span> ${glyph(r)}`;
    });
    let exAuto = true, exK = 0;
    function pickExample(k, byUser) {
      exK = k; const b = exBtns[k];
      if (!b) return;
      if (byUser) exAuto = false;
      outCard.dataset.at = b.dataset.at;
      outCard.querySelector(".say").innerHTML = b.dataset.say;
      exSel.value = String(k);
      clock = 0;
    }
    if (exSel) exSel.addEventListener("change", () => pickExample(+exSel.value, true));
    const note = document.getElementById("wmWhole"), Wh = meta.whole;
    if (note) note.textContent = `Over the whole ${Math.round(Wh.duration_s / 60 * 10) / 10}-minute recording, the model's +0.3 s position is off by a median ${Wh.err_cm_median} cm (${Wh.err_cm_median_moving} cm while the box moves, when it moves a median ${Wh.moved_cm_median_moving} cm).`;

    // ---- a card's camera
    const look = { az: -2.35, el: 0.55 };
    function view(card, w, h, s, f, u) {
      const name = card.dataset.tile, isOut = card.classList.contains("o");
      const c = (isOut ? TILE.out(Math.round(+card.dataset.at * FPS), u) : TILE[name](f, s)).clone();
      const target = new T.Vector3(c.x, c.z + (isOut ? -0.02 : 0.03), -c.y);
      // a tall, narrow picture (the output card, stretched to the row) pulls back so the box and hands still fit across
      const fit = Math.max(1, (isOut ? 1.25 : 1.1) / (w / h));
      const dist = (name === "cloud" ? 0.66 : name === "hands" ? 1.2 : isOut ? 1.2 : 0.92) * fit, A = look.az + (reduced ? 0 : 0.12 * Math.sin(s * 0.2)), E = name === "cloud" ? 0.5 : look.el;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      camera.position.set(target.x + dist * Math.cos(E) * Math.sin(A), target.y + dist * Math.sin(E), target.z + dist * Math.cos(E) * Math.cos(A));
      camera.lookAt(target);
    }
    // ---- the two columns: one canvas over each deck, one viewport per card. The canvas sits beside the deck, not in
    // it, so on a phone the input deck can scroll sideways (a swipe strip) under a canvas that stays put
    const cols = [...fig.querySelectorAll(".wm-deck")].map(el => {
      const canvas = document.createElement("canvas"), r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding; r.setScissorTest(true);
      canvas.className = "wm-deck-gl";
      el.parentNode.insertBefore(canvas, el.nextSibling);
      const col = { el, r, canvas, cards: [...el.querySelectorAll(".wm-card3")], visible: true, W: 0, H: 0 };
      new IntersectionObserver(es => { col.visible = es[0].isIntersecting; }, { rootMargin: "60px" }).observe(el);
      // the strip's dots (shown on phones only): which card is in view, and a tap goes to a card
      if (col.cards.length > 1) {
        const dots = document.createElement("div");
        dots.className = "wm-dots";
        dots.innerHTML = col.cards.map((c, i) => `<button type="button" aria-label="${(c.querySelector("b") || {}).textContent || "card " + (i + 1)}"></button>`).join("");
        el.parentNode.insertBefore(dots, canvas.nextSibling);
        const bs = [...dots.children];
        const mark = () => {
          const x = el.scrollLeft; let k = 0, best = Infinity;
          col.cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft - col.cards[0].offsetLeft - x); if (d < best) { best = d; k = i; } });
          bs.forEach((b, i) => b.classList.toggle("on", i === k));
        };
        bs.forEach((b, i) => b.addEventListener("click", () => el.scrollTo({ left: col.cards[i].offsetLeft - col.cards[0].offsetLeft, behavior: "smooth" })));
        el.addEventListener("scroll", mark, { passive: true });
        mark();
      }
      return col;
    });
    let f = 6, last = null, clock = 0;
    pickExample(0);
    let frame = function (nowMs) {
      if (document.hidden) return;
      let s = nowMs / 1000, dt = last == null ? 0 : Math.max(0, Math.min(0.05, s - last)); last = s;
      if (fig._tick != null) { dt = fig._tick; fig._tick = 0; s = clock + dt; }   // captures: fig._tick = seconds to advance by on the next frame only
      if (fig._restart) { fig._restart = false; f = 6; clock = 0; }
      if (!reduced) {
        f += dt * FPS * 0.6; if (f > N - 10) f = 6; clock += dt;
        if (exAuto && exBtns.length && clock >= PLAY + HOLD) pickExample((exK + 1) % exBtns.length);
      }
      const u = reduced ? 3 : Math.min(3, 3 * ((clock % (PLAY + HOLD)) / PLAY));
      cols.forEach(col => {
        if (!col.visible) return;
        // rects are in screen px; a zoomed figure (fit.js) lays out in its own px: divide by the zoom
        const cb = col.el.getBoundingClientRect(), pb = col.el.parentNode.getBoundingClientRect(), z = (cb.width / (col.el.offsetWidth || cb.width)) || 1;
        if (Math.abs(cb.width / z - col.W) > 1 || Math.abs(cb.height / z - col.H) > 1) {
          col.W = cb.width / z; col.H = cb.height / z; col.r.setSize(col.W, col.H, false);
          col.canvas.style.width = col.W + "px"; col.canvas.style.height = col.H + "px";
        }
        col.canvas.style.left = (cb.left - pb.left) / z + "px"; col.canvas.style.top = (cb.top - pb.top) / z + "px";
        col.r.setScissorTest(false); col.r.clear(); col.r.setScissorTest(true);
        col.cards.forEach(card => {
          const vb = card.querySelector(".vis").getBoundingClientRect(), x = (vb.left - cb.left) / z, y = (vb.top - cb.top) / z, w = vb.width / z, h = vb.height / z;
          if (card.classList.contains("o")) card.querySelectorAll(".wm-steps i").forEach((b, k) => b.classList.toggle("on", u >= k + 1));
          // a card scrolled out of the strip is skipped; one half in view is cut at the strip's edge
          const x0 = Math.max(0, x), x1 = Math.min(col.W, x + w);
          if (x1 - x0 < 1) return;
          view(card, w, h, s, f, card.classList.contains("o") ? u : 3);
          col.r.setViewport(x, col.H - y - h, w, h); col.r.setScissor(x0, col.H - y - h, x1 - x0, h);
          col.r.render(scene, camera);
        });
      });
    };
    // ---- the flow panel in the diagram: at the lift, boxes start at random poses about the box (noise) and move in
    // straight lines, one Euler step per pass of the transformer, onto the model's own samples for t + 0.3 s
    // (KS noise draws of the real model for this window; each is reached by a few of the noise boxes)
    const flowCanvas = fig.querySelector(".wm-flow"), flowRect = fig.querySelector(".wm-arch .flbox");
    let flowR = null, flowU = 0, flowView = null;
    const FI = Math.round(2.75 * FPS), ghosts3 = [], gpos = new T.Vector3(), gq = new T.Quaternion();
    if (flowCanvas && flowRect) {
      flowR = new T.WebGLRenderer({ canvas: flowCanvas, antialias: true, alpha: true });
      flowR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); flowR.outputEncoding = T.sRGBEncoding;
      const r0 = (k => () => { k = (k * 48271) % 2147483647; return k / 2147483647; })(3), gauss = () => Math.sqrt(-2 * Math.log(r0() + 1e-9)) * Math.cos(2 * Math.PI * r0());
      const at = objAt(FI, new T.Object3D());
      for (let n = 0; n < 3 * KS; n++) {
        const goal = predAt(FI, 2, new T.Object3D(), n % KS) || at;
        const start = new T.Object3D();
        start.position.copy(at.position).add(new T.Vector3(0.09 * gauss(), 0.09 * gauss(), 0.05 + 0.06 * gauss()));
        start.quaternion.copy(at.quaternion).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(gauss(), gauss(), gauss()).normalize(), 0.8 * gauss()));
        const m = new T.Mesh(bGeo, amberMat(0.16)); m.visible = false; root.add(m); all.push(m);
        ghosts3.push({ m, start, goal });
      }
    }
    function drawFlow(s) {
      if (!flowR || !fig.querySelector(".wm-mid").getBoundingClientRect().height) return;
      const midEl = fig.querySelector(".wm-mid"), mid = midEl.getBoundingClientRect(), rb = flowRect.getBoundingClientRect(), z = (mid.width / (midEl.offsetWidth || mid.width)) || 1;
      if (rb.bottom < 0 || rb.top > innerHeight) return;
      const w = rb.width / z - 8, h = rb.height / z - 30;
      Object.assign(flowCanvas.style, { left: ((rb.left - mid.left) / z + 4) + "px", top: ((rb.top - mid.top) / z + 4) + "px", width: w + "px", height: h + "px" });
      if (Math.abs(flowCanvas.width - w * flowR.getPixelRatio()) > 2) flowR.setSize(w, h, false);
      flowU += ((fig._flowStep || 0) - flowU) * 0.12;                       // ease toward the current Euler step
      const u = Math.max(0, Math.min(4, flowU)) / 4;
      show(...SIDES.map(x => hands[x]), ...SIDES.map(x => ghosts[x]), box, desk, ...ghosts3.map(g => g.m));
      // the hands now, and (faint) where they will be at +0.3 s: the future the samples are for
      SIDES.forEach(x => { setHand(x, FI, skin); setHand(x, FI + 9, ghostMat, ghosts[x]); }); objAt(FI, box); box.material = seen;
      desk.position.set(box.position.x, box.position.y, -0.001);
      ghosts3.forEach(g => {
        gpos.lerpVectors(g.start.position, g.goal.position, u); gq.copy(g.start.quaternion).slerp(g.goal.quaternion, u);
        g.m.position.copy(gpos); g.m.quaternion.copy(gq); g.m.material.opacity = 0.07 + 0.23 * u;
      });
      // frame the box and both hands: look across the line between the hands, so neither hides behind the box
      if (!flowView) {
        const pts = [], toW = v => new T.Vector3(v.x, v.z, -v.y);   // z-up data -> three's y-up
        const hc = SIDES.map(x => { const g = hands[x].geometry; g.computeBoundingBox(); const bb = g.boundingBox; pts.push(toW(bb.min), toW(bb.max)); return toW(bb.getCenter(new T.Vector3())); });
        const bc = toW(box.position); pts.push(bc);
        const target = hc[0].clone().add(hc[1]).add(bc).multiplyScalar(1 / 3);
        const d = hc[1].clone().sub(hc[0]);
        const a0 = Math.atan2(-d.z, d.x), cands = [a0, a0 + Math.PI];             // camera offsets perpendicular to the hands' line
        const out = hc[0].clone().add(hc[1]).multiplyScalar(0.5).sub(bc);              // the hands' side of the box
        const A0 = cands.reduce((m, c) => Math.sin(c) * out.x + Math.cos(c) * out.z > Math.sin(m) * out.x + Math.cos(m) * out.z ? c : m);
        const rad = Math.max(...pts.map(q => q.distanceTo(target))) + 0.04;
        flowView = { target, A0, rad };
      }
      const { target } = flowView, A = flowView.A0 + 0.45 + (reduced ? 0 : 0.12 * Math.sin(s * 0.25)), E = 0.55;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const half = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect));
      const dist = flowView.rad / Math.sin(half) * 0.8;
      camera.position.set(target.x + dist * Math.cos(E) * Math.sin(A), target.y + dist * Math.sin(E), target.z + dist * Math.cos(E) * Math.cos(A));
      camera.lookAt(target);
      flowR.render(scene, camera);
    }
    const frame0 = frame;
    frame = function (nowMs) { frame0(nowMs); if (!document.hidden) drawFlow(nowMs / 1000); };
    if (reduced) { f = 2.75 * FPS; fig._flowStep = 4; flowU = 4; }
    fig.classList.add("ready");
    (function loop(now) { requestAnimationFrame(loop); frame(now); })(performance.now());
  }

  // ---- the architecture: tokens, a 6-layer tower, and the rectified-flow panel
  function arch() {
    const svg = fig.querySelector(".wm-arch");
    if (!svg) return;
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
    const g = n => svg.querySelector("." + n);
    // tokens: the object and 6 hand frames on top; 3 past poses and 3 noisy future changes below
    const W = 36, Hh = 26, chips = [];
    const chip = (x, y, cls, label) => {
      const c = el("g", { class: "tk " + cls }, g("toks"));
      el("rect", { x, y, width: W, height: Hh, rx: 7 }, c);
      el("text", { x: x + W / 2, y: y + 17, "text-anchor": "middle" }, c).textContent = label;
      chips.push({ c, x: x + W / 2, y: y + Hh / 2 });
      return chips.length - 1;
    };
    let x = 46;
    chip(x, 26, "obj", "O"); x += W + 6;
    ["−.2", "−.1", "0", "+.1", "+.2", "+.3"].forEach(l => { chip(x, 26, "hand", l); x += W + 6; });
    el("text", { x: 64, y: 66, "text-anchor": "middle", class: "tl" }, g("toks")).textContent = "object";
    el("text", { x: 46 + W + 6 + (6 * W + 5 * 6) / 2, y: 66, "text-anchor": "middle", class: "tl" }, g("toks")).textContent = "both hands, 6 frames (s)";
    x = 55;
    [0, 1, 2].forEach(() => { chip(x, 78, "past", "P"); x += W + 6; });
    x += 12;
    const fut = [0, 1, 2].map(() => { const k = chip(x, 78, "fut", "Δ"); x += W + 6; return k; });
    el("text", { x: 55 + (3 * W + 12) / 2, y: 118, "text-anchor": "middle", class: "tl" }, g("toks")).textContent = "last 3 poses";
    el("text", { x: 55 + 3 * W + 12 + 12 + (3 * W + 12) / 2, y: 118, "text-anchor": "middle", class: "tl" }, g("toks")).textContent = "next 3 changes, noisy";
    // the tower: 6 slanted slabs
    const slabs = [];
    for (let k = 0; k < 6; k++) { const y = 150 + k * 21; slabs.push(el("polygon", { class: "slab", points: `86,${y + 15} 112,${y} 294,${y} 268,${y + 15}` }, g("tower"))); }
    el("path", { class: "flow", d: "M190,126 L190,144", "marker-end": "url(#wmArr)" }, svg);
    const rnd = (k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; })(7);
    // the flow panel is a 3-D scene drawn by build() (fig._flowStep): here only its step and its label
    const phase = fig.querySelector("#flPh");
    const place = s2 => {
      fig._flowStep = s2;
      phase.textContent = s2 === 0 ? "start: random poses (noise)" : s2 < 4 ? `Euler step ${s2} of 4` : "step 4 of 4: the model's samples for +0.3 s";
    };
    if (reduced) { place(4); return; }
    // one cycle: for each of the 4 Euler steps, a future token lights up and attends to the others, the slabs light top
    // to bottom, and the dots take one step; then hold, and start again from noise
    let step = 0, layer = 0;
    function tick() {
      if (step === 5) { step = 0; layer = 0; place(0); setTimeout(tick, 700); return; }
      if (step === 4) {
        step = 5; chips.forEach(t => t.c.classList.remove("lit", "att")); setTimeout(tick, 2200); return;
      }
      if (layer === 0) {
        // attention: the lit future token's weights over the other tokens, as how strongly their edges glow
        const lit = fut[step % 3];
        chips.forEach((t, k) => {
          t.c.classList.toggle("lit", k === lit);
          t.c.querySelector("rect").style.strokeOpacity = k === lit ? "" : (0.15 + 0.85 * rnd() ** 2).toFixed(2);
          t.c.classList.toggle("att", k !== lit);
        });
      }
      slabs.forEach((sl, k) => sl.classList.toggle("on", k === layer));
      layer++;
      if (layer === 6) {
        layer = 0; step++; place(step);
        setTimeout(() => { slabs.forEach(sl => sl.classList.remove("on")); chips.forEach(t => { t.c.classList.remove("att"); t.c.querySelector("rect").style.strokeOpacity = ""; }); }, 160);
        setTimeout(tick, 420);
      } else setTimeout(tick, 85);
    }
    new IntersectionObserver(es => { if (es[0].isIntersecting && !svg.dataset.go) { svg.dataset.go = 1; tick(); } }).observe(svg);
  }
})();
