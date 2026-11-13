/**
 * DomainSim : la couche Fief d'un joueur.
 *
 * - Contient l'état sérialisable (DomainState) et un index calculé (non sauvegardé)
 *   pour savoir vite ce qui occupe chaque tuile.
 * - Ne lit jamais l'état du Monde : elle reçoit ses fiefs à la création et les
 *   résultats de la barrière annuelle par messages.
 * - Aucun import de Phaser : testable sans affichage.
 */
import {
  RESOURCE_IDS,
  RESOURCE_NAMES,
  Rng,
  TERRAIN_KEYS,
  TERRAIN_NAMES,
  Terrain,
  deriveSeed,
  generateFiefTerrain,
  type BarrierResult,
  type Cost,
  type FiefSummary,
  type ResourceId,
  type TerrainId,
  type WorldDims,
} from "@jeu/shared";
import type { CheckResult, Command } from "./commands";
import { BUILDINGS, ECONOMY, type BuildingDef } from "./data";
import type { Building, DomainState, FiefTiles } from "./state";
import { connectedRoads } from "./systems/roads";
import { BARRIER_OFFSET, TICKS_PER_SEASON, TICKS_PER_YEAR, dateOf, type GameDate } from "./systems/seasons";

export type Occupant = { kind: "building"; id: number } | { kind: "road" } | { kind: "field" };

export type SimEvent =
  | { type: "seasonChanged"; date: GameDate }
  | { type: "newYear"; year: number }
  | { type: "barrier" };

export interface DomainInit {
  ownerId: string;
  dims: WorldDims;
  /** Fiefs attribués à ce domaine par le Monde. */
  fiefs: { id: string; col: number; row: number }[];
}

const LOG_MAX = 40;

export class DomainSim {
  readonly state: DomainState;
  /** Augmente à chaque changement de la carte (pour que l'affichage sache quoi redessiner). */
  mapVersion = 0;

  private occupancy = new Map<number, Occupant>();
  private buildingsById = new Map<number, Building>();
  private roadSet = new Set<number>();
  private fieldSet = new Set<number>();
  private connectedRoadCache: Set<number> | null = null;

  private constructor(state: DomainState) {
    this.state = state;
    this.rebuildIndex();
  }

  // ---------------------------------------------------------------- création

  static create(init: DomainInit): DomainSim {
    const { dims } = init;
    const fiefs: Record<string, FiefTiles> = {};
    for (const f of init.fiefs) {
      const t = generateFiefTerrain(dims, f.col, f.row);
      fiefs[f.id] = {
        id: f.id,
        col: f.col,
        row: f.row,
        originX: f.col * dims.fiefSize,
        originY: f.row * dims.fiefSize,
        size: dims.fiefSize,
        terrain: t.terrain,
        fertility: t.fertility,
      };
    }
    const state: DomainState = {
      ownerId: init.ownerId,
      worldWidth: dims.cols * dims.fiefSize,
      worldHeight: dims.rows * dims.fiefSize,
      fiefSize: dims.fiefSize,
      tick: 0,
      rngState: deriveSeed(dims.seed, `domaine-${init.ownerId}`),
      resources: { ...ECONOMY.ressourcesDepart },
      fiefs,
      buildings: [],
      roads: [],
      fields: [],
      nextId: 1,
      log: [],
      awaitingBarrier: false,
      lastBarrierTick: -1,
    };
    const sim = new DomainSim(state);
    sim.placeStartingManor(dims);
    sim.addLog("Votre lignée s'installe sur ses terres. Printemps de l'an 1.");
    return sim;
  }

  /** Recrée la simulation à partir d'un état sauvegardé. */
  static fromState(state: DomainState): DomainSim {
    return new DomainSim(structuredClone(state));
  }

  /** Copie complète de l'état, prête à être sauvegardée en JSON. */
  toJSON(): DomainState {
    return structuredClone(this.state);
  }

