/* Tour panel 1 as a clay 3D scene of real data.
   1  Intention simulator: the Aria capture (hand + mustard bottle). K sampled futures of the bottle spread
      ahead of it while the hand holds it, as a flow model can draw several; the bold amber bottle is
      the first sample, the one a rollout commits; "truth" is what the recording did next.
      The samples are an illustration of the method, drawn around the recorded future. */
window.FTTour3D = (function () {
  const none = { anim: { pause() {}, resume() {} } };
  if (!window.Clay) return { foresee: none };
  const C = window.Clay, T = THREE;
  const AMBER = 0xf2a93b, RED = 0xe5545b;

  function pills(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      onChange(b.dataset.v);
    }));
  }

  // ------------------------------------------------------------------ 1
  function foresee() {
    const canvas = document.getElementById("tvForesee3d");
    if (!canvas) return none;
    const S = C.stage(canvas, { az: -1.75, el: 0.42, fit: 0.78 });
    const note = document.getElementById("fNote");
    const st = { K: 8, verifier: false, truth: false };   // no desk rule: our model rejects no samples
    const kIn = document.getElementById("fK"), kOut = document.getElementById("fKv");
    kIn.addEventListener("input", () => { st.K = +kIn.value; kOut.textContent = kIn.value; });
    pills("fVer", v => st.verifier = v === "1");
    pills("fTruth", v => st.truth = v === "1");

    C.load("hero").then(({ meta, buf }) => {
      const L = meta.layout, H = meta.human;
      const hv = C.arr(buf, L.human_verts), NV = L.human_verts.shape[1];
      const ho = C.arr(buf, L.human_obj), NO = L.human_obj.shape[0];
      const bv = new Float32Array(C.arr(buf, L.bottle_verts)), bf = C.arr(buf, L.bottle_faces);
      const desk = meta.table_z;

      const handPos = new Float32Array(NV * 3);
      const handGeo = C.geometry(handPos, C.arr(buf, L.human_faces), false);
      const hand = new T.Mesh(handGeo, C.clay(0xd9ac8f, { transparent: false }));
      hand.castShadow = true;
      const bGeo = C.geometry(bv, bf);
      const bottle = new T.Mesh(bGeo, C.clay(0xebe4d8, { transparent: false }));
      bottle.castShadow = true;
      // the bottle's lowest point in its own frame, for the desk rule (a sparse subset is enough)
      const low = []; for (let i = 0; i < bv.length; i += 3 * 23) low.push(new T.Vector3(bv[i], bv[i + 1], bv[i + 2]));

      const KMAX = 16, N = 14, HZ = 0.9;              // samples, steps, horizon (s)
      const mats = {
        ok: new T.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.25, transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.6 }),
        bad: new T.MeshStandardMaterial({ color: RED, emissive: RED, emissiveIntensity: 0.25, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.6 }),
        fused: new T.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 0.3, transparent: true, opacity: 0.7, roughness: 0.5 }),
        truth: new T.MeshBasicMaterial({ color: 0x55606e, wireframe: true, transparent: true, opacity: 0.25 }),
        lineOk: new T.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.75 }),
        lineBad: new T.LineDashedMaterial({ color: RED, dashSize: 0.008, gapSize: 0.006, transparent: true, opacity: 0.85 }),
        lineTruth: new T.LineDashedMaterial({ color: 0x55606e, dashSize: 0.006, gapSize: 0.006, transparent: true, opacity: 0.8 })
      };
      const ghosts = [], lines = [];
      for (let k = 0; k < KMAX; k++) {
        const g = new T.Mesh(bGeo, mats.ok); ghosts.push(g);
        const lg = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(N * 3), 3));
        const l = new T.Line(lg, mats.lineOk); lines.push(l);
      }
      const fused = new T.Mesh(bGeo, mats.fused);
      const truth = new T.Mesh(bGeo, mats.truth);
      const tlg = new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(new Float32Array(N * 3), 3));
      const tline = new T.Line(tlg, mats.lineTruth);
      S.root.add(hand, bottle, fused, truth, tline, ...ghosts, ...lines);

      const box = new T.Box3();
      for (let i = 0; i < NO; i++) box.expandByPoint(new T.Vector3(ho[i * 7], ho[i * 7 + 1], ho[i * 7 + 2]));
      S.frameOn(box.getCenter(new T.Vector3()).add(new T.Vector3(0, 0, 0.03)), box.getSize(new T.Vector3()).length() / 2 + 0.1, desk);

      const tmp = new T.Object3D(), tmp2 = new T.Object3D(), v3 = new T.Vector3(), ax = new T.Vector3(), qn = new T.Quaternion();
      function activity(t) {
        const g0 = H.grasp_s, r0 = H.release_s;
        if (t < g0 - 0.6) return 0.06;
        if (t < g0) return 0.06 + 0.94 * (t - (g0 - 0.6)) / 0.6;
        if (t < r0) return 1;
        return Math.max(0.05, 1 - (t - r0) / 0.5);
      }
      function lowest(obj) {
        let m = 1e9;
        for (const p of low) { v3.copy(p).applyQuaternion(obj.quaternion); m = Math.min(m, v3.z); }
        return obj.position.z + m;
      }
      let th = 0.6;
      S.loop((t, dt) => {
        th += dt * 0.75;
        if (th > H.end_s) th = 0;
        C.morph(handPos, hv, NV, th * H.fps, H.n, meta.human_center, meta.human_scale);
        handGeo.attributes.position.needsUpdate = true;
        handGeo.computeVertexNormals();
        C.pose(bottle, ho, NO, th * 30);
        const act = activity(th);
        let nRej = 0;
        const keep = [];
        for (let k = 0; k < KMAX; k++) {
          const on = k < st.K;
          ghosts[k].visible = lines[k].visible = on;
          if (!on) continue;
          const pos = lines[k].geometry.attributes.position.array;
          const ph = t * 0.45 + k * 7.31;
          const nx = FT.vnoise(k + 3, 1, ph), ny = FT.vnoise(k + 3, 2, ph), nz = FT.vnoise(k + 3, 3, ph) - 0.35;
          const nr = FT.vnoise(k + 3, 4, ph);
          let bad = false;
          for (let i = 0; i < N; i++) {
            const h = (i / (N - 1)) * HZ, gr = Math.pow(h / HZ, 1.3) * act;
            C.pose(tmp, ho, NO, (th + h) * 30);
            tmp.position.x += gr * 0.05 * nx;
            tmp.position.y += gr * 0.06 * ny;
            tmp.position.z += gr * 0.07 * nz;
            ax.set(ny, -nx, 0.3).normalize();
            tmp.quaternion.premultiply(qn.setFromAxisAngle(ax, gr * 0.5 * nr));
            pos[i * 3] = tmp.position.x; pos[i * 3 + 1] = tmp.position.y; pos[i * 3 + 2] = tmp.position.z;
            if (!bad && lowest(tmp) < desk - 0.006) bad = true;
          }
          lines[k].geometry.attributes.position.needsUpdate = true;
          ghosts[k].position.copy(tmp.position);
          ghosts[k].quaternion.copy(tmp.quaternion);
          const rejected = bad && st.verifier;
          if (rejected) nRej++; else keep.push(ghosts[k]);
          ghosts[k].material = rejected ? mats.bad : mats.ok;
          lines[k].material = rejected ? mats.lineBad : mats.lineOk;
          if (rejected) lines[k].computeLineDistances();
          ghosts[k].visible = act > 0.15;
        }
        // bold: the first sample, the one a rollout commits
        if (act > 0.15) { fused.visible = true; fused.position.copy(ghosts[0].position); fused.quaternion.copy(ghosts[0].quaternion); }
        else fused.visible = false;
        // what the recording actually did next
        truth.visible = tline.visible = st.truth;
        if (st.truth) {
          const p = tline.geometry.attributes.position.array;
          for (let i = 0; i < N; i++) { C.pose(tmp2, ho, NO, (th + (i / (N - 1)) * HZ) * 30); p[i * 3] = tmp2.position.x; p[i * 3 + 1] = tmp2.position.y; p[i * 3 + 2] = tmp2.position.z; }
          tline.geometry.attributes.position.needsUpdate = true;
          tline.computeLineDistances();
          truth.position.copy(tmp2.position); truth.quaternion.copy(tmp2.quaternion);
        }
        if (note) {
          const state = act > 0.9 ? "Hand holding the bottle: the futures spread." : act < 0.1 ? "Untouched bottle: every future stays put." : "Hand closing in.";
          note.innerHTML = `${st.K} sampled futures of the bottle. Bold: the first, the one a rollout commits.<br><span class="a">${state}</span>`;
        }
      });
    }).catch(() => canvas.parentElement.classList.add("no-gl"));
    return S;
  }

  return { foresee: foresee() };
})();
