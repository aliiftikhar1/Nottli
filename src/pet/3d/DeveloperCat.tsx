import { useFrame, useThree } from '@react-three/fiber';
import { createRef, lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { dragMotion, MOVING_SPEED, RUNNING_SPEED } from '../dragMotion';
import type { PetState } from '../usePetAnimation';
import { CatBody } from './CatBody';
import { CatHead, type HeadRig } from './CatHead';
import { CatHoodie } from './CatHoodie';
import { CatLegs } from './CatLegs';
import { CatTail } from './CatTail';
import { CAMERA, CAMERA_STAND, CHARACTER, GAIT, LOCO, PET_REFERENCE_WINDOW_SIZE, PET_WINDOW_SIZE, POSE } from './constants';
import { CatRig } from './rig';

// Development-only skeleton overlay; never part of the production pet.
const RigDebug = import.meta.env.DEV ? lazy(() => import('./RigDebug')) : null;

/** Animatable expression channels of the rig (radians). Independent of locomotion. */
type Pose = {
  lidUpper: number;
  lidLower: number;
  gazePitch: number;
  gazeYaw: number;
  headRoll: number;
  headPitch: number;
  ears: number;
};

/** Per-channel response rate (1/s): lids are quick enough for a 150 ms blink, the head is unhurried. */
const RATE: Record<keyof Pose, number> = {
  lidUpper: 38,
  lidLower: 30,
  gazePitch: 9,
  gazeYaw: 9,
  headRoll: 6,
  headPitch: 6,
  ears: 8
};

/** Maps the shared pet state (from usePetAnimation) onto the 3D expression rig. */
export function poseFor(state: PetState, blinking: boolean): Pose {
  const pose: Pose = {
    lidUpper: POSE.lidUpperOpen,
    lidLower: POSE.lidLowerOpen,
    gazePitch: 0,
    gazeYaw: 0,
    headRoll: 0,
    headPitch: 0,
    ears: 0
  };
  switch (state) {
    case 'coding':
      Object.assign(pose, { lidUpper: POSE.lidUpperFocused, gazePitch: 0.2, headPitch: 0.07 });
      break;
    case 'thinking':
      Object.assign(pose, { gazePitch: -0.24, gazeYaw: 0.16, headRoll: 0.14, ears: 0.08 });
      break;
    case 'happy':
      Object.assign(pose, { lidUpper: -0.72, lidLower: POSE.lidLowerSmile, headRoll: -0.06, ears: 0.1 });
      break;
    case 'sleeping':
      Object.assign(pose, { lidUpper: POSE.lidUpperClosed, lidLower: POSE.lidLowerClosed, headPitch: 0.13, headRoll: 0.05, ears: -0.14 });
      break;
    case 'notification':
      Object.assign(pose, { lidUpper: POSE.lidUpperWide, ears: 0.2 });
      break;
    case 'walking':
      // Bright, forward-looking face; ears up.
      Object.assign(pose, { lidUpper: -1.02, ears: 0.12 });
      break;
    case 'trotting':
      Object.assign(pose, { lidUpper: -1.02, ears: 0.14, headPitch: -0.02 });
      break;
    case 'running':
      Object.assign(pose, { lidUpper: -1.02, ears: 0.16, headPitch: -0.04 });
      break;
    default:
      break;
  }
  if (blinking) Object.assign(pose, { lidUpper: POSE.lidUpperClosed, lidLower: Math.min(pose.lidLower, 0.4) });
  return pose;
}

/**
 * Fixed locomotion sample for the dev gallery: stand progress 0–1, gait phase (cycles)
 * and amplitude, travel direction (−1 left / 0 / 1 right), tail wave/turn bend, debug overlay.
 */
export type LocomotionPreview = { progress: number; phase: number; gait: number; direction: number; tailWave?: number; tailSway?: number; debug?: boolean };

export type LocomotionState = 'sitting' | 'standing-up' | 'standing' | 'walking' | 'sitting-down';

type DeveloperCatProps = {
  state: PetState;
  blinking: boolean;
  reducedMotion: boolean;
  preview?: LocomotionPreview;
  /** Fixed camera for head-only marks; overrides the locomotion-driven framing. */
  headCamera?: { position: [number, number, number]; target: [number, number, number] };
};

const ease = (value: number, target: number, rate: number, dt: number) => target + (value - target) * Math.exp(-rate * dt);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
/** Distance the body travels per gait cycle: each foot covers `stride` while on the ground. */
const CYCLE_DISTANCE = GAIT.stride / GAIT.duty;

const camPosition = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camOffset = new THREE.Vector3();
const standPosition = new THREE.Vector3(...CAMERA_STAND.position);
const standTarget = new THREE.Vector3(...CAMERA_STAND.target);
const baseCameraDistance = new THREE.Vector3(...CAMERA.position).distanceTo(new THREE.Vector3(...CAMERA.target));
const fullPetCameraDistance = baseCameraDistance * (PET_WINDOW_SIZE / PET_REFERENCE_WINDOW_SIZE);

/**
 * The full character. Expressions and locomotion are advanced in one useFrame that
 * requests another frame with invalidate() only while something is still moving —
 * a still cat (sitting, or standing while held) costs no GPU time under frameloop="demand".
 */
export function DeveloperCat({ state, blinking, reducedMotion, preview, headCamera }: DeveloperCatProps) {
  const invalidate = useThree((three) => three.invalidate);
  const camera = useThree((three) => three.camera);
  const catRig = useMemo(() => new CatRig(), []);
  const refs = useMemo(
    () => ({
      root: createRef<THREE.Group>(),
      head: {
        pivot: createRef<THREE.Group>(),
        ears: [createRef<THREE.Group>(), createRef<THREE.Group>()],
        eyes: {
          gaze: [createRef<THREE.Group>(), createRef<THREE.Group>()],
          upper: [createRef<THREE.Mesh>(), createRef<THREE.Mesh>()],
          lower: [createRef<THREE.Mesh>(), createRef<THREE.Mesh>()]
        }
      } satisfies HeadRig
    }),
    []
  );

  const target = poseFor(state, blinking);
  const targetRef = useRef(target);
  targetRef.current = target;
  const current = useRef<Pose>({ ...target });
  const loco = useRef({
    progress: 0,
    gait: 0,
    phase: 0,
    yaw: CHARACTER.yaw as number,
    travelled: dragMotion.travelled(),
    tailSway: 0,
    deformation: 0,
    runBlend: 0,
    label: 'sitting' as LocomotionState
  });
  const walkingRef = useRef(false);
  const trottingRef = useRef(false);
  const runningRef = useRef(false);
  walkingRef.current = (state === 'walking' || state === 'trotting' || state === 'running') && !reducedMotion;
  trottingRef.current = state === 'trotting' && !reducedMotion;
  runningRef.current = state === 'running' && !reducedMotion;
  /** Locomotion inputs of the last solve (NaN forces the first frame to solve). */
  const lastSolved = useRef([NaN, NaN, NaN, NaN]);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  // Development-only: lets the runtime tests read live locomotion over DevTools.
  useEffect(() => {
    if (!import.meta.env.DEV || preview) return;
    const holder = window as unknown as { __doodleGait?: () => object };
    holder.__doodleGait = () => ({ ...loco.current, walking: walkingRef.current });
    return () => void delete holder.__doodleGait;
  }, [preview]);

  // A new target needs one frame to start; useFrame keeps requesting frames until settled.
  useEffect(() => {
    invalidate();
  }, [state, blinking, invalidate]);
  // A new gallery preview must be re-solved even if its numbers match the last one.
  useEffect(() => {
    lastSolved.current.fill(NaN);
    invalidate();
  }, [preview, invalidate]);
  // Window movement wakes the scene while walking (e.g. resuming after a pause). With reduced
  // motion locomotion is off, so movement samples render nothing.
  useEffect(
    () =>
      dragMotion.onMove(() => {
        if (walkingRef.current) invalidate();
      }),
    [invalidate]
  );

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30); // the first frame after an idle period has a huge delta
    let moving = false;

    // ---- expression channels
    const goal = targetRef.current;
    const pose = current.current;
    for (const key of Object.keys(goal) as (keyof Pose)[]) {
      const next = reducedMotion ? goal[key] : ease(pose[key], goal[key], RATE[key], dt);
      if (Math.abs(next - goal[key]) > 0.0015) {
        pose[key] = next;
        moving = true;
      } else {
        pose[key] = goal[key];
      }
    }

    // ---- locomotion state machine
    const L = loco.current;
    const sample = previewRef.current;
    if (sample) {
      Object.assign(L, {
        progress: sample.progress,
        phase: sample.phase,
        gait: sample.gait,
        yaw: sample.direction ? sample.direction * GAIT.maxTurn : CHARACTER.yaw,
        tailSway: sample.tailSway ?? 0
      });
    } else {
      const wantsToWalk = walkingRef.current || runningRef.current;
      const total = dragMotion.travelled();
      const travelled = total - L.travelled;
      L.travelled = total;
      const velocity = dragMotion.velocity();
      const stepping = wantsToWalk && Math.hypot(velocity.x, velocity.y) > MOVING_SPEED;
      const startProgress = L.progress;

      // Stand up as soon as the drag moves; sit down only after the feet have settled.
      if (wantsToWalk) L.progress = Math.min(1, L.progress + dt / LOCO.standUpSeconds);
      else if (L.gait < 0.05) L.progress = Math.max(0, L.progress - dt / LOCO.sitDownSeconds);
      if (L.progress !== startProgress) moving = true;

      // Gait amplitude: walking needs an established stance and real movement.
      const established = L.progress >= LOCO.walkFrom;
      const gaitTarget = wantsToWalk && stepping && established ? 1 : 0;
      L.gait = ease(L.gait, gaitTarget, gaitTarget ? GAIT.gaitInRate : GAIT.gaitOutRate, dt);
      if (Math.abs(L.gait - gaitTarget) < 0.003) L.gait = gaitTarget;
      else moving = true;

      // The gait advances by virtual distance from real window displacement (capped),
      // never by elapsed time: a still window freezes the phase.
      if (wantsToWalk && established && travelled > 0) {
        const distance = Math.min(travelled * GAIT.unitsPerPx, (runningRef.current ? GAIT.runSpeed : trottingRef.current ? GAIT.trotSpeed : GAIT.maxSpeed) * dt);
        L.phase = (L.phase + distance / CYCLE_DISTANCE) % 1;
        moving = true;
      }

      const runTarget = runningRef.current ? 1 : 0;
      const previousRunBlend = L.runBlend;
      L.runBlend = ease(L.runBlend, runTarget, runTarget > L.runBlend ? 11 : 5, dt);
      if (Math.abs(L.runBlend - previousRunBlend) > 0.001) moving = true;
      // Finish a partial bound after release or a sudden stop instead of freezing in mid-air.
      if (!runningRef.current && L.runBlend > 0.01) {
        L.phase = (L.phase + (dt * 1.8) / CYCLE_DISTANCE) % 1;
        moving = true;
      }

      // Face the direction of horizontal travel; hold it while paused; return when seated.
      // Turning follows direction, not speed: full near-profile from ~50 px/s of horizontal travel.
      const yawTarget = !wantsToWalk
        ? CHARACTER.yaw
        : Math.abs(velocity.x) > 20
          ? Math.sign(velocity.x) * GAIT.maxTurn * clamp((Math.abs(velocity.x) - 15) / 35, 0, 1)
          : L.yaw;
      const previousYaw = L.yaw;
      L.yaw = ease(L.yaw, yawTarget, GAIT.turnRate, dt);
      if (Math.abs(L.yaw - yawTarget) < 0.002) L.yaw = yawTarget;
      else moving = true;

      // The tail lags behind turns (bends away from the turn), then relaxes.
      const turnSpeed = (L.yaw - previousYaw) / Math.max(dt, 1e-3);
      L.tailSway = ease(L.tailSway, clamp(-turnSpeed * 0.5, -1, 1), 5, dt);
      if (Math.abs(L.tailSway) < 0.002) L.tailSway = 0;
      else moving = true;

      L.label =
        L.progress === 0 ? 'sitting' : !wantsToWalk ? 'sitting-down' : L.progress < 1 ? 'standing-up' : L.gait > 0.05 ? 'walking' : 'standing';
    }

    // Re-solve the skeleton (and rewrite torso/tail buffers) only when locomotion changed:
    // a blink or expression change renders without touching any geometry.
    const runFlight = Math.max(0, Math.sin((L.phase - 0.06) * Math.PI * 2));
    const landingPulse = Math.exp(-Math.pow((L.phase - 0.58) / 0.07, 2));
    const jumpY = L.runBlend * runFlight * 0.16 + (trottingRef.current ? Math.max(0, Math.sin(L.phase * Math.PI * 2)) * 0.025 : 0);
    const landing = L.runBlend * landingPulse;
    const solved = lastSolved.current;
    if (solved[0] !== L.progress || solved[1] !== L.phase || solved[2] !== L.gait || solved[3] !== L.tailSway || solved[4] !== jumpY || solved[5] !== landing) {
      catRig.solve({ progress: L.progress, phase: L.phase, gait: L.gait, tailWave: L.gait, tailSway: L.tailSway, jumpY, landing, run: L.runBlend });
      catRig.apply();
      solved[0] = L.progress;
      solved[1] = L.phase;
      solved[2] = L.gait;
      solved[3] = L.tailSway;
      solved[4] = jumpY;
      solved[5] = landing;
    }

    const deformationVelocity = dragMotion.velocity();
    const deformationSpeed = Math.hypot(deformationVelocity.x, deformationVelocity.y);
    const deformationTarget = walkingRef.current ? clamp(deformationSpeed / RUNNING_SPEED, 0, 1) * (runningRef.current ? 1 : trottingRef.current ? 0.72 : 0.55) : 0;
    L.deformation = ease(L.deformation, deformationTarget, deformationTarget > L.deformation ? 10 : 7, dt);
    if (Math.abs(L.deformation - deformationTarget) > 0.001) moving = true;
    refs.root.current?.rotation.set(-clamp(deformationSpeed / RUNNING_SPEED, 0, 1) * 0.07, L.yaw, 0);
    // Derive from the fixed baseline every frame; this can never accumulate scale error.
    refs.root.current?.scale.set(CHARACTER.scale * (1 + L.deformation * 0.045), CHARACTER.scale * (1 - L.deformation * 0.026 - landing * 0.018), CHARACTER.scale * (1 - L.deformation * 0.012));
    // Head rides the neck but keeps its own orientation (stabilised), plus the expression.
    if (refs.head.pivot.current) {
      refs.head.pivot.current.position.copy(catRig.neck);
      // When the body turns toward its direction of travel, the head turns part of the way back.
      const headYaw = -(L.yaw - CHARACTER.yaw) * GAIT.headTowardViewer;
      refs.head.pivot.current.rotation.set(pose.headPitch, headYaw, pose.headRoll + 0.025 * L.gait * Math.sin(Math.PI * 2 * L.phase));
    }
    refs.head.eyes.upper.forEach((lid) => lid.current?.rotation.set(pose.lidUpper, 0, 0));
    refs.head.eyes.lower.forEach((lid) => lid.current?.rotation.set(pose.lidLower, 0, 0));
    refs.head.eyes.gaze.forEach((gaze) => gaze.current?.rotation.set(pose.gazePitch, pose.gazeYaw, 0));
    refs.head.ears.forEach((ear) => ear.current?.rotation.set(-pose.ears, 0, 0));

    // Framing: rise for a three-quarter view of the standing back, hips and tail base.
    const frame = catRig.body;
    if (headCamera) {
      camPosition.fromArray(headCamera.position);
      camTarget.fromArray(headCamera.target);
    } else {
      camPosition.fromArray(CAMERA.position).lerp(standPosition, frame);
      camTarget.fromArray(CAMERA.target).lerp(standTarget, frame);
      // Standing used to move the camera from z=6.2 to z=7.4, making the same
      // cat appear smaller during a drag. Keep perspective distance constant;
      // only the framing target/elevation changes with the pose.
      camOffset.subVectors(camPosition, camTarget).normalize().multiplyScalar(fullPetCameraDistance);
      camPosition.copy(camTarget).add(camOffset);
    }
    camera.position.copy(camPosition);
    camera.lookAt(camTarget);

    if (moving && !sample) invalidate();
  });

  return (
    <group ref={refs.root} name="developer-cat" rotation={[0, CHARACTER.yaw, 0]} scale={CHARACTER.scale} dispose={null}>
      <CatBody rig={catRig} />
      <CatHoodie rig={catRig} />
      <CatLegs rig={catRig} />
      <CatTail rig={catRig} />
      <CatHead rig={refs.head} />
      {RigDebug && preview?.debug ? (
        <Suspense fallback={null}>
          <RigDebug rig={catRig} />
        </Suspense>
      ) : null}
    </group>
  );
}
