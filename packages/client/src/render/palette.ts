import type { GoodId } from "@jeu/sim-fief";
/**
 * Couleurs de la carte (placeholders jusqu'à J9). Aucune règle de jeu ici.
 * Les couleurs des seigneurs reprennent les émaux de l'héraldique.
 */
import { Terrain } from "@jeu/shared";

export type Rgb = [number, number, number];

export function hex(c: string): Rgb {
  const v = parseInt(c.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toInt([r, g, b]: Rgb): number {
  return (r << 16) | (g << 8) | b;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map((v) =>
    Math.max(0, Math.min(255, Math.round(v))),
  ) as Rgb;
}

export function shade(c: Rgb, factor: number): Rgb {
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v * factor)))) as Rgb;
}

/** Herbe : [peu fertile, très fertile] par saison (printemps, été, automne, hiver). */
const GRASS: [Rgb, Rgb][] = [
  [hex("#9aa868"), hex("#5f9a45")],
  [hex("#a3a35c"), hex("#55893b")],
  [hex("#b39a5a"), hex("#8f8a40")],
  [hex("#d7dcdc"), hex("#c9d1d3")],
];
const FOREST: Rgb[] = [hex("#3c6a3a"), hex("#2c5730"), hex("#7a4f28"), hex("#4f5f57")];
const ROCK: Rgb[] = [hex("#8b8781"), hex("#8f8a82"), hex("#867f78"), hex("#b3b6b8")];
const WATER: Rgb[] = [hex("#3d78a8"), hex("#3a74a6"), hex("#3f6f98"), hex("#9fc2d8")];

export function terrainColor(terrain: number, fertility: number, season: number): Rgb {
  const s = Math.max(0, Math.min(3, season));
  switch (terrain) {
    case Terrain.Foret:
      return FOREST[s] as Rgb;
    case Terrain.Roche:
      return ROCK[s] as Rgb;
    case Terrain.Eau:
      return WATER[s] as Rgb;
    default: {
      const [low, high] = GRASS[s] as [Rgb, Rgb];
      return mix(low, high, fertility / 100);
    }
  }
}

/** Couleurs des marchandises (porteurs, caisses en attente, itinéraires). */
export const GOOD_COLORS: Record<GoodId, string> = {
  nourriture: "#e2bd45",
  bois: "#9a6234",
  pierre: "#b9bec4",
  laine: "#efe9da",
  outils: "#6f7682",
  vetements: "#a76bb5",
  remedes: "#5fae6d",
  armes: "#9aa3b0",
};

const SOIL_TILLED = hex("#7a5f3c");
const FALLOW = hex("#a3955f");
const WHEAT_GREEN = hex("#7ea648");
const WHEAT_GOLD = hex("#d8ad42");
const STUBBLE = hex("#bba26a");
const WINTER_SOIL = hex("#c9c2b4");

/**
 * Couleur d'un champ selon la culture et la saison :
 * labour au printemps, blé vert qui dore pendant l'été, or à l'automne, chaume après la moisson.
 * Un champ non semé reste en friche.
 */
export function fieldColor(crop: "seme" | "recolte" | undefined, season: number, progress: number, worked: boolean): Rgb {
  if (season === 3) return WINTER_SOIL;
  if (crop === "recolte") return STUBBLE;
  if (crop === "seme") return season === 1 ? mix(WHEAT_GREEN, WHEAT_GOLD, progress * 0.7) : WHEAT_GOLD;
  if (season === 0 && worked) return mix(SOIL_TILLED, WHEAT_GREEN, progress * 0.35);
  return FALLOW;
}
export const ROAD_COLORS: Rgb[] = [hex("#b39a6e"), hex("#b39a6e"), hex("#a98f63"), hex("#cbc2b4")];

/** Émaux héraldiques : azur (joueur), gueules, sinople, or, pourpre, sable. */
/** Couleur 0 : le joueur (azur). Les seigneurs IA se partagent les autres, sans jamais reprendre l'azur. */
export const LORD_COLORS: string[] = ["#2f6fd0", "#c0392b", "#2e8b57", "#d4a017", "#7d3c98", "#8a5a2b", "#1f8a8a", "#b0457a", "#6b7d2a", "#4a4a5a"];

export function lordColor(colorIndex: number | undefined): string {
  if (colorIndex === undefined) return "#777777";
  if (colorIndex === 0) return LORD_COLORS[0]!;
  return LORD_COLORS[1 + ((colorIndex - 1) % (LORD_COLORS.length - 1))] ?? "#777777";
}
