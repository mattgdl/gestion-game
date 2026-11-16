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
  deNom,
  deriveSeed,
  generateFiefTerrain,
  type BarrierResult,
  type Cost,
  type FiefSummary,
  type LineageSetup,
  type ProposeAction,
  type ResourceId,
  type Resources,
  type TerrainId,
  type WorldDims,
} from "@jeu/shared";
import type { CheckResult, Command } from "./commands";
import { BUILDINGS, DEMOGRAPHY, ECONOMY, TITLES, titleDef, type BuildingDef } from "./data";
import { GOOD_IDS, IMMIGRATION_LEVELS, SUCCESSION_LAWS, emptyYearStats, type Building, type DomainState, type FiefTiles, type Goods } from "./state";
import { Dynasty, bySex, emptyDynasty } from "./systems/dynasty";
import { annexFief } from "./systems/annex";
import { Economy, goodsTotal } from "./systems/economy";
import { DAY_TICKS, Population } from "./systems/population";
import { connectedRoads } from "./systems/roads";
import { BARRIER_OFFSET, TICKS_PER_SEASON, TICKS_PER_YEAR, dateOf, type GameDate } from "./systems/seasons";

export type Occupant = { kind: "building"; id: number } | { kind: "road" } | { kind: "field" };

export type SimEvent =
  | { type: "seasonChanged"; date: GameDate }
  | { type: "newYear"; year: number }
  | { type: "barrier" }
  | { type: "gameOver" }
  /** Le seigneur est mort et un héritier lui succède. */
  | { type: "succession"; deadId: number; heirId: number }
  /** Un membre de la lignée atteint sa majorité : une décision attend le joueur. */
  | { type: "familyMatter"; memberId: number }
  /** Un fief acheté rejoint le domaine (J4). */
  | { type: "fiefAcquired"; fiefId: string; name: string; price: number }
  /** Une offre d'achat est refusée : l'or revient au trésor. */
  | { type: "offerRefused"; fiefId: string; reason: string }
  /** Un nouveau titre est atteint (J4). */
  | { type: "title"; title: string };

export interface DomainInit {
  ownerId: string;
  dims: WorldDims;
  /** Fiefs attribués à ce domaine par le Monde. */
  fiefs: { id: string; col: number; row: number }[];
  /** Nom de la maison et maisons voisines (J3). */
  lineage?: LineageSetup;
}

const LOG_MAX = 40;

export class DomainSim {
  readonly state: DomainState;
  /** Augmente à chaque changement de la carte (pour que l'affichage sache quoi redessiner). */
  mapVersion = 0;
  /** Augmente à chaque changement de l'état des cultures (semailles, moisson). */
  cropVersion = 0;
  readonly economy: Economy;
  readonly population: Population;
  readonly dynasty: Dynasty;

  private occupancy = new Map<number, Occupant>();
  private buildingsById = new Map<number, Building>();
  private roadSet = new Set<number>();
  private fieldSet = new Set<number>();
  private connectedRoadCache: Set<number> | null = null;
  /** Placement sans coût ni contrôle « constructible » (village d'un fief acheté). */
  private freeBuild = false;

  private constructor(state: DomainState) {
    this.state = state;
    this.population = new Population(this);
    this.dynasty = new Dynasty(this);
    this.economy = new Economy(this);
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
      treasury: ECONOMY.ressourcesDepart.or,
      fiefs,
      buildings: [],
      roads: [],
      fields: [],
      crops: {},
      deliveries: [],
      yearStats: emptyYearStats(1),
      villagers: [],
      families: [],
      taxLevel: "normal",
      immigration: "normale",
      dynasty: emptyDynasty(),
      dims,
      offers: [],
      gameOver: null,
      nextId: 1,
      log: [],
      awaitingBarrier: false,
      lastBarrierTick: -1,
    };
    const sim = new DomainSim(state);
    sim.placeStartingManor(dims);
    sim.withRng((rng) => sim.population.createStart(rng));
    sim.withRng((rng) => sim.dynasty.createStart(rng, init.lineage ?? { houseName: "Votre lignée", neighbors: [] }));
    const lord = sim.dynasty.lord;
    sim.addLog(`La ${sim.state.dynasty.name} s'installe sur ses terres${lord ? ` : ${lord.name} en est le seigneur` : ""}. Printemps de l'an 1.`);
    sim.addLog("Conseil : un bûcheron près de la forêt, relié au manoir par une route, fournira du bois.");
    sim.addLog("Conseil : les champs se sèment au printemps et se moissonnent à l'automne.");
    sim.addLog(`${sim.state.families.length} familles campent autour du manoir : bâtissez-leur des maisons avant l'hiver.`);
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
    const goods = ECONOMY.ressourcesDepart;
    const manor = this.newBuilding("manoir", cx - 1, cy - 1, target.id);
    manor.stock = { nourriture: goods.nourriture, bois: goods.bois, pierre: goods.pierre };
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

