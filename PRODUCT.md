# Nottli

<!-- impeccable:product-schema 1 -->

## Platform

windows

## Stack

Tauri 2, React, TypeScript, Vite, Rust, Zustand, SQLite, Tailwind CSS, and Rive. Greenfield implementation delegated to Codex within the supplied brief.

## Users

An individual Windows user who wants a lightweight note-taking companion and productivity launcher available while they work.

## Product Purpose

Nottli is an animated desktop companion that makes capturing a thought and launching a useful action feel immediate, warm, and low-friction. Your thoughts, always within reach. Success means a user can capture a note in seconds without leaving their current workflow.

## Positioning

The product combines a persistent, expressive desktop character with offline-first notes and a command palette, so utility is always one small interaction away without becoming a full workspace window.

## Operating Context

The mascot floats above the Windows desktop. The user may open a quick note, dashboard, notes library, or command palette with global shortcuts and may continue working while the companion remains available.

## Capabilities and Constraints

- Transparent, frameless, floating mascot window.
- Character states: idle, thinking, curious, writing, happy, and sleeping.
- Quick notes autosave locally to SQLite.
- Global shortcuts, command palette, system tray, startup option, saved position, and user preferences.
- Separate dashboard, notes, mascot, and command-palette windows.
- Secure Tauri capabilities with minimum permissions.
- This first slice should prove the mascot and quick-note interaction before the remaining windows and native integrations are added.
- The real Rive character asset, final shortcut map, and startup policy remain open implementation decisions until the native slice is wired.

## Evidence on Hand

Only the supplied product brief is available. No mascot artwork, Rive state machine, copy library, or persisted user data exists yet. Do not fabricate product claims or live integrations.

## Product Principles

- Capture before context switching.
- Playfulness should make utility easier, not louder.
- Offline-first and local by default.
- Every state should communicate what the companion is doing.
- Native Windows behavior should feel quiet and respectful of resources.

## Accessibility & Inclusion

Keyboard access, visible focus, readable contrast, reduced-motion support, and text alternatives for mascot state are required for the interactive surfaces.
