/**
 * Format de sauvegarde, versionné.
 *
 * Chaque sauvegarde porte un numéro de version (SAVE_VERSION). Quand le format change,
 * on incrémente SAVE_VERSION et on ajoute une migration dans MIGRATIONS : les vieilles
 * sauvegardes restent lisibles.
 */
import { SAVE_VERSION } from "@jeu/shared";
import { DomainSim, emptyArmy, emptyDeals, emptyDynasty, emptyEvents, emptyTrade, rollTraits, type DomainState } from "@jeu/sim-fief";
import { FIEFS, PLAYER_ID, describeLand, lineageSetupFor, setupAiLords, type WorldState } from "@jeu/sim-monde";
import { Rng, deriveSeed } from "@jeu/shared";

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
  /**
   * v3 (J2b) → v4 (retours de jeu J2b) : accueil des nouveaux venus, au rythme normal
   * (une famille par an au plus).
   */
  3: (s) => ({ ...s, saveVersion: 4, domain: { ...s.domain, immigration: "normale" } }),
  /**
   * v4 → v5 (J3) : arrivée de la lignée. Le fondateur, son épouse et leur enfant s'installent
   * au manoir, avec la loi de succession par défaut.
   */
  4: (s) => {
    const sim = DomainSim.fromState({ ...s.domain, dynasty: emptyDynasty() });
    sim.withRng((rng) => sim.dynasty.createStart(rng, lineageSetupFor(s.world, s.domain.ownerId ?? PLAYER_ID)));
    sim.addLog(`La ${sim.state.dynasty.name} s'installe au manoir.`);
    return { ...s, saveVersion: 5, domain: sim.toJSON() };
  },
  /**
   * v5 → v6 (J4) : les fiefs voisins reçoivent leur village et la description de leur terrain ;
   * le domaine garde les dimensions du monde (pour les fiefs achetés), ses offres et son titre.
   * La carte d'une vieille partie ne change pas de taille.
   */
  5: (s) => {
    const world = s.world;
    const v = FIEFS.village;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    world.fiefs = world.fiefs.map((f: any) => {
      const rng = new Rng(deriveSeed(world.dims.seed, `village-${f.id}`));
      const ai = typeof f.ownerId === "string" && f.ownerId.startsWith("ia-");
      return { ...f, households: ai ? rng.int(v.foyersMin, v.foyersMax0) : 0, land: describeLand(world.dims, f.col, f.row) };
    });
    const domain = { ...s.domain, dims: world.dims, offers: [], dynasty: { ...s.domain.dynasty, title: "seigneur" } };
    return { ...s, saveVersion: 6, world, domain };
  },
  /** v6 → v7 (J4b) : besoins du village (outils, vêtements), épidémie, foire d'automne. */
  6: (s) => ({
    ...s,
    saveVersion: 7,
    domain: {
      ...s.domain,
      needs: { outils: { owed: 0, coverage: 0 }, vetements: { owed: 0, coverage: 0 } },
      epidemic: null,
      fair: { year: 0, bought: {}, sold: {} },
    },
  }),
  /**
   * v7 → v8 (J5) : les seigneurs IA reçoivent leur archétype, leur or, leurs réserves et leur
   * relation avec le joueur (tirés de la graine du monde) ; le commerce commence vide.
   */
  7: (s) => {
    const world = { ...s.world, agreements: [], proposals: [] };
    setupAiLords(world);
    return { ...s, saveVersion: 8, world, domain: { ...s.domain, trade: emptyTrade() } };
  },
  /** v8 → v9 (J6) : guerres et armées (aucune guerre en cours, pas d'armée). */
  8: (s) => ({ ...s, saveVersion: 9, world: { ...s.world, wars: [], armies: {} }, domain: { ...s.domain, army: emptyArmy() } }),
  /** v9 → v10 (J7) : affaires entre joueurs (offres reçues, réponses), vides. */
  9: (s) => ({ ...s, saveVersion: 10, world: { ...s.world, fiefOffers: [] }, domain: { ...s.domain, deals: emptyDeals() } }),
  // Réglage du 20/11 : trêves après un pillage ou une conquête (aucune en cours).
  10: (s) => ({ ...s, saveVersion: 11, world: { ...s.world, truces: {} } }),
  // J8 : événements (aucun en cours) et traits des personnages, tirés comme pour une lignée neuve.
  11: (s) => {
    const dyn = s.domain.dynasty;
    const members = dyn.members.map((m: { id: number; name: string; birthTick: number; traits?: string[] }) => ({ ...m, traits: m.traits ?? rollTraits(`${dyn.name}|${m.id}|${m.name}|${m.birthTick}`) }));
    return { ...s, saveVersion: 12, domain: { ...s.domain, events: emptyEvents(), dynasty: { ...dyn, members } } };
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
