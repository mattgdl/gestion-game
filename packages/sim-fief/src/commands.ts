/**
 * Commandes : la SEULE façon de modifier le domaine depuis l'interface.
 * L'interface envoie une commande, la simulation la vérifie puis l'applique.
 */
import type { Cost } from "@jeu/shared";
import type { TaxLevel } from "./state";

export type Command =
  | { type: "build"; building: string; x: number; y: number }
  | { type: "road"; x: number; y: number }
  | { type: "field"; x: number; y: number }
  | { type: "demolish"; x: number; y: number }
  /** Nombre maximal de travailleurs d'un bâtiment (0 à ses emplois). */
  | { type: "setWorkers"; buildingId: number; count: number }
  | { type: "setTax"; level: TaxLevel };

export interface CheckResult {
  ok: boolean;
  /** Explication en français quand ok = false. */
  reason?: string;
  /** Coût (construction) ou remboursement (démolition, valeurs positives). */
  cost?: Cost;
  refund?: Cost;
}
