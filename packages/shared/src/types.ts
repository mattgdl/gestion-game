/** Types partagés par toutes les couches. */

export type ResourceId = "nourriture" | "bois" | "pierre" | "or";
export const RESOURCE_IDS: readonly ResourceId[] = ["nourriture", "bois", "pierre", "or"];
export const RESOURCE_NAMES: Record<ResourceId, string> = {
  nourriture: "Nourriture",
  bois: "Bois",
  pierre: "Pierre",
  or: "Or",
};

export type Resources = Record<ResourceId, number>;
export type Cost = Partial<Resources>;

/** Terrain d'une tuile. Les valeurs numériques sont celles stockées dans les sauvegardes. */
export const Terrain = {
  Herbe: 0,
  Foret: 1,
  Roche: 2,
  Eau: 3,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];
export const TERRAIN_KEYS: Record<string, TerrainId> = {
  herbe: Terrain.Herbe,
  foret: Terrain.Foret,
  roche: Terrain.Roche,
  eau: Terrain.Eau,
};
export const TERRAIN_NAMES: Record<TerrainId, string> = {
  0: "Herbe",
  1: "Forêt",
  2: "Roche",
  3: "Eau",
};

/** Terrain dominant d'un fief. */
export type DominantId = "plaines" | "foret" | "pierre" | "riviere";

/** Identifiant d'un fief : "f-<colonne>-<ligne>". */
export function fiefIdOf(col: number, row: number): string {
  return `f-${col}-${row}`;
}
