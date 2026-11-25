import type { CSSProperties } from 'react';
import type { LocomotionPreview } from './3d/DeveloperCat';
import { PetArt } from './PetArt';
import { PET_STATES, type PetState } from './usePetAnimation';

type Tile = { state: PetState; blinking: boolean; label: string; preview?: LocomotionPreview };

/**
 * Locomotion contact sheet (`&only=locomotion`): every pose the rig blends through.
 * Transition tiles sample the stand progress; the blend is staged (hind legs first
 * on the way up, last on the way down), so stand→sit at p is the same pose as sit→stand at p.
 */
function locomotionTiles(direction: number, debug: boolean): Tile[] {
  const walk = (label: string, preview: Partial<LocomotionPreview>): Tile => ({
    state: 'walking',
    blinking: false,
    label,
    preview: { progress: 1, phase: 0, gait: 0, direction, debug, ...preview }
  });
  return [
    { state: 'idle', blinking: false, label: 'sitting', preview: { progress: 0, phase: 0, gait: 0, direction: 0, debug } },
    walk('standing', {}),
    walk('mid-stride', { gait: 1, phase: 0.125, tailWave: 1 }),
    ...[0, 0.25, 0.5, 0.75].map((phase) => walk(`gait ${phase}`, { gait: 1, phase, tailWave: 1 })),
    walk('tail neutral', { direction: 0 }),
    walk('tail bend left', { direction: 0, tailSway: -1 }),
    walk('tail bend right', { direction: 0, tailSway: 1 }),
    ...[0.25, 0.5, 0.75].map((p) => walk(`sit→stand ${p}`, { progress: p })),
    ...[0.75, 0.5, 0.25].map((p) => walk(`stand→sit ${p}`, { progress: p }))
  ];
}

/**
 * Development-only contact sheet (`pnpm dev`, then open `/?view=pet-gallery`).
 * Each tile is a pet window using the real renderer selection, state classes and CSS.
 *   &only=<state|blink>   a single state
 *   &only=locomotion      sitting/standing/gait/tail/transition poses (see above)
 *   &only=walking         a strip of gait phases (&phases=8)
 *   &dir=1|-1|0           travel direction for walking samples (right, left, toward viewer)
 *   &debug=1              skeleton overlay: joints, paw targets, ground, tail points, pivots
 *   &renderer=svg         force the fallback renderer
 *   &size=128             tile size in CSS px (default 92, the current window)
 *   &bg=dark|light|<hex>  desktop colour behind the tiles
 */
export function PetGallery() {
  const params = new URLSearchParams(window.location.search);
  const only = params.get('only');
  const size = Number(params.get('size')) || 92;
  const direction = Number(params.get('dir') ?? 1);
  const debug = params.get('debug') === '1';
  const bg = params.get('bg');
  const background = bg === 'dark' ? '#1e1f24' : bg === 'light' || !bg ? '#eceae6' : `#${bg.replace('#', '')}`;

  let tiles: Tile[] = [
    ...PET_STATES.map((state) => ({
      state,
      blinking: false,
      label: state,
      preview: state === 'walking' ? { progress: 1, phase: 0.125, gait: 1, direction, tailWave: 1, debug } : debug ? { progress: 0, phase: 0, gait: 0, direction: 0, debug } : undefined
    })),
    { state: 'idle', blinking: true, label: 'blink' }
  ];
  if (only === 'locomotion') {
    tiles = locomotionTiles(direction, debug);
  } else if (only === 'walking') {
    const count = Number(params.get('phases')) || 8;
    tiles = Array.from({ length: count }, (_, i) => ({
      state: 'walking' as const,
      blinking: false,
      label: `walk ${i}/${count}`,
      preview: { progress: 1, phase: i / count, gait: 1, direction, tailWave: 1, debug }
    }));
  } else if (only) {
    tiles = tiles.filter((tile) => tile.label === only);
  }

  return (
    <div className="pet-gallery" style={{ '--tile': `${size}px`, background } as CSSProperties}>
      {tiles.map(({ state, blinking, label, preview }) => (
        <figure key={label}>
          <div className={`pet pet-${state}`}>
            <span className="pet-shadow" />
            <span className="pet-lift">
              <span className="pet-figure">
                <PetArt state={state} blinking={blinking} reducedMotion preview={preview} />
              </span>
            </span>
          </div>
          <figcaption>{label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
