/* "Refine the reference" (#rfFig): one real Aria recording (a person lifts a mustard bottle; held out, never tuned on),
   in two steps, with a scrubber and a depth strip under it. All of it is the clip's own data:
   static/hero/real_mustard.* (tools/export_realclip.py: the recorded MANO hands, the recorded object, and the
   refined Wuji reference of our human-like retargeter, the whole-motion solve hik6 as "alton") and static/hero/refine_mustard.*
   (tools/export_refine.py: signed depth of every MANO vertex in the object from its distance grid, the fingertips'
   distance and nearest surface point, the deepest point of hand and reference per frame, the reference's fingertips).
   1 Raw human data: the recorded hand, red where it is inside the object, and dashed lines where a fingertip floats
     10-40 mm off it.
   2 Raw, in physics: the recorded hand executed as it is (tools/raw_servo.py: the capsule MANO hand's own position servos
     commanded to the recording, no correction, no search, the bottle free and where it was recorded). The hand starts
     inside the bottle, so the bottle is knocked out of it in the first frame. The whole clip plays: the hand (drawn as
     recorded) lifts as the person did, the bottle physics moved stays behind, and an amber outline shows where the
     bottle should be. The strip shows how far it is from there.
   3 Whole-motion solve: green arrows from the parts of the hand inside the bottle; the hand moves along them out of it
     (static/hero/refhand_mustard.*, tools/fit_refined_hand.py: the person's hand fitted to the refined Wuji reference,
     shape fixed, nothing inside the bottle), then the Wuji reference takes its place. The round inset shows the
     person's bones and the reference's side by side.
   A lens magnifies the part of the hand inside the bottle in steps 1 and 2.
   The strip: the deepest point of the human hand (red) and of the reference (blue) below the object's surface. */
