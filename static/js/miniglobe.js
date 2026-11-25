/* The way into ObjectWorld from the intention simulator: a small spinning copy of the data globe (the same land map
   and some of the same recorded objects, static/hero/dc2_objects.*) on a button that opens the ObjectWorld dialog
   (#owDialog: the big globe, the list, the recordings). Esc, the close button or a click outside closes it; a recording
   open on top of it (#dataModal) closes first. */
(function () {
  const btn = document.querySelector(".ow-open"), dlg = document.getElementById("owDialog");
  if (!btn || !dlg) return;
  const rec = document.getElementById("dataModal");
  let back = null;
  function open() {
    back = document.activeElement; dlg.hidden = false; document.documentElement.classList.add("ow-lock");
    requestAnimationFrame(() => { dlg.querySelector(".ow-x").focus(); window.dispatchEvent(new Event("resize")); });
  }
  function close() { dlg.hidden = true; document.documentElement.classList.remove("ow-lock"); if (back) back.focus(); }
  btn.addEventListener("click", open);
  dlg.querySelector(".ow-x").addEventListener("click", close);
  dlg.addEventListener("click", e => { if (e.target === dlg) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !dlg.hidden && (!rec || rec.hidden)) close(); });

  // ---- the small globe
  const T = window.THREE, C = window.Clay, canvas = btn.querySelector("canvas");
  if (!T || !C || !canvas) return;
  const reduced = window.FT && FT.reduced;
  const COLORS = ["#f2a93b", "#e5545b", "#f2c94c", "#d0485e", "#5b8def", "#b07cd8", "#3fb6c6", "#22b37a", "#ef8f45", "#3e8fd0"];
  function land(geo) {
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 512;
    const g = cv.getContext("2d");
    g.fillStyle = "#9db9ee"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#f3f6fb";
    for (const f of geo.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) {
        g.beginPath();
        for (const ring of rings) { ring.forEach(([lon, lat], i) => { const x = (lon + 180) / 360 * cv.width, y = (90 - lat) / 180 * cv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
        g.fill("evenodd");
      }
    }
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; return t;
  }
  let started = false;
  const near = new IntersectionObserver(es => { if (es[0].isIntersecting && !started) { started = true; near.disconnect(); start(); } }, { rootMargin: "200px" });
  near.observe(btn);
  function start() {
    Promise.all([C.load("dc2cloud"), C.load("dc2_objects"), fetch("static/hero/land.geojson").then(r => r.json())]).then(([dc, objs, geo]) => {
      const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
      const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, 0.1, 50);
      camera.position.set(0, 0.3, 6.6); camera.lookAt(0, 0, 0);
      scene.add(new T.HemisphereLight(0xffffff, 0xb8c4dc, 0.9));
      const key = new T.DirectionalLight(0xffffff, 0.7); key.position.set(-3, 4, 5); scene.add(key);
      const world = new T.Group(); world.rotation.x = 0.25; scene.add(world);
      world.add(new T.Mesh(new T.SphereGeometry(1, 48, 32), new T.MeshStandardMaterial({ map: land(geo), roughness: 0.75 })));
      // a few of the globe's objects, larger than on the big globe so they read at this size
      const F = dc.meta.featured, G = F.map((f, i) => i).filter(i => F[i].globe !== false).slice(0, 26), L = objs.meta.layout;
      G.forEach((fi, i) => {
        const k = F[fi].key; if (!L[`${k}_v`]) return;
        const m = new T.Mesh(C.geometry(C.arr(objs.buf, L[`${k}_v`]), C.arr(objs.buf, L[`${k}_f`])), new T.MeshStandardMaterial({ color: COLORS[fi % COLORS.length], roughness: 0.5 }));
        const y = 1 - 2 * (i + 0.5) / G.length, rad = Math.sqrt(1 - y * y), th = i * 2.39996;
        m.position.set(Math.cos(th) * rad, y * 0.8, Math.sin(th) * rad).normalize().multiplyScalar(1.45); m.scale.setScalar(0.34);
        m.rotation.set(i, i * 0.7, 0); world.add(m);
      });
      let visible = true;
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(btn);
      (function loop() {
        requestAnimationFrame(loop);
        if (!visible || document.hidden || !dlg.hidden) return;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        if (canvas.width !== Math.round(w * r.getPixelRatio())) r.setSize(w, h, false);
        if (!reduced) world.rotation.y += 0.006;
        r.render(scene, camera);
      })();
    }).catch(e => console.error(e));
  }
})();
