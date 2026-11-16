/**
 * Archétypes des seigneurs IA (J5) : fiches de réglages lues dans packages/data/ia.json.
 * Chaque seigneur IA en reçoit un à la création du monde, tiré avec une graine dérivée
 * (sans toucher aux autres tirages du monde).
 */
import iaJson from "@jeu/data/ia.json";
import { Rng, TRADE_GOODS, deriveSeed, type DominantId, type TradeGood } from "@jeu/shared";
import type { AiLord, WorldState } from "../state";

export interface Archetype {
  id: string;
  nom: string;
  description: string;
  ambition: number;
  epargne: number;
  croissance: number;
  plancher: number;
  marge: number;
  commerce: number;
  fiabilite: number;
  relationDepart: number;
  gainRelation: number;
  guerre: number;
  bonusProduction?: Partial<Record<TradeGood, number>>;
}

export interface IaDef {
  archetypes: Archetype[];
  relationAleatoire: number;
  orDepart: [number, number];
  economie: {
    productionParFoyer: Record<DominantId, Partial<Record<TradeGood, number>>>;
    consommationParFoyer: Partial<Record<TradeGood, number>>;
    impotsParFoyer: number;
    reserveMax: number;
    reserveDepartAnnees: number;
  };
  expansion: { surenchereMin: number; surenchereMax: number };
  croissance: { chanceParAn: number; famineParAn: number };
  commerce: {
    prixBase: Record<TradeGood, number>;
    produitPourMille: number;
    manquePourMille: number;
    relationPourMilleParPoint: number;
    dureeAns: [number, number];
    expirationAns: number;
    propositionsMax: number;
    relation: { honore: number; partiel: number; rompu: number; min: number; max: number };
    seuilPartiel: number;
    accordsMaxParSeigneur: number;
  };
}

export const IA = iaJson as unknown as IaDef;

export function archetypeOf(id: string): Archetype {
  return IA.archetypes.find((a) => a.id === id) ?? (IA.archetypes[0] as Archetype);
}

/** Relation bornée entre -100 et 100. */
export function clampRelation(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

/**
 * Donne à chaque seigneur IA son archétype, son or et ses réserves de départ, et sa relation
 * avec chaque joueur. Déterministe : ne dépend que de la graine du monde.
 */
export function setupAiLords(world: WorldState): void {
  const rng = new Rng(deriveSeed(world.dims.seed, "seigneurs-ia"));
  const order = rng.shuffle(IA.archetypes.map((a) => a.id));
  const players = world.lords.filter((l) => l.isPlayer).map((l) => l.id);
  let i = 0;
  for (const lord of world.lords) {
    if (lord.isPlayer) continue;
    const arch = archetypeOf(order[i % order.length] as string);
    i += 1;
    const households = world.fiefs.filter((f) => f.ownerId === lord.id).reduce((n, f) => n + f.households, 0);
    const stock: Partial<Record<TradeGood, number>> = {};
    for (const g of TRADE_GOODS) {
      const need = IA.economie.consommationParFoyer[g] ?? 0;
      if (g === "nourriture" || g === "bois") stock[g] = need * households * IA.economie.reserveDepartAnnees;
    }
    const relations: Record<string, number> = {};
    for (const p of players) relations[p] = clampRelation(arch.relationDepart + rng.int(-IA.relationAleatoire, IA.relationAleatoire));
    const ai: AiLord = { archetype: arch.id, gold: rng.int(IA.orDepart[0], IA.orDepart[1]), stock, relations, plan: null, hungry: false };
    lord.ai = ai;
  }
}
