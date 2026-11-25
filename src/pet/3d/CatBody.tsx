import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { BODY, LOCO } from './constants';
import { cached, deformedSphere } from './geometry';
import { MATERIALS } from './materials';
import type { CatRig } from './rig';

/** Haunch: an egg fuller at the back and bottom, the thigh mass of the cat. Used by CatLegs. */
export const haunchGeometry = () =>
  cached('haunch', () =>
    deformedSphere(
      1,
      36,
      24,
      (p) => {
        if (p.z < 0) p.multiplyScalar(1 + 0.08 * -p.z);
        if (p.y < 0) p.y *= 0.82;
        return p;
      },
      BODY.thighRadii
    )
  );

/** Rump: the pelvis and hindquarters behind the hoodie hem. Fuller toward the top and back. */
const rump = () =>
  cached('rump', () =>
    deformedSphere(
      1,
      32,
      22,
      (p) => {
        if (p.y > 0) p.z -= 0.08 * p.y; // slope of the croup toward the tail
        return p;
      },
      LOCO.rumpRadii
    )
  );
const belly = () => cached('belly', () => deformedSphere(1, 28, 18, (p) => p, [0.32, 0.2, 0.3]));
const chestRuff = () => cached('chest-ruff', () => deformedSphere(1, 24, 16, (p) => p, [0.2, 0.15, 0.12]));

const C = new THREE.Vector3();
const T = new THREE.Vector3();
const F = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const M = new THREE.Matrix4();

/** Puts `object` in the spine frame at t, offset by `local` (x lateral, y along spine, z ventral). */
function attach(object: THREE.Object3D | null, rig: CatRig, t: number, local: readonly [number, number, number]) {
  if (!object) return;
  rig.frameAt(t, C, T, F);
  object.quaternion.setFromRotationMatrix(M.makeBasis(X, T, F));
  object.position.copy(C).addScaledVector(X, local[0]).addScaledVector(T, local[1]).addScaledVector(F, local[2]);
}

/**
 * Fur on the torso itself: the rump (pelvis and hindquarters — hidden inside the
 * sitting body, clearly visible behind the hem when standing), the belly between
 * the legs and the chest ruff under the chin. Legs live in CatLegs.
 */
export function CatBody({ rig }: { rig: CatRig }) {
  const rumpRef = useRef<THREE.Mesh>(null);
  const bellyRef = useRef<THREE.Mesh>(null);
  const ruffRef = useRef<THREE.Mesh>(null);

  useLayoutEffect(
    () =>
      rig.subscribe((r) => {
        if (rumpRef.current) {
          rumpRef.current.position.copy(r.pelvis);
          // Level when standing; tipped up with the upright torso when sitting.
          rumpRef.current.rotation.set(-0.9 * (1 - r.rear), 0, 0);
        }
        attach(bellyRef.current, r, 0, [0, -0.1, 0.14]);
        attach(ruffRef.current, r, 1, [0, -0.06, 0.15]);
      }),
    [rig]
  );

  return (
    <group name="body">
      <mesh ref={rumpRef} name="rump" geometry={rump()} material={MATERIALS.bodyFur()} />
      <mesh ref={bellyRef} name="belly" geometry={belly()} material={MATERIALS.whiteFur()} />
      <mesh ref={ruffRef} name="chest-ruff" geometry={chestRuff()} material={MATERIALS.whiteFur()} />
    </group>
  );
}
