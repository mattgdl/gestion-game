/**
 * Création d'un nouveau monde à partir d'une graine : grille de fiefs, terrains
 * dominants, noms, propriétaires.
 */
import worldJson from "@jeu/data/world.json";
import namesJson from "@jeu/data/names.json";
import { Rng, deNom, deriveSeed, fiefIdOf, hashString, type DominantId } from "@jeu/shared";
import { setupAiLords } from "./ai/archetypes";
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

export const WORLD_CONFIG = worldJson as unknown as WorldConfig & {
  multi: { cols: number; rows: number; emplacements: [number, number][]; joueursMax: number };
};

/** Un joueur d'une partie à plusieurs (J7) : identifiant de salle et pseudo. */
export interface WorldPlayer {
  id: string;
  pseudo: string;
}

/** Index de couleur des joueurs d'une partie à plusieurs (voir la palette du client). */
export const PLAYER_COLOR_BASE = 1000;

/**
 * Crée un monde. Solo : le joueur PLAYER_ID au centre de la carte de `config`. À plusieurs
 * (J7) : carte multi (7 × 7), chaque joueur sur un emplacement espacé, tiré au sort.
 */
export function createWorld(seedText: string, config: WorldConfig = WORLD_CONFIG, players?: WorldPlayer[]): WorldState {
  const seed = hashString(seedText);
  const rng = new Rng(deriveSeed(seed, "monde"));
  const multi = players !== undefined && players.length > 0;
  const cols = multi ? WORLD_CONFIG.multi.cols : config.cols;
  const rows = multi ? WORLD_CONFIG.multi.rows : config.rows;
  const playerFief = config.playerFief;

  const aiDominants = rng.shuffle([...config.aiDominants]);
  const baseNames = rng.shuffle([...(namesJson.fiefs as string[])]);
  // Les noms en plus ne servent qu'aux grandes cartes : le monde solo ne change pas.
  const extra = (namesJson as unknown as { fiefsSupplementaires?: string[] }).fiefsSupplementaires ?? [];
  const names = cols * rows > baseNames.length ? [...baseNames, ...new Rng(deriveSeed(seed, "noms")).shuffle([...extra])] : baseNames;

  // Fiefs de départ : le joueur solo au centre ; à plusieurs, emplacements tirés au sort.
  const seats = new Map<string, WorldPlayer & { index: number }>();
  if (multi) {
    const slots = WORLD_CONFIG.multi.emplacements.slice(0, players.length);
    const order = new Rng(deriveSeed(seed, "emplacements")).shuffle(players.map((_, i) => i));
    order.forEach((playerIndex, k) => {
      const slot = slots[k]!;
      seats.set(`${slot[0]}-${slot[1]}`, { ...players[playerIndex]!, index: playerIndex });
    });
  } else {
    seats.set(`${playerFief.col}-${playerFief.row}`, { id: PLAYER_ID, pseudo: "", index: 0 });
  }

  const fiefs: FiefMeta[] = [];
  const lords: Lord[] = multi ? [] : [{ id: PLAYER_ID, name: "Votre lignée", isPlayer: true, colorIndex: 0 }];
  let aiIndex = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const seat = seats.get(`${col}-${row}`);
      const isPlayer = seat !== undefined;
      const name = names[(row * cols + col) % names.length] ?? `Fief ${col}-${row}`;
      let dominant: DominantId;
      let ownerId: string;
      if (seat) {
        dominant = config.playerDominant;
        ownerId = seat.id;
        if (multi) lords.push({ id: seat.id, name: `Maison ${deNom(name)}`, isPlayer: true, colorIndex: PLAYER_COLOR_BASE + seat.index, pseudo: seat.pseudo });
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
    startFief: multi ? null : { ...playerFief },
    ...(multi ? { startFiefs: [...seats.keys()].map((k) => ({ col: Number(k.split("-")[0]), row: Number(k.split("-")[1]) })) } : {}),
    startClearRadius: config.startClearRadius,
    startMinForestTiles: config.startMinForestTiles,
    startMinRockTiles: config.startMinRockTiles,
  };
  for (const f of fiefs) f.land = describeLand(dims, f.col, f.row);

  const world: WorldState = {
    seedText,
    dims,
    fiefs,
    lords,
    year: 1,
    rngState: rng.state,
    lastSummaries: {},
    agreements: [],
    proposals: [],
    wars: [],
    armies: {},
  };
  setupAiLords(world);
  return world;
}
