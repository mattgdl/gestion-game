/**
 * Création d'un nouveau monde à partir d'une graine : grille de fiefs, terrains
 * dominants, noms, propriétaires.
 */
import worldJson from "@jeu/data/world.json";
import namesJson from "@jeu/data/names.json";
import { Rng, deNom, deriveSeed, fiefIdOf, hashString, type DominantId } from "@jeu/shared";
import { FIEFS, describeLand } from "./fiefs";
import type { FiefMeta, Lord, WorldState } from "./state";

export const PLAYER_ID = "joueur";

interface WorldConfig {
  fiefSize: number;
  cols: number;
  rows: number;
  playerFief: { col: number; row: number };
  playerDominant: DominantId;
  aiDominants: DominantId[];
  startClearRadius: number;
  startMinForestTiles: number;
  startMinRockTiles: number;
}

export const WORLD_CONFIG = worldJson as WorldConfig;

export function createWorld(seedText: string, config: WorldConfig = WORLD_CONFIG): WorldState {
  const seed = hashString(seedText);
  const rng = new Rng(deriveSeed(seed, "monde"));
  const { cols, rows, playerFief } = config;

  const aiDominants = rng.shuffle([...config.aiDominants]);
  const names = rng.shuffle([...(namesJson.fiefs as string[])]);

  const fiefs: FiefMeta[] = [];
  const lords: Lord[] = [{ id: PLAYER_ID, name: "Votre lignée", isPlayer: true, colorIndex: 0 }];
  let aiIndex = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isPlayer = col === playerFief.col && row === playerFief.row;
      const name = names[(row * cols + col) % names.length] ?? `Fief ${col}-${row}`;
      let dominant: DominantId;
      let ownerId: string;
      if (isPlayer) {
        dominant = config.playerDominant;
        ownerId = PLAYER_ID;
      } else {
        dominant = aiDominants[aiIndex % aiDominants.length] ?? "foret";
        aiIndex += 1;
        ownerId = `ia-${aiIndex}`;
        lords.push({ id: ownerId, name: `Maison ${deNom(name)}`, isPlayer: false, colorIndex: aiIndex });
      }
      const households = isPlayer ? 0 : rng.int(FIEFS.village.foyersMin, FIEFS.village.foyersMax0);
      fiefs.push({ id: fiefIdOf(col, row), col, row, name, dominant, ownerId, households, land: { herbe: 0, foret: 0, roche: 0, eau: 0, fertilite: 0 } });
    }
  }

  const dims = {
    seed,
    fiefSize: config.fiefSize,
    cols,
    rows,
    dominants: fiefs.map((f) => f.dominant),
    startFief: { ...playerFief },
    startClearRadius: config.startClearRadius,
    startMinForestTiles: config.startMinForestTiles,
    startMinRockTiles: config.startMinRockTiles,
  };
  for (const f of fiefs) f.land = describeLand(dims, f.col, f.row);

  return {
    seedText,
    dims: {
      seed,
      fiefSize: config.fiefSize,
      cols,
      rows,
      dominants: fiefs.map((f) => f.dominant),
      startFief: { ...playerFief },
      startClearRadius: config.startClearRadius,
      startMinForestTiles: config.startMinForestTiles,
      startMinRockTiles: config.startMinRockTiles,
    },
    fiefs,
    lords,
    year: 1,
    rngState: rng.state,
    lastSummaries: {},
  };
}
