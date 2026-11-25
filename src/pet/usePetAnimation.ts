import { useCallback, useEffect, useRef, useState } from 'react';
import { getIdleSeconds, isTauriRuntime, onPetActivity } from '../native/desktop';
import { dragMotion, type MovementMode } from './dragMotion';

export const PET_STATES = ['idle', 'coding', 'thinking', 'happy', 'sleeping', 'notification', 'walking', 'trotting', 'running'] as const;
export type PetState = (typeof PET_STATES)[number];
/** A drawable pose: every state plus the momentary blink. */
export type PetFrame = PetState | 'blink';

/**
 * Behaviour tuning. `sleepAfterSeconds` can be overridden per machine with
 * localStorage key `doodle.pet.sleepAfterSeconds` (in the pet window).
 */
export const PET_BEHAVIOR = {
  sleepAfterSeconds: 5 * 60,
  /** How long the pet keeps "coding" after the last keystroke in a note. */
  codingHoldMs: 5000,
  happyMs: 1100,
  clickReactionMs: 650,
  notificationMs: 1800,
  /** A save is celebrated at most this often, and only once typing has paused. */
  celebrationCooldownMs: 15_000,
  /** While asleep, how often to check whether the user is back. */
  wakeCheckMs: 2000,
  blinkMinMs: 3800,
  blinkJitterMs: 4200,
  blinkDurationMs: 150,
  /**
   * Idle motion plays as occasional single breaths rather than a continuous loop:
   * a continuously animating transparent window costs ~10–25% of a CPU core in
   * compositing (measured in the Tauri window), while a still one costs ~3%.
   */
  breathGapMs: 10_000,
  breathJitterMs: 6000,
  breathMs: 4200,
  sleepBreathGapMs: 9000,
  sleepBreathJitterMs: 5000,
  sleepBreathMs: 5500
} as const;

type Reaction = Extract<PetState, 'happy' | 'notification'>;

function sleepAfterSeconds() {
  try {
    const override = Number(localStorage.getItem('doodle.pet.sleepAfterSeconds'));
    if (Number.isFinite(override) && override >= 10) return override;
  } catch {
    /* storage unavailable: use the default */
  }
  return PET_BEHAVIOR.sleepAfterSeconds;
}

