/**
 * Live drag signal for the walking animation.
 *
 * Fed by the existing native drag: PetApp marks the grab when it hands the
 * pointer to `startDragging()` and the release on `lostpointercapture` (which
 * Windows delivers when its move loop ends); window positions come from the
 * existing Tauri `onMoved` listener. Nothing here moves the window.
 *
 * High-frequency data (velocity) is read by the 3D scene each frame without
 * React re-renders; only coarse changes (walking on/off) notify subscribers.
 */

type Listener = () => void;

/** Window speed above this many logical px/s counts as moving. */
export const MOVING_SPEED = 15;
export const TROT_ENTRY_SPEED = 85;
const TROT_EXIT_SPEED = 60;
export const RUNNING_SPEED = 220;
const RUNNING_EXIT_SPEED = 150;
export type MovementMode = 'idle' | 'walking' | 'trotting' | 'running';
/** Movement must exceed this many logical px before a grab becomes a walk. */
const START_DISTANCE = 2;
/** With no move event for this long, the window is considered stationary. */
const STILL_AFTER_MS = 140;
/** Velocity smoothing time constant. */
const SMOOTHING_S = 0.08;

const motion = {
  grabbing: false,
  moved: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  hasLast: false,
  vx: 0,
  vy: 0,
  running: false,
  mode: 'idle' as MovementMode,
  /** Total distance the window has actually moved while grabbed (logical px). Never resets. */
  travelled: 0
};

// Development-only: lets runtime tests read the drag signal over DevTools.
if (import.meta.env.DEV) (window as unknown as { __doodleDrag: () => object }).__doodleDrag = () => ({ ...motion });

const changeListeners = new Set<Listener>();
const moveListeners = new Set<Listener>();
const notify = (set: Set<Listener>) => set.forEach((listener) => listener());

export const dragMotion = {
  /** The pointer was handed to the native drag (not yet moving). */
  beginGrab() {
    Object.assign(motion, { grabbing: true, moved: false, hasLast: false, vx: 0, vy: 0, running: false, mode: 'idle' as MovementMode });
    notify(changeListeners);
  },

  /** Native drag ended (button released). */
  endGrab() {
    if (!motion.grabbing) return;
    Object.assign(motion, { grabbing: false, moved: false, hasLast: false, running: false, mode: 'idle' as MovementMode });
    notify(changeListeners);
  },

  /** A window position from Tauri's moved event (physical pixels). Ignored unless grabbed. */
  move(x: number, y: number) {
    if (!motion.grabbing) return;
    const now = performance.now();
    const scale = window.devicePixelRatio || 1;
    if (!motion.hasLast) {
      Object.assign(motion, { startX: x, startY: y, hasLast: true });
    } else {
      const dt = Math.max(now - motion.lastT, 4) / 1000;
      const k = 1 - Math.exp(-dt / SMOOTHING_S);
      motion.vx += ((x - motion.lastX) / scale / dt - motion.vx) * k;
      motion.vy += ((y - motion.lastY) / scale / dt - motion.vy) * k;
      motion.travelled += Math.hypot(x - motion.lastX, y - motion.lastY) / scale;
      if (!motion.moved && Math.hypot(x - motion.startX, y - motion.startY) / scale > START_DISTANCE) {
        motion.moved = true;
        notify(changeListeners);
      }
      const speed = Math.hypot(motion.vx, motion.vy);
      const wasRunning = motion.running;
      motion.running = wasRunning ? speed >= RUNNING_EXIT_SPEED : speed >= RUNNING_SPEED;
      if (motion.running !== wasRunning) notify(changeListeners);
      const previousMode = motion.mode;
      switch (motion.mode) {
        case 'idle':
          motion.mode = speed >= RUNNING_SPEED ? 'running' : speed >= TROT_ENTRY_SPEED ? 'trotting' : speed >= MOVING_SPEED ? 'walking' : 'idle';
          break;
        case 'walking':
          motion.mode = speed >= RUNNING_SPEED ? 'running' : speed >= TROT_ENTRY_SPEED ? 'trotting' : speed < MOVING_SPEED * 0.7 ? 'idle' : 'walking';
          break;
        case 'trotting':
          motion.mode = speed >= RUNNING_SPEED ? 'running' : speed < TROT_EXIT_SPEED ? 'walking' : 'trotting';
          break;
        case 'running':
          motion.mode = speed < RUNNING_EXIT_SPEED ? speed < TROT_EXIT_SPEED ? 'walking' : 'trotting' : 'running';
          break;
      }
      if (motion.mode !== previousMode) notify(changeListeners);
    }
    Object.assign(motion, { lastX: x, lastY: y, lastT: now });
    notify(moveListeners);
  },

  /** Grabbed and actually moved at least a couple of pixels. */
  isWalking() {
    return motion.grabbing && motion.moved;
  },

  isRunning() {
    return motion.grabbing && motion.moved && motion.running;
  },

  movementMode(): MovementMode {
    return motion.grabbing && motion.moved ? motion.mode : 'idle';
  },

  /** Current window velocity in logical px/s; zero once movement pauses. */
  velocity(now = performance.now()) {
    if (!motion.grabbing || now - motion.lastT > STILL_AFTER_MS) return { x: 0, y: 0 };
    return { x: motion.vx, y: motion.vy };
  },

  /**
   * Cumulative window travel in logical px. The gait advances by the change in
   * this value (real displacement), so it never advances while the window is still.
   */
  travelled() {
    return motion.travelled;
  },

  /** Coarse changes: grab, first real movement, release. */
  subscribe(listener: Listener) {
    changeListeners.add(listener);
    return () => void changeListeners.delete(listener);
  },

  /** Every movement sample (used to wake a demand-rendered scene). */
  onMove(listener: Listener) {
    moveListeners.add(listener);
    return () => void moveListeners.delete(listener);
  }
};
