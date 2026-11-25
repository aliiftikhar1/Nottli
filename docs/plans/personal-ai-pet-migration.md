# Personal AI Desktop Pet Migration Plan

## Current baseline

The existing implementation is a small React/Vite first slice inside a Tauri 2 shell.

- `src/App.tsx` owns one dashboard-like surface with rail navigation, mascot, and quick note.
- `src/components/Mascot.tsx` is a CSS-rendered placeholder with state classes for `idle`, `thinking`, `curious`, `writing`, `happy`, and `sleeping`.
- `src/store/useCompanionStore.ts` is the existing state seam. Note text and mascot state are in memory only.
- `src/components/QuickNote.tsx` debounces a local Zustand save indicator; it does not yet write to SQLite.
- `@rive-app/react-canvas` is already a dependency, but there is no Rive component, `.riv` asset, or state-machine adapter.
- `src-tauri/tauri.conf.json` has one frameless, transparent, always-on-top-capable window. It is not yet a corner-pet window and does not persist position.
- `tauri-plugin-sql` and `src-tauri/migrations/001_notes.sql` exist, but no database connection or Rust note commands are wired.
- Capabilities currently grant `core:default` and `sql:default` to `main`; tray, global shortcuts, startup, shell, notifications, and window persistence are not present.
- The current production gate is TypeScript plus Vite build. Windows runtime validation has not been completed.

## Preservation rules

1. Keep `useCompanionStore` as the UI state boundary; extend it rather than replacing it.
2. Keep `Mascot` as the rendering contract. The CSS mascot becomes a fallback/diagnostic renderer until the Rive or Three.js renderer has passed its acceptance gate.
3. Keep `QuickNote` as the interaction surface; move its save side effect behind a persistence service instead of rewriting its UX.
4. Keep Tauri permissions narrow and add one capability only when the corresponding feature is implemented.
5. Keep every milestone buildable and testable on its own.
6. Do not add Three.js, React Three Fiber, Blender/GLB assets, AI SDKs, notification plugins, or startup/tray plugins until the milestone that consumes each dependency is approved and scoped.

## Milestones

### M1 — Pet rendering contract and state model

Create a typed `MascotRenderer` interface and a `MascotState` controller that supports breathing, blinking, notification reaction, and the existing six states without changing note behavior. Keep the CSS renderer as the default. Add reduced-motion and visibility-aware animation rules.

Acceptance: `pnpm run build` passes; all state transitions are reachable from a small local test harness; no new runtime dependency.

### M2 — Native Windows pet behavior

Prioritize actual desktop behavior over an intermediate Rive renderer. Add reliable drag handling, physical-position persistence, monitor-aware clamping, always-on-top preference, transparent-area hit rules, tray show/hide/exit actions, and opt-in Windows startup registration. Preserve the M1 renderer contract and keep CSS as the current renderer. Rive remains optional and is not a prerequisite for the final Three.js/GLB direction.

Acceptance: the Tauri Windows runtime can drag and restore the window, preserve an always-on-top preference, show/hide/exit from the tray, clamp saved positions across available monitors and DPI scales, and enable/disable startup without affecting notes or mascot animation.

### M3 — Actual local note persistence

Introduce a small TypeScript persistence service using the existing Tauri SQL plugin and migration. Add Rust/Tauri commands only for operations that need native control. Store note body, timestamps, and future reminder metadata. Keep an in-memory fallback for browser development.

Acceptance: create, update, reload, and list notes in the Tauri Windows runtime; browser development remains usable; failures show recoverable UI copy.

### M4 — 3D creature spike

Evaluate Three.js + React Three Fiber with a deliberately small optimized GLB test creature. Keep the M1 CSS renderer as fallback. Rive may be evaluated as an optional alternative, but it is not a required intermediate step. Prefer capped DPR, paused rendering when occluded, and an animation controller that maps product states to clips.

Acceptance: compare the 3D renderer against CSS on startup time, idle CPU/GPU, memory, bundle size, input latency, and state fidelity before selecting the production renderer.

### M5 — Personal companion features

Add reminders, scheduled notifications, natural-language reminder creation, note retrieval, summarization, and daily briefings one at a time. Keep AI provider access behind a separate service boundary, with explicit privacy and offline behavior. No cloud AI dependency belongs in the pet renderer.

Acceptance: each feature has a local data model, a user-visible failure path, a privacy explanation, and an isolated test path.

## Dependency policy

- Preserve React, Vite, TypeScript, Zustand, Tailwind, Tauri, SQLite, and Rive.
- Do not add Three.js/R3F until M6 has a written comparison target and asset plan.
- Do not add an AI SDK until an AI feature milestone defines provider, data flow, consent, and fallback behavior.
- Prefer Tauri official plugins and least-privilege capabilities for tray, shortcuts, notifications, and startup.

## Immediate next implementation slice

M2 is the native Windows shell slice. M3 is actual local note persistence. The 3D creature spike follows those foundations; no Three.js, GLB, or AI dependency is introduced before its own milestone.
