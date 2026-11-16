/**
 * Fiefs voisins (J4) : description du terrain, valeur en or, village des seigneurs IA,
 * prix plancher de la négociation. Tous les chiffres viennent de packages/data/fiefs.json.
 */
import fiefsJson from "@jeu/data/fiefs.json";
import { Rng, Terrain, deriveSeed, generateFiefTerrain, type WorldDims } from "@jeu/shared";
import { IA, archetypeOf } from "./ai/archetypes";
import type { FiefMeta, WorldState } from "./state";

export interface FiefsDef {
  village: { foyersMin: number; foyersMax0: number; croissanceParAn: number; foyersMax: number };
  valeur: { orParCaseHerbe: number; orParCaseForet: number; orParCaseRoche: number; orParFoyer: number; dominants: Record<string, number> };
  negociation: { plancherMin: number; plancherMax: number; seuilHesitation: number; fourchetteAffichee: [number, number] };
  villageAchete: { vivresParFoyer: number; boisParFoyer: number; champsParFerme: number; foyersParFerme: number };
  titres: { id: string; nomM: string; nomF: string; fiefs: number; habitants: number; prestige: number; moral: number }[];
}
export const FIEFS = fiefsJson as unknown as FiefsDef;

/** Composition du terrain d'un fief (calculée une fois, à la création du monde). */
export function describeLand(dims: WorldDims, col: number, row: number): FiefMeta["land"] {
  const t = generateFiefTerrain(dims, col, row);
  const land = { herbe: 0, foret: 0, roche: 0, eau: 0, fertilite: 0 };
  let fert = 0;
  for (let i = 0; i < t.terrain.length; i++) {
    const k = t.terrain[i];
    if (k === Terrain.Herbe) {
      land.herbe += 1;
      fert += t.fertility[i] ?? 0;
    } else if (k === Terrain.Foret) land.foret += 1;
    else if (k === Terrain.Roche) land.roche += 1;
    else land.eau += 1;
  }
  land.fertilite = land.herbe > 0 ? Math.round(fert / land.herbe) : 0;
  return land;
}

/** Valeur d'un fief en or : sa terre et son village. */
export function fiefValue(meta: FiefMeta): number {
  const v = FIEFS.valeur;
  const l = meta.land;
  const land = l.herbe * v.orParCaseHerbe * (0.5 + l.fertilite / 100) + l.foret * v.orParCaseForet + l.roche * v.orParCaseRoche;
  return Math.round((land + meta.households * v.orParFoyer) * (v.dominants[meta.dominant] ?? 1));
}

/**
 * Ce qui fait monter ou baisser le prix d'un seigneur IA (J5), en millièmes : son archétype
 * (un avare vend cher) et sa relation avec l'acheteur (une bonne relation fait baisser le prix).
 */
export function sellerFactor(world: WorldState, meta: FiefMeta, buyerId?: string): number {
  const lord = world.lords.find((l) => l.id === meta.ownerId);
  if (!lord?.ai) return 1000;
  const arch = archetypeOf(lord.ai.archetype);
  const relation = buyerId ? (lord.ai.relations[buyerId] ?? 0) : 0;
  return Math.max(500, Math.floor((arch.plancher * (1000 - relation * IA.commerce.relationPourMilleParPoint)) / 1000));
}

/** Fourchette montrée au joueur : il ne connaît pas le prix plancher exact. */
export function priceRange(world: WorldState, meta: FiefMeta, buyerId?: string): [number, number] {
  const [lo, hi] = FIEFS.negociation.fourchetteAffichee;
  const v = (fiefValue(meta) * sellerFactor(world, meta, buyerId)) / 1000;
  return [Math.round((v * lo) / 10) * 10, Math.round((v * hi) / 10) * 10];
}

/**
 * Prix plancher secret du seigneur IA, tiré pour ce fief et cette année (indépendant de l'ordre
 * des offres), selon son archétype et sa relation avec l'acheteur.
 */
export function floorPrice(world: WorldState, meta: FiefMeta, buyerId?: string): number {
  const n = FIEFS.negociation;
  const rng = new Rng(deriveSeed(world.dims.seed, `plancher-${meta.id}-${world.year}`));
  const factor = n.plancherMin + rng.next() * (n.plancherMax - n.plancherMin);
  return Math.round(((fiefValue(meta) * sellerFactor(world, meta, buyerId)) / 1000) * factor);
}

/** Deux fiefs se touchent par un côté. */
export function adjacent(a: { col: number; row: number }, b: { col: number; row: number }): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

