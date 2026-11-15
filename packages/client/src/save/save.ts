/**
 * Format de sauvegarde, versionné.
 *
 * Chaque sauvegarde porte un numéro de version (SAVE_VERSION). Quand le format change,
 * on incrémente SAVE_VERSION et on ajoute une migration dans MIGRATIONS : les vieilles
 * sauvegardes restent lisibles.
 */
import { SAVE_VERSION } from "@jeu/shared";
import { DomainSim, type DomainState } from "@jeu/sim-fief";
import type { WorldState } from "@jeu/sim-monde";

export interface SaveGame {
  saveVersion: number;
  /** Identifiant de la partie (journal de partie). Absent des sauvegardes anciennes. */
  gameId?: string;
  /** Date réelle de la sauvegarde (affichage uniquement). */
  savedAt: string;
  world: WorldState;
  domain: DomainState;
}

/** Migrations : MIGRATIONS[n] transforme une sauvegarde de version n en version n + 1. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MIGRATIONS: Record<number, (save: any) => any> = {
  /**
   * v1 (J1) → v2 (J2a) : les ressources « totales » deviennent des marchandises rangées
   * dans le manoir ; l'or passe au trésor. Ajout des livraisons, cultures et statistiques.
   */
  1: (s) => {
    const { resources, ...domain } = s.domain;
    const res = resources ?? { nourriture: 0, bois: 0, pierre: 0, or: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildings = (domain.buildings ?? []).map((b: any) => ({ ...b, stock: {}, progress: 0, lastWork: 0 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manor = buildings.find((b: any) => b.type === "manoir");
    if (manor) manor.stock = { nourriture: res.nourriture, bois: res.bois, pierre: res.pierre };
    const year = Math.floor((domain.tick ?? 0) / 1800) + 1;
    return {
      ...s,
      saveVersion: 2,
      domain: {
        ...domain,
        buildings,
        treasury: res.or,
        crops: {},
        deliveries: [],
        yearStats: { year, harvested: 0, fieldsHarvested: 0, produced: {} },
      },
    };
  },
  /**
   * v2 (J2a) → v3 (J2b) : arrivée de la population. Les 10 couples de départ et leurs enfants
   * sont créés, sans maison ; ils emménageront dans les maisons existantes dès le premier jour.
   */
  2: (s) => {
    const domain = { ...s.domain, villagers: [], families: [], taxLevel: "normal", gameOver: null };
    const sim = DomainSim.fromState(domain);
    sim.withRng((rng) => sim.population.createStart(rng));
    sim.addLog("La population arrive : 10 familles campent autour du manoir.");
    return { ...s, saveVersion: 3, domain: sim.toJSON() };
  },
};

export function makeSave(world: WorldState, domain: DomainState, now: Date = new Date(), gameId?: string): SaveGame {
  return {
    saveVersion: SAVE_VERSION,
    ...(gameId ? { gameId } : {}),
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
