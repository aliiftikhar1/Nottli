import type { RefObject } from 'react';
import * as THREE from 'three';
import { HEAD } from './constants';
import { cached, smoothSeams } from './geometry';
import { MATERIALS } from './materials';

const EAR_HEIGHT = 0.34;

/**
 * A flattened cone with its base at y = 0, curved backward toward the tip.
 * The sides bow out a little so the tip reads rounded rather than needle-sharp,
 * and the front is flattened into a shallow dish for the inner ear to sit in.
 */
function earShape(radius: number, height: number, depth: number, bend: number, segments: number, dish: number) {
  const geometry = new THREE.ConeGeometry(radius, height, segments, 8, true);
  geometry.translate(0, height / 2, 0);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getY(i) / height;
    const bow = 1 + 0.2 * Math.sin(Math.PI * t) - 0.1 * t;
    const z = position.getZ(i) * depth * bow;
    position.setX(i, position.getX(i) * bow);
    position.setZ(i, (z > 0 ? z * dish : z) - bend * t * t);
  }
  return smoothSeams(geometry);
}

const outerEar = () => cached('ear-outer', () => earShape(0.17, EAR_HEIGHT, 0.46, 0.09, 24, 0.45));
const innerEar = () => cached('ear-inner', () => earShape(0.118, EAR_HEIGHT * 0.78, 0.2, 0.07, 18, 1));
const tuft = () => cached('ear-tuft', () => new THREE.ConeGeometry(0.014, 0.11, 6, 1).translate(0, 0.055, 0));

/** Pale furnishings fanning up out of the inner ear: [x, tilt]. */
const TUFTS: [number, number][] = [
  [-0.04, 0.35],
  [0, 0.08],
  [0.04, -0.25]
];

type CatEarsProps = { pivots: RefObject<THREE.Group>[] };

/** Two ears, each on its own pivot at the base so they can perk or flatten later. */
export function CatEars({ pivots }: CatEarsProps) {
  return (
    <group name="ears">
      {([1, -1] as const).map((side, index) => (
        <group
          key={side}
          name={side > 0 ? 'ear-left' : 'ear-right'}
          position={[HEAD.ear[0] * side, HEAD.ear[1], HEAD.ear[2]]}
          rotation={[-0.12, 0.32 * side, -0.3 * side]}
        >
          <group ref={pivots[index]} name="ear-pivot">
            <mesh geometry={outerEar()} material={MATERIALS.bodyFur()} />
            <mesh geometry={innerEar()} material={MATERIALS.innerEar()} position={[0, 0.015, 0.045]} />
            {TUFTS.map(([x, tilt]) => (
              <mesh key={x} geometry={tuft()} material={MATERIALS.whiteFur()} position={[x, 0.02, 0.05]} rotation={[0.25, 0, tilt]} />
            ))}
          </group>
        </group>
      ))}
    </group>
  );
}