/** Browser-only preview, e.g. `/?view=pet&state=thinking`. Ignored inside Tauri. */
function previewState(): PetState | null {
  if (isTauriRuntime()) return null;
  const value = new URLSearchParams(window.location.search).get('state');
  return PET_STATES.includes(value as PetState) ? (value as PetState) : null;
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reducedMotion;
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * The pet's single animation controller. It picks one state by priority:
 *   walking (being dragged) > reaction (happy / notification, short-lived) > sleeping > coding > thinking (notes open) > idle
 * All motion itself is CSS; this hook only owns a handful of one-shot timers,
 * every one of which is cleared on change or unmount.
 */
export function usePetAnimation({ notesOpen }: { notesOpen: boolean }) {
  const visible = useDocumentVisible();
  const reducedMotion = usePrefersReducedMotion();
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [coding, setCoding] = useState(false);
  const [sleeping, setSleepingState] = useState(false);
  const [blinking, setBlinking] = useState(false);

  const reactionTimer = useRef<number>();
  const codingTimer = useRef<number>();
  const sleepingRef = useRef(false);
  const savePending = useRef(false);
  const lastCelebration = useRef(0);

  const setSleeping = useCallback((value: boolean) => {
    sleepingRef.current = value;
    setSleepingState(value);
  }, []);

  const react = useCallback((kind: Reaction, durationMs: number) => {
    window.clearTimeout(reactionTimer.current);
    setReaction(kind);
    reactionTimer.current = window.setTimeout(() => setReaction(null), durationMs);
  }, []);

  const celebrateSave = useCallback(() => {
    savePending.current = false;
    const now = Date.now();
    if (now - lastCelebration.current < PET_BEHAVIOR.celebrationCooldownMs) return;
    lastCelebration.current = now;
    react('happy', PET_BEHAVIOR.happyMs);
  }, [react]);

  /** Click / tap on the pet: wake up and give a short hop. */
  const poke = useCallback(() => {
    setSleeping(false);
    react('happy', PET_BEHAVIOR.clickReactionMs);
  }, [react, setSleeping]);

  useEffect(
    () => () => {
      window.clearTimeout(reactionTimer.current);
      window.clearTimeout(codingTimer.current);
    },
    []
  );

  // Activity signals from the notes window.
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void onPetActivity((activity) => {
      setSleeping(false);
      if (activity === 'editing') {
        savePending.current = false;
        setCoding(true);
        window.clearTimeout(codingTimer.current);
        codingTimer.current = window.setTimeout(() => {
          codingTimer.current = undefined;
          setCoding(false);
          // Celebrate once the user pauses, not on every autosave mid-sentence.
          if (savePending.current) celebrateSave();
        }, PET_BEHAVIOR.codingHoldMs);
      } else if (activity === 'saved') {
        savePending.current = true;
        if (codingTimer.current === undefined) celebrateSave();
      } else if (activity === 'notification') {
        react('notification', PET_BEHAVIOR.notificationMs);
      }
    }).then((unlisten) => (disposed ? unlisten() : (off = unlisten)));
    return () => {
      disposed = true;
      off?.();
    };
  }, [celebrateSave, react, setSleeping]);

  // Sleep when the whole PC has been idle. One adaptive timer, no fixed-rate polling while awake.
  useEffect(() => {
    if (!visible) return;
    let timer: number | undefined;
    let cancelled = false;
    const threshold = sleepAfterSeconds();
    const check = async () => {
      const idle = await getIdleSeconds().catch(() => null);
      if (cancelled || idle === null) return;
      if (sleepingRef.current) {
        if (idle < 2) setSleeping(false);
        timer = window.setTimeout(check, idle < 2 ? threshold * 1000 : PET_BEHAVIOR.wakeCheckMs);
      } else if (idle >= threshold) {
        setSleeping(true);
        timer = window.setTimeout(check, PET_BEHAVIOR.wakeCheckMs);
      } else {
        timer = window.setTimeout(check, (threshold - idle) * 1000 + 250);
      }
    };
    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [visible, setSleeping]);

  // Walking: the pet is being dragged and the native window has actually moved.
  // Grabbing without moving never walks. The 3D rig eases in and out on its own.
  const [walking, setWalking] = useState(dragMotion.isWalking);
  const [running, setRunning] = useState(dragMotion.isRunning);
  const [movementMode, setMovementMode] = useState<MovementMode>(dragMotion.movementMode());
  useEffect(
    () =>
      dragMotion.subscribe(() => {
        setWalking(dragMotion.isWalking());
        setRunning(dragMotion.isRunning());
        setMovementMode(dragMotion.movementMode());
        if (dragMotion.isWalking()) setSleeping(false);
      }),
    [setSleeping]
  );

  const state: PetState =
    previewState() ??
    (movementMode === 'running' ? 'running' : movementMode === 'trotting' ? 'trotting' : running ? 'running' : walking ? 'walking' : null) ??
    reaction ??
    (sleeping ? 'sleeping' : coding ? 'coding' : notesOpen ? 'thinking' : 'idle');
  const eyesOpen = state === 'idle' || state === 'coding' || state === 'thinking';

  // Natural blinking while the eyes are open: one pending timeout at a time.
  useEffect(() => {
    if (!visible || reducedMotion || !eyesOpen) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setBlinking(true);
        timer = window.setTimeout(() => {
          setBlinking(false);
          schedule();
        }, PET_BEHAVIOR.blinkDurationMs);
      }, PET_BEHAVIOR.blinkMinMs + Math.random() * PET_BEHAVIOR.blinkJitterMs);
    };
    schedule();
    return () => {
      window.clearTimeout(timer);
      setBlinking(false);
    };
  }, [visible, reducedMotion, eyesOpen]);

  // Occasional breaths (CSS plays one cycle while `breathing` is true). Coding keeps its
  // own continuous loop because it only lasts while the user is actively typing.
  const [breathing, setBreathing] = useState(false);
  const breathes = state === 'idle' || state === 'thinking' || state === 'sleeping';
  const sleepy = state === 'sleeping';
  useEffect(() => {
    if (!visible || reducedMotion || !breathes) return;
    let timer: number;
    const schedule = (first: boolean) => {
      const gap = first
        ? 1500
        : sleepy
          ? PET_BEHAVIOR.sleepBreathGapMs + Math.random() * PET_BEHAVIOR.sleepBreathJitterMs
          : PET_BEHAVIOR.breathGapMs + Math.random() * PET_BEHAVIOR.breathJitterMs;
      timer = window.setTimeout(() => {
        setBreathing(true);
        timer = window.setTimeout(() => {
          setBreathing(false);
          schedule(false);
        }, sleepy ? PET_BEHAVIOR.sleepBreathMs : PET_BEHAVIOR.breathMs);
      }, gap);
    };
    schedule(true);
    return () => {
      window.clearTimeout(timer);
      setBreathing(false);
    };
  }, [visible, reducedMotion, breathes, sleepy]);

  return { state, blinking, breathing, reducedMotion, paused: !visible, poke };
}
