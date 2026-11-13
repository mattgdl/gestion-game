/**
 * Sol de la carte : une petite image par fief, à 1 pixel par tuile, agrandie sans lissage.
 * Très léger à dessiner, et net à tous les niveaux de zoom.
 */
import { hash3 } from "@jeu/shared";
import { terrainColor } from "./palette";

export interface GroundSource {
  size: number;
  originX: number;
  originY: number;
  terrain: number[];
  fertility: number[];
}

/** Remplit `image` (size × size pixels) avec le terrain du fief pour la saison donnée. */
export function paintGround(image: ImageData, src: GroundSource, season: number): void {
  const { size } = src;
  const data = image.data;
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const i = ly * size + lx;
      const [r, g, b] = terrainColor(src.terrain[i] ?? 0, src.fertility[i] ?? 50, season);
      // Légère variation par tuile pour éviter les aplats.
      const jitter = 0.97 + (hash3(97, src.originX + lx, src.originY + ly) / 4294967296) * 0.06;
      const p = i * 4;
      data[p] = Math.min(255, r * jitter);
      data[p + 1] = Math.min(255, g * jitter);
      data[p + 2] = Math.min(255, b * jitter);
      data[p + 3] = 255;
    }
  }
}