  /** Cases de route (lecture seule). */
  roadTiles(): ReadonlySet<number> {
    return this.roadSet;
  }

  /** Cases qui touchent un côté du bâtiment (sans les coins), dans les limites de la carte. */
  /** Cases qui bordent un bâtiment de ce type posé en (x, y). */
  perimeterOf(type: string, x: number, y: number): number[] {
    return this.perimeter({ id: -1, type, x, y, fiefId: "", stock: {}, progress: 0, lastWork: 0 });
  }

  /** Après l'ajout d'un fief : index et affichage à refaire. */
  refreshMap(): void {
    this.rebuildIndex();
  }

  /** Pose sans coût (village d'un fief acheté). */
  withFreeBuild<T>(fn: () => T): T {
    this.freeBuild = true;
    try {
      return fn();
    } finally {
      this.freeBuild = false;
    }
  }

  perimeter(b: Building): number[] {
    const def = BUILDINGS[b.type];
    if (!def) return [];
    const [w, h] = def.taille;
    const out: number[] = [];
    const W = this.state.worldWidth;
    const H = this.state.worldHeight;
    for (let dx = 0; dx < w; dx++) {
      if (b.y > 0) out.push(this.key(b.x + dx, b.y - 1));
      if (b.y + h < H) out.push(this.key(b.x + dx, b.y + h));
    }
    for (let dy = 0; dy < h; dy++) {
      if (b.x > 0) out.push(this.key(b.x - 1, b.y + dy));
      if (b.x + w < W) out.push(this.key(b.x + w, b.y + dy));
    }
    return out;
  }

  /** Distance (en cases, déplacement en diagonale compris) entre une case et l'emprise d'un bâtiment. */
  distanceToBuilding(b: Building, x: number, y: number): number {
    const def = BUILDINGS[b.type];
    const [w, h] = def ? def.taille : [1, 1];
    const dx = x < b.x ? b.x - x : x >= b.x + w ? x - (b.x + w - 1) : 0;
    const dy = y < b.y ? b.y - y : y >= b.y + h ? y - (b.y + h - 1) : 0;
    return Math.max(dx, dy);
  }

  /** Ressources disponibles pour construire : réserves + trésor. */
  totals(): Resources {
    return this.economy.totals();
  }

  /** Routes reliées au manoir. */
  connectedRoads(): Set<number> {
    if (!this.connectedRoadCache) {
      // Le manoir et les maisons fortes des fiefs achetés sont les points de départ des routes.
      const roots = this.state.buildings.filter((b) => b.type === "manoir" || b.type === "maisonforte");
      this.connectedRoadCache = connectedRoads({
        worldWidth: this.state.worldWidth,
        roads: this.roadSet,
        rootTiles: roots.flatMap((b) => this.footprint(b.type, b.x, b.y)),
      });
    }
    return this.connectedRoadCache;
  }

  /** Un bâtiment est relié si une route reliée au manoir touche un de ses côtés. */
  isConnected(buildingId: number): boolean {
    const b = this.buildingsById.get(buildingId);
    if (!b) return false;
    if (b.type === "manoir" || b.type === "maisonforte") return true;
    const roads = this.connectedRoads();
    return this.perimeter(b).some((k) => roads.has(k));
  }

  private checkOffer(fiefId: string, price: number): CheckResult {
    const m = /^f-(\d+)-(\d+)$/.exec(fiefId);
    const dims = this.state.dims;
    if (!m) return { ok: false, reason: "Fief inconnu." };
    const col = Number(m[1]);
    const row = Number(m[2]);
    if (col >= dims.cols || row >= dims.rows) return { ok: false, reason: "Fief inconnu." };
    if (this.state.fiefs[fiefId]) return { ok: false, reason: "Ce fief est déjà à vous." };
    const touches = Object.values(this.state.fiefs).some((f) => Math.abs(f.col - col) + Math.abs(f.row - row) === 1);
    if (!touches) return { ok: false, reason: "On ne peut acheter qu'un fief qui touche l'un des vôtres." };
    if (this.state.offers.some((o) => o.fiefId === fiefId)) return { ok: false, reason: "Une offre est déjà en cours pour ce fief." };
    if (!Number.isInteger(price) || price < 1) return { ok: false, reason: "Proposez un prix en or (nombre entier)." };
    if (price > this.state.treasury) return { ok: false, reason: `Pas assez d'or : vous avez ${this.state.treasury} or.` };
    return { ok: true };
  }

