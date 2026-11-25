import type { PetFrame } from './usePetAnimation';

/** Served from public/pets/developer-cat/ (see the README there for the art spec). */
const BASE = '/pets/developer-cat/';

/**
 * Raster frames that actually exist. Add an entry only after its file is in
 * public/pets/developer-cat/, e.g. `idle: 'idle.webp'`. Any frame not listed
 * here is drawn by the built-in SVG character, so partial art sets are fine.
 * Images load lazily: a frame is fetched the first time it is shown.
 */
const AVAILABLE: Partial<Record<PetFrame, string>> = {};

export function developerCatAsset(frame: PetFrame): string | null {
  const file = AVAILABLE[frame];
  return file ? BASE + file : null;
}
