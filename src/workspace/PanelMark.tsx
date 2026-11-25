import { PetCharacter } from '../pet/PetCharacter';

/**
 * The header mark: the flat SVG cat face.
 *
 * This used to mount a second three.js canvas (a whole extra WebGL context plus
 * the 3D bundle in the hidden notes window) for a 32px icon. That cost tens of
 * MB of GPU/renderer memory for no visible benefit, so the mark is plain SVG.
 */
export function PanelMark({ size = 30 }: { size?: number }) {
  return (
    <span className="panel-mark-3d" style={{ width: size, height: size }}>
      <PetCharacter faceOnly size={size - 6} />
    </span>
  );
}
