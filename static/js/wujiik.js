/* Wuji Hand 2.2 retargeted from a MANO hand in the browser: a per-frame port of humanik,
   the kinematic stage of our human-like retargeter. The robot hand copies the human's bone DIRECTIONS, so it takes the
   human's shape whatever its finger lengths; a human fingertip near the object adds a fingertip POSITION target, faded
   in by its distance to the object with no threshold; the palm follows the human palm softly through the knuckle
   calibration; a posture pull resolves what the rest leaves free; object penetration and finger overlap are soft costs.
   Weights are the foretargeting worker's (robot worker: thumb_sigma 0.04, no contact transport, palm held
   first on a fresh start).

   What differs from humanik, for a page: one Levenberg-Marquardt solve per model frame, warm-started, where humanik
   solves a whole clip at once. Its smoothness term (second difference of the motion, over the whole clip) has no causal
   twin: looking back at the last two frames only, it acts as inertia, and the hand overshot and trailed the human palm
   by 7-10 cm (median 72 mm, rotations up to 90 deg on a mouse path); a light first difference to the last frame damps
   the fingers' back-and-forth instead (39 -> 0 reversals in free motion, the palm within 2 mm). Distances come from
   points sampled on the hand's surface against the 512 object points the world model sees, read as a smooth point-set
   surface, instead of mj_geomDistance on collision meshes, and the hand also keeps clear of the desk. No physics: the
   physics retargeter that executes this reference under MuJoCo runs offline.

   Data: static/live/wuji.json/.bin (tools/export_wuji.py). */
