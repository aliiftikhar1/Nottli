import * as THREE from 'three';
import { HEAD } from './constants';
import { cached, limbGeometry, limbTransform } from './geometry';
import { MATERIALS } from './materials';

const RING = 0.13;
const ring = () => cached('glasses-ring', () => new THREE.TorusGeometry(RING, 0.016, 10, 48));
const lens = () => cached('glasses-lens', () => new THREE.CircleGeometry(RING, 32));
const bridge = () => cached('glasses-bridge', () => new THREE.TorusGeometry(0.062, 0.013, 8, 20, Math.PI));
const band = () => cached('headphone-band', () => new THREE.TorusGeometry(0.62, 0.036, 10, 56, Math.PI));
const cup = () =>
  cached('headphone-cup', () => {
    const profile: [number, number][] = [
      [0.0001, 0],
      [0.12, 0],
      [0.155, 0.015],
      [0.165, 0.05],
      [0.155, 0.085],
      [0.12, 0.1],
      [0.0001, 0.1]
    ];
    return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 36);
  });
const cushion = () => cached('headphone-cushion', () => new THREE.TorusGeometry(0.115, 0.036, 10, 32));
const bar = () => cached('emblem-bar', () => new THREE.BoxGeometry(1, 1, 1));

const GLASSES_Z = 0.465;
const BAND_Z = -0.16;
const BAND_SQUASH = 0.65;

/** "</>" in glowing orange, laid on a cup's outer face (local xz plane). */
function CodeEmblem() {
  const stroke = (x: number, z: number, angle: number, length: number) => (
    <mesh geometry={bar()} material={MATERIALS.orangeGlow()} position={[x, 0, z]} rotation={[0, angle, 0]} scale={[length, 0.01, 0.013]} />
  );
  return (
    <group name="code-emblem" position={[0, 0.104, 0]}>
      {stroke(-0.068, -0.014, 0.75, 0.04)}
      {stroke(-0.068, 0.014, -0.75, 0.04)}
      {stroke(0, 0, 1.2, 0.07)}
      {stroke(0.068, -0.014, -0.75, 0.04)}
      {stroke(0.068, 0.014, 0.75, 0.04)}
    </group>
  );
}

/** Round black glasses and over-ear headphones. Lives in the head group so it moves with the head. */
export function CatAccessories() {
  const [ex, ey] = HEAD.eye;
  const [cx, cy, cz] = HEAD.cup;
  return (
    <group name="accessories">
      <group name="glasses">
        {([1, -1] as const).map((side) => (
          <group key={side} position={[ex * side, ey, GLASSES_Z]} rotation={[0, 0.14 * side, 0]}>
            <mesh geometry={ring()} material={MATERIALS.frame()} />
            <mesh geometry={lens()} material={MATERIALS.lens()} renderOrder={4} />
          </group>
        ))}
        <mesh geometry={bridge()} material={MATERIALS.frame()} position={[0, ey + 0.01, GLASSES_Z + 0.008]} />
        {([1, -1] as const).map((side) => {
          const { position, quaternion, length } = limbTransform(
            [(ex + RING) * side * 0.99, ey + 0.02, GLASSES_Z - 0.02],
            [(cx - 0.02) * side, cy + 0.03, cz + 0.12]
          );
          return (
            <mesh
              key={side}
              geometry={cached(`glasses-temple`, () => limbGeometry(length, 0.009, 0.009, 8))}
              material={MATERIALS.frame()}
              position={position}
              quaternion={quaternion}
            />
          );
        })}
      </group>

      <group name="headphones">
        <mesh name="headphone-band" geometry={band()} material={MATERIALS.headphone()} position={[0, cy, BAND_Z]} scale={[1, BAND_SQUASH, 1]} />
        {([1, -1] as const).map((side) => (
          <group key={side} name={side > 0 ? 'cup-left' : 'cup-right'} position={[cx * side, cy, cz]} rotation={[0, 0, (-Math.PI / 2) * side]}>
            <mesh geometry={cup()} material={MATERIALS.headphone()} />
            <mesh geometry={cushion()} material={MATERIALS.cushion()} position={[0, -0.005, 0]} rotation={[Math.PI / 2, 0, 0]} />
            <CodeEmblem />
          </group>
        ))}
      </group>
    </group>
  );
}
