import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { TAIL } from './constants';
import { bump } from './geometry';
import { MATERIALS } from './materials';
import type { CatRig } from './rig';

/** Thin at the root, fuller through the middle, staying plush to the tip. */
function tailRadius(t: number) {
  return 0.078 + 0.045 * Math.min(t / 0.35, 1) - 0.01 * bump(t - 1, 0.25);
}

const CAP = 5;
const RINGS = TAIL.segments + 1 + CAP;
const RADIAL = TAIL.radial;

/** Tail buffers, allocated once and rewritten in place: no geometry is created per frame. */
function createTailGeometry() {
  const geometry = new THREE.BufferGeometry();
  const count = RINGS * (RADIAL + 1);
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(count * 2);
  const index: number[] = [];
  for (let i = 0; i < RINGS; i += 1) {
    for (let j = 0; j <= RADIAL; j += 1) {
      const k = i * (RADIAL + 1) + j;
      uv[k * 2] = i / (RINGS - 1); // along the tail: the tabby rings
      uv[k * 2 + 1] = j / RADIAL;
      // Winding: (along the circumference) × (along the tail) points outward.
      if (i < RINGS - 1 && j < RADIAL) index.push(k, k + 1, k + RADIAL + 1, k + 1, k + RADIAL + 2, k + RADIAL + 1);
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 3);
  return geometry;
}

const tangent = new THREE.Vector3();
const previous = new THREE.Vector3();
const normal = new THREE.Vector3();
const binormal = new THREE.Vector3();
const center = new THREE.Vector3();
const radial = new THREE.Vector3();
const axis = new THREE.Vector3();
const q = new THREE.Quaternion();

/**
 * Sweeps the tapered tube along the rig's tail centerline using parallel-transport
 * frames (no twisting or flips), then closes it with a rounded cap. Normals are the
 * radial directions, so no normal recomputation is needed.
 */
function updateTail(geometry: THREE.BufferGeometry, rig: CatRig) {
  const points = rig.tail;
  const n = points.length - 1;
  const position = (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const normals = (geometry.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;

  tangent.subVectors(points[1], points[0]).normalize();
  normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
  previous.copy(tangent);
  for (let i = 0; i < RINGS; i += 1) {
    let radius: number;
    if (i <= n) {
      const a = points[Math.max(i - 1, 0)];
      const b = points[Math.min(i + 1, n)];
      tangent.subVectors(b, a).normalize();
      // Parallel transport: rotate the previous normal by the change in tangent.
      axis.crossVectors(previous, tangent);
      const sin = axis.length();
      if (sin > 1e-6) normal.applyQuaternion(q.setFromAxisAngle(axis.divideScalar(sin), Math.asin(Math.min(sin, 1))));
      previous.copy(tangent);
      center.copy(points[i]);
      radius = tailRadius(i / n);
    } else {
      // Hemispherical tip cap.
      const angle = ((i - n) / CAP) * (Math.PI / 2);
      const tip = tailRadius(1);
      center.copy(points[n]).addScaledVector(tangent, Math.sin(angle) * tip);
      radius = Math.max(Math.cos(angle) * tip, 0.0005);
    }
    binormal.crossVectors(tangent, normal).normalize();
    for (let j = 0; j <= RADIAL; j += 1) {
      const a = (j / RADIAL) * Math.PI * 2;
      radial.copy(normal).multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      const k = (i * (RADIAL + 1) + j) * 3;
      position[k] = center.x + radial.x * radius;
      position[k + 1] = center.y + radial.y * radius;
      position[k + 2] = center.z + radial.z * radius;
      // At the cap the surface normal tilts toward the tip.
      if (i > n) radial.lerp(tangent, (i - n) / CAP).normalize();
      normals[k] = radial.x;
      normals[k + 1] = radial.y;
      normals[k + 2] = radial.z;
    }
  }
  geometry.getAttribute('position').needsUpdate = true;
  geometry.getAttribute('normal').needsUpdate = true;
}

/** A flexible tail whose whole shape follows the rig every animated frame. */
export function CatTail({ rig }: { rig: CatRig }) {
  const geometry = useMemo(createTailGeometry, []);
  useLayoutEffect(() => {
    const off = rig.subscribe((r) => updateTail(geometry, r));
    return () => {
      off();
      geometry.dispose();
    };
  }, [rig, geometry]);
  return <mesh name="tail" geometry={geometry} material={MATERIALS.tailFur()} frustumCulled={false} />;
}
