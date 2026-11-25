import * as THREE from 'three';
import { PALETTE } from './constants';

/*
 * Canvas-generated textures and shared materials. Everything is created lazily
 * on first use and cached, so the pet allocates each texture exactly once.
 * Textures stay small (≤ 512 px): the pet renders at roughly 100–250 device pixels.
 *
 * Fur is painted as directional strands (colour) with a matching strand height
 * map (bump), which reads as fur at small sizes without any hair geometry.
 */

/** Deterministic PRNG so the fur pattern is identical on every launch. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');
  return { element, ctx: context };
}

function toTexture(element: HTMLCanvasElement, { color = true, repeatX = false } = {}) {
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 4;
  if (repeatX) texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number, bump: boolean) => void;

/** Paints the same layout twice (colour + bump) so strands line up in both maps. */
function furMaps(key: string, w: number, h: number, paint: Paint, repeatX = false) {
  const color = cachedTexture(`${key}-color`, () => {
    const { element, ctx } = canvas(w, h);
    paint(ctx, w, h, false);
    return toTexture(element, { repeatX });
  });
  const bump = cachedTexture(`${key}-bump`, () => {
    const { element, ctx } = canvas(w, h);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    paint(ctx, w, h, true);
    return toTexture(element, { color: false, repeatX });
  });
  return { color, bump };
}

/**
 * Short, slightly curved fur strands following a flow direction.
 * `angleAt` returns the growth direction (radians, canvas space) at a point.
 */
function strands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  bump: boolean,
  { density = 1, minLength = 3, maxLength = 7, angleAt = () => Math.PI / 2, tint = 1 }: {
    density?: number;
    minLength?: number;
    maxLength?: number;
    angleAt?: (x: number, y: number) => number;
    tint?: number;
  } = {}
) {
  const random = rng(seed);
  const count = Math.round(((w * h) / 12) * density);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i += 1) {
    const x = random() * w;
    const y = random() * h;
    const length = minLength + random() * (maxLength - minLength);
    const a = angleAt(x, y) + (random() - 0.5) * 0.5;
    const curl = (random() - 0.5) * 0.6;
    const light = random() > 0.45;
    if (bump) {
      ctx.strokeStyle = light ? `rgba(255,255,255,${0.22 + random() * 0.2})` : `rgba(0,0,0,${0.18 + random() * 0.15})`;
    } else {
      // Light strands are kept fainter than dark ones so fur gains texture without washing out.
      ctx.strokeStyle = light
        ? `rgba(255,255,255,${(0.04 + random() * 0.07) * tint})`
        : `rgba(28,30,36,${(0.06 + random() * 0.1) * tint})`;
    }
    ctx.lineWidth = 0.5 + random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const mx = x + Math.cos(a) * length * 0.5;
    const my = y + Math.sin(a) * length * 0.5;
    ctx.quadraticCurveTo(mx + Math.cos(a + Math.PI / 2) * curl * length, my + Math.sin(a + Math.PI / 2) * curl * length, x + Math.cos(a) * length, y + Math.sin(a) * length);
    ctx.stroke();
  }
}