  /** Titre atteint selon le nombre de fiefs et d'habitants ; un titre obtenu reste acquis. */
  checkTitle(): void {
    const d = this.state.dynasty;
    const fiefs = Object.keys(this.state.fiefs).length;
    const people = this.state.villagers.length;
    const current = TITLES.findIndex((t) => t.id === d.title);
    let reached = current;
    for (let i = current + 1; i < TITLES.length; i++) {
      const t = TITLES[i]!;
      if (fiefs >= t.fiefs && people >= t.habitants) reached = i;
    }
    if (reached <= current) return;
    const t = TITLES[reached]!;
    d.title = t.id;
    const lord = this.dynasty.lord;
    const name = lord ? bySex(lord.sex, t.nomM, t.nomF) : t.nomM;
    const text = `${lord ? lord.name : "Le seigneur"} devient ${name} : ${fiefs} fiefs et ${people} habitants (+${t.prestige} prestige, moral +${t.moral}).`;
    this.addLog(text);
    this.dynasty.chronicle(text);
    this.barrierEvents.push({ type: "title", title: t.id });
  }

  /** Titre actuel du seigneur, accordé à son sexe (« baronne »). */
  titleName(): string {
    const t = titleDef(this.state.dynasty.title) ?? TITLES[0]!;
    const lord = this.dynasty.lord;
    return lord ? bySex(lord.sex, t.nomM, t.nomF) : t.nomM;
  }

  summary(): FiefSummary {
    return {
      ownerId: this.state.ownerId,
      fiefIds: Object.keys(this.state.fiefs).sort(),
      population: this.state.villagers.length,
      gold: this.state.treasury,
      prestige: this.dynasty.prestige().total,
      lineageAlive: this.state.dynasty.lordId !== null,
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
      case "setWorkers": {
        const b = this.buildingsById.get(cmd.buildingId);
        const max = b ? (BUILDINGS[b.type]?.travailleurs ?? 0) : 0;
        if (!b || max === 0) return { ok: false, reason: "Ce bâtiment n'emploie personne." };
        if (!Number.isInteger(cmd.count) || cmd.count < 0 || cmd.count > max) return { ok: false, reason: `Entre 0 et ${max} travailleurs.` };
        return { ok: true };
      }
      case "setTax":
        return ["aucun", "normal", "lourd"].includes(cmd.level) ? { ok: true } : { ok: false, reason: "Niveau d'impôt inconnu." };
      case "setImmigration":
        return IMMIGRATION_LEVELS.includes(cmd.level) ? { ok: true } : { ok: false, reason: "Niveau d'accueil inconnu." };
      case "decreeLaw":
        if (!SUCCESSION_LAWS.includes(cmd.law)) return { ok: false, reason: "Loi de succession inconnue." };
        return this.dynasty.checkDecree(cmd.law);
      case "familyDecision":
        return this.dynasty.checkDecision(cmd.memberId, cmd.choice);
      case "makeOffer":
        return this.checkOffer(cmd.fiefId, cmd.price);
      case "cancelOffer":
        return this.state.offers.some((o) => o.fiefId === cmd.fiefId) ? { ok: true } : { ok: false, reason: "Aucune offre en cours pour ce fief." };
    }
  }

