/** Accès typé aux données d'équilibrage (packages/data). */
import buildingsJson from "@jeu/data/buildings.json";
import economyJson from "@jeu/data/economy.json";
import logisticsJson from "@jeu/data/logistics.json";
import demographyJson from "@jeu/data/demography.json";
import namesJson from "@jeu/data/names.json";
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
  /** À quoi sert le bâtiment (fiche affichée avant de le construire). */
  utilite: string;
  /** Jalon à partir duquel le bâtiment a un effet, s'il n'en a pas encore (ex. « J2b »). */
  actifDes?: string;
  rayonChamps?: number;
  /** Terrain requis à proximité ; c'est aussi le terrain exploité par la production. */
  procheDe?: { terrain: string; rayon: number };
  /** Réserve : marchandises stockables. */
  stockage?: { capacite: number };
  /** Atelier : production continue tant que le terrain voisin le permet. */
  production?: { ressource: GoodId; parAn: number; casesPleinRendement: number };
  /** Ferme : semailles au printemps, moisson à l'automne. */
  agriculture?: { champsMax: number; champsParTravailleur: number; rendementParChamp: number; ticksParRecolte: number };
  /** Emplois du bâtiment et ordre de remplissage (1 d'abord). */
  travailleurs?: number;
  prioriteEmploi?: number;
  /** Familles logées. */
  logement?: number;
  /** Marché : réserve propre remplie par ses porteurs jusqu'aux cibles. */
  marche?: { capacite: number; cibles: Partial<Record<GoodId, number>> };
  /** Rayon (cases) dans lequel les foyers profitent du bâtiment pour leur moral. */
  influence?: number;
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
  impotsParFoyer: Record<"aucun" | "normal" | "lourd", number>;
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

export interface DemographyDef {
  depart: { couples: number; ageMin: number; ageMax: number; enfantsMax: number; ageEnfantMax: number };
  ageTravail: number;
  ageMariage: number;
  fecondite: { ageMin: number; ageMax: number; intervalleMoyenJours: number; ecartMinJours: number };
  mortaliteParAn: { ageMax: number; taux: number }[];
  famineMortaliteParJour: number;
  froidMortaliteParJour: number;
  joursAvantMortalite: number;
  provisionsDepartJours: number;
  consommation: { nourritureAdulteParAn: number; nourritureEnfantParAn: number; boisParFoyerParHiver: number };
  provisions: { joursNourriture: number; chargeFoyer: number };
  seuilDefaite: number;
  distanceTravailSansPerte: number;
  pertePourCentParCase: number;
  moral: {
    base: number;
    nourri: number;
    affame: number;
    chauffe: number;
    froid: number;
    loge: number;
    sansAbri: number;
    eglise: number;
    marche: number;
    impots: Record<"aucun" | "normal" | "lourd", number>;
    immigration: Record<"fermee" | "normale" | "ouverte", number>;
  };
  immigration: {
    famillesParAn: Record<"fermee" | "normale" | "ouverte", number>;
    vivresMinJours: number;
    moralMin: number;
    ageMin: number;
    ageMax: number;
    enfantsMax: number;
    ageEnfantMax: number;
  };
}
export const DEMOGRAPHY = demographyJson as unknown as DemographyDef;
export const NAMES = namesJson as unknown as { prenomsF: string[]; prenomsM: string[] };

export interface SeasonsDef {
  secondesParAn: number;
  ticksParSeconde: number;
  joursParSaison: number;
  saisons: { id: string; nom: string }[];
}
export const SEASONS = seasonsJson as unknown as SeasonsDef;
