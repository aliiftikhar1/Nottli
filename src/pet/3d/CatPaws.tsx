import * as THREE from 'three';
import { cached, deformedSphere } from './geometry';
import { MATERIALS } from './materials';

const TOES: [number, number][] = [
  [-0.064, 0.082],
  [-0.022, 0.1],
  [0.022, 0.1],
  [0.064, 0.082]
];

const pawBase = () =>
  cached('paw-base', () =>
    deformedSphere(
      1,
      24,
      16,
      (p) => {
        // Flat underside, rounded top that rises toward the wrist.
        if (p.y < -0.2) p.y = -0.2 + (p.y + 0.2) * 0.35;
        if (p.z < 0) p.y += -p.z * 0.25;
        return p;
      },
      [0.1, 0.07, 0.125]
    )
  );
const toe = () => cached('paw-toe', () => new THREE.SphereGeometry(0.037, 14, 10));

type PawProps = { name: string; yaw: number; size: number };

/**
 * One white paw at its own origin: a pad-shaped base and four toe beads.
 * CatLegs places each paw inside its leg's paw pivot so it moves with the leg.
 */
export function Paw({ name, yaw, size }: PawProps) {
  return (
    <group name={name} rotation={[0, yaw, 0]} scale={size}>
      <mesh geometry={pawBase()} material={MATERIALS.whiteFur()} />
      {TOES.map(([x, z]) => (
        <mesh key={x} geometry={toe()} material={MATERIALS.whiteFur()} position={[x, -0.004, z]} scale={[1, 0.82, 1.1]} />
      ))}
    </group>
  );
}
