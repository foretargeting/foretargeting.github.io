/* Scripted demo -> target landmarks, from real data (static/hero/scripted.*, tools/export_scripted.py).
   One fill_bowl demo, first item: the left hand puts a strawberry into the bowl the right hand holds.
   mode 0  the scripted demo: assist welds glue the strawberry (and the bowl) to the hand (red links)
   mode 1  the same demo re-run in physics with every weld removed; green = the target landmarks (the
           commands the re-run found), clay = the hand those commands reach
   FTScripted.build() puts the scene into any clay stage's z-up root; FTScripted.code() animates the
   script beside it: steps type in as the demo reaches them, and the welds are struck out for the re-run. */
window.FTScripted = (function () {
  const T = window.THREE, C = window.Clay;
  if (!T || !C) return null;
  const GREEN = 0x22b37a, RED = 0xe5545b;
  const COLORS = { bowl: 0xd7d0c5, strawberry: 0xd9675f, rubber_duck: 0xeec559, hacky_sack: 0x8fa3c4 };

  // the steps of the script, in the names the demo logs them under (meta.controller gives the numbers)
  const SCRIPT = [
    { code: 'right.hold("bowl")', steps: ["regrip"] },
    { code: 'weld(right, "bowl")', weld: 0, note: "assist" },
    { code: 'left.approach("strawberry")', steps: ["clear", "approach"] },
    { code: 'left.lower_open("strawberry")', steps: ["lower_open"] },
    { code: 'left.pinch("strawberry")', steps: ["pinch"] },
    { code: 'left.lift_check(0.04)', steps: ["lift_check", "hold_check"] },
    { code: 'weld(left, "strawberry")', weld: 1, note: "assist", steps: ["secure"] },
    { code: 'left.lift(travel_height=0.32)', steps: ["lift"] },
    { code: 'left.carry(over="bowl")', steps: ["carry"] },
    { code: 'left.lower_to_bowl(drop=0.08)', steps: ["lower_to_bowl"] },
    { code: 'unweld(left, "strawberry")', weld: -1, steps: ["release"] },
    { code: 'left.withdraw()', steps: ["withdraw", "settle"] }
  ];
  const stepOf = label => (label.split(":")[1] || label.split(":")[0]);

  function capsule(r, h) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; pts.push(new T.Vector2(r * Math.cos(a), -h + r * Math.sin(a))); }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new T.Vector2(r * Math.cos(a), h + r * Math.sin(a))); }
    const g = new T.LatheGeometry(pts, 14);
    g.rotateX(Math.PI / 2);                          // MuJoCo capsules run along local z
    return g;
  }
  const quat = (q, a, i) => q.set(a[i + 1], a[i + 2], a[i + 3], a[i]);   // w x y z -> three

  // the scene, into `root` (a z-up group). o.landmarks: draw the target landmarks through everything
  function build(root, { meta, buf }, o) {
    o = o || {};
    const L = meta.layout, NB = meta.bodies.length, n = meta.n;
    const poses = [C.arr(buf, L.demo_pose), C.arr(buf, L.ours_pose)];
    const tgt = C.arr(buf, L.target), weld = C.arr(buf, L.weld);
    const skin = C.clay(0xd9ac8f), mats = [skin];
    const objMat = {};
    const groups = meta.bodies.map(name => {
      const g = new T.Group();
      root.add(g);
      if (COLORS[name] != null) { objMat[name] = C.clay(COLORS[name], name === "bowl" ? { side: T.DoubleSide } : {}); mats.push(objMat[name]); }
      return g;
    });
    const meshGeo = [];
    for (let k = 0; k < meta.meshes; k++) meshGeo.push(C.geometry(new Float32Array(C.arr(buf, L[`mesh_${k}_v`])), C.arr(buf, L[`mesh_${k}_f`])));
    const capCache = {};
    meta.geoms.forEach(gm => {
      const name = meta.bodies[gm.b];
      const geo = gm.type === "mesh" ? meshGeo[gm.mesh]
        : gm.type === "capsule" ? (capCache[gm.size.join()] = capCache[gm.size.join()] || capsule(gm.size[0], gm.size[1]))
        : null;
      if (!geo) return;
      const m = new T.Mesh(geo, objMat[name] || skin);
      m.position.set(gm.pos[0], gm.pos[1], gm.pos[2]);
      m.quaternion.set(gm.quat[1], gm.quat[2], gm.quat[3], gm.quat[0]);
      m.castShadow = true;
      groups[gm.b].add(m);
    });

    // assist welds: a red link from the palm to the welded object
    const palmLocal = new T.Vector3(...meta.geoms.find(g => g.b === 0 && g.type === "mesh").pos);
    const weldMat = new T.LineDashedMaterial({ color: RED, dashSize: 0.008, gapSize: 0.006, transparent: true, depthTest: false });
    const dotMat = new T.MeshBasicMaterial({ color: RED, transparent: true, depthTest: false });
    const dotGeo = new T.SphereGeometry(0.0055, 12, 8);
    const welds = meta.weld_pairs.map(() => {
      const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), weldMat);
      line.renderOrder = 4;
      const a = new T.Mesh(dotGeo, dotMat), b = new T.Mesh(dotGeo, dotMat);
      a.renderOrder = b.renderOrder = 4;
      root.add(line, a, b);
      return { line, a, b };
    });

    // target landmarks: 21 per hand, with the MANO bones between them
    const LM = 42;
    const lmMat = new T.MeshBasicMaterial({ color: GREEN, transparent: true, depthTest: !o.landmarks });
    const lm = new T.InstancedMesh(new T.SphereGeometry(o.dot || 0.0048, 12, 8), lmMat, LM);
    lm.renderOrder = 3;
    const BONES = [];
    for (const [a, b, c, tip] of [[1, 2, 3, 16], [4, 5, 6, 17], [7, 8, 9, 18], [10, 11, 12, 19], [13, 14, 15, 20]]) BONES.push([0, a], [a, b], [b, c], [c, tip]);
    const boneGeo = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(BONES.length * 2 * 2 * 3), 3));
    const boneMat = new T.LineBasicMaterial({ color: GREEN, transparent: true, depthTest: !o.landmarks });
    const bones = new T.LineSegments(boneGeo, boneMat);
    bones.renderOrder = 3;
    root.add(lm, bones);

    // framing: the strawberry's path, the bowl and both wrists
    const op = poses[1], box = new T.Box3(), v = new T.Vector3();
    const si = meta.bodies.indexOf("strawberry"), bi = meta.bodies.indexOf("bowl"), ri = meta.bodies.indexOf("right_mano_body_0");
    for (let f = 0; f < n; f += 4) for (const b of [si, bi, 0, ri]) box.expandByPoint(v.set(op[(f * NB + b) * 7], op[(f * NB + b) * 7 + 1], op[(f * NB + b) * 7 + 2]));
    const center = box.getCenter(new T.Vector3()), radius = box.getSize(new T.Vector3()).length() / 2;

    const qa = new T.Quaternion(), qb = new T.Quaternion(), m4 = new T.Matrix4(), tmp = new T.Vector3(), tmp2 = new T.Vector3();
    function set(f, mode, alpha) {
      f = Math.max(0, Math.min(n - 1.001, f));
      const i = Math.floor(f), s = f - i, P = poses[mode];
      for (let b = 0; b < NB; b++) {
        const j = (i * NB + b) * 7, k = ((i + 1) * NB + b) * 7, g = groups[b];
        g.position.set(P[j] + (P[k] - P[j]) * s, P[j + 1] + (P[k + 1] - P[j + 1]) * s, P[j + 2] + (P[k + 2] - P[j + 2]) * s);
        g.quaternion.copy(quat(qa, P, j + 3)).slerp(quat(qb, P, k + 3), s);
      }
      const a = alpha == null ? 1 : alpha;
      mats.forEach(m => { m.opacity = a; m.depthWrite = a > 0.98; });
      // welds (demo only)
      const r = Math.round(f);
      meta.weld_pairs.forEach(([h, ob], w) => {
        const on = mode === 0 && weld[r * 4 + w] === 1;
        const W = welds[w];
        W.line.visible = W.a.visible = W.b.visible = on && a > 0.05;
        if (!on) return;
        groups[h].updateMatrix();
        tmp.copy(palmLocal).applyMatrix4(groups[h].matrix);
        tmp2.copy(groups[ob].position);
        const p = W.line.geometry.attributes.position;
        p.setXYZ(0, tmp.x, tmp.y, tmp.z); p.setXYZ(1, tmp2.x, tmp2.y, tmp2.z); p.needsUpdate = true;
        W.line.computeLineDistances();
        W.a.position.copy(tmp); W.b.position.copy(tmp2);
      });
      weldMat.opacity = dotMat.opacity = a;
      // landmarks (re-run only)
      const showLm = mode === 1;
      lm.visible = bones.visible = showLm && a > 0.05;
      if (showLm) {
        for (let h = 0; h < 2; h++) for (let p = 0; p < 21; p++) {
          const j = ((i * 2 + h) * 21 + p) * 3, k = (((i + 1) * 2 + h) * 21 + p) * 3;
          m4.makeTranslation(tgt[j] + (tgt[k] - tgt[j]) * s, tgt[j + 1] + (tgt[k + 1] - tgt[j + 1]) * s, tgt[j + 2] + (tgt[k + 2] - tgt[j + 2]) * s);
          lm.setMatrixAt(h * 21 + p, m4);
        }
        lm.instanceMatrix.needsUpdate = true;
        const bp = boneGeo.attributes.position.array;
        let q = 0;
        for (let h = 0; h < 2; h++) for (const [x, y] of BONES) for (const e of [x, y]) {
          const j = ((i * 2 + h) * 21 + e) * 3;
          bp[q++] = tgt[j]; bp[q++] = tgt[j + 1]; bp[q++] = tgt[j + 2];
        }
        boneGeo.attributes.position.needsUpdate = true;
        lmMat.opacity = a; boneMat.opacity = 0.75 * a;
      }
    }
    // which script line runs at frame f, and whether a weld is on
    const lines = new Int16Array(n).fill(0);
    let cur = 0;
    meta.phases.forEach(([f0, label], k) => {
      const st = stepOf(label), li = SCRIPT.findIndex(l => (l.steps || []).includes(st));
      const end = k + 1 < meta.phases.length ? meta.phases[k + 1][0] : n;
      if (li >= 0) cur = li;
      for (let f = f0; f < end; f++) lines[f] = cur;
    });
    return {
      n, fps: meta.fps, center, radius, desk: meta.desk_z, set,
      line: f => lines[Math.max(0, Math.min(n - 1, Math.round(f)))],
      weldOn: (f, w) => weld[Math.max(0, Math.min(n - 1, Math.round(f))) * 4 + w] === 1
    };
  }

  // the script, typed in as the demo runs it (DOM, for the tour)
  function code(el) {
    const head = el.querySelector(".code-head .file"), status = el.querySelector(".code-status"), pre = el.querySelector("code");
    pre.innerHTML = SCRIPT.map((l, i) => `<span class="ln${l.weld != null ? " w" : ""}" data-i="${i}"><span class="txt"></span><span class="cm"></span></span>`).join("");
    const rows = [...pre.querySelectorAll(".ln")];
    let last = "";
    return function render(sc, f, mode) {
      const li = sc.line(f), key = `${mode}|${li}|${Math.floor(f)}`;
      if (key === last) return;
      last = key;
      rows.forEach((row, i) => {
        const l = SCRIPT[i], txt = row.firstChild, cm = row.lastChild;
        let shown;
        if (mode === 1) shown = l.code;
        else if (i < li || (i === 1 && li >= 1)) shown = l.code;
        else if (i === li) shown = l.code.slice(0, Math.max(1, Math.round((f - startOf(sc, i)) * 2.2)));
        else shown = "";
        if (txt.textContent !== shown) txt.textContent = shown;
        const wOn = l.weld === 0 ? sc.weldOn(f, 0) : l.weld === 1 ? sc.weldOn(f, 1) : false;
        cm.textContent = l.weld == null || !shown ? "" : mode === 1 ? "  # removed" : l.note ? `  # ${l.note}` : "";
        row.classList.toggle("on", i === li && (mode === 1 || shown.length));
        row.classList.toggle("typing", mode === 0 && i === li && shown.length < l.code.length);
        row.classList.toggle("hot", mode === 0 && wOn && !!shown);
        row.classList.toggle("struck", mode === 1 && l.weld != null);
      });
      head.textContent = mode === 1 ? "fill_bowl.py · re-run, no welds" : "fill_bowl.py · scripted demo";
      status.innerHTML = mode === 1
        ? '<span class="g">●</span> no welds: <b>green = target landmarks</b> (the commands), clay = the hand they reach'
        : (sc.weldOn(f, 1) ? '<span class="r">●</span> assist weld on: the strawberry is glued to the hand' : '<span class="r">●</span> assist weld on: the bowl is glued to the right hand');
    };
  }
  const starts = new WeakMap();
  function startOf(sc, i) {
    let s = starts.get(sc);
    if (!s) {
      s = new Array(SCRIPT.length).fill(0);
      const seen = new Set();
      for (let f = 0; f < sc.n; f++) { const l = sc.line(f); if (!seen.has(l)) { seen.add(l); s[l] = f; } }
      starts.set(sc, s);
    }
    return s[i];
  }

  return { load: () => C.load("scripted"), build, code, SCRIPT };
})();
