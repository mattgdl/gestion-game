/**
 * Journal de partie : ce que le joueur fait et comment son domaine évolue, écrit dans la base
 * de données de l'artefact claude.ai pour que Claude puisse analyser la partie ensuite.
 *
 * - Ne touche jamais à la simulation : il lit l'état et compte les commandes.
 * - Ne fonctionne que dans la page publiée sur claude.ai (ailleurs, il reste inactif).
 * - Le joueur peut le désactiver depuis le panneau « Partie ».
 *
 * Données écrites (collection « parties ») :
 *   parties/<partie>              état courant, temps de jeu, sauvegarde complète (pour rejouer l'analyse)
 *   parties/<partie>/bilans/an-NN un bilan à chaque fin d'automne
 */
import { RESOURCE_IDS, SAVE_VERSION } from "@jeu/shared";
import { BUILDINGS, type CheckResult, type Command, type DomainSim, type Goods } from "@jeu/sim-fief";
import type { Session } from "../game/Session";
import { serializeSave } from "../save/save";

/** Sous-ensemble de l'API `db` de l'artefact utilisé ici. */
export interface JournalDb {
  doc(path: string): { set(data: Record<string, unknown>): Promise<void> };
}

export type JournalStatus = "attente" | "actif" | "indisponible" | "desactive" | "erreur";

interface Counters {
  /** Secondes réelles par vitesse (pause comprise). */
  temps: { pause: number; x1: number; x2: number; x3: number };
  /** Commandes acceptées et refusées, par type. */
  actions: Record<string, { ok: number; refus: number }>;
  /** Raisons de refus montrées au joueur, avec leur nombre. */
  refus: Record<string, number>;
  /** Bâtiments construits, par type. */
  constructions: Record<string, number>;
}

