/* The data section's small world (after the team's objectworlddata site): one Aria recording per object, a hundred
   of the objects around a globe and all of them in a searchable list (static/hero/datacloud.json lists them, "globe"
   marks the hundred; Markov-expert demos can be listed too,
   static/hero/dc_objects.* holds their small meshes, static/hero/land.geojson is Natural Earth's 1:110m land). Drag to
   turn it; hover an object for its name; click it (or its button) and the demo plays in 3D in a dialog, from its own
   static/hero/dc_<key>.* file: the tracked MANO hands and object of a recording, or the capsule hands and objects of a
   generated take. The objects' places on the globe mean nothing. */
(function () {
  const fig = document.getElementById("dataWorld"), modal = document.getElementById("dataModal");
  if (!fig || !modal || !window.Clay) return;
  const C = Clay, T = THREE, reduced = window.FT && FT.reduced;
  const COLORS = ["#f2a93b", "#e5545b", "#f2c94c", "#d0485e", "#5b8def", "#b07cd8", "#3fb6c6", "#22b37a", "#ef8f45", "#3e8fd0"];

  const near = new IntersectionObserver(es => { if (es[0].isIntersecting) { near.disconnect(); start(); } }, { rootMargin: "300px" });
  near.observe(fig);

  function landTexture(land) {
    const cv = document.createElement("canvas"); cv.width = 2048; cv.height = 1024;
    const g = cv.getContext("2d");
    g.fillStyle = "#9db9ee"; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = "#b9cdf0"; g.lineWidth = 1.2;
    for (let lon = -180; lon <= 180; lon += 30) { const x = (lon + 180) / 360 * cv.width; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { const y = (90 - lat) / 180 * cv.height; g.beginPath(); g.moveTo(0, y); g.lineTo(cv.width, y); g.stroke(); }
    g.fillStyle = "#f3f6fb"; g.strokeStyle = "#e3eaf6"; g.lineWidth = 1.6;
    for (const f of land.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) {
        g.beginPath();
        for (const ring of rings) { ring.forEach(([lon, lat], i) => { const x = (lon + 180) / 360 * cv.width, y = (90 - lat) / 180 * cv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
        g.fill("evenodd"); g.stroke();
      }
    }
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  function start() {
    const PRE = fig.dataset.set || "dc", LIST = PRE === "dc" ? "datacloud" : PRE + "cloud";   // data-set="dc2": the clips from tracks_desk_clean alone
    Promise.all([C.load(LIST), C.load(PRE + "_objects"), fetch("static/hero/land.geojson").then(r => r.json())]).then(([dc, objs, land]) => {
      const F = dc.meta.featured, G = F.map((f, i) => i).filter(i => F[i].globe !== false);
      const MARK = G.length > 60 ? 0.17 : G.length > 16 ? 0.24 : 0.34;   // smaller marks when there are many
      const color = i => COLORS[i % COLORS.length];
      // ---- the globe
      const canvas = fig.querySelector(".dw-globe canvas"), tip = fig.querySelector(".dw-tip");
      const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
      const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 0.35, 6.3); camera.lookAt(0, 0, 0);
      scene.add(new T.HemisphereLight(0xffffff, 0xb8c4dc, 0.85));
      const key = new T.DirectionalLight(0xffffff, 0.75); key.position.set(-3, 4, 5); scene.add(key);
      const world = new T.Group(); scene.add(world);
      world.add(new T.Mesh(new T.SphereGeometry(1, 96, 64), new T.MeshStandardMaterial({ map: landTexture(land), roughness: 0.72, metalness: 0.02 })));
      world.rotation.x = 0.25;
      // the objects on a shell around it, spread like the points of a Fibonacci sphere
      const marks = G.map((fi, i) => {
        const f = F[fi], L = objs.meta.layout;
        const g = C.geometry(C.arr(objs.buf, L[`${f.key}_v`]), C.arr(objs.buf, L[`${f.key}_f`]));
        const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: color(fi), roughness: 0.5, metalness: 0.02 }));
        const y = 1 - 2 * (i + 0.5) / G.length, rad = Math.sqrt(1 - y * y), th = i * 2.39996;
        const dir = new T.Vector3(Math.cos(th) * rad, y * 0.8, Math.sin(th) * rad).normalize();
        m.position.copy(dir).multiplyScalar(1.42); m.scale.setScalar(MARK);
        m.userData = { i: fi, dir, spin: new T.Vector3(0.3 + 0.2 * Math.sin(i), 1, 0.2).normalize(), phase: i * 1.7 };
        const line = new T.Line(new T.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(1.01), dir.clone().multiplyScalar(1.28)]), new T.LineBasicMaterial({ color: 0x7d93c8, transparent: true, opacity: 0.45 }));
        world.add(m, line);
        return m;
      });
      // drag to turn; hover names; click opens
      let rotY = 0.6, drag = null, hover = -1, visible = false;
      const ray = new T.Raycaster(), mouse = new T.Vector2();
      const pickAt = e => {
        const b = canvas.getBoundingClientRect();
        mouse.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1);
        ray.setFromCamera(mouse, camera);
        const hit = ray.intersectObjects(marks)[0];
        return hit ? hit.object.userData.i : -1;
      };
      canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, rot: rotY, moved: false }; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener("pointermove", e => {
        if (drag) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 3) drag.moved = true; rotY = drag.rot + dx * 0.008; return; }
        hover = pickAt(e);
        canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
        if (hover >= 0) { const b = canvas.getBoundingClientRect(); tip.hidden = false; tip.textContent = F[hover].label; tip.style.left = (e.clientX - b.left) + "px"; tip.style.top = (e.clientY - b.top) + "px"; }
        else tip.hidden = true;
      });
      canvas.addEventListener("pointerup", e => { const d = drag; drag = null; if (d && !d.moved) { const i = pickAt(e); if (i >= 0) open(i); } });
      canvas.addEventListener("pointerleave", () => { hover = -1; tip.hidden = true; });
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(canvas);
      const tmp = new T.Quaternion();
      (function loop(now) {
        requestAnimationFrame(loop);
        if (!visible || document.hidden || !modal.hidden) return;
        const t = now / 1000, w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * r.getPixelRatio())) { r.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
        if (!drag && hover < 0 && !reduced) rotY += 0.002;
        world.rotation.y = rotY;
        marks.forEach(m => {
          const u = m.userData, bob = reduced ? 0 : 0.03 * Math.sin(t * 1.3 + u.phase);
          m.position.copy(u.dir).multiplyScalar(1.42 + bob);
          m.quaternion.copy(tmp.setFromAxisAngle(u.spin, reduced ? u.phase : t * 0.5 + u.phase));
          m.scale.setScalar(u.i === hover ? MARK * 1.4 : MARK);
        });
        r.render(scene, camera);
      })(performance.now());

      // ---- the list: every object, A to Z, filtered as the visitor types; the ones on the globe keep their colour
      const list = fig.querySelector(".dw-list"), search = fig.querySelector(".dw-search input"), nEl = fig.querySelector(".dw-n");
      const order = F.map((f, i) => i).sort((a, b) => F[a].label.localeCompare(F[b].label));
      const items = order.map(i => {
        const b = document.createElement("button");
        b.type = "button"; b.dataset.i = i;
        b.innerHTML = `<i style="background:${F[i].globe !== false ? color(i) : "#c9ced8"}"></i>${F[i].label}`;
        b.addEventListener("click", () => open(i));
        if (list) list.appendChild(b);
        return b;
      });
      if (search) search.placeholder = `Search ${F.length} objects`;
      const count = n => { if (nEl) nEl.textContent = n === F.length ? `${F.length} objects` : `${n} of ${F.length}`; };
      count(F.length);
      if (search) search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        let n = 0;
        items.forEach(b => { const on = !q || F[+b.dataset.i].label.toLowerCase().includes(q); b.hidden = !on; n += on; });
        count(n);
      });

      // ---- the dialog and its 3-D view
      const S = C.stage(modal.querySelector(".dw-view canvas"), { az: -2.3, el: 0.5, fit: 0.9 });
      const tag = modal.querySelector(".dw-tag"), note = modal.querySelector(".dw-note");
      const cache = {};
      const load = key2 => cache[key2] || (cache[key2] = C.load(PRE + "_" + key2).then(d => build(d)));
      let cur = null, k = -1, t = 0, opener = null;
      function open(i) {
        k = (i + F.length) % F.length; t = 0;
        if (modal.hidden) { opener = document.activeElement; modal.hidden = false; S.anim.resume(); modal.querySelector(".dw-x").focus(); }
        const f = F[k];
        tag.innerHTML = `<i class="${f.kind}"></i>${f.label}<small>${f.kind === "human" ? "Aria recording, tracked hands and object" : "generated in physics, MANO capsule hands"}</small>`;
        note.textContent = `${k + 1} / ${F.length}`;
        load(f.key).then(d => {
          if (F[k].key !== f.key) return;
          if (cur) S.root.remove(cur.g);
          cur = d; S.root.add(d.g); d.set(0);
          S.frameOn(d.center, d.radius, 0);
        });
      }
      function close() { modal.hidden = true; S.anim.pause(); if (opener && opener.focus) opener.focus(); }
      modal.querySelector(".dw-x").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      modal.querySelector(".dw-prev").addEventListener("click", () => open(k - 1));
      modal.querySelector(".dw-next").addEventListener("click", () => open(k + 1));
      document.addEventListener("keydown", e => {
        if (modal.hidden) return;
        if (e.key === "Escape") close(); else if (e.key === "ArrowRight") open(k + 1); else if (e.key === "ArrowLeft") open(k - 1);
      });
      S.loop((tt, dt) => {
        if (!cur) return;
        const dur = (cur.n - 1) / cur.fps;
        if (!reduced) t += dt;
        if (t > dur + 0.8) t = 0;
        cur.set(Math.min(t, dur) * cur.fps);
      });
      S.anim.pause();
    }).catch(e => console.error(e));
  }

  // one demo's scene: the tracked MANO hands and object of a recording, or the capsule hands and meshes of a take
  function build({ meta: m, buf: b }) {
    const L = m.layout, g = new T.Group();
    const skin = C.clay(0xd9ac8f, { transparent: false }), objM = C.clay(0xd8d2c6, { transparent: false, side: T.DoubleSide }), amb = C.clay(0xf2a93b, { transparent: false });
    let n, set;
    if (m.kind === "human") {
      const hv = { left: C.arr(b, L.left_v), right: C.arr(b, L.right_v) }, ok = { left: C.arr(b, L.left_valid), right: C.arr(b, L.right_valid) };
      const faces = C.arr(b, L.faces), NH = L.left_v.shape[0], NV = L.left_v.shape[1], hands = {};
      ["left", "right"].forEach(s => {
        const geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.BufferAttribute(new Float32Array(NV * 3), 3)); geo.setIndex(new T.BufferAttribute(new Uint32Array(faces), 1));
        hands[s] = new T.Mesh(geo, skin); hands[s].castShadow = true; hands[s].frustumCulled = false; g.add(hands[s]);
      });
      const obj = new T.Mesh(C.geometry(C.arr(b, L.mesh_v), C.arr(b, L.mesh_f)), amb); obj.castShadow = true; g.add(obj);
      const op = C.arr(b, L.obj_p), oq = C.arr(b, L.obj_q), qa = new T.Quaternion(), qb = new T.Quaternion();
      n = L.obj_p.shape[0];
      // frame the clip on what moves: the object's path (with its size) and the active hand, plus the other hand
      // whenever it is near the object; a robust 2-98 % box so a stray frame does not zoom the view out
      const mv = C.arr(b, L.mesh_v), hvL = hv.left, hvR = hv.right; let objR = 0;
      for (let v = 0; v < mv.length; v += 3) objR = Math.max(objR, Math.hypot(mv[v], mv[v + 1], mv[v + 2]));
      const P = [[], [], []], push = (x, y, z) => { P[0].push(x); P[1].push(y); P[2].push(z); }, e = 0.7 * objR;
      // an untracked frame parks the object (and sometimes a hand) at a fixed point far under the desk: leave it out, and hide it
      const lost = i => op[i * 3 + 2] < -0.5, gone = { left: new Uint8Array(NH), right: new Uint8Array(NH) };
      for (let i = 0; i < n; i++) { if (lost(i)) continue; const x = op[i * 3], y = op[i * 3 + 1], z = op[i * 3 + 2]; push(x + e, y + e, z + e); push(x - e, y - e, z - e); }
      ["left", "right"].forEach(sd => {
        const A = sd === "left" ? hvL : hvR, va = ok[sd], hu = m.hand_unit;
        for (let j = 0; j < NH; j++) {
          if (!va[j]) continue;
          const o = j * NV * 3, f = Math.min(n - 1, j * m.hand_every);
          let cx = 0, cy = 0, cz = 0, c = 0;
          for (let v = 0; v < NV; v += 25) { cx += A[o + v * 3]; cy += A[o + v * 3 + 1]; cz += A[o + v * 3 + 2]; c++; }
          if (cz / c * hu < -0.5) { gone[sd][j] = 1; continue; }
          if (sd !== m.active && (lost(f) || Math.hypot(cx / c * hu - op[f * 3], cy / c * hu - op[f * 3 + 1], cz / c * hu - op[f * 3 + 2]) > 0.25)) continue;
          for (let v = 0; v < NV; v += 25) push(A[o + v * 3] * hu, A[o + v * 3 + 1] * hu, A[o + v * 3 + 2] * hu);
        }
      });
      const lo = [], hi = [];
      P.forEach((a, d) => { a.sort((u, w) => u - w); lo[d] = a[Math.floor(0.02 * (a.length - 1))]; hi[d] = a[Math.ceil(0.98 * (a.length - 1))]; });
      var center = new T.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
      var radius = Math.min(0.6, Math.max(0.2, 0.425 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])));
      set = f => {
        const i = Math.min(n - 1.001, f), a = Math.floor(i), s = i - a;
        obj.position.set(op[a * 3] + (op[a * 3 + 3] - op[a * 3]) * s, op[a * 3 + 1] + (op[a * 3 + 4] - op[a * 3 + 1]) * s, op[a * 3 + 2] + (op[a * 3 + 5] - op[a * 3 + 2]) * s);
        qa.set(oq[a * 4 + 1], oq[a * 4 + 2], oq[a * 4 + 3], oq[a * 4]); qb.set(oq[a * 4 + 5], oq[a * 4 + 6], oq[a * 4 + 7], oq[a * 4 + 4]);
        obj.quaternion.copy(qa).slerp(qb, s); obj.visible = !lost(a) && !lost(a + 1);
        const h = Math.min(NH - 1.001, i / m.hand_every), j = Math.floor(h), u = h - j;
        ["left", "right"].forEach(sd => {
          const A = hv[sd], out = hands[sd].geometry.attributes.position.array, o0 = j * NV * 3, o1 = (j + 1) * NV * 3;
          for (let v = 0; v < NV * 3; v++) out[v] = (A[o0 + v] + (A[o1 + v] - A[o0 + v]) * u) * m.hand_unit;
          hands[sd].geometry.attributes.position.needsUpdate = true; hands[sd].geometry.computeVertexNormals();
          hands[sd].visible = !!ok[sd][j] && !gone[sd][j] && !gone[sd][Math.min(NH - 1, j + 1)];
        });
      };
    } else {
      const poses = C.arr(b, L.poses), NP = m.parts.length, cyl = new T.CylinderGeometry(1, 1, 1, 16, 1, true), sph = new T.SphereGeometry(1, 20, 14);
      const first = m.parts.findIndex(q => q.kind === "mesh" && q.side !== "left" && q.side !== "right");
      n = L.poses.shape[0];
      // frame the objects: their spread at the first frame, plus room for the hands
      var center = new T.Vector3(0, 0, 0.07), radius = 0.22;
      m.parts.forEach((p, j) => { if (p.side !== "left" && p.side !== "right") radius = Math.max(radius, Math.hypot(poses[j * 7], poses[j * 7 + 1]) + 0.14); });
      radius = Math.min(0.46, radius);
      // hands: skin; the objects' own geoms in their own colours (a teddy is ellipsoids, spheres and capsules)
      const hand = p => p.side === "left" || p.side === "right";
      const colour = p => p.rgba ? C.clay(new T.Color(p.rgba[0], p.rgba[1], p.rgba[2]).getHex(), { transparent: false, side: T.DoubleSide }) : objM;
      const parts = m.parts.map((p, pi) => {
        const o = new T.Group(), mat = hand(p) ? skin : pi === first && p.kind === "mesh" && !p.rgba ? amb : colour(p), z = p.size || [];
        let mesh = null;
        if (p.kind === "capsule") {
          const inner = new T.Group(); inner.rotation.x = Math.PI / 2;
          const c = new T.Mesh(cyl, mat); c.scale.set(p.radius, 2 * p.half, p.radius);
          const e1 = new T.Mesh(sph, mat), e2 = new T.Mesh(sph, mat);
          e1.scale.setScalar(p.radius); e2.scale.setScalar(p.radius); e1.position.y = p.half; e2.position.y = -p.half;
          [c, e1, e2].forEach(x => { x.castShadow = true; inner.add(x); }); o.add(inner);
        } else if (p.kind === "sphere") { mesh = new T.Mesh(sph, mat); mesh.scale.setScalar(z[0]); }
        else if (p.kind === "ellipsoid") { mesh = new T.Mesh(sph, mat); mesh.scale.set(z[0], z[1], z[2]); }
        else if (p.kind === "cylinder") { mesh = new T.Mesh(new T.CylinderGeometry(z[0], z[0], 2 * z[1], 20), mat); mesh.rotation.x = Math.PI / 2; }
        else if (p.kind === "box") { mesh = new T.Mesh(new T.BoxGeometry(2 * z[0], 2 * z[1], 2 * z[2]), mat); }
        else mesh = new T.Mesh(C.geometry(C.arr(b, L[`mesh_${p.mesh}_v`]), C.arr(b, L[`mesh_${p.mesh}_f`])), mat);
        if (mesh) { mesh.castShadow = true; o.add(mesh); }
        g.add(o); return o;
      });
      const q = new T.Quaternion();
      set = f => {
        const i = Math.max(0, Math.min(n - 1, Math.round(f)));
        for (let j = 0; j < NP; j++) { const o = (i * NP + j) * 7; parts[j].position.set(poses[o], poses[o + 1], poses[o + 2]); parts[j].quaternion.copy(q.set(poses[o + 4], poses[o + 5], poses[o + 6], poses[o + 3])); }
      };
    }
    return { g, n, set, fps: m.fps, label: m.label, kind: m.kind, center, radius };
  }
})();
