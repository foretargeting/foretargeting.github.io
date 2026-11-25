/* "On a real recording, step by step" (#rtWalk): a real Aria recording of a person lifting an object, retargeted onto
   a Wuji hand by our human-like retargeter (tools/export_realclip.py: static/hero/real_<clip>.*, the comparison's
   "ot3" run). The run plays and stops at five moments, one per piece of the retargeter, while the list beside it says what
   is drawn and why it matters:
   1 the faint human hand the robot follows (bone directions), 2 amber fingertip targets sized by the contact fade
   phi = exp(-d / 12 mm) from the human fingertips to the object, 3 contact transport as the contact print of #otPrint
   (otprint.js's FTPrint on a canvas of its own over the stage, static/hero/otwalk_<clip>.*: the figure's capture and
   export at a held frame of this recording), 4 the grip command: the whole hand at the run's servo targets (blue, see-through, the
   object see-through too, as in the force-gap figure), 5 the search: amber copies of the object where its target puts it
   0.3, 0.7 and 1 s ahead. All of it is the run's own data. Steps 1-4 are seen from the palm's side. A switch picks the clip. */
(function () {
  const fig = document.getElementById("rtWalk");
  if (!fig || !window.Clay || !window.THREE) return;
  const T = THREE, C = Clay, canvas = fig.querySelector("canvas");
  const SIGMA = 0.012;                                   // the contact fade length, metres
  const MANO_TIPS = [745, 317, 444, 556, 673];           // thumb, index, middle, ring, pinky tip vertices of MANO
  const KEYS = [                                         // one short line each, so the key never wraps over the scene
    "<i class='rd'></i>the recorded hand, inside the object&ensp;<i class='am dash'></i>a fingertip 10–40 mm off it",
    // (the refine stop's second phase uses KEY_CLEAN)
    "<i class='bn'></i>the person's bones (index, for example)&ensp;<i class='am'></i>the robot's index finger",
    "<i class='am'></i>fingertip targets: faint while the human tip is far, full on the object",
    "<i class='pr'></i>the person's touch, a print per finger&ensp;<i class='th'></i>each Wuji point's thread to its share",
    "<i class='bl'></i>servo targets&ensp;<i class='gy'></i>the fingers, stopped on the surface: they press",
    "<i class='bl line'></i>each try's fingertips, 1 s ahead&ensp;<i class='rd line'></i>and its object&ensp;<i class='pu'></i>the reference 1 s ahead (the target)"
  ];
  const SKIP = new Set([4]);                         // the grip command stop: the grip command is no longer part of the method
  const SPEED = 0.55, HOLD = 4.6, HOLD0 = 12, HOLD2 = 10, HOLD3 = 9.6, FADE_LOOP = 4.8;   // the contact print plays its story (print, threads, settle) in 9.6 s   // stops hold 4.6 s; the refine stop 12 s (as recorded, pushed out, cleaned); contact fade 10 s, its 1.5 s reach slowed to 4.8 s, twice
  const KEY_PUSH = "<i class='rd'></i>the recorded hand, inside the object&ensp;<i class='gn'></i>the fingers open at their joints, onto the surface";
  const KEY_CLEAN = "<i class='gy'></i>the reference after the solve, outside the object&ensp;<i class='sk'></i>the recorded hand";

  // ---- one renderer and scene; each clip is a group swapped in
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
  r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(24, 2, 0.01, 20);
  scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.95); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 5; key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -0.4, right: 0.4, top: 0.4, bottom: -0.4 });
  scene.add(key, key.target);
  const mat = {
    robot: new T.MeshStandardMaterial({ color: 0x434b57, roughness: 0.42, metalness: 0.2, transparent: true, opacity: 1 }),   // in the transparent pass, after the faint human hand
    object: new T.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.55, side: T.DoubleSide }),   // the thinned scan has mixed winding
    skin: new T.MeshStandardMaterial({ color: 0xd99a74, roughness: 0.62, side: T.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false }),
    finger: new T.MeshStandardMaterial({ color: 0xf2a93b, roughness: 0.45, transparent: true, opacity: 1 }),
    cmd: new T.MeshStandardMaterial({ color: 0x3ea8e5, emissive: 0x3ea8e5, emissiveIntensity: 0.25, transparent: true, opacity: 0.38, depthWrite: false, depthTest: false }),   // drawn over the object: the targets lie inside it
    ahead: [0.42, 0.28, 0.16].map(o => new T.MeshStandardMaterial({ color: 0xf2a93b, emissive: 0xf2a93b, emissiveIntensity: 0.35, transparent: true, opacity: o, depthWrite: false }))
  };
  const clips = {};
  let cur = null, want = null;

  function build(name, pour, rf, op, sr, so) {
    const meta = pour.meta, L = meta.layout, U = meta.pos_unit, NG = meta.parts.length, FPS = meta.fps, N = meta.n, sides = meta.hands || [meta.acting];
    const pp = C.arr(pour.buf, L.poses_p), pq = C.arr(pour.buf, L.poses_q), ref = C.arr(pour.buf, L.ref_object);
    const ppA = L.poses_p_alt && C.arr(pour.buf, L.poses_p_alt), pqA = L.poses_q_alt && C.arr(pour.buf, L.poses_q_alt);   // kinematic stage, bone term off
    const ppO = L.poses_p_alton && C.arr(pour.buf, L.poses_p_alton), pqO = L.poses_q_alton && C.arr(pour.buf, L.poses_q_alton);   // kinematic stage, bone term on
    const ppC = L.poses_p_cmd && C.arr(pour.buf, L.poses_p_cmd), pqC = L.poses_q_cmd && C.arr(pour.buf, L.poses_q_cmd);   // servo targets
    const root = new T.Group(); root.rotation.x = -Math.PI / 2;
    const ground = new T.Mesh(new T.PlaneGeometry(4, 4), new T.ShadowMaterial({ opacity: 0.16 })); ground.position.z = -0.001; ground.receiveShadow = true; root.add(ground);
    const geos = meta.parts.map((_, i) => C.geometry(new Float32Array(C.arr(pour.buf, L[`mesh_${i}_v`])), C.arr(pour.buf, L[`mesh_${i}_f`])));
    const add = (g, m, sh) => { const x = new T.Mesh(g, m); x.castShadow = sh !== false; root.add(x); return x; };
    const handIdx = meta.parts.map((p, i) => sides.includes(p.group) ? i : -1).filter(i => i >= 0);
    const objIdx = meta.parts.map((p, i) => p.group === "object" ? i : -1).filter(i => i >= 0);
    const wuji = handIdx.map(i => add(geos[i], mat.robot)), objs = objIdx.map(i => add(geos[i], mat.object));
    wuji.forEach(m => { m.renderOrder = 3; });
    const tipIdx = handIdx.filter(i => /_link4$/.test(meta.parts[i].name));
    const fingerOf = i => meta.parts[i].name.replace(/_link\d+$/, "");                 // e.g. left_finger2
    const cmdIdx = handIdx;                        // the whole hand at its servo targets
    // the thumb's targets curl it into the palm, behind the other targets: it is drawn last and a little stronger
    const cmdThumb = mat.cmd.clone(); cmdThumb.opacity = 0.72; cmdThumb.color.set(0x2a8fd6); cmdThumb.emissive.set(0x2a8fd6);
    const cmdHand = cmdIdx.map(i => { const th = /_finger1_/.test(meta.parts[i].name), x = add(geos[i], th ? cmdThumb : mat.cmd, false); x.visible = false; x.renderOrder = th ? 7 : 6; return x; });
    // step 1 compares the kinematic stage with the bone term off (left) and on (right), a still of meta.shape.frame
    const pair = ppA && ppO && meta.shape ? [[ppA, pqA], [ppO, pqO]].map(([P, Q]) => {
      const grp = new T.Group(); grp.rotation.x = -Math.PI / 2; grp.visible = false;
      const put = (g, m) => { const x = new T.Mesh(g, m); x.castShadow = true; grp.add(x); return x; };
      const idx = new RegExp(`^/?${meta.acting}_finger2_link\\d$`);                     // finger2 is the index finger
      const hand = handIdx.map(i => { const x = put(geos[i], idx.test(meta.parts[i].name) ? mat.finger : mat.robot); x.renderOrder = 3; return x; }), obj = objIdx.map(i => put(geos[i], mat.object));
      const gr = new T.Mesh(new T.PlaneGeometry(4, 4), new T.ShadowMaterial({ opacity: 0.16 })); gr.position.z = -0.001; gr.receiveShadow = true; grp.add(gr);
      return { grp, hand, obj, P, Q };
    }) : null;
    // the person's hands on the object, faint
    const HE = meta.hand_every, HU = meta.hand_unit;
    // the refine stop's data (tools/export_refine.py): the recorded hand's depth in the object at every vertex, the
    // fingertips' distance and nearest surface point, the deepest point per frame
    const RA = k => rf && (rf.meta.layout[k].dtype === "int8" ? new Int8Array(rf.buf, rf.meta.layout[k].offset, rf.meta.layout[k].shape.reduce((a, b) => a * b, 1)) : C.arr(rf.buf, rf.meta.layout[k]));
    const RF = rf ? { side: rf.meta.acting, dep: RA("human_depth"), tipsd: RA("human_tipsd"), tipnp: RA("human_tipnp"), dh: RA("depth_human"),
      deepI: rf.meta.layout.deep_idx ? RA("deep_idx") : null, deepP: rf.meta.layout.deep_np ? RA("deep_np") : null } : null;
    // the recorded hand with its fingers opened at their joints (tools/open_fingers.py: wrist and hand shape fixed, out
    // of the object, the touching fingers still on its surface): per hand frame, each vertex's move and its new depth
    if (RF && op) { const OL = op.meta.layout; RF.open = { D: new Int16Array(op.buf, OL.delta.offset, OL.delta.shape.reduce((a, b) => a * b, 1)), dep: new Int8Array(op.buf, OL.depth_open.offset, OL.depth_open.shape.reduce((a, b) => a * b, 1)), unit: op.meta.unit }; }
    const humans = sides.map(sd => {
      const HV = L[`human_${sd}_v`], g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(HV.shape[1] * 3), 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(C.arr(pour.buf, L[`human_faces_${sd}`])), 1));
      const mesh = new T.Mesh(g, mat.skin); mesh.frustumCulled = false; mesh.renderOrder = 2; root.add(mesh);
      if (RF && sd === RF.side) g.setAttribute("color", new T.BufferAttribute(new Float32Array(HV.shape[1] * 3), 3));
      return { g, mesh, hv: C.arr(pour.buf, HV), NV: HV.shape[1], NH: HV.shape[0] };
    });
    const dot = (rad, color) => { const d = new T.Mesh(new T.SphereGeometry(rad, 16, 12), new T.MeshBasicMaterial({ color, transparent: true, depthTest: false })); d.renderOrder = 4; root.add(d); return d; };
    const tipDots = humans.flatMap(() => MANO_TIPS.map(() => dot(0.008, 0xf2a93b)));
    // the contacts: small spheres drawn over everything (a point cloud came out a few pixels wide), at most `max` each
    const cloud = (color, rad, max) => {
      const m = new T.InstancedMesh(new T.SphereGeometry(rad, 10, 8), new T.MeshBasicMaterial({ color, depthTest: false, transparent: true }), max);
      m.count = 0; m.renderOrder = 8; m.frustumCulled = false; m.userData.pts = new Float32Array(0); root.add(m); return m;
    };
    const cm4 = new T.Matrix4();
    function setCloud(m, a) {
      m.userData.pts = a; const n = a.length / 3, step = Math.max(1, Math.ceil(n / m.instanceMatrix.count)); let k = 0;
      for (let i = 0; i < n; i += step) { cm4.makeTranslation(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); m.setMatrixAt(k++, cm4); }
      m.count = k; m.instanceMatrix.needsUpdate = true;
    }
    const humanC = cloud(0xf2a93b, 0.0032, 160), robotC = cloud(0x1f7fc2, 0.0028, 220);
    // the transport: thin lines from a spread of the human's contacts to the robot contact each is carried to (nearest)
    const linkMat = new T.LineBasicMaterial({ color: 0x5b6b7d, transparent: true, opacity: 0.55, depthTest: false });
    const links = new T.LineSegments(new T.BufferGeometry(), linkMat); links.renderOrder = 7; links.frustumCulled = false; root.add(links);
    function setLinks(h, r) {
      const seg = [], picked = [];
      for (let i = 0; i < h.length && picked.length < 36; i += 3) {
        const x = h[i], y = h[i + 1], z = h[i + 2];
        if (picked.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < 0.006 ** 2)) continue;
        let best = 1e9, bj = -1;
        for (let j = 0; j < r.length; j += 3) { const d = (r[j] - x) ** 2 + (r[j + 1] - y) ** 2 + (r[j + 2] - z) ** 2; if (d < best) { best = d; bj = j; } }
        if (bj < 0 || best > 0.03 ** 2) continue;
        picked.push([x, y, z]); seg.push(x, y, z, r[bj], r[bj + 1], r[bj + 2]);
      }
      links.geometry.dispose(); links.geometry = new T.BufferGeometry(); links.geometry.setAttribute("position", new T.Float32BufferAttribute(seg, 3));
    }
    const tube = (color, w, opacity) => { const m = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false })); m.userData.w = w; m.renderOrder = 3; root.add(m); return m; };
    const setTube = (m, p) => { m.geometry.dispose(); m.geometry = p.length > 1 ? new T.TubeGeometry(new T.CatmullRomCurve3(p), p.length * 2, m.userData.w, 6, false) : new T.BufferGeometry(); };
    const ahead = mat.ahead.map(m => { const x = add(geos[objIdx[0]], m, false); x.visible = false; x.renderOrder = 4; return x; });   // the object 0.3 / 0.7 / 1 s ahead
    // the search at this stop (static/hero/search_<clip>.*, the run's own search at this window): for each of the 64
    // candidates of each CEM round, how its fingertip motion over the next second differs from the reference's (the
    // corrections tried), drawn from the hand's own fingertips; round by round they narrow, the round's best in red, then
    // the correction kept, its committed 0.15 s thick. Shown while the run holds at this stop; the object keeps its ghosts.
    const SR = sr && (() => {
      const Lk = sr.meta.layout, I16 = k => new Int16Array(sr.buf, Lk[k].offset, Lk[k].shape.reduce((a, b) => a * b, 1));
      const [R, M, S, F] = Lk.tips.shape, P = I16("tips"), Kp = I16("kept"), unit = sr.meta.unit;
      const cost = new Float32Array(sr.buf, Lk.costs.offset, R * M), st = new Float32Array(sr.buf, Lk.start.offset, F * 3);
      const tries = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0x5b6370, transparent: true, opacity: 0.7, depthTest: false }));
      tries.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(M * F * (S - 1) * 6), 3));
      tries.renderOrder = 9; tries.frustumCulled = false; tries.visible = false; root.add(tries);
      const best = Array.from({ length: F }, () => tube(0xd93a2b, 0.0006, 0.95)), commit = Array.from({ length: F }, () => tube(0xd93a2b, 0.0013, 1));
      best.concat(commit).forEach(m => { m.renderOrder = 10; m.visible = false; });
      const side = sr.meta.side, tipPart = Array.from({ length: F }, (_, k) => meta.parts.findIndex(p => p.name.replace(/^\//, "") === `${side}_finger${k + 1}_link4`));
      const off = Array.from({ length: F }, () => new T.Vector3());
      const o4 = new T.Object3D();
      return { R, M, S, F, P, Kp, cost, unit, st, frame: sr.meta.frame, offReady: false, tries, best, commit, tipPart, off, o4, anchor: Array.from({ length: F }, () => new T.Vector3()),
        nCommit: Math.max(2, Math.round(sr.meta.commit_s / sr.meta.step_s) + 1) };
    })();
    // the receding horizon on the hand, as the run does it (static/hero/searchhand_<clip>.*, tools/export_search_hand.py):
    // from the search stop on, every 0.15 s window of the lift in turn. In each, the CEM rounds roll candidates out over
    // the next second: every try's fingertips (blue) and the object it moves (red), the round's best darkest; they
    // narrow round by round toward the reference a second ahead (the violet hand and object). The plan kept in bold,
    // its first 0.15 s is run, the hand moves on, and the next window plans again. Behind stay the run's own traces.
    const SO = so && (() => {
      const Lk = so.meta.layout, [Wn, Rn, M, S, F] = Lk.tips.shape, unit = so.meta.unit;
      const TP = new Int16Array(so.buf, Lk.tips.offset, Wn * Rn * M * S * F * 3), OP = new Int16Array(so.buf, Lk.obj.offset, Wn * Rn * M * S * 3);
      const KP = new Int16Array(so.buf, Lk.kept.offset, Wn * S * (F + 1) * 3);
      const tipPart = so.meta.tips.map(n => meta.parts.findIndex(p => p.name.replace(/^\//, "") === n));
      const SH = [[0.95, 3], [0.5, 10], [0.2, M]];        // opacity, up to which rank
      const mk = (color, o, ro) => { const m = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color, transparent: true, opacity: o, depthTest: false, depthWrite: false })); m.userData.o = o; m.renderOrder = ro; m.frustumCulled = false; m.visible = false; root.add(m); return m; };
      const tryT = SH.map(([o], b) => mk(0x2456d6, o, 9 - b)), tryO = SH.map(([o], b) => mk(0xe0362a, o, 9 - b));
      const planT = mk(0x16399e, 1, 11), planO = mk(0xb3170c, 1, 11), trailT = mk(0x84aef0, 0.95, 7), trailO = mk(0xf0a59a, 0.95, 7);
      const ghost = new T.MeshStandardMaterial({ color: 0x8b7df2, roughness: 0.55, transparent: true, opacity: 0.32, depthWrite: false });
      const gHand = handIdx.map(i => { const x = add(geos[i], ghost, false); x.visible = false; x.renderOrder = 5; return x; });
      const gObj = add(geos[objIdx[0]], ghost, false); gObj.visible = false; gObj.renderOrder = 5;
      const times = so.meta.times, frames = so.meta.frames;
      const durs = frames.map((_, k) => k === 0 ? 5.6 : k === 1 ? 2.4 : 1.2), hold = durs.reduce((a, b) => a + b, 0);
      return { Wn, Rn, M, S, F, TP, OP, KP, unit, tipPart, SH, tryT, tryO, planT, planO, trailT, trailO, ghost, gHand, gObj, shown: "",
        all: [...tryT, ...tryO, planT, planO, trailT, trailO, ...gHand, gObj], anc: Array.from({ length: F + 1 }, () => new T.Vector3()),
        times, commit: so.meta.commit_s, frames, durs, hold, o4: new T.Object3D(), end: frames[frames.length - 1] + so.meta.commit_s * FPS };
    })();
    function tubes(list, w) {                           // many thin tubes as one mesh
      const pos = [], idx = []; let base = 0;
      for (const p of list) {
        if (p.length < 2) continue;
        const g = new T.TubeGeometry(new T.CatmullRomCurve3(p), p.length * 2, w, 4, false), a = g.attributes.position.array, ix = g.index.array;
        for (let i = 0; i < a.length; i++) pos.push(a[i]);
        for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
        base += a.length / 3; g.dispose();
      }
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
    }
    const swap = (m, g) => { m.geometry.dispose(); m.geometry = g; };
    const SEL = 0.62;                                   // the share of a window spent on its rounds; then its first 0.15 s runs
    function searchPhase(el) {                          // seconds into the stop -> window, how far through it, the frame shown
      let wi = 0, a = 0;
      while (wi < SO.Wn - 1 && el >= a + SO.durs[wi]) { a += SO.durs[wi]; wi++; }
      const u = Math.min(1, (el - a) / SO.durs[wi]), c = Math.max(0, (u - SEL) / (1 - SEL)), e = c * c * (3 - 2 * c);
      const fa = SO.frames[wi], fb = wi < SO.Wn - 1 ? SO.frames[wi + 1] : SO.end;
      return { wi, u, c, t: fa + (fb - fa) * e, rr: Math.min(SO.Rn - 1, Math.floor(Math.min(u, SEL - 1e-6) / SEL * SO.Rn)), n: SO.Wn, rounds: SO.Rn };
    }
    function soAt(s5) {
      if (!SO) return;
      const on = !!s5;
      SO.all.forEach(m => { m.visible = on; });
      if (!on) return;
      const { wi, u, c, rr } = s5, { Rn, M, S, F, TP, OP, KP, unit, anc, o4 } = SO, fw = SO.frames[wi];
      SO.tipPart.forEach((i, k) => { partAt(i, fw, o4); anc[k].copy(o4.position); });   // every path starts on the page's own hand / object
      partAt(objIdx[0], fw, o4); anc[F].copy(o4.position);
      const at = (A, src, o) => new T.Vector3(A.x + src[o] * unit, A.y + src[o + 1] * unit, A.z + src[o + 2] * unit);
      const tip = (k, t) => Array.from({ length: S }, (_, j) => at(anc[t], TP, ((((wi * Rn + rr) * M + k) * S + j) * F + t) * 3));
      const obj = k => Array.from({ length: S }, (_, j) => at(anc[F], OP, (((wi * Rn + rr) * M + k) * S + j) * 3));
      const last = u >= SEL * (Rn - 1) / Rn, key = wi + ":" + rr + ":" + last;
      if (SO.shown !== key) {                           // a new round: its tries, darker the lower their cost; its best (or the plan kept) bold
        SO.shown = key;
        SO.SH.forEach(([, hi], b) => {
          const lt = [], lo = [];
          for (let k = b ? SO.SH[b - 1][1] : 0; k < Math.min(M, hi); k++) { for (let t = 0; t < F; t++) lt.push(tip(k, t)); lo.push(obj(k)); }
          swap(SO.tryT[b], tubes(lt, 0.00045)); swap(SO.tryO[b], tubes(lo, 0.0006));
        });
        const kt = t => Array.from({ length: S }, (_, j) => at(anc[t], KP, ((wi * S + j) * (F + 1) + t) * 3));
        swap(SO.planT, tubes(Array.from({ length: F }, (_, t) => last ? kt(t) : tip(0, t)), 0.0011));
        swap(SO.planO, tubes([last ? kt(F) : obj(0)], 0.0016));
      }
      const fade = c > 0 ? 1 - 0.9 * c : 1;
      [...SO.tryT, ...SO.tryO].forEach(m => { m.material.opacity = m.userData.o * fade; });
      [SO.planT, SO.planO].forEach(m => { m.material.opacity = c > 0 ? 1 - 0.6 * c : 1; });
      const fg = Math.min(1, (s5.t - SO.frames[0]) / 3 + (wi ? 1 : Math.min(1, u * 4)));   // the reference a second ahead
      SO.ghost.opacity = 0.32 * Math.min(1, fg);
      const f1 = s5.t + FPS;
      handIdx.forEach((i, j) => partAt(i, f1, SO.gHand[j], ppO || pp, pqO || pq));
      refAt(f1, SO.gObj);
      const fs = SO.frames[0], fe = s5.t, n = Math.max(2, Math.ceil((fe - fs) * 1.5) + 1);   // the traces, as the run made them
      const tr = i => Array.from({ length: n }, (_, j) => { partAt(i, fs + (fe - fs) * j / (n - 1), o4); return o4.position.clone(); });
      swap(SO.trailT, tubes(fe - fs > 0.2 ? SO.tipPart.map(tr) : [], 0.0008));
      swap(SO.trailO, tubes(fe - fs > 0.2 ? [tr(objIdx[0])] : [], 0.0012));
    }
    function searchAt(on, u, f) {
      if (!SR) return;
      on = on && u <= 1;
      SR.tries.visible = on; SR.best.concat(SR.commit).forEach(m => { m.visible = on; });
      if (!on) return;
      const { M, S, F, P, unit } = SR;
      if (!SR.offReady) {                              // each try's start, against the run's own fingertip at the stop (a different run of the same setting)
        SR.offReady = true; SR.tipPart.forEach((i, k) => { if (i >= 0) { partAt(i, SR.frame, SR.o4); SR.off[k].set(SR.st[k * 3], SR.st[k * 3 + 1], SR.st[k * 3 + 2]).sub(SR.o4.position); } });
      }
      SR.tipPart.forEach((i, k) => { if (i >= 0) { partAt(i, f, SR.o4); SR.anchor[k].copy(SR.o4.position).add(SR.off[k]); } });   // the hand's fingertips now
      const r = Math.min(SR.R - 1, Math.floor(u / 0.11)), keep = u > 0.72, base = r * M * S * F * 3, A = SR.anchor;
      const a = SR.tries.geometry.attributes.position.array; let w = 0, bi = 0;
      for (let c = 0; c < M; c++) {
        if (SR.cost[r * M + c] < SR.cost[r * M + bi]) bi = c;
        for (let k = 0; k < F; k++) for (let j = 0; j < S - 1; j++) {
          const o0 = base + ((c * S + j) * F + k) * 3, o1 = o0 + F * 3;
          a[w++] = A[k].x + P[o0] * unit; a[w++] = A[k].y + P[o0 + 1] * unit; a[w++] = A[k].z + P[o0 + 2] * unit;
          a[w++] = A[k].x + P[o1] * unit; a[w++] = A[k].y + P[o1 + 1] * unit; a[w++] = A[k].z + P[o1 + 2] * unit;
        }
      }
      SR.tries.geometry.attributes.position.needsUpdate = true;
      const path = (src, o, k, n) => Array.from({ length: n }, (_, j) => { const q = o + (j * F + k) * 3; return new T.Vector3(A[k].x + src[q] * unit, A[k].y + src[q + 1] * unit, A[k].z + src[q + 2] * unit); });
      for (let k = 0; k < F; k++) {
        setTube(SR.best[k], keep ? path(SR.Kp, 0, k, S) : path(P, base + bi * S * F * 3, k, S));
        setTube(SR.commit[k], keep ? path(SR.Kp, 0, k, SR.nCommit) : []);
      }
      SR.tries.material.opacity = keep ? 0.25 : 0.7;
    }

    const qa = new T.Quaternion(), qb = new T.Quaternion(), o3 = new T.Object3D(), v3 = new T.Vector3();
    function partAt(i, f, o, pp_ = pp, pq_ = pq) {
      const pp = pp_, pq = pq_;
      f = Math.max(0, Math.min(N - 1.001, f)); const a = Math.floor(f), s = f - a, j = (a * NG + i) * 3, k = ((a + 1) * NG + i) * 3, jq = (a * NG + i) * 4, kq = ((a + 1) * NG + i) * 4;
      o.position.set((pp[j] + (pp[k] - pp[j]) * s) * U, (pp[j + 1] + (pp[k + 1] - pp[j + 1]) * s) * U, (pp[j + 2] + (pp[k + 2] - pp[j + 2]) * s) * U);
      qa.set(pq[jq + 1], pq[jq + 2], pq[jq + 3], pq[jq]).normalize(); qb.set(pq[kq + 1], pq[kq + 2], pq[kq + 3], pq[kq]).normalize(); o.quaternion.copy(qa).slerp(qb, s);
    }
    const refAt = (f, o) => C.pose(o, ref, N, Math.max(0, Math.min(N - 1.001, f)));
    function handAt(f) {
      for (const { g, hv, NV, NH } of humans) {
        const h = Math.max(0, Math.min(NH - 1.001, f / HE)), a = Math.floor(h), s = h - a, o = g.attributes.position.array, i0 = a * NV * 3, i1 = (a + 1) * NV * 3;
        for (let v = 0; v < NV * 3; v++) o[v] = (hv[i0 + v] + (hv[i1 + v] - hv[i0 + v]) * s) * HU;
        g.attributes.position.needsUpdate = true; g.computeVertexNormals();
      }
    }
    function place(f) {
      wuji.forEach((m, k) => partAt(handIdx[k], f, m)); objs.forEach((m, k) => partAt(objIdx[k], f, m)); handAt(f);
      root.updateMatrixWorld(true);
    }
    // the object's surface in the root frame, for distances: every few vertices of its mesh
    const ob = objs[0], oV = geos[objIdx[0]].attributes.position.array, STRIDE = Math.max(1, Math.round(oV.length / 3 / 2500)) * 3;
    const oW = new Float32Array(Math.ceil(oV.length / STRIDE) * 3);
    function objectWorld() {
      ob.updateMatrix(); let w = 0;
      for (let i = 0; i < oV.length; i += STRIDE) { v3.set(oV[i], oV[i + 1], oV[i + 2]).applyMatrix4(ob.matrix); oW[w++] = v3.x; oW[w++] = v3.y; oW[w++] = v3.z; }
    }
    function nearest(x, y, z) {
      let best = 1e9;
      for (let i = 0; i < oW.length; i += 3) { const dx = oW[i] - x, dy = oW[i + 1] - y, dz = oW[i + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < best) best = d; }
      return Math.sqrt(best);
    }
    const sph = new T.Sphere();
    function contactsOf(list, reach) {
      geos[objIdx[0]].computeBoundingSphere(); sph.copy(geos[objIdx[0]].boundingSphere).applyMatrix4(ob.matrix);
      const out = [];
      for (const [arr, M] of list) for (let i = 0; i < arr.length; i += 3) {
        v3.set(arr[i], arr[i + 1], arr[i + 2]); if (M) v3.applyMatrix4(M);
        if (v3.distanceTo(sph.center) > sph.radius + 0.03) continue;
        if (nearest(v3.x, v3.y, v3.z) < reach) out.push(v3.x, v3.y, v3.z);
      }
      return new Float32Array(out);
    }

    // the timeline: from before the reach to the end of the lift
    const z0 = ref[2]; let fMove = 0; while (fMove < N - 1 && ref[fMove * 7 + 2] - z0 < 0.01) fMove++;
    let fTop = fMove; for (let f = fMove; f < Math.min(N, fMove + 75); f++) if (ref[f * 7 + 2] > ref[fTop * 7 + 2]) fTop = f;   // the top of the first lift
    const f0 = Math.max(0, fMove - 40), f1 = Math.min(N - 1, fTop + 40);
    // the refine stop opens each loop (its stop is the loop's start) but shows the moment the recorded hand is deepest in
    // the object over the clip's window
    let fRef = fMove;
    if (RF) {
      let best = -Infinity;
      for (let f = f0; f <= f1; f++) {
        const k = Math.min(RF.tipsd.length / 5 - 1, Math.round(f / HE)); let on = 0;
        for (let j = 0; j < 5; j++) if (RF.tipsd[k * 5 + j] * 1e-4 < 0.002) on++;
        const sc = on * 10 - RF.dh[f];                 // a grasp (fingertips on the object) first, then how deep
        if (sc > best) { best = sc; fRef = f; }
      }
    }
    const STOPS = [f0, fMove - 26, fMove - 8, fMove + 1, fMove + 7, SO ? Math.max(fMove + 2, SO.frames[0]) : Math.round(fMove + Math.max(14, 0.6 * (fTop - fMove)))].map(f => Math.max(f0, Math.min(f1, f)));
    // a camera on the acting hand and the object's lift, looking past the hand at the object, a little to the side
    const box = new T.Box3();
    for (let f = f0; f <= f1; f += 3) { refAt(f, o3); box.expandByPoint(o3.position); partAt(handIdx[0], f, o3); box.expandByPoint(o3.position); }
    box.expandByPoint(new T.Vector3(box.min.x, box.min.y, 0));
    refAt(fMove + 8, o3);                                         // look at the grasp, between it and the middle of the lift
    const c = box.getCenter(new T.Vector3()).lerp(o3.position, 0.3), center = new T.Vector3(c.x, c.z, -c.y), radius = box.getSize(new T.Vector3()).length() * 0.5 + 0.04;
    const oRef = new T.Object3D(); partAt(handIdx[0], fMove, o3); refAt(fMove, oRef);
    let AZ = Math.atan2(o3.position.x - oRef.position.x, -(o3.position.y - oRef.position.y)) + 0.7;
    if (sides.length > 1) {                           // two hands: look across the line between them, at both
      const other = handIdx.find(i => meta.parts[i].group !== meta.parts[handIdx[0]].group), o4 = new T.Object3D(); partAt(other, fMove, o4);
      const dx = o4.position.x - o3.position.x, dy = o4.position.y - o3.position.y;
      AZ = Math.atan2(-dy, -dx) + 0.35;
    }

    let shown = -1;
    const roi = new T.Vector3(), mean = (list) => { roi.set(0, 0, 0); list.forEach(p => roi.add(p)); return list.length ? roi.multiplyScalar(1 / list.length) : null; };
    const nearObj = (list, r = 0.1) => { const l = list.filter(p => p.distanceTo(ob.position) < r); return l.length ? l : [ob.position]; };   // the hand at the object
    const tipsNow = () => nearObj(tipIdx.map(i => wuji[handIdx.indexOf(i)].position));
    const handNow = () => nearObj(wuji.map(m => m.position), 0.14);
    function spot(step) {                              // the point the lens looks at, in the root frame (or none)
      if (step === 0) {                              // the cleaned phase looks between the recorded hand and the reference
        if (refSpot || !lastRef) return refSpot;
        const r = mean(handNow()); return r ? lastRef.clone().lerp(r, 0.5) : lastRef;
      }
      if (step === 1) return mean(handNow());
      if (step === 2) return mean(nearObj(tipDots.map(d => d.position)));
      if (step === 3) {
        const a = humanC.userData.pts; if (!a.length) return mean(tipsNow());
        const l = []; for (let i = 0; i < a.length; i += 3) l.push(new T.Vector3(a[i], a[i + 1], a[i + 2])); return mean(l);
      }
      if (step === 5 && SO) return SO.gObj.visible ? ob.position.clone().lerp(SO.gObj.position, 0.5) : ob.position.clone().add(new T.Vector3(0, 0, 0.1));   // between the object and its target
      if (step === 4 || step === 5) return mean(tipsNow());
      return null;
    }
    // the refine stop: the recorded hand opaque, red where it is inside the object; dashed lines from fingertips that
    // float 10-40 mm off it to the nearest surface point
    const refMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 });
    const SKIN = new T.Color(0xe0b294).convertSRGBToLinear(), RED = new T.Color(0xd93a2b).convertSRGBToLinear(), rc = new T.Color();
    const gapMat = new T.LineDashedMaterial({ color: 0xe8941f, dashSize: 0.005, gapSize: 0.004, depthTest: false, transparent: true });
    const gaps = [0, 1, 2, 3, 4].map(() => { const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), gapMat); l.renderOrder = 6; l.visible = false; root.add(l); return l; });
    let refSpot = null, lastRef = null;
    // the push: every part of the recorded hand that is inside the object moves out along its own surface normal, just
    // to the surface, and the rest of the hand stays where it is, so the fingers keep touching the object (contact is
    // kept, only the penetration is removed); up to six arrows show a few of those moves, and the red fades with them
    const arrowMat = new T.MeshBasicMaterial({ color: 0x16a34a, depthTest: false, transparent: true }), AY = new T.Vector3(0, 1, 0);
    const arrows = Array.from({ length: 6 }, () => {
      const g = new T.Group(), sh = new T.Mesh(new T.CylinderGeometry(0.0011, 0.0011, 1, 10), arrowMat), hd = new T.Mesh(new T.ConeGeometry(0.0032, 0.008, 16), arrowMat);
      sh.renderOrder = hd.renderOrder = 7; g.add(sh, hd); g.userData = { sh, hd }; g.visible = false; root.add(g); return g;
    });
    function setArrow(g, from, dir, len) {
      const { sh, hd } = g.userData, L = Math.max(0.01, len), S = L - 0.008;
      sh.scale.set(1, S, 1); sh.position.set(0, S / 2, 0); hd.position.set(0, S + 0.004, 0);
      g.position.copy(from); g.quaternion.setFromUnitVectors(AY, dir); g.visible = true;
    }
    const og = geos[objIdx[0]]; if (!og.attributes.normal) og.computeVertexNormals();
    const oNl = og.attributes.normal.array, oNw = new Float32Array(oW.length), nm3 = new T.Matrix3(), n3 = new T.Vector3();
    const av = new T.Vector3(), ad = new T.Vector3(), pushDir = new T.Vector3();
    const outCache = new Map();
    // per hand frame k: for each vertex inside the object, its move out to the surface (the tangent plane at the nearest
    // surface point, along that point's outward normal, 0.5 mm clear)
    function wayOut(k, P) {
      if (outCache.has(k)) { const o = outCache.get(k); pushDir.copy(o.dir); return o; }
      objectWorld(); ob.updateMatrix(); nm3.getNormalMatrix(ob.matrix);
      for (let i = 0, w = 0; i < oNl.length; i += STRIDE, w += 3) { n3.set(oNl[i], oNl[i + 1], oNl[i + 2]).applyMatrix3(nm3).normalize(); oNw[w] = n3.x; oNw[w + 1] = n3.y; oNw[w + 2] = n3.z; }
      const NV = P.length / 3, D = new Float32Array(NV * 3), dir = new T.Vector3();
      for (let v = 0; v < NV; v++) {
        if (RF.dep[k * NV + v] >= 0) continue;
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; let best = 1e9, bi = 0;
        for (let i = 0; i < oW.length; i += 3) { const dx = oW[i] - x, dy = oW[i + 1] - y, dz = oW[i + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < best) { best = d; bi = i; } }
        // the normal's sign from the side the point is on (it is inside, so out is towards the surface point)
        let nx = oNw[bi], ny = oNw[bi + 1], nz = oNw[bi + 2], s = (oW[bi] - x) * nx + (oW[bi + 1] - y) * ny + (oW[bi + 2] - z) * nz;
        if (s < 0) { nx = -nx; ny = -ny; nz = -nz; s = -s; }
        s += 0.0005;
        D[v * 3] = nx * s; D[v * 3 + 1] = ny * s; D[v * 3 + 2] = nz * s; dir.x += D[v * 3]; dir.y += D[v * 3 + 1]; dir.z += D[v * 3 + 2];
      }
      if (dir.lengthSq() > 1e-12) dir.normalize();
      const o = { D, dir }; outCache.set(k, o); pushDir.copy(dir); return o;
    }
    const openCache = new Map();
    function openOut(k, NV) {
      if (openCache.has(k)) { const o = openCache.get(k); pushDir.copy(o.dir); return o; }
      const D = new Float32Array(NV * 3), src = RF.open.D, u = RF.open.unit, dir = new T.Vector3();
      for (let i = 0; i < NV * 3; i++) D[i] = src[k * NV * 3 + i] * u;
      for (let v = 0; v < NV; v++) if (RF.dep[k * NV + v] < -2) { dir.x += D[v * 3]; dir.y += D[v * 3 + 1]; dir.z += D[v * 3 + 2]; }
      if (dir.lengthSq() > 1e-12) dir.normalize();
      const o = { D, dir }; openCache.set(k, o); pushDir.copy(dir); return o;
    }
    function pushAt(on, f, u, keep) {
      arrows.forEach(a => { a.visible = false; });
      if (!RF || !(on || keep)) return;
      const act = humans[sides.indexOf(RF.side)], k = Math.max(0, Math.min(act.NH - 1, Math.round((keep ? f : cur0) / HE))), P = act.g.attributes.position.array, NV = act.NV;
      const { D } = RF.open ? openOut(k, NV) : wayOut(k, P), sl = keep ? 1 : Math.min(1, Math.max(0, (u - 0.3) / 0.55)), e = sl * sl * (3 - 2 * sl);
      // the arrows first, from where the points start: the deepest points more than 4 mm in, 12 mm apart, so they spread
      // over every part of the hand that has to come out
      const picked = [];
      if (!keep) {
        const ins = [];
        for (let v = 0; v < NV; v++) if (RF.dep[k * NV + v] < -4 && D[v * 3] * D[v * 3] + D[v * 3 + 1] * D[v * 3 + 1] + D[v * 3 + 2] * D[v * 3 + 2] > 9e-6) ins.push(v);
        ins.sort((p, q) => RF.dep[k * NV + p] - RF.dep[k * NV + q]);
        for (const v of ins) { if (picked.length >= arrows.length) break; av.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (picked.every(q => q.p.distanceTo(av) > 0.012)) picked.push({ v, p: av.clone() }); }
      }
      // while the clip plays (the result phase), the move is blended between the two hand frames around f, so the hand
      // glides instead of stepping every other frame
      if (keep && RF.open) {
        const h = Math.max(0, Math.min(act.NH - 1.001, f / HE)), a = Math.floor(h), w = h - a, A = openOut(a, NV).D, B = openOut(a + 1, NV).D;
        for (let v = 0; v < NV * 3; v++) P[v] += A[v] + (B[v] - A[v]) * w;
      } else for (let v = 0; v < NV * 3; v++) P[v] += D[v] * e;
      act.g.attributes.position.needsUpdate = true; act.g.computeVertexNormals();
      if (keep) return;
      // the red fades as each point comes out
      const c = act.g.attributes.color.array;
      for (let v = 0; v < NV; v++) { const d = RF.dep[k * NV + v] * (1 - e) + (RF.open ? RF.open.dep[k * NV + v] * e : 0); rc.copy(SKIN).lerp(RED, d < -1 ? Math.min(1, -d / 6) : 0); c[v * 3] = rc.r; c[v * 3 + 1] = rc.g; c[v * 3 + 2] = rc.b; }
      act.g.attributes.color.needsUpdate = true;
      picked.forEach(({ v }, j) => {
        ad.set(D[v * 3], D[v * 3 + 1], D[v * 3 + 2]); const L0 = ad.length() * (1 - e); if (L0 < 0.002) return;
        av.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); setArrow(arrows[j], av, ad.normalize(), L0 + 0.008);
      });
    }
    let cur0 = 0;                                       // the frame the push is shown at
    function refineAt(on, f) {
      wuji.forEach(m => { m.visible = !on; });
      const act = RF && humans[sides.indexOf(RF.side)];
      gaps.forEach(l => { l.visible = false; });
      if (act) act.mesh.material = on ? refMat : mat.skin;
      refSpot = null;
      if (!on || !act) return;
      const k = Math.max(0, Math.min(act.NH - 1, Math.round(f / HE))), NV = act.NV, c = act.g.attributes.color.array, P = act.g.attributes.position.array;
      const sp = new T.Vector3(); let n = 0;
      for (let v = 0; v < NV; v++) {
        const d = RF.dep[k * NV + v]; rc.copy(SKIN).lerp(RED, d < -1 ? Math.min(1, -d / 6) : 0); c[v * 3] = rc.r; c[v * 3 + 1] = rc.g; c[v * 3 + 2] = rc.b;
        if (d < -2) { sp.x += P[v * 3]; sp.y += P[v * 3 + 1]; sp.z += P[v * 3 + 2]; n++; }
      }
      act.g.attributes.color.needsUpdate = true;
      const lm = C.arr(pour.buf, L[`human_${RF.side}_lm`]);
      [4, 8, 12, 16, 20].forEach((tp, j) => {
        const sd = RF.tipsd[k * 5 + j] * 1e-4, l = gaps[j]; if (!(sd > 0.01 && sd < 0.04)) return;
        const a = l.geometry.attributes.position, b = (k * 21 + tp) * 3, q = (k * 5 + j) * 3;
        a.setXYZ(0, lm[b] * HU, lm[b + 1] * HU, lm[b + 2] * HU); a.setXYZ(1, RF.tipnp[q] * HU, RF.tipnp[q + 1] * HU, RF.tipnp[q + 2] * HU); a.needsUpdate = true;
        l.computeLineDistances(); l.visible = true;
      });
      if (n > 6) refSpot = sp.multiplyScalar(1 / n);
      else { const b = (k * 21 + 9) * 3; refSpot = new T.Vector3(lm[b] * HU, lm[b + 1] * HU, lm[b + 2] * HU); }
      lastRef = refSpot.clone();
    }
    // the cleaned phase of the refine stop: the reference after the whole-motion solve (the kinematic stage, before
    // physics), over a faint copy of the recorded hand
    function cleanedAt(f) {
      if (!ppO) return false;
      wuji.forEach((m, k) => { m.visible = true; partAt(handIdx[k], f, m, ppO, pqO); });
      return true;
    }
    function overlays(step, f, phase = "raw", u = 0, ft = f, s5 = null) {
      refineAt(step === 0 && phase !== "clean", f);
      if (phase === "push") cur0 = f;
      pushAt(step === 0 && phase === "push", f, u, false);
      if (step === 0 && phase === "clean") { pushAt(false, ft, u, true); cleanedAt(ft); }
      humans.forEach(h => { h.mesh.visible = step <= 3; });
      tipDots.forEach(d => { d.visible = step === 2; });
      humanC.visible = robotC.visible = links.visible = step === 3;
      cmdHand.forEach(x => { x.visible = false; });
      ahead.forEach((x, k) => { x.visible = step === 5 && !SO; if (step === 5 && !SO) refAt(f + [10, 20, 30][k], x); });
      searchAt(step === 5 && !SO, u, f); soAt(step === 5 ? s5 : null);
      const see = step === 4 || step === 0 || step === 3;   // the object see-through while the commanded hand is in it, the recorded hand, or the contacts behind it
      const op = step === 0 ? 0.25 : step === 3 ? 0.3 : 0.45;
      if (mat.object.transparent !== see || (see && mat.object.opacity !== op)) { mat.object.transparent = see; mat.object.opacity = see ? op : 1; mat.object.depthWrite = !see; mat.object.needsUpdate = true; }
      // contact fade is about the person's fingertips: the robot hand goes faint and the human hand comes forward
      const ro = step === 2 ? 0.25 : 1, so = step === 2 ? 0.85 : 0.5;
      if (mat.robot.opacity !== ro) { mat.robot.opacity = ro; mat.robot.depthWrite = ro === 1; mat.robot.needsUpdate = true; }
      if (mat.skin.opacity !== so) { mat.skin.opacity = so; mat.skin.needsUpdate = true; }
      if (step === 2) {
        objectWorld();
        const D = humans.map(({ g }) => { const P = g.attributes.position.array; return MANO_TIPS.map(v => nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])); });
        humans.forEach(({ g }, hk) => {
          const P = g.attributes.position.array;
          MANO_TIPS.forEach((v, k) => {
            const d = tipDots[hk * MANO_TIPS.length + k], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], dist = D[hk][k], phi = Math.exp(-Math.max(0, dist - 0.002) / SIGMA);
            d.position.set(x, y, z); d.scale.setScalar(0.25 + 1.15 * phi); d.material.opacity = 0.07 + 0.93 * phi;   // far: a faint speck; on the object: full
          });
        });
      }
      if (step === 3 && step !== shown) {
        objectWorld();
        setCloud(humanC, contactsOf(humans.map(h => [h.g.attributes.position.array, null]), 0.008));
        setCloud(robotC, contactsOf(wuji.map((m, k) => { m.updateMatrix(); return [geos[handIdx[k]].attributes.position.array, m.matrix]; }), 0.006));
        setLinks(humanC.userData.pts, robotC.userData.pts);
      }
      if (step === 4 && ppC) {
        objectWorld();
        cmdIdx.forEach((i, k) => { cmdHand[k].visible = true; partAt(i, f, cmdHand[k], ppC, pqC); });
      }
      shown = step;
      return spot(step);
    }
    const objWorld = (v) => v.copy(ob.position).applyMatrix4(root.matrixWorld);
    // the refine stop looks through the object at the hand: from the far side, so the part inside shows through it
    // the push seen side-on: across its mean direction, a little from above, so the arrows show their length
    function pushView(v) {
      if (pushDir.lengthSq() < 1e-8) return null;
      const d = pushDir.clone().normalize(); v.set(-d.y, d.x, 0); if (v.lengthSq() < 1e-6) v.set(1, 0, 0); v.normalize(); v.z = 0.45; v.normalize();
      return v.transformDirection(root.matrixWorld);
    }
    function throughView(spot, v) {
      v.copy(ob.position).sub(spot); v.z = 0; if (v.lengthSq() < 1e-8) v.set(1, 0, 0); v.normalize(); v.z = 0.55; v.normalize();
      return v.transformDirection(root.matrixWorld);
    }
    const LMA = L[`human_${meta.acting}_lm`] && C.arr(pour.buf, L[`human_${meta.acting}_lm`]);
    const lmF = (f, j, v) => { const b = Math.max(0, Math.min(LMA.length / 63 - 1, Math.round(f / HE))) * 63 + j * 3; return v.set(LMA[b] * HU, LMA[b + 1] * HU, LMA[b + 2] * HU); };
    const pw = new T.Vector3(), pi = new T.Vector3(), pk = new T.Vector3(), pn = new T.Vector3(), pa = new T.Vector3();
    // the contact seen side-on: perpendicular to the line from the object's centre out to the spot, a little from above, so
    // neither the hand nor the object hides it
    function sideView(spotL, v, prefer) {
      const rr = v3.copy(spotL).sub(ob.position); rr.z = 0; if (rr.lengthSq() < 1e-8) rr.set(1, 0, 0); rr.normalize();
      const sd = new T.Vector3(-rr.y, rr.x, 0), up = new T.Vector3(0, 0, 0.5), m = new T.Matrix3().setFromMatrix4(root.matrixWorld);
      const s1 = sd.clone().add(up).addScaledVector(rr, 0.35).normalize().applyMatrix3(m).normalize();
      const s2 = sd.clone().negate().add(up).addScaledVector(rr, 0.35).normalize().applyMatrix3(m).normalize();
      return v.copy(s1.dot(prefer) >= s2.dot(prefer) ? s1 : s2);
    }
    // contact fade: the last 0.8 s of the reach, replayed; seen across the fingertips' path so the gap to the surface shows
    let fadeWin = [Math.max(f0, fMove - 26), Math.min(f1, fMove + 2)];
    // with the recorded tips' distances (the refine export): the 1.5 s before the fingertips first reach the object
    // (from far, up to 12 cm, to on it), ending at the touch, before any lift
    if (RF && RF.tipsd) {
      const K = RF.tipsd.length / 5, W = 22, m = k => { let a = 0; for (let j = 0; j < 5; j++) a += Math.min(120, Math.max(0, RF.tipsd[k * 5 + j] * 0.1)); return a / 5; };
      let far = false, bk = -1;
      for (let k = 0; k < K; k++) { const d = m(k); if (d > 30) far = true; else if (far && d < 8) { bk = k; break; } }
      if (bk > 0) fadeWin = [Math.max(0, (bk - W) * HE), Math.min(N - 1, bk * HE + 2)];
    }
    const tA = new T.Vector3(), tB = new T.Vector3(), tmp = new T.Object3D();
    // the hand that reaches: the one whose fingertips are nearest the object when the reach ends
    const oEnd = new T.Object3D(); partAt(objIdx[0], fadeWin[1], oEnd);
    const reachSide = sides.map(sd => { let d = 0; const l = tipIdx.filter(i => meta.parts[i].group === sd); l.forEach(i => { partAt(i, fadeWin[1], tmp); d += tmp.position.distanceTo(oEnd.position); }); return [sd, d / l.length]; })
      .sort((x, y) => x[1] - y[1])[0][0];
    const actTips = tipIdx.filter(i => meta.parts[i].group === reachSide);
    const tipMean = (f, v) => { v.set(0, 0, 0); actTips.forEach(i => { partAt(i, f, tmp); v.add(tmp.position); }); return v.multiplyScalar(1 / actTips.length); };
    function approachView(v, prefer) {
      tipMean(fadeWin[0], tA); tipMean(fadeWin[1], tB);
      const d = tB.clone().sub(tA).normalize(), up = new T.Vector3(0, 0, 1);
      let sd = d.clone().cross(up); if (sd.lengthSq() < 1e-4) sd.set(1, 0, 0); sd.normalize();
      const m = new T.Matrix3().setFromMatrix4(root.matrixWorld);
      const s1 = sd.clone().addScaledVector(up, 0.25).normalize().applyMatrix3(m).normalize(), s2 = sd.clone().negate().addScaledVector(up, 0.25).normalize().applyMatrix3(m).normalize();
      return v.copy(s1.dot(prefer) >= s2.dot(prefer) ? s1 : s2);
    }
    const fadeTravel = (() => { tipMean(fadeWin[0], tA); tipMean(fadeWin[1], tB); return tA.distanceTo(tB); })();   // how far the fingertips come, for the camera
    function approachSpot(v) { tipMean(fadeWin[0], tA); tipMean(fadeWin[1], v); return v.lerp(tA, 0.45).applyMatrix4(root.matrixWorld); }
    // the grip stop: across the thumb's move from where it stops to its target, a little from above, so the curl shows
    const thIdx = cmdIdx.map((i, k) => /_finger1_link4$/.test(meta.parts[i].name) && meta.parts[i].group === meta.acting ? k : -1).filter(k => k >= 0);
    const gA = new T.Vector3(), gB = new T.Vector3(), gO = new T.Object3D();
    function gripView(f, v, prefer) {
      if (!ppC || !thIdx.length) return null;
      gA.set(0, 0, 0); gB.set(0, 0, 0);
      thIdx.forEach(k => { partAt(cmdIdx[k], f, gO); gA.add(gO.position); partAt(cmdIdx[k], f, gO, ppC, pqC); gB.add(gO.position); });
      const d = gB.sub(gA); if (d.lengthSq() < 1e-8) return null; d.normalize();
      const up = new T.Vector3(0, 0, 1), s1 = new T.Vector3().crossVectors(d, up); if (s1.lengthSq() < 1e-6) s1.set(1, 0, 0);
      s1.normalize().addScaledVector(up, 0.45).normalize();
      const s2 = s1.clone().set(-s1.x, -s1.y, s1.z), m = new T.Matrix3().setFromMatrix4(root.matrixWorld);
      s1.applyMatrix3(m).normalize(); s2.applyMatrix3(m).normalize();
      return v.copy(s1.dot(prefer) >= s2.dot(prefer) ? s1 : s2);
    }
    function palmView(f, v, prefer) {               // from the palm's side and across the knuckles, a little above: where the contacts are
      if (!LMA) return null;
      lmF(f, 0, pw); lmF(f, 5, pi); lmF(f, 17, pk);
      pa.copy(pk).sub(pi).normalize();                                        // across the knuckles
      pn.copy(pi).sub(pw).cross(pk.clone().sub(pw)).normalize();             // the palm's normal, turned toward the object
      if (pn.dot(v3.copy(ob.position).sub(pw)) < 0) pn.negate();
      // mostly along the palm's normal (through the object, onto the palm and the finger pads), a little across the
      // knuckles and from above; never from under the desk
      const sv = sg => { const x = pn.clone().addScaledVector(pa, 0.35 * sg); x.z += 0.2; if (x.z < -0.05) x.z = -0.05; return x.normalize(); };
      const s1 = sv(1), s2 = sv(-1);
      const m = new T.Matrix3().setFromMatrix4(root.matrixWorld);
      s1.applyMatrix3(m).normalize(); s2.applyMatrix3(m).normalize();
      return v.copy(s1.dot(prefer) >= s2.dot(prefer) ? s1 : s2);
    }
    // the pair at the shape frame, with the person's hands there too; side 0 = bone term off, 1 = on
    const humanGhosts = pair ? pair.map(pp2 => humans.map(h => { const m2 = new T.Mesh(h.g, mat.skin); m2.frustumCulled = false; m2.renderOrder = 2; pp2.grp.add(m2); return m2; })) : null;
    // the person's bones at the shape frame, from the recording's 21 landmarks: the line each robot finger should lie along
    const LM = pair && L[`human_${meta.acting}_lm`] ? C.arr(pour.buf, L[`human_${meta.acting}_lm`]) : null;
    const lmAt = (j) => { const b = Math.round(meta.shape.frame / HE) * 63 + j * 3; return new T.Vector3(LM[b] * HU, LM[b + 1] * HU, LM[b + 2] * HU); };
    // the person's index finger as bones, inside their own hand mesh: joint centres are the means of MANO vertex rings
    // (wrist, index MCP / PIP / DIP, middle MCP; picked from the MANO joint regressor's heaviest vertices, within ~4 mm
    // of it), the bone ends a little inside the fingertip vertex. Each bone is shaped like the real one: a broad base,
    // a shaft flattened palm to back and bowed toward the back, and a head with two condyles (a rounded head on the
    // metacarpal, a flat tuft on the distal phalanx). Ivory with a thin rim, drawn over everything.
    const RING = [[33,34,37,38,39,44,45,50,51,52,53,84,85,91,106,107,110,111,116,119,190,191,192,193,205,209,210,211,232,235],
      [11,13,15,62,63,64,65,93,127,128,129,132,137,138,144,149,150,168,169,170,171,172,173,176,186,258,259,260,263,274],
      [46,47,48,49,56,57,58,59,86,87,133,134,155,156,164,165,166,167,174,175,176,189,195,212,213,223,225,226,280,283],
      [224,294,295,296,297,298,299,300,301,316,330,341],
      [74,75,76,137,143,151,185,186,187,220,228,246,247,262,263,269,270,276,277,288,368,369,370,371,378,379,380,383,386,399]];
    const actH = humans[sides.indexOf(meta.acting)];
    if (pair && actH) {
      const hf = Math.min(actH.NH - 1, Math.round(meta.shape.frame / HE)) * actH.NV * 3;
      const vtx = i => new T.Vector3(actH.hv[hf + i * 3] * HU, actH.hv[hf + i * 3 + 1] * HU, actH.hv[hf + i * 3 + 2] * HU);
      const ring = ids => ids.reduce((v, i) => v.add(vtx(i)), new T.Vector3()).multiplyScalar(1 / ids.length);
      const [J0, J1, J2, J3, J4] = RING.map(ring), tip = vtx(317);
      const ivory = new T.MeshStandardMaterial({ color: 0xf1e7cf, roughness: 0.72, emissive: 0x2c2216, emissiveIntensity: 0.22, transparent: true, opacity: 1, depthTest: false });
      const rim = new T.MeshBasicMaterial({ color: 0x8a6846, side: T.BackSide, transparent: true, opacity: 0.85, depthTest: false });
      // kind: 0 metacarpal, 1 phalanx (proximal / middle), 2 distal phalanx; local frame x across, y along, z toward the back
      function boneGeo(len, r, kind) {
        const NR = 40, NA = 28, pos = [], idx = [];
        for (let i = 0; i <= NR; i++) {
          const u = i / NR, t = 0.5 - 0.5 * Math.cos(Math.PI * u);                    // denser at the ends
          const base = Math.exp(-Math.pow(t / 0.15, 2)), head = Math.exp(-Math.pow((1 - t) / 0.14, 2));
          const w = kind === 2 ? 0.62 + 0.8 * base + 0.7 * head                         // thin shaft, broad base, spade tuft
                  : 1 + (kind === 0 ? 0.35 : 0.5) * base + (kind === 0 ? 0.55 : 0.3) * head;
          const flat = kind === 2 ? 0.55 + 0.25 * base : 0.78 + 0.12 * head;             // palm-to-back over side-to-side
          const end = Math.pow(Math.max(0, 1 - Math.pow(2 * t - 1, 2 * (kind === 0 ? 5 : 6))), 0.5);
          const bow = (kind === 2 ? 0.01 : 0.045) * len * Math.sin(Math.PI * t);         // bowed toward the back
          for (let k = 0; k < NA; k++) {
            const th = (k / NA) * Math.PI * 2, cx = Math.cos(th), sz = Math.sin(th);
            const x = r * w * end * cx, z = r * w * flat * end * sz + bow;
            // the head's two condyles: pull the middle of the end in, on the palm side most
            const groove = kind === 1 ? 0.22 * r * head * Math.exp(-Math.pow(cx / 0.42, 2)) * (sz < 0 ? 1 : 0.35) : 0;
            pos.push(x, (t - 0.5) * len - groove * (t > 0.5 ? 1 : 0), z);
          }
        }
        for (let i = 0; i < NR; i++) for (let k = 0; k < NA; k++) {
          const a0 = i * NA + k, a1 = i * NA + (k + 1) % NA, b0 = a0 + NA, b1 = a1 + NA;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
        const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        return g;
      }
      const curl = J3.clone().sub(J2).sub(J2.clone().sub(J1));                         // the finger bends toward the palm
      const across = J4.clone().sub(J1).normalize();
      const GAP = 0.0012;
      const segs = [[J1, J2, 0.0039, 1], [J2, J3, 0.0032, 1], [J3, J3.clone().lerp(tip, 0.84), 0.0026, 2]];
      // the bones hang from the index knuckle of the robot in the "ours" panel, the same place in both panels
      const knuckle = handIdx.findIndex(i => new RegExp(`^/?${meta.acting}_finger2_link1$`).test(meta.parts[i].name));
      pair.forEach(p2 => { p2.bones = new T.Group(); p2.grp.add(p2.bones); p2.boneAt = J1.clone(); p2.boneFwd = tip.clone().sub(J1).normalize(); p2.knuckle = knuckle; });
      pair.forEach(p2 => segs.forEach(([a0, a1, rad, kind]) => {
        const d = a1.clone().sub(a0), L0 = d.length(); d.normalize();
        const x = across.clone().addScaledVector(d, -across.dot(d)).normalize();
        let z = new T.Vector3().crossVectors(x, d);                                       // y = d, x across, z = x cross y
        if (curl.lengthSq() > 1e-8 && z.dot(curl) > 0) { x.negate(); z.negate(); }        // z toward the back of the hand
        const M = new T.Matrix4().makeBasis(x, d, z);
        const len = Math.max(0.004, L0 - 2 * GAP), g = boneGeo(len, rad, kind), c = a0.clone().addScaledVector(d, L0 / 2);
        const o = new T.Mesh(g, rim); o.quaternion.setFromRotationMatrix(M); o.position.copy(c); o.scale.set(1.16, 1 + 0.0014 / len, 1.16); o.renderOrder = 7; p2.bones.add(o);
        const m = new T.Mesh(g, ivory); m.quaternion.setFromRotationMatrix(M); m.position.copy(c); m.renderOrder = 8; p2.bones.add(m);
      }));
    }
    function showPair(k) {
      const fS = meta.shape.frame, p2 = pair[k];
      pair.forEach((q, j) => { q.grp.visible = j === k; }); root.visible = false;
      p2.hand.forEach((m, j) => partAt(handIdx[j], fS, m, p2.P, p2.Q)); p2.obj.forEach((m, j) => partAt(objIdx[j], fS, m, p2.P, p2.Q));
      handAt(fS);
      if (p2.bones && p2.knuckle >= 0) {          // the person is the same in both panels: both take the knuckle of "ours" (bone term on)
        const kn = new T.Object3D(); partAt(handIdx[p2.knuckle], fS, kn, pair[1].P, pair[1].Q);
        p2.bones.position.copy(kn.position).sub(p2.boneAt).multiplyScalar(1 - 0.4)    // 40 % of the way back into the person's hand,
          .addScaledVector(p2.boneFwd, 0.014);                                       // and 14 mm toward the fingertip, onto the yellow finger
      }
      p2.grp.updateMatrixWorld(true);
    }
    function pairSpot(v) {                          // the acting hand's fingers, world frame
      v.set(0, 0, 0); [5, 9, 13, 17, 8, 12, 16, 20].forEach(j => v.add(lmAt(j))); v.multiplyScalar(1 / 8); return v.applyMatrix4(pair[1].grp.matrixWorld);
    }
    function pairView(v) {                          // look along the knuckles (index to pinky): the fingers in profile, their bend visible
      v.copy(lmAt(17)).sub(lmAt(5)).normalize(); v.z = Math.max(v.z, 0) + 0.35;   // and a little from above
      return v.transformDirection(pair[1].grp.matrixWorld);
    }
    function endPair() { pair.forEach(q => { q.grp.visible = false; }); root.visible = true; }
    return { name, root, search: SO && { hold: SO.hold, end: SO.end, phase: searchPhase }, fadeTravel, hasClean: !!ppO, throughView, pushView, palmView, gripView, sideView, fadeWin, approachView, approachSpot, pair: pair && { groups: pair.map(q => q.grp), show: showPair, spot: pairSpot, view: pairView, end: endPair, shape: meta.shape }, N, FPS, f0, f1, STOPS, fRef, place, overlays, center, radius, AZ, objWorld, reset: () => { shown = -1; } };
  }

  // ---- the view: it follows the object half way and, at a stop, leans in on the spot that step is about
  const look = new T.Vector3(), lookT = new T.Vector3(), roiW = new T.Vector3(), viewDir = new T.Vector3(0, 0.5, 1).normalize();
  let dist = 0; const camDir = new T.Vector3();
  const NEAR = [0.85, 0.7, 0.9, 0.6, 0.75, 1.25];         // metres from the spot, per step: the recorded hand, the hand, the fingertips, the contacts, the pressing fingers
  const splitEl = fig.querySelector(".rw-split");

  // ---- playback: play at a reading pace, hold at each stop, loop
  const keyEl0 = document.getElementById("rwKey");
  if (keyEl0 && window.ResizeObserver) new ResizeObserver(() => fig.style.setProperty("--keyh", keyEl0.offsetHeight + "px")).observe(keyEl0);   // the split's caption sits above the key, however many lines it takes
  const keyEl = keyEl0, prog = document.getElementById("rwProg"), playBtn = document.getElementById("rwPlay"), hud = fig.querySelector(".rw-hud");
  const btns = [...fig.querySelectorAll(".rw-steps button")], clipBtns = [...fig.querySelectorAll(".rw-clips button")];
  let t = 0, step = -1, hold = 0, paused = false, visible = false, last = null, el5 = 0, sway = 0;   // sway: the camera's slow drift, stopped while paused
  const holdFor = i => i === 0 ? HOLD0 : i === 2 ? HOLD2 : i === 3 ? HOLD3 : i === 5 && cur && cur.search ? cur.search.hold : HOLD;
  // drag to turn: an offset on the stop's own view, kept while the stop lasts, eased away when the next one begins
  let drag = null, dAz = 0, dEl = 0, relax = false;
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, az: dAz, el: dEl }; relax = false; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => { if (!drag) return; dAz = drag.az - (e.clientX - drag.x) * 0.008; dEl = Math.max(-1.2, Math.min(1.2, drag.el + (e.clientY - drag.y) * 0.006)); });
  const endDrag = () => { drag = null; canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", () => { relax = true; });
  function setStep(k) {
    if (k !== step) { relax = true; el5 = 0; }
    step = k;
    btns.forEach(b => { const i = +b.dataset.s; b.classList.toggle("on", i === k); b.classList.toggle("past", i < k); });
    // each swatch stays with its words when the key wraps
    keyEl.innerHTML = k >= 0 ? KEYS[k].split("&ensp;").map(x => `<span class="ki">${x}</span>`).join("") : "";
    keyEl.classList.toggle("show", k >= 0);
  }
  function use(clip) {
    if (cur) { scene.remove(cur.root); if (cur.pair) cur.pair.groups.forEach(g => scene.remove(g)); }
    if (drawn && drawn !== cur) scene.remove(drawn.root);
    cur = clip; drawn = clip; scene.add(clip.root); if (clip.pair) clip.pair.groups.forEach(g => scene.add(g)); clip.reset();

    key.target.position.copy(clip.center); key.position.copy(clip.center).add(new T.Vector3(-0.35, 2.0, 0.55));
    t = clip.f0; setStep(-1); hold = 0.4; look.copy(clip.center);
    fig.classList.add("ready");
  }
  const FADE_ALT = { mustard: "mustard4" };
  let drawn = null;                                 // the clip whose scene is in the stage (cur, or its fadeAlt at the contact fade stop)
  function pick(name) {
    want = name;
    clipBtns.forEach(b => { const on = b.dataset.clip === name; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    if (clips[name]) { use(clips[name]); return; }
    // Mustard's own take starts with the hand already on the bottle, so its contact fade stop plays the reach of another
    // take of the same bottle (FADE_ALT); every other stop stays on the clip itself
    const alt = FADE_ALT[name];
    Promise.all([C.load(`real_${name}`), C.load(`refine_${name}`).catch(() => null), C.load(`open_${name}`).catch(() => null), C.load(`search_${name}`).catch(() => null), C.load(`searchhand_${name}`).catch(() => null),
      alt ? Promise.all([C.load(`real_${alt}`), C.load(`refine_${alt}`).catch(() => null)]).catch(() => null) : null])
      .then(([d, rf, op, sr, so, ad]) => {
        if (!clips[name]) { clips[name] = build(name, d, rf, op, sr, so); if (ad) clips[name].fadeAlt = build(alt, ad[0], ad[1], null); }
        if (want === name) use(clips[name]);
      }).catch(e => console.error(e));
  }
  btns.forEach(b => b.addEventListener("click", () => { if (!cur) return; const i = +b.dataset.s; t = cur.STOPS[i]; setStep(i); hold = holdFor(i); el5 = 0; cur.reset(); }));
  clipBtns.forEach(b => b.addEventListener("click", () => pick(b.dataset.clip)));
  function setPaused(p) { paused = p; playBtn.classList.toggle("paused", p); playBtn.setAttribute("aria-label", p ? "Play" : "Pause"); }
  playBtn.addEventListener("click", () => setPaused(!paused));
  setPaused(!!FT.reduced);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; last = null; }, { rootMargin: "60px" }).observe(fig);
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); pick(clipBtns[0].dataset.clip); } }, { rootMargin: "300px" });
  io.observe(fig);

  // the contact transport stop: the contact print on its own canvas over the stage, loaded for the clip on first use
  const printCanvas = fig.querySelector(".rw-print"), stageEl = fig.querySelector(".rw-stage");
  let printer = null, printFor = null, printClock = 0, printShown = false;
  function printAt(on) {
    if (on && !printer && window.FTPrint && printCanvas) {
      printer = window.FTPrint(printCanvas, null); fig.printer = printer;   // fig.printer: for checking
      printer.st.loop(() => { if (printer.ready()) printer.draw(printClock); });
    }
    if (on && printer && printFor !== cur.name) { printFor = cur.name; printer.load(`otwalk_${cur.name}`, `walk_${cur.name}`); }
    const show = on && printer && printer.ready() && printFor === cur.name;
    if (!!show === printShown) return;
    printShown = !!show; stageEl.classList.toggle("print", printShown);
    if (printer) { if (printShown) printer.st.anim.resume(); else printer.st.anim.pause(); }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden || !cur) return;
    const s = now / 1000, dt = last == null ? 0 : Math.min(0.05, s - last); last = s;
    if (!paused && !drag) sway += dt;
    if (!paused && !drag) {
      if (hold > 0) { hold -= dt; if (step === 5 && cur.search) { el5 = cur.search.hold - Math.max(0, hold); if (hold <= 0) { t = cur.f0; setStep(-1); hold = 0.6; cur.reset(); } } }   // the search stop ends the walk: back to the start, never the run on without its search
      else {
        t += dt * cur.FPS * SPEED;
        const next = SKIP.has(step + 1) ? step + 2 : step + 1;   // a stop no longer on the list plays through
        if (next < cur.STOPS.length && t >= cur.STOPS[next]) { t = cur.STOPS[next]; setStep(next); hold = holdFor(next); }
        else if (t >= cur.f1) { t = cur.f0; setStep(-1); hold = 0.6; cur.reset(); }
      }
    }
    let tShow = t;
    let phase = "raw", phaseU = 0;
    if (step === 0) {                                // as recorded (slowly, around the grasp), then the push out (still), then the result
      const el = Math.max(0, HOLD0 - hold), third = HOLD0 / 3;   // frozen while paused
      phase = el < third ? "raw" : el < 2 * third || !cur.hasClean ? "push" : "clean";
      const ph = (el % third) / third; phaseU = ph;
      const ez = ph * ph * (3 - 2 * ph);              // the recording comes up to the moment, holds for the push, then goes on from it
      tShow = Math.max(cur.f0, Math.min(cur.f1, phase === "push" ? cur.fRef : phase === "raw" ? cur.fRef - 10 * (1 - ez) : cur.fRef + 10 * ez));
      const want = phase === "raw" ? KEYS[0] : phase === "push" ? KEY_PUSH : KEY_CLEAN;
      if (keyEl.dataset.k !== phase) { keyEl.dataset.k = phase; keyEl.innerHTML = want.split("&ensp;").map(x => `<span class="ki">${x}</span>`).join(""); }
    } else if (keyEl.dataset.k) delete keyEl.dataset.k;
    const vc = step === 2 && (hold > 0 || paused) && cur.fadeAlt ? cur.fadeAlt : cur;
    if (drawn !== vc) { scene.remove(drawn.root); scene.add(vc.root); drawn = vc; vc.reset(); }
    if (step === 2 && (hold > 0 || paused)) {        // the approach, slowly, again and again: the targets grow as the fingertips near
      const [a, b] = vc.fadeWin, ph = ((HOLD2 - Math.max(0, hold)) / FADE_LOOP) % 1;   // frozen while paused   // from the reach's start when the stop begins
      tShow = a + (b - a) * Math.min(1, ph / 0.8);
    }
    const s5 = step === 5 && cur.search && vc === cur && (hold > 0 || paused) ? cur.search.phase(el5) : null;
    if (s5) tShow = s5.t;
    if (hud) {                                       // which plan, which round: the receding horizon, counted
      const txt = s5 ? `plan ${s5.wi + 1} of ${s5.n}&ensp;·&ensp;${s5.c > 0 ? "<b>running its first 0.15 s</b>" : `round ${s5.rr + 1} of ${s5.rounds}`}` : "";
      if (hud.dataset.t !== txt) { hud.dataset.t = txt; hud.innerHTML = txt; hud.classList.toggle("show", !!s5); }
    }
    vc.place(tShow);
    const printing = step === 3 && (hold > 0 || paused);
    if (printing && !paused) printClock = Math.min(HOLD3 - Math.max(0, hold), 12);
    if (!printing) printClock = 0;
    printAt(printing);
    const spot = vc.overlays(step, Math.round(tShow), phase, step === 5 ? (paused ? 1 : hold > 0 ? Math.max(0, Math.min(1, (HOLD - hold) / HOLD)) : 2) : phaseU, tShow, s5);   // step 5: how far through its stop (2: past it, the run goes on)
    prog.style.width = `${(100 * (t - cur.f0) / (cur.f1 - cur.f0)).toFixed(1)}%`;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) r.setSize(w, h, false);
    // step 1 splits the stage: the fingertips-only stage on the left, ours on the right, one camera
    const split = step === 1 && !!vc.pair, vw = split ? w / 2 : w;
    fig.classList.toggle("split", split);
    camera.aspect = vw / h; camera.updateProjectionMatrix();
    const holding = (hold > 0 || paused) && step >= 0 && (spot || split);

    if (split) { vc.pair.show(1); vc.pair.spot(roiW); } else if (holding && step === 2) vc.approachSpot(roiW); else if (holding) vc.root.localToWorld(roiW.copy(spot)); else roiW.copy(vc.center).lerp(vc.objWorld(lookT), 0.5);
    look.lerp(roiW, 0.07);
    const A = vc.AZ + (FT.reduced ? 0 : 0.1 * Math.sin(sway * 0.2)), E = 0.5;
    const wide = Math.max(1, 1.6 * h / w);         // the full stage's width, also when split
    const far = vc.radius / Math.sin(camera.fov * Math.PI / 360) * 0.74 * wide;
    const near0 = step === 0 && phase === "push" ? 0.42 : step === 0 && phase === "clean" ? 0.55 : step === 2 ? Math.max(NEAR[2], 3.4 * (vc.fadeTravel || 0)) : NEAR[step];   // the push and its result are seen up close
    const want = holding && step < NEAR.length ? Math.min(far, near0 * wide) : far;
    dist = dist ? dist + (want - dist) * 0.06 : want;
    if (split) {                                    // the fingers in profile; the view eases there and back
      vc.pair.view(lookT); viewDir.lerp(lookT, 0.08).normalize();
    } else {
      lookT.set(Math.cos(E) * Math.sin(A), Math.sin(E), Math.cos(E) * Math.cos(A));
      if (holding && step === 0 && phase !== "raw" && vc.pushView(lookT)) { /* side-on to the push, and to its result from the same side */ }
      else if (holding && step === 0 && spot) vc.throughView(spot, lookT);
      else if (holding && step === 2) vc.approachView(lookT, lookT.clone());
      else if (holding && step === 3 && vc.palmView(tShow, lookT, lookT.clone())) { /* from the palm's side, through the object: the contacts face the camera */ }
      else if (holding && step === 4 && vc.gripView(tShow, lookT, lookT.clone())) { /* across the thumb's curl */ }
      else if (holding && step >= 3 && step <= 4 && spot) vc.sideView(spot, lookT, lookT.clone());
      viewDir.lerp(lookT, 0.08).normalize();
    }
    if (relax && !drag) { dAz *= 0.9; dEl *= 0.9; if (Math.abs(dAz) + Math.abs(dEl) < 1e-3) { dAz = dEl = 0; relax = false; } }
    camDir.copy(viewDir);
    if (dAz || dEl) {
      const az = Math.atan2(camDir.x, camDir.z) + dAz, el = Math.max(0.04, Math.min(1.45, Math.asin(Math.max(-1, Math.min(1, camDir.y))) + dEl));
      camDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    }
    camera.position.copy(look).addScaledVector(camDir, dist);
    camera.lookAt(look);
    r.setScissorTest(split);
    if (split) {
      vc.pair.show(0); r.setViewport(0, 0, vw, h); r.setScissor(0, 0, vw, h); r.render(scene, camera);
      vc.pair.show(1); r.setViewport(vw, 0, vw, h); r.setScissor(vw, 0, vw, h); r.render(scene, camera);
      vc.pair.end();
    } else {
      r.setViewport(0, 0, w, h); r.render(scene, camera);
    }
  }
  requestAnimationFrame(frame);
})();
