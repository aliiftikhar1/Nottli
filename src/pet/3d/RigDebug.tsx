import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CatRig } from './rig';

/**
 * Development-only skeleton overlay for the pet gallery (`&debug=1`). Loaded lazily
 * behind import.meta.env.DEV, so it is not part of the production pet.
 *   white  joints (shoulder, elbow, wrist, hip, knee, hock)
 *   orange paw targets      cyan  tail control points
 *   magenta pelvis + neck   grid  ground plane (y = 0)
 */
export default function RigDebug({ rig }: { rig: CatRig }) {
  const sphere = useMemo(() => new THREE.SphereGeometry(0.03, 8, 6), []);
  const materials = useMemo(
    () => ({
      joint: new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }),
      target: new THREE.MeshBasicMaterial({ color: '#ff8a3d', depthTest: false }),
      tail: new THREE.MeshBasicMaterial({ color: '#3ad1ff', depthTest: false }),
      pivot: new THREE.MeshBasicMaterial({ color: '#ff3ad1', depthTest: false })
    }),
    []
  );
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const tail = useRef<(THREE.Mesh | null)[]>([]);
  const TAIL_MARKS = 9;

  useLayoutEffect(
    () =>
      rig.subscribe((r) => {
        const points = [
          ...r.frontLegs.flatMap((l) => [l.shoulder, l.elbow, l.wrist]),
          ...r.rearLegs.flatMap((l) => [l.hip, l.knee, l.hock]),
          ...r.frontLegs.map((l) => l.target),
          ...r.rearLegs.map((l) => l.target),
          r.pelvis,
          r.neck
        ];
        points.forEach((p, i) => joints.current[i]?.position.copy(p));
        for (let i = 0; i < TAIL_MARKS; i += 1) tail.current[i]?.position.copy(r.tail[Math.round((i / (TAIL_MARKS - 1)) * (r.tail.length - 1))]);
      }),
    [rig]
  );

  const kinds = [...Array(12).fill('joint'), ...Array(4).fill('target'), 'pivot', 'pivot'] as (keyof typeof materials)[];
  return (
    <group name="rig-debug" renderOrder={10}>
      <gridHelper args={[3, 12, '#8f8a83', '#c9c4bc']} position={[0, 0.001, 0]} />
      {kinds.map((kind, i) => (
        <mesh key={i} ref={(m) => void (joints.current[i] = m)} geometry={sphere} material={materials[kind]} renderOrder={10} />
      ))}
      {Array.from({ length: TAIL_MARKS }, (_, i) => (
        <mesh key={`t${i}`} ref={(m) => void (tail.current[i] = m)} geometry={sphere} material={materials.tail} scale={0.7} renderOrder={10} />
      ))}
    </group>
  );
}
