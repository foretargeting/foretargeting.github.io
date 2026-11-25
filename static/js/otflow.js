/* How contact transport carries the person's contact (#otFlow), at one moment of a real clip (croissant), with the
   method's own plan (tools/export_otflow.py: contact_ot on the reference, transport 30). The person's hand puts mass
   on the object's surface under its finger bones and palm (amber, sized by mass). The unbalanced entropic plan moves that
   mass onto the Wuji hand's body points: small grains leave each amber point in proportion to the plan and land on the
   robot points they are sent to, which turn blue as they fill; the links that take mass light up. Mass with no robot
   point to take it stays behind and greys out. "Fingertips only" moves only the five tip points, tip to tip. */
(function () {
  const fig = document.getElementById("otFlow");
  if (!fig || !window.Clay || !window.THREE) return;
  const T = THREE, C = Clay, canvas = fig.querySelector("canvas");
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
  r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(24, 1, 0.01, 20);
  scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.95); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 5; key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3 });
  scene.add(key, key.target);
  const AMBER = new T.Color(0xf2a93b), BLUE = new T.Color(0x1f7fc2), GREY = new T.Color(0xb8bec7), LINK = new T.Color(0x434b57), LINK_ON = new T.Color(0x2a8fd6);
  const LOOP = 9.5, T_AMBER = [0.2, 1.4], T_ROBOT = [1.4, 2.2], T_FLOW = [2.2, 5.6], T_LEFT = [5.6, 6.4];
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  let S = null, mode = "ours", t0 = null, paused = false, visible = false, azOff = 0, elOff = 0, drag = null;

  function build({ meta: m, buf }) {
    const L = m.layout, A = k => C.arr(buf, L[k]), U = m.pos_unit, NG = m.parts.length, s = m.star;
    const root = new T.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);
    const ground = new T.Mesh(new T.PlaneGeometry(3, 3), new T.ShadowMaterial({ opacity: 0.16 })); ground.position.z = -0.001; ground.receiveShadow = true; root.add(ground);
    const pp = A("poses_p"), pq = A("poses_q"), q = new T.Quaternion();
    const linkMats = {};
    const meshes = m.parts.map((p, i) => {
      const g = C.geometry(new Float32Array(A(`mesh_${i}_v`)), A(`mesh_${i}_f`));
      const obj = p.group === "object";
      const mt = obj ? new T.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.55, side: T.DoubleSide })
        : (linkMats[p.name] = linkMats[p.name] || new T.MeshStandardMaterial({ color: LINK.clone(), roughness: 0.42, metalness: 0.2, transparent: true, opacity: 0 }));
      const x = new T.Mesh(g, mt); x.castShadow = true;
      const j = (s * NG + i) * 3, k = (s * NG + i) * 4;
      x.position.set(pp[j] * U, pp[j + 1] * U, pp[j + 2] * U); x.quaternion.set(pq[k + 1], pq[k + 2], pq[k + 3], pq[k]).normalize();
      root.add(x); return x;
    });
    // the person's hand at that moment, faint
    const HV = L.human_v, hv = A("human_v"), NV = HV.shape[1], hg = new T.BufferGeometry(), hp = new Float32Array(NV * 3);
    for (let v = 0; v < NV * 3; v++) hp[v] = hv[s * NV * 3 + v] * m.hand_unit;
    hg.setAttribute("position", new T.BufferAttribute(hp, 3)); hg.setIndex(new T.BufferAttribute(new Uint32Array(A("human_faces")), 1)); hg.computeVertexNormals();
    const skin = new T.MeshStandardMaterial({ color: 0xd99a74, roughness: 0.62, side: T.DoubleSide, transparent: true, opacity: 0.32, depthWrite: false });
    const human = new T.Mesh(hg, skin); human.renderOrder = 2; root.add(human);
    // the transport, in the object's frame
    const of = A("object_frame"), objG = new T.Group();
    objG.position.set(of[s * 7], of[s * 7 + 1], of[s * 7 + 2]); objG.quaternion.set(of[s * 7 + 4], of[s * 7 + 5], of[s * 7 + 6], of[s * 7 + 3]).normalize(); root.add(objG);
    const H = L.human_mass.shape[1], M = L.robot_points.shape[1];
    const tgt = A("human_target"), mass = A("human_mass"), rp = A("robot_points"), hl = A("human_labels"), rl = A("robot_labels");
    const hpos = i => new T.Vector3(tgt[(s * H + i) * 3], tgt[(s * H + i) * 3 + 1], tgt[(s * H + i) * 3 + 2]);
    const rpos = j => new T.Vector3(rp[(s * M + j) * 3], rp[(s * M + j) * 3 + 1], rp[(s * M + j) * 3 + 2]);
    const hm = i => mass[s * H + i];
    const sph = new T.SphereGeometry(1, 12, 10);
    const dots = (n) => { const d = new T.InstancedMesh(sph, new T.MeshBasicMaterial({ depthTest: false, transparent: true }), n); d.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3); d.renderOrder = 9; d.frustumCulled = false; objG.add(d); return d; };
    const hDots = dots(H), rDots = dots(M), grains = dots(900);
    const isTip = i => i % 4 === 3 && [2, 5, 8, 11, 14].includes(Math.floor(i / 4));
    // the moves: (from, to, mass) per mode
    const P = A("plan_star"), moves = { ours: [], tips: [] };
    for (let i = 0; i < H; i++) for (let j = 0; j < M; j++) { const w = P[i * M + j]; if (w > 0.03) moves.ours.push([i, j, w]); }
    for (let i = 0; i < H; i++) if (isTip(i) && hm(i) > 0.02) { const j = [...Array(M).keys()].find(k => rl[k] === hl[i] && k % 4 === 3); if (j != null) moves.tips.push([i, j, Math.min(1, hm(i))]); }
    // each move becomes grains (one per ~0.12 of mass), each with its own start and a small arc off the surface
    function grainsOf(list) {
      const out = [];
      for (const [i, j, w] of list) {
        const n = Math.max(1, Math.round(w / 0.12)), a = hpos(i), b = rpos(j), lift = a.clone().add(b).multiplyScalar(0.5);
        lift.add(lift.clone().normalize().multiplyScalar(0.006 + 0.25 * a.distanceTo(b)));   // bulge away from the object's centre
        for (let k = 0; k < n; k++) out.push({ i, j, w: w / n, a, b, c: lift, d: Math.random() * 0.55, jit: new T.Vector3((Math.random() - .5) * .003, (Math.random() - .5) * .003, (Math.random() - .5) * .003) });
      }
      return out.slice(0, 900);
    }
    const G = { ours: grainsOf(moves.ours), tips: grainsOf(moves.tips) };
    const sentTotal = { ours: new Float32Array(H), tips: new Float32Array(H) }, gotTotal = { ours: new Float32Array(M), tips: new Float32Array(M) };
    for (const k of ["ours", "tips"]) for (const g of G[k]) { sentTotal[k][g.i] += g.w; gotTotal[k][g.j] += g.w; }
    // which link meshes a robot point's bone belongs to: finger f bone b -> <side>_finger<f+1>_link<b+2>, the palm -> the base
    const linkOf = j => { const lab = rl[j]; return lab === 15 ? `${m.side}_base` : `${m.side}_finger${Math.floor(lab / 3) + 1}_link${(lab % 3) + 2}`; };
    // the view: across the fingers, from the side the hand reaches in
    const oc = new T.Vector3(); for (let j = 0; j < M; j++) oc.add(rpos(j)); oc.multiplyScalar(1 / M);
    root.updateMatrixWorld(true);
    const centerW = objG.localToWorld(new T.Vector3()), handW = objG.localToWorld(oc.clone());
    const dir = handW.clone().sub(centerW); const az = Math.atan2(dir.x, dir.z) + 1.0 + Math.PI;   // the object in front, the fingers wrapping it, low: the grains rise from its surface into them
    return { root, objG, meshes, linkMats, hDots, rDots, grains, G, sentTotal, gotTotal, hpos, rpos, hm, H, M, isTip, linkOf, center: centerW.clone().lerp(handW, 0.35), az };
  }

  const m4 = new T.Matrix4(), v3 = new T.Vector3(), col = new T.Color(), u3 = new T.Vector3();
  function setDot(d, k, p, rad, c) { m4.makeScale(rad, rad, rad).setPosition(p); d.setMatrixAt(k, m4); d.setColorAt(k, c); }
  function draw(time) {
    const k = mode, x = S, tl = time % LOOP;
    const aIn = ease((tl - T_AMBER[0]) / (T_AMBER[1] - T_AMBER[0])), rIn = ease((tl - T_ROBOT[0]) / (T_ROBOT[1] - T_ROBOT[0]));
    const flow = (tl - T_FLOW[0]) / (T_FLOW[1] - T_FLOW[0]), left = ease((tl - T_LEFT[0]) / (T_LEFT[1] - T_LEFT[0]));
    // grains in flight, and what has left and arrived so far
    const sent = new Float32Array(x.H), got = new Float32Array(x.M); let n = 0;
    for (const g of x.G[k]) {
      const u = Math.max(0, Math.min(1, (flow - g.d) / 0.45));
      if (u <= 0) continue;
      sent[g.i] += g.w;
      if (u >= 1) { got[g.j] += g.w; continue; }
      const e = ease(u), a = 1 - e;
      v3.copy(g.a).multiplyScalar(a * a).addScaledVector(g.c, 2 * a * e).addScaledVector(g.b, e * e).add(g.jit);
      setDot(x.grains, n++, v3, 0.0016, col.copy(AMBER).lerp(BLUE, e));
    }
    x.grains.count = n; x.grains.instanceMatrix.needsUpdate = true; if (x.grains.instanceColor) x.grains.instanceColor.needsUpdate = true;
    // the person's points: amber, shrinking as mass leaves; what is never sent greys out
    for (let i = 0; i < x.H; i++) {
      const m0 = x.hm(i), stays = Math.max(0, m0 - sent[i]), unsent = Math.max(0, m0 - x.sentTotal[k][i]);
      const rad = m0 < 0.02 ? 0 : (0.0012 + 0.0032 * Math.sqrt(Math.min(1, Math.max(stays, unsent > 0.02 ? unsent : 0)))) * ease(aIn * 1.6 - 0.6 * i / x.H);   // they come up one after another
      col.copy(AMBER); if (unsent > 0.02 && sent[i] >= x.sentTotal[k][i] - 1e-6) col.lerp(GREY, left);
      setDot(x.hDots, i, x.hpos(i), rad, col);
    }
    x.hDots.instanceMatrix.needsUpdate = true; x.hDots.instanceColor.needsUpdate = true;
    // the robot's points: small grey until mass lands, then blue, sized by what they hold
    const linkGot = {};
    for (let j = 0; j < x.M; j++) {
      const g = got[j], rad = (0.0011 + 0.003 * Math.sqrt(Math.min(1, g))) * rIn;
      setDot(x.rDots, j, x.rpos(j), rad, g > 0.01 ? BLUE : GREY);
      const ln = x.linkOf(j); linkGot[ln] = (linkGot[ln] || 0) + g;
    }
    x.rDots.instanceMatrix.needsUpdate = true; x.rDots.instanceColor.needsUpdate = true;
    for (const [name, mt] of Object.entries(x.linkMats)) { mt.opacity = rIn; mt.depthWrite = rIn > 0.95; mt.color.copy(LINK).lerp(LINK_ON, Math.min(1, (linkGot[name] || 0) / 2.5) * 0.85); }
  }

  // ---- stage
  const btns = [...fig.querySelectorAll(".otf-mode button")], playBtn = fig.querySelector(".otf-play");
  btns.forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.mode; t0 = null;
    btns.forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
  }));
  let tPause = 0;
  function setPaused(p) { paused = p; playBtn.classList.toggle("paused", p); playBtn.setAttribute("aria-label", p ? "Play" : "Pause"); }
  playBtn.addEventListener("click", () => setPaused(!paused));
  setPaused(!!FT.reduced);
  fig.at = sec => { t0 = performance.now() / 1000 - sec; tPause = sec; };   // for checking a moment by hand
  canvas.style.cursor = "grab"; canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    azOff -= (e.clientX - drag.x) * 0.008; elOff = Math.max(-0.4, Math.min(0.8, elOff + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = () => { drag = null; canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { rootMargin: "60px" }).observe(fig);
  const io = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    io.disconnect();
    C.load(`otflow_${fig.dataset.clip || "croissant"}`).then(d => {
      S = build(d); key.target.position.copy(S.center); key.position.copy(S.center).add(new T.Vector3(-0.3, 1.6, 0.5)); fig.classList.add("ready");
    }).catch(e => console.error(e));
  }, { rootMargin: "300px" });
  io.observe(fig);

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden || !S) return;
    const sec = now / 1000;
    if (t0 == null) t0 = sec;
    if (paused) t0 = sec - tPause; else tPause = sec - t0;
    show(sec, sec - t0);
  }
  fig.snap = sec => { t0 = performance.now() / 1000 - sec; tPause = sec; if (S) show(performance.now() / 1000, sec); };   // one frame now, for checking
  function show(sec, tl) {
    draw(tl);
    const rect = canvas.getBoundingClientRect(), w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * r.getPixelRatio())) r.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const a = S.az + azOff + (FT.reduced || drag ? 0 : 0.18 * Math.sin(sec * 0.25)), e = 0.05 + elOff;
    const dist = 0.085 / Math.sin(camera.fov * Math.PI / 360) * Math.max(1, 1.1 * h / w);
    camera.position.set(S.center.x + dist * Math.cos(e) * Math.sin(a), S.center.y + dist * Math.sin(e), S.center.z + dist * Math.cos(e) * Math.cos(a));
    camera.lookAt(S.center);
    r.render(scene, camera);
  }
  requestAnimationFrame(frame);
})();
