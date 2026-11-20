/**
 * Messages du multijoueur (J7), entre l'hôte (qui fait tourner le Monde) et les joueurs.
 * Le domaine de chaque joueur tourne chez lui ; seuls passent le monde, la barrière annuelle,
 * la vitesse commune, la messagerie et la fin de partie.
 */
import type { BarrierInput, BarrierResult } from "@jeu/shared";
import type { WorldState } from "@jeu/sim-monde";

export const PROTOCOL_VERSION = 1;

export interface RoomSettings {
  seed: string;
  /** Durée de la partie, en années. */
  years: number;
  speed: 1 | 2 | 3;
}

export interface RoomPlayer {
  id: string;
  pseudo: string;
  online: boolean;
}

export interface RankingRow {
  id: string;
  pseudo: string;
  house: string;
  prestige: number;
  fiefs: number;
  population: number;
}

export type NetMessage =
  // Joueur → hôte
  | { t: "hello"; version: number; pseudo: string; token: string }
  | { t: "barrier"; year: number; input: BarrierInput }
  | { t: "chat"; text: string }
  /** Le domaine de ce joueur est perdu (fin de partie pour lui) : on ne l'attend plus aux bilans. */
  | { t: "out" }
  // Hôte → joueurs
  | { t: "lobby"; players: RoomPlayer[]; settings: RoomSettings; started: boolean }
  | { t: "start"; playerId: string; world: WorldState; settings: RoomSettings; gameId: string; resume: boolean }
  | { t: "result"; year: number; result: BarrierResult; world: WorldState }
  | { t: "control"; speed: 1 | 2 | 3; paused: boolean }
  | { t: "waiting"; year: number; missing: string[]; deadline: number | null }
  | { t: "said"; from: string; text: string; at: number }
  | { t: "end"; ranking: RankingRow[] }
  | { t: "refused"; reason: string };
