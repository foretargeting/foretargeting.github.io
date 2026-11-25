/* Every deployment on one globe, spun on a Wuji hand's fingertip: the real-robot trials and the simulated runs of the
   Deployment section play in small windows on the globe's surface (amber frame: real robot, blue: simulation). Only
   the windows facing the viewer play, a few at a time; the others show their poster. Drag to spin, hover to name a
   clip, click to open it in its gallery below. The hand is Wuji Hand 2.2 (static/live/wuji.json/.bin, the live demo's
   meshes and kinematics), posed by hand: the index straight up, the other fingers curled. */
(function () {
  const fig = document.getElementById("dgGlobe");
  if (!fig || !window.THREE || !window.WujiIK || !window.Clay) return;
  const T = THREE, C = Clay, IK = window.WujiIK;
  const canvas = fig.querySelector("canvas"), tip = fig.querySelector(".dg-tip");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DATA = "202611202225";               // the live demo's data version

  // ---- the clips: the real-robot takes, then every simulated task (names from the galleries' own task lists)
  const deploy = document.querySelector("#robots .deploy"), realPick = deploy && deploy.querySelector(".simg-pick select");
  const simPick = document.querySelector("#simGallery .simg-pick select");
  const nameOf = (sel, v) => { const o = sel && [...sel.options].find(o => o.value === v); return o ? o.textContent.trim() : v; };
  const REAL = [["write", "rw_writing_front"], ["apple", "rw_apple1_front"], ["apple", "rw_apple2_front"], ["sweep", "rw_sweep_front"],
    ["wipe", "rw_wipe_top"], ["rubik", "rw_rubik_top"], ["books", "rw_books_front"]];
  const simTasks = simPick ? [...simPick.options].map(o => o.value) : [];
  const sim = (hand, note) => simTasks.map(task => ({ kind: "sim", task, hand, label: nameOf(simPick, task), note, src: `static/media/sim/${task}_${hand}_fore` }));
  const real = REAL.map(([task, f]) => ({ kind: "real", task, file: f, label: nameOf(realPick, task), note: "real robot", src: `static/media/${f}` }));
  const wj = sim("wuji", "simulation, Wuji Hand 2.2"), mh = sim("mano", "simulation, human hand");
  const clips = [];                                  // interleaved, so neighbours on the globe differ
  for (let i = 0; i < Math.max(real.length, wj.length, mh.length); i++) for (const l of [wj, real, mh]) if (l[i]) clips.push(l[i]);

  let r, scene, camera, globe, spin, wins = [], hand, ready = false, visible = false;
  const R0 = 0.16, HS = 1.3;                  // the globe's radius (m); the hand, a little over life size
  const W = 0.078, H = W * 9 / 16;            // a window on the globe

  function roundedRect(w, h, rad) {
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + rad, y); s.lineTo(x + w - rad, y); s.quadraticCurveTo(x + w, y, x + w, y + rad); s.lineTo(x + w, y + h - rad);
    s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h); s.lineTo(x + rad, y + h); s.quadraticCurveTo(x, y + h, x, y + h - rad);
    s.lineTo(x, y + rad); s.quadraticCurveTo(x, y, x + rad, y);
    const g = new T.ShapeGeometry(s, 6), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
    return g;
  }
  // a shell of windows between the tropics-ish bands, spread like a Fibonacci sphere (none at the poles: the finger is below)
  function dirs(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = 0.86 - 1.6 * (i + 0.5) / n, rad = Math.sqrt(1 - y * y), th = i * 2.39996;
      out.push(new T.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).normalize());
    }
    return out;
  }

  function build(wj) {
    r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
    scene = new T.Scene(); camera = new T.PerspectiveCamera(30, 1, 0.01, 10);
    scene.add(new T.HemisphereLight(0xffffff, 0xc9c2b6, 0.8));
    const key = new T.DirectionalLight(0xffffff, 0.85); key.position.set(-0.6, 1.2, 1.0); scene.add(key);
    const rim = new T.DirectionalLight(0xfff1df, 0.3); rim.position.set(0.8, 0.2, -0.8); scene.add(rim);

    // the globe: a pale ball with a faint graticule, tilted a little, spinning about its own axis
    globe = new T.Group(); spin = new T.Group(); globe.add(spin); scene.add(globe);
    globe.position.set(0, 0.06, 0); globe.rotation.z = 0.12;
    spin.add(new T.Mesh(new T.SphereGeometry(R0, 72, 48), new T.MeshStandardMaterial({ color: 0xf1ede5, roughness: 0.85, metalness: 0 })));
    const pts = [];
    for (let lat = -60; lat <= 60; lat += 30) { const y = Math.sin(lat * Math.PI / 180) * R0 * 1.002, rr = Math.cos(lat * Math.PI / 180) * R0 * 1.002;
      for (let k = 0; k < 96; k++) { const a = k / 96 * 2 * Math.PI, b = (k + 1) / 96 * 2 * Math.PI; pts.push(rr * Math.cos(a), y, rr * Math.sin(a), rr * Math.cos(b), y, rr * Math.sin(b)); } }
    for (let lon = 0; lon < 180; lon += 30) { const c = Math.cos(lon * Math.PI / 180), s = Math.sin(lon * Math.PI / 180);
      for (let k = 0; k < 96; k++) { const a = k / 96 * 2 * Math.PI, b = (k + 1) / 96 * 2 * Math.PI, q = R0 * 1.002;
        pts.push(q * Math.cos(a) * c, q * Math.sin(a), q * Math.cos(a) * s, q * Math.cos(b) * c, q * Math.sin(b), q * Math.cos(b) * s); } }
    const grat = new T.BufferGeometry(); grat.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    spin.add(new T.LineSegments(grat, new T.LineBasicMaterial({ color: 0xb9b2a6, transparent: true, opacity: 0.45 })));

    // the windows
    const loader = new T.TextureLoader(), face = roundedRect(W, H, 0.006), frame = roundedRect(W + 0.006, H + 0.006, 0.008);
    // a simulated clip is three views side by side: its window shows the first (the overview, 400 x 306)
    const HS3 = H, faceS = roundedRect(W * 0.86, HS3 * 0.86, 0.006), frameS = roundedRect(W * 0.86 + 0.006, HS3 * 0.86 + 0.006, 0.008);   // simulated clips are one 16:9 view now (the successful runs)
    const third = t => t;
    const FRAME = { real: 0xf2a93b, sim: 0x3ea8e5 };
    dirs(clips.length).forEach((d, i) => {
      const c = clips[i], g = new T.Group();
      g.position.copy(d).multiplyScalar(R0 + 0.0035); g.lookAt(d.clone().multiplyScalar(2 * R0));
      const sim = c.kind === "sim";
      const back = new T.Mesh(sim ? frameS : frame, new T.MeshBasicMaterial({ color: FRAME[c.kind] }));
      const poster = loader.load(c.src + ".jpg"); poster.encoding = T.sRGBEncoding; if (sim) third(poster);
      const mat = new T.MeshBasicMaterial({ map: poster, toneMapped: false });
      const pic = new T.Mesh(sim ? faceS : face, mat); pic.position.z = 0.0008;
      g.add(back, pic); spin.add(g);
      const v = document.createElement("video");
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = "none"; v.crossOrigin = "anonymous";
      wins.push({ c, g, pic, mat, poster, v, tex: null, playing: false, i, normal: d });
      pic.userData.w = wins.length - 1;
    });

    // the hand: Wuji Hand 2.2 (right), index up, the others curled; its fingertip under the globe
    const d = wj.info.sides.right, h = new IK.Hand(d, "right", wj.arr);
    const q = new Float64Array(h.nq);
    const set = (name, v) => { const j = d.joints.findIndex(x => x.name === name); if (j >= 0) q[j] = Math.max(h.lo[j], Math.min(h.hi[j], v)); };
    set("r_thumb_cmc_flex", 0.75); set("r_thumb_cmc_abd", -0.35); set("r_thumb_mcp", 0.9); set("r_thumb_ip", 0.9);
    for (const f of ["middle_finger", "ring_finger", "pinky"]) { set(`r_${f}_mcp_flex`, 1.5); set(`r_${f}_pip`, 1.9); set(`r_${f}_dip`, 1.2); }
    set("r_index_finger_mcp_flex", 0.0); set("r_index_finger_pip", 0.0); set("r_index_finger_dip", 0.0);
    h.fk(new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), new Float64Array(3), q);
    hand = new T.Group();
    const mats = {}, COLORS = { matte_black: 0x3c3e43, metal_silver: 0xc9ccd1, sensor_pad: 0x2c2d31 };
    for (const [k, v] of Object.entries(COLORS)) mats[k] = C.clay(v, { transparent: false, roughness: 0.5 });
    for (const p of d.parts) {
      const m = new T.Mesh(C.geometry(new Float32Array(wj.arr(p.key + "_verts")), wj.arr(p.key + "_faces")), mats[p.material] || mats.metal_silver);
      const k = p.body, Rm = h.R, P = h.P;
      m.matrixAutoUpdate = false;
      m.matrix.set(Rm[k * 9], Rm[k * 9 + 1], Rm[k * 9 + 2], P[k * 3], Rm[k * 9 + 3], Rm[k * 9 + 4], Rm[k * 9 + 5], P[k * 3 + 1], Rm[k * 9 + 6], Rm[k * 9 + 7], Rm[k * 9 + 8], P[k * 3 + 2], 0, 0, 0, 1);
      hand.add(m);
    }
    // turn the straight index to point up (+y), the palm toward the viewer, and put its tip at the globe's bottom
    const tipB = d.tips[1], tp = h.point(tipB.body, tipB.pos[0], tipB.pos[1], tipB.pos[2], new Float64Array(3));
    const kn = d.chains[1][0], base = new T.Vector3(h.P[kn * 3], h.P[kn * 3 + 1], h.P[kn * 3 + 2]), tipV = new T.Vector3(tp[0], tp[1], tp[2]);
    const up = tipV.clone().sub(base).normalize(), qa = new T.Quaternion().setFromUnitVectors(up, new T.Vector3(0, 1, 0));
    const pinky = new T.Vector3(h.P[d.chains[4][0] * 3], h.P[d.chains[4][0] * 3 + 1], h.P[d.chains[4][0] * 3 + 2]).applyQuaternion(qa);
    const across = pinky.clone().sub(base.clone().applyQuaternion(qa)); across.y = 0;   // knuckles index -> pinky, level
    const yaw = Math.atan2(across.z, across.x);                                          // turn it to run along +x: the palm faces us
    const qb = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw + Number(fig.dataset.palm || 0));
    hand.quaternion.copy(qb.multiply(qa)); hand.scale.setScalar(HS);
    hand.updateMatrixWorld(true);
    const tipW = tipV.clone().applyQuaternion(hand.quaternion).multiplyScalar(HS);
    hand.position.set(-tipW.x, globe.position.y - R0 - 0.002 - tipW.y, -tipW.z);
    scene.add(hand);

    // a soft shadow of the ball on the knuckles is too much; a faint ground glow under everything instead
    bind(); ready = true; resize();
  }

  // ---- input: drag to spin (with a little momentum), hover to name, click to open below
  let vel = 0, drag = null, hover = -1;
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  function pickAt(e) {
    const b = canvas.getBoundingClientRect();
    mouse.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(wins.map(w => w.pic))[0];
    return hit ? hit.object.userData.w : -1;
  }
  // a click opens that task's gallery in a pop-up (the real robot's views and BC, or the simulated methods side by side)
  const pop = document.getElementById("dgPop"), popX = pop && pop.querySelector(".dg-x");
  let lastFocus = null;
  function open(w) { openClip(wins[w].c); }
  function openClip(c) {
    const sel = c.kind === "real" ? realPick : simPick;
    if (!pop || !sel) return;
    lastFocus = document.activeElement;
    pop.classList.toggle("real", c.kind === "real"); pop.classList.toggle("sim", c.kind === "sim");
    pop.hidden = false; document.documentElement.classList.add("dg-open");
    sel.value = c.task; sel.dispatchEvent(new Event("change", { bubbles: true }));
    if (c.kind === "real") {                       // the view clicked: front, corner, side
      const b = c.file && pop.querySelector(`.dg-real .task:not([hidden]) .runs.views button[data-src="${c.file}"]`); if (b) b.click();
    } else {
      const b = pop.querySelector(`#simGallery .simg-meth button[data-m="${c.hand}_fore"]`); if (b) b.click();
    }
    pop.querySelectorAll(".dg-" + c.kind + " video").forEach(v => { if (v.offsetParent && v.src) v.play().catch(() => {}); });
    if (popX) popX.focus({ preventScroll: true });
  }
  function close() {
    if (!pop || pop.hidden) return;
    pop.hidden = true; document.documentElement.classList.remove("dg-open");
    pop.querySelectorAll("video").forEach(v => v.pause());
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  window.FTDeployOpen = openClip;
  if (pop) {
    if (popX) popX.addEventListener("click", close);
    pop.addEventListener("click", e => { if (e.target === pop) close(); });
    addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }
  function bind() {
    canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, t: performance.now(), moved: false, last: e.clientX }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => {
      if (drag) {
        const dx = e.clientX - drag.last; drag.last = e.clientX;
        if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
        spin.rotation.y += dx * 0.01; vel = dx * 0.01; return;
      }
      hover = pickAt(e);
      canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
      if (hover >= 0) {
        const b = canvas.getBoundingClientRect(), c = wins[hover].c;
        tip.hidden = false; tip.innerHTML = `${c.label}<small>${c.note}</small>`;
        tip.style.left = (e.clientX - b.left) + "px"; tip.style.top = (e.clientY - b.top) + "px";
      } else tip.hidden = true;
    });
    canvas.addEventListener("pointerup", e => { const d = drag; drag = null; if (d && !d.moved) { const w = pickAt(e); if (w >= 0) open(w); } });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("pointerleave", () => { hover = -1; tip.hidden = true; });
  }

  // ---- only the windows facing us play (at most MAXPLAY), the rest keep their poster
  const MAXPLAY = matchMedia("(pointer: coarse)").matches ? 3 : 5;
  const camDir = new T.Vector3(), wp = new T.Vector3(), wn = new T.Vector3();
  function videos() {
    const facing = [];
    for (const w of wins) {
      w.g.getWorldPosition(wp); wn.copy(wp).sub(globe.position).normalize();
      camDir.copy(camera.position).sub(wp).normalize();
      w.facing = wn.dot(camDir);
      facing.push(w);
    }
    facing.sort((a, b) => b.facing - a.facing);
    const want = new Set(visible ? facing.filter(w => w.facing > 0.3).slice(0, MAXPLAY) : []);
    for (const w of wins) {
      if (want.has(w) && !w.playing) {
        w.playing = true;
        if (!w.v.src) { w.v.src = w.c.src + ".mp4"; w.v.addEventListener("playing", () => { if (!w.tex) { w.tex = new T.VideoTexture(w.v); w.tex.encoding = T.sRGBEncoding;  } w.mat.map = w.tex; w.mat.needsUpdate = true; }); }
        w.v.play().catch(() => {});
      } else if (!want.has(w) && w.playing) { w.playing = false; w.v.pause(); }
    }
  }

  function resize() {
    if (!ready) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    r.setSize(w, h, false); camera.aspect = w / h;
    // frame the globe and the hand below it
    const span = 0.8, dist = span / 2 / Math.tan(camera.fov * Math.PI / 360) / Math.min(1, camera.aspect * 0.9);
    camera.position.set(0, 0.0, dist); camera.lookAt(0, -0.075, 0); camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);

  let last = performance.now(), tick = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!ready || !visible || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!drag) { vel *= 0.94; spin.rotation.y += vel + (reduced || hover >= 0 ? 0 : dt * 0.32); }
    globe.rotation.x = reduced ? 0 : 0.03 * Math.sin(now / 900);       // a ball on a finger wobbles a little
    if (++tick % 15 === 0) videos();
    r.render(scene, camera);
  }

  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible && !r) {
      const get = (u, k) => fetch(u).then(x => { if (!x.ok) throw new Error(u); return x[k](); });
      Promise.all([get(`static/live/wuji.json?v=${DATA}`, "json"), get(`static/live/wuji.bin?v=${DATA}`, "arrayBuffer")])
        .then(([info, bin]) => { build({ info, arr: k => C.arr(bin, info.layout[k]) }); requestAnimationFrame(loop); })
        .catch(e => console.error(e));
    }
    if (ready) videos();
  }, { rootMargin: "200px" }).observe(fig);
})();
