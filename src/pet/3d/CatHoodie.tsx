import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { BODY, torsoRadiusAt } from './constants';
import { cached, deformedSphere, smoothSeams } from './geometry';
import { MATERIALS } from './materials';
import type { CatRig } from './rig';

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

const RINGS = 41;
const RADIAL = 64;
/** Hem stitching sits 0.05 units above the hem (in the sitting profile's units). */
const HEM_STITCH_T = 0.05 / 0.8;

/** Torso buffers, allocated once; positions/normals are rewritten in place as the spine moves. */
function createTorsoGeometry() {
  const geometry = new THREE.BufferGeometry();
  const count = RINGS * (RADIAL + 1);
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(count * 2);
  const index: number[] = [];
  for (let i = 0; i < RINGS; i += 1) {
    for (let j = 0; j <= RADIAL; j += 1) {
      const k = i * (RADIAL + 1) + j;
      uv[k * 2] = j / RADIAL;
      uv[k * 2 + 1] = i / (RINGS - 1);
      if (i < RINGS - 1 && j < RADIAL) {
        const a = k;
        const b = k + 1;
        const c = k + RADIAL + 1;
        const d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2);
  return geometry;
}

const C = new THREE.Vector3();
const T = new THREE.Vector3();
const F = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const M = new THREE.Matrix4();
const NEG_F = new THREE.Vector3();
const P0 = new THREE.Vector3();
const P1 = new THREE.Vector3();

/**
 * Rewrites the torso surface around the current spine. The cross-section, drape folds
 * and hem bunching are the same formulas the original lathe used, so the sitting
 * torso is unchanged; standing, the same surface follows the horizontal spine.
 */
function updateTorso(geometry: THREE.BufferGeometry, rig: CatRig) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  for (let i = 0; i < RINGS; i += 1) {
    const t = i / (RINGS - 1);
    rig.frameAt(t, C, T, F);
    const r = rig.radius(t);
    const y = 0.3 + 0.8 * t; // height in the original sitting profile, used by the fold masks
    const drapeMask = smooth(0.3, 0.45, y) * (1 - smooth(0.78, 0.95, y));
    const bunch = 0.01 * Math.sin(y * 55) * (1 - smooth(0.36, 0.5, y));
    for (let j = 0; j <= RADIAL; j += 1) {
      const angle = (j / RADIAL) * Math.PI * 2;
      const scale = 1 + 0.014 * Math.sin(angle * 9 + y * 6) * drapeMask + bunch;
      const lateral = r * Math.sin(angle) * scale;
      const ventral = r * Math.cos(angle) * scale * rig.depth;
      const k = (i * (RADIAL + 1) + j) * 3;
      array[k] = C.x + lateral;
      array[k + 1] = C.y + F.y * ventral;
      array[k + 2] = C.z + F.z * ventral;
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  // Average the duplicated seam column so no crease shows down the back.
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const n = normal.array as Float32Array;
  for (let i = 0; i < RINGS; i += 1) {
    const a = i * (RADIAL + 1) * 3;
    const b = (i * (RADIAL + 1) + RADIAL) * 3;
    for (let c = 0; c < 3; c += 1) n[a + c] = n[b + c] = (n[a + c] + n[b + c]) / 2;
  }
  normal.needsUpdate = true;
}

/** Places a ring (torus, axis z) around the spine at t, scaled to the torso radius there. */
function placeRing(mesh: THREE.Object3D | null, rig: CatRig, t: number, radiusPlus: number, restRadius: number) {
  if (!mesh) return;
  rig.frameAt(t, C, T, F);
  NEG_F.copy(F).negate();
  mesh.position.copy(C);
  mesh.quaternion.setFromRotationMatrix(M.makeBasis(X, NEG_F, T));
  const s = (rig.radius(t) + radiusPlus) / restRadius;
  mesh.scale.set(s, s * rig.depth, s);
}

/** A spine socket: local x lateral, y along the spine, z ventral/front (identity when sitting upright). */
function placeSocket(object: THREE.Object3D | null, rig: CatRig, t: number) {
  if (!object) return;
  rig.frameAt(t, C, T, F);
  object.position.copy(C);
  object.quaternion.setFromRotationMatrix(M.makeBasis(X, T, F));
}

/** A point on the torso surface at spine position t, lateral offset x, lifted off the fabric. */
function surfacePoint(rig: CatRig, t: number, x: number, lift: number, out: THREE.Vector3) {
  rig.frameAt(t, C, T, F);
  const r = rig.radius(t);
  const ventral = Math.sqrt(Math.max(r * r - x * x, 0)) * rig.depth + lift;
  return out.copy(C).addScaledVector(F, ventral).setX(C.x + x);
}

const UP = new THREE.Vector3(0, 1, 0);
const DIR = new THREE.Vector3();
/** Stands a +y capsule of rest length `rest` between two points (scaling it to fit). */
export function placeSegment(mesh: THREE.Object3D | null, a: THREE.Vector3, b: THREE.Vector3, rest: number) {
  if (!mesh) return;
  DIR.subVectors(b, a);
  const length = DIR.length() || 1e-6;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, DIR.divideScalar(length));
  mesh.scale.set(1, length / rest, 1);
}

/** Sleeve segment along +y (0 → length), tapering; optionally bunching toward the cuff end. */
export function sleeveGeometry(length: number, r0: number, r1: number, bunchAmount = 0) {
  const points: THREE.Vector2[] = [];
  const cap = 6;
  for (let i = 0; i <= cap; i += 1) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.max(Math.cos(a) * r0, 0.0001), Math.sin(a) * r0));
  }
  const steps = 24;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const radius = r0 + (r1 - r0) * t;
    const bunch = 1 + bunchAmount * Math.sin(t * Math.PI * 7) * smooth(0.45, 0.8, t);
    points.push(new THREE.Vector2(radius * bunch, t * length));
  }
  for (let i = 0; i <= cap; i += 1) {
    const a = (i / cap) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.max(Math.cos(a) * r1, 0.0001), length + Math.sin(a) * r1));
  }
  return smoothSeams(new THREE.LatheGeometry(points, 24));
}

