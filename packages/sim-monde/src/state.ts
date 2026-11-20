/**
 * État de la couche Monde : qui possède quel fief, les seigneurs, l'année en cours.
 * Sérialisable en JSON. En solo il vit dans le navigateur ; en multi (J8) dans le serveur.
 */
import type { DominantId, FiefSummary, LineageSetup, TradeGood, TradeTerms, WarInfo, WorldDims } from "@jeu/shared";

export interface FiefMeta {
  id: string;
  col: number;
  row: number;
  name: string;
  dominant: DominantId;
  /** null = terre sans seigneur (achetable ou conquérable plus tard). */
  ownerId: string | null;
  /** Village du fief tant qu'il appartient à une IA : nombre de foyers (J4). */
  households: number;
  /** Composition du terrain (cases) et fertilité moyenne de l'herbe, pour estimer sa valeur. */
  land: { herbe: number; foret: number; roche: number; eau: number; fertilite: number };
}

export interface Lord {
  id: string;
  name: string;
  isPlayer: boolean;
  /** Index de couleur pour l'affichage (vue Monde). */
  colorIndex: number;
  /** Seigneur IA (J5) : son archétype, son or, ses réserves, ses relations. */
  ai?: AiLord;
  /** Pseudo d'un joueur dans une partie à plusieurs (J7). */
  pseudo?: string;
}

/** Ce que sait et possède un seigneur IA (J5). Il ne bâtit rien : tout se joue au bilan. */
export interface AiLord {
  /** Identifiant de l'archétype (packages/data/ia.json). */
  archetype: string;
  gold: number;
  stock: Partial<Record<TradeGood, number>>;
  /** Relation avec chaque domaine joueur, de -100 à 100. */
  relations: Record<string, number>;
  /** Achat préparé : la rumeur court un an, l'offre part au bilan de l'année indiquée. */
  plan: { fiefId: string; year: number } | null;
  /** A manqué de vivres au dernier bilan. */
  hungry: boolean;
  /** Soldats blessés ou tombés, qui manquent à son armée (J6) ; ils reviennent peu à peu. */
  wounded?: number;
}

/** Accord proposé par un seigneur IA, en attente de la réponse du domaine (J5). */
export interface TradeProposal {
  terms: TradeTerms;
  /** Dernière année où le domaine peut l'accepter. */
  expiresYear: number;
  /**
   * Accord entre joueurs (J7) : celui qui doit répondre (l'acheteur). Les termes sont ceux du
   * vendeur (terms.ownerId), qui livre ; absent pour une proposition d'un seigneur IA.
   */
  recipientId?: string;
}

/** Offre d'achat d'un joueur sur le fief d'un autre joueur, en attente de réponse (J7). */
export interface FiefOffer {
  offerId: string;
  buyerId: string;
  sellerId: string;
  fiefId: string;
  price: number;
  year: number;
}

export interface WorldState {
  /** Graine telle que saisie par le joueur. */
  seedText: string;
  /** Dimensions et paramètres de génération du terrain. */
  dims: WorldDims;
  fiefs: FiefMeta[];
  lords: Lord[];
  /** Année en cours (commence à 1). */
  year: number;
  /** État du générateur aléatoire du Monde (IA, résolutions). */
  rngState: number;
  /** Derniers résumés publics reçus à la barrière, par seigneur. */
  lastSummaries: Record<string, FiefSummary>;
  /** Accords de commerce en cours (J5). */
  agreements: TradeTerms[];
  /** Accords proposés par les seigneurs IA, pas encore acceptés (J5). */
  proposals: TradeProposal[];
  /** Guerres en cours (J6). */
  wars: WarInfo[];
  /** Offres d'achat entre joueurs en attente (J7). */
  fiefOffers?: FiefOffer[];
  /** Trêves (J7, réglage) : seigneur protégé de toute déclaration de guerre jusqu'à cette année incluse. */
  truces?: Record<string, number>;
  /** Dernière armée annoncée par chaque domaine joueur au bilan (J6). */
  armies: Record<string, { soldiers: number; armed: number; mercenaries: number; morale: number; households: number }>;
}

export function fiefById(world: WorldState, id: string): FiefMeta | undefined {
  return world.fiefs.find((f) => f.id === id);
}

export function fiefAt(world: WorldState, col: number, row: number): FiefMeta | undefined {
  return world.fiefs.find((f) => f.col === col && f.row === row);
}

export function lordById(world: WorldState, id: string | null): Lord | undefined {
  if (id === null) return undefined;
  return world.lords.find((l) => l.id === id);
}

export function fiefsOwnedBy(world: WorldState, ownerId: string): FiefMeta[] {
  return world.fiefs.filter((f) => f.ownerId === ownerId);
}

/** Fief de départ d'une lignée de joueur (solo : startFief ; à plusieurs : startFiefs). */
export function isStartFief(world: WorldState, f: { col: number; row: number }): boolean {
  const d = world.dims;
  if (d.startFief && d.startFief.col === f.col && d.startFief.row === f.row) return true;
  return (d.startFiefs ?? []).some((s) => s.col === f.col && s.row === f.row);
}

/** Message de création d'une lignée : le nom de sa maison (son fief de départ) et ses voisins. */
export function lineageSetupFor(world: WorldState, ownerId: string): LineageSetup {
  const owned = fiefsOwnedBy(world, ownerId);
  const home = owned.find((f) => isStartFief(world, f)) ?? owned[0];
  const neighbors = world.lords.filter((l) => l.id !== ownerId && !l.isPlayer).map((l) => l.name);
  return { houseName: home?.name ?? "Votre lignée", neighbors };
}
