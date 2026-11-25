import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { developerCatAsset } from './developerCatAssets';
import { PetCharacter } from './PetCharacter';
import type { LocomotionPreview } from './3d/DeveloperCat';
import type { PetFrame, PetState } from './usePetAnimation';

// Three.js only loads in the pet window, and only when WebGL is usable.
const Pet3DCanvas = lazy(() => import('./3d/Pet3DCanvas'));

export type PetRenderer = '3d' | 'svg';

/** True when this webview can create a WebGL context (hardware or software). */
function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Dev/browser override: `?renderer=svg` forces the fallback. Ignored values mean "auto". */
function requestedRenderer(): PetRenderer | null {
  const value = new URLSearchParams(window.location.search).get('renderer');
  return value === 'svg' || value === '3d' ? value : null;
}

let webglSupported: boolean | null = null;

/** Anything thrown while building the 3D scene drops back to the SVG cat. */
class RenderBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
      console.warn('[Nottli] 3D pet failed, using SVG fallback:', error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type PetArtProps = {
  state: PetState;
  blinking: boolean;
  reducedMotion: boolean;
  /** Dev gallery only: fixed locomotion sample for the 3D cat. */
  preview?: LocomotionPreview;
};

/**
 * Chooses how the cat is drawn: registered raster frames first, then the 3D
 * cat, then the SVG cat (when WebGL is missing, fails, or its context is lost).
 */
export function PetArt({ state, blinking, reducedMotion, preview }: PetArtProps) {
  const [brokenFrames, setBrokenFrames] = useState<ReadonlySet<PetFrame>>(new Set());
  const [renderer, setRenderer] = useState<PetRenderer>(() => {
    const requested = requestedRenderer();
    if (requested === 'svg') return 'svg';
    if (webglSupported === null) {
      webglSupported = detectWebGL();
      if (!webglSupported) console.info('[Nottli] WebGL unavailable, using SVG pet');
    }
    return webglSupported ? '3d' : 'svg';
  });

  const blinkAsset = blinking && !brokenFrames.has('blink') ? developerCatAsset('blink') : null;
  const frame: PetFrame = blinkAsset ? 'blink' : state;
  const asset = brokenFrames.has(frame) ? null : developerCatAsset(frame);
  const svg = <PetCharacter state={state} blinking={blinking} />;

  if (asset) {
    return (
      <img
        className="pet-img"
        src={asset}
        width={92}
        height={92}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => setBrokenFrames((frames) => new Set(frames).add(frame))}
      />
    );
  }

  if (renderer === 'svg') return <span className="pet-art" data-renderer="svg">{svg}</span>;

  const fallBack = () => setRenderer('svg');
  return (
    <span className="pet-art" data-renderer="3d">
      <RenderBoundary fallback={svg} onError={fallBack}>
        {/* The SVG cat stands in for the brief moment the 3D chunk is loading. */}
        <Suspense fallback={svg}>
          <Pet3DCanvas state={state} blinking={blinking} reducedMotion={reducedMotion} preview={preview} onFailure={fallBack} />
        </Suspense>
      </RenderBoundary>
      <StateOverlay state={state} />
    </span>
  );
}

/** Flat cues drawn over the 3D cat (same grid and animation classes as the SVG cat). */
function StateOverlay({ state }: { state: PetState }) {
  if (state !== 'sleeping' && state !== 'notification') return null;
  return (
    <svg className="pet-overlay" viewBox="0 0 92 92" aria-hidden="true">
      {state === 'sleeping' ? (
        <g className="cat-zz" fill="#8F8A83" fontFamily="Segoe UI, sans-serif" fontWeight="700">
          <text x="69" y="20" fontSize="7">z</text>
          <text x="74.5" y="13" fontSize="5.5">z</text>
        </g>
      ) : (
        <g className="cat-badge">
          <circle cx="74" cy="15" r="5.2" fill="#F2843E" stroke="#17171B" strokeWidth="1.6" />
          <path d="M74 12.2 v3.3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="74" cy="17.9" r=".95" fill="#fff" />
        </g>
      )}
    </svg>
  );
}
