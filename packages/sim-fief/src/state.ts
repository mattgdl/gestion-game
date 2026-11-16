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
import type { WorldDims } from "@jeu/shared";

/** Marchandises physiques, qui se transportent et se stockent. L'or n'en fait pas partie. */
export type GoodId = "nourriture" | "bois" | "pierre" | "laine" | "outils" | "vetements" | "remedes";
export const GOOD_IDS: readonly GoodId[] = ["nourriture", "bois", "pierre", "laine", "outils", "vetements", "remedes"];
/** Marchandises qui servent à construire (comptées dans les totaux du bandeau). */
export type BuildGood = "nourriture" | "bois" | "pierre";
export const BUILD_GOODS: readonly BuildGood[] = ["nourriture", "bois", "pierre"];
export const GOOD_NAMES: Record<GoodId, string> = {
  nourriture: "Nourriture",
  bois: "Bois",
  pierre: "Pierre",
  laine: "Laine",
  outils: "Outils",
  vetements: "Vêtements",
  remedes: "Remèdes",
};
export type Goods = Partial<Record<GoodId, number>>;

export interface FiefTiles {
  id: string;
  /** Nom du fief (fiefs achetés ; le fief de départ prend celui de la maison). */
  name?: string;
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
  /** Morts de maladie (J4b). */
  deathsDisease?: number;
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
  /** Parents (nés au domaine depuis J3) ; absents pour les villageois de départ. */
  fatherId?: number | null;
  motherId?: number | null;
  /** Membre de la famille noble (sang ou alliance) : vit au manoir, ne travaille pas. */
  noble?: boolean;
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
  /** Foyer noble : vit au manoir (houseId = le manoir) et se sert sur ses réserves. */
  noble?: boolean;
}

export type TaxLevel = "aucun" | "normal" | "lourd";

/** Accueil des nouveaux venus : nombre maximal de familles par an (demography.json). */
export type ImmigrationLevel = "fermee" | "normale" | "ouverte";
export const IMMIGRATION_LEVELS: readonly ImmigrationLevel[] = ["fermee", "normale", "ouverte"];

export interface GameOver {
  /** depeuple : moins de 5 habitants ; extinction : plus aucun héritier à la mort du seigneur. */
  reason: "depeuple" | "extinction";
  tick: number;
}

/**
 * Lois de succession (J3) :
 * - masculine : les fils seulement, et seulement par les hommes (loi salique) ;
 * - preference-masculine : les fils d'abord, une fille s'il n'y a aucun fils ;
 * - absolue : l'aîné(e), fils ou fille.
 */
export type SuccessionLaw = "masculine" | "preference-masculine" | "absolue";
export const SUCCESSION_LAWS: readonly SuccessionLaw[] = ["masculine", "preference-masculine", "absolue"];

/** Membre de la lignée, vivant ou non : l'arbre sert à la succession et à la chronique. */
export interface DynastyMember {
  /** Même identifiant que le villageois tant qu'il vit au domaine. */
  id: number;
  name: string;
  sex: Sex;
  birthTick: number;
  fatherId: number | null;
  motherId: number | null;
  /** Descendant du fondateur (sinon : conjoint entré par mariage). */
  blood: boolean;
  status: "vivant" | "mort" | "eglise" | "parti";
  /** Tick de la mort ou du départ. */
  endTick: number | null;
  spouseIds: number[];
  /** Maison d'origine d'un conjoint. */
  house?: string;
  /** Le joueur a refusé de le remarier (veuf, veuve). */
  noRemarriage?: boolean;
}

export interface Suitor {
  name: string;
  sex: Sex;
  birthTick: number;
  /** Or apporté par le mariage. */
  dowry: number;
  house: string;
}

/** Une affaire de famille en attente : l'avenir d'un membre majeur et non marié. */
export interface FamilyDecision {
  memberId: number;
  suitors: Suitor[];
  createdTick: number;
}

export interface Reign {
  lordId: number;
  fromTick: number;
  toTick: number | null;
}

export interface DynastyState {
  /** « Maison de … ». */
  name: string;
  founderId: number;
  /** Seigneur régnant (null après l'extinction). */
  lordId: number | null;
  law: SuccessionLaw;
  /** Décret pris, appliqué à effectiveTick. */
  pendingLaw: { law: SuccessionLaw; effectiveTick: number } | null;
  /** Régence en cours : le régent (null = conseil de régence). Absente = pas de régence. */
  regency: { regentId: number | null } | null;
  decisions: FamilyDecision[];
  members: DynastyMember[];
  reigns: Reign[];
  chronicle: LogEntry[];
  /** Prestige gagné par les actes (Église, alliances). */
  prestigeAcquis: number;
  /** Titre le plus haut atteint (définitif) : seigneur, baron, comte, duc (J4). */
  title: string;
  /** Maisons voisines (prétendants, alliances). */
  neighbors: string[];
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
  /** Lignée du seigneur (J3). */
  dynasty: DynastyState;
  /** Dimensions du monde : pour générer le terrain d'un fief acheté (J4). */
  dims: WorldDims;
  /** Offres d'achat en cours : l'or est déjà retiré du trésor (séquestre) jusqu'au bilan d'automne. */
  offers: Offer[];
  /** Besoins du village (J4b) : dû en millièmes et couverture lissée (‰). */
  needs: { outils: NeedState; vetements: NeedState };
  /** Épidémie en cours (J4b). */
  epidemic: Epidemic | null;
  /** Achats et ventes à la foire d'automne de l'année (plafonds). */
  fair: { year: number; bought: Goods; sold: Goods };
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

export interface NeedState {
  /** Quantité due, en millièmes, pas encore prise dans les réserves. */
  owed: number;
  /** Part des besoins servis, lissée sur 30 jours, en millièmes. */
  coverage: number;
}

export interface Epidemic {
  fiefId: string;
  x: number;
  y: number;
  radius: number;
  untilTick: number;
  deaths: number;
  /** Jours de soins donnés depuis le dernier remède pris, par guérisseur. */
  care: Record<string, number>;
}

/** Offre d'achat d'un fief voisin, résolue par le Monde au bilan d'automne. */
export interface Offer {
  actionId: string;
  fiefId: string;
  price: number;
  tick: number;
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
