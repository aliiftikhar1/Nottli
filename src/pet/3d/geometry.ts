import * as THREE from 'three';

/**
 * Geometry helpers for organic shapes. Every geometry is built once and cached
 * for the lifetime of the app (the pet never needs a second copy).
 */
const cache = new Map<string, THREE.BufferGeometry>();

export function cached<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  let geometry = cache.get(key) as T | undefined;
  if (!geometry) {
    geometry = build();
    cache.set(key, geometry);
  }
  return geometry;
}

/**
 * Re-averages normals of vertices that share a position, hiding the UV seam
 * crease that SphereGeometry/LatheGeometry leave after vertex deformation.
 */
export function smoothSeams(geometry: THREE.BufferGeometry) {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const groups = new Map<string, number[]>();
  for (let i = 0; i < position.count; i += 1) {
    const key = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const sum = new THREE.Vector3();
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    sum.set(0, 0, 0);
    for (const i of indices) sum.add(new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i)));
    sum.normalize();
    for (const i of indices) normal.setXYZ(i, sum.x, sum.y, sum.z);
  }
  normal.needsUpdate = true;
  return geometry;
}

/**
 * A sphere whose unit-space vertices are reshaped by `deform` and then scaled.
 * `deform` receives and returns a point on/around the unit sphere.
 */
export function deformedSphere(
  radius: number,
  widthSegments: number,
  heightSegments: number,
  deform: (p: THREE.Vector3) => THREE.Vector3,
  scale: [number, number, number] = [1, 1, 1]
) {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const position = geometry.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i);
    const q = deform(p.clone());
    position.setXYZ(i, q.x * radius * scale[0], q.y * radius * scale[1], q.z * radius * scale[2]);
  }
  position.needsUpdate = true;
  return smoothSeams(geometry);
}

/** A rounded, tapered capsule along +y from 0 to `length` (bottom radius r0, top radius r1). */
export function limbGeometry(length: number, r0: number, r1: number, radial = 18) {
  const points: THREE.Vector2[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i += 1) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.cos(a) * r1, length + Math.sin(a) * r1));
  }
  points[0].x = 0.0001;
  points[points.length - 1].x = 0.0001;
  return smoothSeams(new THREE.LatheGeometry(points, radial));
}

/** Position + rotation that stand a +y limb between two points. */
export function limbTransform(from: THREE.Vector3Tuple, to: THREE.Vector3Tuple) {
  const start = new THREE.Vector3(...from);
  const direction = new THREE.Vector3(...to).sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return { position: start, quaternion, length };
}

/**
 * A tube along `curve` whose radius varies with t ∈ [0, 1], closed with a
 * rounded cap at the end. UV x runs along the length, so stripes are rings.
 */
export function variableTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radialSegments: number,
  radiusAt: (t: number) => number
) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const capRings = 5;
  const rings = segments + capRings;

  for (let i = 0; i <= rings; i += 1) {
    const isCap = i > segments;
    const t = isCap ? 1 : i / segments;
    const frameIndex = Math.min(i, segments);
    curve.getPointAt(t, point);
    let radius = radiusAt(t);
    if (isCap) {
      // Hemispherical cap: step forward along the tangent while shrinking.
      const a = ((i - segments) / capRings) * (Math.PI / 2);
      point.addScaledVector(frames.tangents[segments], Math.sin(a) * radius);
      radius *= Math.cos(a);
    }
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      offset
        .copy(frames.normals[frameIndex])
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(frames.binormals[frameIndex], Math.sin(angle))
        .multiplyScalar(Math.max(radius, 0.0005));
      positions.push(point.x + offset.x, point.y + offset.y, point.z + offset.z);
      uvs.push(i / rings, j / radialSegments);
    }
  }
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return smoothSeams(geometry);
}

/** Smooth bump: 1 at 0, falling to ~0 at |x| ≈ 2·width. */
export function bump(x: number, width: number) {
  return Math.exp(-((x / width) ** 2));
}
