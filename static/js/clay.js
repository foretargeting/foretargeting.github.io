/* Clay: small three.js helpers shared by the tour's 3D panels (light or dark stage, soft shadows,
   drag to orbit, a visibility-aware loop) and a cached loader for static/hero/<name>.json + .bin. */
window.Clay = (function () {
  const T = window.THREE;
  if (!T) return null;
  const cache = {};
  // the data files carry clay.js's own ?v=, so a new build never pairs a cached .json with a fresh .bin
  const VQ = ((document.currentScript && document.currentScript.src.match(/\?v=[^&#]*/)) || [""])[0];

  function load(name) {
    return cache[name] || (cache[name] = Promise.all([
      fetch(`static/hero/${name}.json${VQ}`).then(r => r.json()),
      fetch(`static/hero/${name}.bin${VQ}`).then(r => r.arrayBuffer())
    ]).then(([meta, buf]) => { if (meta.pack) unpack(meta, buf); return { meta, buf }; }));
  }

  // A packed file (meta.pack: {array: "s" | "ds" | "d"}) stores some arrays rearranged so the download compresses
  // better: "d" = each row minus the row before it (XOR for 4-byte types), "s" = bytes grouped by their position in
  // each value. Undone here in place, so every reader sees the original bytes at the original offsets.
  const SIZE = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4 };
  function unpack(meta, buf) {
    const L = meta.layout;
    for (const key in meta.pack) {
      const mode = meta.pack[key], l = L[key], size = SIZE[l.dtype], n = l.shape.reduce((a, b) => a * b, 1), nb = n * size;
      if (mode.indexOf("s") >= 0 && size > 1) {
        const u8 = new Uint8Array(buf, l.offset, nb), tmp = new Uint8Array(nb);
        for (let p = 0; p < size; p++) { const base = p * n; for (let i = 0; i < n; i++) tmp[i * size + p] = u8[base + i]; }
        u8.set(tmp);
      }
      if (mode.indexOf("d") >= 0) {
        const rows = l.shape.length > 1 ? l.shape[0] : 1, stride = n / rows;
        const v = size === 1 ? new Uint8Array(buf, l.offset, n) : size === 2 ? new Uint16Array(buf, l.offset, n) : new Uint32Array(buf, l.offset, n);
        if (size === 4) { for (let i = stride; i < n; i++) v[i] ^= v[i - stride]; }
        else { for (let i = stride; i < n; i++) v[i] = v[i] + v[i - stride]; }
      }
    }
  }

  function arr(buf, L) {
    const n = L.shape.reduce((a, b) => a * b, 1);
    const C = { uint8: Uint8Array, int16: Int16Array, uint16: Uint16Array, uint32: Uint32Array, float32: Float32Array }[L.dtype];
    return new C(buf, L.offset, n);
  }

  function geometry(positions, faces, normals) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(positions, 3));
    g.setIndex(new T.BufferAttribute(new Uint32Array(faces), 1));
    if (normals !== false) g.computeVertexNormals();
    return g;
  }

  function clay(color, o) {
    return new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.62, metalness: 0, transparent: true }, o || {}));
  }

  // set an Object3D from a pose stored as x y z, w x y z at index i (or between i and i+1)
  const qa = new T.Quaternion(), qb = new T.Quaternion();
  function pose(obj, a, n, f) {
    if (n < 2) {
      obj.position.set(a[0], a[1], a[2]);
      obj.quaternion.set(a[4], a[5], a[6], a[3]);
      return;
    }
    f = Math.max(0, Math.min(n - 1.001, f));
    const i = Math.floor(f), s = f - i, j = i * 7, k = (i + 1) * 7;
    obj.position.set(a[j] + (a[k] - a[j]) * s, a[j + 1] + (a[k + 1] - a[j + 1]) * s, a[j + 2] + (a[k + 2] - a[j + 2]) * s);
    qa.set(a[j + 4], a[j + 5], a[j + 6], a[j + 3]);
    qb.set(a[k + 4], a[k + 5], a[k + 6], a[k + 3]);
    obj.quaternion.copy(qa).slerp(qb, s);
  }

  // morph a vertex buffer between quantised frames
  function morph(out, q, nv, f, n, center, scale) {
    f = Math.max(0, Math.min(n - 1.001, f));
    const i = Math.floor(f), s = f - i, a = i * nv * 3, b = (i + 1) * nv * 3;
    for (let v = 0; v < nv * 3; v++) out[v] = (q[a + v] + (q[b + v] - q[a + v]) * s) * scale + center[v % 3];
  }

  function stage(canvas, o) {
    o = o || {};
    const host = o.host || canvas.parentElement;
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(o.fov || 28, 1, 0.01, 20);
    const root = new T.Group();                                 // z-up data -> three's y-up
    root.rotation.x = -Math.PI / 2;
    scene.add(root);
    scene.add(new T.HemisphereLight(0xffffff, o.dark ? 0x3a3f48 : 0xc9bfb0, o.dark ? 0.75 : 0.62));
    const key = new T.DirectionalLight(0xffffff, o.dark ? 1.1 : 0.95);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 5;
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const rim = new T.DirectionalLight(o.dark ? 0xbfd6ff : 0xfff1df, o.dark ? 0.55 : 0.35);
    rim.position.set(1.2, 0.8, -1.0);
    scene.add(rim);
    const ground = new T.Mesh(new T.PlaneGeometry(4, 4), new T.ShadowMaterial({ opacity: o.dark ? 0.42 : 0.16 }));
    ground.receiveShadow = true;
    root.add(ground);

    const view = { az: o.az || 0, el: o.el == null ? 0.4 : o.el, center: new T.Vector3(), radius: 0.3, fit: o.fit || 0.75, dragAz: 0, dragEl: 0 };
    let drag = null;
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, az: view.dragAz, el: view.dragEl }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
    canvas.addEventListener("pointermove", e => {
      if (!drag) return;
      view.dragAz = drag.az - (e.clientX - drag.x) * 0.008;
      view.dragEl = Math.max(-0.3, Math.min(0.8, drag.el + (e.clientY - drag.y) * 0.006));
    });
    const end = () => { drag = null; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    function frameOn(centerZup, radius, deskZ) {
      view.center.set(centerZup.x, centerZup.z, -centerZup.y);
      view.radius = radius;
      ground.position.z = deskZ - 0.002;
      key.target.position.copy(view.center);
      key.position.copy(view.center).add(new T.Vector3(-0.35, 2.0, 0.55));
      const s = Math.max(0.4, radius * 1.6);
      Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
      key.shadow.camera.updateProjectionMatrix();
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      const lift = o.lift ? Math.min(o.lift, r.height * 0.15) : 0;
      // o.shift: move the scene right by this fraction of the width (room for an overlay on the left)
      const sx = o.shift && r.width > 640 ? r.width * o.shift : 0;
      if (sx) camera.aspect = (r.width + sx) / r.height;
      if (lift || sx) camera.setViewOffset(r.width + sx, r.height + lift, 0, lift, r.width, r.height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    function render(t) {
      const r = canvas.getBoundingClientRect();
      if (Math.abs(r.width * renderer.getPixelRatio() - canvas.width) > 2 || Math.abs(r.height * renderer.getPixelRatio() - canvas.height) > 2) resize();
      const a = view.az + view.dragAz + (FT.reduced ? 0 : 0.16 * Math.sin((t || 0) * 0.21));
      const e = view.el + view.dragEl;
      const dist = view.radius / Math.sin((camera.fov * Math.PI / 180) / 2) * (camera.aspect < 1.1 ? view.fit * 1.3 : view.fit)
        * (o.wide && camera.aspect < o.wide ? o.wide / camera.aspect : 1);   // o.wide: back off on a stage narrower than this
      camera.position.set(view.center.x + dist * Math.cos(e) * Math.sin(a), view.center.y + dist * Math.sin(e), view.center.z + dist * Math.cos(e) * Math.cos(a));
      camera.lookAt(view.center);
      renderer.render(scene, camera);
    }
    // a loop that runs only while the canvas is on screen and not paused
    let visible = false, paused = false, last = null, step = null, raf = 0;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; last = null; kick(); }, { rootMargin: "60px" }).observe(host);
    function tick(now) {
      raf = 0;
      if (!visible || paused || document.hidden || !step) { last = null; return; }
      const t = now / 1000, dt = last == null ? 0 : Math.min(0.05, t - last);
      last = t;
      step(t, dt);
      render(t);
      raf = requestAnimationFrame(tick);
    }
    function kick() { if (!raf && visible && !paused && step) raf = requestAnimationFrame(tick); }
    document.addEventListener("visibilitychange", kick);
    resize();
    return {
      T, renderer, scene, camera, root, view, frameOn, resize, render,
      loop(fn) { step = fn; kick(); },
      // advance and draw once, outside the loop (stills and tests)
      once(t, dt) { if (step) { resize(); step(t, dt || 0); render(t); } },
      anim: { pause() { paused = true; }, resume() { paused = false; resize(); kick(); } }
    };
  }

  return { load, arr, geometry, clay, pose, morph, stage };
})();
