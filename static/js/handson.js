/* "Our retargeter, hands on": a human (MANO) hand beside Wuji Hand 2.2, which is retargeted from it live with
   wujiik.js (the per-frame port of the kinematic stage). The visitor bends the fingers of either hand and moves a cube;
   the fingertip contact fades are shown as they change. A switch puts the robot on fingertip positions alone, the
   classic objective, to show why we match bone directions. Two small figures below: grip as a command, and the
   receding-horizon search (an illustration).
   Data: static/live/live.json/.bin (the hand's closures, tools/export_live.py) and wuji.json/.bin (tools/export_wuji.py),
   shared with the live demo. */
(function () {
  const root = document.getElementById("hoStage");
  if (!root || !window.THREE || !window.Clay || !window.WujiIK) { if (root) root.classList.add("no-gl"); return; }
  const T = THREE, C = Clay, IK = window.WujiIK;
  const canvas = root.querySelector("canvas"), fadeBox = document.getElementById("hoFade");
  const labels = root.querySelectorAll(".ho-labels span");          // human, robot: kept above each hand on screen
  const WUJI_COLORS = { matte_black: 0x3c3e43, metal_silver: 0xc9ccd1, sensor_pad: 0x2c2d31 };
  const PALM = [0, 1, 5, 9, 13, 17], FINGER = [[2, 3, 4], [6, 7, 8], [10, 11, 12], [14, 15, 16], [18, 19, 20]];
  const TIPS = [4, 8, 12, 16, 20], NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
  // where the robot hand sits relative to the human's (data frame, metres): beside it on a wide stage (the camera looks
  // from the fingertips' side, so -x is the visitor's right), below it on a phone
  const off = new T.Vector3(-0.27, 0, 0);
  // the cube the stored hand holds (the training demo's cube sat at the closures' origin): its orientation and size fitted
  // to the closed hand, whose thumb, index and middle pads then lie 0-0.2 mm off its faces and the ring 5 mm; no vertex
  // inside. That grasp, carried through the cube's 24 symmetries, is a grasp on any face from any side: the hand goes to
  // the cube wherever it is, and backs off along its own up while it opens (the open hand would cut 1 cm into the cube).
  const CUBE_H = 0.0305, CUBE_REACH = 0.13;
  const CUBE_R0 = [-0.5404, -0.6941, -0.4755, 0.7911, -0.2268, -0.5681, 0.2865, -0.6832, 0.6717];  // columns: cube axes
  const retreat = g => 0.024 * Math.sqrt(Math.max(0, 1 - g));
  const TIPS_ONLY = { bone: 0, contact_sigma: 1e3, thumb_sigma: 1e3 };   // every fingertip on its human position

  let info, A, wuji, K, keys, partW, vFinger, hand, h, wg, ground, key, ik = {}, mode = "ours", meshes, cube, cube2, tipDots, tipRings;
  let renderer, scene, camera, rootG;
  const gs = [0.3, 0.3, 0.3, 0.3, 0.3], gsTarget = gs.slice(), b = new T.Vector3();
  // poses: the cube (b, cubeQ, easing to cubeQT) and the human hand (handQ, handP: world = handQ * stored + handP).
  // anchor: the hand's grasp on the cube (one of the 24 symmetries), or null when the visitor moved the cube away from
  // an open hand and the hand stays where it was
  const m4 = (R) => new T.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  const q0 = new T.Quaternion().setFromRotationMatrix(m4(CUBE_R0)), q0i = q0.clone().invert();
  const cubeQ = q0.clone(), cubeQT = q0.clone(), handQ = new T.Quaternion(), handP = new T.Vector3(0, 0, retreat(0.3));
  const SYM = [];
  for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) for (let sg = 0; sg < 8; sg++) {
    const M = new Array(9).fill(0);
    perm.forEach((c, r) => { M[r * 3 + c] = (sg >> r) & 1 ? -1 : 1; });
    if (new T.Matrix3().set(...M).determinant() > 0) SYM.push(new T.Quaternion().setFromRotationMatrix(m4(M)));
  }
  let anchor = { s: SYM.findIndex(q => Math.abs(q.w) > 0.999) }, closeWhenThere = false, turnAxis = 0;
  const CR = new Float64Array(9);                  // the cube's current rotation, row-major
  let points, normals, spacing, dirty = 8, state = null;

  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); load(); } }, { rootMargin: "400px" });
  near.observe(root.closest("section") || root);      // the whole section: a visitor may land on the cards below the stage
  if (document.getElementById("forceGap")) near.observe(document.getElementById("forceGap"));   // #why draws Wuji hands too

  function load() {
    const get = (url, kind) => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r[kind](); });
    Promise.all([get("static/live/live.json?v=202611202225", "json"), get("static/live/live.bin?v=202611202225", "arrayBuffer"),
                 get("static/live/wuji.json?v=202611202225", "json"), get("static/live/wuji.bin?v=202611202225", "arrayBuffer")])
      .then(([m, buf, wm, wb]) => {
        info = m; A = name => C.arr(buf, m.layout[name]);
        wuji = { info: wm, arr: name => C.arr(wb, wm.layout[name]) };
        build();
      })
      .catch(e => { console.error(e); root.classList.add("no-gl"); });
  }

  // ---------------------------------------------------------------- the human hand (as livewm.js drives it)
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const together = g => g.every(x => Math.abs(x - g[0]) < 1e-4);
  const palmOf = J => Float64Array.from(PALM.flatMap(i => [J[i * 3], J[i * 3 + 1], J[i * 3 + 2]]));
  const jl = new Float32Array(63), jf = new Float32Array(63), vl = new Float32Array(778 * 3), seatR = new Float64Array(9), seatT = new Float64Array(3);
  function closure(g) {
    const f = Math.max(0, Math.min(1, g)) * (K - 1), i = Math.min(Math.floor(f), K - 2);
    return [i, f - i];
  }
  function lerpKeys(field, g, out) {
    const [i, s] = closure(g), a = keys[i][field], c = keys[i + 1][field];
    for (let k = 0; k < a.length; k++) out[k] = a[k] + (c[k] - a[k]) * s;
    return out;
  }
  function seat(gf) {                  // finger closure gf re-seated on the palm of the mean closure
    lerpKeys("J", gf, jf);
    IK.kabsch(palmOf(jf), palmOf(jl), 6, seatR, seatT);
  }
  const apply = (R, t, x, y, z, o, i) => {
    o[i] = R[0] * x + R[1] * y + R[2] * z + t[0]; o[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1]; o[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  };
  function landmarks(out) {
    const gp = mean(gs);
    lerpKeys("J", gp, jl);
    out.set(jl);
    if (!together(gs)) for (let f = 0; f < 5; f++) {
      if (Math.abs(gs[f] - gp) < 1e-4) continue;
      seat(gs[f]);
      for (const i of FINGER[f]) apply(seatR, seatT, jf[i * 3], jf[i * 3 + 1], jf[i * 3 + 2], out, i * 3);
    }
    return toWorld(out, 21);
  }
  // the stored hand frame -> the world, by the hand's pose
  const HR = new Float64Array(9), m3 = new T.Matrix4();
  function toWorld(a, n) {
    const e = m3.makeRotationFromQuaternion(handQ).elements;
    HR.set([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
    for (let i = 0; i < n; i++) apply(HR, [handP.x, handP.y, handP.z], a[i * 3], a[i * 3 + 1], a[i * 3 + 2], a, i * 3);
    return a;
  }
  function placeHand() {
    verts(hand.geometry.attributes.position.array);
    hand.geometry.attributes.position.needsUpdate = true;
    hand.geometry.computeVertexNormals();
    hand.geometry.computeBoundingSphere();
  }
  // the hand's vertices (world) for the current closures and pose
  function verts(pos) {
    const gp = mean(gs);
    lerpKeys("V", gp, vl);
    if (!together(gs)) {
      lerpKeys("J", gp, jl);
      for (let f = 0; f < 5; f++) {
        if (Math.abs(gs[f] - gp) < 1e-4) continue;
        seat(gs[f]);
        const [k, u] = closure(gs[f]), A0 = keys[k].V, B0 = keys[k + 1].V, { idx, w } = partW[f], o = [0, 0, 0];
        for (let n = 0; n < idx.length; n++) {
          const v = idx[n] * 3;
          apply(seatR, seatT, A0[v] + (B0[v] - A0[v]) * u, A0[v + 1] + (B0[v + 1] - A0[v + 1]) * u, A0[v + 2] + (B0[v + 2] - A0[v + 2]) * u, o, 0);
          vl[v] += w[n] * (o[0] - vl[v]); vl[v + 1] += w[n] * (o[1] - vl[v + 1]); vl[v + 2] += w[n] * (o[2] - vl[v + 2]);
        }
      }
    }
    pos.set(toWorld(vl, 778));
    return pos;
  }
  // how much each vertex moves with each finger (as livewm.js), and the finger a vertex mostly belongs to (-1: palm)
  function fingerWeights(k) {
    const J = k.J, V = k.V, nv = V.length / 3, roots = [1, 5, 9, 13, 17], start = [0.012, 0, 0, 0, 0], sigma = 0.009;
    const seg = (x, y, z, a, c) => {
      const ax = J[a * 3], ay = J[a * 3 + 1], az = J[a * 3 + 2], dx = J[c * 3] - ax, dy = J[c * 3 + 1] - ay, dz = J[c * 3 + 2] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz)));
      return Math.hypot(x - ax - t * dx, y - ay - t * dy, z - az - t * dz);
    };
    const lists = Array.from({ length: 5 }, () => ({ idx: [], w: [] }));
    vFinger = new Int8Array(nv).fill(-1);
    for (let v = 0; v < nv; v++) {
      const x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2], e = [], s = [];
      for (let f = 0; f < 5; f++) {
        const r = roots[f];
        e.push(Math.exp(-(Math.min(seg(x, y, z, r, r + 1), seg(x, y, z, r + 1, r + 2), seg(x, y, z, r + 2, r + 3)) ** 2) / (2 * sigma * sigma)));
        const dx = J[(r + 1) * 3] - J[r * 3], dy = J[(r + 1) * 3 + 1] - J[r * 3 + 1], dz = J[(r + 1) * 3 + 2] - J[r * 3 + 2], len = Math.hypot(dx, dy, dz);
        const t = ((x - J[r * 3]) * dx + (y - J[r * 3 + 1]) * dy + (z - J[r * 3 + 2]) * dz) / len;
        s.push(1 / (1 + Math.exp(-(t - start[f]) / 0.005)));
      }
      const sum = e.reduce((a, c) => a + c, 0) || 1e-12;
      let best = 0.35;
      for (let f = 0; f < 5; f++) {
        const w = s[f] * e[f] / sum;
        if (w > 1e-3) { lists[f].idx.push(v); lists[f].w.push(w); }
        if (w > best) { best = w; vFinger[v] = f; }
      }
    }
    return lists.map(l => ({ idx: Int32Array.from(l.idx), w: Float32Array.from(l.w) }));
  }

  // ---------------------------------------------------------------- the cube (surface points with normals, like the WM's objects)
  const local = (x, y, z, o) => {                  // data frame -> cube frame (R^T (p - b))
    const dx = x - b.x, dy = y - b.y, dz = z - b.z, R = CR;
    o[0] = R[0] * dx + R[3] * dy + R[6] * dz; o[1] = R[1] * dx + R[4] * dy + R[7] * dz; o[2] = R[2] * dx + R[5] * dy + R[8] * dz;
    return o;
  };
  let localP, localN;
  function cubePoints() {
    const m = 9, P = [], Nn = [];
    for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const u = ((i + 0.5) / m * 2 - 1) * CUBE_H, v = ((j + 0.5) / m * 2 - 1) * CUBE_H, p = [0, 0, 0], n = [0, 0, 0];
      p[ax] = sg * CUBE_H; p[(ax + 1) % 3] = u; p[(ax + 2) % 3] = v; n[ax] = sg;
      P.push(...p); Nn.push(...n);
    }
    localP = Float64Array.from(P); localN = Float64Array.from(Nn);
    points = new Float64Array(localP.length); normals = new Float64Array(localN.length);
    spacing = 2 * CUBE_H / m;
  }
  function objectWorld() {
    const R = CR, n = localP.length / 3;
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) {
      points[i * 3 + r] = R[r * 3] * localP[i * 3] + R[r * 3 + 1] * localP[i * 3 + 1] + R[r * 3 + 2] * localP[i * 3 + 2] + b.getComponent(r);
      normals[i * 3 + r] = R[r * 3] * localN[i * 3] + R[r * 3 + 1] * localN[i * 3 + 1] + R[r * 3 + 2] * localN[i * 3 + 2];
    }
    return { points, normals, spacing };
  }
  const tmpL = [0, 0, 0];
  function cubeDistance(x, y, z) {                 // from a point outside the cube to its surface
    const q = local(x, y, z, tmpL).map(v => Math.abs(v) - CUBE_H);
    return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0);
  }

  // ---------------------------------------------------------------- scene
  function build() {
    K = info.hands.closures.length;
    const lj = new Float32Array(A("left_joints")), lv = new Float32Array(A("left_verts"));
    keys = Array.from({ length: K }, (_, k) => ({ J: lj.subarray(k * 63, (k + 1) * 63), V: lv.subarray(k * 778 * 3, (k + 1) * 778 * 3) }));
    partW = fingerWeights(keys[0]);
    cubePoints();

    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(28, 1, 0.01, 10);
    rootG = new T.Group();
    rootG.rotation.x = -Math.PI / 2;               // data z up -> three y up
    scene.add(rootG);
    scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
    key = new T.DirectionalLight(0xffffff, 0.95);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -0.4, right: 0.4, top: 0.4, bottom: -0.4 });
    scene.add(key, key.target);
    const rim = new T.DirectionalLight(0xfff1df, 0.35);
    rim.position.set(1, 0.6, -1);
    scene.add(rim);
    ground = new T.Mesh(new T.PlaneGeometry(3, 3), new T.ShadowMaterial({ opacity: 0.14 }));
    ground.receiveShadow = true;
    rootG.add(ground);

    const skin = C.clay(0xd9ac8f, { transparent: false });
    hand = new T.Mesh(C.geometry(new Float32Array(keys[0].V), A("left_faces")), skin);
    hand.castShadow = true;
    rootG.add(hand);

    const cubeMat = C.clay(0x3ea8e5, { transparent: false });
    const cubeGeo = new T.BoxGeometry(2 * CUBE_H, 2 * CUBE_H, 2 * CUBE_H);
    cube = new T.Mesh(cubeGeo, cubeMat); cube2 = new T.Mesh(cubeGeo, cubeMat);
    cube.castShadow = cube2.castShadow = true;
    rootG.add(cube, cube2);

    // Wuji Hand 2.2, left
    const mats = {};
    for (const [k, v] of Object.entries(WUJI_COLORS)) mats[k] = C.clay(v, { transparent: false, roughness: 0.5 });
    const d = wuji.info.sides.left;
    h = new IK.Hand(d, "left", wuji.arr);
    wg = new T.Group();
    meshes = d.parts.map(p => {
      const m = new T.Mesh(C.geometry(new Float32Array(wuji.arr(p.key + "_verts")), wuji.arr(p.key + "_faces")), mats[p.material] || mats.metal_silver);
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.userData.body = p.body;
      wg.add(m);
      return m;
    });
    rootG.add(wg);
    ik.ours = new IK.Retargeter(h);
    ik.tips = new IK.Retargeter(h, TIPS_ONLY);

    // fingertip targets: amber where the human tip pulls, sized by its fade
    const dotGeo = new T.SphereGeometry(0.0055, 16, 12);
    const mk = () => new T.Mesh(dotGeo, new T.MeshBasicMaterial({ color: 0xf2a93b, transparent: true, depthTest: false }));
    tipDots = TIPS.map(() => { const m = mk(); m.renderOrder = 3; rootG.add(m); return m; });
    tipRings = TIPS.map(() => { const m = mk(); m.renderOrder = 3; rootG.add(m); return m; });

    fadeBox.insertAdjacentHTML("beforeend", NAMES.map(n => `<div class="r"><span>${n}</span><span class="t"><i></i></span><b>–</b></div>`).join(""));
    buildMinis();
    bindUI();
    bindInput();
    window.addEventListener("resize", resize);
    resize();
    root.classList.add("ready");
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- solve and draw
  const L = new Float32Array(63), wrist = { R: new Float64Array(9), p: new Float64Array(3) };
  let neutral = null;
  function solve(fresh) {
    landmarks(L);
    neutral = neutral || palmOf(keys[0].J);
    IK.kabsch(neutral, palmOf(L), 6, wrist.R, wrist.p);
    const r = ik[mode];
    if (fresh) r.reset();
    try { state = r.solve({ L, wrist, object: objectWorld(), desk: -10 }); }
    catch (e) { console.error(e); return; }
    h.fk(state.R, state.p, state.q);
    for (const m of meshes) {
      const k = m.userData.body, R = h.R, P = h.P;
      m.matrix.set(R[k * 9], R[k * 9 + 1], R[k * 9 + 2], P[k * 3], R[k * 9 + 3], R[k * 9 + 4], R[k * 9 + 5], P[k * 3 + 1],
        R[k * 9 + 6], R[k * 9 + 7], R[k * 9 + 8], P[k * 3 + 2], 0, 0, 0, 1);
      m.matrixWorldNeedsUpdate = true;
    }
    const rows = fadeBox.querySelectorAll(".r");
    TIPS.forEach((t, f) => {
      const x = L[t * 3], y = L[t * 3 + 1], z = L[t * 3 + 2], phi = r.fade[f];
      const dist = Math.max(0, cubeDistance(x, y, z));
      const shown = mode === "tips" ? 1 : phi;
      tipDots[f].position.set(x, y, z);
      tipRings[f].position.set(x + off.x, y + off.y, z + off.z);
      tipDots[f].material.opacity = tipRings[f].material.opacity = 0.15 + 0.85 * shown;
      tipDots[f].scale.setScalar(0.6 + 0.8 * shown);
      tipRings[f].scale.setScalar(0.6 + 0.8 * shown);
      rows[f].querySelector("i").style.width = `${(shown * 100).toFixed(0)}%`;
      rows[f].querySelector("b").textContent = `${(dist * 1000).toFixed(0)} mm`;
    });
  }

  // ease the cube's turn and the hand toward its grasp; true while anything moved
  const handQT = new T.Quaternion(), handPT = new T.Vector3(), up = new T.Vector3();
  function poses() {
    let moved = false;
    if (cubeQ.angleTo(cubeQT) > 1e-4) { cubeQ.slerp(cubeQT, 0.15); moved = true; }
    const e = m3.makeRotationFromQuaternion(cubeQ).elements;
    CR.set([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
    if (anchor) {
      handQT.copy(cubeQ).multiply(SYM[anchor.s]).multiply(q0i);
      up.set(0, 0, retreat(mean(gs))).applyQuaternion(handQ);
      handPT.copy(b).add(up);
      const da = handQ.angleTo(handQT), dp = handP.distanceTo(handPT);
      if (da > 1e-4) { handQ.slerp(handQT, 0.16); moved = true; }
      if (dp > 1e-5) { handP.lerp(handPT, 0.2); moved = true; }
      // a grasp from far away: travel open, then close
      if (closeWhenThere && da < 0.08 && dp < 0.012) { closeWhenThere = false; gsTarget.fill(1); }
    }
    return moved;
  }
  // the grasps the stored one becomes on this cube, best first: nearest to the hand's turn now, hand not from below
  function grasps() {
    const palm = new T.Vector3(-0.07, -0.02, 0.025);              // the closed hand's palm, about the cube's centre
    return SYM.map((qs, s) => {
      const q = cubeQ.clone().multiply(qs).multiply(q0i);
      return { s, a: handQ.angleTo(q), below: palm.clone().applyQuaternion(q).z < -0.01 };
    }).filter(g => !g.below).sort((x, y) => x.a - y.a);
  }
  function grasp() {
    const list = grasps(), held = anchor && mean(gs) > 0.85;
    let pick = list[0];
    if (held) {                                    // already holding: another grip, from another side
      const i = list.findIndex(g => g.s === anchor.s);
      pick = list[(i + 1) % list.length];
    }
    anchor = { s: pick.s };
    gsTarget.fill(0);
    closeWhenThere = true;
  }
  function turnCube() {
    const axes = [new T.Vector3(0, 0, 1), new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0)];
    if (anchor && mean(gs) < 0.85) { anchor = null; closeWhenThere = false; }   // an open hand lets go
    cubeQT.premultiply(new T.Quaternion().setFromAxisAngle(axes[turnAxis++ % 3], Math.PI / 2));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    drawMinis(now);
    if (!visible) return;
    // ease the fingers toward their targets (presets), then keep solving a few frames so the warm start settles
    let moving = false;
    for (let f = 0; f < 5; f++) {
      const d = gsTarget[f] - gs[f];
      if (Math.abs(d) > 1e-4) { gs[f] += d * 0.18; moving = true; } else gs[f] = gsTarget[f];
    }
    if (poses()) moving = true;
    if (moving) dirty = Math.max(dirty, 6);
    if (dirty > 0) {
      placeHand();
      cube.position.copy(b); cube2.position.copy(b).add(off);
      cube.quaternion.copy(cubeQ); cube2.quaternion.copy(cubeQ);
      solve(dirty === 99);
      dirty = dirty === 99 ? 8 : dirty - 1;
    }
    const a = az + dragAz, e = el + dragEl;
    camera.position.set(center.x + dist * Math.cos(e) * Math.sin(a), center.y + dist * Math.sin(e), center.z + dist * Math.cos(e) * Math.cos(a));
    camera.lookAt(center);
    renderer.render(scene, camera);
    placeLabels();
  }

  // each label sits above its hand wherever the view turns: the projection of a point above the hand, clamped to the stage
  const proj = new T.Vector3();
  function placeLabels() {
    const rr = canvas.getBoundingClientRect(), z = (rr.width / (canvas.offsetWidth || rr.width)) || 1, r = { width: rr.width / z, height: rr.height / z };   // in the stage's own px (zoomed by fit.js)
    [0, 1].forEach(i => {
      const d = new T.Vector3(L[27], L[28], L[29] + 0.1);          // above the human middle knuckle
      if (i) d.add(off);
      proj.set(d.x, d.z, -d.y).project(camera);                       // data -> three -> clip
      const x = Math.max(90, Math.min(r.width - 90, (proj.x + 1) / 2 * r.width));
      const y = Math.max(40, Math.min(r.height - 60, (1 - proj.y) / 2 * r.height));
      labels[i].style.left = `${x.toFixed(0)}px`;
      labels[i].style.top = `${y.toFixed(0)}px`;
    });
  }

  // ---------------------------------------------------------------- view and input
  let visible = true, az = Math.PI + 0.4, el = 0.3, dragAz = 0, dragEl = 0, dist = 0.9, zoom = 1;
  const WIDTH = 0.7;
  const center = new T.Vector3();                                  // three frame
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { rootMargin: "60px" }).observe(root);
  // the stage's height is fitted to the screen by fit.js (data-fit, its box ending at the contact-fade row)
  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    const narrow = camera.aspect < 1.1;
    camera.fov = narrow ? 34 : 26;
    off.set(narrow ? 0 : -0.27, 0, narrow ? -0.26 : 0);
    wg.position.copy(off);
    ground.position.set(off.x / 2, 0, Math.min(0, off.z) - 0.1);
    const c = new T.Vector3(-0.03 + off.x / 2, -0.02, -0.015 + off.z / 2);       // data
    center.set(c.x, c.z, -c.y);
    key.target.position.copy(center);
    key.position.copy(center).add(new T.Vector3(-0.3, 1.4, 0.7));
    // fit both hands: about WIDTH metres across side by side, or two hands tall on a phone
    const vh = 2 * Math.tan((camera.fov * Math.PI / 180) / 2);
    const across = narrow ? Math.max(0.4 / camera.aspect, 0.68) : Math.max(WIDTH / camera.aspect, 0.34);   // a short stage keeps the hands' share of its height, so the labels above them stay clear
    dist = across / vh * zoom;
    // the buttons cover the bottom of the stage: draw the scene a little higher
    const lift = narrow ? 70 : Math.round(30 - Math.max(0, 460 - r.height) * 0.35);   // on a short stage, lower instead, so the labels above the hands have room
    camera.setViewOffset(r.width, r.height + lift, 0, lift, r.width, r.height);
    camera.updateProjectionMatrix();
    dirty = 99;
  }

  function bindUI() {
    document.querySelectorAll("#hoMode button").forEach(btn => btn.addEventListener("click", () => {
      mode = btn.dataset.m;
      document.querySelectorAll("#hoMode button").forEach(x => x.classList.toggle("on", x === btn));
      dirty = 99;
    }));
    document.querySelectorAll("#hoPose button").forEach(btn => btn.addEventListener("click", () => {
      const p = btn.dataset.p;
      if (p === "grasp") grasp();
      else if (p === "turn") turnCube();
      else { gsTarget.fill(0); closeWhenThere = false; }
      dirty = Math.max(dirty, 6);
      root.classList.add("touched");
    }));
  }

  const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(), hit = new T.Vector3(), tmp = new T.Vector3();
  let drag = null;
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([hand, cube, cube2, ...meshes], false);
    for (const x of hits) {
      if (x.object === cube || x.object === cube2) return { kind: "cube", point: x.point, robot: x.object === cube2 };
      if (x.object === hand) {
        const f = vFinger[x.face.a];
        if (f >= 0) return { kind: "finger", f };
        return null;
      }
      const f = h.owner[x.object.userData.body];
      if (f >= 0) return { kind: "finger", f };
      return null;
    }
    return null;
  }
  function bindInput() {
    canvas.addEventListener("pointermove", e => {
      if (!drag) {
        const p = e.pointerType === "mouse" ? pick(e) : null;
        canvas.classList.toggle("finger", !!p && p.kind === "finger");
        canvas.classList.toggle("ball", !!p && p.kind === "cube");
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.kind === "finger") {
        gsTarget[drag.f] = gs[drag.f] = Math.max(0, Math.min(1, drag.g0 + dy * 0.006));
        dirty = Math.max(dirty, 6);
      } else if (drag.kind === "cube") {
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hit)) {
          tmp.copy(hit).sub(drag.grab);                  // three frame -> data: (x, -z, y)
          const v = new T.Vector3(tmp.x, -tmp.z, tmp.y);
          if (drag.robot) v.sub(off);
          if (v.length() > CUBE_REACH) v.setLength(CUBE_REACH);
          b.copy(v);
          dirty = Math.max(dirty, 6);
        }
      } else {
        dragAz = drag.az - dx * 0.008;
        dragEl = Math.max(-0.25, Math.min(0.9, drag.el + dy * 0.006));
      }
    });
    canvas.addEventListener("pointerdown", e => {
      const p = pick(e);
      canvas.setPointerCapture(e.pointerId);
      root.classList.add("dragging", "touched");
      if (p && p.kind === "finger") drag = { kind: "finger", f: p.f, g0: gs[p.f], x: e.clientX, y: e.clientY };
      else if (p && p.kind === "cube") {
        const robot = p.robot, d = robot ? b.clone().add(off) : b, c = new T.Vector3(d.x, d.z, -d.y);
        plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new T.Vector3()).negate(), c);
        if (anchor && mean(gs) < 0.85) { anchor = null; closeWhenThere = false; }   // an open hand stays; a closed one carries
        drag = { kind: "cube", robot, grab: p.point.clone().sub(c), x: e.clientX, y: e.clientY };
      } else drag = { kind: "view", az: dragAz, el: dragEl, x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; root.classList.remove("dragging"); };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  // ---------------------------------------------------------------- the cards' small animations
  // Four short loops under the cards, not interactive: each is baked once (every frame solved by its own warm-started
  // retargeter, a few frames per page frame so the page stays smooth), then played back through one shared renderer
  // that is copied into each card's 2D canvas.
  const MINI_N = 72, MINI_S = 4.8;                 // frames per loop, seconds per loop
  const ease = u => 0.5 - 0.5 * Math.cos(2 * Math.PI * u);                       // 0 -> 1 -> 0 over a loop
  const hold = (u, a) => Math.min(1, ease(u) / a);                                // ... with a flat top
  const minis = [];
  let miniR = null, miniW = 0, miniH = 0, jobs = [];

  // one frame of the hand state described by s, solved by retargeter r: globals set, used, put back
  const saved = {};
  function stash(on) {
    if (on) Object.assign(saved, { gs: gs.slice(), b: b.clone(), cq: cubeQ.clone(), hq: handQ.clone(), hp: handP.clone(), cr: CR.slice() });
    else { gs.splice(0, 5, ...saved.gs); b.copy(saved.b); cubeQ.copy(saved.cq); handQ.copy(saved.hq); handP.copy(saved.hp); CR.set(saved.cr); }
  }
  function solveFrame(r, s) {
    gs.splice(0, 5, ...s.g); b.fromArray(s.cube || [0, 0, 0]); cubeQ.copy(s.cubeQ || q0);
    handQ.copy(s.handQ || new T.Quaternion()); handP.fromArray(s.handP || [0, 0, 0]);
    const e = m3.makeRotationFromQuaternion(cubeQ).elements;
    CR.set([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
    const Lf = landmarks(new Float32Array(63)), w = { R: new Float64Array(9), p: new Float64Array(3) };
    IK.kabsch(neutral, palmOf(Lf), 6, w.R, w.p);
    const st = r.solve({ L: Lf, wrist: w, object: objectWorld(), desk: -10 });
    const f = { L: Lf, hv: verts(new Float32Array(778 * 3)), R: Float64Array.from(st.R), p: Float64Array.from(st.p), q: Float64Array.from(st.q),
                fade: Float64Array.from(r.fade), cube: b.toArray(), cubeQ: cubeQ.clone() };
    if (s.contacts) {                              // where each hand touches the cube: human vertices within 4 mm, robot surface
                                                   // samples within 6 mm (the robot rests a soft clearance off the surface)
      const hp = [], rp = [], p = [0, 0, 0];
      for (let v = 0; v < 778; v++) if (cubeDistance(f.hv[v * 3], f.hv[v * 3 + 1], f.hv[v * 3 + 2]) < 0.004) hp.push(f.hv[v * 3], f.hv[v * 3 + 1], f.hv[v * 3 + 2]);
      h.fk(st.R, st.p, st.q);
      for (let i = 0; i < h.nS; i++) {
        h.point(h.sampleBody[i], h.samples[i * 3], h.samples[i * 3 + 1], h.samples[i * 3 + 2], p);
        if (cubeDistance(p[0], p[1], p[2]) < 0.006) rp.push(p[0], p[1], p[2]);
      }
      f.hc = Float32Array.from(hp); f.rc = Float32Array.from(rp);
    }
    return f;
  }
  // a baking job: a warm-up pass, then the recorded pass, a few frames at a time
  function bake(spec, weights, done, hand2) {
    const r = new IK.Retargeter(hand2 || h, weights), out = [];
    let i = -MINI_N;
    jobs.push(() => {
      for (let k = 0; k < 3 && i < MINI_N; k++, i++) {
        const u = ((i % MINI_N) + MINI_N) % MINI_N / MINI_N, f = solveFrame(r, spec(u));
        if (i >= 0) out.push(f);
      }
      if (i >= MINI_N) { done(out); return true; }
      return false;
    });
  }
  function runJobs() {
    if (!jobs.length) return;
    const t0 = performance.now();
    stash(true);
    while (jobs.length && performance.now() - t0 < 9) if (jobs[0]()) jobs.shift();
    stash(false);
  }

  // a small clay scene for one card
  function miniScene(fig, view) {
    const scene = new T.Scene(), g = new T.Group(), cam = new T.PerspectiveCamera(24, 1.6, 0.01, 10);
    g.rotation.x = -Math.PI / 2;
    scene.add(g, new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
    const k = new T.DirectionalLight(0xffffff, 0.95);
    k.position.set(-0.3, 1.4, 0.7);
    scene.add(k);
    const rim = new T.DirectionalLight(0xfff1df, 0.35);
    rim.position.set(1, 0.6, -1);
    scene.add(rim);
    const c = view.center, ctr = new T.Vector3(c[0], c[2], -c[1]);
    k.target.position.copy(ctr); scene.add(k.target);
    const m = { fig, canvas: fig.querySelector("canvas"), scene, g, cam, ctr, view, frames: null, visible: false, t0: performance.now() };
    m.ctx = m.canvas.getContext("2d");
    new IntersectionObserver(es => { m.visible = es[0].isIntersecting; }, { rootMargin: "40px" }).observe(fig);
    minis.push(m);
    return m;
  }
  const wujiCopy = (mat) => {
    const grp = new T.Group();
    grp.meshes = meshes.map(src => {
      const x = new T.Mesh(src.geometry, mat || src.material);
      x.matrixAutoUpdate = false; x.userData.body = src.userData.body;
      grp.add(x);
      return x;
    });
    return grp;
  };
  const humanCopy = (opacity) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array(778 * 3), 3));
    geo.setIndex(hand.geometry.index);
    const mat = opacity < 1 ? new T.MeshStandardMaterial({ color: 0xd9ac8f, transparent: true, opacity, depthWrite: false, roughness: 0.7 }) : C.clay(0xd9ac8f, { transparent: false });
    return new T.Mesh(geo, mat);
  };
  const cubeCopy = () => new T.Mesh(cube.geometry, cube.material);
  const amberDot = () => new T.Mesh(new T.SphereGeometry(0.005, 14, 10), new T.MeshBasicMaterial({ color: 0xf2a93b, transparent: true, depthTest: false }));
  function placeW(grp, R, p, q) {
    h.fk(R, p, q);
    for (const x of grp.meshes) {
      const k = x.userData.body, Rr = h.R, P = h.P;
      x.matrix.set(Rr[k * 9], Rr[k * 9 + 1], Rr[k * 9 + 2], P[k * 3], Rr[k * 9 + 3], Rr[k * 9 + 4], Rr[k * 9 + 5], P[k * 3 + 1],
        Rr[k * 9 + 6], Rr[k * 9 + 7], Rr[k * 9 + 8], P[k * 3 + 2], 0, 0, 0, 1);
      x.matrixWorldNeedsUpdate = true;
    }
  }
  // a frame between two baked ones
  const qa2 = new T.Quaternion(), qb2 = new T.Quaternion(), mR = new T.Matrix4();
  function between(A, B, s) {
    quatOf(A.R, qa2); quatOf(B.R, qb2); qa2.slerp(qb2, s);
    mR.makeRotationFromQuaternion(qa2);
    const e = mR.elements, R = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
    return { R, p: A.p.map((x, i) => x + (B.p[i] - x) * s), q: A.q.map((x, i) => x + (B.q[i] - x) * s) };
  }
  function quatOf(R, q) { mR.set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1); return q.setFromRotationMatrix(mR); }
  function setHuman(mesh, A, B, s) {
    const o = mesh.geometry.attributes.position.array;
    for (let i = 0; i < o.length; i++) o[i] = A.hv[i] + (B.hv[i] - A.hv[i]) * s;
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function buildMinis() {
    const figs = {};
    document.querySelectorAll(".ho-mini, .fg-panel").forEach(f => { figs[f.dataset.mini] = f; });
    if (!Object.keys(figs).length) return;
    neutral = neutral || palmOf(keys[0].J);
    const tmp = document.createElement("canvas");
    miniR = new T.WebGLRenderer({ canvas: tmp, antialias: true, alpha: true, preserveDrawingBuffer: true });
    miniR.setPixelRatio(1);
    miniR.outputEncoding = T.sRGBEncoding;
    const SIDE = -0.2;                             // the second hand of card 1, to the visitor's right

    // 1: one human motion, two objectives
    if (figs.shape) {
      const m = miniScene(figs.shape, { center: [-0.035 + SIDE / 2, -0.02, 0.03], dist: 0.5, az: Math.PI + 0.35, el: 0.32 });
      const A = wujiCopy(), B = wujiCopy(), hA = humanCopy(0.3), hB = humanCopy(0.3);
      B.position.x = SIDE; hB.position.x = SIDE;
      m.g.add(A, B, hA, hB);
      const spec = u => ({ g: [0, 1, 2, 3, 4].map(f => 0.12 + 0.8 * ease((u - 0.03 * f + 1) % 1)), cube: [0, 0, -1] });
      let fa = null, fb = null;
      const ready = () => { if (fa && fb) m.frames = fa.map((f, i) => ({ a: f, b: fb[i] })); };
      bake(spec, null, out => { fa = out; ready(); });
      // fingertips only, on a Wuji whose fingers may only bend inward: matched tips on longer fingers then show the hook
      // the card describes (with the full range the solver bends joints backward instead)
      const hIn = new IK.Hand(wuji.info.sides.left, "left", wuji.arr);
      wuji.info.sides.left.joints.forEach((jt, k) => { if (!/abd/.test(jt.name)) hIn.lo[k] = Math.max(hIn.lo[k], 0); });
      bake(spec, TIPS_ONLY, out => { fb = out; ready(); }, hIn);
      m.draw = (i, j, s) => {
        const F = m.frames, x = between(F[i].a, F[j].a, s), y = between(F[i].b, F[j].b, s);
        placeW(A, x.R, x.p, x.q); placeW(B, y.R, y.p, y.q);
        setHuman(hA, F[i].a, F[j].a, s); hB.geometry = hA.geometry;
      };
    }
    // 2: the cube comes to the fingers and leaves; the fingertip targets fade in
    if (figs.fade) {
      const m = miniScene(figs.fade, { center: [-0.035, 0.01, -0.015], dist: 0.44, az: Math.PI + 0.35, el: 0.3 });
      const W = wujiCopy(), hm = humanCopy(0.3), cb = cubeCopy(), dots = TIPS.map(() => amberDot());
      dots.forEach(d => { d.renderOrder = 3; m.g.add(d); });
      m.g.add(W, hm, cb);
      const g = 0.35, rise = retreat(g), far = new T.Vector3(0.0, 0.06, -0.055);
      const spec = u => {
        const k = hold(u, 0.6), p = far.clone().multiplyScalar(1 - k);
        return { g: [g, g, g, g, g], handP: [0, 0, rise], cube: p.toArray() };
      };
      bake(spec, null, out => { m.frames = out; });
      m.draw = (i, j, s) => {
        const F = m.frames, x = between(F[i], F[j], s);
        placeW(W, x.R, x.p, x.q); setHuman(hm, F[i], F[j], s);
        cb.position.fromArray(F[i].cube.map((v, k) => v + (F[j].cube[k] - v) * s)); cb.quaternion.copy(F[i].cubeQ);
        TIPS.forEach((t, f) => {
          const phi = F[i].fade[f] + (F[j].fade[f] - F[i].fade[f]) * s;
          dots[f].position.set(F[i].L[t * 3], F[i].L[t * 3 + 1], F[i].L[t * 3 + 2]);
          dots[f].scale.setScalar(0.4 + 1.2 * phi); dots[f].material.opacity = 0.15 + 0.85 * phi;
        });
      };
    }
    // 3: human and robot close on the cube together; where each touches it
    if (figs.transport) {
      const m = miniScene(figs.transport, { center: [-0.035, -0.01, 0.0], dist: 0.4, az: Math.PI + 0.35, el: 0.45 });
      const W = wujiCopy(), hm = humanCopy(0.5), cb = cubeCopy();
      const pts = col => new T.Points(new T.BufferGeometry(), new T.PointsMaterial({ color: col, size: 6, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.95 }));
      const hcP = pts(0xf2a93b), rcP = pts(0x1f7fc2);
      hcP.renderOrder = rcP.renderOrder = 3;
      m.g.add(W, hm, cb, hcP, rcP);
      const spec = u => { const g = 0.3 + 0.7 * hold(u, 0.55); return { g: [g, g, g, g, g], handP: [0, 0, retreat(g)], contacts: true }; };
      bake(spec, null, out => { m.frames = out; });
      m.draw = (i, j, s) => {
        const F = m.frames, x = between(F[i], F[j], s), n = s < 0.5 ? F[i] : F[j];
        placeW(W, x.R, x.p, x.q); setHuman(hm, F[i], F[j], s);
        cb.position.set(0, 0, 0); cb.quaternion.copy(q0);
        hcP.geometry.setAttribute("position", new T.BufferAttribute(n.hc, 3));
        rcP.geometry.setAttribute("position", new T.BufferAttribute(n.rc, 3));
      };
    }
    // 4: the hand holds the cube; the servo targets (amber) go past the surface as the grip rises
    if (figs.grip) {
      const m = miniScene(figs.grip, { center: [-0.035, -0.01, 0.0], dist: 0.4, az: Math.PI + 0.35, el: 0.3 });
      const W = wujiCopy(), G = wujiCopy(new T.MeshStandardMaterial({ color: 0xf2a93b, emissive: 0xf2a93b, emissiveIntensity: 0.3, transparent: true, opacity: 0.38, depthWrite: false })), cb = cubeCopy();
      m.g.add(cb, W, G);
      const alphaLabel = figs.grip.querySelector(".ho-alpha");
      let open = null;
      bake(() => ({ g: [0.3, 0.3, 0.3, 0.3, 0.3], handP: [0, 0, retreat(0.3)] }), null, out => { open = out[0]; });
      bake(() => ({ g: [1, 1, 1, 1, 1] }), null, out => {
        const held = out[0];
        // which way each joint closes: the open-to-held change, kept for the joints that clearly close
        const dir = held.q.map((x, k) => { const d = x - open.q[k]; return Math.abs(d) > 0.15 ? Math.sign(d) : 0; });
        m.frames = Array.from({ length: MINI_N }, (_, i) => ({ f: held, a: hold(i / MINI_N, 0.5) }));
        m.dir = dir;
      });
      m.draw = (i, j, s) => {
        const F = m.frames, a = F[i].a + (F[j].a - F[i].a) * s, f = F[i].f;
        placeW(W, f.R, f.p, f.q);
        placeW(G, f.R, f.p, f.q.map((x, k) => Math.min(h.hi[k], Math.max(h.lo[k], x + 0.2 * a * m.dir[k]))));
        cb.position.set(0, 0, 0); cb.quaternion.copy(q0);
        if (alphaLabel) alphaLabel.textContent = `grip α ${a.toFixed(2)}`;
      };
    }
    // 5: a real run, the left Wuji hand picking up the apple and putting it in the bowl (static/hero/grasp.*: start
    // 004854 gen000486 of the same 20, chosen with tools/rank_grasp.py for the steadiest hold: thumb, index and middle on
    // the apple 70-93 % of the carry with the least tip slide over it; the realized physics, what the search committed),
    // with the search drawn on the apple (searchScene)
    if (figs.search) {
      const m = miniScene(figs.search, { center: [0, 0, 0.05], dist: 0.55, az: Math.PI + 0.5, el: 0.35 });
      Promise.all([fetch("static/hero/grasp.json?v=20261124041321").then(r => r.json()), fetch("static/hero/grasp.bin?v=20261124041321").then(r => r.arrayBuffer())])
        .then(([meta, buf]) => searchScene(m, meta, buf)).catch(e => console.error(e));
    }
    if (figs.gapRobot) gapScenes(figs);
    sizeMinis();
    window.addEventListener("resize", sizeMinis);
  }

  // #why, the force gap, on the Wuji hand: one shared timeline in three panels. Robot data: the commands (blue) go past
  // the cube's surface, the fingers stop on it, and the cube is lifted. Human video: the seen hand (faint) is copied as
  // the command, so nothing squeezes and the cube stays on the desk while the hand rises. Foretargeting: the forecast
  // (amber) says where the cube must go, and the commands that take it there go past the surface. An illustration:
  // the kinematic stage poses the hand; the squeeze is drawn, not simulated.
  function gapScenes(figs) {
    // turn the stored grasp so the cube sits square on a desk: of the cube's 24 symmetries, the one that keeps the
    // closed hand highest above the cube's bottom face (no finger under the cube, none in the desk)
    const z = new T.Vector3(0, 0, 1), V = keys[K - 1].V, p = new T.Vector3();
    let W = null, best = -1e9;
    for (const S of SYM) {
      const w = S.clone().multiply(q0i);
      let low = 1e9;
      for (let v = 0; v < V.length; v += 9) low = Math.min(low, p.set(V[v], V[v + 1], V[v + 2]).applyQuaternion(w).z);
      if (low > best) { best = low; W = w; }
    }
    const U = z.clone().applyQuaternion(W.clone().invert());          // the world's up, in the data frame
    const hu = z.clone().applyQuaternion(W), AZ = Math.atan2(hu.y, hu.x) + 2.3;   // a view from the fingers' side
    const LIFT = 0.055, REACH = 0.07;
    const ss = (u, a, b) => { const x = Math.max(0, Math.min(1, (u - a) / (b - a))); return x * x * (3 - 2 * x); };
    const phase = u => ({
      reach: 1 - ss(u, 0, 0.14) + ss(u, 0.92, 1),
      g: 0.3 + 0.7 * (ss(u, 0.14, 0.3) - ss(u, 0.84, 0.92)),
      a: ss(u, 0.3, 0.4) - ss(u, 0.74, 0.82),
      lift: LIFT * (ss(u, 0.4, 0.6) - ss(u, 0.7, 0.84))
    });
    const cubeMat = C.clay(0xe4dac8, { transparent: false }), cubeGeo = new T.BoxGeometry(2 * CUBE_H, 2 * CUBE_H, 2 * CUBE_H);
    const cmdMat = new T.MeshStandardMaterial({ color: 0x3ea8e5, emissive: 0x3ea8e5, emissiveIntensity: 0.25, transparent: true, opacity: 0.4, depthWrite: false });
    const foreMat = new T.MeshStandardMaterial({ color: 0xf2a93b, emissive: 0xf2a93b, emissiveIntensity: 0.3, transparent: true, opacity: 0.2, depthWrite: false });
    const edgeGeo = new T.EdgesGeometry(cubeGeo);
    const shared = { frames: { robot: null, human: null }, dir: null };
    const kinds = { gapRobot: "robot", gapHuman: "human", gapFore: "fore" };
    const handFrames = kind => kind === "human" ? "human" : "robot";
    const scenes = Object.keys(kinds).filter(k => figs[k]).map(k => {
      const kind = kinds[k];
      const m = miniScene(figs[k], { center: [0, 0, 0.07], dist: 0.86, az: AZ, el: 0.36 });
      m.S = 7.5; m.still = 0.64;   // reduced motion: the lift
      const inner = new T.Group(); inner.quaternion.copy(W); m.g.add(inner);
      const desk = new T.Mesh(new T.BoxGeometry(0.3, 0.2, 0.012), C.clay(0xc9bba5, { transparent: false, roughness: 0.85 }));
      desk.position.z = -CUBE_H - 0.006; m.g.add(desk);
      const W1 = wujiCopy(), cb = new T.Mesh(cubeGeo, cubeMat);
      inner.add(cb, W1);
      const G = kind === "human" ? null : wujiCopy(cmdMat);
      if (G) inner.add(G);
      const hm = kind === "robot" ? null : humanCopy(kind === "human" ? 0.42 : 0.22);
      if (hm) inner.add(hm);
      const fc = kind === "fore" ? [1, 2, 3].map(i => {
        const g = new T.Group(), f = new T.Mesh(cubeGeo, foreMat.clone()), e = new T.LineSegments(edgeGeo, new T.LineBasicMaterial({ color: 0xe8941f, transparent: true }));
        g.add(f, e); g.position.copy(U).multiplyScalar(LIFT * i / 3); g.quaternion.copy(q0); g.lvl = LIFT * i / 3; inner.add(g); return g;
      }) : [];
      m.kind = kind;
      m.cubeEdges = new T.LineSegments(edgeGeo); m.cubeEdges.visible = false; cb.add(m.cubeEdges);
      m.tipS = new T.Vector3(); m.tipC = new T.Vector3(); m.tipH = new T.Vector3(); m.inner = inner; m.cb = cb; m.G = G; m.W1 = W1; m.hm = hm;
      m.draw = (i, j, s) => {
        const F = shared.frames[handFrames(kind)];
        if (!F) return;
        const x = between(F[i], F[j], s), u = (i + s) / MINI_N, P = phase(u);
        placeW(W1, x.R, x.p, x.q);
        tipOf(shared.finger, m.tipS); m.tipC.copy(m.tipS);
        if (G) {
          placeW(G, x.R, x.p, x.q.map((v, k) => Math.min(h.hi[k], Math.max(h.lo[k], v + 0.22 * P.a * shared.dir[k]))));
          tipOf(shared.finger, m.tipC);
          G.visible = P.a > 0.02;
          // only the links the commands move: the palm's copy would just tint the real palm
          G.meshes.forEach((g, n) => { const a = g.matrix.elements, c = W1.meshes[n].matrix.elements; g.visible = Math.abs(a[12] - c[12]) + Math.abs(a[13] - c[13]) + Math.abs(a[14] - c[14]) + Math.abs(a[0] - c[0]) + Math.abs(a[5] - c[5]) > 1e-4; });
        }
        if (hm) {
          setHuman(hm, F[i], F[j], s);
          const t = TIPS[shared.finger] * 3, A = F[i].L, B = F[j].L;
          m.tipH.set(A[t] + (B[t] - A[t]) * s, A[t + 1] + (B[t + 1] - A[t + 1]) * s, A[t + 2] + (B[t + 2] - A[t + 2]) * s);
        }
        cb.position.fromArray(F[i].cube.map((v, k) => v + (F[j].cube[k] - v) * s)); cb.quaternion.copy(q0);
        const y = cb.position.dot(U);
        fc.forEach(g => { const k = Math.max(0, Math.min(1, (g.lvl - y) / 0.02 + 0.1)); g.children[0].material.opacity = 0.18 * k; g.children[1].material.opacity = 0.9 * k; });
      };
      m.after = now => loupe(m, now);
      m.shift = () => shared.zk;
      // the lens: a click opens all three at the same moment, so the commands can be compared
      m.canvas.addEventListener("click", () => { if (shared.zoom) setZoom(false); });
      m.canvas.addEventListener("pointermove", () => { m.canvas.style.cursor = shared.zoom ? "zoom-out" : ""; });
      return m;
    });
    if (!scenes.length) return;

    // ---- the lens at the fingertip: the same scene from close by, with the cube made see-through so a command inside it
    // shows. The fingertip is the one whose command goes deepest at the grip (picked once the frames are baked).
    const GRIP_U = 0.39;                             // fingers closed and pushed, the cube not yet lifted: where the finger is picked
    const cubeGlass = new T.MeshStandardMaterial({ color: 0xcdb48a, roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false });
    const cubeEdgeMat = new T.LineBasicMaterial({ color: 0x7a6440, transparent: true, opacity: 0.9 });
    const skinLens = new T.MeshStandardMaterial({ color: 0xd9ac8f, roughness: 0.7, transparent: true, opacity: 0.45, depthWrite: false });
    const cmdLens = new T.MeshStandardMaterial({ color: 0x3ea8e5, emissive: 0x3ea8e5, emissiveIntensity: 0.3, transparent: true, opacity: 0.78, depthWrite: false });
    const lensCam = new T.PerspectiveCamera(24, 1, 0.002, 2), toCam = new T.Vector3(), wS = new T.Vector3(), wC = new T.Vector3(), mid = new T.Vector3();
    const tipP = [0, 0, 0], qi = q0.clone().invert(), tmpV = new T.Vector3();
    shared.finger = 1; shared.zoom = false; shared.zk = 0; shared.last = 0;
    function tipOf(f, out) { const t = h.tips[f]; h.point(t.body, t.pos[0], t.pos[1], t.pos[2], tipP); return out.set(tipP[0], tipP[1], tipP[2]); }
    // metres from a point (cube frame of the data) to the cube's surface, negative inside
    function depth(p, c) {
      const d = tmpV.copy(p).sub(c).applyQuaternion(qi), x = Math.abs(d.x) - CUBE_H, y = Math.abs(d.y) - CUBE_H, z = Math.abs(d.z) - CUBE_H;
      return Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) + Math.min(Math.max(x, y, z), 0);
    }
    const LABEL = { robot: ["Teleop command"], human: ["Pure IK command"], fore: ["MPC command"] };
    function lensGeom(m) {
      const dpr = m.w / Math.max(1, m.canvas.getBoundingClientRect().width), k = shared.zk;
      m.cam.updateMatrixWorld();
      const sp = mid.copy(m.tipS).add(m.tipC).multiplyScalar(0.5).applyMatrix4(m.inner.matrixWorld).project(m.cam);
      const sx = (sp.x + 1) / 2 * m.w, sy = (1 - sp.y) / 2 * m.h;
      const r0 = Math.min(m.h * 0.08, m.w * 0.09), r1 = m.tall ? Math.min(m.w * 0.32, m.h * 0.2) : Math.min(m.h * 0.29, m.w * 0.27);   // a tall panel: a smaller lens, under the hand
      const r = r0 + (r1 - r0) * k, cx = m.tall ? m.w / 2 : m.w - r1 - 14 * dpr, cy = m.tall ? m.h - r1 - 44 * dpr : r1 + 14 * dpr;   // a tall phone panel: the lens under the hand
      return { x: sx + (cx - sx) * k, y: sy + (cy - sy) * k, r, dpr, sx, sy };
    }
    function setZoom(on) {
      shared.zoom = on;
      const fig = scenes[0].fig.closest(".fg");
      if (fig) fig.classList.toggle("zoomed", on);
      const b = document.getElementById("fgZoom");
      if (b) { b.setAttribute("aria-pressed", on); b.textContent = on ? "Hide the close-up" : "See the gap up close"; }
    }
    const zb = document.getElementById("fgZoom");
    if (zb) zb.addEventListener("click", () => setZoom(!shared.zoom));
    setZoom(true); shared.zk = 1;                   // open when the page loads; the button hides it
    function loupe(m, now) {
      if (now !== shared.last) { const dt = shared.last ? Math.min(0.05, (now - shared.last) / 1000) : 0; shared.last = now; shared.zk += ((shared.zoom ? 1 : 0) - shared.zk) * Math.min(1, dt * (FT.reduced ? 60 : 7)); }
      // hidden until asked for (the button in the key): it grows out of the contact point and shrinks back into it
      if (!shared.zoom && shared.zk < 0.01) { m.lens = null; return; }
      const L = m.lens = lensGeom(m), k = shared.zk, ctx = m.ctx, d = L.dpr, A = Math.min(1, k * 4);
      // the lens camera: from the main camera's side, turned square to the gap between state and command
      wS.copy(m.tipS).applyMatrix4(m.inner.matrixWorld); wC.copy(m.tipC).applyMatrix4(m.inner.matrixWorld);
      mid.copy(wS).add(wC).multiplyScalar(0.5);
      toCam.copy(m.cam.position).sub(mid).normalize();
      if (shared.lensN) {
        const n = shared.lensN.clone().transformDirection(m.inner.matrixWorld);
        if (n.dot(toCam) < 0) n.negate();
        toCam.lerp(n, 0.35 + 0.65 * k).normalize();
      }
      const field = 0.05 + 0.025 * k;                  // metres across the lens
      lensCam.position.copy(mid).addScaledVector(toCam, field / (2 * Math.tan(12 * Math.PI / 180)));
      lensCam.up.copy(m.cam.up); lensCam.lookAt(mid); lensCam.updateMatrixWorld();
      // render it see-through, into a square of the shared buffer, and draw it as a round lens
      const S = Math.max(8, Math.min(miniH, miniW, Math.round(2 * L.r)));
      const cbMat = m.cb.material, G = m.G, gMat = G && G.meshes[0].material;
      // only that finger, its command and the cube: the other fingers, the palm and the human hand would hide the gap
      const fv = shared.finger, mine = x => h.owner[x.userData.body] === fv, keepG = G && G.meshes.map(x => x.visible), hv = m.hm && m.hm.visible;
      m.cb.material = cubeGlass; m.cubeEdges.material = cubeEdgeMat; m.cubeEdges.visible = true;
      m.W1.meshes.forEach(x => { x.visible = mine(x); });
      if (G) G.meshes.forEach(x => { x.material = cmdLens; x.visible = x.visible && mine(x); });
      const hMat = m.hm && m.hm.material;
      if (m.hm) { m.hm.visible = m.kind === "human"; m.hm.material = skinLens; }
      miniR.setViewport(0, 0, S, S); miniR.setScissor(0, 0, S, S); miniR.clear();
      miniR.render(m.scene, lensCam);
      m.cb.material = cbMat; m.cubeEdges.visible = false;
      m.W1.meshes.forEach(x => { x.visible = true; });
      if (G) G.meshes.forEach((x, n) => { x.material = gMat; x.visible = keepG[n]; });
      if (m.hm) { m.hm.visible = hv; m.hm.material = hMat; }
      if (k > 0.01) {
        const dx = L.x - L.sx, dy = L.y - L.sy, dl = Math.hypot(dx, dy);
        if (dl > L.r + 4 * d) {
          ctx.globalAlpha = A; ctx.strokeStyle = "rgba(60,62,67,.55)"; ctx.lineWidth = 1.4 * d; ctx.setLineDash([3 * d, 3 * d]);
          ctx.beginPath(); ctx.moveTo(L.sx, L.sy); ctx.lineTo(L.x - dx / dl * L.r, L.y - dy / dl * L.r); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(L.sx, L.sy, 3 * d, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      ctx.save();
      ctx.globalAlpha = A;
      ctx.beginPath(); ctx.arc(L.x, L.y, L.r, 0, 2 * Math.PI);
      ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 14 * d; ctx.fillStyle = "#f6f2ea"; ctx.fill(); ctx.shadowBlur = 0;
      ctx.clip();
      ctx.drawImage(miniR.domElement, 0, miniH - S, S, S, L.x - L.r, L.y - L.r, 2 * L.r, 2 * L.r);
      // the fingertip (where it stops) and the command (where it is told to go), joined
      const pr = v => { const p = v.clone().project(lensCam); return [L.x + p.x * L.r, L.y - p.y * L.r]; };
      const a = pr(wS), c = pr(wC);
      ctx.lineWidth = 1.5 * d;
      if (Math.hypot(c[0] - a[0], c[1] - a[1]) > 3 * d) {
        ctx.setLineDash([4 * d, 3 * d]); ctx.strokeStyle = "#1f7fc2"; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#1f7fc2"; ctx.beginPath(); ctx.arc(c[0], c[1], 3.6 * d, 0, 2 * Math.PI); ctx.fill();
      }
      if (m.kind === "human") {                      // the human fingertip the command is copied from
        const hh = pr(mid.copy(m.tipH).applyMatrix4(m.inner.matrixWorld));
        ctx.setLineDash([4 * d, 3 * d]); ctx.strokeStyle = "#b7764f"; ctx.beginPath(); ctx.moveTo(hh[0], hh[1]); ctx.lineTo(a[0], a[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#d9ac8f"; ctx.strokeStyle = "#9a5f3d"; ctx.beginPath(); ctx.arc(hh[0], hh[1], 4.2 * d, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
      ctx.strokeStyle = "#3c3e43"; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(a[0], a[1], 3.6 * d, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.restore();
      // the rim and a handle, so it reads as a magnifier
      ctx.globalAlpha = A; ctx.strokeStyle = "rgba(60,62,67,.85)"; ctx.lineWidth = 2.5 * d;
      ctx.beginPath(); ctx.arc(L.x, L.y, L.r, 0, 2 * Math.PI); ctx.stroke();
      const hk = 1 - k;
      if (hk > 0.02) {
        ctx.globalAlpha = hk * A; ctx.lineCap = "round"; ctx.lineWidth = 5 * d;
        ctx.beginPath(); ctx.moveTo(L.x + L.r * 0.72, L.y + L.r * 0.72); ctx.lineTo(L.x + L.r * 1.18, L.y + L.r * 1.18); ctx.stroke();
        ctx.lineCap = "butt";
      }
      ctx.globalAlpha = 1;
      // the reading, while open: how far past the stopped fingertip the command sends it (the gap the policy can learn)
      if (k > 0.5) {
        const [name] = LABEL[m.kind], gapMm = wC.distanceTo(wS) * 1000;
        const rest = m.kind === "human" ? " · copied from the human hand: no squeeze"
          : gapMm < 1.5 ? " · not pushing yet" : ` · told ${gapMm.toFixed(0)} mm past where it stops`;
        ctx.globalAlpha = Math.min(1, (k - 0.5) * 2.5);
        if (m.tall) {                               // a tall phone panel: the name over a short reading, centred under the lens
          const short = m.kind === "human" ? "no squeeze" : gapMm < 1.5 ? "not pushing yet" : `${gapMm.toFixed(0)} mm past the stop`;
          const fs = 11 * d, f1 = `600 ${fs}px Inter, system-ui, sans-serif`, f2 = `400 ${fs}px Inter, system-ui, sans-serif`, y1 = m.h - 30 * d, y2 = m.h - 15 * d;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.font = f1; ctx.fillStyle = m.kind === "human" ? "#3c3e43" : "#1f7fc2"; ctx.fillText(name, m.w / 2, y1);
          ctx.font = f2; ctx.fillStyle = "#4a515b"; ctx.fillText(short, m.w / 2, y2);
          ctx.globalAlpha = 1; return;
        }
        let fs = 12.5 * d, f1, f2, w1, w2;
        for (let n = 0; n < 6; n++) {
          f1 = `600 ${fs}px Inter, system-ui, sans-serif`; f2 = `400 ${fs}px Inter, system-ui, sans-serif`;
          ctx.font = f1; w1 = ctx.measureText(name).width; ctx.font = f2; w2 = ctx.measureText(rest).width;
          if (w1 + w2 + 20 * d <= m.w - 12 * d) break;
          fs *= (m.w - 32 * d) / (w1 + w2);
        }
        const bw = w1 + w2 + 20 * d, bh = 26 * d, ty = m.h - 22 * d, x0 = Math.max(6 * d, m.w / 2 - bw / 2);
        ctx.fillStyle = "rgba(255,255,255,.94)"; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x0, ty - bh / 2, bw, bh, bh / 2); else ctx.rect(x0, ty - bh / 2, bw, bh);
        ctx.fill();
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.font = f1; ctx.fillStyle = m.kind === "human" ? "#3c3e43" : "#1f7fc2"; ctx.fillText(name, x0 + 10 * d, ty);
        ctx.font = f2; ctx.fillStyle = "#4a515b"; ctx.fillText(rest, x0 + 10 * d + w1, ty);
        ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
      }
    }
    const spec = lifts => u => {
      const P = phase(u), hp = U.clone().multiplyScalar(P.lift + REACH * P.reach); hp.z += retreat(P.g);
      return { g: [P.g, P.g, P.g, P.g, P.g], handP: hp.toArray(), cube: U.clone().multiplyScalar(lifts ? P.lift : 0).toArray() };
    };
    bake(spec(true), null, out => {
      shared.frames.robot = out;
      // which way each joint closes: open (before the grasp) to held, for the joints that clearly close
      const o = out[Math.round(0.08 * MINI_N)], c = out[Math.round(0.35 * MINI_N)];
      shared.dir = c.q.map((v, k) => { const d = v - o.q[k]; return Math.abs(d) > 0.15 ? Math.sign(d) : 0; });
      // the lens follows the fingertip whose command goes deepest into the cube at the grip
      const gf = out[Math.round(GRIP_U * MINI_N)], cc = new T.Vector3().fromArray(gf.cube), tp = new T.Vector3();
      h.fk(gf.R, gf.p, gf.q.map((v, k) => Math.min(h.hi[k], Math.max(h.lo[k], v + 0.22 * shared.dir[k]))));
      let deep = 0;
      h.tips.forEach((_, f) => { const dd = -depth(tipOf(f, tp), cc); if (dd > deep) { deep = dd; shared.finger = f; } });
      // the lens looks square onto that finger's bending plane: the push into the cube is then seen side on
      const Cp = tipOf(shared.finger, new T.Vector3());
      h.fk(gf.R, gf.p, gf.q);
      const Sp = tipOf(shared.finger, new T.Vector3()), kb = h.chains[shared.finger][0];
      const Kp = new T.Vector3(h.P[kb * 3], h.P[kb * 3 + 1], h.P[kb * 3 + 2]);
      shared.lensN = Cp.clone().sub(Sp).cross(Sp.clone().sub(Kp)).normalize();
      scenes.forEach(m => { if (handFrames(m.kind) === "robot") m.frames = out; });
    });
    bake(spec(false), null, out => {
      shared.frames.human = out; scenes.forEach(m => { if (handFrames(m.kind) === "human") m.frames = out; });
    });
    jobs.unshift(...jobs.splice(-2));               // the top of the page: bake these first
  }
  function searchScene(m, meta, buf) {
    const L = meta.layout, U = meta.pos_unit, FPS = meta.fps, NG = meta.parts.length, seg = meta.segments[0];
    const pp = C.arr(buf, L.poses_p_0), pq = C.arr(buf, L.poses_q_0);
    const T0 = 0, T1 = (seg.n - 1) / FPS;          // the whole clip: reach, pick-up, carry, placing
    const geos = meta.parts.map((_, i) => C.geometry(new Float32Array(C.arr(buf, L[`mesh_${i}_v`])), C.arr(buf, L[`mesh_${i}_f`])));
    const wujiMat = C.clay(0x434b57, { transparent: false, roughness: 0.42, metalness: 0.2 });
    const objMat = { apple: C.clay(0xc9573f, { transparent: false }), bowl: new T.MeshStandardMaterial({ color: 0xebe4d8, roughness: 0.55, side: T.DoubleSide }) };
    const shown = meta.parts.map((p, i) => p.group === "right" ? null : (() => {
      const x = new T.Mesh(geos[i], p.group === "left" ? wujiMat : objMat[p.group]);
      x.castShadow = true; m.g.add(x); return x;
    })());
    // the search, drawn on the apple: its plan for the next second (amber, the run's world-model plan), the paths
    // candidate corrections would give it (grey), the best eighth (blue), and the path it really took (green)
    const plan = C.arr(buf, L.plan_0), active = C.arr(buf, L.active_0);
    const NC = 24, NE = 3, K = 14, H = 1.0;
    const line = (color, opacity, dashed) => {
      const g = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(K * 3), 3));
      const mat = dashed ? new T.LineDashedMaterial({ color, dashSize: 0.006, gapSize: 0.005, transparent: true, opacity, depthTest: false })
                         : new T.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
      const l = new T.Line(g, mat); l.renderOrder = 4; m.g.add(l); return l;
    };
    const cands = Array.from({ length: NC }, () => line(0x8592a6, 0.35)), planLine = line(0xf2a93b, 1, true);
    // a few candidates also show the hand they would give: the hand and apple where that candidate's path is, 0.45 s on
    const SH = 0.45, SHOWN = [0, 1, 6, 11, 16, 21];                 // ranks shown: the best two, then a spread of the rest
    const ghostGrey = new T.MeshStandardMaterial({ color: 0x9aa3ae, transparent: true, opacity: 0.3 });
    const ghostBlue = new T.MeshStandardMaterial({ color: 0x3ea8e5, transparent: true, opacity: 0.42 });
    const leftParts = meta.parts.map((p, i) => p.group === "left" || p.group === "apple" ? i : -1).filter(i => i >= 0);
    const ghosts = SHOWN.map(() => {
      const gg = new T.Group();
      gg.parts = leftParts.map(i => { const x = new T.Mesh(geos[i], ghostGrey); gg.add(x); return x; });
      m.g.add(gg);
      return gg;
    });
    const trail = line(0x22b37a, 1);
    trail.material.linewidth = 2;
    const qa = new T.Quaternion(), qb = new T.Quaternion();
    function poseAt(t, i, obj) {
      const f = Math.max(0, Math.min(seg.n - 1.001, t * FPS)), a = Math.floor(f), s = f - a;
      const j = (a * NG + i) * 3, k = ((a + 1) * NG + i) * 3, jq = (a * NG + i) * 4, kq = ((a + 1) * NG + i) * 4;
      obj.position.set((pp[j] + (pp[k] - pp[j]) * s) * U, (pp[j + 1] + (pp[k + 1] - pp[j + 1]) * s) * U, (pp[j + 2] + (pp[k + 2] - pp[j + 2]) * s) * U);
      qa.set(pq[jq + 1], pq[jq + 2], pq[jq + 3], pq[jq]).normalize(); qb.set(pq[kq + 1], pq[kq + 2], pq[kq + 3], pq[kq]).normalize();
      obj.quaternion.copy(qa).slerp(qb, s);
    }
    // frame the apple's travel and the hand above it
    const apple = meta.parts.findIndex(p => p.group === "apple"), bowl = meta.parts.findIndex(p => p.group === "bowl"), box = new T.Box3(), o = new T.Object3D();
    const handIdx = meta.parts.map((p, i) => p.group === "left" ? i : -1).filter(i => i >= 0);
    for (let t = T0; t <= T1; t += 0.2) for (const i of [apple, bowl, ...handIdx]) { poseAt(t, i, o); box.expandByPoint(o.position); }
    const c = box.getCenter(new T.Vector3());
    m.ctr.set(c.x, c.z + 0.02, -c.y);
    m.view.dist = Math.max(0.6, box.getSize(new T.Vector3()).length() * 2.3);
    // each candidate's smooth offset from the plan, growing along the horizon (random, fixed per window)
    const WIN = 0.5, rnd = () => (Math.random() - 0.5) * 2;
    const waves = Array.from({ length: 12 }, () => Array.from({ length: NC }, () => Array.from({ length: 3 }, () => [rnd(), rnd(), 1 + 2 * Math.random(), 6 * Math.random()])));
    const planAt = (t, out) => { const f = Math.round(Math.max(0, Math.min(seg.n - 1, t * FPS))) * 7; return out.set(plan[f], plan[f + 1], plan[f + 2]); };
    const realAt = (t, out) => { poseAt(t, apple, o); return out.copy(o.position); };
    const isApple = t => active[Math.round(Math.max(0, Math.min(seg.n - 1, t * FPS)))] === 0;
    const v = new T.Vector3(), p0 = new T.Vector3(), q0v = new T.Vector3(), r0 = new T.Vector3();
    m.draw = (i, j, s2) => {
      const u = (i + s2) / MINI_N, t = T0 + u * (T1 - T0), win = Math.floor(t / WIN), k = t / WIN - win;
      shown.forEach((x, n) => { if (x) poseAt(t, n, x); });
      // six refits per window, the spread narrowing each time
      const it = Math.min(5, Math.floor(k * 7)), spread = 0.1 * Math.pow(0.6, it), wv = waves[win % waves.length];
      realAt(t, r0); planAt(t, q0v);
      const offs = wv.map(c => (s => c.map(([a, b, w, ph]) => (a * Math.sin(w * s * 3 + ph) + b * s) * spread * Math.pow(s / H, 0.9))));
      // the candidates drawn with a hand sit on a ring around the plan, evenly spaced so each reads as its own hand; the
      // two best (blue) on a ring a quarter the size; the rings narrow with the refits
      const ringAt = n => {
        const best = n < 2, a = (best ? n * Math.PI : (n - 2) * Math.PI / 2 + Math.PI / 4) + win * 0.9, r = (best ? 0.25 : 1) * 0.1 * Math.pow(0.6, it);
        return s => { const f = r * Math.pow(s / H, 0.9); return [f * Math.cos(a), 0.35 * f * Math.sin(a), f * Math.sin(a) / 0.6]; };
      };
      const score = wv.map((_, c) => { const e = offs[c](H); return Math.hypot(...e); });
      const order = score.map((x, c) => [x, c]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
      SHOWN.forEach((rank, n) => { offs[order[rank]] = ringAt(n); });
      const live = isApple(t) && t < T1 - 0.2;
      cands.forEach((l, c) => {
        l.visible = live;
        if (!live) return;
        const arr = l.geometry.attributes.position.array, elite = order.indexOf(c) < NE;
        for (let n = 0; n < K; n++) {
          const sh = n / (K - 1) * H, tt = Math.min(T1, t + sh);
          planAt(tt, p0).sub(q0v).add(r0);
          const e = offs[c](sh);
          arr[n * 3] = p0.x + e[0]; arr[n * 3 + 1] = p0.y + e[1]; arr[n * 3 + 2] = p0.z + e[2] * 0.6;
        }
        l.geometry.attributes.position.needsUpdate = true;
        l.material.color.setHex(elite ? 0x3ea8e5 : 0x8592a6);
        l.material.opacity = elite ? 0.95 : 0.3;
        l.renderOrder = elite ? 5 : 4;
      });
      ghosts.forEach((gg, n) => {
        gg.visible = live;
        if (!live) return;
        const c = order[SHOWN[n]], tt = Math.min(T1, t + SH), e = offs[c](SH);
        gg.parts.forEach((x, k) => poseAt(tt, leftParts[k], x));
        // the candidate's apple sits on its line: plan shift from now, from where the apple is now, plus the offset
        planAt(tt, p0).sub(q0v).add(r0); realAt(tt, v);
        gg.position.set(p0.x - v.x + e[0], p0.y - v.y + e[1], p0.z - v.z + e[2] * 0.6);
        const mat = n < 2 ? ghostBlue : ghostGrey;
        if (gg.mat !== mat) { gg.mat = mat; gg.parts.forEach(x => { x.material = mat; }); }
      });
      planLine.visible = live;
      if (live) {
        const arr = planLine.geometry.attributes.position.array;
        for (let n = 0; n < K; n++) { planAt(Math.min(T1, t + n / (K - 1) * H), p0).sub(q0v).add(r0); arr[n * 3] = p0.x; arr[n * 3 + 1] = p0.y; arr[n * 3 + 2] = p0.z; }
        planLine.geometry.attributes.position.needsUpdate = true;
        planLine.computeLineDistances();
      }
      const ta = trail.geometry.attributes.position.array;
      for (let n = 0; n < K; n++) { realAt(Math.max(T0, t - 0.7 + n / (K - 1) * 0.7), v); ta[n * 3] = v.x; ta[n * 3 + 1] = v.y; ta[n * 3 + 2] = v.z; }
      trail.geometry.attributes.position.needsUpdate = true;
    };
    m.frames = [true];
  }
  // each card's canvas keeps its own size; the shared renderer is as large as the largest and each card is drawn into
  // its lower-left corner (WebGL's origin), then copied out
  function sizeMinis() {
    if (!minis.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    miniW = miniH = 1;
    for (const m of minis) {
      const r = m.canvas.getBoundingClientRect();
      m.w = Math.max(1, Math.round(r.width * dpr)); m.h = Math.max(1, Math.round(r.height * dpr));
      m.canvas.width = m.w; m.canvas.height = m.h;
      m.cam.aspect = m.w / m.h; m.cam.updateProjectionMatrix();
      m.narrowFit = m.fig.classList.contains("ho-mini") && innerWidth < 900;   // phone layout: back off so the hand fits the narrower card
      m.tall = m.fig.classList.contains("fg-panel") && m.w / m.h < 0.75;         // phone: the three panels side by side, each tall and narrow
      miniW = Math.max(miniW, m.w); miniH = Math.max(miniH, m.h);
    }
    miniR.setSize(miniW, miniH, false);
    miniR.setScissorTest(true);
  }
  const TALL_A = 0.6;   // how wide a frame the hand needs, as width over height
  function drawMinis(now) {
    runJobs();
    for (const m of minis) {
      if (!m.visible || !m.frames) continue;
      if (!m.fig.classList.contains("ready")) { m.fig.classList.add("ready"); m.t0 = now; }
      const u = m.hold != null ? m.hold : FT.reduced ? (m.still || 0.5) : ((now - m.t0) / 1000 / (m.S || MINI_S)) % 1, f = u * MINI_N, i = Math.floor(f) % MINI_N, j = (i + 1) % MINI_N;
      m.draw(i, j, f - Math.floor(f));
      const v = m.view, a = v.az + (FT.reduced ? 0 : 0.12 * Math.sin(now / 4000)), sh = m.shift ? m.shift() : 0, dist = v.dist * (1 + 0.12 * sh) * (m.narrowFit ? Math.max(1, 1.85 / (m.w / m.h)) : 1);
      if (m.tall) {                                 // a tall panel: the hand in its upper part, the lens below it
        const fh = m.h * (1 + 0.45 * sh), d2 = v.dist * Math.max(1, TALL_A / (m.w / fh));
        m.cam.position.set(m.ctr.x + d2 * Math.cos(v.el) * Math.sin(a), m.ctr.y + d2 * Math.sin(v.el), m.ctr.z + d2 * Math.cos(v.el) * Math.cos(a));
        m.cam.aspect = m.w / fh; m.cam.setViewOffset(m.w, fh, 0, fh - m.h, m.w, m.h);
      } else m.cam.position.set(m.ctr.x + dist * Math.cos(v.el) * Math.sin(a), m.ctr.y + dist * Math.sin(v.el), m.ctr.z + dist * Math.cos(v.el) * Math.cos(a));
      if (m.tall) {} else if (sh > 0.001) { m.cam.aspect = m.w * (1 + 0.5 * sh) / m.h; m.cam.setViewOffset(m.w * (1 + 0.5 * sh), m.h, m.w * 0.5 * sh, 0, m.w, m.h); }
      else if (m.cam.view && m.cam.view.enabled) { m.cam.clearViewOffset(); m.cam.aspect = m.w / m.h; m.cam.updateProjectionMatrix(); }
      m.cam.lookAt(m.ctr);
      miniR.setViewport(0, 0, m.w, m.h); miniR.setScissor(0, 0, m.w, m.h);
      miniR.clear();
      miniR.render(m.scene, m.cam);
      m.ctx.clearRect(0, 0, m.w, m.h);
      m.ctx.drawImage(miniR.domElement, 0, miniH - m.h, m.w, m.h, 0, 0, m.w, m.h);
      if (m.after) m.after(now);
    }
  }

  window.FTHandsOn = { view: (a, e, k) => { az = a; el = e; if (k) { zoom = k; resize(); } }, center, state: () => ({ gs: gs.slice(), cube: b.toArray(), mode, q: state && Array.from(state.q), fade: ik[mode] && Array.from(ik[mode].fade || []) }),
                       set: (g, cubeXYZ, m) => { if (g) g.forEach((x, f) => { gs[f] = gsTarget[f] = x; }); if (cubeXYZ) b.fromArray(cubeXYZ); if (m) mode = m; dirty = 99; } };
})();

/* The physical search, illustrated: a receding-horizon cross-entropy method. Candidate corrections (smooth splines
   through knots) fan out over a 1 s window; the best eighth refits the distribution; after a few iterations only the
   first 0.15 s is committed and the window slides on. The correction it is looking for is made up for the picture. */
(function () {
  const canvas = document.getElementById("hoCem");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const N = 64, ELITE = 8, KNOTS = 11, H = 1.0, COMMIT = 0.15, ITERS = 6, STEP_S = 0.32, SPAN = 3.2;   // seconds shown
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const want = t => 0.55 * Math.sin(1.25 * t + 0.4) + 0.25 * Math.sin(3.1 * t + 1.0);            // the correction needed
  let t0 = 0, mean = new Float64Array(KNOTS), sd = new Float64Array(KNOTS).fill(0.45), it = 0, cands = [], elite = [], done = [], clock = 0, visible = true;
  const rnd = () => { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  function sample() {
    cands = [];
    for (let c = 0; c < N; c++) {
      // smooth noise across knots (a random walk, then smoothed), like the method's 1/f^2 noise
      const z = new Float64Array(KNOTS); let acc = 0;
      for (let k = 0; k < KNOTS; k++) { acc = 0.6 * acc + rnd(); z[k] = acc * 0.6; }
      const k0 = Array.from(z, (x, k) => mean[k] + sd[k] * x);
      k0[0] = mean[0];                                   // the window starts where the last one ended
      let cost = 0;
      for (let k = 0; k < KNOTS; k++) { const e = k0[k] - want(t0 + k * H / (KNOTS - 1)); cost += e * e * (0.5 + k / KNOTS); }
      cands.push({ k: k0, cost });
    }
    cands.sort((a, b) => a.cost - b.cost);
    elite = cands.slice(0, ELITE);
  }
  function refit() {
    for (let k = 0; k < KNOTS; k++) {
      let m = 0; for (const e of elite) m += e.k[k]; m /= ELITE;
      let v = 0; for (const e of elite) v += (e.k[k] - m) ** 2; v /= ELITE;
      mean[k] = m; sd[k] = Math.max(0.03, Math.sqrt(v));
    }
  }
  function commit() {
    const best = cands[0].k, steps = Math.round(COMMIT / (H / (KNOTS - 1)) * 2);
    for (let s = 0; s <= steps; s++) done.push([t0 + s * COMMIT / steps, at(best, s * COMMIT / steps)]);
    t0 += COMMIT;
    // shift the mean by the committed part, keep the tail; reset the spread
    const shifted = new Float64Array(KNOTS);
    for (let k = 0; k < KNOTS; k++) shifted[k] = at(mean, k * H / (KNOTS - 1) + COMMIT);
    mean = shifted; sd.fill(0.45); it = 0;
    if (t0 > 9) { t0 = 0; mean.fill(0); done = []; }
  }
  const at = (k, s) => {                                 // Catmull-Rom through the knots, s in [0, H]
    const f = Math.max(0, Math.min(KNOTS - 1.0001, s / H * (KNOTS - 1))), i = Math.floor(f), u = f - i;
    const p0 = k[Math.max(0, i - 1)], p1 = k[i], p2 = k[i + 1], p3 = k[Math.min(KNOTS - 1, i + 2)];
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw() {
    const r = canvas.getBoundingClientRect(), W = r.width, Hh = r.height;
    ctx.clearRect(0, 0, W, Hh);
    const left = Math.max(0, t0 - 1.2), X = t => 8 + (t - left) / SPAN * (W - 16), Y = v => Hh * 0.5 - v * Hh * 0.36;
    // the window
    ctx.fillStyle = "rgba(62,168,229,0.07)";
    ctx.fillRect(X(t0), 8, X(t0 + H) - X(t0), Hh - 34);
    ctx.fillStyle = "rgba(34,179,122,0.12)";
    ctx.fillRect(X(t0), 8, X(t0 + COMMIT) - X(t0), Hh - 34);
    // the plan (no correction)
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(8, Y(0)); ctx.lineTo(W - 8, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    const curve = (k, style, w) => {
      ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath();
      for (let s = 0; s <= 40; s++) { const tt = s / 40 * H; s ? ctx.lineTo(X(t0 + tt), Y(at(k, tt))) : ctx.moveTo(X(t0 + tt), Y(at(k, tt))); }
      ctx.stroke();
    };
    for (const c of cands.slice(ELITE)) curve(c.k, "rgba(133,146,166,0.28)", 1);
    for (const c of elite) curve(c.k, "rgba(62,168,229,0.85)", 1.4);
    // committed so far
    ctx.strokeStyle = "#22b37a"; ctx.lineWidth = 3; ctx.beginPath();
    done.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
    ctx.stroke();
    // labels
    ctx.fillStyle = "#6e6e73"; ctx.font = "11.5px -apple-system, Inter, sans-serif";
    ctx.fillText(`window 1 s · iteration ${Math.min(it + 1, ITERS)} of ${ITERS}`, X(t0) + 6, Hh - 12);
    ctx.textAlign = "right"; ctx.fillText("correction to the plan", W - 10, 20); ctx.textAlign = "left";
  }
  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible || document.hidden) return;
    if (now - clock < STEP_S * 1000) return;
    clock = now;
    if (it < ITERS) { sample(); refit(); it++; } else commit();
    draw();
  }
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { rootMargin: "40px" }).observe(canvas);
  window.addEventListener("resize", () => { resize(); draw(); });
  resize();
  sample();
  draw();
  if (!reduced) requestAnimationFrame(tick);
})();
