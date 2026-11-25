/* Contact transport, off and on (#otCmp): one real Aria clip retargeted twice by our method, side by side under one
   camera. Left: the transport weight at 0, only the fingertips are matched. Right: ours, the person's contact (palm and
   finger bones included) carried onto the robot's links. Amber: where the person's hand touches the object (within
   8 mm of the recorded object); blue: where the Wuji hand touches it (within 6 mm of the simulated object). Both are
   kept in the object's frame, so they ride on the object each side draws. Data: tools/export_otcmp.py
   (static/hero/ot_<clip>.*), from the comparison's runs "full" and "no_transport". */
(function () {
  const fig = document.getElementById("otCmp");
  if (!fig || !window.Clay || !window.THREE) return;
  const T = THREE, C = Clay, canvas = fig.querySelector("canvas");
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
  r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(24, 1, 0.01, 20);
  scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.95); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 5; key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5 });
  scene.add(key, key.target);
  const mat = {
    robot: new T.MeshStandardMaterial({ color: 0x434b57, roughness: 0.42, metalness: 0.2 }),
    object: new T.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.55, side: T.DoubleSide }),
    skin: new T.MeshStandardMaterial({ color: 0xd99a74, roughness: 0.62, side: T.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false }),
    human: new T.MeshBasicMaterial({ color: 0xf2a93b, depthTest: false, transparent: true }),
    robotC: new T.MeshBasicMaterial({ color: 0x1f7fc2, depthTest: false, transparent: true })
  };
  const clips = {};
  let cur = null, want = null;

  function build(d) {
    const m = d.meta, L = m.layout, U = m.pos_unit, NG = m.parts.length, N = m.n, CU = m.contact_unit, HE = m.hand_every, HU = m.hand_unit;
    const A = k => C.arr(d.buf, L[k]);
    const geos = m.parts.map((_, i) => C.geometry(new Float32Array(A(`mesh_${i}_v`)), A(`mesh_${i}_f`)));
    const objI = m.parts.findIndex(p => p.group === "object"), handI = m.parts.map((p, i) => p.group !== "object" ? i : -1).filter(i => i >= 0);
    const ref = A("ref_object");
    const clouds = { human: [A("human_c_start"), A("human_c_p")], on: [A("robot_on_c_start"), A("robot_on_c_p")], off: [A("robot_off_c_start"), A("robot_off_c_p")] };
    // the person's hands, one geometry shared by both sides
    const humans = m.hands.map(s => {
      const HV = L[`human_${s}_v`], g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(HV.shape[1] * 3), 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(A(`human_faces_${s}`)), 1));
      return { g, hv: A(`human_${s}_v`), NV: HV.shape[1], NH: HV.shape[0] };
    });
    const sphere = new T.SphereGeometry(1, 10, 8);
    const cloud = (material, rad, max) => { const c = new T.InstancedMesh(sphere, material, max); c.count = 0; c.renderOrder = 8; c.frustumCulled = false; c.userData.rad = rad; return c; };
    const sides = ["off", "on"].map(tag => {
      const root = new T.Group(); root.rotation.x = -Math.PI / 2; root.visible = false;
      const ground = new T.Mesh(new T.PlaneGeometry(4, 4), new T.ShadowMaterial({ opacity: 0.16 })); ground.position.z = -0.001; ground.receiveShadow = true; root.add(ground);
      const put = (g, mt) => { const x = new T.Mesh(g, mt); x.castShadow = true; root.add(x); return x; };
      const hand = handI.map(i => put(geos[i], mat.robot)), obj = put(geos[objI], mat.object);
      humans.forEach(h => { const x = new T.Mesh(h.g, mat.skin); x.frustumCulled = false; x.renderOrder = 2; root.add(x); });
      const hc = cloud(mat.human, 0.0034, 400), rc = cloud(mat.robotC, 0.0026, 500); obj.add(hc, rc);   // in the object's frame
      scene.add(root);
      return { tag, root, hand, obj, hc, rc, P: A(`poses_p_${tag}`), Q: A(`poses_q_${tag}`) };
    });
    const qa = new T.Quaternion(), qb = new T.Quaternion(), m4 = new T.Matrix4();
    function partAt(P, Q, i, f, o) {
      const a = Math.floor(f), s = f - a, j = (a * NG + i) * 3, k = ((a + 1) * NG + i) * 3, jq = (a * NG + i) * 4, kq = ((a + 1) * NG + i) * 4;
      o.position.set((P[j] + (P[k] - P[j]) * s) * U, (P[j + 1] + (P[k + 1] - P[j + 1]) * s) * U, (P[j + 2] + (P[k + 2] - P[j + 2]) * s) * U);
      qa.set(Q[jq + 1], Q[jq + 2], Q[jq + 3], Q[jq]).normalize(); qb.set(Q[kq + 1], Q[kq + 2], Q[kq + 3], Q[kq]).normalize(); o.quaternion.copy(qa).slerp(qb, s);
    }
    function setCloud(c, [start, p], f) {
      const a = start[f], b = start[f + 1], n = Math.min(b - a, c.instanceMatrix.count), rad = c.userData.rad;
      for (let i = 0; i < n; i++) { const o = (a + i) * 3; m4.makeScale(rad, rad, rad).setPosition(p[o] * CU, p[o + 1] * CU, p[o + 2] * CU); c.setMatrixAt(i, m4); }
      c.count = n; c.instanceMatrix.needsUpdate = true;
    }
    let shownF = -1;
    function place(t) {
      const f = Math.max(0, Math.min(N - 1.001, t)), fr = Math.round(f);
      for (const sd of sides) {
        sd.hand.forEach((x, k) => partAt(sd.P, sd.Q, handI[k], f, x)); partAt(sd.P, sd.Q, objI, f, sd.obj);
        if (fr !== shownF) { setCloud(sd.hc, clouds.human, fr); setCloud(sd.rc, clouds[sd.tag], fr); }
      }
      shownF = fr;
      for (const { g, hv, NV, NH } of humans) {
        const h = Math.max(0, Math.min(NH - 1.001, f / HE)), a = Math.floor(h), s = h - a, o = g.attributes.position.array, i0 = a * NV * 3, i1 = (a + 1) * NV * 3;
        for (let v = 0; v < NV * 3; v++) o[v] = (hv[i0 + v] + (hv[i1 + v] - hv[i0 + v]) * s) * HU;
        g.attributes.position.needsUpdate = true; g.computeVertexNormals();
      }
    }
    // the window: from a second before the first touch to the end; the view: the recorded object's path and the hands
    const hs = clouds.human[0]; let first = 0; while (first < N - 1 && hs[first + 1] - hs[first] === 0) first++;
    const f0 = Math.max(0, first - 30);
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let f = f0; f < N; f++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], ref[f * 7 + k]); hi[k] = Math.max(hi[k], ref[f * 7 + k]); }
    geos[objI].computeBoundingSphere(); const objR = geos[objI].boundingSphere.radius;
    const c = new T.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, Math.max(0.06, (lo[2] + hi[2]) / 2));
    const radius = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + objR + 0.08;
    // seen across the line from the object to the hands' mean position while they touch
    const hc = new T.Vector3(); let cnt = 0;
    for (const { hv, NV, NH } of humans) for (let f = f0; f < N; f += 6) {
      const n = hs[f + 1] - hs[f]; if (!n) continue;
      const k = Math.min(NH - 1, Math.round(f / HE)) * NV * 3;
      for (let v = 0; v < NV; v += 40) { hc.x += hv[k + v * 3] * HU; hc.y += hv[k + v * 3 + 1] * HU; cnt++; }
    }
    const az = (cnt ? Math.atan2(hc.x / cnt - c.x, -(hc.y / cnt - c.y)) : 0) + Math.PI / 2;   // three.js after the -90 deg turn: x stays, y -> -z; then a quarter turn, across the hand
    const center = new T.Vector3(c.x, c.z, -c.y);
    // the view follows the recorded object half way, close enough for the hands' contact to read
    const refAt = (f, v) => { const a = Math.max(0, Math.min(N - 1, Math.round(f))) * 7; return v.set(ref[a], ref[a + 2], -ref[a + 1]); };
    const near = Math.max(0.24, objR + 0.17);
    return { sides, place, N, f0, FPS: m.fps, center, radius, near, refAt, az };
  }

  // ---- view and playback
  const playBtn = fig.querySelector(".otc-play"), prog = fig.querySelector(".otc-bar i"), clipBtns = [...fig.querySelectorAll(".otc-clips button")];
  let t = 0, paused = false, visible = false, last = null, azOff = 0, elOff = 0, drag = null;
  const look = new T.Vector3(), lookT = new T.Vector3();
  function use(clip) {
    if (cur) cur.sides.forEach(s => { s.root.visible = false; });
    cur = clip; t = clip.f0; look.copy(clip.center).lerp(clip.refAt(t, lookT), 0.5);
    key.target.position.copy(clip.center); key.position.copy(clip.center).add(new T.Vector3(-0.35, 2.0, 0.55));
    fig.classList.add("ready");
  }
  function pick(name) {
    want = name;
    clipBtns.forEach(b => { const on = b.dataset.clip === name; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    if (clips[name]) { use(clips[name]); return; }
    C.load(`ot_${name}`).then(d => { if (!clips[name]) clips[name] = build(d); if (want === name) use(clips[name]); }).catch(e => console.error(e));
  }
  clipBtns.forEach(b => b.addEventListener("click", () => pick(b.dataset.clip)));
  function setPaused(p) { paused = p; playBtn.classList.toggle("paused", p); playBtn.setAttribute("aria-label", p ? "Play" : "Pause"); }
  playBtn.addEventListener("click", () => setPaused(!paused));
  fig.seek = f => { t = f; };                       // for checking a moment by hand
  setPaused(!!FT.reduced);
  canvas.style.cursor = "grab"; canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    azOff -= (e.clientX - drag.x) * 0.008; elOff = Math.max(-0.35, Math.min(0.7, elOff + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = () => { drag = null; canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; last = null; }, { rootMargin: "60px" }).observe(fig);
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); pick(clipBtns[0].dataset.clip); } }, { rootMargin: "300px" });
  io.observe(fig);

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden || !cur) return;
    const s = now / 1000, dt = last == null ? 0 : Math.min(0.05, s - last); last = s;
    if (!paused) { t += dt * cur.FPS * 0.8; if (t >= cur.N - 1) t = cur.f0; }
    cur.place(t);
    prog.style.width = `${(100 * (t - cur.f0) / (cur.N - 1 - cur.f0)).toFixed(2)}%`;
    const rect = canvas.getBoundingClientRect(), w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) r.setSize(w, h, false);
    const stack = w < 600, vw = stack ? w : w / 2, vh = stack ? h / 2 : h;   // a phone stacks the two halves
    fig.classList.toggle("stack", stack);
    camera.aspect = vw / vh; camera.updateProjectionMatrix();
    const a = cur.az + azOff + (FT.reduced || drag ? 0 : 0.12 * Math.sin(s * 0.2)), e = 0.2 + elOff;
    look.lerp(lookT.copy(cur.center).lerp(cur.refAt(t, lookT.clone()), 0.5), Math.min(1, dt * 3));
    const dist = cur.near / Math.sin(camera.fov * Math.PI / 360) * 0.62 * Math.max(1, 0.8 * vh / vw);   // a tall half backs off
    camera.position.set(look.x + dist * Math.cos(e) * Math.sin(a), look.y + dist * Math.sin(e), look.z + dist * Math.cos(e) * Math.cos(a));
    camera.lookAt(look);
    r.setScissorTest(true);
    cur.sides.forEach((sd, i) => {
      cur.sides.forEach(o => { o.root.visible = o === sd; });
      const x = stack ? 0 : i * vw, y = stack ? (1 - i) * vh : 0;   // GL's origin is the bottom left: the first half on top
      r.setViewport(x, y, vw, vh); r.setScissor(x, y, vw, vh); r.render(scene, camera);
    });
  }
  requestAnimationFrame(frame);
})();
