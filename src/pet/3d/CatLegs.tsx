import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { haunchGeometry } from './CatBody';
import { placeSegment, sleeveGeometry, stitchRing } from './CatHoodie';
import { Paw } from './CatPaws';
import { LOCO } from './constants';
import { cached, limbGeometry } from './geometry';
import { MATERIALS } from './materials';
import type { CatRig } from './rig';

const { upperForeleg, lowerForeleg, thigh, shank } = LOCO.bones;
/** Rest lengths of the short distal segments (they flex slightly between poses). */
const FOREPAW_REST = 0.21;
const METATARSUS_REST = 0.32;

const upperSleeve = () => cached('sleeve-upper', () => sleeveGeometry(upperForeleg, 0.118, 0.108));
const lowerSleeve = () => cached('sleeve-lower', () => sleeveGeometry(lowerForeleg, 0.108, 0.097, 0.075));
const cuff = () => cached('hoodie-cuff', () => new THREE.TorusGeometry(0.095, 0.028, 8, 32));
const forepaw = () => cached('forepaw', () => limbGeometry(FOREPAW_REST, 0.075, 0.088, 16));
const thighBone = () => cached('thigh', () => limbGeometry(thigh, 0.13, 0.1, 16));
const shankBone = () => cached('shank', () => limbGeometry(shank, 0.085, 0.065, 14));
const metatarsus = () => cached('metatarsus', () => limbGeometry(METATARSUS_REST, 0.055, 0.06, 14));

const X = new THREE.Vector3();
const Y = new THREE.Vector3();
const Z = new THREE.Vector3();
const M = new THREE.Matrix4();
const MID = new THREE.Vector3();
const STITCH = new THREE.Vector3();
const AXIS_Z = new THREE.Vector3(0, 0, 1);

type FrontRefs = { upper: THREE.Mesh | null; lower: THREE.Mesh | null; cuff: THREE.Mesh | null; stitch: THREE.Mesh | null; forepaw: THREE.Mesh | null; paw: THREE.Group | null };
type RearRefs = { haunch: THREE.Mesh | null; thigh: THREE.Mesh | null; shank: THREE.Mesh | null; metatarsus: THREE.Mesh | null; paw: THREE.Group | null };

/**
 * Four articulated legs driven by the rig's IK solution:
 *   front: shoulder → upper sleeve → elbow → lower sleeve (cuff) → wrist → white forepaw → paw
 *   hind:  hip → thigh (with the haunch mass) → knee → shank → hock → white metatarsus → paw
 * Each segment is a rigid mesh placed between two solved joints, so the leg stays
 * connected in every pose; the haunch keeps the familiar sitting silhouette.
 */
