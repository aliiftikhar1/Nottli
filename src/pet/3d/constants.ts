/**
 * Proportions and palette for the procedural developer cat.
 * Units: 1 ≈ the cat's shoulder width. The cat sits on y = 0 facing +z.
 */

export const PALETTE = {
  furSilver: '#aeb2ba',
  furSilverLight: '#cfd2d8',
  furWhite: '#f3f1ec',
  stripe: '#474a52',
  stripeDark: '#2f3138',
  nose: '#dd8d95',
  innerEar: '#eeb2b4',
  mouth: '#3a2e30',
  /** Charcoal, not black: keeps fabric detail and separates from dark desktops. */
  hoodie: '#2e2f35',
  hoodieRib: '#3c3d45',
  orange: '#ff8a3d',
  frame: '#111113',
  headphone: '#1a1a1e',
  cushion: '#2b2b30',
  eyeDark: '#1b130d',
  /** Slightly grey so whiskers still read against light desktops. */
  whisker: '#e9e7e2'
} as const;

/** Whole-character framing. */
export const CHARACTER = {
  /** Turned slightly toward the camera so the tail and one side read. */
  yaw: -0.3,
  scale: 1
} as const;

/** Transparent pet-window frame. Extra room prevents the animated tail and paws from clipping. */
export const PET_WINDOW_SIZE = 120;
export const PET_REFERENCE_WINDOW_SIZE = 92;

export const CAMERA = {
  fov: 22,
  position: [0, 1.85, 6.2] as [number, number, number],
  target: [0, 1.0, 0] as [number, number, number]
} as const;

/** Body landmarks (character space). */
export const BODY = {
  hemY: 0.31,
  /** Hoodie/torso silhouette as [radius, y] pairs, swept around the y axis. */
  torsoProfile: [
    [0.47, 0.3],
    [0.505, 0.42],
    [0.5, 0.56],
    [0.46, 0.7],
    [0.39, 0.84],
    [0.31, 0.96],
    [0.22, 1.05],
    [0.17, 1.1]
  ] as [number, number][],
  /** Front-to-back squash of the torso and forward lean of the chest. */
  torsoDepth: 0.86,
  chestForward: 0.07,
  neck: [0, 1.08, 0.12] as [number, number, number],
  shoulder: [0.22, 0.86, 0.3] as [number, number, number],
  wrist: [0.17, 0.25, 0.53] as [number, number, number],
  frontPaw: [0.165, 0.052, 0.6] as [number, number, number],
  thigh: [0.34, 0.27, 0.0] as [number, number, number],
  thighRadii: [0.25, 0.25, 0.36] as [number, number, number],
  rearPaw: [0.41, 0.05, 0.36] as [number, number, number],
  tailBase: [0.1, 0.2, -0.38] as [number, number, number]
} as const;

/** Head landmarks (relative to the head centre). */
export const HEAD = {
  /** Head centre relative to the neck pivot. */
  offset: [0, 0.36, 0.04] as [number, number, number],
  radius: 0.5,
  scale: [1.08, 0.88, 0.9] as [number, number, number],
  eye: [0.19, 0.045, 0.31] as [number, number, number],
  eyeRadius: 0.1,
  eyeYaw: 0.3,
  ear: [0.28, 0.32, -0.03] as [number, number, number],
  cup: [0.585, 0.05, -0.06] as [number, number, number]
} as const;

type V3 = [number, number, number];

/**
 * Sitting and standing anatomy. The rig blends between the two; nothing here is
 * "the sitting cat rotated forward" — the spine, pelvis, joints and paws each
 * have their own sitting and standing placement.
 *
 * Spine: cubic Bézier from the hoodie hem (t = 0) to the neck base (t = 1).
 * Sockets are given in the spine frame at t: x = lateral, y = along the spine,
 * z = ventral/front (the chest side when sitting, the belly side when standing).
 */
