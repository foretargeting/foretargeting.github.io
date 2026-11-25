/* Hero stage: one real Aria capture (a person lifting a mustard bottle) and the Wuji plan made from it
   (the plan that ran on the real xArm7, replayed in simulation), rendered as clay in three.js.
   Amber ghosts show where the bottle will be a moment later. Both takes share one clock (aligned at
   grasp and release), so the human hand can dissolve into the robot hand mid-carry.
   Data: static/hero/hero.json + hero.bin, exported from the run in the robot's base frame (z up). */
(function () {
  const canvas = document.getElementById("heroGL");
  const stage = document.getElementById("stage3d");
  if (!canvas || !window.THREE) { if (stage) stage.classList.add("no-gl"); return; }
  const T = THREE;

  const GHOSTS = [0.35, 0.7, 1.05];           // seconds ahead (human time)
  const LOOP = 7.6;                            // seconds per phase loop
  const ui = {
    label: document.getElementById("takeLabel"),
    sw: document.getElementById("takeSwitch")
  };

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
  const root = new T.Group();                  // robot base frame (z up) -> three (y up)
  root.rotation.x = -Math.PI / 2;
  scene.add(root);

  scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.95);
  key.position.set(-0.6, 1.6, 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const rim = new T.DirectionalLight(0xfff1df, 0.35);
  rim.position.set(1.2, 0.6, -1.0);
  scene.add(rim);

  const mat = {
    human: new T.MeshStandardMaterial({ color: 0xd9ac8f, roughness: 0.62, metalness: 0, transparent: true }),
    robot: new T.MeshStandardMaterial({ color: 0x434b57, roughness: 0.42, metalness: 0.2, transparent: true }),
    bottle: new T.MeshStandardMaterial({ color: 0xebe4d8, roughness: 0.55, metalness: 0, transparent: true }),
    ghost: GHOSTS.map((_, i) => new T.MeshStandardMaterial({
      color: 0xf2a93b, emissive: 0xf2a93b, emissiveIntensity: 0.35, roughness: 0.6,
      transparent: true, opacity: 0.4 - i * 0.11, depthWrite: false
    })),
    shadow: new T.ShadowMaterial({ opacity: 0.16 }),
    trail: new T.LineBasicMaterial({ color: 0x8592a6, transparent: true, opacity: 0.45 }),
    ahead: new T.LineBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.95 })
  };

  function arr(buf, L) {
    const n = L.shape.reduce((a, b) => a * b, 1);
    const C = { int16: Int16Array, uint16: Uint16Array, uint32: Uint32Array, float32: Float32Array }[L.dtype];
    return new C(buf, L.offset, n);
  }
  const quat = (a, i) => new T.Quaternion(a[i + 4], a[i + 5], a[i + 6], a[i + 3]); // stored w x y z

  Promise.all([
    fetch("static/hero/hero.json?v=20261124041321").then(r => r.json()),
    fetch("static/hero/hero.bin?v=20261124041321").then(r => r.arrayBuffer())
  ]).then(([meta, buf]) => build(meta, buf)).catch(() => stage.classList.add("no-gl"));

  function build(meta, buf) {
    const L = meta.layout, H = meta.human, R = meta.robot;
    const hv = arr(buf, L.human_verts), hc = meta.human_center, hs = meta.human_scale;
    const NV = L.human_verts.shape[1];
    const ho = arr(buf, L.human_obj), ro = arr(buf, L.robot_obj), rp = arr(buf, L.robot_poses);
    const NG = L.robot_poses.shape[1];

    // ---- geometry
    const handGeo = new T.BufferGeometry();
    const hpos = new Float32Array(NV * 3);
    handGeo.setAttribute("position", new T.BufferAttribute(hpos, 3));
    handGeo.setIndex(new T.BufferAttribute(new Uint32Array(arr(buf, L.human_faces)), 1));
    const hand = new T.Mesh(handGeo, mat.human);
    hand.castShadow = true;

    const bGeo = new T.BufferGeometry();
    bGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(arr(buf, L.bottle_verts)), 3));
    bGeo.setIndex(new T.BufferAttribute(new Uint32Array(arr(buf, L.bottle_faces)), 1));
    bGeo.computeVertexNormals();
    const bottleH = new T.Mesh(bGeo, mat.bottle), bottleR = new T.Mesh(bGeo, mat.bottle.clone());
    bottleH.castShadow = bottleR.castShadow = true;
    const ghosts = GHOSTS.map((_, i) => new T.Mesh(bGeo, mat.ghost[i]));

    const robot = new T.Group();
    const parts = meta.robot_meshes.map((_, i) => {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(arr(buf, L[`robot_mesh_${i}_v`])), 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(arr(buf, L[`robot_mesh_${i}_f`])), 1));
      g.computeVertexNormals();
      const m = new T.Mesh(g, mat.robot);
      m.castShadow = true;
      robot.add(m);
      return m;
    });

    const ground = new T.Mesh(new T.PlaneGeometry(4, 4), mat.shadow);
    ground.position.z = meta.table_z - 0.002;
    ground.receiveShadow = true;

    // bottle path of each take, for the trail lines
    const pathOf = (a, n) => { const p = []; for (let i = 0; i < n; i++) p.push(new T.Vector3(a[i * 7], a[i * 7 + 1], a[i * 7 + 2])); return p; };
    const pathH = pathOf(ho, L.human_obj.shape[0]), pathR = pathOf(ro, R.n);
    const trail = new T.Line(new T.BufferGeometry().setFromPoints(pathH), mat.trail);
    const aheadGeo = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(32 * 3), 3));
    const ahead = new T.Line(aheadGeo, mat.ahead);

    root.add(ground, trail, ahead, bottleH, bottleR, hand, robot, ...ghosts);

    // ---- framing
    const box = new T.Box3();
    pathH.forEach(p => box.expandByPoint(p));
    const cZ = box.getCenter(new T.Vector3());
    const center = new T.Vector3(cZ.x, cZ.z + 0.02, -cZ.y);    // in three's frame
    const radius = box.getSize(new T.Vector3()).length() * 0.5 + 0.09;
    key.target.position.copy(center);
    key.shadow.camera.left = key.shadow.camera.bottom = -0.6;
    key.shadow.camera.right = key.shadow.camera.top = 0.6;
    key.shadow.camera.updateProjectionMatrix();
    key.position.copy(center).add(new T.Vector3(-0.35, 2.0, 0.55));

    // ---- time maps: one phase p in [0, 1), knots at grasp and release
    const kH = [0, H.grasp_s, H.release_s, H.end_s];
    const kR = [0, R.grasp_s, R.release_s, R.release_s + 0.6 * (R.end_s - R.release_s)];
    const P = [0, H.grasp_s / H.end_s, H.release_s / H.end_s, 1];
    const interp = (p, K) => {
      let i = 0; while (i < 2 && p > P[i + 1]) i++;
      return K[i] + (K[i + 1] - K[i]) * (p - P[i]) / (P[i + 1] - P[i]);
    };
    const tmpQ = new T.Quaternion(), tmpQ2 = new T.Quaternion();
    function poseAt(a, n, fps, t, obj) {
      const f = Math.max(0, Math.min(n - 1.001, t * fps)), i = Math.floor(f), s = f - i;
      const j = i * 7, k = (i + 1) * 7;
      obj.position.set(a[j] + (a[k] - a[j]) * s, a[j + 1] + (a[k + 1] - a[j + 1]) * s, a[j + 2] + (a[k + 2] - a[j + 2]) * s);
      tmpQ.set(a[j + 4], a[j + 5], a[j + 6], a[j + 3]);
      tmpQ2.set(a[k + 4], a[k + 5], a[k + 6], a[k + 3]);
      obj.quaternion.copy(tmpQ).slerp(tmpQ2, s);
    }
    function handAt(t) {
      const f = Math.max(0, Math.min(H.n - 1.001, t * H.fps)), i = Math.floor(f), s = f - i;
      const a = i * NV * 3, b = (i + 1) * NV * 3;
      for (let v = 0; v < NV * 3; v++) hpos[v] = (hv[a + v] + (hv[b + v] - hv[a + v]) * s) * hs + hc[v % 3];
      handGeo.attributes.position.needsUpdate = true;
      handGeo.computeVertexNormals();
    }
    function robotAt(t) {
      const f = Math.max(0, Math.min(R.n - 1.001, t * R.fps)), i = Math.floor(f), s = f - i;
      for (let g = 0; g < NG; g++) {
        const j = (i * NG + g) * 7, k = ((i + 1) * NG + g) * 7, m = parts[g];
        m.position.set(rp[j] + (rp[k] - rp[j]) * s, rp[j + 1] + (rp[k + 1] - rp[j + 1]) * s, rp[j + 2] + (rp[k + 2] - rp[j + 2]) * s);
        tmpQ.set(rp[j + 4], rp[j + 5], rp[j + 6], rp[j + 3]);
        tmpQ2.set(rp[k + 4], rp[k + 5], rp[k + 6], rp[k + 3]);
        m.quaternion.copy(tmpQ).slerp(tmpQ2, s);
      }
    }

    // ---- interaction
    let az = -1.75, el = 0.38, dragAz = 0, dragEl = 0, dragging = null;
    canvas.addEventListener("pointerdown", e => { dragging = { x: e.clientX, y: e.clientY, az: dragAz, el: dragEl }; canvas.setPointerCapture(e.pointerId); stage.classList.add("dragging"); });
    canvas.addEventListener("pointermove", e => {
      if (!dragging) return;
      dragAz = dragging.az - (e.clientX - dragging.x) * 0.008;
      dragEl = Math.max(-0.3, Math.min(0.75, dragging.el + (e.clientY - dragging.y) * 0.006));
    });
    const endDrag = () => { dragging = null; stage.classList.remove("dragging"); };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    let take = 0, w = 0, holdUntil = 0, lastP = 0, ghostBoost = 1, ghostBoostT = 1;
    function setTake(k, user) {
      take = k;
      if (user) holdUntil = performance.now() / 1000 + 14;
      ui.sw.querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.t === k));
      ui.sw.style.setProperty("--k", k);
      ui.label.classList.toggle("robot", k === 1);
    }
    ui.sw.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setTake(+b.dataset.t, true)));
    window.FTHero = {
      take: k => setTake(k, true),
      view: (a, e) => { az = a; el = e; },
      ghosts: on => { ghostBoostT = on ? 1.8 : 1; }
    };

    // ---- loop
    let p = 0.08, visible = true, last = null;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; last = null; }, { rootMargin: "60px" }).observe(stage);
    function resize() {
      const r = canvas.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      // the caption bar covers the bottom of the stage: render the scene a little higher
      const lift = Math.min(90, r.height * 0.18);
      camera.setViewOffset(r.width, r.height + lift, 0, lift, r.width, r.height);
      camera.fov = r.width < 520 ? 32 : 26;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();
    const reduced = FT.reduced;

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const t = now / 1000, dt = last == null ? 0 : Math.min(0.05, t - last);
      last = t;
      draw(t, dt);
    }
    function draw(t, dt) {
      if (!reduced) p += dt / LOOP;
      if (p >= 1) p -= 1;
      // auto: switch hands mid-carry, once per loop
      if (!reduced && t > holdUntil && lastP < 0.47 && p >= 0.47) setTake(1 - take, false);
      lastP = p;
      w += ((take) - w) * Math.min(1, dt * 2.2);
      ghostBoost += (ghostBoostT - ghostBoost) * Math.min(1, dt * 4);
      const wrap = Math.min(1, p / 0.05) * Math.min(1, (1 - p) / 0.05);

      const th = interp(p, kH), tr = interp(p, kR);
      handAt(th);
      robotAt(tr);
      poseAt(ho, L.human_obj.shape[0], 30, th, bottleH);
      poseAt(ro, R.n, R.fps, tr, bottleR);
      mat.human.opacity = (1 - w) * wrap;
      mat.robot.opacity = w * wrap;
      bottleH.material.opacity = (1 - w) * wrap;
      bottleR.material.opacity = w * wrap;
      hand.visible = mat.human.opacity > 0.01;
      robot.visible = mat.robot.opacity > 0.01;
      bottleH.visible = bottleH.material.opacity > 0.01;
      bottleR.visible = bottleR.material.opacity > 0.01;
      mat.human.depthWrite = mat.human.opacity > 0.98;
      mat.robot.depthWrite = mat.robot.opacity > 0.98;

      // ghosts: the bottle a moment ahead, in the take that is mostly visible
      const useR = w > 0.5;
      GHOSTS.forEach((dtG, i) => {
        const g = ghosts[i];
        if (useR) poseAt(ro, R.n, R.fps, Math.min(R.end_s, tr + dtG * R.slow), g);
        else poseAt(ho, L.human_obj.shape[0], 30, Math.min(H.end_s, th + dtG), g);
        const moving = g.position.distanceTo((useR ? bottleR : bottleH).position) > 0.006;
        g.visible = moving;
        g.material.opacity = Math.min(0.85, (0.4 - i * 0.11) * ghostBoost) * wrap;
      });
      // trail and the segment just ahead
      if (trail.userData.r !== useR) { trail.geometry.setFromPoints(useR ? pathR : pathH); trail.userData.r = useR; }
      const pts = aheadGeo.attributes.position.array;
      for (let i = 0; i < 32; i++) {
        const tt = (useR ? tr : th) + (i / 31) * GHOSTS[2] * (useR ? R.slow : 1);
        const a = useR ? ro : ho, n = useR ? R.n : L.human_obj.shape[0], fps = useR ? R.fps : 30;
        const f = Math.max(0, Math.min(n - 1, Math.round(tt * fps)));
        pts[i * 3] = a[f * 7]; pts[i * 3 + 1] = a[f * 7 + 1]; pts[i * 3 + 2] = a[f * 7 + 2];
      }
      aheadGeo.attributes.position.needsUpdate = true;
      mat.trail.opacity = 0.4 * wrap;
      mat.ahead.opacity = 0.95 * wrap;

      // camera: slow sway around the action, plus the visitor's drag
      const a = az + dragAz + (reduced ? 0 : 0.2 * Math.sin(t * 0.21)), e = el + dragEl;
      const dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * (camera.aspect < 1.1 ? 0.95 : 0.7);
      camera.position.set(center.x + dist * Math.cos(e) * Math.sin(a), center.y + dist * Math.sin(e), center.z + dist * Math.cos(e) * Math.cos(a));
      camera.lookAt(center);
      renderer.render(scene, camera);
    }
    // render one exact moment (phase 0..1, hand 0 = human, 1 = Wuji): stills, tests, reduced motion
    window.FTHero.renderAt = (phase, k) => { p = phase; lastP = phase; take = k; w = k; setTake(k, false); draw(performance.now() / 1000, 0); };
    setTake(0, false);
    stage.classList.add("ready");
    requestAnimationFrame(frame);
  }
})();
