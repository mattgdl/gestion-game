/**
 * Événements régionaux et réputation des traits (J8), côté Monde.
 *
 * - Au bilan, un événement régional (hiver rigoureux, peste, disette) peut toucher une zone de
 *   fiefs autour d'un fief tiré au hasard. Chaque domaine joueur de la zone reçoit l'événement
 *   (il décide de sa réponse chez lui) ; les villages IA de la zone peuvent perdre un foyer.
 * - Les traits du seigneur d'un domaine joueur changent peu à peu ce que pensent de lui les
 *   seigneurs IA (Diplomate, Pieux, Juste : mieux ; Cruel : moins bien).
 */
import evenementsJson from "@jeu/data/evenements.json";
import traitsJson from "@jeu/data/traits.json";
import type { BarrierInput, Rng, WorldEvent } from "@jeu/shared";
import { clampRelation } from "./ai/archetypes";
import type { WorldState } from "./state";

interface RegionalDef {
  id: string;
  titre: string;
  texte: string;
}

const EV = evenementsJson as unknown as { regional: { chanceParAn: number; anMin: number; rayon: number; perteFoyerIA: number }; regionaux: RegionalDef[] };
const TRAITS = Object.fromEntries((traitsJson as unknown as { traits: { id: string; effets: { relationIA?: number; attraitGuerre?: number } }[] }).traits.map((t) => [t.id, t.effets]));

/** Somme d'un effet des traits du seigneur d'un domaine joueur (d'après son dernier résumé). */
export function traitEffect(world: WorldState, playerId: string, key: "relationIA" | "attraitGuerre"): number {
  return (world.lastSummaries[playerId]?.traits ?? []).reduce((n, id) => n + (TRAITS[id]?.[key] ?? 0), 0);
}

export function regionalEvents(world: WorldState, rng: Rng, events: WorldEvent[]): void {
  const r = EV.regional;
  const roll = rng.next();
  if (world.year < r.anMin || roll * 1000 >= r.chanceParAn || EV.regionaux.length === 0) return;
  const def = EV.regionaux[rng.int(0, EV.regionaux.length - 1)]!;
  const center = world.fiefs[rng.int(0, world.fiefs.length - 1)]!;
  const zone = world.fiefs.filter((f) => Math.abs(f.col - center.col) <= r.rayon && Math.abs(f.row - center.row) <= r.rayon);
  for (const f of zone) {
    if (f.ownerId?.startsWith("ia-") && f.households > 1 && rng.next() * 1000 < r.perteFoyerIA) f.households -= 1;
  }
  events.push({ type: "regionalEvent", eventId: def.id, fiefIds: zone.map((f) => f.id), year: world.year, text: `${def.titre} autour de ${center.name}.` });
  events.push({ type: "info", ownerId: null, text: `${def.titre} autour de ${center.name}.` });
}

/** Les seigneurs IA jugent chaque année le caractère des seigneurs joueurs. */
export function traitReputation(world: WorldState, inputs: BarrierInput[]): void {
  for (const input of inputs) {
    const delta = traitEffect(world, input.ownerId, "relationIA");
    if (delta === 0) continue;
    for (const l of world.lords) if (l.ai) l.ai.relations[input.ownerId] = clampRelation((l.ai.relations[input.ownerId] ?? 0) + delta);
  }
}