  apply(cmd: Command): CheckResult {
    const result = this.check(cmd);
    if (!result.ok) return result;
    if (cmd.type === "setWorkers") {
      const b = this.buildingsById.get(cmd.buildingId) as Building;
      const max = BUILDINGS[b.type]?.travailleurs ?? 0;
      if (cmd.count >= max) delete b.workersLimit;
      else b.workersLimit = cmd.count;
      this.population.version += 1;
      return result;
    }
    if (cmd.type === "decreeLaw") {
      this.dynasty.decree(cmd.law);
      return result;
    }
    if (cmd.type === "familyDecision") {
      this.dynasty.applyDecision(cmd.memberId, cmd.choice);
      return result;
    }
    if (cmd.type === "makeOffer") {
      this.state.treasury -= cmd.price;
      this.state.offers.push({ actionId: `${this.state.ownerId}-${this.state.tick}-${cmd.fiefId}`, fiefId: cmd.fiefId, price: cmd.price, tick: this.state.tick });
      this.addLog(`Offre de ${cmd.price} or pour un fief voisin : l'or est mis de côté jusqu'au bilan d'automne.`);
      return result;
    }
    if (cmd.type === "cancelOffer") {
      const offer = this.state.offers.find((o) => o.fiefId === cmd.fiefId) as { price: number };
      this.state.treasury += offer.price;
      this.state.offers = this.state.offers.filter((o) => o.fiefId !== cmd.fiefId);
      this.addLog(`Offre retirée : ${offer.price} or reviennent au trésor.`);
      return result;
    }
    if (cmd.type === "setTax" || cmd.type === "setImmigration") {
      if (cmd.type === "setTax") this.state.taxLevel = cmd.level;
      else this.state.immigration = cmd.level;
      for (const f of this.state.families) f.morale = this.population.moraleOf(f, this.date.seasonIndex).total;
      return result;
    }
    if (result.cost) this.pay(result.cost);
    switch (cmd.type) {
      case "build": {
        const fief = this.fiefAt(cmd.x, cmd.y) as FiefTiles;
        this.state.buildings.push(this.newBuilding(cmd.building, cmd.x, cmd.y, fief.id));
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
        return result;
    }
    this.rebuildIndex();
    return result;
  }

  private checkBuild(type: string, x: number, y: number): CheckResult {
    const def = BUILDINGS[type];
    if (!def || (!def.constructible && !this.freeBuild)) return { ok: false, reason: "Ce bâtiment ne peut pas être construit." };
    if (def.unique && this.state.buildings.some((b) => b.type === type)) {
      return { ok: false, reason: `Un seul exemplaire possible : ${def.nom}.` };
    }
    const [w, h] = def.taille;
    if (def.uniqueParFief) {
      const here = this.fiefAt(x, y);
      if (here && this.state.buildings.some((b) => b.type === type && b.fiefId === here.id)) {
        return { ok: false, reason: `Un seul exemplaire par fief : ${def.nom}.` };
      }
    }
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
    if (b.type === "maisonforte") return { ok: false, reason: "La maison forte ne peut pas être démolie." };
    return { ok: true, refund: this.refundOf(def.cout) };
  }

  private demolishAt(x: number, y: number, refund: Cost): void {
    const occ = this.occupantAt(x, y);
    if (!occ) return;
    const k = this.key(x, y);
    const lost: Goods = {};
    const addLost = (goods: Goods) => {
      for (const g of GOOD_IDS) if (goods[g]) lost[g] = (lost[g] ?? 0) + (goods[g] ?? 0);
    };
    if (occ.kind === "road") {
      this.state.roads = this.state.roads.filter((r) => r !== k);
    } else if (occ.kind === "field") {
      this.state.fields = this.state.fields.filter((f) => f !== k);
      delete this.state.crops[String(k)];
    } else {
      const b = this.buildingsById.get(occ.id);
      if (b && (this.economy.isStorage(b) || BUILDINGS[b.type]?.marche)) {
        // Le contenu d'une réserve (ou des étals d'un marché) est déménagé dans les autres réserves.
        addLost(this.economy.deposit(b.stock, b.id));
      }
      if (b && BUILDINGS[b.type]?.logement) {
        for (const f of this.state.families) if (f.houseId === b.id) f.houseId = null;
        this.population.version += 1;
      }
      this.state.buildings = this.state.buildings.filter((other) => other.id !== occ.id);
      if (b?.type === "ferme") this.removeOrphanFields();
    }
    this.rebuildIndex();
    this.state.treasury += refund.or ?? 0;
    const physical: Goods = {};
    for (const g of GOOD_IDS) if (refund[g]) physical[g] = refund[g];
    addLost(this.economy.deposit(physical));
    if (goodsTotal(lost) > 0) {
      const parts = GOOD_IDS.filter((g) => lost[g]).map((g) => `${lost[g]} ${RESOURCE_NAMES[g].toLowerCase()}`);
      this.addLog(`Faute de place dans les réserves, perdu : ${parts.join(", ")}.`);
    }
  }

  /** Les champs qui ne sont plus près d'aucune ferme sont abandonnés. */
  private removeOrphanFields(): void {
    this.rebuildIndex();
    const before = this.state.fields.length;
    this.state.fields = this.state.fields.filter((k) => {
      const [fx, fy] = this.xy(k);
      const keep = this.nearFarm(fx, fy);
      if (!keep) delete this.state.crops[String(k)];
      return keep;
    });
    const lost = before - this.state.fields.length;
    if (lost > 0) this.addLog(`${lost} champ${lost > 1 ? "s" : ""} sans ferme abandonné${lost > 1 ? "s" : ""}.`);
  }

  private nearFarm(x: number, y: number): boolean {
    for (const b of this.state.buildings) {
      const def = BUILDINGS[b.type] as BuildingDef;
      if (!def.agriculture) continue;
      if (this.distanceToBuilding(b, x, y) <= (def.rayonChamps ?? 4)) return true;
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
    if (this.freeBuild) return { ok: true, cost: {} };
    const have = this.totals();
    for (const id of RESOURCE_IDS) {
      const need = cost[id] ?? 0;
      if (need > have[id]) {
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
    this.economy.withdraw(cost);
  }

  private newBuilding(type: string, x: number, y: number, fiefId: string): Building {
    return { id: this.state.nextId++, type, x, y, fiefId, stock: {}, progress: 0, lastWork: this.state.tick };
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
    if (s.awaitingBarrier || s.gameOver) return [];
    if ((s.tick + 1) % TICKS_PER_YEAR === BARRIER_OFFSET && s.lastBarrierTick !== s.tick) {
      s.awaitingBarrier = true;
      this.population.collectTaxes();
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
    this.economy.step();
    if (s.tick % DAY_TICKS === 0) {
      this.withRng((rng) => {
        this.population.daily(rng);
        this.dynasty.daily(rng);
      });
      this.checkTitle();
      events.push(...this.dynasty.drainEvents());
      events.push(...this.barrierEvents.splice(0));
      if (!s.gameOver && s.villagers.length < DEMOGRAPHY.seuilDefaite) {
        s.gameOver = { reason: "depeuple", tick: s.tick };
        this.addLog(`Il ne reste que ${s.villagers.length} habitant${s.villagers.length > 1 ? "s" : ""} : le domaine se vide. Fin de la partie.`);
        events.push({ type: "gameOver" });
      }
    }
    return events;
  }

  /** Applique ce que le Monde a décidé à la barrière, puis libère le temps. */
  /** Offres d'achat remises au Monde à la barrière. */
  barrierActions(): ProposeAction[] {
    return this.state.offers.map((o) => ({ type: "buyFief", actionId: o.actionId, ownerId: this.state.ownerId, fiefId: o.fiefId, price: o.price }));
  }

  /** Événements produits par la dernière barrière (achats, refus, titres), lus par l'interface. */
  readonly barrierEvents: SimEvent[] = [];

  applyBarrierResult(result: BarrierResult): void {
    const me = this.state.ownerId;
    for (const e of result.events) {
      if (e.type === "info" && (e.ownerId === null || e.ownerId === me)) this.addLog(e.text);
      if (e.type === "escrowReleased" && e.ownerId === me) {
        this.state.offers = this.state.offers.filter((o) => o.actionId !== e.actionId);
        this.state.treasury += e.gold;
        this.addLog(`${e.reason} Vos ${e.gold} or reviennent au trésor.`);
        this.barrierEvents.push({ type: "offerRefused", fiefId: e.fiefId, reason: e.reason });
      }
      if (e.type === "fiefTransferred" && e.toOwnerId === me) {
        this.state.offers = this.state.offers.filter((o) => o.fiefId !== e.fiefId);
        const report = this.withRng((rng) => annexFief(this, e, rng));
        const parts = [`${report.families} foyer${report.families > 1 ? "s" : ""}`, `${report.farms} ferme${report.farms > 1 ? "s" : ""}`];
        if (report.woodcutter) parts.push("un bûcheron");
        const camp = report.homeless > 0 ? ` ${report.homeless} foyer${report.homeless > 1 ? "s" : ""} sans maison campe${report.homeless > 1 ? "nt" : ""} au manoir : bâtissez-leur des maisons.` : "";
        const text = `Achat ${deNom(e.name)} pour ${e.price} or : son village (${parts.join(", ")}) rejoint le domaine.${camp}`;
        this.addLog(text);
        this.dynasty.chronicle(text);
        this.barrierEvents.push({ type: "fiefAcquired", fiefId: e.fiefId, name: e.name, price: e.price });
        this.checkTitle();
      }
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
