/**
 * Économie du domaine (J2a) : réserves, production, agriculture et logistique par flux.
 *
 * Principe de la logistique par flux (DESIGN.md, 5.2) :
 * - chaque atelier a des porteurs ; quand assez de marchandises attendent, un porteur part
 *   vers la réserve la plus proche PAR LA ROUTE qui a de la place ;
 * - le voyage est planifié au départ (itinéraire, heure d'arrivée, heure de retour) ;
 * - la marchandise n'entre dans la réserve qu'à l'arrivée du porteur.
 * Une réserve éloignée allonge les voyages et peut devenir le goulot d'étranglement.
 *
 * Tout est en nombres entiers et parcouru dans un ordre fixe : déterministe.
 */
import { TERRAIN_KEYS, type Cost, type Resources } from "@jeu/shared";
import { BUILDINGS, LOGISTICS, type BuildingDef } from "../data";
import type { DomainSim } from "../domain";
import { GOOD_IDS, emptyYearStats, type Building, type Delivery, type GoodId, type Goods } from "../state";
import { shortestRoadPaths } from "./roads";
import { BARRIER_OFFSET, TICKS_PER_SEASON, TICKS_PER_YEAR, dateOf } from "./seasons";

export interface Route {
  storageId: number;
  /** Cases de route à parcourir. */
  distance: number;
  path: number[];
}

export type StatusTone = "ok" | "info" | "warn" | "bad";
export interface BuildingStatus {
  text: string;
  tone: StatusTone;
  /** Vrai si le bâtiment est bloqué par manque de place ou de transport (badge sur la carte). */
  blocked: boolean;
}

export interface FarmInfo {
  fields: number[];
  max: number;
  /** Champs à portée de cette ferme qu'aucune ferme ne travaille (au-delà du maximum). */
  idleNearby: number;
  expected: number;
}

export function goodsTotal(goods: Goods): number {
  let n = 0;
  for (const g of GOOD_IDS) n += goods[g] ?? 0;
  return n;
}

/** Durée d'un trajet simple : traverser l'itinéraire, plus entrer et sortir des bâtiments. */
export function legTicks(pathLength: number): number {
  return (pathLength + 1) * LOGISTICS.ticksParCase;
}

export function productionCycle(def: BuildingDef): number {
  return def.production ? Math.max(1, Math.floor(TICKS_PER_YEAR / def.production.parAn)) : 0;
}

export function fieldYield(def: BuildingDef, fertility: number): number {
  const base = def.agriculture?.rendementParChamp ?? 0;
  return Math.max(1, Math.floor((base * fertility) / 100));
}

export class Economy {
  private cacheVersion = -1;
  private routes = new Map<number, Route[]>();
  private efficiencyById = new Map<number, number>();
  private fieldFarm = new Map<number, number>();
  private farmFields = new Map<number, number[]>();

  constructor(private readonly sim: DomainSim) {}

  // ------------------------------------------------------------ caches (recalculés quand la carte change)

  private refresh(): void {
    if (this.cacheVersion === this.sim.mapVersion) return;
    this.cacheVersion = this.sim.mapVersion;
    this.routes.clear();
    this.efficiencyById.clear();
    for (const b of this.sim.state.buildings) {
      const def = BUILDINGS[b.type];
      if (def?.production && def.procheDe) this.efficiencyById.set(b.id, this.computeEfficiency(b, def));
    }
    this.assignFields();
  }

  /** Rendement en millièmes : cases du terrain exploité à portée / cases nécessaires au plein rendement. */
  private computeEfficiency(b: Building, def: BuildingDef): number {
    const prod = def.production;
    const near = def.procheDe;
    if (!prod || !near) return 0;
    const wanted = TERRAIN_KEYS[near.terrain];
    const [w, h] = def.taille;
    let count = 0;
    for (let y = b.y - near.rayon; y < b.y + h + near.rayon; y++) {
      for (let x = b.x - near.rayon; x < b.x + w + near.rayon; x++) {
        if (this.sim.terrainAt(x, y) === wanted) count += 1;
      }
    }
    return Math.min(1000, Math.floor((count * 1000) / prod.casesPleinRendement));
  }

