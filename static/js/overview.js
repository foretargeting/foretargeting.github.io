/* #loop: the hero's pour, step by step. The same run and the same clip as the hero (static/hero/pour.*), with the plan behind
   it (static/hero/planhands.*, tools/export_planhands.py): 1 the BC's MANO hands alone, with where they go next; 2 those
   hands with the intention simulator's apple and bowl and its forecast a moment ahead; 3 the Wuji hands that realized the
   plan in physics, with the forecast and the human hands they follow; 4 the real robot (video). The steps advance once per
   loop of the clip until the visitor picks one. */
(function () {
  const root = document.getElementById("ov");
  const canvas = document.getElementById("ovGL");
  if (!root || !canvas || !window.Clay || !window.THREE) return;
  const T = THREE, C = Clay;
  const fig = document.getElementById("ovStage"), vid = document.getElementById("ovVid");
  const tabs = [...root.querySelectorAll(".ov-steps button")];
  const ui = { step: document.getElementById("ovStep"), key: document.getElementById("ovKey"), prog: document.getElementById("ovProg"), play: document.getElementById("ovPlay") };

  const GHOSTS = [0.35, 0.7, 1.05];       // forecast, seconds ahead
  const AHEAD = [0.5, 1.0];               // the BC's hands, seconds ahead
  const HOLD = 1.0;                       // rest on the last frame before looping
  const KEYS = [
    '<span><i class="sk"></i>the BC\'s hands</span><span><i class="gh"></i>where they go next</span><span class="soft">the apple stays put: the BC does not model it</span>',
    '<span><i class="sk"></i>the BC\'s hands</span><span><i class="fo"></i>forecast of the <b class="what">apple</b></span>',
    '<span><i class="rb"></i>Wuji hands, in physics</span><span><i class="fo"></i>the forecast they follow</span><span><i class="sk soft"></i>the BC\'s hands</span>',
    '<span>real robot, one trial · 4× speed</span>'
  ];
  const ICON_PLAY = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="2.6" height="9" rx=".6"/><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6"/></svg>';

  let S = null, step = 0, auto = !FT.reduced, t = 0, built = null;

  function select(k, byUser) {
    step = k; t = 0;
    if (byUser) auto = false;
    tabs.forEach((b, i) => { b.classList.toggle("on", i === k); b.setAttribute("aria-selected", i === k); });
    root.style.setProperty("--c", getComputedStyle(tabs[k]).getPropertyValue("--c"));
    ui.step.textContent = `${k + 1} · ${tabs[k].querySelector("b").textContent}`;
    ui.key.innerHTML = KEYS[k];
    ui.play.innerHTML = auto ? ICON_PAUSE : ICON_PLAY;
    ui.play.setAttribute("aria-label", auto ? "Pause the steps" : "Play the steps");
    fig.classList.toggle("video", k === 3);
    if (k === 3) {
      if (!vid.src) vid.src = vid.dataset.src;
      vid.currentTime = 0; vid.play().catch(() => {});
    } else vid.pause();
    if (built) built.show(k);
  }
  tabs.forEach((b, i) => b.addEventListener("click", () => select(i, true)));
  ui.play.addEventListener("click", () => { auto = !auto; select(step, false); });
  vid.addEventListener("ended", () => { if (auto) select(0); else { vid.currentTime = 0; vid.play().catch(() => {}); } });
  vid.addEventListener("timeupdate", () => { if (step === 3 && vid.duration) ui.prog.style.width = (100 * vid.currentTime / vid.duration).toFixed(1) + "%"; });
  select(0);

  // build once the section comes near
  const io = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    io.disconnect();
    Promise.all([C.load("pour"), C.load("planhands")]).then(([pour, plan]) => build(pour, plan)).catch(() => fig.classList.add("no-gl"));
  }, { rootMargin: "400px" });
  io.observe(root);

  function build(pour, plan) {
    S = C.stage(canvas, { az: 2.85, el: 0.38, fit: 0.98, fov: 26, host: fig, wide: 1.5 });
    const meta = pour.meta, L = meta.layout, U = meta.pos_unit, NG = meta.parts.length, seg = meta.segments[0];
    const pp = C.arr(pour.buf, L.poses_p_0), pq = C.arr(pour.buf, L.poses_q_0), active = C.arr(pour.buf, L.active_0);
    const PL = plan.meta.layout, N = Math.min(seg.n, plan.meta.n), END = (N - 1) / meta.fps, FPS = meta.fps;
    const planP = { apple: C.arr(plan.buf, PL.plan_apple), bowl: C.arr(plan.buf, PL.plan_bowl) };

    const mat = {
      robot: new T.MeshStandardMaterial({ color: 0x434b57, roughness: 0.42, metalness: 0.2 }),
      apple: new T.MeshStandardMaterial({ color: 0xc9573f, roughness: 0.55 }),
      bowl: new T.MeshStandardMaterial({ color: 0xebe4d8, roughness: 0.55, side: T.DoubleSide }),
      skin: new T.MeshStandardMaterial({ color: 0xd9ac8f, roughness: 0.62, side: T.DoubleSide }),
      skinFaint: new T.MeshStandardMaterial({ color: 0xd9ac8f, roughness: 0.62, transparent: true, opacity: 0.26, depthWrite: false, side: T.DoubleSide }),
      ahead: AHEAD.map((_, i) => new T.MeshStandardMaterial({ color: 0x8592a6, roughness: 0.7, transparent: true, opacity: 0.3 - i * 0.12, depthWrite: false, side: T.DoubleSide })),
      ghost: GHOSTS.map((_, i) => new T.MeshStandardMaterial({ color: 0xf2a93b, emissive: 0xf2a93b, emissiveIntensity: 0.35, roughness: 0.6, side: T.DoubleSide, transparent: true, opacity: 0.42 - i * 0.11, depthWrite: false })),
      line: new T.LineBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.95 })
    };
    const geos = meta.parts.map((_, i) => C.geometry(new Float32Array(C.arr(pour.buf, L[`mesh_${i}_v`])), C.arr(pour.buf, L[`mesh_${i}_f`])));
    const mesh = (g, m, shadow) => { const x = new T.Mesh(g, m); x.castShadow = shadow !== false; S.root.add(x); return x; };

    // the realized run: Wuji hands, apple, bowl
    const real = meta.parts.map((p, i) => mesh(geos[i], p.group === "apple" ? mat.apple : p.group === "bowl" ? mat.bowl : mat.robot));
    const robotParts = real.filter((_, i) => meta.parts[i].group === "left" || meta.parts[i].group === "right");
    const iA = meta.ghost_part[0], iB = meta.ghost_part[1];
    // the plan's apple and bowl (the world models' rollout under the BC's hands)
    const planObj = { apple: mesh(geos[iA], mat.apple), bowl: mesh(geos[iB], mat.bowl) };
    const ghosts = [iA, iB].map(i => GHOSTS.map((_, k) => mesh(geos[i], mat.ghost[k], false)));
    // the BC's MANO hands: now, a moment ahead (step 1), and faint behind the robot (step 3)
    const NV = PL.left_v.shape[1], NH = PL.left_v.shape[0], HE = plan.meta.hand_every, HU = plan.meta.hand_unit;
    const hv = { left: C.arr(plan.buf, PL.left_v), right: C.arr(plan.buf, PL.right_v) };
    const faces = { left: C.arr(plan.buf, PL.faces_left), right: C.arr(plan.buf, PL.faces_right) };
    function handMesh(side, m) {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(NV * 3), 3));
      g.setIndex(new T.BufferAttribute(new Uint32Array(faces[side]), 1));
      const x = new T.Mesh(g, m); x.frustumCulled = false; x.castShadow = m.opacity === undefined || m.opacity > 0.9 || !m.transparent; S.root.add(x); return x;
    }
    const hands = { left: handMesh("left", mat.skin), right: handMesh("right", mat.skin) };
    const handsAhead = AHEAD.map((_, k) => ({ left: handMesh("left", mat.ahead[k]), right: handMesh("right", mat.ahead[k]) }));
    function setHand(x, side, f) {
      const h = Math.max(0, Math.min(NH - 1.001, f / HE)), a = Math.floor(h), s = h - a, A = hv[side], o = x.geometry.attributes.position.array;
      const i0 = a * NV * 3, i1 = (a + 1) * NV * 3;
      for (let v = 0; v < NV * 3; v++) o[v] = (A[i0 + v] + (A[i1 + v] - A[i0 + v]) * s) * HU;
      x.geometry.attributes.position.needsUpdate = true; x.geometry.computeVertexNormals();
    }
    // the plan line just ahead of the handled object
    const lineGeo = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(32 * 3), 3));
    const line = new T.Line(lineGeo, mat.line); line.renderOrder = 3; S.root.add(line);

    // frame: the objects' plan and realized paths, the desk, and the working hands' height (as the hero)
    const box = new T.Box3(), v3 = new T.Vector3();
    for (let f = 0; f < N; f += 3) {
      for (const o of ["apple", "bowl"]) box.expandByPoint(v3.set(planP[o][f * 7], planP[o][f * 7 + 1], planP[o][f * 7 + 2]));
    }
    box.expandByPoint(v3.set(box.min.x, box.min.y, 0)).expandByPoint(v3.set(box.max.x, box.max.y, 0.28));
    S.frameOn(box.getCenter(new T.Vector3()), box.getSize(new T.Vector3()).length() * 0.5 + 0.06, 0);

    const qa = new T.Quaternion(), qb = new T.Quaternion();
    function partAt(i, f, o) {
      f = Math.max(0, Math.min(N - 1.001, f));
      const a = Math.floor(f), s = f - a, j = (a * NG + i) * 3, k = ((a + 1) * NG + i) * 3, jq = (a * NG + i) * 4, kq = ((a + 1) * NG + i) * 4;
      o.position.set((pp[j] + (pp[k] - pp[j]) * s) * U, (pp[j + 1] + (pp[k + 1] - pp[j + 1]) * s) * U, (pp[j + 2] + (pp[k + 2] - pp[j + 2]) * s) * U);
      qa.set(pq[jq + 1], pq[jq + 2], pq[jq + 3], pq[jq]).normalize(); qb.set(pq[kq + 1], pq[kq + 2], pq[kq + 3], pq[kq]).normalize();
      o.quaternion.copy(qa).slerp(qb, s);
    }
    const planAt = (name, f, o) => C.pose(o, planP[name], N, Math.max(0, Math.min(N - 1.001, f)));
    const activeAt = f => active[Math.max(0, Math.min(N - 1, Math.round(f)))];

    const show = k => {
      robotParts.forEach(m => { m.visible = k === 2; });
      real[iA].visible = real[iB].visible = k === 2;
      planObj.apple.visible = planObj.bowl.visible = k < 2;
      hands.left.visible = hands.right.visible = k < 3;
      hands.left.material = hands.right.material = k === 2 ? mat.skinFaint : mat.skin;
      hands.left.castShadow = hands.right.castShadow = k !== 2;
      handsAhead.forEach(h => { h.left.visible = h.right.visible = k === 0; });
      line.visible = k === 1 || k === 2;
      if (k === 3) S.anim.pause(); else S.anim.resume();
    };
    built = { show };
    show(step);

    let shownWhat = null;
    S.loop((sec, dt) => {
      if (step === 3) return;
      if (!FT.reduced) t += dt;
      if (t >= END + HOLD) { t = 0; if (auto) { select(step + 1); if (step === 3) return; } }
      const f = Math.min(t, END) * FPS;
      ui.prog.style.width = (100 * Math.min(1, t / (END + HOLD))).toFixed(1) + "%";
      // the objects: still at the start (step 1), the plan's (step 2), the realized ones (step 3)
      if (step === 0) { planAt("apple", 0, planObj.apple); planAt("bowl", 0, planObj.bowl); }
      if (step === 1) { planAt("apple", f, planObj.apple); planAt("bowl", f, planObj.bowl); }
      if (step === 2) for (let i = 0; i < NG; i++) partAt(i, f, real[i]);
      setHand(hands.left, "left", f); setHand(hands.right, "right", f);
      if (step === 0) AHEAD.forEach((d, k) => { setHand(handsAhead[k].left, "left", Math.min(N - 1, f + d * FPS)); setHand(handsAhead[k].right, "right", Math.min(N - 1, f + d * FPS)); });
      // the forecast: the handled object's plan pose a moment ahead, and its path over the next second
      const k = activeAt(f), name = k ? "bowl" : "apple", now = step === 2 ? real[k ? iB : iA] : planObj[name];
      ghosts.forEach((set, j) => set.forEach((m, i) => {
        const fa = Math.min(N - 1, f + GHOSTS[i] * FPS);
        if (j === k) planAt(name, fa, m);
        m.visible = step > 0 && j === k && t < END && activeAt(fa) === k && m.position.distanceTo(now.position) > 0.008;
      }));
      if (step > 0) {
        const pts = lineGeo.attributes.position.array, P = planP[name];
        for (let i = 0; i < 32; i++) {
          let h = Math.round(Math.min(N - 1, f + (i / 31) * GHOSTS[2] * FPS));
          if (activeAt(h) !== k) h = Math.round(f);
          pts[i * 3] = P[h * 7]; pts[i * 3 + 1] = P[h * 7 + 1]; pts[i * 3 + 2] = P[h * 7 + 2];
        }
        lineGeo.attributes.position.needsUpdate = true;
        line.visible = t < END;
      }
      if (shownWhat !== name) { shownWhat = name; const w = ui.key.querySelector(".what"); if (w) w.textContent = name; }
      if (step === 1) { const w = ui.key.querySelector(".what"); if (w && w.textContent !== name) w.textContent = name; }
    });
    if (FT.reduced) { t = (meta.events_s.bowl_highest || END / 2); S.once(0, 0); }
    fig.classList.add("ready");
  }
})();
