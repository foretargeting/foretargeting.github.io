/* Hero stage: one Foretargeting pour on two Wuji Hand 2.2 hands, rendered as clay in three.js. The BC proposes hand
   targets, the world model forecasts where the apple and then the bowl will go, and the hands were realized from that
   plan in physics (simulation). Amber ghosts are the world model's plan for the object being handled, a moment ahead.
   The clip can join runs of the same plan family (one clock): consecutive segments overlap and dissolve into each other.
   Data: static/hero/pour.json + pour.bin (tools/dump_pour.py + tools/export_pour.py), MuJoCo world frame, z up. */
(function () {
  const canvas = document.getElementById("heroGL");
  const stage = document.getElementById("stage3d");
  if (!canvas || !window.THREE) { if (stage) stage.classList.add("no-gl"); return; }
  const T = THREE;

  const GHOSTS = [0.35, 0.7, 1.05];            // seconds ahead
  const ui = { key: document.getElementById("ghostWhat") };

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) { stage.classList.add("no-gl"); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(26, 1, 0.01, 20);
  const root = new T.Group();                   // MuJoCo world (z up) -> three (y up)
  root.rotation.x = -Math.PI / 2;
  scene.add(root);

  scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.95);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const rim = new T.DirectionalLight(0xfff1df, 0.35);
  rim.position.set(1.2, 0.6, -1.0);
  scene.add(rim);

  const mat = {
    robot: new T.MeshStandardMaterial({ color: 0x434b57, roughness: 0.42, metalness: 0.2 }),
    apple: new T.MeshStandardMaterial({ color: 0xc9573f, roughness: 0.55, metalness: 0 }),
    bowl: new T.MeshStandardMaterial({ color: 0xebe4d8, roughness: 0.55, metalness: 0, side: T.DoubleSide }),
    ghost: GHOSTS.map((_, i) => new T.MeshStandardMaterial({
      color: 0xf2a93b, emissive: 0xf2a93b, emissiveIntensity: 0.35, roughness: 0.6, side: T.DoubleSide,
      transparent: true, opacity: 0.4 - i * 0.11, depthWrite: false
    })),
    shadow: new T.ShadowMaterial({ opacity: 0.16 }),
    trail: new T.LineBasicMaterial({ color: 0x8592a6, transparent: true, opacity: 0.4 }),
    ahead: new T.LineBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.95 })
  };

  function arr(buf, L) {
    const n = L.shape.reduce((a, b) => a * b, 1);
    const C = { int16: Int16Array, uint8: Uint8Array, uint16: Uint16Array, float32: Float32Array }[L.dtype];
    return new C(buf, L.offset, n);
  }

  // a failed download (a server restart, a flaky connection) is tried twice more before the still picture shows
  const get = (k) => Promise.all([
    fetch("static/hero/pour.json?v=20261124041321").then(r => { if (!r.ok) throw r.status; return r.json(); }),
    fetch("static/hero/pour.bin?v=20261124041321").then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); })
  ]).catch(e => { if (k > 0) return new Promise(res => setTimeout(res, 1500)).then(() => get(k - 1)); throw e; });
  get(2).then(([meta, buf]) => build(meta, buf)).catch(() => stage.classList.add("no-gl"));

  function build(meta, buf) {
    const L = meta.layout, FPS = meta.fps, U = meta.pos_unit, NG = meta.parts.length;
    // segments: runs of the same plan family on one clock; each overlaps the next, and the stage dissolves between them
    const segs = meta.segments.map((m, k) => ({
      t0: m.t0, n: m.n, t1: m.t0 + (m.n - 1) / FPS,
      pp: arr(buf, L[`poses_p_${k}`]), pq: arr(buf, L[`poses_q_${k}`]), plan: arr(buf, L[`plan_${k}`]), active: arr(buf, L[`active_${k}`])
    }));
    const END = Math.max(...segs.map(g => g.t1));
    function weights(t) {                           // how much of each segment shows at clip time t
      return segs.map((g, k) => {
        const prev = segs[k - 1], next = segs[k + 1];
        if (t < g.t0 && k > 0) return 0;
        if (t > g.t1 && next) return 0;
        let w = 1;
        if (prev && t < prev.t1) w = Math.min(w, (t - g.t0) / (prev.t1 - g.t0));
        if (next && t > next.t0) w = Math.min(w, (g.t1 - t) / (g.t1 - next.t0));
        w = Math.max(0, Math.min(1, w));
        return w * w * (3 - 2 * w);
      });
    }

    // ---- meshes: one per visual geom, one set per segment (each with its own materials, to dissolve)
    const geos = meta.parts.map((_, i) => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(arr(buf, L[`mesh_${i}_v`])), 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(arr(buf, L[`mesh_${i}_f`])), 1));
      g.computeVertexNormals();
      return g;
    });
    segs.forEach(g => {
      g.mat = { robot: mat.robot.clone(), apple: mat.apple.clone(), bowl: mat.bowl.clone() };
      Object.values(g.mat).forEach(m => { m.transparent = true; });
      g.parts = meta.parts.map((p, i) => {
        const m = new T.Mesh(geos[i], g.mat[p.group === "apple" || p.group === "bowl" ? p.group : "robot"]);
        m.castShadow = true;
        root.add(m);
        return m;
      });
    });
    // ghosts: copies of the apple or the bowl, whichever the hands are working on
    const ghostSets = meta.ghost_part.map(i => GHOSTS.map((_, k) => {
      const m = new T.Mesh(geos[i], mat.ghost[k]);
      m.visible = false;
      root.add(m);
      return m;
    }));

    const ground = new T.Mesh(new T.PlaneGeometry(4, 4), mat.shadow);
    ground.position.z = -0.001;
    ground.receiveShadow = true;
    root.add(ground);

    // the handled object's realized path (trail) and the plan just ahead
    const objPath = (g, k) => { const i = meta.ghost_part[k], p = []; for (let f = 0; f < g.n; f++) if (g.active[f] === k) { const j = (f * NG + i) * 3; p.push(new T.Vector3(g.pp[j] * U, g.pp[j + 1] * U, g.pp[j + 2] * U)); } return p; };
    segs.forEach(g => { g.paths = [objPath(g, 0), objPath(g, 1)]; });
    const trail = new T.Line(new T.BufferGeometry(), mat.trail);
    const aheadGeo = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(32 * 3), 3));
    const ahead = new T.Line(aheadGeo, mat.ahead);
    root.add(trail, ahead);

    // ---- framing: everything the objects do, from the desk up to the working hands (about 28 cm)
    const box = new T.Box3();
    segs.forEach(g => g.paths.flat().forEach(p => box.expandByPoint(p)));
    box.expandByPoint(new T.Vector3(box.min.x, box.min.y, 0)).expandByPoint(new T.Vector3(box.max.x, box.max.y, 0.28));
    const cZ = box.getCenter(new T.Vector3());
    const center = new T.Vector3(cZ.x, cZ.z, -cZ.y);           // in three's frame
    const radius = box.getSize(new T.Vector3()).length() * 0.5 + 0.06;
    key.target.position.copy(center);
    key.shadow.camera.left = key.shadow.camera.bottom = -0.7;
    key.shadow.camera.right = key.shadow.camera.top = 0.7;
    key.shadow.camera.updateProjectionMatrix();
    key.position.copy(center).add(new T.Vector3(-0.35, 2.0, 0.55));

    // ---- poses at clip time t, in segment g
    const qa = new T.Quaternion(), qb = new T.Quaternion();
    const frameOf = (g, t) => Math.max(0, Math.min(g.n - 1.001, (t - g.t0) * FPS));
    function partAt(g, t, i, obj) {
      const f = frameOf(g, t), a = Math.floor(f), s = f - a, pp = g.pp, pq = g.pq;
      const j = (a * NG + i) * 3, k = ((a + 1) * NG + i) * 3, jq = (a * NG + i) * 4, kq = ((a + 1) * NG + i) * 4;
      obj.position.set((pp[j] + (pp[k] - pp[j]) * s) * U, (pp[j + 1] + (pp[k + 1] - pp[j + 1]) * s) * U, (pp[j + 2] + (pp[k + 2] - pp[j + 2]) * s) * U);
      qa.set(pq[jq + 1], pq[jq + 2], pq[jq + 3], pq[jq]).normalize();          // stored w x y z
      qb.set(pq[kq + 1], pq[kq + 2], pq[kq + 3], pq[kq]).normalize();
      obj.quaternion.copy(qa).slerp(qb, s);
    }
    function planAt(g, t, obj) {
      const f = frameOf(g, t), a = Math.floor(f), s = f - a, plan = g.plan, j = a * 7, k = (a + 1) * 7;
      obj.position.set(plan[j] + (plan[k] - plan[j]) * s, plan[j + 1] + (plan[k + 1] - plan[j + 1]) * s, plan[j + 2] + (plan[k + 2] - plan[j + 2]) * s);
      qa.set(plan[j + 4], plan[j + 5], plan[j + 6], plan[j + 3]);
      qb.set(plan[k + 4], plan[k + 5], plan[k + 6], plan[k + 3]);
      obj.quaternion.copy(qa).slerp(qb, s);
    }
    const activeAt = (g, t) => g.active[Math.round(frameOf(g, t))];

    // ---- interaction
    let az = 2.85, el = 0.38, dragAz = 0, dragEl = 0, dragging = null;
    canvas.addEventListener("pointerdown", e => { dragging = { x: e.clientX, y: e.clientY, az: dragAz, el: dragEl }; canvas.setPointerCapture(e.pointerId); stage.classList.add("dragging"); });
    canvas.addEventListener("pointermove", e => {
      if (!dragging) return;
      dragAz = dragging.az - (e.clientX - dragging.x) * 0.008;
      dragEl = Math.max(-0.3, Math.min(0.85, dragging.el + (e.clientY - dragging.y) * 0.006));
    });
    const endDrag = () => { dragging = null; stage.classList.remove("dragging"); };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    let ghostBoost = 1, ghostBoostT = 1, shownWhat = null;
    window.FTHero = {
      take: () => {},                             // one take now; kept for the wordmark tabs (hero.js)
      view: (a, e) => { az = a; el = e; },
      ghosts: on => { ghostBoostT = on ? 1.8 : 1; }
    };

    const PHONE_BACK = 1.36;   // phones: the camera closer than on a narrow desktop window, so the hands fill the small stage
    // ---- loop
    let t = 0, visible = true, last = null;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; last = null; }, { rootMargin: "60px" }).observe(stage);
    function resize() {
      const r = canvas.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      // the caption bar covers the bottom of the stage: render the scene a little higher
      const lift = Math.min(70, r.height * 0.14);
      camera.setViewOffset(r.width, r.height + lift, 0, lift, r.width, r.height);
      camera.fov = r.width < 520 ? 34 : 26;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();
    const reduced = FT.reduced;

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const s = now / 1000, dt = last == null ? 0 : Math.min(0.05, s - last);
      last = s;
      draw(s, dt);
    }
    const HOLD = 1.2;                               // rest on the last frame before looping
    function draw(s, dt) {
      if (!reduced) t += dt;
      if (t >= END + HOLD) t = 0;
      const tc = Math.min(t, END);
      const fade = Math.min(1, tc / 0.4) * Math.min(1, (END + HOLD - t) / 0.5);
      ghostBoost += (ghostBoostT - ghostBoost) * Math.min(1, dt * 4);
      const w = weights(tc);
      let lead = 0;
      segs.forEach((g, k) => {
        if (w[k] > w[lead]) lead = k;
        g.parts.forEach(m => { m.visible = w[k] > 0.01; });
        if (w[k] <= 0.01) return;
        for (let i = 0; i < NG; i++) partAt(g, tc, i, g.parts[i]);
        Object.values(g.mat).forEach(m => { m.opacity = w[k]; m.depthWrite = w[k] > 0.98; });
      });

      // ghosts: the world model's plan for the handled object, a moment ahead, while it is still the handled one
      const g = segs[lead], k = activeAt(g, tc), now = g.parts[meta.ghost_part[k]];
      ghostSets.forEach((set, j) => set.forEach(m => { if (j !== k) m.visible = false; }));
      GHOSTS.forEach((d, i) => {
        const m = ghostSets[k][i], ta = Math.min(g.t1, tc + d);
        planAt(g, ta, m);
        m.visible = activeAt(g, ta) === k && t < END && m.position.distanceTo(now.position) > 0.008;
        m.material.opacity = Math.min(0.85, (0.4 - i * 0.11) * ghostBoost) * fade;
      });
      if (shownWhat !== `${lead}/${k}`) {
        shownWhat = `${lead}/${k}`;
        trail.geometry.setFromPoints(g.paths[k]);
        if (ui.key) ui.key.textContent = k ? "bowl" : "apple";
      }
      const pts = aheadGeo.attributes.position.array, f0 = Math.round(frameOf(g, tc));
      for (let i = 0; i < 32; i++) {
        const f = Math.round(frameOf(g, tc + (i / 31) * GHOSTS[2])), h = g.active[f] === k ? f : f0;
        pts[i * 3] = g.plan[h * 7]; pts[i * 3 + 1] = g.plan[h * 7 + 1]; pts[i * 3 + 2] = g.plan[h * 7 + 2];
      }
      aheadGeo.attributes.position.needsUpdate = true;
      const solo = Math.abs(w[lead] * 2 - 1);       // the trail and plan line fade out through a dissolve
      mat.trail.opacity = 0.4 * fade * solo;
      mat.ahead.opacity = (t < END ? 0.95 : 0) * fade * solo;

      // camera: slow sway around the action, plus the visitor's drag
      const a = az + dragAz + (reduced ? 0 : 0.18 * Math.sin(s * 0.19)), e = el + dragEl;
      const dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * (camera.aspect < 1.1 ? (canvas.clientWidth <= 640 ? PHONE_BACK : 1.6) : 0.98);
      camera.position.set(center.x + dist * Math.cos(e) * Math.sin(a), center.y + dist * Math.sin(e), center.z + dist * Math.cos(e) * Math.cos(a));
      camera.lookAt(center);
      renderer.render(scene, camera);
    }
    // render one exact moment (seconds into the clip): stills, tests, reduced motion
    window.FTHero.renderAt = (sec, view) => { t = sec; if (view) { az = view[0]; el = view[1]; } draw(performance.now() / 1000, 0); };
    window.FTHero.meta = meta;
    if (reduced) t = meta.events_s.bowl_highest || END / 2;
    stage.classList.add("ready");
    requestAnimationFrame(frame);
  }
})();
