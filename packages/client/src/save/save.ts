/**
 * Format de sauvegarde, versionné.
 *
 * Chaque sauvegarde porte un numéro de version (SAVE_VERSION). Quand le format change,
 * on incrémente SAVE_VERSION et on ajoute une migration dans MIGRATIONS : les vieilles
 * sauvegardes restent lisibles.
 */
import { SAVE_VERSION } from "@jeu/shared";
import type { DomainState } from "@jeu/sim-fief";
import type { WorldState } from "@jeu/sim-monde";

export interface SaveGame {
  saveVersion: number;
  /** Date réelle de la sauvegarde (affichage uniquement). */
  savedAt: string;
  world: WorldState;
  domain: DomainState;
}

/** Migrations : MIGRATIONS[n] transforme une sauvegarde de version n en version n + 1. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MIGRATIONS: Record<number, (save: any) => any> = {
  // Exemple pour plus tard :
  // 1: (s) => ({ ...s, saveVersion: 2, domain: { ...s.domain, population: [] } }),
};

export function makeSave(world: WorldState, domain: DomainState, now: Date = new Date()): SaveGame {
  return {
    saveVersion: SAVE_VERSION,
    savedAt: now.toISOString(),
    world: structuredClone(world),
    domain: structuredClone(domain),
  };
}

export function serializeSave(save: SaveGame): string {
  return JSON.stringify(save);
}

export class SaveError extends Error {}

export function parseSave(text: string): SaveGame {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError("Ce fichier n'est pas une sauvegarde lisible.");
  }
  return migrateSave(raw);
}

export function migrateSave(raw: unknown): SaveGame {
  if (typeof raw !== "object" || raw === null || typeof (raw as { saveVersion?: unknown }).saveVersion !== "number") {
    throw new SaveError("Ce fichier n'est pas une sauvegarde du jeu.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let save = raw as any;
  if (save.saveVersion > SAVE_VERSION) {
    throw new SaveError("Cette sauvegarde vient d'une version plus récente du jeu.");
  }
  while (save.saveVersion < SAVE_VERSION) {
    const migrate = MIGRATIONS[save.saveVersion];
    if (!migrate) throw new SaveError(`Aucune migration depuis la version ${save.saveVersion}.`);
    save = migrate(save);
  }
  if (!save.world || !save.domain) throw new SaveError("Sauvegarde incomplète.");
  return save as SaveGame;
}
