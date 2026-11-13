/** Accès typé aux données d'équilibrage (packages/data). */
import buildingsJson from "@jeu/data/buildings.json";
import economyJson from "@jeu/data/economy.json";
import seasonsJson from "@jeu/data/seasons.json";
import type { Cost, Resources } from "@jeu/shared";

export interface BuildingDef {
  nom: string;
  taille: [number, number];
  cout: Cost;
  constructible: boolean;
  unique?: boolean;
  couleur: string;
  description: string;
  rayonChamps?: number;
  procheDe?: { terrain: string; rayon: number };
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

export interface SeasonsDef {
  secondesParAn: number;
  ticksParSeconde: number;
  joursParSaison: number;
  saisons: { id: string; nom: string }[];
}
export const SEASONS = seasonsJson as unknown as SeasonsDef;
