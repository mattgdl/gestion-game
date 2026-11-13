/**
 * Comportement des seigneurs voisins contrôlés par l'IA.
 * V1 : voisins passifs (aucune action). Les voisins actifs arrivent en V2.
 */
import type { ProposeAction } from "@jeu/shared";
import type { Rng } from "@jeu/shared";
import type { WorldState } from "../state";

export function aiActions(_world: WorldState, _rng: Rng): ProposeAction[] {
  return [];
}
