import type { RefObject } from 'react';
import type * as THREE from 'three';
import { BODY, HEAD } from './constants';
import { CatAccessories } from './CatAccessories';
import { CatEars } from './CatEars';
import { CatEyes, type EyeRig } from './CatEyes';
import { CatFace } from './CatFace';
import { bump, cached, deformedSphere } from './geometry';
import { MATERIALS } from './materials';

/**
 * Skull: wide cheekbones just below the eye line, a tapered chin, a flatter
 * face plane, a slightly lowered crown and a longer back of the head.
 */
const skull = () =>
  cached('skull', () =>
    deformedSphere(
      HEAD.radius,
      64,
      48,
      (p) => {
        const y = p.y;
        const cheek = 0.13 * bump(y + 0.22, 0.32);
        const chin = y < -0.45 ? 0.38 * ((-y - 0.45) / 0.55) ** 1.4 : 0;
        p.x *= 1 + cheek - chin;
        p.z *= 1 + cheek * 0.3 - chin * 0.5;
        if (p.z > 0.55) p.z = 0.55 + (p.z - 0.55) * 0.72;
        if (p.z < 0) p.z *= 1.06;
        if (y > 0.6) p.y = 0.6 + (y - 0.6) * 0.85;
        return p;
      },
      HEAD.scale
    )
  );
/** A soft teardrop of fur: round at the root, tapering to a blunt point along +y. */
const tuft = () =>
  cached('cheek-tuft', () =>
    deformedSphere(
      1,
      16,
      12,
      (p) => {
        const t = (p.y + 1) / 2;
        p.x *= 1 - 0.55 * t * t;
        p.z *= 1 - 0.55 * t * t;
        return p;
      },
      [0.065, 0.1, 0.05]
    )
  );

/** Cheek ruff along the jaw: [x, y, z, outward angle]. */
const TUFTS: [number, number, number, number][] = [
  [0.53, -0.12, 0.02, 2.05],
  [0.5, -0.21, 0.08, 2.35],
  [0.43, -0.28, 0.14, 2.65]
];

export type HeadRig = {
  pivot: RefObject<THREE.Group>;
  ears: RefObject<THREE.Group>[];
  eyes: EyeRig;
};

/** Head on a neck pivot so it can tilt and nod as one unit with its accessories. */
export function CatHead({ rig }: { rig: HeadRig }) {
  return (
    <group ref={rig.pivot} name="head-pivot" position={BODY.neck}>
      <group name="head" position={HEAD.offset}>
        <mesh name="skull" geometry={skull()} material={MATERIALS.headFur()} />
        <group name="cheek-tufts">
          {([1, -1] as const).flatMap((side) =>
            TUFTS.map(([x, y, z, angle], index) => (
              <mesh
                key={`${side}-${index}`}
                geometry={tuft()}
                material={MATERIALS.silverFur()}
                scale={0.85 - index * 0.08}
                position={[x * side, y, z]}
                rotation={[0, 0, -angle * side]}
              />
            ))
          )}
        </group>
        <CatEars pivots={rig.ears} />
        <CatEyes rig={rig.eyes} />
        <CatFace />
        <CatAccessories />
      </group>
    </group>
  );
}
