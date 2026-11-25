/* One Markov-expert take, replayed in its own physics (static/hero/gentake.*, tools/export_gentake.py): cube -> bowl,
   seed 12, a recovery take whose event drops the cube while it is carried. The stage draws the bodies MuJoCo actually
   simulates: both MANO capsule hands (manosim: 15 capsules + a palm per hand, no welds), the cube and the bowl, with every
   hand-cube contact as a dot and the force it puts on the cube as an arrow. The side panel follows the generator's loop
   (state -> expert -> noise and events -> physics step) at the same moment; the timeline below is the take, scrubbable. */
window.FTGenTake = (function () {
  if (!window.Clay || !window.THREE) return null;
  const C = Clay, T = THREE;
  const NAMES = { "initial": "start", "left:approach:cube": "approach", "left:descend:cube": "descend", "left:close:cube": "close",
                  "left:carry:cube": "carry", "left:lower:cube": "lower", "left:done": "done" };
  // what in the state sends the expert to each mode (read off the expert's mode logic)
  const WHY = { approach: "hand empty, cube on the desk: go above it", descend: "above the cube: go down around it",
                close: "fingers around the cube: close", carry: "cube in the grip: lift it and carry it to the bowl",
                lower: "over the bowl: set the cube down", done: "cube in the bowl: open and leave", start: "" };

  // the take's bodies and contact marks under root; show(i) poses frame i and returns its number of finger contacts
  function build(root, { meta, buf }, o = {}) {
    const L = meta.layout, N = meta.n, FPS = meta.fps, NP = meta.parts.length;
    const poses = C.arr(buf, L.poses), con = C.arr(buf, L.contacts), modeIx = C.arr(buf, L.mode), valid = C.arr(buf, L.valid), height = C.arr(buf, L.height);
    const modes = meta.modes.map(m => NAMES[m] || m);
    const skin = C.clay(0xd9ac8f, { transparent: false }), skinR = C.clay(0xe3c3ad, { transparent: false });
    const cubeM = C.clay(0xf2a93b, { transparent: false }), bowlM = C.clay(0xd8d2c6, { transparent: false, side: T.DoubleSide });
    const cyl = new T.CylinderGeometry(1, 1, 1, 18, 1, true), sph = new T.SphereGeometry(1, 18, 12);
    const objs = meta.parts.map(p => {
      const g0 = new T.Group();
      if (p.kind === "capsule") {
        const mat = p.side === "left" ? skin : skinR, inner = new T.Group();
        inner.rotation.x = Math.PI / 2;                       // three's cylinder runs along y, MuJoCo's capsule along z
        const c = new T.Mesh(cyl, mat); c.scale.set(p.radius, 2 * p.half, p.radius);
        const a = new T.Mesh(sph, mat), b = new T.Mesh(sph, mat);
        a.scale.setScalar(p.radius); b.scale.setScalar(p.radius); a.position.y = p.half; b.position.y = -p.half;
        [c, a, b].forEach(m => { m.castShadow = true; inner.add(m); });
        g0.add(inner);
      } else {
        const g = C.geometry(C.arr(buf, L[`mesh_${p.mesh}_v`]), C.arr(buf, L[`mesh_${p.mesh}_f`]));
        const mat = p.side === "cube" ? cubeM : p.side === "left" ? skin : p.side === "right" ? skinR : bowlM;
        const m = new T.Mesh(g, mat); m.castShadow = true; g0.add(m);
      }
      root.add(g0);
      return g0;
    });
    // contacts: a dot where a finger touches the cube, an arrow for the force on the cube
    const MAXC = L.contacts.shape[1], k = o.mark || 1;
    const dotGeo = new T.SphereGeometry(0.0042 * k, 12, 8), coneGeo = new T.ConeGeometry(0.0045 * k, 0.012 * k, 12);
    const green = new T.MeshBasicMaterial({ color: 0x22b37a, depthTest: false });
    const marks = Array.from({ length: MAXC }, () => {
      const dot = new T.Mesh(dotGeo, green), head = new T.Mesh(coneGeo, green);
      const line = new T.Line(new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(6), 3)), new T.LineBasicMaterial({ color: 0x22b37a, depthTest: false }));
      [dot, head, line].forEach(x => { x.renderOrder = 9; root.add(x); });
      return { dot, head, line };
    });
    const qq = new T.Quaternion(), a3 = new T.Vector3(), b3 = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    function show(f) {
      const i = Math.max(0, Math.min(N - 1, Math.round(f)));
      for (let j = 0; j < NP; j++) {
        const q = (i * NP + j) * 7;
        objs[j].position.set(poses[q], poses[q + 1], poses[q + 2]);
        objs[j].quaternion.copy(qq.set(poses[q + 4], poses[q + 5], poses[q + 6], poses[q + 3]));
      }
      let nc = 0;
      marks.forEach((mk, j) => {
        const q = (i * MAXC + j) * 6, live = con[q] || con[q + 1] || con[q + 2] || con[q + 3] || con[q + 4] || con[q + 5];
        mk.dot.visible = !!live; mk.head.visible = mk.line.visible = false;   // the contact dots only (the force arrows were taken off)
        if (!live) return;
        nc++;
        a3.set(con[q], con[q + 1], con[q + 2]);
        mk.dot.position.copy(a3);
      });
      return nc;
    }
    return { N, FPS, dur: (N - 1) / FPS, modes, modeIx, valid, height, event: meta.event, show,
             center: new T.Vector3(0.1, 0.02, 0.06), radius: 0.3 };
  }
  return { load: () => C.load("gentake"), build, WHY };
})();

