/** Types partagés par toutes les couches. */

export type ResourceId = "nourriture" | "bois" | "pierre" | "or";
export const RESOURCE_IDS: readonly ResourceId[] = ["nourriture", "bois", "pierre", "or"];
export const RESOURCE_NAMES: Record<ResourceId, string> = {
  nourriture: "Nourriture",
  bois: "Bois",
  pierre: "Pierre",
  or: "Or",
};

export type Resources = Record<ResourceId, number>;
export type Cost = Partial<Resources>;

/** Terrain d'une tuile. Les valeurs numériques sont celles stockées dans les sauvegardes. */
export const Terrain = {
  Herbe: 0,
  Foret: 1,
  Roche: 2,
  Eau: 3,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];
export const TERRAIN_KEYS: Record<string, TerrainId> = {
  herbe: Terrain.Herbe,
  foret: Terrain.Foret,
  roche: Terrain.Roche,
  eau: Terrain.Eau,
};
export const TERRAIN_NAMES: Record<TerrainId, string> = {
  0: "Herbe",
  1: "Forêt",
  2: "Roche",
  3: "Eau",
};

/** Terrain dominant d'un fief. */
export type DominantId = "plaines" | "foret" | "pierre" | "riviere";

/** Identifiant d'un fief : "f-<colonne>-<ligne>". */
export function fiefIdOf(col: number, row: number): string {
  return `f-${col}-${row}`;
}

/** Colonne et ligne d'un fief à partir de son identifiant (null si ce n'en est pas un). */
export function parseFiefId(id: string): { col: number; row: number } | null {
  const m = /^f-(\d+)-(\d+)$/.exec(id);
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
}

/** « de Clairfonds », « d'Aigremont » : élision devant une voyelle. */
export function deNom(name: string): string {
  return /^[AEIOUYÉÈÊÂÎÔaeiouyéèêâîô]/.test(name) ? `d'${name}` : `de ${name}`;
}

/** Marchandises échangées entre seigneurs (J5). */
export type TradeGood = "nourriture" | "bois" | "pierre" | "laine" | "outils" | "vetements";
export const TRADE_GOODS: readonly TradeGood[] = ["nourriture", "bois", "pierre", "laine", "outils", "vetements"];

/**
 * Accord commercial entre un domaine et un seigneur IA (J5). « vente » et « achat » sont vus
 * du domaine : en vente, il livre la marchandise et reçoit l'or au bilan ; en achat, ses
 * charretiers vont la chercher et paient sur place.
 */
export interface TradeTerms {
  id: string;
  ownerId: string;
  partnerId: string;
  /** Fief du partenaire où vont les convois (le plus proche du domaine). */
  partnerFiefId: string;
  good: TradeGood;
  side: "vente" | "achat";
  /** Quantité par an. */
  perYear: number;
  /** Prix d'une unité, en or. */
  price: number;
  /** Première et dernière année de livraison. */
  firstYear: number;
  lastYear: number;
}
