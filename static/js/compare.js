/* Data card: the tracking overlay video and the same tracked data in 3D, split by a divider you drag.
   Left of the divider: the Aria frame with the tracked MANO hand (blue) and the FoundationPose++ object
   (green) drawn on it. Right: both MANO hands and the object mesh alone, rendered in clay from the
   camera that recorded the frame (its pose and intrinsics, and the video's crop), on the video's clock.
   Data: static/hero/aria.* (tools/export_aria.py). */
(function () {
  const box = document.getElementById("ariaCompare");
  if (!box) return;
  const video = box.querySelector("video"), canvas = box.querySelector("canvas"), handle = box.querySelector(".cmp-handle");

  // ---- the divider: drag anywhere on the picture, or use the arrow keys on the handle
  let split = 0.5, drag = false;
  function setSplit(f) {
    split = Math.max(0, Math.min(1, f));
    box.style.setProperty("--split", (split * 100).toFixed(2) + "%");
    handle.setAttribute("aria-valuenow", Math.round(split * 100));
    box.classList.toggle("at-l", split < 0.12);
    box.classList.toggle("at-r", split > 0.88);
  }
  const fromEvent = e => { const r = box.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); };
  box.addEventListener("pointerdown", e => { drag = true; try { box.setPointerCapture(e.pointerId); } catch (_) {} fromEvent(e); box.classList.add("dragging"); });
  box.addEventListener("pointermove", e => { if (drag) fromEvent(e); });
  const end = () => { drag = false; box.classList.remove("dragging"); };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  handle.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { setSplit(split + (e.key === "ArrowLeft" ? -0.05 : 0.05)); e.preventDefault(); }
  });
  setSplit(0.5);

  // ---- the video plays while the card is on screen
  let visible = false, loaded = false;
  // the clip is under 1 MB: fetch it whole, so it plays and seeks on any server
  function load() {
    if (loaded) return;
    loaded = true;
    fetch(video.dataset.src).then(r => r.blob()).then(bl => URL.createObjectURL(bl)).catch(() => video.dataset.src).then(src => {
      video.preload = "auto";
      video.src = src;
      if (visible) video.play().catch(() => {});
    });
    start();
  }
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible) load();
    if (visible) video.play().catch(() => {}); else video.pause();
    kick();
  }, { rootMargin: "120px" }).observe(box);

  // ---- the 3D side
  const T = window.THREE, C = window.Clay;
  if (!T || !C) { box.classList.add("no-gl"); return; }
  let renderer, scene, camera, sync = null, raf = 0, shown = -1, ready;
  const whenReady = new Promise(r => { ready = r; });
  function kick() { if (!raf && visible && sync) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (!visible || document.hidden || !sync) return;
    sync();
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", kick);

  function start() {
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) { box.classList.add("no-gl"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0xb9b2a8, 0.55));
    const sun = new T.DirectionalLight(0xffffff, 0.65);
    sun.position.set(0.3, -0.4, 1.0);                      // world is z up: light from above
    scene.add(sun);
    camera = new T.PerspectiveCamera(50, 4 / 3, 0.02, 10);
    camera.matrixAutoUpdate = false;
    const head = new T.DirectionalLight(0xfff4e8, 0.25);   // a little light from the wearer's eyes
    head.position.set(0, 0, 0);
    head.target.position.set(0, 0, -1);
    camera.add(head, head.target);
    scene.add(camera);

    C.load("aria").then(({ meta, buf }) => {
      const L = meta.layout, n = meta.n, NV = L.hand.shape[1];
      const skin = C.clay(0xd9ac8f, { transparent: false });
      const hands = [["hand", "hand_faces"], ["right_hand", "right_hand_faces"]].filter(([k]) => L[k]).map(([k, f]) => {
        const pos = new Float32Array(NV * 3);
        const m = new T.Mesh(C.geometry(pos, C.arr(buf, L[f]), false), skin);
        scene.add(m);
        return { m, pos, q: C.arr(buf, L[k]) };
      });
      const obj = new T.Mesh(C.geometry(new Float32Array(C.arr(buf, L.object_verts)), C.arr(buf, L.object_faces)),
        C.clay(0x2c66c2, { transparent: false, roughness: 0.5 }));
      scene.add(obj);
      const op = C.arr(buf, L.object_pose), cp = C.arr(buf, L.camera_pose);
      // OpenCV camera (x right, y down, z forward) -> three's (y up, looking down -z): turn 180° about x
      const flip = new T.Quaternion(1, 0, 0, 0), cq = new T.Quaternion(), cpos = new T.Vector3(), one = new T.Vector3(1, 1, 1);
      const [fx, fy] = meta.K, [iw, ih] = meta.image, [x0, y0, cw, ch] = meta.crop;
      camera.fov = 2 * Math.atan(ih / 2 / fy) * 180 / Math.PI;
      camera.aspect = iw / ih * (fy / fx);
      camera.setViewOffset(iw, ih, x0, y0, cw, ch);
      camera.updateProjectionMatrix();
      function size() {
        const r = canvas.getBoundingClientRect();
        if (r.width && Math.abs(r.width * renderer.getPixelRatio() - canvas.width) > 2) renderer.setSize(r.width, r.height, false);
      }
      window.addEventListener("resize", () => { size(); shown = -1; kick(); });
      size();
      sync = function () {
        const f = Math.max(0, Math.min(n - 1, Math.round((video.currentTime || 0) * meta.fps)));
        if (f === shown) return;
        shown = f;
        size();
        const a = f * NV * 3;
        for (const h of hands) {
          for (let v = 0; v < NV * 3; v++) h.pos[v] = h.q[a + v] * meta.scale + meta.center[v % 3];
          h.m.geometry.attributes.position.needsUpdate = true;
          h.m.geometry.computeVertexNormals();
        }
        C.pose(obj, op, n, f);
        const j = f * 7;
        cpos.set(cp[j], cp[j + 1], cp[j + 2]);
        cq.set(cp[j + 4], cp[j + 5], cp[j + 6], cp[j + 3]).multiply(flip);
        camera.matrix.compose(cpos, cq, one);           // the renderer derives the world matrices from it
        renderer.render(scene, camera);
      };
      box.classList.add("gl-ready");
      ready();
      kick();
    }).catch(() => box.classList.add("no-gl"));
  }
  // draw one exact moment (stills, tests): seeks the video and renders the matching frame
  window.FTCompare = {
    renderAt(t, f) {
      load();
      if (f != null) setSplit(f);
      return whenReady.then(() => new Promise(res => {
        video.pause();
        const done = () => { shown = -1; sync(); res(); };
        if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) done();
        else { video.addEventListener("seeked", done, { once: true }); video.currentTime = t; }
      }));
    }
  };
})();
