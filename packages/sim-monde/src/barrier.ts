/**
 * Barrière annuelle (DESIGN.md, section 7.3).
 *
 * À la fin de chaque automne, chaque domaine envoie son résumé et ses actions.
 * Quand tout le monde est prêt, le Monde résout tout dans un ordre fixe, puis
 * renvoie les événements et le signal "année résolue".
 *
 * Ordre de résolution (déterministe) : transactions, puis IA voisines, puis éliminations.
 * V1 (J1) : aucune transaction encore ; la barrière enregistre les résumés et boucle l'année.
 */
import { Rng, type BarrierInput, type BarrierResult, type WorldEvent } from "@jeu/shared";
import { aiActions } from "./ai/neighbors";
import type { WorldState } from "./state";

export function resolveBarrier(world: WorldState, inputs: BarrierInput[]): BarrierResult {
  const rng = new Rng(world.rngState);
  const events: WorldEvent[] = [];
  const sorted = [...inputs].sort((a, b) => (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0));

  for (const input of sorted) {
    world.lastSummaries[input.ownerId] = input.summary;
  }

  // 1. Transactions (achat de fief : J4).
  const playerActions = sorted.flatMap((i) => i.actions);
  // 2. Actions des voisins IA (passifs en V1).
  const ai = aiActions(world, rng);
  if (playerActions.length === 0 && ai.length === 0) {
    events.push({ type: "info", ownerId: null, text: `Bilan de l'an ${world.year} : aucune affaire entre seigneurs.` });
  }
  // 3. Éliminations (J3).

  const resolvedYear = world.year;
  world.year += 1;
  world.rngState = rng.state;
  return { events, resolved: { type: "yearResolved", year: resolvedYear } };
}
