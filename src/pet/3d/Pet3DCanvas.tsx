import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PetState } from '../usePetAnimation';
import { CAMERA } from './constants';
import { DeveloperCat, type LocomotionPreview } from './DeveloperCat';

export type Pet3DCanvasProps = {
  state: PetState;
  blinking: boolean;
  reducedMotion: boolean;
  /** Dev gallery only: render a fixed locomotion sample. */
  preview?: LocomotionPreview;
  /** Called if the WebGL context is lost so the caller can fall back to the SVG cat. */
  onFailure: () => void;
  /** 'head' frames just the face for small marks such as the workspace header. */
  framing?: 'full' | 'head';
};

// The header mark has only a 32px canvas. Keep the full head and headphones
// inside that canvas instead of clipping the top-left silhouette.
const HEAD_CAMERA = { position: [0, 1.5, 4.0] as [number, number, number], target: [0, 1.4, 0] as [number, number, number] };

const moduleLoadedAt = performance.now();

/**
 * Development-only instrumentation, read over DevTools when measuring:
 * `__doodleStats.frames()` counts actual WebGL renders, so an idle cat should
 * leave it unchanged; timings are milliseconds since navigation start.
 */
function exposeDevStats(gl: THREE.WebGLRenderer) {
  const createdAt = performance.now();
  let firstFrameAt: number | null = null;
  const render = gl.render.bind(gl);
  let frames = 0;
  gl.render = (scene, camera) => {
    render(scene, camera);
    frames += 1;
    firstFrameAt ??= performance.now();
  };
  (window as unknown as { __doodleStats: unknown }).__doodleStats = {
    frames: () => frames,
    timings: () => ({ moduleLoadedAt, canvasCreatedAt: createdAt, firstFrameAt }),
    info: () => ({ ...gl.info.memory, programs: gl.info.programs?.length, calls: gl.info.render.calls, triangles: gl.info.render.triangles })
  };
}

/** Supersample a little: the pet is tiny, so extra pixels cost almost nothing and smooth every edge. */
function pixelRatio() {
  return Math.min(window.devicePixelRatio * 1.5, 4);
}

/**
 * A small studio environment (generated once, ~30 ms) so glossy parts — cornea,
 * glasses, headphones, nose — pick up believable reflections. Fur and fabric use
 * low envMapIntensity, so it mostly adds soft fill there.
 */
function StudioEnvironment() {
  const gl = useThree((three) => three.gl);
  const scene = useThree((three) => three.scene);
  const invalidate = useThree((three) => three.invalidate);
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.26;
    room.dispose();
    generator.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#f6f2ea', '#4a4440', 0.8]} />
      {/* Warm key from the upper front-left. */}
      <directionalLight position={[-2.5, 4, 4.5]} intensity={2.3} color="#fff3e4" />
      {/* Cool fill from the right keeps the dark hoodie readable. */}
      <directionalLight position={[3.5, 1.5, 2.5]} intensity={0.8} color="#dfe8ff" />
      {/* Rim from behind separates the silhouette from any desktop; the fabric sheen catches it on the hoodie. */}
      <directionalLight position={[1.5, 3, -4.5]} intensity={2.8} color="#ffffff" />
      <directionalLight position={[-2.5, 2, -3.5]} intensity={1.4} color="#e8eeff" />
    </>
  );
}

/**
 * Transparent, demand-rendered canvas. Nothing renders while the cat is still;
 * DeveloperCat requests frames only while a pose transition is in progress.
 */
export default function Pet3DCanvas({ state, blinking, reducedMotion, preview, onFailure, framing = 'full' }: Pet3DCanvasProps) {
  const [dpr, setDpr] = useState(pixelRatio);
  const view = framing === 'head' ? HEAD_CAMERA : CAMERA;

  // Moving the pet to a monitor with a different scale factor changes devicePixelRatio.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const update = () => setDpr(pixelRatio());
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [dpr]);

  return (
    <Canvas
      className="pet-canvas"
      frameloop="demand"
      dpr={dpr}
      flat={false}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true }}
      // A tight near/far range around the cat (~5–7.5 units away) keeps depth precision high
      // enough for layered details like iris-on-eyeball, even with 16-bit depth buffers.
      camera={{ fov: CAMERA.fov, position: view.position, near: 2, far: 12 }}
      style={{ pointerEvents: 'none' }}
      onCreated={({ gl, camera }) => {
        if (import.meta.env.DEV) exposeDevStats(gl);
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.05;
        camera.lookAt(...view.target);
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onFailure();
        });
      }}
    >
      <StudioEnvironment />
      <Lights />
      <DeveloperCat state={state} blinking={blinking} reducedMotion={reducedMotion} preview={preview} headCamera={framing === 'head' ? HEAD_CAMERA : undefined} />
    </Canvas>
  );
}
