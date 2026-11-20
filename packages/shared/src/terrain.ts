/**
 * Génération du terrain d'un fief (tuiles + fertilité).
 *
 * Fonction pure et déterministe : la même graine produit toujours le même terrain.
 * Elle est utilisée par la couche Fief (pour les fiefs possédés) et par le client
 * (pour afficher les fiefs voisins). Le terrain est continu d'un fief à l'autre :
 * les paramètres des terrains dominants se mélangent près des frontières.
 */
import terrainsJson from "@jeu/data/terrains.json";
import { fbm } from "./noise";
import { Rng, deriveSeed } from "./rng";
import { Terrain, type DominantId } from "./types";

interface DominantDef {
  nom: string;
  foret: number;
  roche: number;
  fertiliteBonus: number;
  riviere: boolean;
}

export const DOMINANTS = terrainsJson.dominants as Record<DominantId, DominantDef>;

export interface WorldDims {
  seed: number;
  fiefSize: number;
  cols: number;
  rows: number;
  /** Terrain dominant de chaque fief, index = ligne * cols + colonne. */
  dominants: DominantId[];
  /** Fief de départ du joueur : terrain adapté (centre dégagé, bois et pierre garantis). */
  startFief: { col: number; row: number } | null;
  /** Partie à plusieurs (J7) : les fiefs de départ de tous les joueurs. */
  startFiefs?: { col: number; row: number }[];
  startClearRadius: number;
  startMinForestTiles: number;
  startMinRockTiles: number;
}

export interface FiefTerrain {
  /** Terrain de chaque tuile (index = y local * taille + x local). */
  terrain: number[];
  /** Fertilité de 0 à 100. */
  fertility: number[];
}

/**
 * Seuils mesurés sur le bruit : [part des tuiles visée, seuil à dépasser].
 * Évite toute fonction mathématique imprécise (déterminisme entre navigateurs).
 */
const QUANTILES: [number, number][] = [
  [0, 1],
  [0.02, 0.7536],
  [0.05, 0.7094],
  [0.1, 0.6676],
  [0.15, 0.6373],
  [0.2, 0.6115],
  [0.25, 0.5888],
  [0.3, 0.568],
  [0.4, 0.5304],
  [0.5, 0.4941],
  [0.6, 0.459],
  [0.7, 0.4212],
  [1, 0],
];

