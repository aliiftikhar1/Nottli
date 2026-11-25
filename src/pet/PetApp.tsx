import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PetArt } from './PetArt';
import { dragMotion } from './dragMotion';
import { usePetAnimation } from './usePetAnimation';
import { isNotesVisible, onNotesVisibility, startPetDrag, toggleNotes, trackPetPosition } from '../native/desktop';

/** Pixels the pointer must travel before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;

const STATE_LABEL = {
  idle: 'relaxing',
  coding: 'coding along with you',
  thinking: 'thinking',
  happy: 'happy',
  sleeping: 'sleeping',
  notification: 'has something for you',
  walking: 'walking with you',
  trotting: 'trotting with you',
  running: 'running to catch up'
} as const;

export function PetApp() {
  const [notesOpen, setNotesOpen] = useState(false);
  const press = useRef<{ x: number; y: number } | null>(null);
  const { state, blinking, breathing, reducedMotion, paused, poke } = usePetAnimation({ notesOpen });

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void isNotesVisible().then((visible) => !disposed && setNotesOpen(visible));
    void onNotesVisibility(setNotesOpen).then((off) => (disposed ? off() : cleanups.push(off)));
    // The one moved listener: persists position and feeds live movement to the walk animation.
    void trackPetPosition(dragMotion.move).then((off) => (disposed ? off() : cleanups.push(off)));
    return () => {
      disposed = true;
      cleanups.forEach((off) => off());
    };
  }, []);

  const activate = () => {
    poke();
    void toggleNotes();
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    press.current = { x: event.screenX, y: event.screenY };
    // Keep receiving the press even if the pointer slips off the cat's silhouette.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const start = press.current;
    if (!start || !(event.buttons & 1)) return;
    if (Math.hypot(event.screenX - start.x, event.screenY - start.y) > DRAG_THRESHOLD) {
      // Hand off to the native move loop; Windows swallows the pointerup, so clear the press first.
      press.current = null;
      dragMotion.beginGrab();
      void startPetDrag().catch(() => dragMotion.endGrab());
    }
  };

  const onPointerUp = () => {
    if (press.current) activate();
    press.current = null;
    dragMotion.endGrab();
  };

  // Windows ends its move loop on release and the webview then loses pointer capture:
  // that is the reliable "drag finished" signal (pointerup is swallowed during the native drag).
  const onLostPointerCapture = () => dragMotion.endGrab();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  return (
    <button
      type="button"
      className={`pet pet-${state}${breathing ? ' pet-breathing' : ''}`}
      data-paused={paused || undefined}
      aria-label={`Nottli is ${STATE_LABEL[state]}. ${notesOpen ? 'Close' : 'Open'} notes`}
      aria-pressed={notesOpen}
      title="Click for notes · drag to move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (press.current = null)}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={onKeyDown}
    >
      <span className="pet-shadow" aria-hidden="true" />
      <span className="pet-lift">
        <span className="pet-figure">
          <PetArt state={state} blinking={blinking} reducedMotion={reducedMotion} />
          {/* The only interactive area: roughly the cat's silhouette, not the window's corners. */}
          <svg className="pet-hit" viewBox="0 0 92 92" aria-hidden="true">
            <ellipse cx="46" cy="51" rx="28" ry="34" />
          </svg>
        </span>
      </span>
    </button>
  );
}