export const LOCO = {
  sit: {
    // Reproduces the original upright torso (lathe axis with its forward chest lean).
    spine: [[0, 0.3, 0], [0, 0.567, 0.03], [0, 0.833, 0.06], [0, 1.1, 0.07]] as V3[],
    depth: 0.86,
    pelvis: [0, 0.28, -0.12] as V3,
    hip: [0.24, 0.08, 0] as V3, // from the pelvis
    shoulder: { t: 0.7, offset: [0.22, 0, 0.24] as V3 },
    frontPaw: [0.165, 0.052, 0.6] as V3,
    wrist: [0.005, 0.198, -0.07] as V3, // from the front paw
    rearPaw: [0.41, 0.05, 0.36] as V3,
    /** Metatarsus from paw to hock: lying flat on the ground behind the paw. */
    hock: [-0.01, 0.02, -0.34] as V3,
    tailBase: [0.1, -0.08, -0.26] as V3, // from the pelvis
    neck: [0, -0.02, 0.05] as V3 // head pivot, from the spine end
  },
  stand: {
    // Horizontal back: waist at the rear, chest rising gently to the neck.
    spine: [[0, 0.9, -0.4], [0, 0.93, -0.08], [0, 0.94, 0.22], [0, 1.02, 0.46]] as V3[],
    /** Torso radius along the spine (t, r): a slimmer barrel than the sitting pear. */
    profile: [[0, 0.3], [0.3, 0.33], [0.6, 0.33], [0.85, 0.29], [1, 0.22]] as [number, number][],
    depth: 1,
    pelvis: [0, 0.9, -0.55] as V3,
    hip: [0.17, -0.05, 0] as V3,
    shoulder: { t: 0.84, offset: [0.16, 0, 0.12] as V3 },
    frontPaw: [0.15, 0.052, 0.42] as V3,
    wrist: [0, 0.2, -0.03] as V3,
    rearPaw: [0.17, 0.05, -0.48] as V3,
    /** Metatarsus angled up and back to the hock, as in a standing cat. */
    hock: [0, 0.27, -0.12] as V3,
    tailBase: [0, 0.08, -0.27] as V3,
    neck: [0, 0, 0.04] as V3
  },
  /** Bone lengths (constant in every pose: the IK keeps segments connected). */
  bones: { upperForeleg: 0.335, lowerForeleg: 0.335, thigh: 0.36, shank: 0.34 },
  rumpRadii: [0.28, 0.27, 0.31] as V3,
  /** Pose-blend staging on the 0→1 stand progress: hind legs first, then body, then front. */
  stage: { rear: [0, 0.7], body: [0.1, 0.85], front: [0.25, 1] } as Record<'rear' | 'body' | 'front', [number, number]>,
  standUpSeconds: 0.6,
  sitDownSeconds: 0.75,
  /** Walking only begins once the standing posture is this far established. */
  walkFrom: 0.85
} as const;

/**
 * Four-beat lateral-sequence walk: footfalls LH → LF → RH → RF, a quarter cycle apart,
 * each foot on the ground 65% of the cycle. The gait advances by *virtual distance*
 * derived from real window displacement, so feet stay planted relative to the
 * virtual ground and the gait never advances while the window is still.
 */
export const GAIT = {
  /** Phase offsets in cycles: [left-front, right-front], [left-hind, right-hind]. */
  front: [0.25, 0.75] as [number, number],
  rear: [0, 0.5] as [number, number],
  duty: 0.65,
  /** Foot travel during stance (scene units) and swing lift height. */
  stride: 0.32,
  lift: 0.07,
  /** Window px → virtual walking distance (scene units). */
  unitsPerPx: 0.0065,
  /** Cap on virtual walking speed (scene units/s): very fast drags don't produce frantic legs. */
  maxSpeed: 1.0,
  /** Higher gait cap used while the native drag reports a sustained fast movement. */
  runSpeed: 2.2,
  /** Intermediate cadence for the trot transition. */
  trotSpeed: 1.45,
  bob: 0.012,
  pelvisYaw: 0.05,
  shoulderYaw: 0.04,
  sway: 0.012,
  pawCurl: 0.6,
  /** Turn toward horizontal travel, at most this yaw (radians): near-profile, so the back and hips read. */
  maxTurn: 1.15,
  /** Fraction of the body's turn the head undoes, keeping the face toward the viewer. */
  headTowardViewer: 0.45,
  turnRate: 4,
  gaitInRate: 6,
  gaitOutRate: 4
} as const;

/** Tail: a chain integrated from bend angles, so its length is fixed and it never kinks. */
export const TAIL = {
  length: 1.7,
  segments: 32,
  radial: 16,
  waveAmplitude: 0.22,
  /** Radians of travelling-wave delay from base to tip. */
  waveLag: 3.5,
  turnBend: 0.32
} as const;

/** Camera framing for the standing cat: higher, so the back, hips and tail base read. */
export const CAMERA_STAND = {
  position: [0, 3.3, 7.4] as V3,
  target: [0, 1.17, -0.1] as V3
} as const;

/** Rest pose and expression ranges used by the animation rig (radians). */
export const POSE = {
  lidUpperOpen: -0.95,
  lidUpperWide: -1.15,
  lidUpperFocused: -0.55,
  lidUpperClosed: 0.32,
  lidLowerOpen: 0.75,
  lidLowerSmile: 0.05,
  lidLowerClosed: -0.3
} as const;

/** Radius of the torso profile at height y (linear interpolation). */
export function torsoRadiusAt(y: number) {
  const profile = BODY.torsoProfile;
  if (y <= profile[0][1]) return profile[0][0];
  for (let i = 1; i < profile.length; i += 1) {
    const [r1, y1] = profile[i];
    const [r0, y0] = profile[i - 1];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return profile[profile.length - 1][0];
}

/** Chest lean as a function of height (0 at the hem, full at the collar). */
export function chestOffsetAt(y: number) {
  const t = Math.min(Math.max((y - BODY.hemY) / (1.1 - BODY.hemY), 0), 1);
  return BODY.chestForward * Math.sin(t * Math.PI * 0.5);
}

/** Front surface z of the torso at (x, y): used to seat details on the hoodie. */
export function torsoFrontZ(x: number, y: number) {
  const r = torsoRadiusAt(y);
  return Math.sqrt(Math.max(r * r - x * x, 0)) * BODY.torsoDepth + chestOffsetAt(y);
}
