/* The manosim hand in the browser: object-teleop's MuJoCo capsule hand (a palm mesh and 15 capsules on the MANO
   kinematic tree, every joint a ball joint), drawn with three.js and posed by forward kinematics.

   Data (assets/sim.json -> hands.<side>, written by export_assets.py):
     bodies[16]    { parent, pos, anchor }: body frame in its parent and the ball joint's pivot in the body frame
     capsules[15]  { body, a, b, r }: capsule end points and radius in the body frame
     landmarks[21] { parent, body, offset }: the skeleton the WORLD MODEL sees. The training loader computes its 21
                   landmarks from MANO with a reference shape, which is not the capsule hand's own geometry, so each
                   landmark hangs off its parent landmark by a fitted bone, rotated with the capsule body that carries it.
                   The right hand's skeleton is the left one mirrored (export_assets.py says why).
     open, hold, tight  15 finger quaternions (w, x, y, z) each, from a recorded demo: wide open, carrying a cube, a fist;
                   grasp: the carried cube's centre in the wrist frame; ready { pos, quat }: the start wrist.

   ManoSim.fk(spec, p, q, fingers, out) fills out.pos / out.rot (16 bodies, world) and out.L (21 landmarks, 63 floats)
   from a wrist position, a wrist quaternion and 15 finger quaternions. ManoSim.build makes the meshes, ManoSim.place
   moves them to a computed state. */
window.ManoSim = (function () {
  const T = THREE, v = new T.Vector3(), yAxis = new T.Vector3(0, 1, 0);

  // a capsule along +y, as a lathe (three r128 has no CapsuleGeometry)
  function capsuleGeometry(r, len) {
    const pts = [], n = 6;
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI / 2; pts.push(new T.Vector2(Math.cos(a) * r, -len / 2 + Math.sin(a) * r)); }
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new T.Vector2(Math.cos(a) * r, len / 2 + Math.sin(a) * r)); }
    return new T.LatheGeometry(pts, 16);
  }

  const quat = a => new T.Quaternion(a[1], a[2], a[3], a[0]);                 // stored (w, x, y, z)
  function state() {
    return { pos: Array.from({ length: 16 }, () => new T.Vector3()), rot: Array.from({ length: 16 }, () => new T.Quaternion()), L: new Float32Array(63) };
  }

  function fk(spec, p, q, fingers, out) {
    out.pos[0].copy(p); out.rot[0].copy(q);
    for (let i = 1; i < 16; i++) {
      const b = spec.bodies[i], pr = out.rot[b.parent];
      v.set(b.pos[0] + b.anchor[0], b.pos[1] + b.anchor[1], b.pos[2] + b.anchor[2]).applyQuaternion(pr).add(out.pos[b.parent]);   // the pivot
      out.rot[i].copy(pr).multiply(fingers[i - 1]);
      out.pos[i].set(-b.anchor[0], -b.anchor[1], -b.anchor[2]).applyQuaternion(out.rot[i]).add(v);
    }
    const L = out.L;
    L[0] = p.x; L[1] = p.y; L[2] = p.z;
    for (let j = 1; j < 21; j++) {
      const s = spec.landmarks[j];
      v.set(s.offset[0], s.offset[1], s.offset[2]).applyQuaternion(out.rot[s.body]);
      L[j * 3] = L[s.parent * 3] + v.x; L[j * 3 + 1] = L[s.parent * 3 + 1] + v.y; L[j * 3 + 2] = L[s.parent * 3 + 2] + v.z;
    }
    return out;
  }

  function build(spec, palmVerts, palmFaces, material) {
    const group = new T.Group(), bodies = [];
    for (let i = 0; i < 16; i++) { const g = new T.Group(); group.add(g); bodies.push(g); }
    for (const c of spec.capsules) {
      const a = new T.Vector3().fromArray(c.a), b = new T.Vector3().fromArray(c.b), axis = b.clone().sub(a);
      const mesh = new T.Mesh(capsuleGeometry(c.r, axis.length()), material);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(yAxis, axis.normalize());
      mesh.castShadow = true;
      bodies[c.body].add(mesh);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(palmVerts), 3));
    g.setIndex(new T.BufferAttribute(new Uint32Array(palmFaces), 1));
    g.computeVertexNormals();
    const palm = new T.Mesh(g, material);
    palm.castShadow = true;
    bodies[0].add(palm);
    return { group, bodies, spec };
  }

  function place(hand, s) {
    for (let i = 0; i < 16; i++) { hand.bodies[i].position.copy(s.pos[i]); hand.bodies[i].quaternion.copy(s.rot[i]); }
  }

  // the hand's own axes in the wrist frame, from the landmark skeleton: along the palm (wrist -> middle knuckle) and
  // out of the back of the hand; both signed so that at the ready pose they point away from the operator and up
  function axes(spec) {
    const o = j => new T.Vector3().fromArray(spec.landmarks[j].offset), ready = quat(spec.ready.quat);
    const dir = o(9).normalize(), normal = o(5).cross(o(17)).normalize();
    if (dir.clone().applyQuaternion(ready).y < 0) dir.negate();
    if (normal.clone().applyQuaternion(ready).z < 0) normal.negate();
    return { dir, normal };
  }

  return { fk, build, place, state, axes, quat };
})();
