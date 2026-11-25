import type { RefObject } from 'react';
import * as THREE from 'three';
import { HEAD } from './constants';
import { cached } from './geometry';
import { MATERIALS } from './materials';

const R = HEAD.eyeRadius;

const eyeball = () => cached('eyeball', () => new THREE.SphereGeometry(R, 28, 20));
/** Iris disc bent onto the eyeball surface, keeping planar UVs so the texture stays centred. */
const iris = () =>
  cached('iris', () => {
    const geometry = new THREE.CircleGeometry(R * 0.8, 40);
    const position = geometry.getAttribute('position');
    // Clearly in front of the eyeball (plus a polygon offset on the material) so it never z-fights.
    const surface = R * 1.02;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      position.setZ(i, Math.sqrt(Math.max(surface * surface - x * x - y * y, 0)));
    }
    geometry.computeVertexNormals();
    return geometry;
  });
const cornea = () => cached('cornea', () => new THREE.SphereGeometry(R * 1.045, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(Math.PI / 2));
const upperLid = () => cached('lid-upper', () => new THREE.SphereGeometry(R * 1.085, 30, 12, 0, Math.PI * 2, 0, Math.PI / 2));
const lowerLid = () => cached('lid-lower', () => new THREE.SphereGeometry(R * 1.075, 30, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
const lash = () => cached('eye-lash', () => new THREE.TorusGeometry(R * 1.085, R * 0.07, 6, 40));
const liner = () => cached('eye-liner', () => new THREE.TorusGeometry(R * 1.0, R * 0.11, 8, 40));
const glint = () => cached('eye-glint', () => new THREE.CircleGeometry(1, 16));

export type EyeRig = {
  gaze: RefObject<THREE.Group>[];
  upper: RefObject<THREE.Mesh>[];
  lower: RefObject<THREE.Mesh>[];
};

/**
 * Layered eyes: dark eyeball, amber iris + pupil (in a gaze group), glossy cornea,
 * fixed highlights, a dark rim, and upper/lower lids that rotate about the eye centre.
 */
export function CatEyes({ rig }: { rig: EyeRig }) {
  return (
    <group name="eyes">
      {([1, -1] as const).map((side, index) => (
        <group
          key={side}
          name={side > 0 ? 'eye-left' : 'eye-right'}
          position={[HEAD.eye[0] * side, HEAD.eye[1], HEAD.eye[2]]}
          // Almond shape: slightly wider than tall, outer corners lifted.
          rotation={[-0.04, HEAD.eyeYaw * side, 0.1 * side]}
          scale={[1.07, 0.94, 1]}
        >
          <mesh geometry={eyeball()} material={MATERIALS.eyeDark()} />
          <group ref={rig.gaze[index]} name="gaze">
            <mesh geometry={iris()} material={MATERIALS.iris()} />
          </group>
          <mesh geometry={cornea()} material={MATERIALS.cornea()} renderOrder={2} />
          {/* Highlights stay put while the gaze moves, like reflections of a window. */}
          <mesh geometry={glint()} material={MATERIALS.highlight()} position={[-0.034, 0.038, R * 1.03]} scale={0.019} renderOrder={3} />
          <mesh geometry={glint()} material={MATERIALS.highlight()} position={[0.03, -0.028, R * 1.04]} scale={0.009} renderOrder={3} />
          <mesh geometry={liner()} material={MATERIALS.eyeliner()} position={[0, 0, R * 0.36]} />
          {/* The dark lash line rides on each lid's rim, so a closed eye reads as a curved line. */}
          <mesh ref={rig.upper[index]} name="lid-upper" geometry={upperLid()} material={MATERIALS.lidFur()}>
            <mesh geometry={lash()} material={MATERIALS.lashLine()} rotation={[Math.PI / 2, 0, 0]} />
          </mesh>
          <mesh ref={rig.lower[index]} name="lid-lower" geometry={lowerLid()} material={MATERIALS.lidFur()}>
            <mesh geometry={lash()} material={MATERIALS.lashLine()} rotation={[Math.PI / 2, 0, 0]} scale={0.99} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
