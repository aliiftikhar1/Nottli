import { Suspense, lazy, useState } from 'react';
import { PetCharacter } from '../pet/PetCharacter';

const Pet3DCanvas = lazy(() => import('../pet/3d/Pet3DCanvas'));

/** The header mark: the real three.js cat, head-framed. Falls back to the flat face if WebGL fails. */
export function PanelMark({ size = 30 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  const fallback = <PetCharacter faceOnly size={size - 6} />;
  if (failed) return fallback;
  return (
    <span className="panel-mark-3d" style={{ width: size, height: size }}>
      <Suspense fallback={fallback}>
        <Pet3DCanvas state="idle" blinking={false} reducedMotion framing="head" onFailure={() => setFailed(true)} />
      </Suspense>
    </span>
  );
}
