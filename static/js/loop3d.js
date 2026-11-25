/* Contribution cards: one small clay scene per card, from the same real data as the hero and the
   tour (static/hero). One shared WebGL renderer draws every card into its own 2D canvas, so the page
   opens no extra GL contexts. Only the highlighted card plays; the others keep a still.
   1  the Aria capture: hand and mustard bottle, amber copies where the bottle will be a moment later
   3  the Wuji plan that ran on the real xArm7, with the human hand it came from as a faint overlay
   4  a clip of the real Franka + Wuji run (a <video>, not drawn here; played while its card is on) */
window.FTLoop3D = (function () {
  const list = document.getElementById("contribList");
  const off = { active() {} };
  if (!list) return off;
  // cards are numbered by the map's components (li data-c: 1, 3, 4)
  const cards = [...list.querySelectorAll("li")].map(li => {
    const cv = li.querySelector("canvas.vig");
    return { k: +li.dataset.c, cv, ctx: cv && cv.getContext("2d"), v: null, vid: li.querySelector("video.vig") };   // card 4 is a clip
  });
  const card = k => cards.find(c => c.k === k);
  const fail = () => { list.classList.add("no-gl"); return off; };
  if (!window.Clay || !window.THREE || cards.some(c => c.cv && !c.ctx)) return fail();
  const C = window.Clay, T = THREE;

  let gl;
  try {
    gl = new T.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) { return fail(); }
  gl.outputEncoding = T.sRGBEncoding;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = T.PCFSoftShadowMap;
  gl.setClearColor(0x000000, 0);

  const AMBER = 0xf2a93b, SKIN = 0xd9ac8f, ROBOT = 0x434b57, BOTTLE = 0xebe4d8;
  const wrapFade = (x, a, b, w) => Math.max(0, Math.min(1, (x - a) / w, (b - x) / w));

  // a light clay stage like the hero's, drawn on demand into the shared renderer
  function mini(o) {
    const scene = new T.Scene(), root = new T.Group();
    root.rotation.x = -Math.PI / 2;                              // z-up data -> three's y-up
    scene.add(root);
    scene.add(new T.HemisphereLight(0xffffff, 0xc9bfb0, 0.62));
    const key = new T.DirectionalLight(0xffffff, 0.95);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 5;
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const rim = new T.DirectionalLight(0xfff1df, 0.35);
    rim.position.set(1.2, 0.8, -1.0);
    scene.add(rim);
    const ground = new T.Mesh(new T.PlaneGeometry(4, 4), new T.ShadowMaterial({ opacity: 0.15 }));
    ground.receiveShadow = true;
    root.add(ground);
    const camera = new T.PerspectiveCamera(o.fov || 24, 2, 0.01, 20);
    const center = new T.Vector3();
    let radius = 0.3;
    return {
      root,
      frame(cZ, r, desk) {
        center.set(cZ.x, cZ.z, -cZ.y);
        radius = r;
        ground.position.z = desk - 0.002;
        key.target.position.copy(center);
        key.position.copy(center).add(new T.Vector3(-0.35, 2.0, 0.55));
        const s = Math.max(0.4, r * 1.6);
        Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
        key.shadow.camera.updateProjectionMatrix();
      },
      draw(w, h, t) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const a = o.az + (FT.reduced ? 0 : 0.14 * Math.sin(t * 0.3)), e = o.el;
        const dist = radius / Math.sin(camera.fov * Math.PI / 360) * o.fit;
        camera.position.set(center.x + dist * Math.cos(e) * Math.sin(a), center.y + dist * Math.sin(e), center.z + dist * Math.cos(e) * Math.cos(a));
        camera.lookAt(center);
        gl.render(scene, camera);
      }
    };
  }

  function handMesh(buf, L, key, faces, mat) {
    const nv = L[key].shape[1], pos = new Float32Array(nv * 3);
    const g = C.geometry(pos, C.arr(buf, L[faces]), false);
    const m = new T.Mesh(g, mat);
    m.castShadow = true;
    return { m, g, pos, nv, q: C.arr(buf, L[key]) };
  }
  function morph(h, f, n, center, scale) {
    C.morph(h.pos, h.q, h.nv, f, n, center, scale);
    h.g.attributes.position.needsUpdate = true;
    h.g.computeVertexNormals();
  }
  function setOpacity(mats, a, max) {
    mats.forEach((m, i) => {
      m.opacity = a * (max ? max[i] : 1);
      m.depthWrite = !max && a > 0.98;
    });
  }

  // ---------------------------------------------------------------- hero data: cards 1 and 3
  function heroScenes({ meta, buf }) {
    const L = meta.layout, H = meta.human, R = meta.robot;
    const ho = C.arr(buf, L.human_obj), NO = L.human_obj.shape[0];
    const ro = C.arr(buf, L.robot_obj), rp = C.arr(buf, L.robot_poses), NG = L.robot_poses.shape[1];
    const bGeo = C.geometry(new Float32Array(C.arr(buf, L.bottle_verts)), C.arr(buf, L.bottle_faces));
    const box = new T.Box3();
    for (let i = 0; i < NO; i++) box.expandByPoint(new T.Vector3(ho[i * 7], ho[i * 7 + 1], ho[i * 7 + 2]));
    const cZ = box.getCenter(new T.Vector3()).add(new T.Vector3(0, 0, 0.02));
    const rad = box.getSize(new T.Vector3()).length() * 0.5 + 0.09;

    // 1: the capture, with the bottle 0.35, 0.7 and 1.05 s ahead
    const v1 = (() => {
      const S = mini({ az: -1.75, el: 0.34, fit: 0.58 });
      const skin = C.clay(SKIN), bm = C.clay(BOTTLE);
      const hand = handMesh(buf, L, "human_verts", "human_faces", skin);
      const bottle = new T.Mesh(bGeo, bm);
      bottle.castShadow = true;
      const AHEAD = [0.35, 0.7, 1.05], GO = [0.42, 0.3, 0.19];
      const gm = AHEAD.map(() => new T.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.35, roughness: 0.6, transparent: true, depthWrite: false }));
      const ghosts = gm.map(m => new T.Mesh(bGeo, m));
      S.root.add(hand.m, bottle, ...ghosts);
      S.frame(cZ, rad, meta.table_z);
      const P = H.end_s + 0.5;
      return {
        S, t: 3.2,
        update() {
          const th = Math.min(H.end_s, this.t % P), a = wrapFade(this.t % P, 0, P, 0.3);
          morph(hand, th * H.fps, H.n, meta.human_center, meta.human_scale);
          C.pose(bottle, ho, NO, th * 30);
          setOpacity([skin, bm], a);
          AHEAD.forEach((d, i) => {
            C.pose(ghosts[i], ho, NO, Math.min(H.end_s, th + d) * 30);
            ghosts[i].visible = ghosts[i].position.distanceTo(bottle.position) > 0.006;
          });
          setOpacity(gm, a, GO);
        }
      };
    })();

    // 3: the Wuji plan, and the human hand it came from as a faint overlay (same clock as the hero)
    const v3 = (() => {
      const S = mini({ az: -1.62, el: 0.34, fit: 0.66 });
      const rm = C.clay(ROBOT, { roughness: 0.42, metalness: 0.2 }), bm = C.clay(BOTTLE);
      const ghost = new T.MeshStandardMaterial({ color: 0xd29b7a, emissive: 0xd29b7a, emissiveIntensity: 0.15, roughness: 0.6, transparent: true, depthWrite: false, depthTest: false });
      const hand = handMesh(buf, L, "human_verts", "human_faces", ghost);
      hand.m.castShadow = false;
      hand.m.renderOrder = 2;
      const parts = meta.robot_meshes.map((_, i) => {
        const m = new T.Mesh(C.geometry(new Float32Array(C.arr(buf, L[`robot_mesh_${i}_v`])), C.arr(buf, L[`robot_mesh_${i}_f`])), rm);
        m.castShadow = true;
        S.root.add(m);
        return m;
      });
      const bottle = new T.Mesh(bGeo, bm);
      bottle.castShadow = true;
      S.root.add(bottle, hand.m);
      const rb = new T.Box3(), rEnd = Math.floor((R.release_s + 0.6 * (R.end_s - R.release_s)) * R.fps);
      for (let i = 0; i <= Math.min(R.n - 1, rEnd); i++) rb.expandByPoint(new T.Vector3(ro[i * 7], ro[i * 7 + 1], ro[i * 7 + 2]));
      S.frame(rb.getCenter(new T.Vector3()).add(new T.Vector3(0, 0, 0.02)), rad, meta.table_z);
      const kH = [0, H.grasp_s, H.release_s, H.end_s];
      const kR = [0, R.grasp_s, R.release_s, R.release_s + 0.6 * (R.end_s - R.release_s)];
      const KP = [0, H.grasp_s / H.end_s, H.release_s / H.end_s, 1];
      const interp = (p, K) => { let i = 0; while (i < 2 && p > KP[i + 1]) i++; return K[i] + (K[i + 1] - K[i]) * (p - KP[i]) / (KP[i + 1] - KP[i]); };
      const LOOP = 7.6, qa = new T.Quaternion(), qb = new T.Quaternion();
      return {
        S, t: 0.42 * LOOP,
        update() {
          const p = (this.t / LOOP) % 1, a = wrapFade(p, 0, 1, 0.05);
          const th = interp(p, kH), tr = interp(p, kR);
          morph(hand, th * H.fps, H.n, meta.human_center, meta.human_scale);
          for (let g = 0; g < NG; g++) {
            const m = parts[g], f = Math.max(0, Math.min(R.n - 1.001, tr * R.fps)), i = Math.floor(f), s = f - i;
            const j = (i * NG + g) * 7, k = ((i + 1) * NG + g) * 7;
            m.position.set(rp[j] + (rp[k] - rp[j]) * s, rp[j + 1] + (rp[k + 1] - rp[j + 1]) * s, rp[j + 2] + (rp[k + 2] - rp[j + 2]) * s);
            qa.set(rp[j + 4], rp[j + 5], rp[j + 6], rp[j + 3]);
            qb.set(rp[k + 4], rp[k + 5], rp[k + 6], rp[k + 3]);
            m.quaternion.copy(qa).slerp(qb, s);
          }
          C.pose(bottle, ro, R.n, tr * R.fps);
          setOpacity([rm, bm], a);
          setOpacity([ghost], a, [0.45]);
        }
      };
    })();
    return [v1, v3];
  }

  // ---------------------------------------------------------------- drawing
  let active = 1, visible = false, started = false, last = null, raf = 0, W = 0, Hh = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function paint(c) {
    if (!c.v || !c.cv) return;
    const w = Math.round(c.cv.clientWidth * dpr), h = Math.round(c.cv.clientHeight * dpr);
    if (!w || !h) return;
    if (c.cv.width !== w || c.cv.height !== h) { c.cv.width = w; c.cv.height = h; }
    if (w !== W || h !== Hh) { gl.setPixelRatio(1); gl.setSize(w, h, false); W = w; Hh = h; }
    c.v.update();
    c.v.S.draw(w, h, c.v.t);
    c.ctx.clearRect(0, 0, w, h);
    c.ctx.drawImage(gl.domElement, 0, 0);
    if (c.v.overlay) c.v.overlay(c.ctx, w, h, dpr);
  }
  const paintAll = () => cards.forEach(paint);
  function tick(now) {
    raf = 0;
    if (!visible || document.hidden || FT.reduced) { last = null; return; }
    const t = now / 1000, dt = last == null ? 0 : Math.min(0.05, t - last);
    last = t;
    const c = card(active);
    if (c && c.v) { c.v.t += dt; paint(c); }
    raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf && visible && !document.hidden && !FT.reduced) raf = requestAnimationFrame(tick); }
  document.addEventListener("visibilitychange", kick);

  let loading = null;
  function start() {
    started = true;
    return loading || (loading = C.load("hero").then(hero => {
      const [v1, v3] = heroScenes(hero);
      card(1).v = v1; card(3).v = v3;
      list.classList.add("gl-ready");
      paintAll();
      kick();
    }).catch(fail));
  }
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    last = null;
    if (visible && !started) start();
    kick();
  }, { rootMargin: "200px" }).observe(list);
  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(paintAll, 120); });

  return {
    active(k) {
      cards.forEach(c => { if (c.vid) { if (c.k === k && !FT.reduced) c.vid.play().catch(() => {}); else c.vid.pause(); } });
      const c = card(k);
      if (k !== active && c && c.v && c.v.activate) c.v.activate();
      active = k; last = null; kick();
    },
    // draw one card at an exact time (stills, tests); loads the data first if needed
    renderAt(k, t) { return start().then(() => { const c = card(k); if (c && c.v) { c.v.t = t; paint(c); } }); }
  };
})();
