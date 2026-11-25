/* Object World simulator: both manosim hands drive the pose world model (base-900, interaction_surface) in the browser.
   The object is never simulated: every pose is the model's own prediction, fed back as its history -- our
   run_live_teleop.py with the model on this computer instead of a GPU box.

   Data (assets/, written by export_assets.py): sim.json + sim.bin (the hands, see hand.js; the objects: mesh, vertex
   colours, the 512 training points, a resting pose) and wm_step.onnx, one model step in world units: history (3,4,4),
   left / right landmarks (6,21,3) = 3 observed + 3 future frames 0.1 s apart, object points (512,3), noise (3,9) ->
   the next 3 poses.

   Two ways to drive the hands, both hands at once:
     keys  each hand has its own keys (KEYS): move over the desk, lower / raise, roll about the palm direction, turn
           about the palm normal, open / close the grasp. The grasp is one recorded hand: wide open -> holding a 6 cm
           cube (at HOLD of the way) -> tight fist. As in the simulator the play data came from, a finger stops
           closing when its capsules reach the object (the object's 512 points; only past half closed, and after
           sinking in a little, as the recorded hands' landmarks do), and the whole hand stops once the thumb and
           another finger are on it: the hand then holds, at whatever closure the object's size gives.
           Pressing close again while the hand holds squeezes: the fingers then close on through the object.
           The hand is not otherwise kept out of the object. A dot marks where the recorded hand held its cube.
     live  tracked hands from hand_stream.py on this computer (server-sent events): wrist + 15 finger rotations per
           hand, re-referenced onto the ready pose after a get-ready countdown, as object-teleop does.

   Clock: one hand sample every 0.1 s (the model's frame), one model step per sample, the first predicted pose
   committed. A window ends at the newest sample, so the committed pose is 0.2 s behind the hands; the solid hands are
   drawn at that moment and faint ones where the hands are now. A slow device just runs the world slower: a sample is
   only taken once the previous step is done. */