  private placeStartingManor(dims: WorldDims): void {
    const start = dims.startFief;
    const fief = start ? Object.values(this.state.fiefs).find((f) => f.col === start.col && f.row === start.row) : undefined;
    const target = fief ?? Object.values(this.state.fiefs)[0];
    if (!target) return;
    const center = Math.floor(target.size / 2);
    const cx = target.originX + center;
    const cy = target.originY + center;
    const manor: Building = { id: this.state.nextId++, type: "manoir", x: cx - 1, y: cy - 1, fiefId: target.id };
    this.state.buildings.push(manor);
    for (let i = 0; i < ECONOMY.routesDepart; i++) {
      this.state.roads.push(this.key(cx, cy + 2 + i));
    }
    this.rebuildIndex();
  }

  // ---------------------------------------------------------------- index

  private rebuildIndex(): void {
    this.occupancy.clear();
    this.buildingsById.clear();
    this.roadSet = new Set(this.state.roads);
    this.fieldSet = new Set(this.state.fields);
    for (const b of this.state.buildings) {
      this.buildingsById.set(b.id, b);
      for (const k of this.footprint(b.type, b.x, b.y)) this.occupancy.set(k, { kind: "building", id: b.id });
    }
    for (const k of this.state.roads) this.occupancy.set(k, { kind: "road" });
    for (const k of this.state.fields) this.occupancy.set(k, { kind: "field" });
    this.invalidate();
  }

  private invalidate(): void {
    this.connectedRoadCache = null;
    this.mapVersion += 1;
  }

  // ---------------------------------------------------------------- lecture

  key(x: number, y: number): number {
    return y * this.state.worldWidth + x;
  }

  xy(key: number): [number, number] {
    return [key % this.state.worldWidth, Math.floor(key / this.state.worldWidth)];
  }

  get date(): GameDate {
    return dateOf(this.state.tick);
  }

  /** Fief possédé contenant la tuile, ou undefined si la tuile n'est pas à nous. */
  fiefAt(x: number, y: number): FiefTiles | undefined {
    if (x < 0 || y < 0 || x >= this.state.worldWidth || y >= this.state.worldHeight) return undefined;
    const S = this.state.fiefSize;
    const col = Math.floor(x / S);
    const row = Math.floor(y / S);
    for (const f of Object.values(this.state.fiefs)) {
      if (f.col === col && f.row === row) return f;
    }
    return undefined;
  }

  terrainAt(x: number, y: number): TerrainId | undefined {
    const f = this.fiefAt(x, y);
    if (!f) return undefined;
    return f.terrain[(y - f.originY) * f.size + (x - f.originX)] as TerrainId;
  }

  fertilityAt(x: number, y: number): number | undefined {
    const f = this.fiefAt(x, y);
    if (!f) return undefined;
    return f.fertility[(y - f.originY) * f.size + (x - f.originX)];
  }

  occupantAt(x: number, y: number): Occupant | undefined {
    return this.occupancy.get(this.key(x, y));
  }

  building(id: number): Building | undefined {
    return this.buildingsById.get(id);
  }

  buildingAt(x: number, y: number): Building | undefined {
    const o = this.occupantAt(x, y);
    return o?.kind === "building" ? this.buildingsById.get(o.id) : undefined;
  }

  /** Clés des tuiles occupées par un bâtiment de ce type posé en (x, y). */
  footprint(type: string, x: number, y: number): number[] {
    const def = BUILDINGS[type];
    if (!def) return [];
    const [w, h] = def.taille;
    const out: number[] = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push(this.key(x + dx, y + dy));
    return out;
  }

  /** Routes reliées au manoir. */
  connectedRoads(): Set<number> {
    if (!this.connectedRoadCache) {
      const manor = this.state.buildings.find((b) => b.type === "manoir");
      this.connectedRoadCache = connectedRoads({
        worldWidth: this.state.worldWidth,
        roads: this.roadSet,
        rootTiles: manor ? this.footprint(manor.type, manor.x, manor.y) : [],
      });
    }
    return this.connectedRoadCache;
  }

