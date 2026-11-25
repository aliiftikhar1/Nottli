import { useId } from 'react';
import type { PetState } from './usePetAnimation';

type PetCharacterProps = {
  state?: PetState;
  blinking?: boolean;
  size?: number;
  /** Head only, for small marks such as the notes-panel header. */
  faceOnly?: boolean;
};

const C = {
  ink: '#17171B',
  fur: '#FAF7F2',
  charcoal: '#3B3B43',
  hoodie: '#25252B',
  hoodieLine: '#3A3A42',
  cup: '#1D1D22',
  orange: '#F2843E',
  pink: '#F2A7A0',
  mouth: '#E46B57'
};

const LEFT_EYE = 37.5;
const RIGHT_EYE = 54.5;
const EYE_Y = 44.6;

function Eyes({ state, blinking }: { state: PetState; blinking: boolean }) {
  if (state === 'happy') {
    return (
      <g className="cat-line">
        <path d={`M${LEFT_EYE - 2.6} 45.6 q2.6 -3.4 5.2 0`} />
        <path d={`M${RIGHT_EYE - 2.6} 45.6 q2.6 -3.4 5.2 0`} />
      </g>
    );
  }
  if (state === 'sleeping') {
    return (
      <g className="cat-line">
        <path d={`M${LEFT_EYE - 2.6} 44.4 q2.6 2.6 5.2 0`} />
        <path d={`M${RIGHT_EYE - 2.6} 44.4 q2.6 2.6 5.2 0`} />
      </g>
    );
  }
  // Open eyes: the outer group sets the gaze per state, the inner one blinks.
  return (
    <g className="cat-gaze">
      <g className={blinking ? 'cat-lids is-blinking' : 'cat-lids'}>
        {[LEFT_EYE, RIGHT_EYE].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy={EYE_Y} rx="2.3" ry="2.9" fill={C.ink} />
            <circle cx={x + 0.8} cy={EYE_Y - 1.1} r="0.85" fill="#fff" />
          </g>
        ))}
      </g>
    </g>
  );
}

function Mouth({ state }: { state: PetState }) {
  switch (state) {
    case 'happy':
      return <path d="M43.3 52.3 q2.7 4.2 5.4 0 z" fill={C.mouth} stroke={C.ink} strokeWidth="1.3" strokeLinejoin="round" />;
    case 'notification':
      return <ellipse cx="46" cy="54" rx="1.3" ry="1.5" fill={C.mouth} stroke={C.ink} strokeWidth="1.1" />;
    case 'sleeping':
      return <path d="M44.6 53.1 q1.4 .9 2.8 0" className="cat-line thin" />;
    case 'thinking':
      return <path d="M44.2 53.4 q1.8 -.9 3.6 .2" className="cat-line thin" />;
    default:
      return <path d="M43.2 52.6 q1.4 1.7 2.8 0 q1.4 1.7 2.8 0" className="cat-line thin" />;
  }
}

