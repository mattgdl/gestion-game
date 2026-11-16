/**
 * État de la couche Monde : qui possède quel fief, les seigneurs, l'année en cours.
 * Sérialisable en JSON. En solo il vit dans le navigateur ; en multi (J8) dans le serveur.
 */
import type { DominantId, FiefSummary, LineageSetup, TradeGood, TradeTerms, WorldDims } from "@jeu/shared";

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
}

/** Accord proposé par un seigneur IA, en attente de la réponse du domaine (J5). */
export interface TradeProposal {
  terms: TradeTerms;
  /** Dernière année où le domaine peut l'accepter. */
  expiresYear: number;
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

/** Message de création d'une lignée : le nom de sa maison (son fief de départ) et ses voisins. */
export function lineageSetupFor(world: WorldState, ownerId: string): LineageSetup {
  const start = world.dims.startFief;
  const owned = fiefsOwnedBy(world, ownerId);
  const home = (start ? owned.find((f) => f.col === start.col && f.row === start.row) : undefined) ?? owned[0];
  const neighbors = world.lords.filter((l) => l.id !== ownerId && !l.isPlayer).map((l) => l.name);
  return { houseName: home?.name ?? "Votre lignée", neighbors };
}