  /** Un bâtiment est relié si une route reliée au manoir touche un de ses côtés. */
  isConnected(buildingId: number): boolean {
    const b = this.buildingsById.get(buildingId);
    if (!b) return false;
    if (b.type === "manoir") return true;
    const roads = this.connectedRoads();
    const def = BUILDINGS[b.type];
    if (!def) return false;
    const [w, h] = def.taille;
    for (let dx = 0; dx < w; dx++) {
      if (roads.has(this.key(b.x + dx, b.y - 1)) || roads.has(this.key(b.x + dx, b.y + h))) return true;
    }
    for (let dy = 0; dy < h; dy++) {
      if (b.x > 0 && roads.has(this.key(b.x - 1, b.y + dy))) return true;
      if (b.x + w < this.state.worldWidth && roads.has(this.key(b.x + w, b.y + dy))) return true;
    }
    return false;
  }

  summary(): FiefSummary {
    return {
      ownerId: this.state.ownerId,
      fiefIds: Object.keys(this.state.fiefs).sort(),
      population: 0,
      gold: this.state.resources.or,
      prestige: 0,
      lineageAlive: true,
    };
  }

  // ---------------------------------------------------------------- commandes

  check(cmd: Command): CheckResult {
    switch (cmd.type) {
      case "build":
        return this.checkBuild(cmd.building, cmd.x, cmd.y);
      case "road":
        return this.checkRoad(cmd.x, cmd.y);
      case "field":
        return this.checkField(cmd.x, cmd.y);
      case "demolish":
        return this.checkDemolish(cmd.x, cmd.y);
    }
  }

  apply(cmd: Command): CheckResult {
    const result = this.check(cmd);
    if (!result.ok) return result;
    if (result.cost) this.pay(result.cost);
    switch (cmd.type) {
      case "build": {
        const fief = this.fiefAt(cmd.x, cmd.y) as FiefTiles;
        const b: Building = { id: this.state.nextId++, type: cmd.building, x: cmd.x, y: cmd.y, fiefId: fief.id };
        this.state.buildings.push(b);
        break;
      }
      case "road": {
        const k = this.key(cmd.x, cmd.y);
        if (this.terrainAt(cmd.x, cmd.y) === Terrain.Foret) this.setTerrain(cmd.x, cmd.y, Terrain.Herbe);
        this.state.roads.push(k);
        break;
      }
      case "field":
        this.state.fields.push(this.key(cmd.x, cmd.y));
        break;
      case "demolish":
        this.demolishAt(cmd.x, cmd.y, result.refund ?? {});
        break;
    }
    this.rebuildIndex();
    return result;
  }

