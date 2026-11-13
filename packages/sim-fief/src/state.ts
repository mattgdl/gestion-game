/**
 * État de la couche Fief : le domaine d'un joueur (ses fiefs, bâtiments, routes,
 * champs, ressources, horloge). Entièrement sérialisable en JSON.
 *
 * Coordonnées : toujours GLOBALES (x, y en tuiles sur toute la carte).
 * Une tuile est repérée dans les listes par sa clé : y × largeur du monde + x.
 */
import type { Resources } from "@jeu/shared";

export interface FiefTiles {
  id: string;
  col: number;
  row: number;
  /** Coin haut-gauche du fief, en coordonnées globales. */
  originX: number;
  originY: number;
  size: number;
  /** Terrain de chaque tuile (index = y local × taille + x local). */
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
  resources: Resources;
  fiefs: Record<string, FiefTiles>;
  buildings: Building[];
  /** Clés des tuiles de route. */
  roads: number[];
  /** Clés des tuiles de champ. */
  fields: number[];
  nextId: number;
  /** Journal des derniers événements (les plus récents à la fin). */
  log: LogEntry[];
  /** Vrai entre l'arrivée à la barrière annuelle et sa résolution par le Monde. */
  awaitingBarrier: boolean;
  /** Tick auquel la dernière barrière a été résolue (-1 au départ). */
  lastBarrierTick: number;
}
