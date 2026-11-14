/** Accès typé aux données d'équilibrage (packages/data). */
import buildingsJson from "@jeu/data/buildings.json";
import economyJson from "@jeu/data/economy.json";
import logisticsJson from "@jeu/data/logistics.json";
import seasonsJson from "@jeu/data/seasons.json";
import type { Cost, Resources } from "@jeu/shared";
import type { GoodId } from "./state";

export interface BuildingDef {
  nom: string;
  taille: [number, number];
  cout: Cost;
  constructible: boolean;
  unique?: boolean;
  couleur: string;
  description: string;
  rayonChamps?: number;
  /** Terrain requis à proximité ; c'est aussi le terrain exploité par la production. */
  procheDe?: { terrain: string; rayon: number };
  /** Réserve : marchandises stockables. */
  stockage?: { capacite: number };
  /** Atelier : production continue tant que le terrain voisin le permet. */
  production?: { ressource: GoodId; parAn: number; casesPleinRendement: number };
  /** Ferme : semailles au printemps, moisson à l'automne. */
  agriculture?: { champsMax: number; rendementParChamp: number; ticksParRecolte: number };
  /** Porteurs attachés au bâtiment. */
  transport?: { porteurs: number; charge: number };
  /** Production en attente au-delà de laquelle le bâtiment s'arrête. */
  stockMax?: number;
}

const { _doc: _buildingsDoc, ...buildingDefs } = buildingsJson;
export const BUILDINGS = buildingDefs as unknown as Record<string, BuildingDef>;
export const BUILDING_IDS = Object.keys(BUILDINGS);

export interface EconomyDef {
  ressourcesDepart: Resources;
  coutRoute: Cost;
  coutChamp: Cost;
  remboursementDemolition: number;
  routesDepart: number;
}
export const ECONOMY = economyJson as unknown as EconomyDef;

export interface LogisticsDef {
  ticksParCase: number;
  attenteChargePartielle: number;
}
export const LOGISTICS = logisticsJson as unknown as LogisticsDef;

export interface SeasonsDef {
  secondesParAn: number;
  ticksParSeconde: number;
  joursParSaison: number;
  saisons: { id: string; nom: string }[];
}
export const SEASONS = seasonsJson as unknown as SeasonsDef;
