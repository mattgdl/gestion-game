/**
 * Bruit de valeur (value noise) déterministe, pour générer forêts, roches et fertilité.
 * Uniquement des additions, multiplications et Math.floor : résultat identique
 * sur tous les navigateurs (pas de Math.sin / Math.log, dont la précision varie).
 */
import { hash3 } from "./rng";

function lattice(seed: number, x: number, y: number): number {
  return hash3(seed, x, y) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bruit lisse dans [0, 1]. */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Somme de plusieurs octaves de bruit (relief plus naturel), dans [0, 1]. */
export function fbm(seed: number, x: number, y: number, octaves = 4, persistence = 0.5): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise((seed + Math.imul(i + 1, 1013904223)) >>> 0, x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }
  return sum / norm;
}
