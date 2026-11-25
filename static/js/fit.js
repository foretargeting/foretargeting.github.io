/* One screen per section: when the side menu lands a section, its heading and its main figure fit on the screen together.
   Each main figure's stage carries data-fit="<min px>" and sits in a box (its closest [data-fit-box]); if the box would end
   below the screen from where the side menu lands the section (its scroll margin), the stage gives up that much height,
   down to its minimum (data-fit-end names the box when it is not an ancestor), never more than its own CSS height. data-fit-mode="width": the stage keeps its aspect ratio and
   narrows instead (a video). If the minimum is not enough, the figure is scaled down as a whole (CSS zoom, at least 72 %). Runs before the figures' own resize handlers (this file loads first), on load, on resize
   (tab switches and the folding intros send one), and from page.js before a side-menu jump. Off on phones. */
(function () {
  function fitAll() {
    const stages = [...document.querySelectorAll("[data-fit]")];
    if (window.innerWidth < 761) { stages.forEach(st => { st.style.height = ""; st.style.maxWidth = ""; }); return; }
    stages.forEach(st => {
      st.style.height = ""; st.style.maxWidth = "";
      const bx = (st.dataset.fitEnd && document.querySelector(st.dataset.fitEnd)) || st.closest("[data-fit-box]");
      if (bx) bx.style.zoom = ""; if (bx && bx !== st.closest("[data-fit-box]") && st.closest("[data-fit-box]")) st.closest("[data-fit-box]").style.zoom = "";
      const r0 = st.getBoundingClientRect(); if (!r0.height) return;                 // a hidden tab: fitted when it shows
      const sec = st.closest(".sec"), box = (st.dataset.fitEnd && document.querySelector(st.dataset.fitEnd)) || st.closest("[data-fit-box]") || st;   // data-fit-end: a selector for a box that ends below the stage
      if (!sec) return;
      const land = sec.getBoundingClientRect().top - (parseFloat(getComputedStyle(sec).scrollMarginTop) || 0);
      const need = box.getBoundingClientRect().bottom - land - (window.innerHeight - 14);
      if (need <= 0) return;
      const h = Math.max(+st.dataset.fit || 260, r0.height - need);
      if (st.dataset.fitMode === "width") { st.style.maxWidth = Math.round(r0.width * h / r0.height) + "px"; st.style.marginInline = "auto"; }
      else st.style.height = Math.round(h) + "px";
      // a short window: the stage at its minimum and still too tall, so the whole figure scales down (not below 72 %)
      const zb = st.closest("[data-fit-box]") || box, b = box.getBoundingClientRect(), z = zb.getBoundingClientRect();
      const rest = b.bottom - land - (window.innerHeight - 14);
      if (rest > 0) zb.style.zoom = String(Math.max(0.72, 1 - rest / Math.max(1, b.bottom - z.top)).toFixed(3));
    });
  }
  // then the whole section on one screen: if it is still taller than the window under the bar, its main block
  // ([data-squeeze]) is scaled down as a whole (CSS zoom, not below 72 %)
  function squeeze() {
    const blocks = [...document.querySelectorAll("[data-squeeze]")];
    blocks.forEach(b => { b.style.zoom = ""; });
    if (window.innerWidth < 1000) return;              // narrower: the figures stack, a section is taller than a screen anyway
    const nav = document.getElementById("nav"), bar = nav ? nav.getBoundingClientRect().height : 0, avail = window.innerHeight - bar;
    blocks.forEach(b => {
      const sec = b.closest("section"); if (!sec || !b.offsetHeight) return;
      const cs = getComputedStyle(sec), wrap = sec.querySelector(".wrap") || sec;   // the content's own height (the section itself is at least a screen tall)
      const over = wrap.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) - avail;
      if (over <= 0) return;
      b.style.zoom = String(Math.max(+b.dataset.squeeze || 0.72, 1 - over / b.getBoundingClientRect().height).toFixed(3));
    });
  }
  function both() { fitAll(); squeeze(); }
  window.FTFit = both;
  window.addEventListener("resize", both);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", both); else both();
  window.addEventListener("load", () => { both(); window.dispatchEvent(new Event("resize")); setTimeout(squeeze, 1200); });
})();
// a Details block opened or closed changes the room left: refit (toggle does not bubble, so listen in the capture phase)
document.addEventListener("toggle", e => { if (e.target.tagName === "DETAILS" && window.FTFit) requestAnimationFrame(() => { window.FTFit(); window.dispatchEvent(new Event("resize")); }); }, true);
