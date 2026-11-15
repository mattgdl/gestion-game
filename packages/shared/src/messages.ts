/**
 * Messages échangés entre la couche Fief et la couche Monde (DESIGN.md, section 7.2).
 * Les deux couches ne communiquent QUE par ces messages.
 * En J1, seule la barrière annuelle (vide) est branchée ; les autres types sont
 * déclarés pour que l'architecture soit prête.
 */

/**
 * Ce que le Monde dit à un domaine qui se crée, pour sa lignée (J3) : le nom de la maison
 * (celui de son fief de départ) et les maisons voisines (prétendants, alliances).
 */
export interface LineageSetup {
  houseName: string;
  neighbors: string[];
}

/** Chiffres publics d'un domaine, envoyés à chaque barrière. Jamais l'état complet. */
export interface FiefSummary {
  ownerId: string;
  fiefIds: string[];
  population: number;
  gold: number;
  prestige: number;
  lineageAlive: boolean;
}

/** Intention envoyée par un fief au Monde pendant l'année (résolue à la barrière). */
export type ProposeAction = {
  type: "buyFief";
  actionId: string;
  ownerId: string;
  fiefId: string;
  /** L'or est mis sous séquestre dès la proposition. */
  price: number;
};

/** Ce qu'un domaine remet au Monde à la barrière. */
export interface BarrierInput {
  ownerId: string;
  summary: FiefSummary;
  ready: true;
  actions: ProposeAction[];
}

/** Résultats renvoyés par le Monde. */
export type WorldEvent =
  | { type: "info"; ownerId: string | null; text: string }
  | { type: "fiefTransferred"; fiefId: string; fromOwnerId: string | null; toOwnerId: string }
  | { type: "escrowReleased"; ownerId: string; actionId: string; gold: number }
  | { type: "paymentReceived"; ownerId: string; gold: number; reason: string };

export interface YearResolved {
  type: "yearResolved";
  /** Numéro de l'année qui vient d'être bouclée. */
  year: number;
}

export interface BarrierResult {
  events: WorldEvent[];
  resolved: YearResolved;
}
