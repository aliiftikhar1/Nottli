import * as THREE from 'three';
import { cached, deformedSphere } from './geometry';
import { MATERIALS } from './materials';

const pad = () => cached('muzzle-pad', () => deformedSphere(1, 22, 16, (p) => p, [0.1, 0.082, 0.085]));
const chin = () => cached('chin', () => deformedSphere(1, 18, 12, (p) => p, [0.068, 0.05, 0.062]));
const nose = () =>
  cached('nose', () =>
    deformedSphere(
      1,
      18,
      12,
      (p) => {
        // Rounded triangle: wide on top, pinched toward the bottom.
        p.x *= 1 - 0.45 * Math.max(-p.y, 0);
        return p;
      },
      [0.05, 0.032, 0.034]
    )
  );

function tube(key: string, points: THREE.Vector3Tuple[], radius: number) {
  return cached(key, () => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    return new THREE.TubeGeometry(curve, 12, radius, 5, false);
  });
}

const mouthGeometry = () => [
  tube('mouth-philtrum', [
    [0, -0.093, 0.43],
    [0, -0.12, 0.438]
  ], 0.0065),
  tube('mouth-left', [
    [0, -0.12, 0.438],
    [0.024, -0.14, 0.446],
    [0.054, -0.128, 0.438]
  ], 0.0065),
  tube('mouth-right', [
    [0, -0.12, 0.438],
    [-0.024, -0.14, 0.446],
    [-0.054, -0.128, 0.438]
  ], 0.0065)
];

/** Four whiskers per side [start y, end y, reach], fanning out from the pads past the cheeks. */
const WHISKERS: [number, number, number][] = [
  [-0.098, -0.01, 0.74],
  [-0.115, -0.08, 0.76],
  [-0.132, -0.15, 0.72],
  [-0.15, -0.22, 0.66]
];

export function CatFace() {
  return (
    <group name="face">
      <group name="muzzle">
        <mesh geometry={pad()} material={MATERIALS.whiteFur()} position={[0.07, -0.135, 0.362]} />
        <mesh geometry={pad()} material={MATERIALS.whiteFur()} position={[-0.07, -0.135, 0.362]} />
        <mesh geometry={chin()} material={MATERIALS.whiteFur()} position={[0, -0.228, 0.33]} />
      </group>
      <mesh name="nose" geometry={nose()} material={MATERIALS.nose()} position={[0, -0.068, 0.43]} rotation={[0.35, 0, 0]} />
      <group name="mouth">
        {mouthGeometry().map((geometry, index) => (
          <mesh key={index} geometry={geometry} material={MATERIALS.mouth()} />
        ))}
      </group>
      <group name="whiskers">
        {([1, -1] as const).flatMap((side) =>
          WHISKERS.map(([startY, endY, reach], index) => (
            <mesh
              key={`${side}-${index}`}
              material={MATERIALS.whisker()}
              geometry={tube(`whisker-${side}-${index}`, [
                [0.11 * side, startY - 0.04, 0.42],
                [0.4 * side, (startY + endY) / 2 - 0.05, 0.37],
                [reach * side, endY - 0.04, 0.24]
              ], 0.0058)}
            />
          ))
        )}
      </group>
    </group>
  );
}
