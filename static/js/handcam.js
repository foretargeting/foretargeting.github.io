/* The visitor's own hands through the webcam: MediaPipe Hand Landmarker (Apache 2.0) in the browser, up to two hands, 21
   landmarks per video frame, image (normalised) and world (metres, camera-aligned, centred on the hand). The video and
   the landmarks stay on the device. Loaded only when the visitor turns the camera on.

   HandCam.start(box, onHand) shows a mirrored preview with the tracked hands drawn on it and calls
   onHand(hand, now, hands) for every new video frame: hands = [{ image, world, side, score, aspect }, ...] (0-2, at
   most one per side), hand = the first of them or null when no hand is seen.
   start(box, onHand, { src } or { stream }) plays a video file or a MediaStream instead of the camera (scripted
   checks); { when } is asked before
   every frame whether tracking is wanted (the stage on screen). */
window.HandCam = (function () {
  const VER = "0.10.14", BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
  const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
  let landmarker = null, loading = null, stream = null, video = null, canvas = null, ctx = null, raf = 0, lastTime = -1, stamp = 0, cb = null, when = null;

  function load() {
    return loading || (loading = (async () => {
      const vision = await import(`${BASE}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const options = delegate => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { landmarker = await vision.HandLandmarker.createFromOptions(files, options("GPU")); }
      catch (e) { landmarker = await vision.HandLandmarker.createFromOptions(files, options("CPU")); }
      return landmarker;
    })().catch(e => { loading = null; throw e; }));
  }

  async function start(box, onHand, opts) {
    opts = opts || {};
    cb = onHand;
    when = opts.when || null;
    video = box.querySelector("video");
    canvas = box.querySelector("canvas");
    ctx = canvas.getContext("2d");
    await load();
    if (opts.stream) {
      video.removeAttribute("src");
      video.srcObject = opts.stream;
    } else if (opts.src) {
      video.srcObject = null;
      video.src = opts.src;
      video.loop = true;
      video.muted = true;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
      video.srcObject = stream;
    }
    await video.play();
    lastTime = -1;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (video) { video.pause(); video.srcObject = null; video.removeAttribute("src"); video.load(); }
    cb = null;
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!video || video.readyState < 2 || video.currentTime === lastTime || (when && !when())) return;
    lastTime = video.currentTime;
    stamp = Math.max(Math.round(now), stamp + 1);     // the graph wants strictly increasing timestamps
    let res;
    try { res = landmarker.detectForVideo(video, stamp); } catch (e) { return; }
    const aspect = video.videoWidth / Math.max(1, video.videoHeight);
    // on an unmirrored frame (the camera's own) tasks-vision 0.10.14 names the visitor's own hand: a rendered left
    // MANO hand, palm to the camera, comes out "Left" (0.94), its mirror image "Right"
    const hands = res && res.landmarks ? res.landmarks.map((image, i) => ({
      image, world: res.worldLandmarks[i], aspect,
      side: res.handedness[i][0].categoryName === "Left" ? "left" : "right", score: res.handedness[i][0].score
    })) : [];
    // two hands given the same name: the one further right in the (unmirrored) picture is the visitor's left
    if (hands.length === 2 && hands[0].side === hands[1].side) {
      const [a, b] = hands[0].image[0].x > hands[1].image[0].x ? [0, 1] : [1, 0];
      hands[a].side = "left"; hands[b].side = "right";
    }
    draw(hands);
    if (cb) cb(hands[0] || null, now, hands);
  }

  // the preview: the frame mirrored like a mirror, the tracked hands drawn on it
  function draw(hands) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const hand of hands) {
      // the video is drawn with object-fit: cover, mirrored; map normalised image points the same way
      const va = hand.aspect, ba = w / h;
      const sw = va > ba ? h * va : w, sh = va > ba ? h : w / va, ox = (w - sw) / 2, oy = (h - sh) / 2;
      const P = hand.image.map(p => [w - (ox + p.x * sw), oy + p.y * sh]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hand.side === "left" ? "rgba(62,168,229,0.95)" : "rgba(242,169,59,0.95)";
      ctx.beginPath();
      for (const [a, b] of BONES) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
      ctx.stroke();
      ctx.fillStyle = "#fff";
      for (const p of P) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.2, 0, 7); ctx.fill(); }
    }
  }

  return { start, stop, load, get running() { return !!raf; } };
})();
