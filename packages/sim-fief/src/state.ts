/**
 * État de la couche Fief : le domaine d'un joueur (ses fiefs, bâtiments, routes,
 * champs, réserves, livraisons, horloge). Entièrement sérialisable en JSON.
 *
 * Coordonnées : toujours GLOBALES (x, y en cases sur toute la carte).
 * Une case est repérée dans les listes par sa clé : y × largeur du monde + x.
 *
 * Format v2 (J2a) : les marchandises n'existent plus en « total » abstrait.
 * Elles sont dans des bâtiments (réserves, ou production en attente) ou sur le dos
 * d'un porteur. Seul l'or reste un total : le trésor.
 */

/** Marchandises physiques, qui se transportent et se stockent. L'or n'en fait pas partie. */
export type GoodId = "nourriture" | "bois" | "pierre";
export const GOOD_IDS: readonly GoodId[] = ["nourriture", "bois", "pierre"];
export type Goods = Partial<Record<GoodId, number>>;

export interface FiefTiles {
  id: string;
  col: number;
  row: number;
  /** Coin haut-gauche du fief, en coordonnées globales. */
  originX: number;
  originY: number;
  size: number;
  /** Terrain de chaque case (index = y local × taille + x local). */
  terrain: number[];
  /** Fertilité de 0 à 100. */
  fertility: number[];
}

export interface Building {
  id: number;
  type: string;
  /** Coin haut-gauche, coordonnées globales. */
  x: number;
  y: number;
  fiefId: string;
  /** Marchandises présentes : contenu (réserves) ou production en attente de transport (producteurs). */
  stock: Goods;
  /** Avancement de la production, en millièmes (entier, pour rester déterministe). */
  progress: number;
  /** Dernier tick où le bâtiment a produit ou moissonné. */
  lastWork: number;
}

/**
 * Une livraison = un porteur en voyage. Le trajet est planifié au départ :
 * on connaît l'itinéraire et les heures d'arrivée et de retour. La simulation ne fait
 * pas avancer le porteur case par case ; l'affichage le place sur l'itinéraire.
 */
export interface Delivery {
  id: number;
  fromId: number;
  toId: number;
  good: GoodId;
  amount: number;
  /** Cases de route parcourues, de la source vers la destination. */
  path: number[];
  departTick: number;
  arriveTick: number;
  returnTick: number;
  /**
   * aller : chargé, vers la destination.
   * retour : à vide, vers la source.
   * rapporte : destination disparue, il rapporte la marchandise à la source.
   */
  status: "aller" | "retour" | "rapporte";
}

/** État d'un champ pour l'année en cours (absent = pas semé). */
export type CropState = "seme" | "recolte";

export interface YearStats {
  year: number;
  /** Nourriture moissonnée depuis le printemps. */
  harvested: number;
  fieldsHarvested: number;
  /** Production des ateliers depuis le printemps. */
  produced: Goods;
}

export interface LogEntry {
  tick: number;
  text: string;
}

export interface DomainState {
  ownerId: string;
  worldWidth: number;
  worldHeight: number;
  fiefSize: number;
  tick: number;
  rngState: number;
  /** Or du domaine (pas de limite de stockage). */
  treasury: number;
  fiefs: Record<string, FiefTiles>;
  buildings: Building[];
  /** Clés des cases de route. */
  roads: number[];
  /** Clés des cases de champ. */
  fields: number[];
  /** État des cultures de l'année, par clé de champ (en texte, car les clés JSON sont des textes). */
  crops: Record<string, CropState>;
  deliveries: Delivery[];
  yearStats: YearStats;
  nextId: number;
  /** Journal des derniers événements (les plus récents à la fin). */
  log: LogEntry[];
  /** Vrai entre l'arrivée à la barrière annuelle et sa résolution par le Monde. */
  awaitingBarrier: boolean;
  /** Tick auquel la dernière barrière a été résolue (-1 au départ). */
  lastBarrierTick: number;
}

export function emptyYearStats(year: number): YearStats {
  return { year, harvested: 0, fieldsHarvested: 0, produced: {} };
}
