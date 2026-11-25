/* glpool: the page has many three.js panels, each with its own WebGL context, and a browser keeps only so many (Chrome ~16,
   the live-demo frame included); past that it silently drops the oldest and the panel stays blank when scrolled back to.
   Every WebGLRenderer is wrapped here: when more than MAX contexts are live, the ones longest out of view give theirs back
   (WEBGL_lose_context), and a panel coming back into view gets its context restored; three.js re-uploads its scene on
   'webglcontextrestored', and a window resize then makes every panel draw its current frame again. Load right after three. */
(function () {
  const T = window.THREE;
  if (!T || !T.WebGLRenderer || T.WebGLRenderer.__pooled) return;
  const Base = T.WebGLRenderer, MAX = 7, all = [];
  let redraw = 0;
  function kickResize() { clearTimeout(redraw); redraw = setTimeout(() => window.dispatchEvent(new Event("resize")), 30); }
  function trim() {
    const live = all.filter(e => !e.lost);
    let extra = live.length - MAX;
    if (extra <= 0) return;
    live.filter(e => !e.vis && e.c.isConnected && e.ext).sort((a, b) => a.seen - b.seen).forEach(e => {
      if (extra-- <= 0) return;
      e.forced = true; e.lost = true;
      try { e.ext.loseContext(); } catch (err) { e.forced = false; e.lost = false; }
    });
  }
  function Pooled(p) {
    Base.call(this, p);
    const c = this.domElement, e = { c, vis: true, seen: performance.now(), lost: false, forced: false, ext: null };
    try { e.ext = this.getContext().getExtension("WEBGL_lose_context"); } catch (err) {}
    all.push(e);
    c.addEventListener("webglcontextlost", () => { e.lost = true; });
    const me = this;
    c.addEventListener("webglcontextrestored", () => { e.lost = false; e.forced = false; me.__fresh = true; if (me.shadowMap) me.shadowMap.needsUpdate = true; kickResize(); });
    // after a restore, lights rebuild their shadow maps (the old render targets point at the lost context)
    const draw = this.render;
    this.render = function (scene, cam) {
      if (me.__fresh && scene && scene.traverse) { me.__fresh = false; scene.traverse(o => { if (o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } }); }
      return draw.call(me, scene, cam);
    };
    if ("IntersectionObserver" in window) new IntersectionObserver(es => {
      e.vis = es[es.length - 1].isIntersecting; e.seen = performance.now();
      if (e.vis && e.lost && e.ext) { try { e.ext.restoreContext(); } catch (err) {} }
      trim();
    }, { rootMargin: "300px" }).observe(c);
  }
  Pooled.prototype = Base.prototype;
  Object.keys(Base).forEach(k => { Pooled[k] = Base[k]; });
  Pooled.__pooled = true;
  T.WebGLRenderer = Pooled;
})();