export function CatLegs({ rig }: { rig: CatRig }) {
  const front = useRef<FrontRefs[]>([0, 1].map(() => ({ upper: null, lower: null, cuff: null, stitch: null, forepaw: null, paw: null })));
  const rear = useRef<RearRefs[]>([0, 1].map(() => ({ haunch: null, thigh: null, shank: null, metatarsus: null, paw: null })));

  useLayoutEffect(
    () =>
      rig.subscribe((r) => {
        r.frontLegs.forEach((leg, i) => {
          const refs = front.current[i];
          placeSegment(refs.upper, leg.shoulder, leg.elbow, upperForeleg);
          placeSegment(refs.lower, leg.elbow, leg.wrist, lowerForeleg);
          // Cuff ring around the wrist, facing along the lower sleeve; stitching just above it.
          Z.subVectors(leg.wrist, leg.elbow).normalize();
          for (const ring of [refs.cuff, refs.stitch]) {
            if (!ring) continue;
            ring.quaternion.setFromUnitVectors(AXIS_Z, Z);
            ring.position.copy(ring === refs.cuff ? leg.wrist : STITCH.copy(leg.wrist).addScaledVector(Z, -0.035));
          }
          placeSegment(refs.forepaw, MID.copy(leg.paw).add(Y.set(0, 0.02, -0.03 * (1 - r.front))), leg.wrist, FOREPAW_REST);
          if (refs.paw) {
            refs.paw.position.copy(leg.paw);
            refs.paw.rotation.set(leg.pawPitch, leg.pawYaw, 0);
          }
        });
        r.rearLegs.forEach((leg, i) => {
          const refs = rear.current[i];
          const side = i === 0 ? 1 : -1;
          placeSegment(refs.thigh, leg.hip, leg.knee, thigh);
          placeSegment(refs.shank, leg.knee, leg.hock, shank);
          placeSegment(refs.metatarsus, leg.paw, leg.hock, METATARSUS_REST);
          if (refs.haunch) {
            // The haunch mass rides the thigh: long axis along the bone, sitting low on it.
            Z.subVectors(leg.knee, leg.hip).normalize();
            X.set(side, 0, 0).addScaledVector(Z, -Z.x * side).normalize();
            Y.crossVectors(Z, X);
            refs.haunch.quaternion.setFromRotationMatrix(M.makeBasis(X, Y, Z));
            refs.haunch.position.lerpVectors(leg.hip, leg.knee, 0.55).addScaledVector(Y, -0.06 * (1 - r.rear));
            refs.haunch.scale.setScalar(THREE.MathUtils.lerp(1, 0.72, r.rear));
          }
          if (refs.paw) {
            refs.paw.position.copy(leg.paw);
            refs.paw.rotation.set(leg.pawPitch, leg.pawYaw, 0);
          }
        });
      }),
    [rig]
  );

  return (
    <group name="legs">
      {([1, -1] as const).map((side, i) => {
        const name = side > 0 ? 'left' : 'right';
        const refs = front.current[i];
        return (
          <group key={`front-${side}`} name={`leg-front-${name}`}>
            <mesh ref={(m) => void (refs.upper = m)} name="upper-foreleg" geometry={upperSleeve()} material={MATERIALS.hoodie()} />
            <mesh ref={(m) => void (refs.lower = m)} name="lower-foreleg" geometry={lowerSleeve()} material={MATERIALS.hoodie()} />
            <mesh ref={(m) => void (refs.cuff = m)} name="cuff" geometry={cuff()} material={MATERIALS.hoodieRib()} />
            <mesh ref={(m) => void (refs.stitch = m)} name="cuff-stitch" geometry={stitchRing('cuff', 0.1)} material={MATERIALS.stitch()} />
            <mesh ref={(m) => void (refs.forepaw = m)} name="forepaw" geometry={forepaw()} material={MATERIALS.whiteFur()} />
            <group ref={(g) => void (refs.paw = g)} name="paw-pivot">
              <Paw name={`paw-front-${name}`} yaw={0} size={1} />
            </group>
          </group>
        );
      })}
      {([1, -1] as const).map((side, i) => {
        const name = side > 0 ? 'left' : 'right';
        const refs = rear.current[i];
        return (
          <group key={`rear-${side}`} name={`leg-rear-${name}`}>
            <mesh ref={(m) => void (refs.thigh = m)} name="thigh" geometry={thighBone()} material={MATERIALS.bodyFur()} />
            <mesh ref={(m) => void (refs.haunch = m)} name="haunch" geometry={haunchGeometry()} material={MATERIALS.bodyFur()} />
            <mesh ref={(m) => void (refs.shank = m)} name="shank" geometry={shankBone()} material={MATERIALS.bodyFur()} />
            <mesh ref={(m) => void (refs.metatarsus = m)} name="metatarsus" geometry={metatarsus()} material={MATERIALS.whiteFur()} />
            <group ref={(g) => void (refs.paw = g)} name="paw-pivot">
              <Paw name={`paw-rear-${name}`} yaw={0} size={1.18} />
            </group>
          </group>
        );
      })}
    </group>
  );
}