function emptyCounters(): Counters {
  return { temps: { pause: 0, x1: 0, x2: 0, x3: 0 }, actions: {}, refus: {}, constructions: {} };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function addCounters(into: Counters, from: Counters): void {
  for (const k of ["pause", "x1", "x2", "x3"] as const) into.temps[k] += from.temps[k];
  for (const [k, v] of Object.entries(from.actions)) {
    const a = (into.actions[k] ??= { ok: 0, refus: 0 });
    a.ok += v.ok;
    a.refus += v.refus;
  }
  for (const [k, v] of Object.entries(from.refus)) into.refus[k] = (into.refus[k] ?? 0) + v;
  for (const [k, v] of Object.entries(from.constructions)) into.constructions[k] = (into.constructions[k] ?? 0) + v;
}

/** Photographie de l'état du domaine, commune à l'état courant et aux bilans. */
export function domainSnapshot(sim: DomainSim): Record<string, unknown> {
  const eco = sim.economy;
  const counts: Record<string, number> = {};
  const problems: { type: string; x: number; y: number; etat: string }[] = [];
  let unconnected = 0;
  for (const b of sim.state.buildings) {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
    if (!sim.isConnected(b.id)) unconnected += 1;
    const status = eco.status(b.id);
    if (status.blocked || status.tone === "bad" || status.tone === "warn") {
      problems.push({ type: b.type, x: b.x, y: b.y, etat: status.text });
    }
  }
  const producers = sim.state.buildings
    .filter((b) => BUILDINGS[b.type]?.production)
    .map((b) => {
      const route = eco.routesFrom(b.id)[0];
      return {
        type: b.type,
        rendement: Math.round(eco.efficiency(b.id) / 10),
        enAttente: b.stock[BUILDINGS[b.type]!.production!.ressource] ?? 0,
        distanceReserve: route ? route.distance : null,
      };
    });
  const farms = sim.state.buildings
    .filter((b) => BUILDINGS[b.type]?.agriculture)
    .map((b) => {
      const info = eco.farmInfo(b.id);
      const fert = (info?.fields ?? []).map((k) => {
        const [x, y] = sim.xy(k);
        return sim.fertilityAt(x, y) ?? 0;
      });
      return {
        champs: info?.fields.length ?? 0,
        enFriche: info?.idleNearby ?? 0,
        fertiliteMoyenne: fert.length > 0 ? Math.round(fert.reduce((a, c) => a + c, 0) / fert.length) : null,
        recolteAttendue: info?.expected ?? 0,
      };
    });
  const totals = sim.totals();
  const resources: Record<string, number> = {};
  for (const id of RESOURCE_IDS) resources[id] = totals[id];
  const date = sim.date;
  return {
    date: { annee: date.year, saison: date.seasonName, jour: date.day },
    ressources: resources,
    reserves: eco.storageUsage(),
    enAttente: eco.waiting() as Goods,
    porteursEnRoute: sim.state.deliveries.length,
    batiments: counts,
    nonRelies: unconnected,
    problemes: problems.slice(0, 20),
    ateliers: producers,
    fermes: farms,
    routes: sim.state.roads.length,
    champs: sim.state.fields.length,
  };
}

export class Journal {
  status: JournalStatus = "attente";
  lastSentAt: number | null = null;
  lastError: string | null = null;

  private db: JournalDb | null = null;
  private userId: string | null = null;
  private session: Session;
  /** Compteurs depuis le dernier bilan annuel. */
  private year = emptyCounters();
  /** Compteurs de toute la partie (hors année en cours). */
  private total = emptyCounters();
  private startedAt = new Date().toISOString();
  private sinceFlush = 0;
  /** Une seule écriture à la fois du document de la partie ; une demande pendant l'écriture est rejouée après. */
  private stateWrite: Promise<void> | null = null;
  private stateDirty = false;
  private enabled: boolean;

  constructor(
    session: Session,
    private readonly storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
    private readonly flushEverySeconds = 30,
  ) {
    this.session = session;
    this.enabled = this.storage?.getItem("seigneurie.journal") !== "off";
    if (!this.enabled) this.status = "desactive";
  }

  /** Branche la base de données de l'artefact (ou rien : le journal reste inactif). */
  attach(db: JournalDb | null, userId: string | null = null): void {
    this.db = db;
    this.userId = userId;
    if (!this.enabled) return;
    this.status = db ? "actif" : "indisponible";
    if (db) void this.flush();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      this.storage?.setItem("seigneurie.journal", on ? "on" : "off");
    } catch {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
    this.status = !on ? "desactive" : this.db ? "actif" : "indisponible";
    if (on) void this.flush();
  }

  /** Nouvelle partie ou partie chargée : on repart de compteurs neufs. */
  setSession(session: Session): void {
    if (session === this.session) return;
    void this.flush();
    this.session = session;
    this.year = emptyCounters();
    this.total = emptyCounters();
    this.startedAt = new Date().toISOString();
    void this.flush();
  }

  /** À chaque image : temps réel passé, par vitesse. */
  onFrame(deltaMs: number): void {
    const s = this.session;
    const seconds = deltaMs / 1000;
    if (s.paused) this.year.temps.pause += seconds;
    else this.year.temps[`x${s.speed}` as "x1" | "x2" | "x3"] += seconds;
    this.sinceFlush += seconds;
    if (this.sinceFlush >= this.flushEverySeconds) void this.flush();
  }

  onCommand(cmd: Command, result: CheckResult, quiet: boolean): void {
    const key = cmd.type === "build" ? `build:${cmd.building}` : cmd.type;
    const a = (this.year.actions[key] ??= { ok: 0, refus: 0 });
    if (result.ok) {
      a.ok += 1;
      if (cmd.type === "build") this.year.constructions[cmd.building] = (this.year.constructions[cmd.building] ?? 0) + 1;
    } else if (!quiet) {
      a.refus += 1;
      const reason = result.reason ?? "inconnue";
      this.year.refus[reason] = (this.year.refus[reason] ?? 0) + 1;
    }
  }

  /** Fin d'automne : bilan de l'année, puis remise à zéro des compteurs de l'année. */
  onBarrier(): void {
    const sim = this.session.sim;
    const year = sim.date.year;
    const stats = sim.state.yearStats;
    const bilan = {
      annee: year,
      ecritLe: new Date().toISOString(),
      ...domainSnapshot(sim),
      production: stats.produced,
      moisson: { nourriture: stats.harvested, champs: stats.fieldsHarvested },
      tempsReel: this.timeOf(this.year),
      actions: this.year.actions,
      refus: this.year.refus,
      constructions: this.year.constructions,
      chronique: sim.state.log.filter((l) => Math.floor(l.tick / 1800) + 1 === year).map((l) => l.text),
    };
    addCounters(this.total, this.year);
    this.year = emptyCounters();
    void this.write(`parties/${this.session.gameId}/bilans/an-${String(year).padStart(2, "0")}`, bilan);
    void this.flush();
  }

  /** Écrit l'état courant de la partie (avec la sauvegarde complète). */
  async flush(): Promise<void> {
    this.sinceFlush = 0;
    if (this.stateWrite) {
      this.stateDirty = true;
      return this.stateWrite;
    }
    this.stateWrite = this.writeState();
    try {
      await this.stateWrite;
    } finally {
      this.stateWrite = null;
    }
    if (this.stateDirty) {
      this.stateDirty = false;
      await this.flush();
    }
  }

  private async writeState(): Promise<void> {
    const all = emptyCounters();
    addCounters(all, this.total);
    addCounters(all, this.year);
    await this.write(`parties/${this.session.gameId}`, {
      partie: this.session.gameId,
      graine: this.session.world.seedText,
      joueur: this.userId,
      commenceeLe: this.startedAt,
      majLe: new Date().toISOString(),
      versionSauvegarde: SAVE_VERSION,
      tempsReel: this.timeOf(all),
      actions: all.actions,
      refus: all.refus,
      constructions: all.constructions,
      ...domainSnapshot(this.session.sim),
      sauvegarde: serializeSave(this.session.toSave()),
    });
  }

  private timeOf(c: Counters): Record<string, number> {
    const t = c.temps;
    return {
      totalS: round1(t.pause + t.x1 + t.x2 + t.x3),
      pauseS: round1(t.pause),
      x1S: round1(t.x1),
      x2S: round1(t.x2),
      x3S: round1(t.x3),
    };
  }

  private async write(path: string, data: Record<string, unknown>): Promise<void> {
    if (!this.enabled || !this.db) return;
    try {
      await this.db.doc(path).set(data);
      this.lastSentAt = Date.now();
      this.status = "actif";
      this.lastError = null;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "inconnue";
      this.lastError = code;
      if (code === "revoked" || code === "not_granted" || code === "capability_disabled" || code === "capability_removed") {
        this.status = "indisponible";
        this.db = null;
      } else {
        this.status = "erreur";
      }
    }
  }
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