  private checkBuild(type: string, x: number, y: number): CheckResult {
    const def = BUILDINGS[type];
    if (!def || !def.constructible) return { ok: false, reason: "Ce bâtiment ne peut pas être construit." };
    if (def.unique && this.state.buildings.some((b) => b.type === type)) {
      return { ok: false, reason: `Un seul exemplaire possible : ${def.nom}.` };
    }
    const [w, h] = def.taille;
    let fiefId: string | null = null;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        const fief = this.fiefAt(tx, ty);
        if (!fief) return { ok: false, reason: "Hors de votre domaine." };
        if (fiefId === null) fiefId = fief.id;
        else if (fiefId !== fief.id) return { ok: false, reason: "Le bâtiment doit tenir entièrement dans un seul fief." };
        const terrain = this.terrainAt(tx, ty) as TerrainId;
        if (terrain !== Terrain.Herbe) return { ok: false, reason: `Terrain impropre : ${TERRAIN_NAMES[terrain].toLowerCase()}.` };
        if (this.occupancy.has(this.key(tx, ty))) return { ok: false, reason: "Emplacement occupé." };
      }
    }
    if (def.procheDe) {
      const wanted = TERRAIN_KEYS[def.procheDe.terrain];
      if (wanted !== undefined && !this.terrainNear(x, y, w, h, wanted, def.procheDe.rayon)) {
        return {
          ok: false,
          reason: `Doit se trouver à moins de ${def.procheDe.rayon} cases de : ${TERRAIN_NAMES[wanted].toLowerCase()}.`,
        };
      }
    }
    return this.withCost(def.cout);
  }

  private checkRoad(x: number, y: number): CheckResult {
    if (!this.fiefAt(x, y)) return { ok: false, reason: "Hors de votre domaine." };
    const terrain = this.terrainAt(x, y) as TerrainId;
    if (terrain !== Terrain.Herbe && terrain !== Terrain.Foret) {
      return { ok: false, reason: `Une route ne peut pas passer sur : ${TERRAIN_NAMES[terrain].toLowerCase()}.` };
    }
    const occ = this.occupantAt(x, y);
    if (occ?.kind === "road") return { ok: false, reason: "Il y a déjà une route ici." };
    if (occ) return { ok: false, reason: "Emplacement occupé." };
    return this.withCost(ECONOMY.coutRoute);
  }

  private checkField(x: number, y: number): CheckResult {
    if (!this.fiefAt(x, y)) return { ok: false, reason: "Hors de votre domaine." };
    const terrain = this.terrainAt(x, y) as TerrainId;
    if (terrain !== Terrain.Herbe) return { ok: false, reason: `Terrain impropre : ${TERRAIN_NAMES[terrain].toLowerCase()}.` };
    const occ = this.occupantAt(x, y);
    if (occ?.kind === "field") return { ok: false, reason: "Il y a déjà un champ ici." };
    if (occ) return { ok: false, reason: "Emplacement occupé." };
    if (!this.nearFarm(x, y)) {
      const radius = BUILDINGS.ferme?.rayonChamps ?? 4;
      return { ok: false, reason: `Un champ doit être à moins de ${radius} cases d'une ferme.` };
    }
    return this.withCost(ECONOMY.coutChamp);
  }

  private checkDemolish(x: number, y: number): CheckResult {
    const occ = this.occupantAt(x, y);
    if (!occ) return { ok: false, reason: "Rien à démolir ici." };
    if (occ.kind === "field") return { ok: true, refund: {} };
    if (occ.kind === "road") return { ok: true, refund: this.refundOf(ECONOMY.coutRoute) };
    const b = this.buildingsById.get(occ.id);
    const def = b ? BUILDINGS[b.type] : undefined;
    if (!b || !def) return { ok: false, reason: "Rien à démolir ici." };
    if (b.type === "manoir") return { ok: false, reason: "Le manoir ne peut pas être démoli." };
    return { ok: true, refund: this.refundOf(def.cout) };
  }

  private demolishAt(x: number, y: number, refund: Cost): void {
    const occ = this.occupantAt(x, y);
    if (!occ) return;
    const k = this.key(x, y);
    if (occ.kind === "road") {
      this.state.roads = this.state.roads.filter((r) => r !== k);
    } else if (occ.kind === "field") {
      this.state.fields = this.state.fields.filter((f) => f !== k);
    } else {
      const b = this.buildingsById.get(occ.id);
      this.state.buildings = this.state.buildings.filter((other) => other.id !== occ.id);
      if (b?.type === "ferme") this.removeOrphanFields();
    }
    for (const id of RESOURCE_IDS) this.state.resources[id] += refund[id] ?? 0;
  }

  /** Les champs qui ne sont plus près d'aucune ferme sont abandonnés. */
  private removeOrphanFields(): void {
    this.rebuildIndex();
    const before = this.state.fields.length;
    this.state.fields = this.state.fields.filter((k) => {
      const [fx, fy] = this.xy(k);
      return this.nearFarm(fx, fy);
    });
    const lost = before - this.state.fields.length;
    if (lost > 0) this.addLog(`${lost} champ${lost > 1 ? "s" : ""} sans ferme abandonné${lost > 1 ? "s" : ""}.`);
  }

  private nearFarm(x: number, y: number): boolean {
    const radius = BUILDINGS.ferme?.rayonChamps ?? 4;
    for (const b of this.state.buildings) {
      if (b.type !== "ferme") continue;
      const def = BUILDINGS[b.type] as BuildingDef;
      const [w, h] = def.taille;
      const dx = x < b.x ? b.x - x : x >= b.x + w ? x - (b.x + w - 1) : 0;
      const dy = y < b.y ? b.y - y : y >= b.y + h ? y - (b.y + h - 1) : 0;
      if (Math.max(dx, dy) <= radius) return true;
    }
    return false;
  }

  private terrainNear(x: number, y: number, w: number, h: number, terrain: TerrainId, radius: number): boolean {
    for (let ty = y - radius; ty < y + h + radius; ty++) {
      for (let tx = x - radius; tx < x + w + radius; tx++) {
        if (this.terrainAt(tx, ty) === terrain) return true;
      }
    }
    return false;
  }

  private withCost(cost: Cost): CheckResult {
    for (const id of RESOURCE_IDS) {
      const need = cost[id] ?? 0;
      if (need > this.state.resources[id]) {
        return { ok: false, reason: `Pas assez de ${RESOURCE_NAMES[id].toLowerCase()} (il en faut ${need}).`, cost };
      }
    }
    return { ok: true, cost };
  }

  private refundOf(cost: Cost): Cost {
    const out: Cost = {};
    for (const id of RESOURCE_IDS) {
      const v = Math.floor((cost[id] ?? 0) * ECONOMY.remboursementDemolition);
      if (v > 0) out[id] = v;
    }
    return out;
  }

  private pay(cost: Cost): void {
    for (const id of RESOURCE_IDS) this.state.resources[id] -= cost[id] ?? 0;
  }

  private setTerrain(x: number, y: number, terrain: TerrainId): void {
    const f = this.fiefAt(x, y);
    if (!f) return;
    f.terrain[(y - f.originY) * f.size + (x - f.originX)] = terrain;
  }

  // ---------------------------------------------------------------- temps

  /**
   * Avance la simulation d'un tick (pas fixe).
   * S'arrête sur la barrière annuelle (fin de l'automne) jusqu'à sa résolution.
   */
  step(): SimEvent[] {
    const s = this.state;
    if (s.awaitingBarrier) return [];
    if ((s.tick + 1) % TICKS_PER_YEAR === BARRIER_OFFSET && s.lastBarrierTick !== s.tick) {
      s.awaitingBarrier = true;
      return [{ type: "barrier" }];
    }
    s.tick += 1;
    const events: SimEvent[] = [];
    if (s.tick % TICKS_PER_SEASON === 0) {
      const date = dateOf(s.tick);
      if (date.seasonIndex === 0) {
        events.push({ type: "newYear", year: date.year });
        this.addLog(`L'an ${date.year} commence.`);
      }
      events.push({ type: "seasonChanged", date });
      if (date.seasonIndex !== 0) this.addLog(`${date.seasonName} de l'an ${date.year}.`);
    }
    // Systèmes à venir : production (J2a), population (J2b), dynastie (J3).
    return events;
  }

  /** Applique ce que le Monde a décidé à la barrière, puis libère le temps. */
  applyBarrierResult(result: BarrierResult): void {
    for (const e of result.events) {
      if (e.type === "info" && (e.ownerId === null || e.ownerId === this.state.ownerId)) this.addLog(e.text);
    }
    this.state.awaitingBarrier = false;
    this.state.lastBarrierTick = this.state.tick;
  }

  // ---------------------------------------------------------------- divers

  addLog(text: string): void {
    this.state.log.push({ tick: this.state.tick, text });
    if (this.state.log.length > LOG_MAX) this.state.log.splice(0, this.state.log.length - LOG_MAX);
  }

  /** Générateur aléatoire du domaine (état sauvegardé). Réservé aux systèmes de J2+. */
  withRng<T>(fn: (rng: Rng) => T): T {
    const rng = new Rng(this.state.rngState);
    const out = fn(rng);
    this.state.rngState = rng.state;
    return out;
  }
}

export function resourceName(id: ResourceId): string {
  return RESOURCE_NAMES[id];
}
