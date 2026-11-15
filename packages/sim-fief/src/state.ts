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
  /** Nombre maximal de travailleurs voulu par le joueur (absent = tous les emplois). */
  workersLimit?: number;
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
  /**
   * livraison : un atelier apporte sa production à une réserve (chargé à l'aller).
   * collecte : un marché ou un foyer va chercher des marchandises dans une réserve (chargé au retour).
   * Absent = livraison (sauvegardes v2).
   */
  kind?: "livraison" | "collecte";
  /** Foyer qui a envoyé le porteur (collecte d'un foyer). */
  familyId?: number;
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

/**
 * Statistiques de l'année agricole : de l'hiver de l'année précédente à la fin de l'automne
 * (l'an 1 commence au printemps). Le bilan de fin d'automne couvre donc quatre saisons.
 */
export interface YearStats {
  year: number;
  /** Nourriture moissonnée cette année agricole. */
  harvested: number;
  fieldsHarvested: number;
  /** Production des ateliers cette année agricole. */
  produced: Goods;
  births?: number;
  deaths?: number;
  /** Décès dus à la faim ou au froid. */
  deathsHunger?: number;
  deathsCold?: number;
  marriages?: number;
  /** Familles de nouveaux venus installées. */
  immigrants?: number;
  /** Nourriture et bois consommés par les foyers. */
  eaten?: number;
  burned?: number;
  taxes?: number;
}

export type Sex = "F" | "M";

export interface Villager {
  id: number;
  name: string;
  sex: Sex;
  birthTick: number;
  familyId: number;
}

/**
 * Un foyer : un couple (ou ce qu'il en reste) et ses enfants, dans une maison
 * (ou sans abri, autour du manoir). Provisions en millièmes d'unité (entiers).
 */
export interface Family {
  id: number;
  /** Maison occupée, ou null : sans abri, autour du manoir. */
  houseId: number | null;
  husbandId: number | null;
  wifeId: number | null;
  food: number;
  wood: number;
  /** Jours consécutifs sans assez à manger / sans feu en hiver. */
  hungryDays: number;
  coldDays: number;
  lastBirthTick: number;
  /** Moral de 0 à 100, recalculé chaque jour. */
  morale: number;
}

export type TaxLevel = "aucun" | "normal" | "lourd";

/** Accueil des nouveaux venus : nombre maximal de familles par an (demography.json). */
export type ImmigrationLevel = "fermee" | "normale" | "ouverte";
export const IMMIGRATION_LEVELS: readonly ImmigrationLevel[] = ["fermee", "normale", "ouverte"];

export interface GameOver {
  reason: "depeuple";
  tick: number;
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
  villagers: Villager[];
  families: Family[];
  taxLevel: TaxLevel;
  /** Accueil des nouveaux venus (choix du joueur). */
  immigration: ImmigrationLevel;
  /** Fin de partie : le temps s'arrête. */
  gameOver: GameOver | null;
  nextId: number;
  /** Journal des derniers événements (les plus récents à la fin). */
  log: LogEntry[];
  /** Vrai entre l'arrivée à la barrière annuelle et sa résolution par le Monde. */
  awaitingBarrier: boolean;
  /** Tick auquel la dernière barrière a été résolue (-1 au départ). */
  lastBarrierTick: number;
}

export function emptyYearStats(year: number): YearStats {
  return {
    year,
    harvested: 0,
    fieldsHarvested: 0,
    produced: {},
    births: 0,
    deaths: 0,
    deathsHunger: 0,
    deathsCold: 0,
    marriages: 0,
    immigrants: 0,
    eaten: 0,
    burned: 0,
    taxes: 0,
  };
}