/** Large, very soft blotches that break up flat colour (fur is never one tone). */
function mottle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, strength = 1) {
  const random = rng(seed);
  for (let i = 0; i < 40; i += 1) {
    const x = random() * w;
    const y = random() * h;
    const r = 8 + random() * 26;
    const light = random() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, light ? `rgba(255,255,255,${0.08 * strength})` : `rgba(40,42,48,${0.07 * strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Soft, broken tabby bands (gaps and varying width, like real markings). */
function tabbyBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  { count, from = 0, to = 1, width = 7, alpha = 0.42, vertical = false, blur = 2.6 }: {
    count: number;
    from?: number;
    to?: number;
    width?: number;
    alpha?: number;
    vertical?: boolean;
    blur?: number;
  }
) {
  const random = rng(seed);
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.lineCap = 'round';
  const length = vertical ? h : w;
  const steps = 48;
  for (let i = 0; i < count; i += 1) {
    const base = from + ((i + 0.5) / count) * (to - from);
    const phase = random() * Math.PI * 2;
    let drawing = false;
    for (let s = 0; s <= steps; s += 1) {
      // Occasional gaps make the band look like fur markings, not paint.
      const visible = Math.sin(phase * 3 + s * 0.45) > -0.75;
      const along = (s / steps) * length;
      const across = base * (vertical ? w : h) + Math.sin(phase + s * 0.5) * 3.5;
      const [x, y] = vertical ? [across, along] : [along, across];
      if (visible && !drawing) {
        ctx.strokeStyle = `rgba(56,59,66,${alpha * (0.7 + random() * 0.3)})`;
        ctx.lineWidth = width * (0.65 + random() * 0.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        drawing = true;
      } else if (visible) {
        ctx.lineTo(x, y);
      } else if (drawing) {
        ctx.stroke();
        drawing = false;
      }
    }
    if (drawing) ctx.stroke();
  }
  ctx.restore();
}

const textures = new Map<string, THREE.Texture>();
function cachedTexture(key: string, build: () => THREE.Texture) {
  let value = textures.get(key);
  if (!value) {
    value = build();
    textures.set(key, value);
  }
  return value;
}

/** Body and haunches: silver tabby, fading to white underneath (v = 0 is the bottom). */
export function bodyFurMaps() {
  return furMaps('fur-body', 256, 256, (ctx, w, h, bump) => {
    if (!bump) {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, PALETTE.furSilverLight);
      gradient.addColorStop(0.55, PALETTE.furSilver);
      gradient.addColorStop(0.8, '#cdd0d5');
      gradient.addColorStop(1, PALETTE.furWhite);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      mottle(ctx, w, h, 13);
      tabbyBands(ctx, w, h, 11, { count: 5, from: 0.08, to: 0.72, width: 11, alpha: 0.56 });
    }
    strands(ctx, w, h, 12, bump, { angleAt: () => Math.PI / 2 });
  }, true);
}

/**
 * Head fur mapped on a sphere (u = longitude, front at u = 0.25; v = latitude).
 * Fur flows down from the crown and sweeps outward over the cheeks.
 */
export function headFurMaps() {
  return furMaps('fur-head', 512, 256, (ctx, W, H, bump) => {
    if (!bump) {
      ctx.fillStyle = PALETTE.furSilver;
      ctx.fillRect(0, 0, W, H);
      const crown = ctx.createLinearGradient(0, 0, 0, H);
      crown.addColorStop(0, 'rgba(150,154,162,0.55)');
      crown.addColorStop(0.5, 'rgba(216,219,224,0)');
      ctx.fillStyle = crown;
      ctx.fillRect(0, 0, W, H);
      mottle(ctx, W, H, 23, 0.8);

      const random = rng(21);
      ctx.save();
      ctx.filter = 'blur(1.8px)';
      ctx.lineCap = 'round';
      // Forehead "M": narrow streaks between and above the eyes, fading over the crown.
      for (let i = 0; i < 7; i += 1) {
        const u = 0.25 + (i - 3) * 0.021;
        const centre = 1 - Math.abs(i - 3) / 4;
        const length = H * (0.27 + 0.13 * centre);
        const streak = ctx.createLinearGradient(0, H * 0.05, 0, length);
        streak.addColorStop(0, 'rgba(62,65,72,0)');
        streak.addColorStop(0.4, `rgba(58,61,68,${0.5 + 0.16 * centre})`);
        streak.addColorStop(1, 'rgba(62,65,72,0.04)');
        ctx.strokeStyle = streak;
        ctx.lineWidth = 2.6 + centre * 1.4;
        ctx.beginPath();
        ctx.moveTo(u * W, H * 0.05);
        ctx.quadraticCurveTo(u * W + (random() - 0.5) * 5, length * 0.55, u * W + (i - 3) * 1.6, length);
        ctx.stroke();
      }
      // Broken bands over the back of the head.
      for (let i = 0; i < 9; i += 1) {
        const u = (0.45 + i * 0.07) % 1;
        ctx.strokeStyle = `rgba(66,69,76,${0.14 + random() * 0.1})`;
        ctx.lineWidth = 4 + random() * 3;
        ctx.beginPath();
        ctx.moveTo(u * W, H * 0.08);
        ctx.lineTo(u * W + (random() - 0.5) * 10, H * (0.3 + random() * 0.15));
        ctx.stroke();
      }
      // "Mascara" lines from each outer eye corner, plus a cheek stripe below.
      for (const [outer, direction] of [
        [0.343, 1],
        [0.157, -1]
      ] as const) {
        ctx.strokeStyle = 'rgba(52,55,62,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(outer * W, H * 0.49);
        ctx.quadraticCurveTo((outer + direction * 0.04) * W, H * 0.475, (outer + direction * 0.1) * W, H * 0.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(58,61,68,0.42)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo((outer + direction * 0.005) * W, H * 0.57);
        ctx.quadraticCurveTo((outer + direction * 0.06) * W, H * 0.6, (outer + direction * 0.12) * W, H * 0.57);
        ctx.stroke();
      }
      ctx.restore();

      // White lower face, muzzle and chin: a feathered ellipse, wider than tall.
      ctx.save();
      ctx.translate(0.25 * W, 0.7 * H);
      ctx.scale(1.7, 1);
      const face = ctx.createRadialGradient(0, 0, 4, 0, 0, 0.125 * W);
      face.addColorStop(0, 'rgba(246,244,240,1)');
      face.addColorStop(0.55, 'rgba(246,244,240,0.9)');
      face.addColorStop(0.8, 'rgba(232,233,236,0.45)');
      face.addColorStop(1, 'rgba(232,233,236,0)');
      ctx.fillStyle = face;
      ctx.fillRect(-W, -H, W * 2, H * 2);
      ctx.restore();
      // Pale blaze between the eyes and pale fur under each eye.
      for (const [u, v, r] of [
        [0.25, 0.5, 0.035],
        [0.176, 0.55, 0.03],
        [0.324, 0.55, 0.03]
      ] as const) {
        const g = ctx.createRadialGradient(u * W, v * H, 1, u * W, v * H, r * W);
        g.addColorStop(0, 'rgba(232,233,236,0.75)');
        g.addColorStop(1, 'rgba(232,233,236,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // Darker rims around the eyes.
      for (const u of [0.176, 0.324]) {
        const rim = ctx.createRadialGradient(u * W, 0.47 * H, 6, u * W, 0.47 * H, 18);
        rim.addColorStop(0, 'rgba(40,40,44,0)');
        rim.addColorStop(0.55, 'rgba(40,40,44,0.38)');
        rim.addColorStop(1, 'rgba(40,40,44,0)');
        ctx.fillStyle = rim;
        ctx.fillRect(0, 0, W, H);
      }
    }
    // Flow: straight down at the face centre, sweeping outward over the cheeks and back.
    strands(ctx, W, H, 22, bump, {
      density: 0.9,
      angleAt: (x) => {
        const offset = ((x / W - 0.25 + 1.5) % 1) - 0.5;
        return Math.PI / 2 - Math.max(-1, Math.min(1, offset * 3)) * 0.9;
      }
    });
  }, true);
}

/** Tail: irregular soft rings along the length (u), strands along the tail, dark tip. */
export function tailFurMaps() {
  return furMaps('fur-tail', 256, 64, (ctx, w, h, bump) => {
    if (!bump) {
      ctx.fillStyle = PALETTE.furSilverLight;
      ctx.fillRect(0, 0, w, h);
      mottle(ctx, w, h, 33, 0.7);
      tabbyBands(ctx, w, h, 31, { count: 7, from: 0.06, to: 0.84, width: 12, alpha: 0.6, vertical: true, blur: 2.2 });
      const tip = ctx.createLinearGradient(w * 0.82, 0, w, 0);
      tip.addColorStop(0, 'rgba(47,49,56,0)');
      tip.addColorStop(0.4, 'rgba(47,49,56,0.92)');
      tip.addColorStop(1, 'rgba(40,42,48,1)');
      ctx.fillStyle = tip;
      ctx.fillRect(0, 0, w, h);
    }
    strands(ctx, w, h, 32, bump, { angleAt: () => 0, minLength: 4, maxLength: 9 });
  });
}

/** White fur: paws, muzzle, chest. Faint cool shadowing so it never looks like plastic. */
export function whiteFurMaps() {
  return furMaps('fur-white', 128, 128, (ctx, w, h, bump) => {
    if (!bump) {
      ctx.fillStyle = PALETTE.furWhite;
      ctx.fillRect(0, 0, w, h);
      mottle(ctx, w, h, 43, 0.6);
    }
    strands(ctx, w, h, 41, bump, { tint: 0.7, minLength: 2, maxLength: 5 });
  }, true);
}

/** Warm amber iris: limbal ring, collarette, radial fibres, crypts, gold flecks, soft oval pupil. */
export function irisTexture() {
  return cachedTexture('iris', () => {
    const S = 256;
    const c = S / 2;
    const { element, ctx } = canvas(S, S);
    const base = ctx.createRadialGradient(c, c, 10, c, c, c);
    base.addColorStop(0, '#8a4512');
    base.addColorStop(0.24, '#cf7a1f');
    base.addColorStop(0.5, '#f2b347');
    base.addColorStop(0.78, '#e39a35');
    base.addColorStop(0.9, '#a8581a');
    base.addColorStop(1, '#2e1707');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    const random = rng(51);
    // Radial fibres.
    for (let i = 0; i < 260; i += 1) {
      const a = random() * Math.PI * 2;
      const r0 = 26 + random() * 12;
      const r1 = 70 + random() * 50;
      ctx.strokeStyle = random() > 0.45 ? `rgba(255,222,150,${0.12 + random() * 0.16})` : `rgba(96,44,10,${0.12 + random() * 0.14})`;
      ctx.lineWidth = 0.7 + random() * 1.1;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a + (random() - 0.5) * 0.08) * r1, c + Math.sin(a) * r1);
      ctx.stroke();
    }
    // Crypts: small darker pockets in the mid iris.
    for (let i = 0; i < 26; i += 1) {
      const a = random() * Math.PI * 2;
      const r = 48 + random() * 40;
      ctx.fillStyle = `rgba(110,52,12,${0.18 + random() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 2 + random() * 3, 1 + random() * 1.5, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // Gold flecks.
    for (let i = 0; i < 30; i += 1) {
      const a = random() * Math.PI * 2;
      const r = 40 + random() * 60;
      ctx.fillStyle = `rgba(255,226,140,${0.3 + random() * 0.3})`;
      ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.5, 1.5);
    }
    // Collarette: a soft zig-zag ring around the pupil zone.
    ctx.strokeStyle = 'rgba(255,214,130,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = 0; s <= 72; s += 1) {
      const a = (s / 72) * Math.PI * 2;
      const r = 42 + (s % 2 ? 3 : -3);
      if (s === 0) ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      else ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    ctx.stroke();
    // Limbal ring.
    ctx.strokeStyle = 'rgba(40,20,6,0.85)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.stroke();
    // Pupil: a soft vertical oval.
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = '#0a0604';
    ctx.beginPath();
    ctx.ellipse(c, c, 22, 33, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return toTexture(element);
  });
}

export function innerEarTexture() {
  return cachedTexture('inner-ear', () => {
    const { element, ctx } = canvas(64, 64);
    const g = ctx.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, '#f2bcbc');
    g.addColorStop(0.7, PALETTE.innerEar);
    g.addColorStop(1, '#d99a9d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    // Pale furnishings rising from the base of the ear.
    const random = rng(61);
    ctx.lineCap = 'round';
    for (let i = 0; i < 55; i += 1) {
      const x = 14 + random() * 36;
      ctx.strokeStyle = `rgba(255,252,248,${0.35 + random() * 0.45})`;
      ctx.lineWidth = 0.8 + random();
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.quadraticCurveTo(x + (random() - 0.5) * 8, 44, x + (random() - 0.5) * 12, 64 - 20 - random() * 26);
      ctx.stroke();
    }
    return toTexture(element);
  });
}

/**
 * Charcoal jersey knit. Colour carries the knit and faint wear; the bump map adds
 * the knit plus soft folds; roughness varies so light breaks up across the fabric.
 */
function hoodieMaps() {
  const paintKnit = (ctx: CanvasRenderingContext2D, light: string, dark: string, seed: number) => {
    const random = rng(seed);
    for (let y = 0; y < 256; y += 3) {
      for (let x = 0; x < 256; x += 3) {
        ctx.fillStyle = random() > 0.5 ? light : dark;
        ctx.fillRect(x + (y % 6 ? 1 : 0), y, 1, 2);
      }
    }
  };
  const color = cachedTexture('hoodie-color', () => {
    const { element, ctx } = canvas(256, 256);
    ctx.fillStyle = PALETTE.hoodie;
    ctx.fillRect(0, 0, 256, 256);
    mottle(ctx, 256, 256, 72, 0.6);
    paintKnit(ctx, 'rgba(255,255,255,0.035)', 'rgba(0,0,0,0.05)', 71);
    return toTexture(element, { repeatX: true });
  });
  const bump = cachedTexture('hoodie-bump', () => {
    const { element, ctx } = canvas(256, 256);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    // Folds: soft horizontal creases where the fabric bunches above the hem, plus drape.
    const random = rng(74);
    ctx.save();
    ctx.filter = 'blur(5px)';
    for (let i = 0; i < 9; i += 1) {
      const y = 140 + random() * 110;
      ctx.strokeStyle = `rgba(0,0,0,${0.35 + random() * 0.25})`;
      ctx.lineWidth = 4 + random() * 5;
      ctx.beginPath();
      const x0 = random() * 256;
      ctx.moveTo(x0, y);
      ctx.quadraticCurveTo(x0 + 30, y - 8 + random() * 16, x0 + 60 + random() * 40, y + (random() - 0.5) * 14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y - 6);
      ctx.quadraticCurveTo(x0 + 30, y - 14 + random() * 16, x0 + 60 + random() * 40, y - 6);
      ctx.stroke();
    }
    ctx.restore();
    paintKnit(ctx, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.3)', 73);
    return toTexture(element, { color: false, repeatX: true });
  });
  const roughness = cachedTexture('hoodie-roughness', () => {
    const { element, ctx } = canvas(64, 64);
    const random = rng(75);
    for (let y = 0; y < 64; y += 4) {
      for (let x = 0; x < 64; x += 4) {
        const v = Math.round(205 + random() * 50); // 0.8–1.0 roughness
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }
    const texture = toTexture(element, { color: false, repeatX: true });
    texture.magFilter = THREE.LinearFilter;
    return texture;
  });
  return { color, bump, roughness };
}

/** Ribbed knit for hem and cuffs (ribs run across the band). */
function ribTexture() {
  return cachedTexture('rib', () => {
    const { element, ctx } = canvas(64, 16);
    ctx.fillStyle = PALETTE.hoodieRib;
    ctx.fillRect(0, 0, 64, 16);
    for (let x = 0; x < 64; x += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, 0, 1.5, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 2, 0, 1, 16);
    }
    const texture = toTexture(element, { repeatX: true });
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(14, 1);
    return texture;
  });
}

/** Dashed orange stitching, repeated along a seam; transparent gaps via alphaTest. */
function stitchTexture() {
  return cachedTexture('stitch', () => {
    const { element, ctx } = canvas(32, 4);
    ctx.clearRect(0, 0, 32, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(2, 0, 18, 4);
    const texture = toTexture(element, { repeatX: true });
    texture.repeat.set(70, 1);
    return texture;
  });
}

// ---------------------------------------------------------------- materials

const materials = new Map<string, THREE.Material>();
function material<T extends THREE.Material>(key: string, build: () => T): T {
  let value = materials.get(key) as T | undefined;
  if (!value) {
    value = build();
    materials.set(key, value);
  }
  return value;
}

/** Fur: rough, with sheen for the soft light-catching rim and a strand bump map. */
function fur(maps: { color: THREE.Texture; bump: THREE.Texture }, sheenColor = '#d3d7de') {
  return new THREE.MeshPhysicalMaterial({
    map: maps.color,
    bumpMap: maps.bump,
    bumpScale: 1.2,
    roughness: 0.9,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(sheenColor),
    envMapIntensity: 0.22
  });
}

export const MATERIALS = {
  bodyFur: () => material('bodyFur', () => fur(bodyFurMaps())),
  headFur: () => material('headFur', () => fur(headFurMaps())),
  tailFur: () => material('tailFur', () => fur(tailFurMaps())),
  whiteFur: () => material('whiteFur', () => fur(whiteFurMaps(), '#ffffff')),
  silverFur: () =>
    material('silverFur', () => {
      const maps = bodyFurMaps();
      return fur({ color: maps.color, bump: maps.bump });
    }),
  lidFur: () => material('lidFur', () => new THREE.MeshStandardMaterial({ color: '#c3c6cc', roughness: 0.85, envMapIntensity: 0.3 })),
  innerEar: () =>
    material('innerEar', () => new THREE.MeshStandardMaterial({ map: innerEarTexture(), roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.3 })),
  nose: () => material('nose', () => new THREE.MeshPhysicalMaterial({ color: PALETTE.nose, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.4 })),
  mouth: () => material('mouth', () => new THREE.MeshStandardMaterial({ color: PALETTE.mouth, roughness: 0.8 })),
  whisker: () => material('whisker', () => new THREE.MeshStandardMaterial({ color: PALETTE.whisker, roughness: 0.35, emissive: '#ffffff', emissiveIntensity: 0.25 })),
  eyeDark: () => material('eyeDark', () => new THREE.MeshStandardMaterial({ color: PALETTE.eyeDark, roughness: 0.5 })),
  // A little self-illumination keeps the amber glowing even when the head turns away from the key light.
  iris: () =>
    material(
      'iris',
      () =>
        new THREE.MeshStandardMaterial({
          map: irisTexture(),
          roughness: 0.3,
          emissive: '#ffffff',
          emissiveMap: irisTexture(),
          emissiveIntensity: 0.75,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        })
    ),
  /** Clear corneal dome: almost invisible, but it carries environment reflections over the iris. */
  cornea: () =>
    material(
      'cornea',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: '#ffffff',
          roughness: 0.02,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          transparent: true,
          opacity: 0.12,
          envMapIntensity: 2.2,
          depthWrite: false
        })
    ),
  highlight: () => material('highlight', () => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })),
  eyeliner: () => material('eyeliner', () => new THREE.MeshStandardMaterial({ color: '#25211e', roughness: 0.7 })),
  lashLine: () => material('lashLine', () => new THREE.MeshStandardMaterial({ color: '#1f1b1a', roughness: 0.7 })),
  hoodie: () =>
    material('hoodie', () => {
      const maps = hoodieMaps();
      return new THREE.MeshPhysicalMaterial({
        map: maps.color,
        bumpMap: maps.bump,
        bumpScale: 2.2,
        roughnessMap: maps.roughness,
        roughness: 1,
        // Fabric sheen gives a soft, controlled rim along the silhouette, so the dark
        // hoodie separates from dark desktops without looking glossy.
        sheen: 1,
        sheenRoughness: 0.38,
        sheenColor: new THREE.Color('#7d808b'),
        envMapIntensity: 0.18,
        side: THREE.DoubleSide
      });
    }),
  hoodieRib: () =>
    material('hoodieRib', () => new THREE.MeshPhysicalMaterial({ map: ribTexture(), roughness: 0.95, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color('#8a8d98'), envMapIntensity: 0.2 })),
  stitch: () =>
    material('stitch', () => new THREE.MeshStandardMaterial({ color: PALETTE.orange, alphaMap: stitchTexture(), alphaTest: 0.5, roughness: 0.6, emissive: PALETTE.orange, emissiveIntensity: 0.25 })),
  orange: () => material('orange', () => new THREE.MeshStandardMaterial({ color: PALETTE.orange, roughness: 0.55, envMapIntensity: 0.4 })),
  orangeGlow: () =>
    material('orangeGlow', () => new THREE.MeshStandardMaterial({ color: PALETTE.orange, emissive: PALETTE.orange, emissiveIntensity: 2.2, toneMapped: false })),
  frame: () =>
    material('frame', () => new THREE.MeshPhysicalMaterial({ color: PALETTE.frame, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 })),
  lens: () =>
    material(
      'lens',
      () => new THREE.MeshPhysicalMaterial({ color: '#dfe8ff', roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.06, envMapIntensity: 1.6, depthWrite: false })
    ),
  headphone: () =>
    material('headphone', () => new THREE.MeshPhysicalMaterial({ color: PALETTE.headphone, roughness: 0.3, metalness: 0.2, clearcoat: 0.7, envMapIntensity: 1.1 })),
  cushion: () => material('cushion', () => new THREE.MeshStandardMaterial({ color: PALETTE.cushion, roughness: 0.95, envMapIntensity: 0.3 }))
};