window.WujiIK = (function () {
  const WEIGHTS = {
    bone: 1.0, tip: 40.0, palm_pos: 15.0, palm_rot: 0.5, posture: 0.02,
    contact: 300.0, clearance: 0.0005, margin: 0.02, stick: 60.0, softness: 0.003,
    finger: 80.0, finger_radius: 0.008, finger_softness: 0.002,
    contact_sigma: 0.012, thumb_sigma: 0.04, palm_first: 20.0, iterations: 25,
    desk: 300.0,               // ours: the desk is a surface too
    velocity: 0.3,             // ours: per rad (base per decimetre) of change from the last frame
    accel: 0.0,                // humanik's 16, causal here: inertia (see above); kept for checks
    frames: 3                  // humanik's frames (30 Hz) per page frame (10 Hz): scales accel
  };
  const N = 26;                // base translation 3, base rotation 3 (world-frame increments), 20 finger joints

  // ------------------------------------------------------------------ small linear algebra on plain arrays
  function quatMat(q, o) {
    const [w, x, y, z] = q;
    o[0] = 1 - 2 * (y * y + z * z); o[1] = 2 * (x * y - z * w); o[2] = 2 * (x * z + y * w);
    o[3] = 2 * (x * y + z * w); o[4] = 1 - 2 * (x * x + z * z); o[5] = 2 * (y * z - x * w);
    o[6] = 2 * (x * z - y * w); o[7] = 2 * (y * z + x * w); o[8] = 1 - 2 * (x * x + y * y);
    return o;
  }
  function axisAngle(ax, ay, az, t, o) {          // rotation about a unit axis
    const c = Math.cos(t), s = Math.sin(t), v = 1 - c;
    o[0] = c + ax * ax * v; o[1] = ax * ay * v - az * s; o[2] = ax * az * v + ay * s;
    o[3] = ay * ax * v + az * s; o[4] = c + ay * ay * v; o[5] = ay * az * v - ax * s;
    o[6] = az * ax * v - ay * s; o[7] = az * ay * v + ax * s; o[8] = c + az * az * v;
    return o;
  }
  function expMap(wx, wy, wz, o) {
    const t = Math.hypot(wx, wy, wz);
    if (t < 1e-12) { o.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); return o; }
    return axisAngle(wx / t, wy / t, wz / t, t, o);
  }
  function mul(a, b, o) {                          // o = a b (3x3, o may not alias)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
  }
  function mulT(a, b, o) {                         // o = a b^T
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      o[i * 3 + j] = a[i * 3] * b[j * 3] + a[i * 3 + 1] * b[j * 3 + 1] + a[i * 3 + 2] * b[j * 3 + 2];
    return o;
  }
  // world-frame small rotation taking R toward T (humanik.rotation_error)
  function rotErr(R, T, o) {
    const E = mulT(T, R, new Float64Array(9));
    o[0] = 0.5 * (E[7] - E[5]); o[1] = 0.5 * (E[2] - E[6]); o[2] = 0.5 * (E[3] - E[1]);
    return o;
  }
  function logMap(R, o) {                          // rotation vector of R
    const c = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)), t = Math.acos(c);
    const k = t < 1e-6 ? 0.5 : t / (2 * Math.sin(t));
    o[0] = k * (R[7] - R[5]); o[1] = k * (R[2] - R[6]); o[2] = k * (R[3] - R[1]);
    return o;
  }
  // Cholesky solve of (H + mu I) x = b, n x n
  function cholSolve(H, mu, b, n, x) {
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = H[i * n + j] + (i === j ? mu : 0);
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (s <= 0) return false; L[i * n + i] = Math.sqrt(s); }
        else L[i * n + j] = s / L[j * n + j];
      }
    }
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k]; x[i] = s / L[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
    return true;
  }
  // rigid fit (Horn's quaternion method): R, t with R a_i + t ~ b_i, from flat (n*3) arrays
  function kabsch(a, b, n, outR, outT) {
    let ca = [0, 0, 0], cb = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += a[i * 3 + k] / n; cb[k] += b[i * 3 + k] / n; }
    const S = new Float64Array(9);
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      S[r * 3 + c] += (a[i * 3 + r] - ca[r]) * (b[i * 3 + c] - cb[c]);
    const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
    const M = [xx + yy + zz, yz - zy, zx - xz, xy - yx,
      yz - zy, xx - yy - zz, xy + yx, zx + xz,
      zx - xz, xy + yx, -xx + yy - zz, yz + zy,
      xy - yx, zx + xz, yz + zy, -xx - yy + zz];
    const q = topEigen4(M);
    quatMat(q, outR);
    for (let k = 0; k < 3; k++) outT[k] = cb[k] - (outR[k * 3] * ca[0] + outR[k * 3 + 1] * ca[1] + outR[k * 3 + 2] * ca[2]);
  }
  function topEigen4(M) {                          // Jacobi sweeps on a symmetric 4x4, eigenvector of the largest eigenvalue
    const A = M.slice(), V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let sweep = 0; sweep < 24; sweep++) {
      let off = 0;
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p * 4 + q] * A[p * 4 + q];
      if (off < 1e-22) break;
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
        const apq = A[p * 4 + q];
        if (Math.abs(apq) < 1e-30) continue;
        const th = (A[q * 4 + q] - A[p * 4 + p]) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = A[k * 4 + p], akq = A[k * 4 + q];
          A[k * 4 + p] = c * akp - s * akq; A[k * 4 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = A[p * 4 + k], aqk = A[q * 4 + k];
          A[p * 4 + k] = c * apk - s * aqk; A[q * 4 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k * 4 + p], vkq = V[k * 4 + q];
          V[k * 4 + p] = c * vkp - s * vkq; V[k * 4 + q] = s * vkp + c * vkq;
        }
      }
    }
    let best = 0;
    for (let i = 1; i < 4; i++) if (A[i * 5] > A[best * 5]) best = i;
    const q = [V[best], V[4 + best], V[8 + best], V[12 + best]], n = Math.hypot(...q);
    return q.map(v => v / n);
  }

  // ------------------------------------------------------------------ the hand: kinematic tree and forward kinematics
  function Hand(desc, side, arr) {
    const B = this.B = desc.bodies.length;
    this.nq = desc.joints.length;
    this.parent = desc.bodies.map(b => b.parent);
    this.Lr = new Float64Array(B * 9); this.Lp = new Float64Array(B * 3);
    this.jnt = new Int32Array(B).fill(-1); this.axis = new Float64Array(B * 3); this.anchor = new Float64Array(B * 3);
    desc.bodies.forEach((b, i) => {
      this.Lr.set(quatMat(b.quat, new Float64Array(9)), i * 9);
      this.Lp.set(b.pos, i * 3);
      if (b.joint >= 0) { this.jnt[i] = b.joint; this.axis.set(b.axis, i * 3); this.anchor.set(b.anchor, i * 3); }
    });
    this.lo = new Float64Array(desc.joints.map(j => j.range[0])); this.hi = new Float64Array(desc.joints.map(j => j.range[1]));
    this.jointBody = new Int32Array(desc.joints.map(j => j.body));
    // the joints on each body's path to the root
    this.anc = desc.bodies.map((_, i) => { const out = []; for (let b = i; b >= 0; b = this.parent[b]) if (this.jnt[b] >= 0) out.push(this.jnt[b]); return out; });
    this.chains = desc.chains; this.tips = desc.tips; this.owner = desc.owner;
    this.R = new Float64Array(B * 9); this.P = new Float64Array(B * 3);
    this.axW = new Float64Array(this.nq * 3); this.anW = new Float64Array(this.nq * 3);
    this.calR = new Float64Array(desc.calibration.rotation.flat()); this.calT = new Float64Array(desc.calibration.translation);
    // surface samples, grouped per body
    const S = arr(side + "_samples"), sb = arr(side + "_sample_body");
    this.samples = S; this.sampleBody = sb; this.nS = sb.length;
    this.parts = desc.parts;
    this._r0 = new Float64Array(9); this._rt = new Float64Array(9);
  }
  // world pose of every body for base (R, p) and joints q
  Hand.prototype.fk = function (baseR, baseP, q) {
    const R0 = this._r0, Rt = this._rt;
    for (let b = 0; b < this.B; b++) {
      const pa = this.parent[b], PR = pa < 0 ? baseR : this.R.subarray(pa * 9, pa * 9 + 9), PP = pa < 0 ? baseP : this.P.subarray(pa * 3, pa * 3 + 3);
      mul(PR, this.Lr.subarray(b * 9, b * 9 + 9), R0);
      const lp = this.Lp, i3 = b * 3;
      const px = PP[0] + PR[0] * lp[i3] + PR[1] * lp[i3 + 1] + PR[2] * lp[i3 + 2];
      const py = PP[1] + PR[3] * lp[i3] + PR[4] * lp[i3 + 1] + PR[5] * lp[i3 + 2];
      const pz = PP[2] + PR[6] * lp[i3] + PR[7] * lp[i3 + 1] + PR[8] * lp[i3 + 2];
      const j = this.jnt[b], Rb = this.R.subarray(b * 9, b * 9 + 9);
      if (j < 0) { Rb.set(R0); this.P[i3] = px; this.P[i3 + 1] = py; this.P[i3 + 2] = pz; continue; }
      const ax = this.axis[i3], ay = this.axis[i3 + 1], az = this.axis[i3 + 2], an = this.anchor;
      // joint axis and anchor in the world
      this.axW[j * 3] = R0[0] * ax + R0[1] * ay + R0[2] * az;
      this.axW[j * 3 + 1] = R0[3] * ax + R0[4] * ay + R0[5] * az;
      this.axW[j * 3 + 2] = R0[6] * ax + R0[7] * ay + R0[8] * az;
      const wx = px + R0[0] * an[i3] + R0[1] * an[i3 + 1] + R0[2] * an[i3 + 2];
      const wy = py + R0[3] * an[i3] + R0[4] * an[i3 + 1] + R0[5] * an[i3 + 2];
      const wz = pz + R0[6] * an[i3] + R0[7] * an[i3 + 1] + R0[8] * an[i3 + 2];
      this.anW[j * 3] = wx; this.anW[j * 3 + 1] = wy; this.anW[j * 3 + 2] = wz;
      mul(R0, axisAngle(ax, ay, az, q[j], Rt), Rb);
      this.P[i3] = wx - (Rb[0] * an[i3] + Rb[1] * an[i3 + 1] + Rb[2] * an[i3 + 2]);
      this.P[i3 + 1] = wy - (Rb[3] * an[i3] + Rb[4] * an[i3 + 1] + Rb[5] * an[i3 + 2]);
      this.P[i3 + 2] = wz - (Rb[6] * an[i3] + Rb[7] * an[i3 + 1] + Rb[8] * an[i3 + 2]);
    }
  };
  // world point of a body-frame point
  Hand.prototype.point = function (b, x, y, z, o) {
    const R = this.R, P = this.P, k = b * 9;
    o[0] = P[b * 3] + R[k] * x + R[k + 1] * y + R[k + 2] * z;
    o[1] = P[b * 3 + 1] + R[k + 3] * x + R[k + 4] * y + R[k + 5] * z;
    o[2] = P[b * 3 + 2] + R[k + 6] * x + R[k + 7] * y + R[k + 8] * z;
    return o;
  };
  // (3, N) Jacobian of a world point p fixed on body b, row-major, base first
  Hand.prototype.jac = function (b, p, base, J) {
    J.fill(0);
    const rx = p[0] - base[0], ry = p[1] - base[1], rz = p[2] - base[2];
    J[0] = 1; J[N + 1] = 1; J[2 * N + 2] = 1;
    // e_k x r for the base rotation increments
    J[4] = rz; J[5] = -ry; J[N + 3] = -rz; J[N + 5] = rx; J[2 * N + 3] = ry; J[2 * N + 4] = -rx;
    for (const j of this.anc[b]) {
      const a = this.axW, w = this.anW, k = j * 3;
      const dx = p[0] - w[k], dy = p[1] - w[k + 1], dz = p[2] - w[k + 2];
      J[6 + j] = a[k + 1] * dz - a[k + 2] * dy;
      J[N + 6 + j] = a[k + 2] * dx - a[k] * dz;
      J[2 * N + 6 + j] = a[k] * dy - a[k + 1] * dx;
    }
    return J;
  };

  // ------------------------------------------------------------------ the retargeter
  function State(R, p, q) { this.R = Float64Array.from(R); this.p = Float64Array.from(p); this.q = Float64Array.from(q); }

  function Retargeter(hand, weights) {
    this.hand = hand;
    this.w = Object.assign({}, WEIGHTS, weights || {});
    this.history = [];
    this.H = new Float64Array(N * N); this.g = new Float64Array(N);
    this.mid = hand.lo.map((l, i) => 0.5 * (l + hand.hi[i]));
    this.seed = hand.lo.map((l, i) => Math.min(hand.hi[i], Math.max(l, l + 0.3 * (hand.hi[i] - l))));
    this._J = new Float64Array(3 * N); this._J2 = new Float64Array(3 * N); this._row = new Float64Array(N);
    this.chainP = new Float64Array(60); this.chainJ = new Float64Array(20 * 3 * N);
    this.ms = 0;
  }
  Retargeter.prototype.reset = function () { this.history = []; };

  /* One frame. input: L (63) human landmarks in the world, wrist {R (9), p (3)} the human hand frame the calibration was
     fitted in, object {points, normals} (world, n*3 each) or null, desk height. Returns the robot state {R, p, q}. */
  Retargeter.prototype.solve = function (input) {
    const t0 = performance.now(), w = this.w, h = this.hand, L = input.L;
    // targets: bone directions, tips, fades, the calibrated base
    this.boneT = new Float64Array(45); this.tipT = new Float64Array(15); this.fade = new Float64Array(5);
    for (let f = 0; f < 5; f++) {
      const c = [1 + 4 * f, 2 + 4 * f, 3 + 4 * f, 4 + 4 * f];
      for (let b = 0; b < 3; b++) {
        const i = c[b] * 3, j = c[b + 1] * 3, dx = L[j] - L[i], dy = L[j + 1] - L[i + 1], dz = L[j + 2] - L[i + 2], n = Math.hypot(dx, dy, dz) || 1e-9;
        this.boneT.set([dx / n, dy / n, dz / n], (f * 3 + b) * 3);
      }
      this.tipT.set([L[c[3] * 3], L[c[3] * 3 + 1], L[c[3] * 3 + 2]], f * 3);
    }
    this.obj = input.object;
    if (this.obj) {
      const P = this.obj.points, n = P.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < n; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
      cx /= n; cy /= n; cz /= n;
      let r = 0;
      for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy, P[i * 3 + 2] - cz));
      this.objC = [cx, cy, cz]; this.objR = r;
      this.objH = 1.5 * (this.obj.spacing || 0.006);
      for (let f = 0; f < 5; f++) {
        const d = Math.sqrt(this.nearest(this.tipT[f * 3], this.tipT[f * 3 + 1], this.tipT[f * 3 + 2])[1]);
        this.fade[f] = Math.exp(-d / (f === 0 && w.thumb_sigma > 0 ? w.thumb_sigma : w.contact_sigma));
      }
    }
    this.desk = input.desk;
    const Rw = input.wrist.R, pw = input.wrist.p, RT = mulT(Rw, h.calR, new Float64Array(9));
    this.baseR = RT;
    this.baseP = Float64Array.from([0, 1, 2].map(k => pw[k] - (RT[k * 3] * h.calT[0] + RT[k * 3 + 1] * h.calT[1] + RT[k * 3 + 2] * h.calT[2])));

    let s;
    if (!this.history.length) {
      // humanik.solve: the shape first with the palm held, then the soft palm, then the object
      s = new State(this.baseR, this.baseP, this.seed);
      const contact = w.contact, desk = w.desk, palm = w.palm_rot;
      w.contact = w.desk = 0;
      w.palm_rot = w.palm_first; s = this.descend(s, w.iterations);
      w.palm_rot = palm; s = this.descend(s, w.iterations);
      w.contact = contact; w.desk = desk;
      s = this.descend(s, w.iterations);
    } else {
      const last = this.history[this.history.length - 1];
      s = this.descend(new State(last.R, last.p, last.q), 12);
    }
    s = this.pushOut(s);
    this.history.push(s);
    if (this.history.length > 2) this.history.shift();
    this.ms = performance.now() - t0;
    return s;
  };

  /* Ours: the penetration cost is soft, and a warm start that crossed into the object (the human palm swept through it)
     could stay inside, the hand embedded in the box. After the solve, the whole hand is moved out rigidly: by the sum
     of (depth x outward normal) over its surface samples more than 2 mm inside, capped at the deepest depth, never down (the object sits on the
     desk), at most four times. Fingers pressing on opposite faces cancel, so a grasp is left alone. */
  Retargeter.prototype.pushOut = function (s) {
    if (!this.obj) return s;
    const h = this.hand, S = h.samples, sb = h.sampleBody, p = [0, 0, 0], reach = this.objR + 0.01, tol = 0.002;
    for (let it = 0; it < 4; it++) {
      h.fk(s.R, s.p, s.q);
      let n = 0, dx = 0, dy = 0, dz = 0;
      for (let i = 0; i < h.nS; i++) {
        h.point(sb[i], S[i * 3], S[i * 3 + 1], S[i * 3 + 2], p);
        if (Math.hypot(p[0] - this.objC[0], p[1] - this.objC[1], p[2] - this.objC[2]) > reach) continue;
        const [d, a, b, c] = this.surface(p[0], p[1], p[2]);
        if (d < -tol) { const k = -d; dx += k * a; dy += k * b; dz += k * c; n = Math.max(n, k); }
      }
      if (!n) break;
      dz = Math.max(0, dz);
      const len = Math.hypot(dx, dy, dz);
      if (len < 2e-4) break;
      if (len > n) { dx *= n / len; dy *= n / len; dz *= n / len; }
      s.p[0] += dx; s.p[1] += dy; s.p[2] += dz;
    }
    return s;
  };

  // nearest object point to (x, y, z): [index, squared distance]
  Retargeter.prototype.nearest = function (x, y, z) {
    const P = this.obj.points, n = P.length / 3;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return [best, bd];
  };

  Retargeter.prototype.descend = function (s, iterations) {
    let mu = 1e-3, cost = this.evaluate(s, true);
    const step = new Float64Array(N), rhs = new Float64Array(N);
    for (let it = 0; it < iterations; it++) {
      let trial = null, fresh = cost, tries = 0;
      for (; tries < 8; tries++) {
        for (let i = 0; i < N; i++) rhs[i] = -this.g[i];
        if (cholSolve(this.H, mu, rhs, N, step)) {
          trial = this.apply(s, step);
          fresh = this.evaluate(trial, false);
          if (fresh < cost) break;
        }
        mu *= 4;
      }
      if (tries === 8) break;
      const drop = cost - fresh;
      s = trial;
      mu = Math.max(mu / 3, 1e-6);
      cost = this.evaluate(s, true);
      if (drop < 1e-5 * cost) break;
    }
    this.cost = cost;
    return s;
  };

  Retargeter.prototype.apply = function (s, d) {
    const t = new State(s.R, s.p, s.q), h = this.hand;
    t.p[0] += d[0]; t.p[1] += d[1]; t.p[2] += d[2];
    mul(expMap(d[3], d[4], d[5], new Float64Array(9)), s.R, t.R);
    for (let j = 0; j < h.nq; j++) t.q[j] = Math.min(h.hi[j], Math.max(h.lo[j], s.q[j] + d[6 + j]));
    return t;
  };

  /* Total cost of a state; with jac, also J^T J and J^T r in this.H, this.g. The residuals follow humanik.Problem. */
  Retargeter.prototype.evaluate = function (s, jac) {
    const w = this.w, h = this.hand, H = this.H, g = this.g, J = this._J, row = this._row;
    if (jac) { H.fill(0); g.fill(0); }
    let cost = 0;
    const add = (r, j) => {                       // one scalar residual with its Jacobian row (or none)
      cost += r * r;
      if (!jac || !j) return;
      for (let a = 0; a < N; a++) {
        const ja = j[a];
        if (ja === 0) continue;
        g[a] += ja * r;
        for (let b = 0; b <= a; b++) H[a * N + b] += ja * j[b];
      }
    };
    const addRow3 = (r3, J3, k) => {               // residual k (0..2) of a 3-vector with a (3, N) Jacobian scaled by k's weight
      if (!jac) { add(r3, null); return; }
      for (let a = 0; a < N; a++) row[a] = J3[k * N + a];
      add(r3, row);
    };
    h.fk(s.R, s.p, s.q);
    // chain points (knuckle, PIP, DIP, tip) and their Jacobians
    const cp = this.chainP, cj = this.chainJ, tmp = [0, 0, 0];
    for (let f = 0; f < 5; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        let b;
        if (k < 3) { b = h.chains[f][k]; tmp[0] = h.P[b * 3]; tmp[1] = h.P[b * 3 + 1]; tmp[2] = h.P[b * 3 + 2]; }
        else { const t = h.tips[f]; b = t.body; h.point(b, t.pos[0], t.pos[1], t.pos[2], tmp); }
        cp[i * 3] = tmp[0]; cp[i * 3 + 1] = tmp[1]; cp[i * 3 + 2] = tmp[2];
        if (jac) cj.set(h.jac(b, tmp, s.p, J), i * 3 * N);
      }
    }
    // bone directions
    const J2 = this._J2;
    for (let f = 0; f < 5; f++) for (let k = 0; k < 3; k++) {
      const a = (f * 4 + k) * 3, b = a + 3;
      const bx = cp[b] - cp[a], by = cp[b + 1] - cp[a + 1], bz = cp[b + 2] - cp[a + 2], len = Math.max(Math.hypot(bx, by, bz), 1e-9);
      const u = [bx / len, by / len, bz / len], T = this.boneT, o = (f * 3 + k) * 3;
      if (jac) {
        // (I - u u^T) / len (J_b - J_a)
        for (let c = 0; c < N; c++) {
          const d0 = cj[(b / 3) * 3 * N + c] - cj[(a / 3) * 3 * N + c];
          const d1 = cj[(b / 3) * 3 * N + N + c] - cj[(a / 3) * 3 * N + N + c];
          const d2 = cj[(b / 3) * 3 * N + 2 * N + c] - cj[(a / 3) * 3 * N + 2 * N + c];
          const ud = u[0] * d0 + u[1] * d1 + u[2] * d2;
          J2[c] = w.bone * (d0 - u[0] * ud) / len; J2[N + c] = w.bone * (d1 - u[1] * ud) / len; J2[2 * N + c] = w.bone * (d2 - u[2] * ud) / len;
        }
      }
      for (let k3 = 0; k3 < 3; k3++) addRow3(w.bone * (u[k3] - T[o + k3]), J2, k3);
    }
    // fingertips, faded in by the human tip's distance to the object
    if (this.obj) for (let f = 0; f < 5; f++) {
      const c = w.tip * this.fade[f];
      if (c < 1e-4) continue;
      const i = (f * 4 + 3) * 3;
      if (jac) for (let x = 0; x < 3 * N; x++) J2[x] = c * cj[(f * 4 + 3) * 3 * N + x];
      for (let k3 = 0; k3 < 3; k3++) addRow3(c * (cp[i + k3] - this.tipT[f * 3 + k3]), J2, k3);
    }
    // the palm, soft: base position and rotation toward the calibrated human palm
    if (jac) row.fill(0);
    for (let k3 = 0; k3 < 3; k3++) {
      if (jac) { row.fill(0); row[k3] = w.palm_pos; }
      add(w.palm_pos * (s.p[k3] - this.baseP[k3]), row);
    }
    const e = rotErr(s.R, this.baseR, [0, 0, 0]);
    for (let k3 = 0; k3 < 3; k3++) {
      if (jac) { row.fill(0); row[3 + k3] = w.palm_rot; }
      add(-w.palm_rot * e[k3], row);
    }
    // posture: the middle of each joint's range
    for (let j = 0; j < h.nq; j++) {
      if (jac) { row.fill(0); row[6 + j] = w.posture; }
      add(w.posture * (s.q[j] - this.mid[j]), row);
    }
    // smoothness: first difference to the last frame (base translation per decimetre, as humanik scales it)
    if (this.history.length && w.velocity > 0) {
      const v = w.velocity, s1 = this.history[this.history.length - 1];
      for (let k3 = 0; k3 < 3; k3++) {
        if (jac) { row.fill(0); row[k3] = v * 10; }
        add(v * 10 * (s.p[k3] - s1.p[k3]), row);
      }
      const r = logMap(mulT(s.R, s1.R, new Float64Array(9)), [0, 0, 0]);
      for (let k3 = 0; k3 < 3; k3++) {
        if (jac) { row.fill(0); row[3 + k3] = v; }
        add(v * r[k3], row);
      }
      for (let j = 0; j < h.nq; j++) {
        if (jac) { row.fill(0); row[6 + j] = v; }
        add(v * (s.q[j] - s1.q[j]), row);
      }
    }
    // second difference to the last two frames
    if (this.history.length === 2 && w.accel > 0) {
      const a = w.accel / w.frames, [s2, s1] = this.history;
      for (let k3 = 0; k3 < 3; k3++) {
        if (jac) { row.fill(0); row[k3] = a * 10; }
        add(a * 10 * (s.p[k3] - 2 * s1.p[k3] + s2.p[k3]), row);
      }
      const v1 = logMap(mulT(s.R, s1.R, new Float64Array(9)), [0, 0, 0]), v0 = logMap(mulT(s1.R, s2.R, new Float64Array(9)), [0, 0, 0]);
      for (let k3 = 0; k3 < 3; k3++) {
        if (jac) { row.fill(0); row[3 + k3] = a; }
        add(a * (v1[k3] - v0[k3]), row);
      }
      for (let j = 0; j < h.nq; j++) {
        if (jac) { row.fill(0); row[6 + j] = a; }
        add(a * (s.q[j] - 2 * s1.q[j] + s2.q[j]), row);
      }
    }
    // object and desk: per hand body, its nearest surface sample's signed distance
    const contactOn = (w.contact > 0 && this.obj) || w.desk > 0;
    if (contactOn) cost += this.surfaces(s, jac, add);
    // finger overlap: bones on different fingers keep two finger radii apart
    if (w.finger > 0 && w.contact > 0) {
      const gap = 2 * w.finger_radius, reach = gap + 4 * w.finger_softness;
      for (let fa = 0; fa < 5; fa++) for (let fb = fa + 1; fb < 5; fb++) for (let ia = 0; ia < 3; ia++) for (let ib = 0; ib < 3; ib++) {
        const A0 = fa * 4 + ia, B0 = fb * 4 + ib, r = segment(cp, A0, A0 + 1, B0, B0 + 1);
        if (r.dist >= reach) continue;
        const x = (gap - r.dist) / w.finger_softness, sp = Math.log1p(Math.exp(-Math.abs(x))) + Math.max(x, 0);
        let jr = null;
        if (jac) {
          const sig = 1 / (1 + Math.exp(-x)), n = r.n;
          for (let c = 0; c < N; c++) {
            let v = 0;
            for (let k3 = 0; k3 < 3; k3++) {
              const ja = (1 - r.s) * cj[A0 * 3 * N + k3 * N + c] + r.s * cj[(A0 + 1) * 3 * N + k3 * N + c];
              const jb = (1 - r.t) * cj[B0 * 3 * N + k3 * N + c] + r.t * cj[(B0 + 1) * 3 * N + k3 * N + c];
              v += n[k3] * (ja - jb);
            }
            row[c] = -w.finger * sig * v;
          }
          jr = row;
        }
        add(w.finger * w.finger_softness * sp, jr);
      }
    }
    return cost;
  };

  /* Signed distance to the object's surface and its normal at (x, y, z), from the 512 points and their normals as a
     point-set surface: a Gaussian-weighted average of the points' tangent planes, bandwidth ~ the point spacing. Unlike
     the nearest point's plane it is continuous as the hand moves (nearest-point planes jump from one point to the next,
     and a cost on them shook the fingers back and forth); humanik gets the same from mj_geomDistance. */
  Retargeter.prototype.surface = function (x, y, z) {
    const P = this.obj.points, Nn = this.obj.normals, n = P.length / 3, h2 = this.objH * this.objH, cut = 9 * h2;
    let ws = 0, d = 0, nx = 0, ny = 0, nz = 0, best = Infinity, bi = 0;
    for (let i = 0; i < n; i++) {
      const dx = x - P[i * 3], dy = y - P[i * 3 + 1], dz = z - P[i * 3 + 2], q = dx * dx + dy * dy + dz * dz;
      if (q < best) { best = q; bi = i; }
      if (q < cut) {
        const wi = Math.exp(-q / h2);
        ws += wi; d += wi * (dx * Nn[i * 3] + dy * Nn[i * 3 + 1] + dz * Nn[i * 3 + 2]);
        nx += wi * Nn[i * 3]; ny += wi * Nn[i * 3 + 1]; nz += wi * Nn[i * 3 + 2];
      }
    }
    if (ws < 1e-9) {                               // far from every point: the nearest one's plane
      const k = bi * 3;
      return [(x - P[k]) * Nn[k] + (y - P[k + 1]) * Nn[k + 1] + (z - P[k + 2]) * Nn[k + 2], Nn[k], Nn[k + 1], Nn[k + 2]];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [d / ws, nx / l, ny / l, nz / l];
  };

  /* The object (humanik's contact + stick) and the desk (ours): one distance per hand body, its samples' soft minimum
     (temperature 1 mm), so the body's distance moves smoothly as its closest sample changes, with the softmax-weighted
     gradient. */
  const TAU = 0.001;
  Retargeter.prototype.surfaces = function (s, jac, add) {
    const w = this.w, h = this.hand, S = h.samples, sb = h.sampleBody, J = this._J, p = [0, 0, 0];
    const reachObj = this.obj ? this.objR + w.margin + 0.01 : -1;
    const near = { obj: new Map(), desk: new Map() };      // body -> [{ d, n, p }]
    for (let i = 0; i < h.nS; i++) {
      const b = sb[i];
      h.point(b, S[i * 3], S[i * 3 + 1], S[i * 3 + 2], p);
      if (w.desk > 0 && p[2] - this.desk < w.margin + 4 * TAU) {
        (near.desk.get(b) || near.desk.set(b, []).get(b)).push({ d: p[2] - this.desk, n: [0, 0, 1], p: p.slice() });
      }
      if (this.obj && w.contact > 0 && Math.hypot(p[0] - this.objC[0], p[1] - this.objC[1], p[2] - this.objC[2]) < reachObj) {
        const [d, nx, ny, nz] = this.surface(p[0], p[1], p[2]);
        if (d < w.margin + 4 * TAU) (near.obj.get(b) || near.obj.set(b, []).get(b)).push({ d, n: [nx, ny, nz], p: p.slice() });
      }
    }
    // a body's soft-minimum distance and, with jac, its gradient row
    const softmin = (b, list) => {
      let m = Infinity;
      for (const o of list) m = Math.min(m, o.d);
      let z = 0;
      for (const o of list) { o.e = Math.exp(-(o.d - m) / TAU); z += o.e; }
      const out = { d: m - TAU * Math.log(z), g: null };
      if (jac) {
        out.g = new Float64Array(N);
        for (const o of list) {
          const a = o.e / z;
          if (a < 1e-3) continue;
          h.jac(b, o.p, s.p, J);
          for (let c = 0; c < N; c++) out.g[c] += a * (o.n[0] * J[c] + o.n[1] * J[N + c] + o.n[2] * J[2 * N + c]);
        }
      }
      return out;
    };
    const soft = (weight, softness, o) => {
      if (o.d >= w.margin) return;
      const x = (w.clearance - o.d) / softness, sp = Math.log1p(Math.exp(-Math.abs(x))) + Math.max(x, 0);
      let jr = null;
      if (jac) { const sig = 1 / (1 + Math.exp(-x)); jr = o.g.map(v => -weight * sig * v); }
      add(weight * softness * sp, jr);
    };
    // a touching finger meets a sharper surface, so it can rest on it rather than float above it
    const fingers = [[], [], [], [], []];
    for (const [b, list] of near.obj) {
      const o = softmin(b, list), f = h.owner[b], fade = f >= 0 ? this.fade[f] : 0;
      soft(w.contact, w.softness * (1 - 0.75 * fade), o);
      if (f >= 0) fingers[f].push(o);
    }
    // stick: the finger's nearest body (soft minimum over its bodies) rests on the surface, times the fade
    if (w.stick > 0 && w.contact > 0) for (let f = 0; f < 5; f++) {
      const list = fingers[f], c = w.stick * this.fade[f];
      if (!list.length || c < 1e-4) continue;
      let m = Infinity, z = 0;
      for (const o of list) m = Math.min(m, o.d);
      for (const o of list) { o.e = Math.exp(-(o.d - m) / TAU); z += o.e; }
      const d = m - TAU * Math.log(z);
      let jr = null;
      if (jac) {
        jr = new Float64Array(N);
        if (d > 0) for (const o of list) for (let k = 0; k < N; k++) jr[k] += c * (o.e / z) * o.g[k];
      }
      add(c * Math.max(d, 0), jr);
    }
    for (const [b, list] of near.desk) soft(w.desk, w.softness, softmin(b, list));
    return 0;
  };

  // closest points of segments (a0, a1) and (b0, b1) of the chain points (Ericson's test, as humanik.bone_gaps)
  function segment(P, a0, a1, b0, b1) {
    const A = [P[a0 * 3], P[a0 * 3 + 1], P[a0 * 3 + 2]], B = [P[b0 * 3], P[b0 * 3 + 1], P[b0 * 3 + 2]];
    const d1 = [P[a1 * 3] - A[0], P[a1 * 3 + 1] - A[1], P[a1 * 3 + 2] - A[2]], d2 = [P[b1 * 3] - B[0], P[b1 * 3 + 1] - B[1], P[b1 * 3 + 2] - B[2]];
    const r = [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const aa = dot(d1, d1), ee = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2);
    const denom = Math.max(aa * ee - b * b, 1e-12);
    let s = Math.min(1, Math.max(0, (b * f - c * ee) / denom));
    let t = Math.min(1, Math.max(0, (b * s + f) / Math.max(ee, 1e-12)));
    s = Math.min(1, Math.max(0, (b * t - c) / Math.max(aa, 1e-12)));
    const v = [A[0] + s * d1[0] - B[0] - t * d2[0], A[1] + s * d1[1] - B[1] - t * d2[1], A[2] + s * d1[2] - B[2] - t * d2[2]];
    const dist = Math.hypot(v[0], v[1], v[2]);
    return { dist, s, t, n: v.map(x => x / Math.max(dist, 1e-9)) };
  }

  return { Hand, Retargeter, kabsch, quatMat, mul, mulT, WEIGHTS };
})();