(function () {
  const fig = document.getElementById("rfFig");
  if (!fig || !window.Clay || !window.THREE) return;
  const T = THREE, C = Clay, canvas = fig.querySelector(".rfx-stage canvas"), strip = fig.querySelector(".rfx-strip canvas");
  const keyEl = fig.querySelector(".rfx-key"), capEl = fig.querySelector(".rfx-cap"), range = fig.querySelector(".rfx-scrub input");
  const playBtn = fig.querySelector(".rfx-play"), tabs = [...fig.querySelectorAll(".rfx-tabs button")];
  const stripLabel = fig.querySelector(".rfx-sl"), stripLegend = fig.querySelector(".rfx-lg");
  const TIPS = [4, 8, 12, 16, 20];                        // fingertip landmarks
  let azOff = 0, elOff = 0;                               // the visitor's drag (and window.FTRefine.az) turns the view
  const KEYS = [
    "<i class='rd'></i>inside the object&ensp;<i class='am dash'></i>a fingertip floating 10–40 mm off it",
    "<i class='gh'></i>the bottle in physics&ensp;<i class='am ol'></i>where the person held it&ensp;<i class='rd'></i>the hand, inside it",
    "<i class='rb'></i>the refined Wuji reference&ensp;<i class='sk'></i>the person's hand"
  ];
  const CAPS = [
    "The recorded hand sinks up to 28 mm into the bottle, and some fingertips hover beside it.",
    "Executed as recorded on the MANO hand's own servos, with no correction: the hand starts inside the bottle and knocks it out in the first frame, then lifts without it.",
    "Solved as one problem over the whole motion, the Wuji reference stays outside the bottle."
  ];
  let step = 0, t = 0, playing = !FT.reduced, visible = false, last = null, ready = false, D = null;
  let pt = 0, wrapped = false;                                             // step 3: time since the push began (s)
  const P_ARROW = 1.1, P_MOVE = 2.7, P_ROBOT = 3.5, P_HOLD = 4.2;   // the hand inside with arrows out; it moves along them out of the bottle (a red ghost keeps where it was inside); the solved reference takes its place; then the view widens and the clip plays

  const near = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return;
    near.disconnect();
    Promise.all([C.load("real_mustard"), C.load("refine_mustard"), C.load("refhand_mustard").catch(() => null)]).then(([clip, rf, op]) => build(clip, rf, op)).catch(e => console.error(e));
  }, { rootMargin: "300px" });
  near.observe(fig);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(fig);

  // drag on the stage to turn the view around the hand: sideways turns it, up and down tilts it; a vertical swipe on a
  // phone still scrolls the page
  canvas.style.cursor = "grab"; canvas.style.touchAction = "pan-y";
  let drag = null;
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    azOff -= (e.clientX - drag.x) * 0.008; elOff = Math.max(-0.35, Math.min(0.95, elOff + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = e => { if (drag && e.pointerId === drag.id) { drag = null; canvas.style.cursor = "grab"; } };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
  r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), boneScene = new T.Scene(), camera = new T.PerspectiveCamera(26, 2, 0.01, 20);
  scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.9); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 5; key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3 });
  scene.add(key, key.target);
  const lensC = fig.querySelector(".rfx-lens canvas"), lensBox = fig.querySelector(".rfx-lens"), lensCap = fig.querySelector(".rfx-lens span");
  const r2 = lensC ? new T.WebGLRenderer({ canvas: lensC, antialias: true, alpha: true }) : null;
  if (r2) { r2.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r2.outputEncoding = T.sRGBEncoding; }
  const lensCam = new T.PerspectiveCamera(24, 1, 0.005, 5);

  function build(clip, rf, op) {
    const meta = clip.meta, L = meta.layout, N = meta.n, FPS = meta.fps, U = meta.pos_unit, HE = meta.hand_every, HU = meta.hand_unit, side = rf.meta.acting;
    const RL = rf.meta.layout, A = k => RL[k].dtype === "int8" ? new Int8Array(rf.buf, RL[k].offset, RL[k].shape.reduce((a, b) => a * b, 1)) : C.arr(rf.buf, RL[k]);
    const root = new T.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);
    const ground = new T.Mesh(new T.PlaneGeometry(3, 3), new T.ShadowMaterial({ opacity: 0.15 })); ground.position.z = -0.001; ground.receiveShadow = true; root.add(ground);
    const NG = meta.parts.length, pa = C.arr(clip.buf, L.poses_p_alton), qa = C.arr(clip.buf, L.poses_q_alton), ref = C.arr(clip.buf, L.ref_object);
    const geo = i => C.geometry(new Float32Array(C.arr(clip.buf, L[`mesh_${i}_v`])), C.arr(clip.buf, L[`mesh_${i}_f`]));
    const handIdx = meta.parts.map((p, i) => p.group === side ? i : -1).filter(i => i >= 0), objIdx = meta.parts.map((p, i) => p.group === "object" ? i : -1).filter(i => i >= 0);
    // the bottle, see-through so the part of the hand inside it shows; its outline drawn on top
    const objMat = new T.MeshStandardMaterial({ color: 0xc9d1da, roughness: 0.5, transparent: true, opacity: 0.34, depthWrite: false, side: T.DoubleSide });
    const objs = objIdx.map(i => { const m = new T.Mesh(geo(i), objMat); m.renderOrder = 3; root.add(m); return m; });
    // step 2: the bottle as physics moves it under the uncorrected hand, and its next positions as fading copies
    const raw = rf.meta.raw_phys ? Float32Array.from(rf.meta.raw_phys) : null;
    const physMat = new T.MeshStandardMaterial({ color: 0xd93a2b, roughness: 0.55, transparent: true, opacity: 0.45, depthWrite: false, side: T.DoubleSide });
    const heldMat = new T.MeshBasicMaterial({ color: 0xe8941f, wireframe: true, transparent: true, opacity: 0.15, depthWrite: false });
    const held = raw ? objIdx.map(i => { const g = new T.Mesh(geo(i), heldMat); g.renderOrder = 2; g.visible = false; root.add(g); return g; }) : [];
    const robotMat = new T.MeshStandardMaterial({ color: 0x434b57, roughness: 0.42, metalness: 0.2, transparent: true });
    const robot = handIdx.map(i => { const m = new T.Mesh(geo(i), robotMat); m.castShadow = true; root.add(m); return m; });
    const qA = new T.Quaternion(), qB = new T.Quaternion();
    function partAt(i, f, o) {
      f = Math.max(0, Math.min(N - 1.001, f)); const a = Math.floor(f), s = f - a, j = (a * NG + i) * 3, k = ((a + 1) * NG + i) * 3, jq = (a * NG + i) * 4, kq = ((a + 1) * NG + i) * 4;
      o.position.set((pa[j] + (pa[k] - pa[j]) * s) * U, (pa[j + 1] + (pa[k + 1] - pa[j + 1]) * s) * U, (pa[j + 2] + (pa[k + 2] - pa[j + 2]) * s) * U);
      qA.set(qa[jq + 1], qa[jq + 2], qa[jq + 3], qa[jq]).normalize(); qB.set(qa[kq + 1], qa[kq + 2], qa[kq + 3], qa[kq]).normalize(); o.quaternion.copy(qA).slerp(qB, s);
    }
    // the human hand: vertex colours from its depth in the object (skin, turning red inside)
    const HV = C.arr(clip.buf, L[`human_${side}_v`]), NV = HV.length / (L[`human_${side}_v`].shape[0] * 3), NH = L[`human_${side}_v`].shape[0];
    const dep = A("human_depth"), tipsd = A("human_tipsd"), tipnp = A("human_tipnp"), LM = C.arr(clip.buf, L[`human_${side}_lm`]);
    const hg = new T.BufferGeometry(); hg.setAttribute("position", new T.BufferAttribute(new Float32Array(NV * 3), 3));
    hg.setAttribute("color", new T.BufferAttribute(new Float32Array(NV * 3), 3)); hg.setIndex(new T.BufferAttribute(new Uint32Array(C.arr(clip.buf, L[`human_faces_${side}`])), 1));
    const skinMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 });
    const faintMat = new T.MeshStandardMaterial({ color: 0xd99a74, roughness: 0.62, transparent: true, opacity: 0.32, depthWrite: false });
    const human = new T.Mesh(hg, skinMat); human.castShadow = true; human.frustumCulled = false; root.add(human);
    const SKIN = new T.Color(0xe0b294).convertSRGBToLinear(), RED = new T.Color(0xd93a2b).convertSRGBToLinear(), col = new T.Color();
    const OPEN = op && { D: new Int16Array(op.buf, op.meta.layout.delta.offset, op.meta.layout.delta.shape.reduce((a, b) => a * b, 1)), dep: new Int8Array(op.buf, op.meta.layout.depth_open.offset, op.meta.layout.depth_open.shape.reduce((a, b) => a * b, 1)), unit: op.meta.unit };
    function humanAt(f, e = 0) {
      const g = Math.max(0, Math.min(NH - 1.001, f / HE)), a = Math.floor(g), s = g - a, p = hg.attributes.position.array, c = hg.attributes.color.array, k = Math.round(g);
      for (let v = 0; v < NV * 3; v++) p[v] = (HV[a * NV * 3 + v] + (HV[(a + 1) * NV * 3 + v] - HV[a * NV * 3 + v]) * s) * HU;
      if (OPEN && e > 0) for (let v = 0; v < NV * 3; v++) p[v] += OPEN.D[k * NV * 3 + v] * OPEN.unit * e;
      for (let v = 0; v < NV; v++) { const d = OPEN && e > 0 ? dep[k * NV + v] * (1 - e) + OPEN.dep[k * NV + v] * e : dep[k * NV + v]; col.copy(SKIN).lerp(RED, d < -1 ? Math.min(1, (-d) / 6) : 0); c[v * 3] = col.r; c[v * 3 + 1] = col.g; c[v * 3 + 2] = col.b; }
      hg.attributes.position.needsUpdate = true; hg.attributes.color.needsUpdate = true; hg.computeVertexNormals();
    }
    // the solve, step 3: green arrows push the parts of the recorded hand inside the bottle out to its surface (the fingers
    // open at their joints), then the Wuji reference takes the hand's place; thin lines along the bones, the human's in
    // skin and the robot's in blue, run side by side: the robot keeps the human's hand shape
    const arrowMat = new T.MeshBasicMaterial({ color: 0x16a34a, depthTest: false, transparent: true }), AY = new T.Vector3(0, 1, 0);
    const arrows = Array.from({ length: 6 }, () => {
      const g = new T.Group(), sh = new T.Mesh(new T.CylinderGeometry(0.0011, 0.0011, 1, 10), arrowMat), hd = new T.Mesh(new T.ConeGeometry(0.0032, 0.008, 16), arrowMat);
      sh.renderOrder = hd.renderOrder = 8; g.add(sh, hd); g.userData = { sh, hd }; g.visible = false; root.add(g); return g;
    });
    const av = new T.Vector3(), ad = new T.Vector3();
    function pushArrows(f, e, on) {
      arrows.forEach(a => { a.visible = false; });
      arrowMat.opacity = 1 - Math.max(0, Math.min(1, (e - 0.7) / 0.25));
      if (!on || !OPEN) return;
      const k = Math.round(Math.max(0, Math.min(NH - 1, f / HE))), P = hg.attributes.position.array, ins = [], picked = [];
      for (let v = 0; v < NV; v++) if (dep[k * NV + v] < -4) ins.push(v);
      ins.sort((a, b) => dep[k * NV + a] - dep[k * NV + b]);
      for (const v of ins) { if (picked.length >= arrows.length) break; av.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (picked.every(q => q.p.distanceTo(av) > 0.012)) picked.push({ v, p: av.clone() }); }
      picked.forEach(({ v, p }, j) => {
        ad.set(OPEN.D[(k * NV + v) * 3], OPEN.D[(k * NV + v) * 3 + 1], OPEN.D[(k * NV + v) * 3 + 2]).multiplyScalar(OPEN.unit);
        const L0 = ad.length() * (1 - e); if (L0 < 0.002) return;
        const g = arrows[j], { sh, hd } = g.userData, Lx = Math.max(0.01, L0 + 0.008), S = Lx - 0.008;
        sh.scale.set(1, S, 1); sh.position.set(0, S / 2, 0); hd.position.set(0, S + 0.004, 0);
        g.position.copy(p); g.quaternion.setFromUnitVectors(AY, ad.normalize()); g.visible = true;
      });
    }
    const boneG = new T.CylinderGeometry(1, 1, 1, 10), boneRoot = new T.Group(); boneRoot.rotation.x = -Math.PI / 2; boneScene.add(boneRoot);
    const humBoneMat = new T.MeshBasicMaterial({ color: 0xd9733f }), robBoneMat = new T.MeshBasicMaterial({ color: 0x1f7fc2 });
    const linkOf = {}; meta.parts.forEach((pp, i) => { if (!(pp.name in linkOf)) linkOf[pp.name] = i; });
    const CH = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    const bones = [];
    CH.forEach((ch, fgr) => [-1, 0, 1].forEach(b => {         // wrist to the finger's base, then its two bones: the person's joints and the reference's links
      const h = new T.Mesh(boneG, humBoneMat), rb = new T.Mesh(boneG, robBoneMat); h.visible = rb.visible = false; boneRoot.add(h, rb);
      const link = j => linkOf[`${side}_finger${fgr + 1}_link${j}`];
      bones.push({ h, r: rb, la: b < 0 ? 0 : ch[b], lb: ch[b + 1], pa: b < 0 ? linkOf[`${side}_wrist`] : link(b + 2), pb: link(b + 3) });
    }));
    const jointG = new T.SphereGeometry(1, 12, 8), joints = bones.flatMap(B => { const a = new T.Mesh(jointG, humBoneMat), b = new T.Mesh(jointG, robBoneMat); a.visible = b.visible = false; boneRoot.add(a, b); B.jh = a; B.jr = b; return [a, b]; });
    const ba = new T.Vector3(), bb = new T.Vector3(), bo = new T.Object3D(), bo2 = new T.Object3D();
    function setBone(m, a, b, rad) {
      ad.copy(b).sub(a); const L = ad.length(); if (L < 1e-4) { m.visible = false; return; }
      m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(AY, ad.normalize()); m.scale.set(rad, L, rad); m.visible = true;
    }
    // the person's joints on the moved hand: each landmark follows its nearest vertex's move
    const nearV = new Int32Array(21);
    for (let j = 0; j < 21; j++) { let b = 1e9; for (let v = 0; v < NV; v++) { const dx = HV[v * 3] - LM[j * 3], dy = HV[v * 3 + 1] - LM[j * 3 + 1], dz = HV[v * 3 + 2] - LM[j * 3 + 2], q = dx * dx + dy * dy + dz * dz; if (q < b) { b = q; nearV[j] = v; } } }
    const lmAt = (k, j, e, out) => { const x = (k * 21 + j) * 3, d = OPEN ? (k * NV + nearV[j]) * 3 : 0; return out.set(LM[x] * HU + (OPEN ? OPEN.D[d] * OPEN.unit * e : 0), LM[x + 1] * HU + (OPEN ? OPEN.D[d + 1] * OPEN.unit * e : 0), LM[x + 2] * HU + (OPEN ? OPEN.D[d + 2] * OPEN.unit * e : 0)); };
    const boneC = new T.Vector3(), w0 = new T.Vector3(), wi = new T.Vector3(), wp = new T.Vector3(), wm = new T.Vector3(), view = { c: new T.Vector3(), n: new T.Vector3(), up: new T.Vector3() };
    const W = v => new T.Vector3(v.x, v.z, -v.y);   // root (z up) -> world
    function bonesAt(f, show, e) {                    // in the inset: the person's bones (orange) and the reference's (blue), same frame
      const k = Math.round(Math.max(0, Math.min(NH - 1, f / HE))); boneC.set(0, 0, 0); let n = 0;
      bones.forEach(B => {
        const on = show && B.pa != null && B.pb != null; B.h.visible = B.r.visible = B.jh.visible = B.jr.visible = on; if (!on) return;
        lmAt(k, B.la, e, ba); lmAt(k, B.lb, e, bb); setBone(B.h, ba, bb, 0.0024); B.jh.position.copy(bb); B.jh.scale.setScalar(0.0036);
        partAt(B.pa, f, bo); partAt(B.pb, f, bo2); setBone(B.r, bo.position, bo2.position, 0.0024); B.jr.position.copy(bo2.position); B.jr.scale.setScalar(0.0036);
        boneC.add(bo2.position).add(bb); n += 2; if (B.la === 0) { boneC.add(bo.position).add(ba); n += 2; }   // the wrist counts once per finger, so the palm sits in the middle
      });
      if (!n) return null;
      // seen from the back of the person's hand, fingers up
      lmAt(k, 0, e, w0); lmAt(k, 5, e, wi); lmAt(k, 17, e, wp); lmAt(k, 9, e, wm);
      view.c.copy(W(boneC.multiplyScalar(1 / n)));
      const a = W(wi.sub(w0)), b = W(wp.sub(w0)); view.n.crossVectors(a, b).normalize(); if (side === "left") view.n.negate();
      view.up.copy(W(wm.sub(w0))).normalize();
      return view;
    }
    // the push's ghost: the recorded hand where it was, red and see-through, while the fingers come out of the bottle
    const ghostG = new T.BufferGeometry(); ghostG.setAttribute("position", new T.BufferAttribute(new Float32Array(NV * 3), 3));
    let ghostK = -1;                                  // the ghost keeps only the faces that were inside the bottle at that frame
    const ghostMat = new T.MeshBasicMaterial({ color: 0xd93a2b, transparent: true, opacity: 0, depthWrite: false });
    const ghost = new T.Mesh(ghostG, ghostMat); ghost.renderOrder = 5; ghost.frustumCulled = false; ghost.visible = false; root.add(ghost);
    const pushSpot = new T.Vector3();
    function ghostAt(f, op) {                         // op 0..1; the ghost and the spot inside the bottle the camera looks at
      ghost.visible = op > 0.01; ghostMat.opacity = 0.6 * op; if (!ghost.visible) return;
      const g = Math.max(0, Math.min(NH - 1, f / HE)), k = Math.round(g), a = ghostG.attributes.position.array;
      for (let v = 0; v < NV * 3; v++) a[v] = HV[k * NV * 3 + v] * HU;
      ghostG.attributes.position.needsUpdate = true;
      if (k !== ghostK) {
        ghostK = k; const F = hg.index.array, keep = [];
        for (let i = 0; i < F.length; i += 3) if (dep[k * NV + F[i]] < -1 && dep[k * NV + F[i + 1]] < -1 && dep[k * NV + F[i + 2]] < -1) keep.push(F[i], F[i + 1], F[i + 2]);
        ghostG.setIndex(keep);
      }
    }
    function pushSpotAt(f) {                          // the mean of the recorded hand's points more than 3 mm inside the bottle
      const k = Math.round(Math.max(0, Math.min(NH - 1, f / HE))); let n = 0; pushSpot.set(0, 0, 0);
      for (let v = 0; v < NV; v++) if (dep[k * NV + v] < -3) { pushSpot.x += HV[(k * NV + v) * 3] * HU; pushSpot.y += HV[(k * NV + v) * 3 + 2] * HU; pushSpot.z -= HV[(k * NV + v) * 3 + 1] * HU; n++; }
      return n > 8 ? pushSpot.multiplyScalar(1 / n) : null;
    }
    // the frame the push is shown at: where the recorded hand is deepest in the bottle
    let fStar = 0; { const dhA = A("depth_human"); let lo = 1e9; for (let f = 0; f < dhA.length; f++) if (dhA[f] < lo) { lo = dhA[f]; fStar = f; } }
    // floating fingertips: a dashed line from the tip landmark to the nearest surface point, when 10-40 mm off
    const gapMat = new T.LineDashedMaterial({ color: 0xe8941f, dashSize: 0.004, gapSize: 0.003, depthTest: false, transparent: true });
    const gaps = TIPS.map(() => { const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), gapMat); l.renderOrder = 6; root.add(l); return l; });
    const dotG = new T.SphereGeometry(0.0028, 10, 8), dotM = new T.MeshBasicMaterial({ color: 0xe8941f, depthTest: false });
    const gapDots = TIPS.map(() => { const d = new T.Mesh(dotG, dotM); d.renderOrder = 7; return d; });   // kept off the scene: the dashed line alone marks a floating tip
    function gapsAt(f) {
      const k = Math.round(Math.max(0, Math.min(NH - 1, f / HE)));
      TIPS.forEach((tp, j) => {
        const sd = tipsd[k * 5 + j] * 1e-4, show = step === 0 && sd > 0.01 && sd < 0.04, l = gaps[j];
        l.visible = gapDots[j].visible = show; if (!show) return;
        const a = l.geometry.attributes.position, b = (k * 21 + tp) * 3, c = (k * 5 + j) * 3;
        a.setXYZ(0, LM[b] * HU, LM[b + 1] * HU, LM[b + 2] * HU); a.setXYZ(1, tipnp[c] * HU, tipnp[c + 1] * HU, tipnp[c + 2] * HU); a.needsUpdate = true;
        l.computeLineDistances(); gapDots[j].position.set(tipnp[c] * HU, tipnp[c + 1] * HU, tipnp[c + 2] * HU);
      });
    }
    // the view: across the hand onto the bottle, framed on the whole clip
    const box = new T.Box3(), o3 = new T.Object3D();
    for (let f = 0; f < N; f += 6) { C.pose(o3, ref, N, f); box.expandByPoint(o3.position); handIdx.forEach(i => { partAt(i, f, o3); box.expandByPoint(o3.position); }); }
    const c = box.getCenter(new T.Vector3()), center = new T.Vector3(c.x, c.z, -c.y), radius = box.getSize(new T.Vector3()).length() * 0.5 + 0.03;
    C.pose(o3, ref, N, 0); const o0 = o3.position.clone(); partAt(handIdx[0], 0, o3);
    const AZ = Math.atan2(o3.position.x - o0.x, -(o3.position.y - o0.y)) + 0.9 + Math.PI;   // from the fingers' side, so the part inside the bottle shows through it
    key.target.position.copy(center); key.position.copy(center).add(new T.Vector3(-0.35, 2.0, 0.55));
    const dh = A("depth_human"), dr = A("depth_ref");
    // the lens follows the grasp: half way between the bottle and the human palm, at the hand's scale
    const pw = new T.Vector3(), ow = new T.Object3D();
    function focus(f, out) {
      const k = Math.round(Math.max(0, Math.min(NH - 1, f / HE))); pw.set(0, 0, 0);
      [0, 5, 9, 13, 17].forEach(j => { const b = (k * 21 + j) * 3; pw.x += LM[b] * HU / 5; pw.y += LM[b + 1] * HU / 5; pw.z += LM[b + 2] * HU / 5; });
      C.pose(ow, ref, N, f); pw.lerp(ow.position, 0.5);
      return out.set(pw.x, pw.z, -pw.y);
    }
    // the lens looks at the part of the hand inside the bottle: the mean of the vertices more than 3 mm in
    const pv = hg.attributes.position.array;
    function insideAt(f, out) {
      const k = Math.round(Math.max(0, Math.min(NH - 1, f / HE))); let n = 0; out.set(0, 0, 0);
      for (let v = 0; v < NV; v++) if (dep[k * NV + v] < -3) { out.x += pv[v * 3]; out.y += pv[v * 3 + 2]; out.z -= pv[v * 3 + 1]; n++; }
      return n > 8 ? out.multiplyScalar(1 / n) : null;
    }
    const oR = new T.Object3D();
    function bottleAt(f, m) {                        // step 2: the bottle where physics put it
      const phys = step === 1 && raw;
      m.material = phys ? physMat : objMat;
      C.pose(m, phys ? raw : ref, N, f);
    }
    function heldAt(f) { held.forEach(g => { g.visible = step === 1; if (g.visible) C.pose(g, ref, N, f); }); }
    // step 2's view takes in the hand, the bottle where it should be and the bottle where it is
    const pB = new T.Object3D(), pR = new T.Object3D();
    let span2 = 0.16;
    function flight(f, out) {
      C.pose(pB, raw, N, f); C.pose(pR, ref, N, f);
      const d = pB.position.distanceTo(pR.position);
      out.lerp(new T.Vector3(pB.position.x, pB.position.z, -pB.position.y), 0.45);
      span2 = Math.max(0.16, 0.6 * d + 0.12);
      return out;
    }
    // how far the bottle in physics is from where the person held it, per frame (mm)
    const off = new Float32Array(N);
    if (raw) for (let f = 0; f < N; f++) { C.pose(pB, raw, N, f); C.pose(pR, ref, N, f); off[f] = pB.position.distanceTo(pR.position) * 1000; }
    D = { flight, span2: () => span2, off, heldAt, N, FPS, center, radius, AZ, root, objs, robot, human, handIdx, objIdx, partAt, humanAt, gapsAt, ref, dh, dr, skinMat, faintMat, focus, LM, HU, insideAt, bottleAt, pushArrows, bonesAt, robotMat, ghostAt, pushSpotAt, fStar: () => fStar, hasOpen: !!OPEN };
    range.max = String(N - 1);
    ready = true; fig.classList.add("ready");
    setStep(0);
  }

  function setStep(k) {
    step = k;
    tabs.forEach((b, i) => { b.classList.toggle("on", i === k); b.setAttribute("aria-pressed", String(i === k)); });
    keyEl.innerHTML = KEYS[k].split("&ensp;").map(x => `<span class="ki">${x}</span>`).join("");
    if (capEl) capEl.textContent = CAPS[k];   // the caption line left the page; kept for a page that has one
    if (lensCap) lensCap.innerHTML = k === 2 ? "<i class='hb'></i>person&ensp;<i class='wb'></i>Wuji" : "inside the bottle, close up";
    lensSet = false;
    if (!D) return;
    D.robot.forEach(m => { m.visible = k === 2; });
    D.human.material = k === 2 ? D.faintMat : D.skinMat; D.human.castShadow = k !== 2;
    if (k === 2) { pt = 0; t = D.fStar(); wrapped = false; }
    if (k === 1) { t = 0; range.value = "0"; }
  }
  tabs.forEach((b, i) => b.addEventListener("click", () => setStep(i)));
  playBtn.addEventListener("click", () => { playing = !playing; playBtn.classList.toggle("paused", !playing); playBtn.setAttribute("aria-label", playing ? "Pause" : "Play"); });
  range.addEventListener("input", () => { t = +range.value; playing = false; playBtn.classList.add("paused"); playBtn.setAttribute("aria-label", "Play"); });
  if (!playing) playBtn.classList.add("paused");

  // the depth strip: 0 is the object's surface, down is inside
  function drawStrip() {
    const w = strip.clientWidth, h = strip.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (strip.width !== Math.round(w * dpr)) { strip.width = Math.round(w * dpr); strip.height = Math.round(h * dpr); }
    const x = strip.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const L = 74, R = 8, top = 10, bot = h - 8, X = f => L + (w - L - R) * f / (D.N - 1);
    x.font = "11px " + getComputedStyle(document.body).fontFamily; x.textBaseline = "middle"; x.textAlign = "right";
    const line = (a, color, width, Y, cap) => { x.strokeStyle = color; x.lineWidth = width; x.beginPath(); for (let f = 0; f < D.N; f++) { const y = Y(Math.min(a[f], cap)); f ? x.lineTo(X(f), y) : x.moveTo(X(f), y); } x.stroke(); };
    if (step === 1) {                                // how far the bottle is from where the person held it
      const hi = 400, Y = d => bot - (bot - top) * Math.max(0, Math.min(hi, d)) / hi;
      x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1; x.beginPath(); x.moveTo(L, Y(0)); x.lineTo(w - R, Y(0)); x.stroke();
      x.strokeStyle = "rgba(0,0,0,.08)"; x.beginPath(); x.moveTo(L, Y(300)); x.lineTo(w - R, Y(300)); x.stroke();
      x.fillStyle = "#6e6e73"; x.fillText("held", L - 8, Y(0)); x.fillText("30 cm off", L - 8, Y(300));
      line(D.off, "#d93a2b", 2, Y, hi);
    } else {                                         // 0 is the bottle's surface, down is inside
      const lo = -30, hi = 5, Y = d => top + (bot - top) * (hi - Math.max(lo, Math.min(hi, d))) / (hi - lo);
      x.fillStyle = "rgba(217,58,43,.07)"; x.fillRect(L, Y(0), w - L - R, bot - Y(0));
      x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1; x.beginPath(); x.moveTo(L, Y(0)); x.lineTo(w - R, Y(0)); x.stroke();
      x.fillStyle = "#6e6e73"; x.fillText("surface", L - 8, Y(0)); x.fillText("−28 mm", L - 8, Y(-28));
      x.strokeStyle = "rgba(0,0,0,.08)"; x.beginPath(); x.moveTo(L, Y(-28)); x.lineTo(w - R, Y(-28)); x.stroke();
      line(D.dh, step === 0 ? "#d93a2b" : "rgba(217,58,43,.45)", 2, Y, hi);
      line(D.dr, step === 2 ? "#1f7fc2" : "rgba(31,127,194,.45)", 2, Y, hi);
    }
    x.strokeStyle = "#1d1d1f"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(X(t), top - 4); x.lineTo(X(t), bot + 4); x.stroke();
    if (stripLabel) stripLabel.textContent = step === 1 ? "how far the bottle is from where the person held it" : "deepest point inside the bottle";
    if (stripLegend) stripLegend.hidden = step === 1;
  }

  const look = new T.Vector3(), dir = new T.Vector3(), tgt = new T.Vector3(), lensT = new T.Vector3(), lensAt = new T.Vector3(); let lookSet = false, lensSet = false, lensSet2 = false, zoom = 0; const lensDir = new T.Vector3(), lensUp = new T.Vector3(0, 1, 0);
  function frame(now) {
    requestAnimationFrame(frame);
    if (!ready || !visible || document.hidden) { last = now; return; }
    const dt = last == null ? 0 : Math.min(0.05, (now - last) / 1000); last = now;
    const solve = step === 2 && D.hasOpen;
    if (playing) {
      if (solve && pt < P_HOLD) pt += dt;
      else {                                           // step 3 plays the whole clip with the reference, then pushes again where the hand is deepest
        t += dt * D.FPS * 0.5;
        if (t > D.N - 1) { t = 0; wrapped = true; }
        if (solve && wrapped && t >= D.fStar()) { pt = 0; t = D.fStar(); wrapped = false; }
      }
      range.value = String(Math.round(t));
    }
    const tt = t;
    D.objs.forEach(m => D.bottleAt(tt, m)); D.heldAt(tt);
    const sm = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    const e = solve ? sm((pt - P_ARROW) / (P_MOVE - P_ARROW)) : step === 2 ? 1 : 0, rob = solve ? sm((pt - P_MOVE) / (P_ROBOT - P_MOVE)) : 1;
    D.ghostAt(tt, solve ? sm((pt - P_ARROW) / 0.4) * (1 - sm((pt - P_ROBOT) / 0.7)) : 0);
    if (step === 2) { D.robot.forEach((m, j) => D.partAt(D.handIdx[j], tt, m)); D.robotMat.opacity = rob; D.robotMat.depthWrite = rob > 0.98; D.robot.forEach(m => { m.visible = rob > 0.01; }); }
    if (solve) { D.human.material = rob > 0.35 ? D.faintMat : D.skinMat; D.human.castShadow = rob <= 0.35; }
    D.humanAt(tt, e); D.gapsAt(tt);
    D.pushArrows(tt, e, solve && pt > 0.15 && e < 0.95);
    const boneAt = D.bonesAt(tt, step === 2 && rob > 0.5, e);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) r.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const A = D.AZ + azOff + (FT.reduced || drag ? 0 : 0.08 * Math.sin(now / 5000)), E = 0.42 + elOff;
    D.focus(tt, tgt);
    if (solve && pt < P_ROBOT) { const sp = D.pushSpotAt(D.fStar()); if (sp) tgt.copy(sp); }   // the push: onto the part of the hand inside the bottle
    if (step === 1) D.flight(tt, tgt);                // step 2 widens onto the bottle it dropped
    if (!lookSet) { look.copy(tgt); lookSet = true; } else look.lerp(tgt, 0.08);
    dir.set(Math.cos(E) * Math.sin(A), Math.sin(E), Math.cos(E) * Math.cos(A));
    const span = step === 1 ? D.span2() : solve && pt < P_ROBOT ? 0.085 : 0.16;   // about 32 cm across the height, more in step 2, closer while the solve pushes the fingers out
    zoom = zoom ? zoom + (span - zoom) * 0.08 : span;
    const dist = zoom / Math.tan(camera.fov * Math.PI / 360) * Math.max(1, 1.4 * h / w);
    camera.position.copy(look).addScaledVector(dir, dist); camera.lookAt(look);
    r.render(scene, camera);
    // the lens: a close-up from the same side onto the part of the hand inside the bottle
    // step 3: the same inset shows the bones alone, the person's and the reference's, from the same side
    const spot = r2 ? (step === 0 ? D.insideAt(tt, lensT) : step === 2 && boneAt ? boneAt.c : null) : null;
    if (lensBox) { lensBox.classList.toggle("on", !!spot); lensBox.classList.toggle("bones", step === 2); }
    if (spot) {
      const lw = lensC.clientWidth; if (lensC.width !== Math.round(lw * r2.getPixelRatio())) r2.setSize(lw, lw, false);
      lensAt.lerp(spot, lensSet ? 0.15 : 1); lensSet = true;
      if (step === 2) { lensDir.lerp(boneAt.n, lensSet2 ? 0.1 : 1).normalize(); lensUp.lerp(boneAt.up, lensSet2 ? 0.1 : 1).normalize(); lensSet2 = true; lensCam.up.copy(lensUp); }
      else { lensDir.copy(dir); lensCam.up.set(0, 1, 0); lensSet2 = false; }
      lensCam.position.copy(lensAt).addScaledVector(lensDir, step === 2 ? 0.46 : 0.15); lensCam.lookAt(lensAt); lensCam.updateProjectionMatrix();
      r2.render(step === 2 ? boneScene : scene, lensCam);
    }
    drawStrip();
  }
  window.FTRefine = { az: a => { azOff = a; }, step: setStep, d: () => D, pt: v => { pt = v; }, t: v => { t = v; }, ready: () => ready };   // pt: step 3's time since the push began, for captures
  requestAnimationFrame(frame);
})();