  /**
   * Chaque champ est confié à la ferme la plus proche qui a encore de la place.
   * Attribution gloutonne par distance croissante, puis par ferme, puis par case : déterministe.
   */
  private assignFields(): void {
    this.fieldFarm.clear();
    this.farmFields.clear();
    const farms = this.sim.state.buildings.filter((b) => BUILDINGS[b.type]?.agriculture);
    const pairs: [number, number, number][] = [];
    for (const k of this.sim.state.fields) {
      const [x, y] = this.sim.xy(k);
      for (const f of farms) {
        const def = BUILDINGS[f.type] as BuildingDef;
        const d = this.sim.distanceToBuilding(f, x, y);
        if (d <= (def.rayonChamps ?? 4)) pairs.push([d, f.id, k]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const f of farms) this.farmFields.set(f.id, []);
    for (const [, farmId, k] of pairs) {
      if (this.fieldFarm.has(k)) continue;
      const list = this.farmFields.get(farmId) as number[];
      const farm = this.sim.building(farmId) as Building;
      const max = BUILDINGS[farm.type]?.agriculture?.champsMax ?? 0;
      if (list.length >= max) continue;
      list.push(k);
      this.fieldFarm.set(k, farmId);
    }
  }

  efficiency(buildingId: number): number {
    this.refresh();
    return this.efficiencyById.get(buildingId) ?? 0;
  }

  /** Réserves accessibles par la route depuis ce bâtiment, de la plus proche à la plus lointaine. */
  routesFrom(buildingId: number): Route[] {
    this.refresh();
    const cached = this.routes.get(buildingId);
    if (cached) return cached;
    const b = this.sim.building(buildingId);
    if (!b) return [];
    const targets = new Map<number, number[]>();
    for (const s of this.sim.state.buildings) {
      if (s.id !== b.id && BUILDINGS[s.type]?.stockage) targets.set(s.id, this.sim.perimeter(s));
    }
    const found = shortestRoadPaths(this.sim.state.worldWidth, this.sim.roadTiles(), this.sim.perimeter(b), targets);
    const list: Route[] = [...found.entries()]
      .map(([storageId, p]) => ({ storageId, distance: p.distance, path: p.path }))
      .sort((a, c) => a.distance - c.distance || a.storageId - c.storageId);
    this.routes.set(buildingId, list);
    return list;
  }

  farmOfField(key: number): number | null {
    this.refresh();
    return this.fieldFarm.get(key) ?? null;
  }

  // ------------------------------------------------------------ réserves

  isStorage(b: Building): boolean {
    return Boolean(BUILDINGS[b.type]?.stockage);
  }

  storages(): Building[] {
    return this.sim.state.buildings.filter((b) => this.isStorage(b));
  }

  /** Marchandises en route vers une réserve (place déjà réservée). */
  incoming(storageId: number): number {
    let n = 0;
    for (const d of this.sim.state.deliveries) if (d.toId === storageId && d.status === "aller") n += d.amount;
    return n;
  }

  freeSpace(storage: Building): number {
    const cap = BUILDINGS[storage.type]?.stockage?.capacite ?? 0;
    return cap - goodsTotal(storage.stock) - this.incoming(storage.id);
  }

  /** Totaux disponibles pour construire : contenu des réserves + trésor. */
  totals(): Resources {
    const out: Resources = { nourriture: 0, bois: 0, pierre: 0, or: this.sim.state.treasury };
    for (const s of this.storages()) for (const g of GOOD_IDS) out[g] += s.stock[g] ?? 0;
    return out;
  }

  storageUsage(): { used: number; capacity: number; incoming: number } {
    let used = 0;
    let capacity = 0;
    let incoming = 0;
    for (const s of this.storages()) {
      used += goodsTotal(s.stock);
      capacity += BUILDINGS[s.type]?.stockage?.capacite ?? 0;
      incoming += this.incoming(s.id);
    }
    return { used, capacity, incoming };
  }

  /** Marchandises produites qui attendent un porteur dans les ateliers et les fermes. */
  waiting(): Goods {
    const out: Goods = {};
    for (const b of this.sim.state.buildings) {
      if (this.isStorage(b)) continue;
      for (const g of GOOD_IDS) if (b.stock[g]) out[g] = (out[g] ?? 0) + (b.stock[g] ?? 0);
    }
    return out;
  }

  /** Prélève un coût : l'or au trésor, les marchandises dans les réserves (dans l'ordre des bâtiments). */
  withdraw(cost: Cost): void {
    this.sim.state.treasury -= cost.or ?? 0;
    for (const g of GOOD_IDS) {
      let left = cost[g] ?? 0;
      for (const s of this.storages()) {
        if (left <= 0) break;
        const take = Math.min(left, s.stock[g] ?? 0);
        if (take > 0) {
          s.stock[g] = (s.stock[g] ?? 0) - take;
          left -= take;
        }
      }
    }
  }

  /** Range des marchandises dans les réserves qui ont de la place. Renvoie ce qui n'a pas pu être rangé. */
  deposit(goods: Goods, exceptId: number | null = null): Goods {
    const lost: Goods = {};
    for (const g of GOOD_IDS) {
      let left = goods[g] ?? 0;
      for (const s of this.storages()) {
        if (left <= 0) break;
        if (s.id === exceptId) continue;
        const put = Math.min(left, Math.max(0, this.freeSpace(s)));
        if (put > 0) {
          s.stock[g] = (s.stock[g] ?? 0) + put;
          left -= put;
        }
      }
      if (left > 0) lost[g] = left;
    }
    return lost;
  }

  // ------------------------------------------------------------ pas de temps

  /** Appelé à chaque tick, après l'avancée de l'horloge. */
  step(): void {
    this.refresh();
    const tick = this.sim.state.tick;
    const inYear = tick % TICKS_PER_YEAR;
    if (inYear === 0) this.onSpring(dateOf(tick).year);
    else if (inYear === TICKS_PER_SEASON) this.onSummer();
    else if (inYear === BARRIER_OFFSET) this.onWinter();
    this.processDeliveries(tick);
    this.produce(tick);
    this.dispatch(tick);
  }

  private onSpring(year: number): void {
    this.sim.state.crops = {};
    this.sim.state.yearStats = emptyYearStats(year);
    this.sim.cropVersion += 1;
  }

  /** Début de l'été : les champs travaillés par une ferme reliée ont été semés. */
  private onSummer(): void {
    let sown = 0;
    for (const farm of this.sim.state.buildings) {
      if (!BUILDINGS[farm.type]?.agriculture || !this.sim.isConnected(farm.id)) continue;
      for (const k of this.farmFields.get(farm.id) ?? []) {
        this.sim.state.crops[String(k)] = "seme";
        sown += 1;
      }
    }
    if (sown > 0) this.sim.addLog(`Semailles terminées : ${sown} champ${sown > 1 ? "s" : ""} ensemencé${sown > 1 ? "s" : ""}.`);
    this.sim.cropVersion += 1;
  }

  /** Début de l'hiver : bilan des moissons ; ce qui n'a pas été moissonné est perdu. */
  private onWinter(): void {
    const crops = this.sim.state.crops;
    let rotted = 0;
    for (const k of Object.keys(crops)) {
      if (crops[k] === "seme") {
        delete crops[k];
        rotted += 1;
      }
    }
    const stats = this.sim.state.yearStats;
    if (stats.fieldsHarvested > 0 || rotted > 0) {
      let text = `Moisson de l'an ${stats.year} : ${stats.harvested} nourriture sur ${stats.fieldsHarvested} champ${stats.fieldsHarvested > 1 ? "s" : ""}.`;
      if (rotted > 0) text += ` ${rotted} champ${rotted > 1 ? "s" : ""} non moissonné${rotted > 1 ? "s" : ""}, récolte perdue.`;
      this.sim.addLog(text);
    }
    this.sim.cropVersion += 1;
  }

  private processDeliveries(tick: number): void {
    const state = this.sim.state;
    let finished = false;
    for (const d of state.deliveries) {
      if (d.status === "aller" && tick >= d.arriveTick) {
        const dest = this.sim.building(d.toId);
        if (dest && this.isStorage(dest)) {
          dest.stock[d.good] = (dest.stock[d.good] ?? 0) + d.amount;
          d.status = "retour";
        } else {
          d.status = "rapporte";
        }
      }
      if (tick >= d.returnTick) {
        if (d.status === "rapporte") {
          const src = this.sim.building(d.fromId);
          if (src) src.stock[d.good] = (src.stock[d.good] ?? 0) + d.amount;
        }
        finished = true;
      }
    }
    if (finished) state.deliveries = state.deliveries.filter((d) => tick < d.returnTick);
  }

  private produce(tick: number): void {
    const season = dateOf(tick).seasonIndex;
    const stats = this.sim.state.yearStats;
    for (const b of this.sim.state.buildings) {
      const def = BUILDINGS[b.type];
      if (!def) continue;
      if (def.production) {
        if (goodsTotal(b.stock) >= (def.stockMax ?? 0) || !this.sim.isConnected(b.id)) continue;
        const eff = this.efficiencyById.get(b.id) ?? 0;
        if (eff <= 0) continue;
        b.progress += eff;
        const threshold = productionCycle(def) * 1000;
        while (b.progress >= threshold) {
          b.progress -= threshold;
          const g = def.production.ressource;
          b.stock[g] = (b.stock[g] ?? 0) + 1;
          stats.produced[g] = (stats.produced[g] ?? 0) + 1;
          b.lastWork = tick;
        }
      } else if (def.agriculture && season === 2) {
        if (goodsTotal(b.stock) >= (def.stockMax ?? 0) || !this.sim.isConnected(b.id)) continue;
        if (tick - b.lastWork < def.agriculture.ticksParRecolte) continue;
        const k = (this.farmFields.get(b.id) ?? []).find((f) => this.sim.state.crops[String(f)] === "seme");
        if (k === undefined) continue;
        const [x, y] = this.sim.xy(k);
        const amount = fieldYield(def, this.sim.fertilityAt(x, y) ?? 50);
        this.sim.state.crops[String(k)] = "recolte";
        b.stock.nourriture = (b.stock.nourriture ?? 0) + amount;
        b.lastWork = tick;
        stats.harvested += amount;
        stats.fieldsHarvested += 1;
        this.sim.cropVersion += 1;
      }
    }
  }

  private dispatch(tick: number): void {
    const state = this.sim.state;
    for (const b of state.buildings) {
      const def = BUILDINGS[b.type];
      const transport = def?.transport;
      if (!transport || !this.sim.isConnected(b.id)) continue;
      let busy = 0;
      for (const d of state.deliveries) if (d.fromId === b.id) busy += 1;
      let idle = transport.porteurs - busy;
      while (idle > 0) {
        let good: GoodId | null = null;
        for (const g of GOOD_IDS) if ((b.stock[g] ?? 0) > 0 && (good === null || (b.stock[g] ?? 0) > (b.stock[good] ?? 0))) good = g;
        if (good === null) break;
        const available = b.stock[good] ?? 0;
        const full = available >= transport.charge;
        if (!full && tick - b.lastWork < LOGISTICS.attenteChargePartielle) break;
        const route = this.routesFrom(b.id).find((r) => {
          const s = this.sim.building(r.storageId);
          return s !== undefined && this.freeSpace(s) > 0;
        });
        if (!route) break;
        const storage = this.sim.building(route.storageId) as Building;
        const amount = Math.min(available, transport.charge, this.freeSpace(storage));
        const leg = legTicks(route.path.length);
        const delivery: Delivery = {
          id: state.nextId++,
          fromId: b.id,
          toId: storage.id,
          good,
          amount,
          path: [...route.path],
          departTick: tick,
          arriveTick: tick + leg,
          returnTick: tick + 2 * leg,
          status: "aller",
        };
        b.stock[good] = available - amount;
        state.deliveries.push(delivery);
        idle -= 1;
      }
    }
  }

  // ------------------------------------------------------------ lecture pour l'interface

  farmInfo(farmId: number): FarmInfo | null {
    this.refresh();
    const farm = this.sim.building(farmId);
    const def = farm ? BUILDINGS[farm.type] : undefined;
    if (!farm || !def?.agriculture) return null;
    const fields = this.farmFields.get(farmId) ?? [];
    let idleNearby = 0;
    for (const k of this.sim.state.fields) {
      const [x, y] = this.sim.xy(k);
      if (this.fieldFarm.get(k) !== farmId && this.sim.distanceToBuilding(farm, x, y) <= (def.rayonChamps ?? 4) && !this.fieldFarm.has(k)) {
        idleNearby += 1;
      }
    }
    const season = dateOf(this.sim.state.tick).seasonIndex;
    let expected = 0;
    for (const k of fields) {
      const crop = this.sim.state.crops[String(k)];
      const willGrow = season === 0 ? this.sim.isConnected(farmId) : crop === "seme";
      if (willGrow) {
        const [x, y] = this.sim.xy(k);
        expected += fieldYield(def, this.sim.fertilityAt(x, y) ?? 50);
      }
    }
    return { fields, max: def.agriculture.champsMax, idleNearby, expected };
  }

  /** Nourriture encore attendue des champs cette année (toutes fermes). */
  expectedHarvest(): number {
    let n = 0;
    for (const b of this.sim.state.buildings) if (BUILDINGS[b.type]?.agriculture) n += this.farmInfo(b.id)?.expected ?? 0;
    return n;
  }

  status(buildingId: number): BuildingStatus {
    const b = this.sim.building(buildingId);
    const def = b ? BUILDINGS[b.type] : undefined;
    if (!b || !def) return { text: "", tone: "info", blocked: false };
    if (!this.sim.isConnected(b.id)) return { text: "Non relié au manoir : aucune activité.", tone: "bad", blocked: false };
    if (def.stockage) {
      const used = goodsTotal(b.stock);
      const cap = def.stockage.capacite;
      if (used >= cap) return { text: `Réserve pleine (${used} / ${cap}).`, tone: "warn", blocked: true };
      return { text: `Réserve : ${used} / ${cap}.`, tone: "ok", blocked: false };
    }
    const max = def.stockMax ?? 0;
    const full = max > 0 && goodsTotal(b.stock) >= max;
    const noDestination = goodsTotal(b.stock) > 0 && !this.routesFrom(b.id).some((r) => {
      const s = this.sim.building(r.storageId);
      return s !== undefined && this.freeSpace(s) > 0;
    });
    if (full && noDestination) return { text: "Réserves pleines : activité arrêtée. Bâtissez un entrepôt.", tone: "bad", blocked: true };
    if (full) return { text: "Activité arrêtée : les porteurs ne suivent pas. Rapprochez une réserve.", tone: "warn", blocked: true };
    if (noDestination) return { text: "Réserves pleines : la production s'entasse ici.", tone: "warn", blocked: true };
    if (def.production) {
      const eff = this.efficiency(b.id);
      if (eff <= 0) return { text: "Plus rien à exploiter à portée.", tone: "bad", blocked: true };
      return { text: `Au travail, rendement ${Math.round(eff / 10)} %.`, tone: eff >= 1000 ? "ok" : "info", blocked: false };
    }
    if (def.agriculture) {
      const info = this.farmInfo(b.id);
      if (!info || info.fields.length === 0) return { text: "Aucun champ : peignez des champs autour de la ferme.", tone: "warn", blocked: false };
      const season = dateOf(this.sim.state.tick).seasonIndex;
      const sown = info.fields.filter((k) => this.sim.state.crops[String(k)] !== undefined).length;
      if (season === 0) return { text: "Labours et semailles jusqu'à l'été.", tone: "ok", blocked: false };
      if (season === 3) return { text: "Repos hivernal.", tone: "info", blocked: false };
      if (sown === 0) return { text: "Rien de semé cette année : les champs se sèment au printemps.", tone: "warn", blocked: false };
      if (season === 1) return { text: "Les blés poussent. Moisson à l'automne.", tone: "ok", blocked: false };
      const left = info.fields.filter((k) => this.sim.state.crops[String(k)] === "seme").length;
      return left > 0
        ? { text: `Moisson en cours : ${left} champ${left > 1 ? "s" : ""} à faucher.`, tone: "ok", blocked: false }
        : { text: "Moisson terminée.", tone: "ok", blocked: false };
    }
    return { text: "Sans fonction pour l'instant.", tone: "info", blocked: false };
  }

  /** Porteurs d'un bâtiment, pour le panneau de sélection. */
  porters(buildingId: number): { delivery: Delivery | null }[] {
    const b = this.sim.building(buildingId);
    const n = b ? (BUILDINGS[b.type]?.transport?.porteurs ?? 0) : 0;
    const trips = this.sim.state.deliveries.filter((d) => d.fromId === buildingId);
    const out: { delivery: Delivery | null }[] = trips.map((d) => ({ delivery: d }));
    while (out.length < n) out.push({ delivery: null });
    return out;
  }
}
