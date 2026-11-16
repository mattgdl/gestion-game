/**
 * Commandes : la SEULE façon de modifier le domaine depuis l'interface.
 * L'interface envoie une commande, la simulation la vérifie puis l'applique.
 */
import type { Cost } from "@jeu/shared";
import type { ImmigrationLevel, SuccessionLaw, TaxLevel } from "./state";
import type { DecisionChoice } from "./systems/dynasty";

export type Command =
  | { type: "build"; building: string; x: number; y: number }
  | { type: "road"; x: number; y: number }
  | { type: "field"; x: number; y: number }
  | { type: "demolish"; x: number; y: number }
  /** Nombre maximal de travailleurs d'un bâtiment (0 à ses emplois). */
  | { type: "setWorkers"; buildingId: number; count: number }
  | { type: "setTax"; level: TaxLevel }
  /** Accueil des nouveaux venus : fermé, une famille par an, ou ouvert. */
  | { type: "setImmigration"; level: ImmigrationLevel }
  /** Décret de succession : la loi change après un délai (revenir à la loi en vigueur annule). */
  | { type: "decreeLaw"; law: SuccessionLaw }
  /** Affaire de famille : épouser un prétendant (son indice), l'Église, une alliance, ou refuser un remariage. */
  | { type: "familyDecision"; memberId: number; choice: DecisionChoice }
  /** Offre d'achat d'un fief voisin : l'or est mis sous séquestre jusqu'au bilan d'automne. */
  | { type: "makeOffer"; fiefId: string; price: number }
  /** Retire une offre en cours (l'or revient). */
  | { type: "cancelOffer"; fiefId: string };

export interface CheckResult {
  ok: boolean;
  /** Explication en français quand ok = false. */
  reason?: string;
  /** Coût (construction) ou remboursement (démolition, valeurs positives). */
  cost?: Cost;
  refund?: Cost;
}
