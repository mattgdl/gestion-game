/**
 * Commandes : la SEULE façon de modifier le domaine depuis l'interface.
 * L'interface envoie une commande, la simulation la vérifie puis l'applique.
 */
import type { Cost } from "@jeu/shared";

export type Command =
  | { type: "build"; building: string; x: number; y: number }
  | { type: "road"; x: number; y: number }
  | { type: "field"; x: number; y: number }
  | { type: "demolish"; x: number; y: number };

export interface CheckResult {
  ok: boolean;
  /** Explication en français quand ok = false. */
  reason?: string;
  /** Coût (construction) ou remboursement (démolition, valeurs positives). */
  cost?: Cost;
  refund?: Cost;
}