(function () {
  const T = THREE, M = window.ManoSim, $ = s => document.querySelector(s);
  const app = $("#app"), stage = $("#stage"), canvas = stage.querySelector("canvas"), hud = $("#hud");
  const startBtn = $("#start"), progress = $("#progress"), pauseBtn = $("#pause");
  const SIDES = ["left", "right"], COLORS = { left: 0x4f9bea, right: 0xea7fae };
  const KEYS = {
    left: { fwd: "KeyW", back: "KeyS", l: "KeyA", r: "KeyD", down: "KeyQ", up: "KeyE", rollN: "KeyZ", rollP: "KeyX", yawP: "KeyC", yawN: "KeyV", open: "KeyR", close: "KeyF" },
    right: { fwd: "KeyU", back: "KeyJ", l: "KeyH", r: "KeyK", down: "KeyY", up: "KeyI", rollN: "KeyB", rollP: "KeyN", yawP: "KeyM", yawN: "Comma", open: "KeyO", close: "KeyL" }
  };
  // the two key blocks as they sit on a keyboard, with what each key does: shown on the stage when "Show the keys" is on
  const CAST = {
    left: [["KeyQ", "Q", "lower"], ["KeyW", "W", "forward"], ["KeyE", "E", "raise"], ["KeyR", "R", "open"], ["KeyA", "A", "left"], ["KeyS", "S", "back"], ["KeyD", "D", "right"], ["KeyF", "F", "close"],
      ["KeyZ", "Z", "roll"], ["KeyX", "X", "roll"], ["KeyC", "C", "turn"], ["KeyV", "V", "turn"]],
    right: [["KeyY", "Y", "lower"], ["KeyU", "U", "forward"], ["KeyI", "I", "raise"], ["KeyO", "O", "open"], ["KeyH", "H", "left"], ["KeyJ", "J", "back"], ["KeyK", "K", "right"], ["KeyL", "L", "close"],
      ["KeyB", "B", "roll"], ["KeyN", "N", "roll"], ["KeyM", "M", "turn"], ["Comma", ",", "turn"]]
  };
  const USED = new Set(SIDES.flatMap(s => Object.values(KEYS[s])).concat(["Space", "Backspace"]));
  const MOVE = 0.28, LIFT = 0.22, TURN = 1.6, GRASP_S = 0.5;      // m/s, m/s, rad/s, seconds from open to closed
  // finger of each of the 15 joints, i.e. of capsule bodies 1..15 (MANO order: index, middle, pinky, ring, thumb)
  const FINGER = [1, 1, 1, 2, 2, 2, 4, 4, 4, 3, 3, 3, 0, 0, 0];
  const HOLD = 0.6;                                               // closure at which the hand is the one that carried the cube
  const tune = { press: 0.009, min: 0.5 };                        // m a finger sinks into the object before it stops; closure before contact counts
  const SKIN = 0.002;                                             // m: a capsule touches this far from the object's points (plus their spacing)
  const VIEW = { az: 0, el: 0.798, dist: 1.09 };                  // the operator's view, over the shoulder

  let info, buf, session = null, running = false, paused = false, busy = false, epoch = 0, mode = "keys";
  let renderer, scene, camera, rootG, objMesh, obj = null, points = null, rest = null, DT = 0.1, reach = 0, virtual = false;
  const H = {}, keys = new Set(), view = Object.assign({}, VIEW);
  let samples = [], committed = [], shown = null, prevShown = null, shownAt = 0, stepMs = [], lastSample = 0;
  let message = "", messageUntil = 0;
  const live = { source: null, latest: null, ref: {}, refUntil: 0, count: 0, seen: 0, rate: 0 };

  const arr = name => {
    const L = info.layout[name], C = { float32: Float32Array, uint32: Uint32Array, uint16: Uint16Array, uint8: Uint8Array }[L.dtype];
    return new C(buf, L.offset, L.shape.reduce((a, b) => a * b, 1));
  };
  const clay = (color, o) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.62, metalness: 0 }, o || {}));
  const active = () => running && !paused;
  function flash(text, ms) { message = text; messageUntil = performance.now() + (ms || 2600); }

  // ---------------------------------------------------------------- data, scene
  Promise.all([fetch("assets/sim.json?v=20261124020307").then(r => r.json()), fetch("assets/sim.bin").then(r => r.arrayBuffer())])
    .then(([meta, b]) => { info = meta; buf = b; DT = info.model.dt; build(); })
    .catch(e => { console.error(e); progress.dataset.label = "Could not load the simulator's assets."; startBtn.hidden = true; });

  function build() {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(32, 1, 0.02, 10);
    rootG = new T.Group();
    rootG.rotation.x = -Math.PI / 2;                              // data is z up
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
    const rim = new T.DirectionalLight(0xfff1df, 0.3);
    rim.position.set(1, 1.2, -1);
    scene.add(key, key.target, rim);

    const d = info.desk;
    const desk = new T.Mesh(new T.BoxGeometry(d.half[0] * 2, d.half[1] * 2, 0.04), clay(new T.Color(0xd4d2ce).convertSRGBToLinear(), { roughness: 0.9 }));
    desk.position.set(d.center[0], d.center[1], d.top - 0.02);
    desk.receiveShadow = true;
    rootG.add(desk);
    objMesh = new T.Mesh(new T.BufferGeometry(), clay(0xffffff, { vertexColors: true }));
    objMesh.castShadow = objMesh.receiveShadow = true;
    rootG.add(objMesh);

    for (const side of SIDES) {
      const spec = info.hands[side], verts = arr(side + "_palm_verts"), faces = arr(side + "_palm_faces");
      const color = new T.Color(COLORS[side]).convertSRGBToLinear();
      const h = H[side] = {
        spec, axes: M.axes(spec), open: spec.open.map(M.quat), hold: spec.hold.map(M.quat), tight: spec.tight.map(M.quat), grasp: new T.Vector3().fromArray(spec.grasp),
        readyP: new T.Vector3().fromArray(spec.ready.pos), readyQ: M.quat(spec.ready.quat),
        mesh: M.build(spec, verts, faces, clay(color)),
        ghost: M.build(spec, verts, faces, new T.MeshStandardMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.7 })),
        ctl: { p: new T.Vector3(), q: new T.Quaternion(), gs: [0, 0, 0, 0, 0], f: Array.from({ length: 15 }, () => new T.Quaternion()) },
        now: M.state(), drawn: M.state()
      };
      h.ghost.group.traverse(o => { o.castShadow = false; });
      // where the recorded hand held its cube: a dot at that point and a ring under it on the desk
      const mark = new T.MeshBasicMaterial({ color: COLORS[side], transparent: true, opacity: 0.85, depthWrite: false });
      h.dot = new T.Mesh(new T.SphereGeometry(0.0045, 12, 8), mark);
      h.ring = new T.Mesh(new T.RingGeometry(0.011, 0.015, 32), mark);
      rootG.add(h.mesh.group, h.ghost.group, h.dot, h.ring);
    }

    // object picker: held-out objects first, then the training ones
    const groups = [["heldout", "Held-out"], ["train", "Training"]];
    $("#groups").innerHTML = groups.map(([g, label], i) => `<button type="button" role="tab" data-group="${g}"${i ? "" : ' class="on"'}>${label} (${info.objects.filter(o => o.group === g).length})</button>`).join("");
    $("#groups").querySelectorAll("button").forEach(b => b.addEventListener("click", () => showGroup(b.dataset.group)));
    $("#ckpt").textContent = info.model.checkpoint;
    showGroup("heldout");
    setObject(info.objects.findIndex(o => o.group === "heldout"));
    homeHands();
    reset();
    bindInput();
    window.addEventListener("resize", resize);
    resize();
    app.classList.add("ready");
    requestAnimationFrame(frame);
  }

  function showGroup(group) {
    $("#groups").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.group === group));
    $("#objects").innerHTML = info.objects.map((o, i) => o.group !== group ? "" :
      `<button type="button" data-i="${i}"${obj === o ? ' class="on"' : ""}>${o.label}<small>${o.kind === "sim" ? "sim" : "scan"}</small></button>`).join("");
    $("#objects").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      setObject(+b.dataset.i);
      reset(`${obj.label}: ${obj.group === "heldout" ? "never seen in training" : "a training object"}`);
      if (running) canvas.focus({ preventScroll: true });
    }));
  }

  function setObject(i) {
    obj = info.objects[i];
    points = new Float32Array(arr(obj.name + "_points"));
    rest = new Float32Array(obj.rest.flat());
    // how close a capsule's surface must come to a sampled point to count as touching: SKIN plus part of the points' spacing
    let sum = 0;
    for (let i = 0; i < 64; i++) {
      let best = Infinity;
      for (let j = 0; j < 512; j++) if (j !== i) best = Math.min(best, (points[i * 3] - points[j * 3]) ** 2 + (points[i * 3 + 1] - points[j * 3 + 1]) ** 2 + (points[i * 3 + 2] - points[j * 3 + 2]) ** 2);
      sum += Math.sqrt(best);
    }
    reach = SKIN + 0.35 * sum / 64;
    const g = new T.BufferGeometry(), c8 = arr(obj.name + "_colors"), c = new Float32Array(c8.length);
    for (let k = 0; k < c8.length; k++) c[k] = Math.pow(c8[k] / 255, 2.2);          // sRGB -> linear
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(arr(obj.name + "_verts")), 3));
    g.setAttribute("color", new T.BufferAttribute(c, 3));
    g.setIndex(new T.BufferAttribute(new Uint32Array(arr(obj.name + "_faces")), 1));
    g.computeVertexNormals();
    objMesh.geometry.dispose();
    objMesh.geometry = g;
    $("#objects").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.i === i));
  }

  // ---------------------------------------------------------------- hands
  function homeHands() {
    for (const side of SIDES) { const h = H[side]; h.ctl.p.copy(h.readyP); h.ctl.q.copy(h.readyQ); h.ctl.gs.fill(0); h.holds = h.squeeze = false; setFingers(h); }
  }
  function setFingers(h) {
    for (let i = 0; i < 15; i++) {
      const g = h.ctl.gs[FINGER[i]];
      if (g < HOLD) h.ctl.f[i].copy(h.open[i]).slerp(h.hold[i], g / HOLD); else h.ctl.f[i].copy(h.hold[i]).slerp(h.tight[i], (g - HOLD) / (1 - HOLD));
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const graspText = h => (h.squeeze ? "squeezing" : h.holds ? "holding" : Math.round(mean(h.ctl.gs) * 100) + "%");

  // is finger k of hand h on the object? Its capsules, taken into the object's frame (the newest committed pose),
  // against the object's 512 points
  const sa = new T.Vector3(), sb = new T.Vector3();
  function intoObject(v, P) {
    const x = v.x - P[3], y = v.y - P[7], z = v.z - P[11];
    return v.set(P[0] * x + P[4] * y + P[8] * z, P[1] * x + P[5] * y + P[9] * z, P[2] * x + P[6] * y + P[10] * z);
  }
  function touching(h, k) {
    const P = committed[committed.length - 1];
    for (const c of h.spec.capsules) {
      if (FINGER[c.body - 1] !== k) continue;
      intoObject(sa.fromArray(c.a).applyQuaternion(h.now.rot[c.body]).add(h.now.pos[c.body]), P);
      intoObject(sb.fromArray(c.b).applyQuaternion(h.now.rot[c.body]).add(h.now.pos[c.body]), P);
      const dx = sb.x - sa.x, dy = sb.y - sa.y, dz = sb.z - sa.z, len2 = dx * dx + dy * dy + dz * dz, lim = Math.max(0.001, c.r + reach - tune.press) ** 2;
      for (let i = 0; i < 1536; i += 3) {
        const px = points[i] - sa.x, py = points[i + 1] - sa.y, pz = points[i + 2] - sa.z;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2));
        if ((px - t * dx) ** 2 + (py - t * dy) ** 2 + (pz - t * dz) ** 2 < lim) return true;
      }
    }
    return false;
  }

  // where the hand is now (h.now), kept above the desk: the wrist is lifted until every landmark clears the top
  function solveNow(h) {
    const c = h.ctl, floor = info.desk.top + 0.008;
    M.fk(h.spec, c.p, c.q, c.f, h.now);
    let low = Infinity;
    for (let j = 2; j < 63; j += 3) low = Math.min(low, h.now.L[j]);
    if (low < floor) { c.p.z += floor - low; M.fk(h.spec, c.p, c.q, c.f, h.now); }
  }

  const qt = new T.Quaternion(), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function driveKeys(dt) {
    const on = code => (keys.has(code) ? 1 : 0), slow = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 0.35 : 1, d = info.desk;
    for (const side of SIDES) {
      const k = KEYS[side], h = H[side], c = h.ctl;
      c.p.x = clamp(c.p.x + (on(k.r) - on(k.l)) * MOVE * slow * dt, d.center[0] - d.half[0] - 0.1, d.center[0] + d.half[0] + 0.1);
      c.p.y = clamp(c.p.y + (on(k.fwd) - on(k.back)) * MOVE * slow * dt, d.center[1] - d.half[1] - 0.15, d.center[1] + d.half[1] + 0.1);
      c.p.z = clamp(c.p.z + (on(k.up) - on(k.down)) * LIFT * slow * dt, d.top, 1.35);
      const roll = on(k.rollP) - on(k.rollN), yaw = on(k.yawP) - on(k.yawN);
      if (roll) c.q.multiply(qt.setFromAxisAngle(h.axes.dir, roll * TURN * slow * dt));
      if (yaw) c.q.multiply(qt.setFromAxisAngle(h.axes.normal, yaw * TURN * slow * dt));
      if (roll || yaw) c.q.normalize();
      const dg = (on(k.close) - on(k.open)) * dt / GRASP_S * slow;
      if (dg < 0) { h.holds = false; for (let f = 0; f < 5; f++) c.gs[f] = clamp(c.gs[f] + dg, 0, 1); }
      if (dg > 0 && h.squeeze) for (let f = 0; f < 5; f++) c.gs[f] = clamp(c.gs[f] + dg, 0, 1);
      if (dg > 0 && !h.squeeze) {
        // contact only counts once a finger has closed to tune.min: a hand set down over the object starts out touching it
        const on5 = [0, 1, 2, 3, 4].map(f => c.gs[f] >= tune.min && touching(h, f));
        h.holds = on5[0] && on5.slice(1).some(Boolean);         // thumb and another finger: the hand holds, nothing closes further
        if (!h.holds) for (let f = 0; f < 5; f++) if (!on5[f]) c.gs[f] = clamp(c.gs[f] + dg, 0, 1);
      }
      setFingers(h);
    }
  }

  // live: the streamed wrist is re-referenced onto the ready pose (target = ready + (cur - ref), R = R_cur R_ref^-1 R_ready)
  const cp = new T.Vector3(), cq = new T.Quaternion(), av = new T.Vector3();
  function driveLive(now) {
    const counting = now < live.refUntil;
    for (const side of SIDES) {
      const m = live.latest && live.latest[side], h = H[side], c = h.ctl;
      if (!m) continue;                                           // hand not seen: hold the last pose
      cp.fromArray(m.p); cq.set(m.q[1], m.q[2], m.q[3], m.q[0]);
      if (counting || !live.ref[side]) live.ref[side] = { p: cp.clone(), qi: cq.clone().invert() };
      const r = live.ref[side];
      c.p.copy(h.readyP).add(cp).sub(r.p);
      c.q.copy(cq).multiply(r.qi).multiply(h.readyQ);
      for (let i = 0; i < 15; i++) {
        const a = av.set(m.f[i * 3], m.f[i * 3 + 1], m.f[i * 3 + 2]).length();
        if (a > 1e-8) c.f[i].setFromAxisAngle(av.multiplyScalar(1 / a), a); else c.f[i].set(0, 0, 0, 1);
      }
    }
  }

  function snapshot() {
    const s = {};
    for (const side of SIDES) { const h = H[side], c = h.ctl; s[side] = { p: c.p.clone(), q: c.q.clone(), f: c.f.map(q => q.clone()), L: new Float32Array(h.now.L) }; }
    return s;
  }

  function reset(note) {
    epoch++;
    committed = [rest, rest, rest];
    for (const side of SIDES) solveNow(H[side]);
    const s = snapshot();
    samples = Array.from({ length: 6 }, () => s);
    shown = prevShown = { pose: rest, s };
    shownAt = performance.now();
    if (note) flash(note);
  }

  // start the object somewhere else than its resting pose (a replayed demo's own start); pose: 16 floats, row-major
  function seedObject(pose) {
    reset();
    committed = [pose, pose, pose];
    shown = prevShown = { pose, s: shown.s };
  }

  // ---------------------------------------------------------------- input
  function bindInput() {
    window.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" && e.target.type === "text") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (USED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      for (const side of SIDES) if (e.code === KEYS[side].close) H[side].squeeze = !!H[side].holds;   // pressed again while holding
      document.querySelectorAll(`kbd[data-code="${e.code}"]`).forEach(k => k.classList.add("down"));
      if (e.code === "Space" && running) setPaused(!paused);
      if (e.code === "Backspace") fullReset();
    });
    window.addEventListener("keyup", e => { keys.delete(e.code); for (const side of SIDES) if (e.code === KEYS[side].close) H[side].squeeze = false; document.querySelectorAll(`kbd[data-code="${e.code}"]`).forEach(k => k.classList.remove("down")); });
    window.addEventListener("blur", () => { keys.clear(); document.querySelectorAll("kbd.down").forEach(k => k.classList.remove("down")); });
    // the pointer only looks around: drag to orbit, wheel to zoom
    let drag = null;
    canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => {
      if (!drag) return;
      view.az -= (e.clientX - drag.x) * 0.006; view.el = clamp(view.el + (e.clientY - drag.y) * 0.005, 0.12, 1.5);
      drag = { x: e.clientX, y: e.clientY };
      resize();
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("wheel", e => { e.preventDefault(); view.dist = clamp(view.dist * Math.exp(e.deltaY * 0.001), 0.45, 2.6); resize(); }, { passive: false });
    $("#view").addEventListener("click", () => { Object.assign(view, VIEW); resize(); });
    $("#reset").addEventListener("click", fullReset);
    const cast = $("#keycast"), castBox = $("#cast");
    cast.innerHTML = SIDES.map(side => `<div class="kc"><p><i class="dot ${side[0]}"></i>${side === "left" ? "Left" : "Right"} hand</p><div class="kg">`
      + CAST[side].map(([code, key, what]) => `<kbd data-code="${code}">${key}<small>${what}</small></kbd>`).join("") + "</div></div>").join("");
    castBox.checked = new URLSearchParams(location.search).has("keys");
    castBox.addEventListener("change", () => { cast.hidden = !castBox.checked || mode !== "keys"; });
    cast.hidden = !castBox.checked;
    pauseBtn.addEventListener("click", () => setPaused(!paused));
    startBtn.addEventListener("click", start);
    $("#modes").querySelectorAll("button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#connect").addEventListener("click", () => (live.source ? disconnect() : connect()));
    $("#recal").addEventListener("click", recalibrate);
  }
  function fullReset() {
    if (mode === "keys") homeHands(); else recalibrate();
    reset("Reset: the object is back at rest" + (mode === "keys" ? ", the hands at the ready pose" : ""));
  }
  // project page: the page pauses the simulator when it scrolls out of view
  window.addEventListener("message", e => { if (e.origin === location.origin && e.data && e.data.sim === "pause" && running && !paused) setPaused(true); });
  function setPaused(p) { paused = p; pauseBtn.textContent = p ? "Resume" : "Pause"; if (!p) lastSample = 0; }
  function setMode(m) {
    mode = m;
    $("#modes").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    $("#keysPanel").hidden = m !== "keys";
    $("#livePanel").hidden = m !== "live";
    $("#keycast").hidden = m !== "keys" || !$("#cast").checked;
    if (m === "keys") { disconnect(); homeHands(); }
    reset(m === "keys" ? "Keyboard: both hands at the ready pose" : "Live hands: connect the hand stream");
  }

  // ---------------------------------------------------------------- live hand stream (hand_stream.py)
  function setStatus(text, cls) { const s = $("#streamStatus"); s.textContent = text; s.className = "status " + (cls || ""); }
  function connect() {
    const url = $("#streamUrl").value.trim();
    live.latest = null; live.count = 0; live.seen = 0;
    try { live.source = new EventSource(url); } catch (e) { setStatus("Bad address", "bad"); return; }
    setStatus("Connecting…");
    $("#connect").textContent = "Disconnect";
    live.source.onopen = () => { setStatus("Connected, waiting for hands", "ok"); };
    live.source.onmessage = e => {
      live.latest = JSON.parse(e.data);
      live.count++;
      const now = performance.now();
      if (!live.seen) { $("#recal").disabled = false; recalibrate(); }
      // a replayed demo names its object and where it started; taken while the get-ready countdown runs
      const o = live.latest.object;
      if (o && now < live.refUntil && (!obj || obj.name !== o.name || !live.seeded)) {
        const i = info.objects.findIndex(x => x.name === o.name);
        if (i >= 0) { showGroup(info.objects[i].group); setObject(i); seedObject(new Float32Array(o.pose)); live.seeded = true; }
      }
      live.rate = live.seen ? 0.9 * live.rate + 0.1 * 1000 / Math.max(1, now - live.seen) : 30;
      live.seen = now;
    };
    live.source.onerror = () => { setStatus("No stream at this address. Is hand_stream.py running?", "bad"); };
  }
  function disconnect() {
    if (live.source) live.source.close();
    live.source = null; live.latest = null; live.seen = 0;
    $("#connect").textContent = "Connect";
    $("#recal").disabled = true;
    setStatus("Not connected");
  }
  function recalibrate() { live.ref = {}; live.seeded = false; live.refUntil = performance.now() + 3000; }

  // ---------------------------------------------------------------- model
  async function fetchModel(url, onProgress) {
    let cache = null;
    try { cache = await caches.open("ow-sim-model"); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    const total = +r.headers.get("content-length") || 0;
    let out;
    if (!r.body || !total) out = new Uint8Array(await r.arrayBuffer());
    else {
      // content-length is the size on the wire: a server that gzips the file (GitHub Pages) sends more bytes than it says
      const reader = r.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; onProgress(Math.min(0.99, got / total));
      }
      out = new Uint8Array(got);
      for (let i = 0, o = 0; i < parts.length; o += parts[i].length, i++) out.set(parts[i], o);
    }
    if (cache) cache.put(url, new Response(out.slice(), { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
    return out;
  }
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  let starting = null;
  function start() { return starting || (starting = boot().finally(() => { starting = null; })); }
  async function boot() {
    if (session || !info) return;
    startBtn.disabled = true;
    app.classList.add("loading");
    try {
      if (!window.ort) await loadScript("vendor/ort/ort.wasm.min.js");
      ort.env.wasm.wasmPaths = new URL("vendor/ort/", location.href).href;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const model = await fetchModel("../live/" + info.model.file + "?v=" + info.model.version, f => {
        progress.style.setProperty("--p", (f * 100).toFixed(1) + "%"); progress.dataset.label = `Downloading the world model… ${Math.round(f * 100)}%`;
      });
      progress.dataset.label = "Starting…";
      session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      reset();
      running = true;
      app.classList.remove("loading");
      app.classList.add("running");
      canvas.focus({ preventScroll: true });
      flash(mode === "keys" ? "Move a hand to the object (W A S D, Q to lower), then hold F to close the grasp" : "Connect the hand stream on the right", 7000);
    } catch (e) {
      app.classList.remove("loading");
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
    const win = samples.slice(-6), hist = committed.slice(-3), at = epoch, t0 = performance.now();
    try {
      const out = await session.run({
        history: new ort.Tensor("float32", cat(hist), [3, 4, 4]),
        left: new ort.Tensor("float32", cat(win.map(s => s.left.L)), [6, 21, 3]),
        right: new ort.Tensor("float32", cat(win.map(s => s.right.L)), [6, 21, 3]),
        points: new ort.Tensor("float32", points, [512, 3]),
        noise: new ort.Tensor("float32", noise(), [3, 9])
      });
      const pose = new Float32Array(out.poses.data.subarray(0, 16));
      stepMs.push(performance.now() - t0);
      if (stepMs.length > 30) stepMs.shift();
      if (at !== epoch) { busy = false; return; }               // a reset (object, mode, key) while this step ran
      const m = info.model, x = pose[3], y = pose[7], z = pose[11];
      const bad = !(x > m.bounds_min[0] && x < m.bounds_max[0] && y > m.bounds_min[1] && y < m.bounds_max[1] && z > info.desk.top - 0.06 && z < m.bounds_max[2]) || pose.some(v => !isFinite(v));
      if (bad) reset("The prediction left the workspace, so the object was reset");
      else {
        committed.push(pose);
        if (committed.length > 6) committed.shift();
        prevShown = shown;
        shown = { pose, s: win[3] };                              // the hands at the committed pose's moment
        shownAt = performance.now();
      }
    } catch (e) { console.error(e); }
    busy = false;
  }

  // ---------------------------------------------------------------- frame
  const mA = new T.Matrix4(), mB = new T.Matrix4(), qa = new T.Quaternion(), qb = new T.Quaternion(), pa = new T.Vector3(), pb = new T.Vector3(), sc = new T.Vector3();
  const setM = (m, p) => m.set(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], 0, 0, 0, 1);
  const fq = Array.from({ length: 15 }, () => new T.Quaternion());
  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000);           // real-time speeds down to 4 frames a second
    last = now;
    if (document.hidden) return;
    if (!virtual) advance(now, dt);
    draw(now);
  }

  // move the hands by dt and, when the model clock is due, take a sample and run one step (returned as a promise)
  function advance(now, dt) {
    if (!paused) { if (mode === "keys") driveKeys(dt); else driveLive(now); }
    for (const side of SIDES) solveNow(H[side]);
    // the model clock: one sample, one step, every 0.1 s (or slower if a step takes longer)
    if (active() && !busy && now - lastSample >= DT * 1000 - 1) {
      lastSample = now;
      samples.push(snapshot());
      if (samples.length > 12) samples.shift();
      return step();
    }
    return null;
  }

  function draw(now) {
    // draw: the committed state, eased in over one model frame
    const s = running && !virtual ? Math.min(1, (now - shownAt) / (DT * 1000)) : 1;
    setM(mA, prevShown.pose).decompose(pa, qa, sc);
    setM(mB, shown.pose).decompose(pb, qb, sc);
    objMesh.position.copy(pa).lerp(pb, s);
    objMesh.quaternion.copy(qa).slerp(qb, s);
    const ghosts = active() && $("#ghost").checked;
    for (const side of SIDES) {
      const h = H[side], a = running ? prevShown.s[side] : h.ctl, b = running ? shown.s[side] : h.ctl;
      for (let i = 0; i < 15; i++) fq[i].copy(a.f[i]).slerp(b.f[i], s);
      M.fk(h.spec, pa.copy(a.p).lerp(b.p, s), qa.copy(a.q).slerp(b.q, s), fq, h.drawn);
      M.place(h.mesh, h.drawn);
      h.ghost.group.visible = ghosts;
      if (ghosts) M.place(h.ghost, h.now);
      h.dot.visible = h.ring.visible = active() && mode === "keys";
      h.dot.position.copy(h.grasp).applyQuaternion(h.ctl.q).add(h.ctl.p);
      h.ring.position.set(h.dot.position.x, h.dot.position.y, info.desk.top + 0.001);
    }
    if (running) {
      const ms = stepMs.length ? stepMs.slice().sort((x, y) => x - y)[stepMs.length >> 1] : 0, lift = (shown.pose[11] - rest[11]) * 100;
      const count = mode === "live" && now < live.refUntil ? Math.ceil((live.refUntil - now) / 1000) : 0;
      hud.classList.toggle("big", count > 0);
      hud.textContent = paused ? "Paused. Space or Resume to continue" : count ? `Get ready: hold your hands still… ${count}` : now < messageUntil ? message
        : mode === "live" && !live.source ? "Connect the hand stream on the right"
        : mode === "live" && now - live.seen > 1000 ? "Waiting for hands from the stream…"
        : `model ${ms.toFixed(0)} ms in your browser · object ${lift > 0.5 ? `${lift.toFixed(1)} cm up` : "on the desk"}`
          + (mode === "keys" ? ` · grasp: left ${graspText(H.left)}, right ${graspText(H.right)}` : ` · hands ${live.rate.toFixed(0)} Hz`);
      if (mode === "live" && live.source && live.seen && now - live.seen <= 1000) setStatus(`Receiving hands at ${live.rate.toFixed(0)} Hz`, "ok");
    }
    renderer.render(scene, camera);
  }

  function resize() {
    if (!renderer) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.fov = camera.aspect < 1.2 ? 44 : 32;
    // orbit about a point 15 cm above the desk, a little in front of its centre (three's frame: y up)
    const tx = 0, ty = 0.90, tz = 0.11, ce = Math.cos(view.el);
    camera.position.set(tx + view.dist * Math.sin(view.az) * ce, ty + view.dist * Math.sin(view.el), tz + view.dist * Math.cos(view.az) * ce);
    camera.lookAt(tx, ty, tz);
    camera.updateProjectionMatrix();
  }

  // test hook: drive the keys and read the state from the console. simulate() runs the same code on its own clock
  // (60 frames a second, the model at exactly 10 Hz, as fast as the model steps), whatever the page's frame rate
  let vclock = 0, vlast = -1e9;                                    // the virtual clock and its last model sample, kept between calls
  async function simulate(seconds, each) {
    virtual = true;
    lastSample = vlast;
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
      vclock += 1000 / 60;
      if (each) each(vclock);
      const stepped = advance(vclock, 1 / 60);
      if (stepped) await stepped;
    }
    virtual = false;
    vlast = lastSample;
    lastSample = 0;
  }
  window.__sim = {
    keys, live, H, tune, start, reset, setMode, simulate, homeHands, seedObject, KEYS,
    objectName: i => info.objects[i].name, heldout: () => info.objects.filter(o => o.group === "heldout").map(o => o.name),
    // the object's extent along a horizontal direction (ux, uy) at its newest pose: [min, max] in metres
    span: (ux, uy) => {
      const P = committed[committed.length - 1];
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 1536; i += 3) {
        const x = P[0] * points[i] + P[1] * points[i + 1] + P[2] * points[i + 2] + P[3], y = P[4] * points[i] + P[5] * points[i + 1] + P[6] * points[i + 2] + P[7];
        lo = Math.min(lo, x * ux + y * uy); hi = Math.max(hi, x * ux + y * uy);
      }
      return [lo, hi];
    },
    // the object's axis-aligned box in the world at its newest pose: { min: [3], max: [3] }
    box: () => {
      const P = committed[committed.length - 1], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 1536; i += 3) for (let a = 0; a < 3; a++) {
        const v = P[a * 4] * points[i] + P[a * 4 + 1] * points[i + 1] + P[a * 4 + 2] * points[i + 2] + P[a * 4 + 3];
        min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v);
      }
      return { min, max };
    }, setObject: name => { setObject(info.objects.findIndex(o => o.name === name)); reset(); },
    state: () => ({ running, paused, mode, object: obj && obj.name, pose: shown && Array.from(shown.pose), rest: rest && Array.from(rest), ms: stepMs.slice(-1)[0],
      steps: stepMs.length, hands: Object.fromEntries(SIDES.map(s => [s, { p: H[s].ctl.p.toArray(), g: mean(H[s].ctl.gs), gs: H[s].ctl.gs.slice(), holds: !!H[s].holds, squeeze: !!H[s].squeeze, q: H[s].ctl.q.toArray(), L: Array.from(H[s].now.L) }])) })
  };
})();