// ---- the Demos section's figure (#genTake)
(function () {
  const fig = document.getElementById("genTake");
  if (!fig || !window.FTGenTake) return;
  const C = Clay, T = THREE, G = FTGenTake, WHY = G.WHY;
  const canvas = fig.querySelector(".gt-stage canvas");
  const S = C.stage(canvas, { az: 2.55, el: 0.5, fit: 0.9 });

  G.load().then(data => {
    const tk = G.build(S.root, data), { N, FPS, modes, modeIx, valid, height } = tk;
    const phone = innerWidth <= 640;   // phones: closer and aimed a little higher, the small stage was mostly empty
    S.frameOn(phone ? tk.center.clone().add(new T.Vector3(0, 0, 0.06)) : tk.center, tk.radius * (phone ? 0.8 : 1), 0);

    // ---- side panel and timeline
    const $ = s => fig.querySelector(s);
    const modeList = $(".gt-modes");
    const shown = modes.filter(m => m !== "start");
    shown.forEach(m => { const li = document.createElement("li"); li.textContent = m; li.dataset.m = m; modeList.appendChild(li); });
    const items = [...modeList.children];
    const hEl = $("#gtH"), cEl = $("#gtC"), tEl = $("#gtT"), whyEl = $("#gtWhy"), evBox = $(".gt-b.ev"), evBadge = $(".gt-event");
    const svg = $(".gt-time svg"), NS = "http://www.w3.org/2000/svg";
    const el = (tag, a, p = svg) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; };
    const dur = tk.dur, ev = tk.event;
    let X, cursor;
    const COLORS = { approach: "#e9e4da", descend: "#efd5c4", close: "#f6c99a", carry: "#f2a93b", lower: "#f6c99a", done: "#dfe3e8", start: "#eef0f2" };
    function drawTimeline() {
      const W = Math.max(320, svg.getBoundingClientRect().width || 800), H = 120, ml = 88, mr = 10;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = "";
      X = t => ml + (W - ml - mr) * t / dur;
      el("text", { x: ml - 8, y: 22, "text-anchor": "end", class: "lab" }).textContent = "expert mode";
      let a = 0;
      for (let i = 1; i <= N; i++) {
        if (i === N || modeIx[i] !== modeIx[a]) {
          const m = modes[modeIx[a]], x0 = X(a / FPS), x1 = X(Math.min(i, N - 1) / FPS);
          el("rect", { x: x0, y: 10, width: Math.max(0.5, x1 - x0 - 1), height: 18, rx: 3, fill: COLORS[m] || "#eee" });
          if (x1 - x0 > 46) el("text", { x: (x0 + x1) / 2, y: 23, "text-anchor": "middle", class: "seg" }).textContent = m;
          a = i;
        }
      }
      // cube height above the desk
      const hy = v => 100 - 56 * Math.min(1, v / 0.16);
      el("text", { x: ml - 8, y: 66, "text-anchor": "end", class: "lab" }).textContent = "cube height";
      el("line", { x1: ml, x2: W - mr, y1: 100, y2: 100, class: "base" });
      el("text", { x: ml - 8, y: 103, "text-anchor": "end", class: "tick" }).textContent = "desk";
      let d = "";
      for (let i = 0; i < N; i++) d += (i ? "L" : "M") + X(i / FPS).toFixed(1) + "," + hy(Math.max(0, height[i] - height[0])).toFixed(1);
      el("path", { d, class: "h" });
      if (ev && ev.start_s != null) {
        el("rect", { x: X(ev.start_s), y: 6, width: Math.max(3, X(ev.end_s) - X(ev.start_s)), height: 98, class: "evr" });
        el("text", { x: X(ev.end_s) + 5, y: 46, class: "evl" }).textContent = "drop · labels off";
      }
      for (let s = 0; s <= dur; s += 2) el("text", { x: X(s), y: 117, "text-anchor": "middle", class: "tick" }).textContent = s + " s";
      cursor = el("line", { x1: 0, x2: 0, y1: 6, y2: 104, class: "cur" });
      const hit = el("rect", { x: ml, y: 0, width: W - ml - mr, height: H, fill: "transparent", style: "cursor: pointer" });
      const seek = e => { const b = svg.getBoundingClientRect(); t = Math.max(0, Math.min(dur, (e.clientX - b.left - ml) / (b.width - ml - mr) * dur)); };
      hit.addEventListener("pointerdown", e => { scrub = true; seek(e); hit.setPointerCapture(e.pointerId); });
      hit.addEventListener("pointermove", e => { if (scrub) seek(e); });
      hit.addEventListener("pointerup", () => { scrub = false; });
    }
    let t = 0, scrub = false, playing = !(window.FT && FT.reduced);
    const pp = $(".gt-pp");
    pp.addEventListener("click", () => { playing = !playing; pp.classList.toggle("paused", !playing); });
    pp.classList.toggle("paused", !playing);
    drawTimeline(); window.addEventListener("resize", drawTimeline);

    let lastMode = -1;
    function show(f) {
      const i = Math.max(0, Math.min(N - 1, Math.round(f)));
      const nc = tk.show(i);
      // side panel
      const m = modes[modeIx[i]];
      if (modeIx[i] !== lastMode) {
        items.forEach(li => li.classList.toggle("on", li.dataset.m === m));
        const back = lastMode >= 0 && shown.indexOf(m) < shown.indexOf(modes[lastMode]);
        modeList.classList.toggle("back", back);
        whyEl.textContent = WHY[m] || "";
        lastMode = modeIx[i];
      }
      hEl.textContent = `${Math.max(0, (height[i] - height[0]) * 100).toFixed(1)} cm`;
      cEl.textContent = nc ? `${nc} finger contacts` : "none";
      tEl.textContent = `${(i / FPS).toFixed(1)} s`;
      const inEv = !valid[i] && i > 0;
      evBox.classList.toggle("on", inEv); evBadge.classList.toggle("on", inEv);
      if (cursor) { cursor.setAttribute("x1", X(i / FPS)); cursor.setAttribute("x2", X(i / FPS)); }
    }
    S.loop((tt, dt) => {
      if (playing && !scrub) { t += dt; if (t > dur + 1.2) t = 0; }
      show(Math.min(t, dur) * FPS);
    });
    show(0);
  }).catch(e => console.error(e));
})();
