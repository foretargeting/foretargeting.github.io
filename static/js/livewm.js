/* Live world-model demo: the visitor drives a hand (the pointer, or their own hand through the webcam), the pose world
   model (interaction_surface) moves a held-out object, and our retargeter puts Wuji Hand 2.2 on that motion, all in the
   browser. The object is never simulated: every pose is the model's own prediction, fed back as its history --
   our run_live_teleop.py without the glasses, with foretargeting's last step after it.

   Data (static/live/, tools/export_live.py, tools/export_wuji.py): wm_step.onnx, one model step in world units
   (history (3,4,4), left/right landmarks (6,21,3) = 3 observed + 3 future frames 0.1 s apart, object points (512,3),
   noise (3,9) -> the next 3 poses); live.json/.bin, the hands (9 grasp closures of a reached hand from a training demo,
   stored around the grasp point) and the held-out objects; wuji.json/.bin, Wuji Hand 2.2 and the objects' normals.

   Hands: the model always gets the MANO hand, the kind it was trained on. In Wuji mode every committed frame is
   retargeted onto Wuji Hand 2.2 (wujiik.js, a per-frame port of humanik) with the object where the model put it; the
   Wuji hand is drawn and the MANO hand faintly. The visitor drives the left or the right hand; the other one stays
   parked. The right grasp is the left one mirrored through x = 0, and the parked left hand the parked right one
   mirrored: the model's own mirror augmentation (our code mirror_batch reflects a training window through the
   desk's x = 0 plane and swaps the hands, for half of the windows), so it was trained on both.

   Fingers: the pointer and the camera (a closed hand) close all five together along the closures. ctl.gs also takes one
   closure per finger (scripted checks): each finger's closure is re-seated on the palm of the mean closure.

   Clock: one hand sample every 0.1 s (the model's frame), one model step per sample, the first predicted pose
   committed. A window ends at the newest sample, so the committed pose is 0.2 s behind the cursor; the solid hand is
   drawn at that same moment, a faint one at the cursor. A device too slow for 10 Hz just runs the world slower: a
   sample is only taken once the previous step is done. */
