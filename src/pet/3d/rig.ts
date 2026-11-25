import * as THREE from 'three';
import { BODY, GAIT, LOCO, TAIL } from './constants';

/**
 * The cat's skeleton, solved procedurally every animated frame.
 *
 *   spine (Bézier, hem → neck)  ── sockets for hoodie parts, shoulders, neck
 *   pelvis ── hips, tail base, rump
 *   front leg: shoulder → elbow → wrist → paw   (two-bone IK, elbow bends back)
 *   hind leg:  hip → knee → hock → paw          (two-bone IK to the hock, knee bends forward)
 *   tail: centerline integrated from bend angles (fixed length, no kinks)
 *
 * Everything is blended between explicit sitting and standing anatomy (LOCO),
 * with the gait layered on top. All vectors are preallocated: no per-frame garbage.
 */

export type LocomotionInput = {
  /** 0 = sitting … 1 = standing (linear; staged easing is applied here). */
  progress: number;
  /** Gait phase in cycles (advanced by virtual walking distance). */
  phase: number;
  /** Gait amplitude 0–1: 0 = feet at their neutral stance. */
  gait: number;
  /** Tail travelling-wave amplitude 0–1. */
  tailWave: number;
  /** Lateral tail bend from turning, about −1…1. */
  tailSway: number;
  /** Whole-body lift in scene units for a running bound. */
  jumpY?: number;
  /** Brief landing compression, 0..1. */
  landing?: number;
  /** Running blend used to lengthen the bound without changing the model scale. */
  run?: number;
};

type Tuple = readonly [number, number, number];
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;
const setLerp = (out: THREE.Vector3, a: Tuple, b: Tuple, t: number, mirrorX = 1) =>
  out.set(lerp(a[0], b[0], t) * mirrorX, lerp(a[1], b[1], t), lerp(a[2], b[2], t));

/** The original sitting torso profile, spline-resampled exactly as the old lathe was. */
const SIT_PROFILE = new THREE.SplineCurve(BODY.torsoProfile.map(([r, y]) => new THREE.Vector2(r, y))).getSpacedPoints(80);
function sitRadius(t: number) {
  const y = 0.3 + 0.8 * clamp(t, 0, 1);
  for (let i = 1; i < SIT_PROFILE.length; i += 1) {
    const a = SIT_PROFILE[i - 1];
    const b = SIT_PROFILE[i];
    if (y <= b.y) return lerp(a.x, b.x, (y - a.y) / Math.max(b.y - a.y, 1e-6));
  }
  return SIT_PROFILE[SIT_PROFILE.length - 1].x;
}
function standRadius(t: number) {
  const p = LOCO.stand.profile;
  for (let i = 1; i < p.length; i += 1) {
    if (t <= p[i][0]) return lerp(p[i - 1][1], p[i][1], smoothstep(p[i - 1][0], p[i][0], t));
  }
  return p[p.length - 1][1];
}