function thresholdFor(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  for (let i = 1; i < QUANTILES.length; i++) {
    const [f1, t1] = QUANTILES[i] as [number, number];
    const [f0, t0] = QUANTILES[i - 1] as [number, number];
    if (f <= f1) {
      const k = (f - f0) / (f1 - f0);
      return t0 + (t1 - t0) * k;
    }
  }
  return 0;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Position de mélange entre deux fiefs : plateau au centre, transition près de la frontière. */
function blendT(t: number): number {
  const s = clamp((t - 0.35) / 0.3, 0, 1);
  return s * s * (3 - 2 * s);
}

interface Params {
  foret: number;
  roche: number;
  fertiliteBonus: number;
}

function dominantParams(dims: WorldDims, col: number, row: number): Params {
  const c = clamp(col, 0, dims.cols - 1);
  const r = clamp(row, 0, dims.rows - 1);
  const id = dims.dominants[r * dims.cols + c] ?? "plaines";
  const d = DOMINANTS[id];
  return { foret: d.foret, roche: d.roche, fertiliteBonus: d.fertiliteBonus };
}

/** Paramètres mélangés à la position globale (gx, gy). */
function paramsAt(dims: WorldDims, gx: number, gy: number): Params {
  const u = clamp((gx + 0.5) / dims.fiefSize - 0.5, 0, dims.cols - 1);
  const v = clamp((gy + 0.5) / dims.fiefSize - 0.5, 0, dims.rows - 1);
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const tu = blendT(u - c0);
  const tv = blendT(v - r0);
  const p00 = dominantParams(dims, c0, r0);
  const p10 = dominantParams(dims, c0 + 1, r0);
  const p01 = dominantParams(dims, c0, r0 + 1);
  const p11 = dominantParams(dims, c0 + 1, r0 + 1);
  const mix = (k: keyof Params): number => {
    const top = p00[k] + (p10[k] - p00[k]) * tu;
    const bottom = p01[k] + (p11[k] - p01[k]) * tu;
    return top + (bottom - top) * tv;
  };
  return { foret: mix("foret"), roche: mix("roche"), fertiliteBonus: mix("fertiliteBonus") };
}

export function generateFiefTerrain(dims: WorldDims, col: number, row: number): FiefTerrain {
  const S = dims.fiefSize;
  const terrain = new Array<number>(S * S).fill(Terrain.Herbe);
  const fertility = new Array<number>(S * S).fill(50);
  const seedForest = deriveSeed(dims.seed, "foret");
  const seedRock = deriveSeed(dims.seed, "roche");
  const seedFert = deriveSeed(dims.seed, "fertilite");
  const fertBase: number[] = new Array<number>(S * S).fill(0.5);

  for (let ly = 0; ly < S; ly++) {
    for (let lx = 0; lx < S; lx++) {
      const gx = col * S + lx;
      const gy = row * S + ly;
      const p = paramsAt(dims, gx, gy);
      const i = ly * S + lx;
      const nRock = fbm(seedRock, gx / 9, gy / 9, 3);
      const nForest = fbm(seedForest, gx / 14, gy / 14, 4);
      if (nRock > thresholdFor(p.roche)) terrain[i] = Terrain.Roche;
      else if (nForest > thresholdFor(p.foret)) terrain[i] = Terrain.Foret;
      const nFert = fbm(seedFert, gx / 18, gy / 18, 3);
      fertBase[i] = 0.5 + (nFert - 0.5) * 2.2 + p.fertiliteBonus;
    }
  }

  const dominant = dims.dominants[row * dims.cols + col] ?? "plaines";
  if (DOMINANTS[dominant].riviere) carveRiver(dims, col, row, terrain, fertBase);

  const isStart =
    (dims.startFief !== null && dims.startFief.col === col && dims.startFief.row === row) ||
    (dims.startFiefs ?? []).some((s) => s.col === col && s.row === row);
  if (isStart) prepareStartFief(dims, col, row, terrain);

  for (let i = 0; i < S * S; i++) {
    fertility[i] = Math.round(clamp(fertBase[i] ?? 0.5, 0.05, 1) * 100);
  }
  return { terrain, fertility };
}

/** Une rivière traverse le fief du nord au sud ; ses berges sont plus fertiles. */
function carveRiver(dims: WorldDims, col: number, row: number, terrain: number[], fert: number[]): void {
  const S = dims.fiefSize;
  const rng = new Rng(deriveSeed(dims.seed, `riviere-${col}-${row}`));
  let x = Math.floor(S * 0.3 + rng.next() * S * 0.4);
  for (let y = 0; y < S; y++) {
    const r = rng.next();
    if (r < 0.3) x -= 1;
    else if (r > 0.7) x += 1;
    x = clamp(x, 6, S - 8);
    for (let dx = 0; dx <= 1; dx++) terrain[y * S + x + dx] = Terrain.Eau;
    for (let dx = -3; dx <= 4; dx++) {
      const bx = x + dx;
      if (bx < 0 || bx >= S || dx === 0 || dx === 1) continue;
      const i = y * S + bx;
      const dist = dx < 0 ? -dx : dx - 1;
      fert[i] = (fert[i] ?? 0.5) + (dist <= 2 ? 0.2 : 0.1);
      if (dist <= 1 && terrain[i] === Terrain.Roche) terrain[i] = Terrain.Herbe;
    }
  }
}

/** Fief de départ : bois et pierre garantis, centre dégagé pour le manoir. */
function prepareStartFief(dims: WorldDims, col: number, row: number, terrain: number[]): void {
  const S = dims.fiefSize;
  const rng = new Rng(deriveSeed(dims.seed, `depart-${col}-${row}`));
  const center = Math.floor(S / 2);
  const farFromCenter = (x: number, y: number): boolean =>
    Math.max(Math.abs(x - center), Math.abs(y - center)) > dims.startClearRadius + 3;

  const count = (t: number): number => terrain.reduce((n, v) => (v === t ? n + 1 : n), 0);
  const stamp = (t: number, radius: number): void => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const cx = rng.int(radius + 1, S - radius - 2);
      const cy = rng.int(radius + 1, S - radius - 2);
      if (!farFromCenter(cx, cy)) continue;
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > radius * radius) continue;
          const i = y * S + x;
          if (terrain[i] !== Terrain.Eau) terrain[i] = t;
        }
      }
      return;
    }
  };

  for (let k = 0; k < 20 && count(Terrain.Foret) < dims.startMinForestTiles; k++) stamp(Terrain.Foret, 4);
  for (let k = 0; k < 20 && count(Terrain.Roche) < dims.startMinRockTiles; k++) stamp(Terrain.Roche, 2);

  const R = dims.startClearRadius;
  for (let y = center - R; y <= center + R; y++) {
    for (let x = center - R; x <= center + R; x++) {
      if (x < 0 || y < 0 || x >= S || y >= S) continue;
      terrain[y * S + x] = Terrain.Herbe;
    }
  }
}
