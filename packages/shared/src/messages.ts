/**
 * Messages échangés entre la couche Fief et la couche Monde (DESIGN.md, section 7.2).
 * Les deux couches ne communiquent QUE par ces messages.
 * En J1, seule la barrière annuelle (vide) est branchée ; les autres types sont
 * déclarés pour que l'architecture soit prête.
 */

import type { TradeGood, TradeTerms } from "./types";

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
  /** Marchandises qui manquent au domaine (J5, retour de partie) : les voisins proposent d'en vendre. */
  shortages?: TradeGood[];
}

/** Intention envoyée par un fief au Monde pendant l'année (résolue à la barrière). */
export type ProposeAction =
  | {
      type: "buyFief";
      actionId: string;
      ownerId: string;
      fiefId: string;
      /** L'or est mis sous séquestre dès la proposition. */
      price: number;
    }
  /** Le domaine propose un accord à un seigneur IA (J5) : réponse au bilan, livraisons l'an suivant. */
  | {
      type: "proposeTrade";
      actionId: string;
      ownerId: string;
      partnerId: string;
      good: TradeGood;
      side: "vente" | "achat";
      perYear: number;
      price: number;
      years: number;
    }
  /** Le domaine a accepté un accord proposé par un seigneur IA (il court depuis l'acceptation). */
  | { type: "acceptTrade"; actionId: string; ownerId: string; proposalId: string }
  /** Le domaine déclare la guerre à un fief qui touche les siens (J6) : premier assaut au bilan suivant. */
  | { type: "declareWar"; actionId: string; ownerId: string; fiefId: string; goal: WarGoal }
  /** L'attaquant lève le siège. */
  | { type: "endWar"; actionId: string; ownerId: string; warId: string }
  /** Forces du domaine au bilan : soldats, soldats armés, mercenaires, moral (‰). */
  | { type: "armyReport"; actionId: string; ownerId: string; soldiers: number; armed: number; mercenaries: number; morale: number; households: number }
  /** Réponse d'un joueur à une offre d'achat d'un autre joueur sur l'un de ses fiefs (J7). */
  | { type: "answerFiefOffer"; actionId: string; ownerId: string; offerId: string; accept: boolean; households: number }
  /** Le domaine rompt un accord. */
  | { type: "cancelTrade"; actionId: string; ownerId: string; agreementId: string }
  /**
   * Ce qui a été livré (vente) ou reçu (achat) cette année pour un accord, et l'or payé sur
   * place pour un achat.
   */
  | {
      type: "tradeReport";
      actionId: string;
      ownerId: string;
      agreementId: string;
      quantity: number;
      /** Ce qui était dû cette année (moins si l'accord a commencé en cours d'année). */
      due: number;
      paid: number;
    };

/** Ce qu'un domaine remet au Monde à la barrière. */
export interface BarrierInput {
  ownerId: string;
  summary: FiefSummary;
  ready: true;
  actions: ProposeAction[];
}

/** But d'une guerre (J6) : prendre le fief, ou le piller. */
export type WarGoal = "conquete" | "pillage";

/** Une guerre en cours, vue par tous (J6). */
export interface WarInfo {
  id: string;
  attackerId: string;
  defenderId: string;
  fiefId: string;
  goal: WarGoal;
  /** Année du premier assaut. */
  firstYear: number;
  /** Assauts gagnés et perdus par l'attaquant. */
  won: number;
  lost: number;
}

/** Résultats renvoyés par le Monde. */
export type WorldEvent =
  | { type: "info"; ownerId: string | null; text: string }
  /** Un fief change de seigneur (J4 : achat). Le village (foyers) vient avec lui. */
  | {
      type: "fiefTransferred";
      fiefId: string;
      col: number;
      row: number;
      name: string;
      fromOwnerId: string | null;
      toOwnerId: string;
      price: number;
      households: number;
      /** Pris par les armes (J6), et non acheté. */
      conquest?: boolean;
    }
  /** Une offre est refusée ou annulée : l'or sous séquestre revient, avec la raison. */
  | { type: "escrowReleased"; ownerId: string; actionId: string; fiefId: string; gold: number; reason: string }
  | { type: "paymentReceived"; ownerId: string; gold: number; reason: string }
  /** Un joueur offre d'acheter l'un de vos fiefs (J7) : répondre avant le prochain bilan. */
  | { type: "fiefOfferReceived"; ownerId: string; offerId: string; buyerId: string; fiefId: string; price: number }
  /** Marchandises livrées par un autre joueur au titre d'un accord (J7), et or payé pour elles. */
  | { type: "goodsDelivered"; ownerId: string; agreementId: string; good: TradeGood; qty: number; gold: number; text: string }
  /** Une guerre est déclarée (J6). */
  | { type: "warDeclared"; war: WarInfo; text: string }
  /** Un assaut du siège, au bilan : forces, vainqueur, soldats perdus de chaque camp. */
  | {
      type: "warRound";
      warId: string;
      attackerId: string;
      defenderId: string;
      fiefId: string;
      attack: number;
      defense: number;
      attackerWon: boolean;
      attackerLosses: number;
      defenderLosses: number;
      text: string;
    }
  /** Fin d'une guerre : fief conquis, pillé, siège levé ou abandonné. */
  | { type: "warEnded"; warId: string; attackerId: string; defenderId: string; fiefId: string; outcome: "conquis" | "pille" | "leve" | "abandon"; text: string }
  /** Un domaine est pillé : part de son or et de ses réserves perdue, quelques morts. */
  | { type: "pillaged"; ownerId: string; goldPermille: number; reservesPermille: number; deaths: number; text: string }
  /** Un seigneur IA propose un accord (J5) ; il tient jusqu'au bilan de expiresYear. */
  | { type: "tradeProposed"; ownerId: string; terms: TradeTerms; expiresYear: number }
  /** Un seigneur IA accepte l'accord proposé par le domaine. */
  | { type: "tradeAgreed"; ownerId: string; actionId: string; terms: TradeTerms }
  /** Un seigneur IA refuse l'accord proposé par le domaine, avec la raison. */
  | { type: "tradeRefused"; ownerId: string; actionId: string; reason: string }
  /**
   * Bilan d'un accord pour l'année : quantité comptée, or versé au domaine (ventes), nouvelle
   * relation avec le partenaire, et fin de l'accord s'il s'arrête (terme, rupture).
   */
  | {
      type: "tradeSettled";
      ownerId: string;
      agreementId: string;
      quantity: number;
      gold: number;
      relation: number;
      ended: boolean;
      text: string;
    }

export interface YearResolved {
  type: "yearResolved";
  /** Numéro de l'année qui vient d'être bouclée. */
  year: number;
}

export interface BarrierResult {
  events: WorldEvent[];
  resolved: YearResolved;
  /** Domaines dont les actions ont été prises en compte (J7 : un absent ne l'est pas). */
  participants?: string[];
}