(function () {
  const root = document.getElementById("liveDemo");
  if (!root || !window.THREE || !window.Clay) return;
  const T = THREE, C = Clay, IK = window.WujiIK;
  const canvas = root.querySelector("canvas");
  const gate = root.querySelector(".live-gate"), startBtn = root.querySelector("[data-live-start]");
  const progress = root.querySelector(".live-progress"), hud = root.querySelector(".live-hud");
  const objBar = root.querySelector("[data-live-objects]"), resetBtn = root.querySelector("[data-live-reset]");
  const sideBar = root.querySelector("[data-live-side]"), robotBar = root.querySelector("[data-live-robot]");
  const camBtn = root.querySelector("[data-live-camera]"), camBox = root.querySelector(".live-cam");
  const pad = root.querySelector(".live-pad"), pauseBtn = root.querySelector("[data-live-pause]");
  const ORT_VER = "1.20.1", ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
  const COLORS = { rubber_duck: 0xe0b23a, nail_clipper: 0x55595f, "aria-network": 0xbfc3c9, "aria-toothpaste": 0xe6ecf2 };
  const WUJI_COLORS = { matte_black: 0x3c3e43, metal_silver: 0xc9ccd1, sensor_pad: 0x2c2d31 };
  const PALM = [0, 1, 5, 9, 13, 17], FINGER = [[2, 3, 4], [6, 7, 8], [10, 11, 12], [14, 15, 16], [18, 19, 20]];

  let info, A, session = null, running = false, paused = false, busy = false;
  let wuji = null, mode = "human", parkedW = null;    // the human (MANO) hand first; wuji: Wuji Hand 2.2 (hands, retargeters, meshes), when it loaded
  const active = () => running && !paused;            // paused: the world stands still and the page gets its wheel back
  let renderer, scene, camera, rootG, objMesh, hand, ghost, parked, cursorDot, cursorRing, cursorLine, skin, faint;
  let obj = null, points = null, normals = null, spacing = 0, rest = null;
  // per side: the driven hand's closures (joints 21*3, verts 778*3, around the grasp point), its faces,
  // the parked other hand (world) and where the driven hand starts
  const SIDES = {};
  let side = null, K, partW = null;
  // the hand the visitor drives: grasp point c (eased toward height h), closure g (eased toward gTarget) or one per
  // finger (gs), yaw, and with the camera a tilt (the rest of the wrist's turn, applied before the yaw)
  const ctl = { c: new T.Vector3(), h: 0.85, g: 0, gTarget: 0, gs: [0, 0, 0, 0, 0], yaw: 0, roll: 0, tilt: new T.Quaternion() };
  // two: the camera sees both hands, and the other hand is driven too (ctlO) instead of staying parked
  let two = false;
  const ctlO = { c: new T.Vector3(), h: 0.85, g: 0, gTarget: 0, gs: [0, 0, 0, 0, 0], yaw: 0, tilt: new T.Quaternion() };
  const zAxis = new T.Vector3(0, 0, 1), rollAx = new T.Vector3();
  const turnQ = (yaw = ctl.yaw, tilt = ctl.tilt) => new T.Quaternion().setFromAxisAngle(zAxis, yaw).multiply(tilt);
  let samples = [], committed = [], stepMs = [], nSteps = 0, lastSample = 0, message = "", messageUntil = 0, pauseNote = "";
  let epoch = 0;                                      // bumped by every reset, so a step still in flight is dropped
  let shown = null, prevShown = null, shownAt = 0;    // display interpolation between committed states

  // ---------------------------------------------------------------- data
  const near = new IntersectionObserver(es => { if (es[0].isIntersecting) { near.disconnect(); loadScene(); } }, { rootMargin: "300px" });
  near.observe(root);

  function loadScene() {
    const get = (url, kind) => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r[kind](); });
    Promise.all([get("static/live/live.json?v=202611202225", "json"), get("static/live/live.bin?v=202611202225", "arrayBuffer")])
      .then(([meta, buf]) => {
        info = meta; A = name => C.arr(buf, meta.layout[name]);
        // without the robot hand the demo still runs, with the human hand only
        return Promise.all([get("static/live/wuji.json?v=202611202225", "json"), get("static/live/wuji.bin?v=202611202225", "arrayBuffer")])
          .then(([m, b]) => { if (IK) wuji = { info: m, arr: name => C.arr(b, m.layout[name]) }; })
          .catch(e => console.warn(e));
      })
      .then(build)
      .catch(e => { console.error(e); root.classList.add("no-gl"); });
  }

  // ---------------------------------------------------------------- scene
  function build() {
    try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { root.classList.add("no-gl"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(30, 1, 0.02, 10);
    rootG = new T.Group();
    rootG.rotation.x = -Math.PI / 2;                      // data is z up
    scene.add(rootG);
    scene.add(new T.HemisphereLight(0xffffff, 0xb9ad9c, 0.5));
    const key = new T.DirectionalLight(0xffffff, 0.72);
    key.position.set(-0.3, 2.2, 0.8);
    key.target.position.set(0, 0.75, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0005;
    Object.assign(key.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.5, far: 4 });
    scene.add(key, key.target);
    const rim = new T.DirectionalLight(0xfff1df, 0.3);
    rim.position.set(1, 1.2, -1);
    scene.add(rim);

    const d = info.desk;
    const desk = new T.Mesh(new T.BoxGeometry(d.half[0] * 2, d.half[1] * 2, 0.04), C.clay(new T.Color(0xd4d2ce).convertSRGBToLinear(), { transparent: false, roughness: 0.9 }));
    desk.position.set(d.center[0], d.center[1], d.top - 0.02);
    desk.receiveShadow = true;
    rootG.add(desk);

    K = info.hands.closures.length;
    const mirror = a => { const o = new Float32Array(a); for (let i = 0; i < o.length; i += 3) o[i] = -o[i]; return o; };
    const flip = f => { const o = new Uint32Array(f); for (let i = 0; i < o.length; i += 3) { const t = o[i + 1]; o[i + 1] = o[i + 2]; o[i + 2] = t; } return o; };
    const closures = (j, v) => Array.from({ length: K }, (_, k) => ({ J: j.subarray(k * 63, (k + 1) * 63), V: v.subarray(k * 778 * 3, (k + 1) * 778 * 3) }));
    const six = j => { const o = new Float32Array(6 * 63); for (let t = 0; t < 6; t++) o.set(j, t * 63); return o; };
    const lj = new Float32Array(A("left_joints")), lv = new Float32Array(A("left_verts")), rj = new Float32Array(A("right_joints")), rv = new Float32Array(A("right_verts"));
    const st = info.hands.start;
    SIDES.left = { name: "left", other: "right", keys: closures(lj, lv), faces: A("left_faces"), parkedV: rv, parkedFaces: A("right_faces"), parkedL: rj, parked6: six(rj), start: st };
    const mrj = mirror(rj);                               // a mirrored hand has its triangles wound the other way
    SIDES.right = { name: "right", other: "left", keys: closures(mirror(lj), mirror(lv)), faces: flip(A("left_faces")), parkedV: mirror(rv), parkedFaces: flip(A("right_faces")), parkedL: mrj, parked6: six(mrj), start: [-st[0], st[1], st[2]] };
    partW = fingerWeights(SIDES.left.keys[0]);           // mirroring keeps every vertex's place on the hand
    const J0 = SIDES.left.keys[0].J, gap = (i, j) => Math.hypot(J0[i * 3] - J0[j * 3], J0[i * 3 + 1] - J0[j * 3 + 1], J0[i * 3 + 2] - J0[j * 3 + 2]);
    camRuler = [[5, 17], [0, 9], [0, 5], [0, 17], [5, 13], [1, 17]].map(([a, b]) => [a, b, gap(a, b)]);   // the camera's rulers: the demo hand's palm spans (m)
    skin = C.clay(0xd9ac8f, { transparent: false });
    faint = new T.MeshStandardMaterial({ color: 0xd9ac8f, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.7 });
    hand = new T.Mesh(new T.BufferGeometry(), skin);
    ghost = new T.Mesh(new T.BufferGeometry(), new T.MeshStandardMaterial({ color: 0xd9ac8f, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.7 }));
    parked = new T.Mesh(new T.BufferGeometry(), skin);
    hand.castShadow = parked.castShadow = true;
    rootG.add(hand, ghost, parked);
    if (wuji) buildWuji();

    cursorRing = new T.Mesh(new T.RingGeometry(0.012, 0.016, 32), new T.MeshBasicMaterial({ color: 0x3ea8e5, transparent: true, opacity: 0.8, depthWrite: false }));
    cursorDot = new T.Mesh(new T.SphereGeometry(0.005, 12, 8), new T.MeshBasicMaterial({ color: 0x3ea8e5 }));
    cursorLine = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineDashedMaterial({ color: 0x3ea8e5, dashSize: 0.008, gapSize: 0.006, transparent: true, opacity: 0.7 }));
    rootG.add(cursorRing, cursorDot, cursorLine);

    // object picker
    objBar.innerHTML = info.objects.map((o, i) => `<button type="button" data-i="${i}"${i ? "" : ' class="on"'}>${o.label}<small>${o.kind}</small></button>`).join("");
    objBar.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      objBar.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      setObject(+b.dataset.i);
      if (running) canvas.focus({ preventScroll: true });
    }));
    sideBar.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.side === side.name) return;
      if (running && !camOn) swapHands(); else setSide(b.dataset.side);   // running: the hand you leave stays where it is
      if (running) canvas.focus({ preventScroll: true });
    }));
    robotBar.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      setMode(b.dataset.robot);
      if (running) canvas.focus({ preventScroll: true });
    }));
    if (!wuji) { mode = "human"; robotBar.hidden = true; }
    setSide("left");
    setObject(0);
    setMode(mode);
    bindInput();
    window.addEventListener("resize", resize);
    resize();
    root.classList.add("ready");
    requestAnimationFrame(frame);
  }

  function buildWuji() {
    const mats = {};
    for (const [k, v] of Object.entries(WUJI_COLORS)) mats[k] = C.clay(v, { transparent: false, roughness: 0.5 });
    wuji.hand = {}; wuji.ik = {}; wuji.group = {}; wuji.neutral = {};
    for (const name of ["left", "right"]) {
      const d = wuji.info.sides[name], h = new IK.Hand(d, name, wuji.arr), g = new T.Group();
      g.visible = false;
      g.meshes = d.parts.map(p => {
        const m = new T.Mesh(C.geometry(new Float32Array(wuji.arr(p.key + "_verts")), wuji.arr(p.key + "_faces")), mats[p.material] || mats.metal_silver);
        m.matrixAutoUpdate = false;
        m.castShadow = true;
        m.userData.body = p.body;
        g.add(m);
        return m;
      });
      rootG.add(g);
      wuji.hand[name] = h;
      wuji.ik[name] = new IK.Retargeter(h);
      wuji.group[name] = g;
    }
    // the human frame each side's palm calibration was fitted in: the open left hand as stored, mirrored for the right
    wuji.neutral.left = palmOf(SIDES.left.keys[0].J);
    wuji.neutral.right = palmOf(SIDES.right.keys[0].J);
  }

  function setObject(i) {
    const o = info.objects[i];
    if (objMesh) { rootG.remove(objMesh); objMesh.geometry.dispose(); }
    objMesh = new T.Mesh(C.geometry(new Float32Array(A(o.name + "_verts")), A(o.name + "_faces")), C.clay(COLORS[o.name] || 0xd8d2c8, { transparent: false }));
    objMesh.castShadow = objMesh.receiveShadow = true;
    rootG.add(objMesh);
    obj = o;
    points = new Float32Array(A(o.name + "_points"));
    normals = wuji ? new Float32Array(wuji.arr(o.name + "_normals")) : null;
    spacing = medianSpacing(points);
    rest = new Float32Array(o.rest.flat());
    reset();
  }

  // switch the driven hand: new meshes, the hand back at its start, open, the object back at rest
  function setSide(name) {
    two = false; camO = newTrack();
    side = SIDES[name];
    for (const m of [hand, ghost, parked]) m.geometry.dispose();
    hand.geometry = C.geometry(new Float32Array(778 * 3), side.faces, false);
    ghost.geometry = hand.geometry.clone();
    parked.geometry = C.geometry(side.parkedV.slice(), side.parkedFaces);
    ctl.c.set(side.start[0], side.start[1], side.start[2]);
    ctl.h = side.start[2];
    ctl.yaw = ctl.roll = ctl.g = ctl.gTarget = 0;
    ctl.tilt.identity();
    ctl.gs.fill(0);
    pad.querySelector("[data-toggle=grasp]").classList.remove("on");
    sideBar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.side === name));
    parkedLook();
    camCal = null; camHold = []; camBends = []; camClosed = false;   // the start moved: calibrate the camera again
    if (rest) reset(running ? `Now driving the ${name} hand` : "");
  }

  // switch the driven hand and keep the one just driven where it is, holding what it holds (two hands from the keyboard):
  // the other hand picks up where it was left (or from its start), the object goes on from where it is
  function swapHands() {
    const was = { c: ctl.c.clone(), h: ctl.h, g: ctl.g, gTarget: ctl.gTarget, gs: ctl.gs.slice(), yaw: ctl.yaw, roll: ctl.roll, tilt: ctl.tilt.clone() };
    const next = SIDES[side.other];
    if (two) {
      ctl.c.copy(ctlO.c); ctl.h = ctlO.h; ctl.g = ctlO.g; ctl.gTarget = ctlO.gTarget; ctl.gs = ctlO.gs.slice();
      ctl.yaw = ctlO.yaw; ctl.roll = ctlO.roll || 0; ctl.tilt.copy(ctlO.tilt);
    } else {
      ctl.c.set(next.start[0], next.start[1], next.start[2]); ctl.h = next.start[2];
      ctl.yaw = ctl.roll = ctl.g = ctl.gTarget = 0; ctl.tilt.identity(); ctl.gs.fill(0);
    }
    ctlO.c.copy(was.c); ctlO.h = was.h; ctlO.g = was.g; ctlO.gTarget = was.gTarget; ctlO.gs = was.gs;
    ctlO.yaw = was.yaw; ctlO.roll = was.roll; ctlO.tilt.copy(was.tilt);
    side = next; two = true;
    for (const m of [hand, ghost, parked]) m.geometry.dispose();
    hand.geometry = C.geometry(new Float32Array(778 * 3), side.faces, false);
    ghost.geometry = hand.geometry.clone();
    parked.geometry = C.geometry(new Float32Array(778 * 3), SIDES[side.other].faces, false);
    pad.querySelector("[data-toggle=grasp]").classList.toggle("on", ctl.gTarget > 0.5);
    sideBar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.side === side.name));
    parkedLook();
    // the hands' history starts over where they are now; the object's does not
    epoch++;
    const q = turnQ(), L = handLandmarks(ctl.c, ctl.gs, q), O = otherSample(), pose = committed[committed.length - 1];
    samples = Array.from({ length: 6 }, () => ({ L, c: ctl.c.clone(), gs: ctl.gs.slice(), q, O }));
    shown = prevShown = { pose, s: samples[5], w: retarget(samples[5], pose, true), wO: retarget(O, pose, true, side.other) };
    shownAt = performance.now();
    flash(`The ${side.other} hand stays put. Now driving the ${side.name} hand`);
  }

  // the hand drawn: Wuji Hand 2.2 retargeted from the MANO hand, or the MANO hand itself
  function setMode(m) {
    if (m === "wuji" && !wuji) return;
    mode = m;
    robotBar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.robot === m));
    hand.material = m === "wuji" ? faint : skin;
    hand.castShadow = m !== "wuji";
    parkedLook();
    if (shown) {
      prevShown.w = shown.w = retarget(shown.s, shown.pose, true);
      prevShown.wO = shown.wO = two ? retarget(shown.s.O, shown.pose, true, side.other) : null;
      retargetParked();
    }
  }
  // the other hand: parked (hidden behind the parked Wuji hand in Wuji mode), or with two hands driven like the first
  function parkedLook() {
    parked.visible = mode !== "wuji" || two;
    parked.material = two && mode === "wuji" ? faint : skin;
    parked.castShadow = !(two && mode === "wuji");
  }
  // the camera found the other hand (on), or the session ended (off): the other hand's mesh, start and look
  function setTwo(on) {
    if (two === on) return;
    two = on;
    const o = SIDES[side.other];
    parked.geometry.dispose();
    if (on) {
      parked.geometry = C.geometry(new Float32Array(778 * 3), o.faces, false);
      ctlO.c.set(o.start[0], o.start[1], o.start[2]);
      ctlO.h = o.start[2];
      ctlO.yaw = ctlO.g = ctlO.gTarget = 0;
      ctlO.tilt.identity();
      ctlO.gs.fill(0);
    } else parked.geometry = C.geometry(side.parkedV.slice(), side.parkedFaces);
    camO = newTrack();
    parkedLook();
    reset(on ? "Both hands: your other hand drives the other hand" : "");
  }
  function otherSample() {
    const q = turnQ(ctlO.yaw, ctlO.tilt);
    return { L: handLandmarks(ctlO.c, ctlO.gs, q, SIDES[side.other]), c: ctlO.c.clone(), gs: ctlO.gs.slice(), q };
  }

  function reset(note) {
    epoch++;
    committed = [rest, rest, rest];
    const q = turnQ(), L = handLandmarks(ctl.c, ctl.gs, q), O = two ? otherSample() : null;
    samples = Array.from({ length: 6 }, () => ({ L, c: ctl.c.clone(), gs: ctl.gs.slice(), q, O }));
    shown = prevShown = { pose: rest, s: samples[5], w: retarget(samples[5], rest, true), wO: two ? retarget(O, rest, true, side.other) : null };
    shownAt = performance.now();
    retargetParked();
    if (note) flash(note);
  }

  function flash(text, ms) { message = text; messageUntil = performance.now() + (ms || 2600); }

  // ---------------------------------------------------------------- the MANO hand
  function closure(g) {
    const f = Math.max(0, Math.min(1, g)) * (K - 1), i = Math.min(Math.floor(f), K - 2);
    return [i, f - i];
  }
  function lerpKeys(field, g, out, sd = side) {
    const [i, s] = closure(g), a = sd.keys[i][field], b = sd.keys[i + 1][field];
    for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * s;
    return out;
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const together = gs => gs.every(g => Math.abs(g - gs[0]) < 1e-4);
  const palmOf = J => Float64Array.from(PALM.flatMap(i => [J[i * 3], J[i * 3 + 1], J[i * 3 + 2]]));
  const jl = new Float32Array(63), jf = new Float32Array(63), vl = new Float32Array(778 * 3), seatR = new Float64Array(9), seatT = new Float64Array(3);
  // finger f's closure g_f re-seated on the palm of the mean closure (the palm is rigid over the closures)
  function seat(gf, sd = side) {
    lerpKeys("J", gf, jf, sd);
    IK.kabsch(palmOf(jf), palmOf(jl), 6, seatR, seatT);
  }
  const apply = (R, t, x, y, z, o, i) => {
    o[i] = R[0] * x + R[1] * y + R[2] * z + t[0]; o[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1]; o[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  };
  // hand-frame landmarks for per-finger closures gs
  function localLandmarks(gs, out, sd = side) {
    const gp = mean(gs);
    lerpKeys("J", gp, jl, sd);
    out.set(jl);
    if (!together(gs)) for (let f = 0; f < 5; f++) {
      if (Math.abs(gs[f] - gp) < 1e-4) continue;
      seat(gs[f], sd);
      for (const i of FINGER[f]) apply(seatR, seatT, jf[i * 3], jf[i * 3 + 1], jf[i * 3 + 2], out, i * 3);
    }
    return out;
  }
  // landmarks (world) of the driven hand: R(q) * hand frame + c, q its turn about the grasp point
  const turnM = new T.Matrix4();
  function turned(q, c, a, out, n) {
    const e = turnM.makeRotationFromQuaternion(q).elements;
    for (let p = 0; p < n; p++) {
      const x = a[p * 3], y = a[p * 3 + 1], z = a[p * 3 + 2];
      out[p * 3] = e[0] * x + e[4] * y + e[8] * z + c.x; out[p * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + c.y; out[p * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + c.z;
    }
    return out;
  }
  function handLandmarks(c, gs, q, sd = side) {
    return turned(q, c, localLandmarks(gs, new Float32Array(63), sd), new Float32Array(63), 21);
  }
  function placeHand(mesh, c, gs, q, sd = side) {
    const gp = mean(gs), pos = mesh.geometry.attributes.position.array;
    lerpKeys("V", gp, vl, sd);
    if (!together(gs)) {
      lerpKeys("J", gp, jl, sd);
      for (let f = 0; f < 5; f++) {
        if (Math.abs(gs[f] - gp) < 1e-4) continue;
        seat(gs[f], sd);
        const [k, u] = closure(gs[f]), A0 = sd.keys[k].V, B0 = sd.keys[k + 1].V, { idx, w } = partW[f], o = [0, 0, 0];
        for (let n = 0; n < idx.length; n++) {
          const v = idx[n] * 3;
          apply(seatR, seatT, A0[v] + (B0[v] - A0[v]) * u, A0[v + 1] + (B0[v + 1] - A0[v + 1]) * u, A0[v + 2] + (B0[v + 2] - A0[v + 2]) * u, o, 0);
          vl[v] += w[n] * (o[0] - vl[v]); vl[v + 1] += w[n] * (o[1] - vl[v + 1]); vl[v + 2] += w[n] * (o[2] - vl[v + 2]);
        }
      }
    }
    turned(q, c, vl, pos, 778);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
  // how much each vertex moves with each finger (0..1; the palm keeps the rest), from the open hand: past the finger's
  // root along its first bone, and nearer that finger's bones than the others'
  function fingerWeights(k) {
    const J = k.J, V = k.V, nv = V.length / 3, roots = [1, 5, 9, 13, 17], start = [0.012, 0, 0, 0, 0], sigma = 0.009;
    const seg = (x, y, z, a, b) => {
      const ax = J[a * 3], ay = J[a * 3 + 1], az = J[a * 3 + 2], dx = J[b * 3] - ax, dy = J[b * 3 + 1] - ay, dz = J[b * 3 + 2] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz)));
      return Math.hypot(x - ax - t * dx, y - ay - t * dy, z - az - t * dz);
    };
    const lists = Array.from({ length: 5 }, () => ({ idx: [], w: [] }));
    for (let v = 0; v < nv; v++) {
      const x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2], e = [], s = [];
      for (let f = 0; f < 5; f++) {
        const r = roots[f];
        e.push(Math.exp(-(Math.min(seg(x, y, z, r, r + 1), seg(x, y, z, r + 1, r + 2), seg(x, y, z, r + 2, r + 3)) ** 2) / (2 * sigma * sigma)));
        const dx = J[(r + 1) * 3] - J[r * 3], dy = J[(r + 1) * 3 + 1] - J[r * 3 + 1], dz = J[(r + 1) * 3 + 2] - J[r * 3 + 2], len = Math.hypot(dx, dy, dz);
        const t = ((x - J[r * 3]) * dx + (y - J[r * 3 + 1]) * dy + (z - J[r * 3 + 2]) * dz) / len;
        s.push(1 / (1 + Math.exp(-(t - start[f]) / 0.005)));
      }
      const sum = e.reduce((a, b) => a + b, 0) || 1e-12;
      for (let f = 0; f < 5; f++) {
        const w = s[f] * e[f] / sum;
        if (w > 1e-3) { lists[f].idx.push(v); lists[f].w.push(w); }
      }
    }
    return lists.map(l => ({ idx: Int32Array.from(l.idx), w: Float32Array.from(l.w) }));
  }

  // ---------------------------------------------------------------- the Wuji hand
  // the human hand frame of a landmark set: its palm fitted onto the calibration's open hand
  function wristFrame(name, L) {
    const R = new Float64Array(9), p = new Float64Array(3);
    IK.kabsch(wuji.neutral[name], palmOf(L), 6, R, p);
    return { R, p };
  }
  function objectWorld(pose) {
    const n = points.length / 3, P = new Float64Array(n * 3), Nw = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2], a = normals[i * 3], b = normals[i * 3 + 1], c = normals[i * 3 + 2];
      for (let r = 0; r < 3; r++) {
        P[i * 3 + r] = pose[r * 4] * x + pose[r * 4 + 1] * y + pose[r * 4 + 2] * z + pose[r * 4 + 3];
        Nw[i * 3 + r] = pose[r * 4] * a + pose[r * 4 + 1] * b + pose[r * 4 + 2] * c;
      }
    }
    return { points: P, normals: Nw, spacing };
  }
  // the median distance from an object point to its nearest neighbour (the retargeter's surface bandwidth)
  function medianSpacing(P) {
    const n = P.length / 3, d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2], q = dx * dx + dy * dy + dz * dz;
        if (q < best) best = q;
      }
      d[i] = Math.sqrt(best);
    }
    return d.sort()[n >> 1];
  }
  // one committed frame of the driven hand onto Wuji (fresh: no history, after a reset)
  function retarget(s, pose, fresh, name = side.name) {
    if (!wuji || mode !== "wuji" || !s) return null;
    const ik = wuji.ik[name];
    if (fresh) ik.reset();
    try { return ik.solve({ L: s.L, wrist: wristFrame(name, s.L), object: objectWorld(pose), desk: info.desk.top }); }
    catch (e) { console.error(e); return null; }
  }
  function retargetParked() {
    parkedW = null;
    if (!wuji || mode !== "wuji") return;
    const ik = wuji.ik[side.other];
    ik.reset();
    parkedW = ik.solve({ L: side.parkedL, wrist: wristFrame(side.other, side.parkedL), object: objectWorld(rest), desk: info.desk.top });
    ik.reset();
  }
  const m4 = new T.Matrix4(), qA = new T.Quaternion(), qB = new T.Quaternion();
  function quatOf(R, q) { m4.set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1); return q.setFromRotationMatrix(m4); }
  function placeWuji(name, a, b, s) {
    const h = wuji.hand[name], g = wuji.group[name];
    let R = b.R, p = b.p, q = b.q;
    if (a && a !== b && s < 1) {
      quatOf(a.R, qA).slerp(quatOf(b.R, qB), s);
      R = IK.quatMat([qA.w, qA.x, qA.y, qA.z], new Float64Array(9));
      p = a.p.map((x, i) => x + (b.p[i] - x) * s);
      q = a.q.map((x, i) => x + (b.q[i] - x) * s);
    }
    h.fk(R, p, q);
    for (const m of g.meshes) {
      const k = m.userData.body, r = h.R, P = h.P;
      m.matrix.set(r[k * 9], r[k * 9 + 1], r[k * 9 + 2], P[k * 3], r[k * 9 + 3], r[k * 9 + 4], r[k * 9 + 5], P[k * 3 + 1],
        r[k * 9 + 6], r[k * 9 + 7], r[k * 9 + 8], P[k * 3 + 2], 0, 0, 0, 1);
      m.matrixWorldNeedsUpdate = true;
    }
  }

  /* The visitor's hand never goes into the object (the pointer or the camera could put it inside the box, and the
     Wuji hand followed it in): before a frame is sampled, the grasp point is moved out along the object's outward
     normal until the palm's joints keep 10 mm and the fingers' 6 mm from its surface (the joints sit inside the skin,
     so the skin just touches): the sum of depth x normal over the joints inside, capped at the deepest depth, never
     down, at most four passes. While the hand holds the lifted object it is left as
     it is: the object follows the hand there, a step behind. */
  const PALM_J = new Set([0, 1, 5, 9, 13, 17]);
  let kept = null, keptPose = null;
  function keepOut(k, sd) {
    const pose = committed[committed.length - 1];
    if (!pose || !points || !normals) return;
    if (mean(k.gs) > 0.5 && pose[11] - rest[11] > 0.01) return;
    if (keptPose !== pose) { kept = objectWorld(pose); kept.h2 = (1.5 * spacing) ** 2; keptPose = pose; }
    const P = kept.points, Nn = kept.normals, n = P.length / 3, h2 = kept.h2, q = turnQ(k.yaw, k.tilt);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy, P[i * 3 + 2] - cz));
    for (let it = 0; it < 4; it++) {
      const L = handLandmarks(k.c, k.gs, q, sd);
      let m = 0, dx = 0, dy = 0, dz = 0;
      for (let j = 0; j < 21; j++) {
        const x = L[j * 3], y = L[j * 3 + 1], z = L[j * 3 + 2];
        if (Math.hypot(x - cx, y - cy, z - cz) > r + 0.02) continue;
        let ws = 0, d = 0, nx = 0, ny = 0, nz = 0, best = Infinity, bi = 0;
        for (let i = 0; i < n; i++) {
          const ex = x - P[i * 3], ey = y - P[i * 3 + 1], ez = z - P[i * 3 + 2], qq = ex * ex + ey * ey + ez * ez;
          if (qq < best) { best = qq; bi = i; }
          if (qq < 9 * h2) { const w = Math.exp(-qq / h2); ws += w; d += w * (ex * Nn[i * 3] + ey * Nn[i * 3 + 1] + ez * Nn[i * 3 + 2]); nx += w * Nn[i * 3]; ny += w * Nn[i * 3 + 1]; nz += w * Nn[i * 3 + 2]; }
        }
        if (ws < 1e-9) { const b = bi * 3; d = (x - P[b]) * Nn[b] + (y - P[b + 1]) * Nn[b + 1] + (z - P[b + 2]) * Nn[b + 2]; nx = Nn[b]; ny = Nn[b + 1]; nz = Nn[b + 2]; }
        else d /= ws;
        const l = Math.hypot(nx, ny, nz) || 1, need = (PALM_J.has(j) ? 0.010 : 0.006) - d;
        if (need > 0) { m = Math.max(m, need); dx += need * nx / l; dy += need * ny / l; dz += need * nz / l; }
      }
      if (!m) return;
      // the sum of (depth x normal), no longer than the deepest joint's depth: a hand inside one face comes out at
      // once, fingers pressing on opposite faces cancel
      dz = Math.max(0, dz);
      const len = Math.hypot(dx, dy, dz);
      if (len < 2e-4) return;
      if (len > m) { dx *= m / len; dy *= m / len; dz *= m / len; }
      k.c.x += dx; k.c.y += dy; k.c.z += dz;
    }
  }

  // ---------------------------------------------------------------- input
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0), ray = new T.Raycaster(), ndc = new T.Vector2(), hit = new T.Vector3();
  const keys = new Set();
  const pointerDrives = () => active() && !camOn;
  function bindInput() {
    const toCursor = e => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      plane.constant = -info.desk.top;                  // the pointer marks a spot on the desk (three's y = data z)
      if (ray.ray.intersectPlane(plane, hit)) setXY(hit.x, -hit.z);
    };
    canvas.addEventListener("pointermove", e => { if (pointerDrives()) toCursor(e); });
    canvas.addEventListener("pointerdown", e => {
      if (!running) return;
      if (paused) { if (e.pointerType === "mouse") setPaused(false); return; }   // a click resumes (a touch may be a scroll)
      if (camOn) { if (e.pointerType === "mouse" && e.button === 0) { manualGrasp(); toggleGrasp(); } return; }
      toCursor(e);
      if (e.pointerType === "mouse" && e.button === 0) toggleGrasp();   // a click closes the hand, the next opens it
    });
    canvas.addEventListener("wheel", e => { if (!pointerDrives()) return; e.preventDefault(); setH(ctl.h - e.deltaY * 0.0004); }, { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    root.addEventListener("keydown", e => {
      if (!running) return;
      const k = e.key.toLowerCase();
      if (k === "escape") { if (!paused) setPaused(true); return; }
      if (k === "l" && e.shiftKey) { saveCameraLog(); return; }
      if (paused) return;
      if (k === "r") { if (two && !camOn) setSide(side.name); reset("Reset: the object is back at rest"); if (camOn) { camCal = null; camHold = []; } }
      else if (k === "h") { if (camOn) setSide(side.other); else swapHands(); }
      else if (k === " ") { if (!e.repeat) { if (camOn) manualGrasp(); toggleGrasp(); } e.preventDefault(); }
      else if (k === "shift") keys.add("shift");       // Shift + Q / E: roll the hand about the wrist instead of turning it
      else if (camOn) return;
      else if ("qewsad".includes(k) || k.startsWith("arrow")) { keys.add(k); e.preventDefault(); }
    });
    root.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
    // on-screen pad (touch, or anyone who prefers buttons)
    pad.querySelectorAll("button[data-hold]").forEach(b => {
      const on = e => { e.preventDefault(); keys.add(b.dataset.hold); b.classList.add("on"); };
      const off = () => { keys.delete(b.dataset.hold); b.classList.remove("on"); };
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointerleave", off);
      b.addEventListener("pointercancel", off);
    });
    pad.querySelector("[data-toggle=grasp]").addEventListener("click", toggleGrasp);
    pauseBtn.addEventListener("click", () => setPaused(!paused));
    resetBtn.addEventListener("click", () => { reset("Reset: the object is back at rest"); if (camOn) { camCal = null; camHold = []; } if (running) canvas.focus({ preventScroll: true }); });
    camBtn.addEventListener("click", () => (camOn ? stopCamera() : startCamera()));
  }
  function setPaused(p, why) {
    paused = p;
    keys.clear();
    filters = null; camO.filters = null;              // the camera picks the hands up afresh
    root.classList.toggle("paused", p);
    pauseBtn.setAttribute("aria-pressed", String(p));
    pauseBtn.querySelector("span").textContent = p ? "Resume" : "Pause";
    if (p) pauseNote = why || "Paused: scrolling moves the page again. Click the desk or Resume to continue";
    else canvas.focus({ preventScroll: true });
  }
  // Shift+L: the camera log as a JSON file (stays on this device unless the visitor shares it)
  function saveCameraLog() {
    if (!camLog.length) { flash("No camera frames yet: turn the camera on first"); return; }
    const v = camBox.querySelector("video"), data = { saved: new Date().toISOString(), video: [v.videoWidth, v.videoHeight],
      ua: navigator.userAgent, ruler: camRuler, calibration: camCal, frames: camLog };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = "foretargeting-camera-log.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash(`Saved ${camLog.length} camera frames to foretargeting-camera-log.json`, 4000);
  }
  // camera on: Space or a click takes the grasp from the camera for the rest of the session
  function manualGrasp() {
    if (camManual) return;
    camManual = true;
    ctl.gTarget = ctl.g > 0.5 ? 1 : 0;
    flash("Grasp on Space or a click now; the camera keeps moving the hand", 4000);
  }
  function toggleGrasp() {
    ctl.gTarget = ctl.gTarget > 0.5 ? 0 : 1;
    pad.querySelector("[data-toggle=grasp]").classList.toggle("on", ctl.gTarget > 0.5);
  }
  function setXY(x, y, k = ctl) {
    const d = info.desk;
    k.c.x = Math.max(d.center[0] - d.half[0] + 0.03, Math.min(d.center[0] + d.half[0] - 0.03, x));
    k.c.y = Math.max(d.center[1] - d.half[1] + 0.03, Math.min(d.center[1] + d.half[1] - 0.03, y));
  }
  function setH(h, k = ctl) { k.h = Math.max(info.desk.top + 0.008, Math.min(1.2, h)); }

  // ---------------------------------------------------------------- the camera
  /* The visitor's own hand, through the webcam, drives the hand on the desk, read from MediaPipe's 2D landmarks (its 3D
     estimate of a hand lying flat, seen at a grazing angle, swung by 20-90 deg as the hand turned; the picture points
     held). Distance: the hand's palm spans in the picture against the demo hand's (knuckle line, a part of it, palm
     length, two diagonals, thumb base to pinky knuckle); the largest ratio, as some span always lies nearly across the
     line of sight: within 3.5 % over +-0.8 rad turns of a flat hand, where the knuckle line alone shrank 19 %:
     s picture heights per metre, distance = focal / s. Left/right: the palm's picture position over s. Height: a hand
     on the desk sits on a straight line in (s, picture height): v = v0 + H (s - s0), H the camera's height above the desk.
     The calibration (the hand still, at the start or after R, taken as resting on the desk) gives (s0, v0); H starts at
     a laptop's 25 cm and is learnt from the motion, since a hand never goes below the desk: points below the line for
     5 frames in a row move it. The height is the hand's distance above that line, in metres. Reading height off the picture failed on a
     real desk (the user, 2026-11-08): a hand sliding toward a camera above the desk also moves down the picture, so
     sliding read as lifting. Turning: the whole wrist, from MediaPipe's 3D read: the hand's frame (wrist to middle
     knuckle, index to pinky knuckle) against the calibration's, in the desk's axes (up = the resting palm's normal,
     forward = toward the camera), applied to the hand's turn at the calibration. The knuckle line's angle in the
     picture used before only turned the hand about the vertical and capped it at 69 deg; the user turned a palm up
     (about 150 deg) and the hand did not follow, while the 3D read held that pose within a few degrees. Grasp: the four fingers' mean bend (MCP + PIP + DIP) in
     MediaPipe's 3D read, the median of the last 0.2 s, closes the hand above 2.4 rad and opens it below 1.6. On a real
     webcam (the user, 2026-11-08) an open hand read 1.0-1.2 and a fist 2.6-2.8, two clean modes; the thumb-to-index
     distance in the picture used before read a fist as open half the time (the thumb wraps over the fingers, far from
     the index tip), so the object was never held. On rendered hands MediaPipe's 3D read an open hand as curled (3.2
     rad), so the synthetic test cameras no longer test the grasp. Space or a click hands the grasp to the keyboard for
     the rest of the camera session. The hand the camera sees picks the side. */
  let camOn = false, camCal = null, camHold = [], camSeen = 0, camFirst = true, camRaw = null, camLog = [], camRuler = null, camManual = false;
  let camLast = null, camSkips = 0, camOther = 0, camBends = [], camClosed = false;
  // the four fingers' mean bend, radians: the angles between successive bones from the wrist out, MediaPipe's 3D read
  function fingerBend(W) {
    const bone = (a, b) => new T.Vector3(W[b].x - W[a].x, W[b].y - W[a].y, W[b].z - W[a].z);
    let a = 0;
    for (const f of [5, 9, 13, 17]) {
      const chain = [0, f, f + 1, f + 2, f + 3];
      for (let i = 1; i < 4; i++) a += bone(chain[i - 1], chain[i]).angleTo(bone(chain[i], chain[i + 1]));
    }
    return a / 4;
  }
  // ?camlog on the local preview (tools/serve.py --camlog): the tracked points (no video) go to a file on this computer
  const CAMLOG = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("camlog");
  let camQueue = [], camTimer = 0;
  // with ?camlog the HUD says what the camera reads, in large type, to check one motion at a time against the hand
  function camReadout() {
    if (!CAMLOG || !camOn || !camRaw || camRaw.calibrating) return "";
    const c = camCal, [x, y, h] = camRaw.desk, cm = q => { const k = Math.round(q * 100); return `${k > 0 ? "+" : k < 0 ? "−" : ""}${Math.abs(k)} cm`; };
    return `${camRaw.side === "left" ? "sol" : "sağ"} el (${camRaw.score.toFixed(2)}) · sağa ${cm(x - c.x0)} · ileri ${cm(y - c.y0)}`
      + ` · yukarı ${cm(h - c.h0)} · ${["dönüş", "eğim", "çevirme"].map((k, i) => `${k} ${Math.round(camRaw.parts[i] * 180 / Math.PI)}°`).join(" · ")} · el ${camClosed ? "kapalı" : "açık"} (bükülme ${camRaw.bend.toFixed(1)})`;
  }
  function flushCamLog() {
    if (!camQueue.length) return;
    const lines = camQueue.map(e => JSON.stringify(e)).join("\n");
    camQueue = [];
    fetch("camlog", { method: "POST", body: lines }).catch(e => console.warn("camera log not saved", e));
  }
  const CAM_F = 1.07;          // focal length in picture heights: a ~50 deg vertical field of view, a typical webcam
  const CAM_GAIN = 1.5;        // desk metres per metre of hand motion
  const OneEuro = function (minCutoff, beta) { this.mc = minCutoff; this.b = beta; this.x = null; this.dx = 0; this.t = 0; };
  OneEuro.prototype.f = function (x, t) {
    if (this.x === null) { this.x = x; this.t = t; this.dx = 0; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000), a = c => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    this.t = t;
    this.dx += a(1) * ((x - this.x) / dt - this.dx);
    this.x += a(this.mc + this.b * Math.abs(this.dx)) * (x - this.x);
    return this.x;
  };
  let filters = null;
  const newFilters = () => ({ x: new OneEuro(0.8, 3), y: new OneEuro(0.8, 3), h: new OneEuro(0.8, 3), q: [0, 1, 2, 3].map(() => new OneEuro(1, 0.6)), last: null });
  // the hand's frame in MediaPipe's 3D read (camera axes: x right, y down, z away): fingers (wrist to the middle
  // knuckle), across the palm (index to pinky knuckle), and their cross product
  const hx = new T.Vector3(), hy = new T.Vector3(), hz = new T.Vector3(), hm = new T.Matrix4();
  function handTurn(W) {
    hx.set(W[9].x - W[0].x, W[9].y - W[0].y, W[9].z - W[0].z).normalize();
    hy.set(W[17].x - W[5].x, W[17].y - W[5].y, W[17].z - W[5].z);
    hy.addScaledVector(hx, -hy.dot(hx)).normalize();
    hz.crossVectors(hx, hy);
    return new T.Quaternion().setFromRotationMatrix(hm.makeBasis(hx, hy, hz));
  }
  // for the readout, a hand frame in the desk's axes as the fingers' heading (about the vertical), their pitch (up)
  // and the roll about them
  function turnParts(q) {
    const f = new T.Vector3(1, 0, 0).applyQuaternion(q), n = new T.Vector3(0, 0, 1).applyQuaternion(q);
    const w = new T.Vector3(-f.y, f.x, 0).normalize(), v = new T.Vector3().crossVectors(f, w);
    return [Math.atan2(f.y, f.x), Math.asin(Math.max(-1, Math.min(1, f.z))), Math.atan2(n.dot(w), n.dot(v))];
  }
  /* One camera frame in the picture: the palm centre (u, v; v in picture heights, u in picture widths), the scale s
     (picture heights per metre) and the knuckle line's angle. */
  function handView(I, ar) {
    const pal = [0, 5, 9, 13, 17], d = (a, b) => Math.hypot((I[a].x - I[b].x) * ar, I[a].y - I[b].y);
    return {
      u: mean(pal.map(i => I[i].x)), v: mean(pal.map(i => I[i].y)),
      s: Math.max(...camRuler.map(([a, b, l]) => d(a, b) / l)),
      angle: Math.atan2(I[17].y - I[5].y, (I[17].x - I[5].x) * ar)
    };
  }
  function calibrate(frames, st = camD, k = ctl) {
    const m = k => mean(frames.map(f => f[k]));
    // the resting hand's turn (the mean over the still moment), and the desk's axes in the camera's: up is that palm's
    // normal, unless it is more than 50 deg off the picture's up (a hand held up in the air), then a camera pitched
    // 20 deg down (19 deg on the user's laptop); forward is toward the camera, along the desk
    const q0 = frames[0].q, qm = new T.Quaternion(0, 0, 0, 0);
    for (const f of frames) { const k = f.q.dot(q0) < 0 ? -1 : 1; qm.x += k * f.q.x; qm.y += k * f.q.y; qm.z += k * f.q.z; qm.w += k * f.q.w; }
    qm.normalize();
    let up = new T.Vector3(0, 0, 1).applyQuaternion(qm);
    if (up.y > 0) up.negate();
    if (up.y > -Math.cos(50 * Math.PI / 180)) up = new T.Vector3(0, -Math.cos(0.35), -Math.sin(0.35));
    const fwd = new T.Vector3(0, 0, -1).addScaledVector(up, up.z).normalize();   // minus its part along up: -z . up = -up.z
    const qB = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(fwd, up), fwd, up));
    const cal = { u0: m("u"), v0: m("v"), s0: m("s"), H: 0.25, Hlo: 0.1, Hhi: 0.6, lo: [], hi: [],
      x0: k.c.x, y0: k.c.y, h0: info.desk.top + 0.008, yaw0: k.yaw, q0i: qm.clone().invert(), qB, qBi: qB.clone().invert(), qStart: turnQ(k.yaw, k.tilt) };
    cal.parts0 = turnParts(cal.qBi.clone().multiply(qm));
    st.cal = cal;
    st.filters = null;
    if (CAMLOG) camQueue.push(Object.assign({ type: "calibration", t: Math.round(performance.now()), hand: k === ctl ? "driven" : "other" }, cal, { lo: undefined, hi: undefined, q0i: qm.toArray(), qB: qB.toArray(), qBi: undefined, qStart: cal.qStart.toArray() }));
    flash(k === ctl ? "Calibrated: your desk is the desk. Slide, lift and turn your hand, close it to grasp. Show the other hand too to drive both"
      : "Both hands calibrated: each drives its own hand", 5000);
  }
  // the desk line learns the camera's height from points below it: a bound holds once 5 frames in a row imply it
  // (6 mm of slack for noise); the height stays within 10-60 cm
  function learnDesk(c, v, s) {
    const slack = 0.006 * s;
    c.lo.push(s > c.s0 * 1.06 ? (v - c.v0 - slack) / (s - c.s0) : -Infinity);
    c.hi.push(s < c.s0 / 1.06 ? (v - c.v0 - slack) / (s - c.s0) : Infinity);   // s - s0 < 0: the slack loosens this bound too
    if (c.lo.length > 5) { c.lo.shift(); c.hi.shift(); }
    c.Hlo = Math.min(0.6, Math.max(c.Hlo, Math.min(...c.lo)));
    c.Hhi = Math.max(0.1, Math.min(c.Hhi, Math.max(...c.hi)));
    c.H = c.Hlo <= c.Hhi ? Math.max(c.Hlo, Math.min(c.Hhi, c.H)) : 0.5 * (c.Hlo + c.Hhi);
  }
  async function startCamera(opts) {
    if (camOn) return;
    if (!window.HandCam || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && !(opts && (opts.src || opts.stream))) { flash("This browser offers no camera here, so the pointer keeps the hand", 5000); return; }
    if (!running) { await start(); if (!running) return; }
    if (paused) setPaused(false);
    camBtn.disabled = true;
    camBox.hidden = false;
    root.classList.add("cam-loading");
    flash("Starting the hand tracker…", 30000);
    try {
      await HandCam.start(camBox, onCamera, Object.assign({ when: () => visible && !document.hidden }, opts));
      camOn = true; camFirst = true; camCal = null; camHold = []; camManual = false; camLast = null; camOther = 0; camBends = []; camClosed = false; camO = newTrack();
      if (CAMLOG) {
        const v = camBox.querySelector("video");
        camQueue.push({ type: "session", saved: new Date().toISOString(), t: Math.round(performance.now()), video: [v.videoWidth, v.videoHeight], ua: navigator.userAgent, ruler: camRuler });
        clearInterval(camTimer);
        camTimer = setInterval(flushCamLog, 2000);
        flash("Recording the tracked hand points (no video) to a file on this computer", 4000);
      }
      root.classList.add("cam");
      camBtn.setAttribute("aria-pressed", "true");
      camBtn.querySelector("span").textContent = "Camera on";
    } catch (e) {
      console.error(e);
      camBox.hidden = true;
      flash(e && e.name === "NotAllowedError" ? "The camera was not allowed, so the pointer keeps the hand" : "The camera could not start in this browser, so the pointer keeps the hand", 5000);
    }
    root.classList.remove("cam-loading");
    camBtn.disabled = false;
    canvas.focus({ preventScroll: true });
  }
  function stopCamera() {
    HandCam.stop();
    if (CAMLOG) { clearInterval(camTimer); flushCamLog(); }
    camOn = false;
    setTwo(false);
    camBox.hidden = true;
    root.classList.remove("cam");
    camBtn.setAttribute("aria-pressed", "false");
    camBtn.querySelector("span").textContent = "Camera";
    ctl.gTarget = ctl.g = mean(ctl.gs) > 0.5 ? 1 : 0;
    ctl.yaw = Math.max(-1.2, Math.min(1.2, ctl.yaw));
    ctl.roll = 0; ctl.tilt.identity();
    flash("The pointer drives the hand again");
  }
  // the camera state of each hand: the driven hand's lives in the cam* variables above (camD reads and writes them),
  // the other hand's, once the camera sees both, in camO
  const camD = {
    get cal() { return camCal; }, set cal(v) { camCal = v; }, get hold() { return camHold; }, set hold(v) { camHold = v; },
    get bends() { return camBends; }, set bends(v) { camBends = v; }, get closed() { return camClosed; }, set closed(v) { camClosed = v; },
    get last() { return camLast; }, set last(v) { camLast = v; }, get skips() { return camSkips; }, set skips(v) { camSkips = v; },
    get filters() { return filters; }, set filters(v) { filters = v; }, get raw() { return camRaw; }, set raw(v) { camRaw = v; },
    get manual() { return camManual; }, get seen() { return camSeen; }, set seen(v) { camSeen = v; }
  };
  function newTrack() { return { cal: null, hold: [], bends: [], closed: false, last: null, skips: 0, filters: null, raw: null, manual: false, seen: 0 }; }
  let camO = newTrack();
  function onCamera(handSeen, now, hands) {
    if (!active()) return;
    hands = hands || (handSeen ? [handSeen] : []);
    for (const h of hands) {
      // the last 30 s of raw landmarks (picture and MediaPipe's 3D), for tuning on real hands: Shift+L saves them, and
      // with ?camlog on the local server they also go to its log file
      const entry = { t: Math.round(now), side: h.side, score: +h.score.toFixed(3), cal: !!(SIDES[h.side] === side ? camCal : camO.cal), I: h.image.map(q => [+q.x.toFixed(4), +q.y.toFixed(4)]),
        W: h.world.map(q => [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4)]) };
      camLog.push(entry);
      if (camLog.length > 900) camLog.shift();
      if (CAMLOG) camQueue.push(entry);
      h.entry = entry;
    }
    const mine = hands.find(h => SIDES[h.side] === side), theirs = hands.find(h => SIDES[h.side] !== side);
    if (!mine && !theirs) {
      for (const st of [camD, camO]) if (now - st.seen > 500) { st.filters = null; st.hold = []; }
      return;
    }
    // one hand of the other side, and not both: before two-hand mode it picks the side (the first one at once, a later
    // one once it has been seen for 0.8 s: a hand turning or half out of the picture was misnamed for up to 0.32 s, 18
    // frames, on a real webcam); in two-hand mode it just drives the other hand
    if (!mine && !two) {
      if (camFirst && theirs.score > 0.8) { camFirst = false; setSide(theirs.side); }
      else if (!camFirst) {
        camOther = camOther || now;
        if (now - camOther > 800) { camOther = 0; setSide(theirs.side); }
      }
      return;
    }
    if (mine) { camFirst = false; camOther = 0; follow(mine, now, camD, ctl); }
    // both hands seen (each of its own side) for 0.5 s: the other hand is driven too, until the camera stops
    if (mine && theirs && !two) {
      camO.since = camO.since || now;
      if (now - camO.since > 500 && camCal) setTwo(true);
    } else if (!theirs && !two) camO.since = 0;
    if (theirs && two) follow(theirs, now, camO, ctlO);
  }
  // one camera hand onto one desk hand (k): calibration, then position, height, turn and grasp
  function follow(handSeen, now, st, k) {
    st.seen = now;
    const I = handSeen.image, ar = handSeen.aspect, view = handView(I, ar);
    st.bends.push({ t: now, b: fingerBend(handSeen.world) });
    while (st.bends[0].t < now - 200) st.bends.shift();
    const bends = st.bends.map(f => f.b).sort((a, b) => a - b), bend = bends[bends.length >> 1];
    if (!st.cal) {
      // calibrate on the first still moment of an open hand: 0.7 s (at least 12 frames) within 1.2 % of the picture,
      // 5 % of scale and 0.08 rad of turn, the fingers bent under 2 rad. 8 frames (0.18 s at the 44 fps of a real
      // webcam) caught a hand still settling, 1 rad off; a fist held still was taken for the open hand (2.8 rad).
      if (bend > 2) { st.hold = []; st.raw = { view, calibrating: true }; return; }
      st.hold.push(Object.assign({ t: now, q: handTurn(handSeen.world) }, view));
      while (st.hold.length && st.hold[0].t < now - 700) st.hold.shift();
      const H = st.hold, span = key => Math.max(...H.map(f => f[key])) - Math.min(...H.map(f => f[key]));
      const a0 = H[0].angle, turnSpan = Math.max(...H.map(f => Math.abs(Math.atan2(Math.sin(f.angle - a0), Math.cos(f.angle - a0)))));
      if (H.length >= 12 && now - H[0].t > 650 && span("u") < 0.012 && span("v") < 0.012
          && span("s") < 0.05 * mean(H.map(f => f.s)) && turnSpan < 0.08) calibrate(H, st, k);
      st.raw = { view, calibrating: true };
      return;
    }
    // a tracking slip (the hand lost and found elsewhere for a frame or two) is skipped, unless it persists
    const l = st.last;
    if (l && now - l.t < 150 && (Math.abs(view.u - l.u) > 0.12 || Math.abs(view.v - l.v) > 0.12 || Math.abs(view.s / l.s - 1) > 0.3) && st.skips < 6) {
      st.skips++;
      return;
    }
    st.skips = 0;
    st.last = { t: now, u: view.u, v: view.v, s: view.s };
    if (!st.filters) st.filters = newFilters();
    const c = st.cal, F = st.filters, { u, v, s } = view;
    learnDesk(c, v, s);
    const lateral = -((u - 0.5) * ar / s - (c.u0 - 0.5) * ar / c.s0);   // the frame is not mirrored: the visitor's right is the picture's left
    const forward = CAM_F / c.s0 - CAM_F / s;                        // toward the screen
    const height = Math.max(0, (c.v0 + c.H * (s - c.s0) - v) / s);
    const x = c.x0 + CAM_GAIN * lateral, y = c.y0 + CAM_GAIN * forward, h = c.h0 + CAM_GAIN * height;
    setXY(F.x.f(x, now), F.y.f(y, now), k);
    setH(F.h.f(h, now), k);
    // the turn since the calibration, in the desk's axes, onto the hand's turn then; filtered per component (kept on
    // one side of the double cover), then split into the yaw about the vertical and the tilt before it
    const qn = handTurn(handSeen.world), qd = c.qBi.clone().multiply(qn).multiply(c.q0i).multiply(c.qB), qt = qd.multiply(c.qStart);
    const parts = turnParts(c.qBi.clone().multiply(qn)).map((a, i) => Math.atan2(Math.sin(a - c.parts0[i]), Math.cos(a - c.parts0[i])));
    if (F.last && qt.dot(F.last) < 0) qt.set(-qt.x, -qt.y, -qt.z, -qt.w);
    const qf = new T.Quaternion(...["x", "y", "z", "w"].map((key, i) => F.q[i].f(qt[key], now))).normalize();
    F.last = qf;
    k.yaw = 2 * Math.atan2(qf.z, qf.w);
    k.yaw = Math.atan2(Math.sin(k.yaw), Math.cos(k.yaw));
    k.tilt.setFromAxisAngle(zAxis, -k.yaw).multiply(qf);
    const yaw = k.yaw, tilt = 2 * Math.acos(Math.min(1, Math.abs(k.tilt.w)));
    if (!st.manual) {
      if (!st.closed && bend > 2.4) st.closed = true;
      else if (st.closed && bend < 1.6) st.closed = false;
      k.gTarget = st.closed ? 1 : 0;   // the fingers close over 0.45 s, as with the pointer
    }
    st.raw = { view, bend, desk: [x, y, h], yaw, tilt, parts, H: c.H, side: handSeen.side, score: handSeen.score };
    if (handSeen.entry) Object.assign(handSeen.entry, { s: +s.toFixed(3), bend: +bend.toFixed(3), desk: [x, y, h].map(q => +q.toFixed(4)), yaw: +yaw.toFixed(3), tilt: +tilt.toFixed(3),
      q: qf.toArray().map(q => +q.toFixed(4)), H: +c.H.toFixed(3), g: +mean(k.gs).toFixed(2) });
  }

  // ---------------------------------------------------------------- the model
  startBtn.addEventListener("click", start);
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function fetchWithProgress(url, onProgress) {
    const r = await fetch(url);
    const total = +r.headers.get("content-length") || 0;
    if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
    // content-length is the size on the wire: a server that gzips the file (GitHub Pages) sends more bytes than it says
    const reader = r.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(Math.min(0.99, got / total));
    }
    const out = new Uint8Array(got);
    for (let i = 0, o = 0; i < parts.length; o += parts[i].length, i++) out.set(parts[i], o);
    return out;
  }
  let starting = null;
  function start() { return starting || (starting = boot().finally(() => { starting = null; })); }
  async function boot() {
    if (session || !info) return;
    startBtn.disabled = true;
    root.classList.add("loading");
    try {
      if (!window.ort) await loadScript(ORT_BASE + "ort.wasm.min.js");
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const model = await fetchWithProgress("static/live/" + info.model.file, f => { progress.style.setProperty("--p", (f * 100).toFixed(1) + "%"); progress.dataset.label = `Loading the world model… ${Math.round(f * 100)}%`; });
      progress.dataset.label = "Starting…";
      session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      reset();
      running = true;
      root.classList.remove("loading");
      root.classList.add("running");
      canvas.focus({ preventScroll: true });
      // wide screens: the stage and its control column fill the screen under the top bar
      if (matchMedia("(min-width: 1100px) and (hover: hover) and (pointer: fine)").matches) window.scrollTo({ top: root.getBoundingClientRect().top + scrollY - 56, behavior: "smooth" });
      flash(matchMedia("(pointer: coarse)").matches ? "Drag to move the hand, lower it with the arrow, then grasp" : "Point at the object, scroll down to lower the hand, click to grasp", 6000);
    } catch (e) {
      root.classList.remove("loading");
      startBtn.disabled = false;
      progress.dataset.label = "Could not start the model in this browser.";
      console.error(e);
    }
  }

  function noise() {
    const n = new Float32Array(27);
    for (let i = 0; i < 27; i += 2) {
      const u = 1 - Math.random(), v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
      n[i] = r * Math.cos(2 * Math.PI * v);
      if (i + 1 < 27) n[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    return n;
  }
  const cat = arrs => { const out = new Float32Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

  async function step() {
    busy = true;
    const win = samples.slice(-6), hist = committed.slice(-3), driven = cat(win.map(s => s.L)), at = epoch;
    const leftDriven = side === SIDES.left;
    const other = two ? cat(win.map(s => s.O ? s.O.L : side.parkedL)) : side.parked6;
    const t0 = performance.now();
    try {
      const out = await session.run({
        history: new ort.Tensor("float32", cat(hist), [3, 4, 4]),
        left: new ort.Tensor("float32", leftDriven ? driven : other, [6, 21, 3]),
        right: new ort.Tensor("float32", leftDriven ? other : driven, [6, 21, 3]),
        points: new ort.Tensor("float32", points, [512, 3]),
        noise: new ort.Tensor("float32", noise(), [3, 9])
      });
      const pose = new Float32Array(out.poses.data.subarray(0, 16));
      stepMs.push(performance.now() - t0);
      nSteps++;
      if (stepMs.length > 30) stepMs.shift();
      if (at !== epoch) { busy = false; return; }        // reset (object, hand or R) while this step ran
      const m = info.model, x = pose[3], y = pose[7], z = pose[11];
      const bad = !(x > m.bounds_min[0] && x < m.bounds_max[0] && y > m.bounds_min[1] && y < m.bounds_max[1] && z > info.desk.top - 0.06 && z < m.bounds_max[2]) || pose.some(v => !isFinite(v));
      if (bad) { reset("The prediction left the workspace, so the object was reset"); }
      else {
        committed.push(pose);
        if (committed.length > 6) committed.shift();
        prevShown = shown;
        // the hand at the committed pose's moment, and the robot hand retargeted onto it
        shown = { pose, s: win[3], w: retarget(win[3], pose, !prevShown.w),
          wO: two && win[3].O ? retarget(win[3].O, pose, !prevShown.wO, side.other) : null };
        shownAt = performance.now();
      }
    } catch (e) { console.error(e); }
    busy = false;
  }

  // ---------------------------------------------------------------- frame
  const mA = new T.Matrix4(), mB = new T.Matrix4(), qa = new T.Quaternion(), qb = new T.Quaternion(), pa = new T.Vector3(), pb = new T.Vector3(), sc = new T.Vector3();
  const setM = (m, p) => m.set(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], 0, 0, 0, 1);
  let last = performance.now(), visible = true;
  // pause once the stage is mostly off screen, so a visitor scrolling on finds the page scrolls as usual
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (es[0].intersectionRatio < 0.35 && active()) setPaused(true, "Paused while you scrolled away. Click the desk or Resume to continue");
  }, { threshold: [0, 0.35] }).observe(root.querySelector(".live-stage"));

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden) return;
    // keys / pad: height, turn; the pointer's or the camera's grasp closes all fingers together
    if (active() && camOn) for (const k of two ? [ctl, ctlO] : [ctl]) {
      k.g += Math.sign(k.gTarget - k.g) * Math.min(Math.abs(k.gTarget - k.g), dt / 0.45);
      k.gs.fill(k.g);
    }
    if (active() && !camOn) {
      const up = keys.has("w") || keys.has("arrowup") || keys.has("up"), down = keys.has("s") || keys.has("arrowdown") || keys.has("down");
      if (up || down) setH(ctl.h + (up ? 1 : -1) * 0.18 * dt);
      const l = keys.has("q") || keys.has("left"), r = keys.has("e") || keys.has("right");
      if ((l || r) && keys.has("shift")) {         // roll about the wrist's axis (wrist to the middle knuckle, in the hand's frame)
        ctl.roll = Math.max(-1.6, Math.min(1.6, ctl.roll + (l ? 1 : -1) * 1.6 * dt));
        const J = side.keys[0].J; rollAx.set(J[27] - J[0], J[28] - J[1], J[29] - J[2]).normalize();
        ctl.tilt.setFromAxisAngle(rollAx, ctl.roll);
      } else if (l || r) ctl.yaw = Math.max(-1.2, Math.min(1.2, ctl.yaw + (l ? 1 : -1) * 1.4 * dt));
      ctl.g += Math.sign(ctl.gTarget - ctl.g) * Math.min(Math.abs(ctl.gTarget - ctl.g), dt / 0.45);
      ctl.gs.fill(ctl.g);
    }
    ctl.c.z += (ctl.h - ctl.c.z) * Math.min(1, dt * 12);
    if (two) ctlO.c.z += (ctlO.h - ctlO.c.z) * Math.min(1, dt * 12);
    // the hands never go into the object: the grasp point is moved out before the hand is sampled and drawn
    if (active()) {
      keepOut(ctl, side);
      if (two) keepOut(ctlO, SIDES[side.other]);
    }
    // the model clock: one sample, one step, every 0.1 s (or slower if a step takes longer)
    if (active() && !busy && now - lastSample >= info.model.dt * 1000) {
      lastSample = now;
      const q = turnQ();
      samples.push({ L: handLandmarks(ctl.c, ctl.gs, q), c: ctl.c.clone(), gs: ctl.gs.slice(), q, O: two ? otherSample() : null });
      if (samples.length > 12) samples.shift();
      step();
    }
    // draw: the committed state, eased in over one model frame
    const s = Math.min(1, (now - shownAt) / (info.model.dt * 1000));
    setM(mA, prevShown.pose).decompose(pa, qa, sc);
    setM(mB, shown.pose).decompose(pb, qb, sc);
    objMesh.position.copy(pa).lerp(pb, s);
    objMesh.quaternion.copy(qa).slerp(qb, s);
    const hs = prevShown.s, he = shown.s;
    const hc = hs.c.clone().lerp(he.c, s);
    placeHand(hand, hc, hs.gs.map((g, i) => g + (he.gs[i] - g) * s), hs.q.clone().slerp(he.q, s));
    if (two && hs.O && he.O) placeHand(parked, hs.O.c.clone().lerp(he.O.c, s), hs.O.gs.map((g, i) => g + (he.O.gs[i] - g) * s), hs.O.q.clone().slerp(he.O.q, s), SIDES[side.other]);
    const robot = mode === "wuji" && !!shown.w;
    if (wuji) {
      const otherW = two ? shown.wO : parkedW;
      wuji.group[side.name].visible = robot;
      wuji.group[side.other].visible = robot && !!otherW;
      if (robot) placeWuji(side.name, prevShown.w, shown.w, s);
      if (robot && otherW) placeWuji(side.other, two ? prevShown.wO : null, otherW, two ? s : 1);
    }
    ghost.visible = active() && !robot;
    if (ghost.visible) placeHand(ghost, ctl.c, ctl.gs, turnQ());
    // cursor
    cursorRing.visible = cursorDot.visible = cursorLine.visible = active();
    cursorRing.position.set(ctl.c.x, ctl.c.y, info.desk.top + 0.001);
    cursorDot.position.copy(ctl.c);
    const lp = cursorLine.geometry.attributes.position;
    lp.setXYZ(0, ctl.c.x, ctl.c.y, info.desk.top + 0.001); lp.setXYZ(1, ctl.c.x, ctl.c.y, ctl.c.z); lp.needsUpdate = true;
    cursorLine.computeLineDistances();
    // hud
    if (running) {
      const ms = stepMs.length ? stepMs.slice().sort((a, b) => a - b)[stepMs.length >> 1] : 0;
      const lift = (shown.pose[11] - rest[11]) * 100;
      const ik = robot ? ` · retargeting ${wuji.ik[side.name].ms.toFixed(0)} ms` : "";
      const reading = !paused && now >= messageUntil && now - camSeen <= 500 && camCal ? camReadout() : "";
      root.classList.toggle("readout", !!reading);
      hud.textContent = paused ? pauseNote : now < messageUntil ? message
        : camOn && now - camSeen > 500 && !(two && now - camO.seen <= 500) ? "Show one hand, or both, to the camera"
          : camOn && !camCal ? "Rest your hand flat on the desk in front of the camera and hold it still"
          : camOn && two && !camO.cal && now - camO.seen <= 500 ? "Rest your other hand flat on the desk too and hold it still"
          : reading || `model ${ms.toFixed(0)} ms${ik} in your browser · object ${lift > 0.5 ? `${lift.toFixed(1)} cm up` : "on the desk"} · grasp ${Math.round(mean(ctl.gs) * 100)}%`;
    }
    render();
  }

  function resize() {
    if (!renderer) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    // the operator's view: over the shoulder, onto the part of the desk the hand can reach, pulled back (1.15 m from
    // a point 15 cm above the desk) so a hand lifted 30 cm stays in the picture; at 0.84 m from 4 cm up it left at the
    // top at about 16 cm (the user, 2026-11-08)
    const narrow = camera.aspect < 1.2;
    camera.fov = narrow ? 44 : 32;
    camera.position.set(0, narrow ? 1.75 : 1.68, narrow ? 1.02 : 0.87);   // data (0, -0.87, 1.68)
    camera.lookAt(0, 0.90, narrow ? 0.02 : 0.11);   // wide: tilted a little down, so the desk fills the stage and little empty sky is left above it
    camera.updateProjectionMatrix();
  }
  function render() { renderer.render(scene, camera); }

  // test hook: drive the hand and read the model's state from the console
  window.FTLive = {
    ctl, setObject, setSide, swapHands, setMode, reset, setPaused, startCamera, stopCamera,
    wuji: () => wuji,
    camera: () => ({ raw: camRaw, cal: camCal, log: camLog, other: camO }),
    ctlO, setTwo, keepOut: () => { keepOut(ctl, side); if (two) keepOut(ctlO, SIDES[side.other]); },
    // a closer look for checks: fov in degrees onto a data-frame point (a resize restores the view)
    view: (fov, x, y, z) => { camera.fov = fov; camera.lookAt(x, z, -y); camera.updateProjectionMatrix(); },
    state: () => ({
      running, paused, mode, camera: camOn, two, side: side === SIDES.left ? "left" : "right", steps: nSteps, ms: stepMs.slice(),
      pose: shown && Array.from(shown.pose), rest: rest && Array.from(rest), samples: samples.length,
      robot: shown && shown.w && { p: Array.from(shown.w.p), q: Array.from(shown.w.q), ms: wuji.ik[side.name].ms, cost: wuji.ik[side.name].cost }
    })
  };
})();
