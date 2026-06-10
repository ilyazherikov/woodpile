// =============================================================
// physics.js
// Self-contained Matter.js physics module.
// Reusable: pass plain {x, y, w, h} rectangles + a config object,
// drive it each frame, push bodies with the cursor, read back
// positions/angles. All tuning flows through one config object.
// =============================================================

// Matter.js is loaded globally via CDN (window.Matter).
const { Engine, Bodies, Body, Composite } = Matter;

// --- Module state -------------------------------------------------
let engine = null;
let world = null;
let bodies = []; // array of Matter bodies
let config = null; // reference to the caller's physics config object

// Tunables
const FORCE_K = 0.0009;  // base cursor force (per unit speed, per mass)
const PUSH_RADIUS = 90;  // how close the cursor must be to push a body

// --- Public API ---------------------------------------------------

// Initialise the simulation from an array of {x, y, w, h} and a
// physics config object. The config reference is retained, so later
// mutations (e.g. mouseForceScale) are picked up live; for the
// per-body properties use setBodyProperty() to push changes onto
// already-created bodies.
// x/y are the CENTER of each rectangle, in canvas pixel coordinates.
export function initPhysics(rects, cfg) {
  destroyPhysics();

  config = cfg;

  engine = Engine.create();
  world = engine.world;

  // No gravity in any direction.
  engine.gravity.x = 0;
  engine.gravity.y = 0;

  bodies = rects.map((r) => {
    const body = Bodies.rectangle(r.x, r.y, r.w, r.h, {
      frictionAir: config.frictionAir,
      restitution: config.restitution,
      friction: config.friction,
      angle: r.angle || 0, // initial rotation of the line pattern
    });
    // Stash original dimensions; Matter doesn't expose them directly.
    body.dimW = r.w;
    body.dimH = r.h;
    // Remember the natural inertia as a baseline; the spin multiplier
    // is always applied from this value (setInertia is absolute, not
    // relative). Lower spin -> off-center hits rotate more readily;
    // mass and linear motion are unaffected.
    body._baseInertia = body.inertia;
    Body.setInertia(body, body._baseInertia * config.spin);
    return body;
  });

  Composite.add(world, bodies);
}

// Advance the simulation one frame (~16ms fixed step).
export function updatePhysics() {
  if (!engine) return;
  Engine.update(engine, 1000 / 60);
}

// Live-update a per-body property on every active body. Handles
// frictionAir | restitution | friction (via Body.set) and spin (an
// inertia multiplier applied from each body's stored baseline).
// No-op on the bodies if physics isn't running.
export function setBodyProperty(prop, value) {
  if (!config) return;
  config[prop] = value;
  if (!engine) return;
  for (const body of bodies) {
    if (prop === 'spin') {
      Body.setInertia(body, body._baseInertia * value);
    } else {
      Body.set(body, { [prop]: value });
    }
  }
}

// Push nearby bodies in the direction of cursor movement.
// (mx, my) = current cursor position; (vx, vy) = cursor velocity.
// Force magnitude scales with cursor speed and config.mouseForceScale.
export function applyMouseForce(mx, my, vx, vy) {
  if (!engine) return;

  const speed = Math.hypot(vx, vy);
  if (speed < 0.01) return; // cursor essentially still

  const userScale = config.mouseForceScale;

  for (const body of bodies) {
    const dx = body.position.x - mx;
    const dy = body.position.y - my;
    const dist = Math.hypot(dx, dy);
    if (dist > PUSH_RADIUS) continue;

    // Force scales with cursor speed, body mass (consistent accel
    // across differently sized lines), distance falloff, and the
    // user-tunable multiplier.
    const falloff = 1 - dist / PUSH_RADIUS; // stronger when closer
    const scale = FORCE_K * body.mass * falloff * userScale;

    // Apply the force AT the cursor position rather than the body
    // center: when the cursor is off-center, Matter.js derives the
    // torque automatically — hits near the center translate, grazing
    // hits near an edge rotate the body about its center.
    Body.applyForce(
      body,
      { x: mx, y: my },
      { x: vx * scale, y: vy * scale }
    );
  }
}

// Return current state for rendering / export.
// -> [{ x, y, w, h, angle }] where x/y is the center, angle in radians.
export function getBodies() {
  return bodies.map((b) => ({
    x: b.position.x,
    y: b.position.y,
    w: b.dimW,
    h: b.dimH,
    angle: b.angle,
  }));
}

// Snapshot the full motion state of every body, for undo/redo.
// -> [{ id, x, y, angle, vx, vy, av }]
export function captureState() {
  return bodies.map((b) => ({
    id: b.id,
    x: b.position.x, y: b.position.y, angle: b.angle,
    vx: b.velocity.x, vy: b.velocity.y, av: b.angularVelocity,
  }));
}

// Restore a snapshot produced by captureState(). Bodies are matched by
// id, so it's safe even if the array order changed; missing ids skip.
export function restoreState(snapshot) {
  if (!engine || !snapshot) return;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const s of snapshot) {
    const b = byId.get(s.id);
    if (!b) continue;
    Body.setPosition(b, { x: s.x, y: s.y });
    Body.setAngle(b, s.angle);
    Body.setVelocity(b, { x: s.vx, y: s.vy });
    Body.setAngularVelocity(b, s.av);
  }
}

// Tear everything down and free references.
export function destroyPhysics() {
  if (world) Composite.clear(world, false);
  if (engine) Engine.clear(engine);
  engine = null;
  world = null;
  bodies = [];
}