/** Foot path for one leg: planted and sliding back during stance, lifted and carried forward in swing. */
function footPath(phase: number, offset: number, out: { z: number; y: number; swing: number }, run = 0) {
  const stride = GAIT.stride * (1 + 0.35 * run);
  const lift = GAIT.lift * (1 + 0.55 * run);
  const psi = (((phase + offset) % 1) + 1) % 1;
  if (psi < GAIT.duty) {
    const u = psi / GAIT.duty;
    out.z = stride * (0.5 - u);
    out.y = 0;
    out.swing = 0;
  } else {
    const u = (psi - GAIT.duty) / (1 - GAIT.duty);
    out.z = stride * (-0.5 + u * u * (3 - 2 * u));
    out.swing = Math.sin(Math.PI * u);
    out.y = lift * out.swing;
  }
  return out;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/**
 * Analytic two-bone IK: places the middle joint so |a→mid| = l1 and |mid→c| = l2,
 * bending toward `pole`. If `c` is out of reach it is pulled in (returned as `c`),
 * so segments never stretch or detach.
 */
function twoBoneIK(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, mid: THREE.Vector3) {
  const dir = tmpA.subVectors(c, a);
  const distance = dir.length() || 1e-6;
  dir.divideScalar(distance);
  const d = clamp(distance, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  if (d !== distance) c.copy(a).addScaledVector(dir, d);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  const n = tmpN.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
  n.normalize();
  mid.copy(a).addScaledVector(dir, x).addScaledVector(n, h);
}

export type FrontLeg = { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3; paw: THREE.Vector3; target: THREE.Vector3; pawPitch: number; pawYaw: number };
export type RearLeg = { hip: THREE.Vector3; knee: THREE.Vector3; hock: THREE.Vector3; paw: THREE.Vector3; target: THREE.Vector3; pawPitch: number; pawYaw: number };

export class CatRig {
  rear = 0;
  body = 0;
  front = 0;
  readonly spine = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  depth: number = LOCO.sit.depth;
  readonly pelvis = new THREE.Vector3();
  readonly neck = new THREE.Vector3();
  readonly tailBase = new THREE.Vector3();
  readonly tail = Array.from({ length: TAIL.segments + 1 }, () => new THREE.Vector3());
  readonly frontLegs: FrontLeg[] = [0, 1].map(() => ({ shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), paw: new THREE.Vector3(), target: new THREE.Vector3(), pawPitch: 0, pawYaw: 0 }));
  readonly rearLegs: RearLeg[] = [0, 1].map(() => ({ hip: new THREE.Vector3(), knee: new THREE.Vector3(), hock: new THREE.Vector3(), paw: new THREE.Vector3(), target: new THREE.Vector3(), pawPitch: 0, pawYaw: 0 }));
  private readonly listeners = new Set<(rig: CatRig) => void>();
  private readonly foot = { z: 0, y: 0, swing: 0 };
  private readonly frame = { c: new THREE.Vector3(), t: new THREE.Vector3(), f: new THREE.Vector3() };
  private readonly frontPole = new THREE.Vector3();
  private readonly rearPole = new THREE.Vector3();

  constructor() {
    this.solve({ progress: 0, phase: 0, gait: 0, tailWave: 0, tailSway: 0, jumpY: 0, landing: 0 });
  }

  /** Components register an updater that applies the solved pose to their meshes. */
  subscribe(listener: (rig: CatRig) => void) {
    this.listeners.add(listener);
    listener(this);
    return () => void this.listeners.delete(listener);
  }

  apply() {
    this.listeners.forEach((listener) => listener(this));
  }

  /** Spine point at t (cubic Bézier). */
  point(t: number, out: THREE.Vector3) {
    const [p0, p1, p2, p3] = this.spine;
    const u = 1 - t;
    return out
      .copy(p0)
      .multiplyScalar(u * u * u)
      .addScaledVector(p1, 3 * u * u * t)
      .addScaledVector(p2, 3 * u * t * t)
      .addScaledVector(p3, t * t * t);
  }

  /** Unit tangent at t (toward the neck). */
  tangent(t: number, out: THREE.Vector3) {
    const [p0, p1, p2, p3] = this.spine;
    const u = 1 - t;
    out.set(0, 0, 0);
    out.addScaledVector(tmpB.subVectors(p1, p0), 3 * u * u);
    out.addScaledVector(tmpB.subVectors(p2, p1), 6 * u * t);
    out.addScaledVector(tmpB.subVectors(p3, p2), 3 * t * t);
    return out.normalize();
  }

  /**
   * Spine frame at t: X is lateral (+x), T the tangent, F = X × T the ventral/front
   * direction (+z when sitting upright, downward when standing).
   */
  frameAt(t: number, c: THREE.Vector3, tangent: THREE.Vector3, front: THREE.Vector3) {
    this.point(t, c);
    this.tangent(t, tangent);
    front.set(0, -tangent.z, tangent.y).normalize(); // (1,0,0) × T
  }

  /** Torso radius at t, blended between the sitting pear and the standing barrel. */
  radius(t: number) {
    return lerp(sitRadius(t), standRadius(t), this.body);
  }

  solve(input: LocomotionInput) {
    const { stage } = LOCO;
    const rear = (this.rear = smoothstep(stage.rear[0], stage.rear[1], input.progress));
    const body = (this.body = smoothstep(stage.body[0], stage.body[1], input.progress));
    const front = (this.front = smoothstep(stage.front[0], stage.front[1], input.progress));
    const g = input.gait;
    const jumpY = input.jumpY ?? 0;
    const landing = input.landing ?? 0;
    const cycle = Math.PI * 2 * input.phase;

    // Weight transfer: two small dips per cycle, a lateral shift toward the supporting side,
    // and opposing pelvis/shoulder rotation. Scaled by stance so a sitting cat never bobs.
    const bob = -GAIT.bob * g * Math.cos(2 * cycle) * body;
    const sway = GAIT.sway * g * Math.sin(cycle) * body;
    const pelvisYaw = GAIT.pelvisYaw * g * Math.sin(cycle);
    const shoulderYaw = -GAIT.shoulderYaw * g * Math.sin(cycle + Math.PI / 2);

    // Spine: pelvis end follows the hind legs, chest end follows the front.
    const weights = [rear, (rear + body) / 2, body, (body + front) / 2];
    this.spine.forEach((p, i) => setLerp(p, LOCO.sit.spine[i], LOCO.stand.spine[i], weights[i]).add(tmpB.set(sway, bob, 0)));
    this.depth = lerp(LOCO.sit.depth, LOCO.stand.depth, body);
    setLerp(this.pelvis, LOCO.sit.pelvis, LOCO.stand.pelvis, rear).add(tmpB.set(sway, bob, 0));

    // Hind legs: hip on the pelvis, paw target on the ground, hock from the metatarsus, knee by IK.
    this.rearPole.set(0, 0, 1);
    this.rearLegs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      const hipX = lerp(LOCO.sit.hip[0], LOCO.stand.hip[0], rear);
      leg.hip.set(this.pelvis.x + side * hipX, this.pelvis.y + lerp(LOCO.sit.hip[1], LOCO.stand.hip[1], rear), this.pelvis.z - side * hipX * pelvisYaw);
      footPath(input.phase, GAIT.rear[i], this.foot, input.run ?? 0);
      const walk = g * rear;
      setLerp(leg.target, LOCO.sit.rearPaw, LOCO.stand.rearPaw, rear, side).add(tmpB.set(0, this.foot.y * walk, this.foot.z * walk));
      leg.paw.copy(leg.target);
      // Metatarsus: flat when sitting, angled when standing, flexing further while the foot swings.
      setLerp(leg.hock, LOCO.sit.hock, LOCO.stand.hock, rear, side).add(tmpB.set(0, 0.06 * this.foot.swing * walk, -0.05 * this.foot.swing * walk));
      leg.hock.add(leg.paw);
      const hockBefore = tmpB.copy(leg.hock);
      twoBoneIK(leg.hip, leg.hock, LOCO.bones.thigh, LOCO.bones.shank, this.rearPole.set(side * 0.15, 0, 1), leg.knee);
      leg.paw.add(tmpA.subVectors(leg.hock, hockBefore));
      leg.pawPitch = -GAIT.pawCurl * this.foot.swing * walk;
      leg.pawYaw = lerp(0.28 * side, 0, rear);
    });

    // Front legs: shoulder on the chest, wrist above the paw, elbow by IK (bending backward).
    this.frontLegs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      const t = lerp(LOCO.sit.shoulder.t, LOCO.stand.shoulder.t, front);
      const { c, t: tangent, f } = this.frame;
      this.frameAt(t, c, tangent, f);
      const lateral = lerp(LOCO.sit.shoulder.offset[0], LOCO.stand.shoulder.offset[0], front);
      const ventral = lerp(LOCO.sit.shoulder.offset[2], LOCO.stand.shoulder.offset[2], front);
      leg.shoulder.copy(c).addScaledVector(f, ventral);
      leg.shoulder.x += side * lateral;
      leg.shoulder.z -= side * lateral * shoulderYaw;
      footPath(input.phase, GAIT.front[i], this.foot, input.run ?? 0);
      const walk = g * front;
      setLerp(leg.target, LOCO.sit.frontPaw, LOCO.stand.frontPaw, front, side).add(tmpB.set(0, this.foot.y * walk, this.foot.z * walk));
      leg.paw.copy(leg.target);
      setLerp(leg.wrist, LOCO.sit.wrist, LOCO.stand.wrist, front, side).add(tmpB.set(0, 0.025 * this.foot.swing * walk, -0.04 * this.foot.swing * walk));
      leg.wrist.add(leg.paw);
      const wristBefore = tmpB.copy(leg.wrist);
      twoBoneIK(leg.shoulder, leg.wrist, LOCO.bones.upperForeleg, LOCO.bones.lowerForeleg, this.frontPole.set(side * 0.15, 0, -1), leg.elbow);
      // If the wrist had to be pulled in to stay attached, carry the paw with it (no stretching).
      leg.paw.add(tmpA.subVectors(leg.wrist, wristBefore));
      leg.pawPitch = -GAIT.pawCurl * this.foot.swing * walk;
      leg.pawYaw = lerp(0.06 * side, 0, front);
    });

    // Head pivot rides the neck; it keeps its own (expression-driven) rotation, which
    // stabilises the face while the spine pitches. Part of the bob is absorbed by the neck.
    this.point(1, this.neck);
    this.neck.add(setLerp(tmpB, LOCO.sit.neck, LOCO.stand.neck, (body + front) / 2));
    this.neck.y -= bob * 0.6;

    // Apply the bound as one coherent translation after IK: body, paws and tail
    // leave the ground together instead of stretching individual limbs.
    const vertical = jumpY - 0.035 * landing;
    this.spine.forEach((point) => { point.y += vertical; });
    this.pelvis.y += vertical;
    this.neck.y += vertical;
    for (const leg of this.frontLegs) {
      for (const point of [leg.shoulder, leg.elbow, leg.wrist, leg.paw, leg.target]) point.y += vertical;
    }
    for (const leg of this.rearLegs) {
      for (const point of [leg.hip, leg.knee, leg.hock, leg.paw, leg.target]) point.y += vertical;
    }
    this.solveTail(input, rear, cycle);
  }

  private solveTail(input: LocomotionInput, rear: number, cycle: number) {
    setLerp(this.tailBase, LOCO.sit.tailBase, LOCO.stand.tailBase, rear).add(this.pelvis);
    const n = TAIL.segments;
    const step = TAIL.length / n;
    const p = tmpA.copy(this.tailBase);
    this.tail[0].copy(p);
    for (let i = 0; i < n; i += 1) {
      const s = (i + 0.5) / n;
      // Sitting: drops to the ground and wraps around the haunch to the front paws, tip curling up.
      const pitchSit = lerp(-0.35, 0, smoothstep(0, 0.25, s)) + 0.55 * smoothstep(0.72, 1, s);
      const yawSit = Math.PI - Math.PI * 1.05 * smoothstep(0.03, 0.97, s);
      // Standing: a compact question mark — back from the rump, up through the middle, tip hooking over.
      const pitchStand = 0.35 + 0.95 * smoothstep(0, 0.45, s) + 1.35 * smoothstep(0.55, 1, s);
      const pitch = lerp(pitchSit, pitchStand, rear);
      const yaw = lerp(yawSit, Math.PI, rear);
      p.x += Math.sin(yaw) * Math.cos(pitch) * step;
      p.y += Math.sin(pitch) * step;
      p.z += Math.cos(yaw) * Math.cos(pitch) * step;
      this.tail[i + 1].copy(p);
    }
    // Lateral bend: a travelling wave (delayed from base to tip) plus a lagging bend when turning.
    // Quadratic in s, so the base stays attached and the curve stays smooth.
    for (let i = 1; i <= n; i += 1) {
      const s = i / n;
      const wave = input.tailWave * TAIL.waveAmplitude * Math.sin(cycle - TAIL.waveLag * s);
      this.tail[i].x += (wave + input.tailSway * TAIL.turnBend) * s * s;
    }
  }
}