function Head({ state, blinking, clipId }: { state: PetState; blinking: boolean; clipId: string }) {
  return (
    <g className="cat-head">
      {/* ears */}
      <path d="M27.5 33 L29 15.5 L41 25 Z" fill={C.charcoal} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M64.5 33 L63 15.5 L51 25 Z" fill={C.charcoal} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M30.6 28.6 L31.3 20.4 L37 25.3 Z" fill={C.pink} />
      <path d="M61.4 28.6 L60.7 20.4 L55 25.3 Z" fill={C.pink} />

      {/* head: white fur with a charcoal cap */}
      <clipPath id={clipId}>
        <ellipse cx="46" cy="41" rx="22.5" ry="19.5" />
      </clipPath>
      <ellipse cx="46" cy="41" rx="22.5" ry="19.5" fill={C.fur} />
      <path clipPath={`url(#${clipId})`} d="M20 39 C23 30 30 26 38 27 L46 33.5 L54 27 C62 26 69 30 72 39 L72 16 L20 16 Z" fill={C.charcoal} />
      <ellipse cx="46" cy="41" rx="22.5" ry="19.5" fill="none" stroke={C.ink} strokeWidth="2" />

      <ellipse cx="30.4" cy="51.2" rx="2.8" ry="1.6" fill={C.pink} opacity=".6" />
      <ellipse cx="61.6" cy="51.2" rx="2.8" ry="1.6" fill={C.pink} opacity=".6" />

      <Eyes state={state} blinking={blinking} />

      {/* round glasses */}
      <g fill="rgba(255,255,255,.16)" stroke={C.ink} strokeWidth="1.8">
        <circle cx={LEFT_EYE} cy="44" r="6.3" />
        <circle cx={RIGHT_EYE} cy="44" r="6.3" />
      </g>
      <path d="M43.8 43.3 Q46 41.9 48.2 43.3 M31.2 43 L25.6 42 M60.8 43 L66.4 42" stroke={C.ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M33.6 41.2 q1.2 -1.7 3 -2.1 M50.6 41.2 q1.2 -1.7 3 -2.1" stroke="#fff" strokeWidth="1" fill="none" strokeLinecap="round" opacity=".85" />

      <path d="M44.6 50.5 h2.8 l-1.4 1.6 z" fill={C.pink} stroke={C.ink} strokeWidth=".9" strokeLinejoin="round" />
      <Mouth state={state} />

      {/* headphones with </> on the cups */}
      <path d="M22 43 C21 16 71 16 70 43" fill="none" stroke={C.ink} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M23.6 37 C25 21 67 21 68.4 37" fill="none" stroke={C.charcoal} strokeWidth="1" strokeLinecap="round" />
      <rect x="17.5" y="36" width="8" height="15" rx="3.6" fill={C.cup} stroke={C.ink} strokeWidth="1.6" />
      <rect x="66.5" y="36" width="8" height="15" rx="3.6" fill={C.cup} stroke={C.ink} strokeWidth="1.6" />
      <path d="M23 40.8 L20.6 43.5 L23 46.2 M69 40.8 L71.4 43.5 L69 46.2" fill="none" stroke={C.orange} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/**
 * The developer cat, drawn on a 92×92 grid to match the pet window.
 * Expressions are markup; motion is CSS keyed off the state classes on `.pet`.
 */
export function PetCharacter({ state = 'idle', blinking = false, size = 92, faceOnly = false }: PetCharacterProps) {
  const clipId = `cat-head-${useId().replace(/:/g, '')}`;

  if (faceOnly) {
    return (
      <svg width={size} height={size} viewBox="15 12 62 52" aria-hidden="true" className="pet-svg">
        <Head state={state} blinking={false} clipId={clipId} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 92 92" aria-hidden="true" className="pet-svg">
      {/* tail, behind the body */}
      <path d="M61 79 C73 80 79 71 74.5 62.5" fill="none" stroke={C.ink} strokeWidth="7" strokeLinecap="round" className="cat-tail" />
      <path d="M61 79 C73 80 79 71 74.5 62.5" fill="none" stroke={C.charcoal} strokeWidth="3.8" strokeLinecap="round" className="cat-tail" />

      {/* hoodie */}
      <path d="M29 83 C27 72 30 64 38 60.5 L54 60.5 C62 64 65 72 63 83 Q46 85.5 29 83 Z" fill={C.hoodie} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M37 76.5 Q46 74 55 76.5" fill="none" stroke={C.hoodieLine} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M42.6 62 L41.8 69 M49.4 62 L50.2 69" stroke={C.orange} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="41.7" cy="69.6" r="1.1" fill={C.orange} />
      <circle cx="50.3" cy="69.6" r="1.1" fill={C.orange} />

      <Head state={state} blinking={blinking} clipId={clipId} />

      {/* front paws */}
      <ellipse className="cat-paw cat-paw-left" cx="39.5" cy="81.2" rx="4.2" ry="3" fill={C.fur} stroke={C.ink} strokeWidth="1.8" />
      <ellipse className="cat-paw cat-paw-right" cx="52.5" cy="81.2" rx="4.2" ry="3" fill={C.fur} stroke={C.ink} strokeWidth="1.8" />

      {state === 'sleeping' ? (
        <g className="cat-zz" fill="#8F8A83" fontFamily="Segoe UI, sans-serif" fontWeight="700">
          <text x="67" y="21" fontSize="7">z</text>
          <text x="72.5" y="14" fontSize="5.5">z</text>
        </g>
      ) : null}
      {state === 'notification' ? (
        <g className="cat-badge">
          <circle cx="73" cy="16" r="5.2" fill={C.orange} stroke={C.ink} strokeWidth="1.6" />
          <path d="M73 13.2 v3.3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="73" cy="18.9" r=".95" fill="#fff" />
        </g>
      ) : null}
    </svg>
  );
}