const HEM_RADIUS = torsoRadiusAt(BODY.hemY);
const hem = () => cached('hoodie-hem', () => new THREE.TorusGeometry(HEM_RADIUS, 0.036, 10, 64));
const collar = () => cached('hoodie-collar', () => new THREE.TorusGeometry(0.2, 0.07, 12, 40));
const hood = () =>
  cached('hoodie-hood', () =>
    deformedSphere(
      1,
      28,
      18,
      (p) => {
        // Bunched fabric: a soft fold line across the middle.
        p.y += 0.06 * Math.sin(p.x * 6) * (1 - Math.abs(p.y));
        return p;
      },
      [0.34, 0.2, 0.2]
    )
  );
const aglet = () => cached('hoodie-aglet', () => new THREE.CylinderGeometry(0.016, 0.014, 0.05, 10));
const bar = () => cached('hoodie-bar', () => new THREE.BoxGeometry(1, 1, 1));
export const stitchRing = (key: string, radius: number) => cached(`stitch-${key}`, () => new THREE.TorusGeometry(radius, 0.0055, 4, 96));
/** Unit-length drawstring segment along +y. */
const drawstringSegment = () => cached('drawstring-seg', () => new THREE.CylinderGeometry(0.011, 0.011, 1, 6, 1).translate(0, 0.5, 0));

/** Drawstring control points (spine t, lateral x, lift off the fabric), top to bottom. */
const DRAWSTRING: [number, number, number][] = [
  [(1.07 - 0.3) / 0.8, 0.075, 0.014],
  [(0.95 - 0.3) / 0.8, 0.083, 0.02],
  [(0.8 - 0.3) / 0.8, 0.09, 0.024]
];

/** A small ">_" prompt centred on the chest, in the gap the forelegs leave. */
function PromptSymbol({ socket }: { socket: RefObject<THREE.Group> }) {
  return (
    <group ref={socket} name="hoodie-symbol">
      <group rotation={[-0.12, 0, 0]} scale={1.25}>
        <mesh geometry={bar()} material={MATERIALS.orange()} position={[-0.02, 0.014, 0]} rotation={[0, 0, -0.75]} scale={[0.045, 0.014, 0.008]} />
        <mesh geometry={bar()} material={MATERIALS.orange()} position={[-0.02, -0.014, 0]} rotation={[0, 0, 0.75]} scale={[0.045, 0.014, 0.008]} />
        <mesh geometry={bar()} material={MATERIALS.orange()} position={[0.036, -0.03, 0]} scale={[0.042, 0.012, 0.008]} />
      </group>
    </group>
  );
}

/**
 * Torso, hem, collar, hood, drawstrings and chest symbol — all following the spine.
 * Sleeves live on the legs (CatLegs).
 */
export function CatHoodie({ rig }: { rig: CatRig }) {
  const torso = useMemo(createTorsoGeometry, []);
  useLayoutEffect(() => () => torso.dispose(), [torso]);
  const hemRef = useRef<THREE.Mesh>(null);
  const stitchRef = useRef<THREE.Mesh>(null);
  const neckRef = useRef<THREE.Group>(null);
  const symbolRef = useRef<THREE.Group>(null);
  const strings = useRef<(THREE.Mesh | null)[]>([]);

  useLayoutEffect(
    () =>
      rig.subscribe((r) => {
        updateTorso(torso, r);
        placeRing(hemRef.current, r, 0, 0, HEM_RADIUS);
        placeRing(stitchRef.current, r, HEM_STITCH_T, 0.004, HEM_RADIUS + 0.004);
        placeSocket(neckRef.current, r, 1);
        if (symbolRef.current) {
          placeSocket(symbolRef.current, r, (0.6 - 0.3) / 0.8);
          surfacePoint(r, (0.6 - 0.3) / 0.8, 0, 0.006, symbolRef.current.position);
        }
        // Drawstrings: two segments per side between surface points, plus the aglet.
        ([1, -1] as const).forEach((side, s) => {
          for (let k = 0; k < 2; k += 1) {
            const [ta, xa, la] = DRAWSTRING[k];
            const [tb, xb, lb] = DRAWSTRING[k + 1];
            surfacePoint(r, ta, xa * side, la, P0);
            surfacePoint(r, tb, xb * side, lb, P1);
            placeSegment(strings.current[s * 3 + k], P0, P1, 1);
          }
          const aglet = strings.current[s * 3 + 2];
          if (aglet) {
            placeSegment(aglet, P1, P0, 1);
            aglet.scale.setScalar(1);
          }
        });
      }),
    [rig, torso]
  );

  return (
    <group name="hoodie">
      <mesh name="hoodie-torso" geometry={torso} material={MATERIALS.hoodie()} frustumCulled={false} />
      <mesh ref={hemRef} name="hoodie-hem" geometry={hem()} material={MATERIALS.hoodieRib()} />
      <mesh ref={stitchRef} name="stitch-hem" geometry={stitchRing('hem', HEM_RADIUS + 0.004)} material={MATERIALS.stitch()} />
      <group ref={neckRef} name="neck-socket">
        <group name="hoodie-collar" position={[0, -0.02, 0.02]} rotation={[Math.PI / 2 - 0.35, 0, 0]} scale={[1.05, 0.92, 1]}>
          <mesh geometry={collar()} material={MATERIALS.hoodie()} />
          <mesh name="stitch-hood" geometry={stitchRing('hood', 0.268)} material={MATERIALS.stitch()} position={[0, 0, -0.012]} />
        </group>
        <mesh name="hoodie-hood" geometry={hood()} material={MATERIALS.hoodie()} position={[0, -0.07, -0.27]} rotation={[0.35, 0, 0]} />
      </group>
      {([1, -1] as const).map((side, s) => (
        <group key={side} name={side > 0 ? 'drawstring-left' : 'drawstring-right'}>
          <mesh ref={(m) => void (strings.current[s * 3] = m)} geometry={drawstringSegment()} material={MATERIALS.orange()} />
          <mesh ref={(m) => void (strings.current[s * 3 + 1] = m)} geometry={drawstringSegment()} material={MATERIALS.orange()} />
          <mesh ref={(m) => void (strings.current[s * 3 + 2] = m)} geometry={aglet()} material={MATERIALS.orange()} />
        </group>
      ))}
      <PromptSymbol socket={symbolRef} />
    </group>
  );
}
