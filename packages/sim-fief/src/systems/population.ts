/**
 * Population du domaine (J2b) : villageois, foyers, naissances, décès, mariages, logement,
 * emplois, provisions des foyers, faim et froid, moral, impôts.
 *
 * Le temps de la population est le JOUR (15 ticks, 120 jours par an). Tout est parcouru dans
 * l'ordre des identifiants et tiré au sort avec le générateur à graine du domaine : déterministe.
 * Les provisions des foyers sont comptées en millièmes d'unité (entiers).
 */
import { RESOURCE_NAMES, Rng } from "@jeu/shared";
import { BUILDINGS, DEMOGRAPHY, DYNASTY, ECONOMY, LOGISTICS, NAMES } from "../data";
import type { DomainSim } from "../domain";
import type { Building, Delivery, Family, GoodId, ImmigrationLevel, Sex, Villager } from "../state";
import { legTicks } from "./economy";
import { TICKS_PER_SEASON, TICKS_PER_YEAR, dateOf } from "./seasons";

export const DAY_TICKS = TICKS_PER_SEASON / 30;
export const DAYS_PER_YEAR = TICKS_PER_YEAR / DAY_TICKS;

const D = DEMOGRAPHY;

/** Âge en années entières. */
export function ageOf(v: Villager, tick: number): number {
  return Math.floor((tick - v.birthTick) / TICKS_PER_YEAR);
}

/** Consommation quotidienne de nourriture d'un villageois, en millièmes. */
function dailyFood(v: Villager, tick: number): number {
  const perYear = ageOf(v, tick) >= D.ageTravail ? D.consommation.nourritureAdulteParAn : D.consommation.nourritureEnfantParAn;
  return Math.round((perYear * 1000) / DAYS_PER_YEAR);
}

/** Bois brûlé par un foyer logé, par jour d'hiver, en millièmes. */
export const DAILY_WOOD = Math.round((D.consommation.boisParFoyerParHiver * 1000) / (DAYS_PER_YEAR / 4));

export interface MoraleBreakdown {
  total: number;
  parts: { label: string; value: number }[];
}

/** Qui pourrait occuper les maisons libres : pour l'interface (maison vide, accueil des familles). */
export interface HousingOutlook {
  /** Maisons sans foyer (reliées ou non). */
  freeHouses: number;
  /** Foyers sans abri. */
  homeless: number;
  /** Jeunes couples prêts à se marier (17 ans et plus, de foyers différents). */
  waitingCouples: number;
  /** Maisons libres et reliées que personne n'attend : elles peuvent accueillir des nouveaux venus. */
  spare: number;
  /** Années avant qu'un nouveau couple puisse se former (0 : il y en a déjà), null : personne. */
  nextMarriageYears: number | null;
  immigration: ImmigrationCheck;
}

export interface ImmigrationCheck {
  level: ImmigrationLevel;
  /** Familles accueillies au plus par an à ce niveau. */
  perYear: number;
  /** Familles déjà arrivées cette année. */
  arrived: number;
  /** Vrai si une famille arrivera au prochain début de saison (printemps, été ou automne). */
  ready: boolean;
  /** Pourquoi personne ne viendra (null si ready). */
  reason: string | null;
  foodDays: number;
  morale: number;
}

export class Population {
  /** Augmente à chaque changement qui touche aux emplois (naissance, décès, déménagement, âge, limites). */
  version = 0;
  private workforceKey = "";
  private workersByBuilding = new Map<number, number[]>();
  private jobByVillager = new Map<number, number>();
  private laborByBuilding = new Map<number, number>();
  private membersCache: Map<number, Villager[]> | null = null;
  private membersVersion = -1;

  constructor(private readonly sim: DomainSim) {}

  private get state() {
    return this.sim.state;
  }

  // ------------------------------------------------------------ départ

  /** 10 couples de 20 à 25 ans (données), avec 0 à 2 jeunes enfants chacun, sans maison. */
  createStart(rng: Rng): void {
    const dep = D.depart;
    const tick = this.state.tick;
    for (let i = 0; i < dep.couples; i++) {
      const husband = this.newVillager(rng, "M", tick - this.ageTicks(rng, dep.ageMin, dep.ageMax), 0);
      const wife = this.newVillager(rng, "F", tick - this.ageTicks(rng, dep.ageMin, dep.ageMax), 0);
      const family = this.newFamily(husband.id, wife.id, null);
      husband.familyId = family.id;
      wife.familyId = family.id;
      const kids = rng.int(0, dep.enfantsMax);
      for (let k = 0; k < kids; k++) {
        this.newVillager(rng, rng.chance(0.5) ? "F" : "M", tick - this.ageTicks(rng, 0, dep.ageEnfantMax), family.id);
      }
      // Provisions de départ : quelques jours, le reste se prend au manoir.
      this.version += 1; // la liste des membres (en cache) doit inclure ce foyer
      let daily = 0;
      for (const v of this.members(family.id)) daily += dailyFood(v, tick);
      family.food = daily * D.provisionsDepartJours;
    }
    this.version += 1;
  }

  private ageTicks(rng: Rng, minYears: number, maxYears: number): number {
    return rng.int(minYears * TICKS_PER_YEAR, (maxYears + 1) * TICKS_PER_YEAR - 1);
  }

  newVillager(
    rng: Rng,
    sex: Sex,
    birthTick: number,
    familyId: number,
    extra: { fatherId?: number; motherId?: number; noble?: boolean } = {},
  ): Villager {
    const names = sex === "F" ? NAMES.prenomsF : NAMES.prenomsM;
    return this.addVillager({ name: rng.pick(names), sex, birthTick, familyId, ...extra });
  }

  /** Ajoute un villageois déjà décrit (prénom et âge connus, par exemple un conjoint noble). */
  addVillager(v: Omit<Villager, "id">): Villager {
    const full: Villager = { id: this.state.nextId++, ...v };
    this.state.villagers.push(full);
    return full;
  }

  newFamily(husbandId: number | null, wifeId: number | null, houseId: number | null): Family {
    const f: Family = {
      id: this.state.nextId++,
      houseId,
      husbandId,
      wifeId,
      food: 0,
      wood: 0,
      hungryDays: 0,
      coldDays: 0,
      lastBirthTick: this.state.tick,
      morale: D.moral.base,
    };
    this.state.families.push(f);
    return f;
  }

  // ------------------------------------------------------------ lecture

  villager(id: number | null): Villager | undefined {
    if (id === null) return undefined;
    return this.state.villagers.find((v) => v.id === id);
  }

  family(id: number): Family | undefined {
    return this.state.families.find((f) => f.id === id);
  }

  members(familyId: number): Villager[] {
    if (!this.membersCache || this.membersVersion !== this.version) {
      this.membersCache = new Map();
      for (const v of this.state.villagers) {
        const list = this.membersCache.get(v.familyId) ?? [];
        list.push(v);
        this.membersCache.set(v.familyId, list);
      }
      this.membersVersion = this.version;
    }
    return this.membersCache.get(familyId) ?? [];
  }

  familyInHouse(houseId: number): Family | undefined {
    return this.state.families.find((f) => f.houseId === houseId);
  }

  /** Où vit le foyer : sa maison, ou le manoir pour les sans-abri. */
  home(f: Family): Building | undefined {
    if (f.houseId !== null) {
      const h = this.sim.building(f.houseId);
      if (h) return h;
    }
    return this.state.buildings.find((b) => b.type === "manoir");
  }

  counts(): {
    total: number;
    adults: number;
    children: number;
    workers: number;
    employed: number;
    jobs: number;
    families: number;
    homeless: number;
    nobles: number;
  } {
    this.refreshWorkforce();
    const tick = this.state.tick;
    let adults = 0;
    let workers = 0;
    let nobles = 0;
    for (const v of this.state.villagers) {
      const age = ageOf(v, tick);
      if (age >= D.ageMariage) adults += 1;
      if (v.noble) nobles += 1;
      else if (age >= D.ageTravail) workers += 1;
    }
    let jobs = 0;
    for (const b of this.state.buildings) {
      const max = BUILDINGS[b.type]?.travailleurs ?? 0;
      if (max > 0 && this.sim.isConnected(b.id)) jobs += Math.min(max, b.workersLimit ?? max);
    }
    return {
      total: this.state.villagers.length,
      adults,
      children: this.state.villagers.length - adults,
      workers,
      employed: this.jobByVillager.size,
      jobs,
      families: this.state.families.filter((f) => !f.noble).length,
      homeless: this.state.families.filter((f) => f.houseId === null).length,
      nobles,
    };
  }

  /** Moral du village : moyenne des foyers (hors famille noble) pondérée par leur taille. */
  morale(): number {
    let sum = 0;
    let n = 0;
    for (const f of this.state.families) {
      if (f.noble) continue;
      const size = this.members(f.id).length;
      sum += f.morale * size;
      n += size;
    }
    return n > 0 ? Math.round(sum / n) : D.moral.base;
  }

  /** Effet du moral sur le rendement des ateliers, en millièmes (750 à 1250, 1000 à 50 de moral). */
  moraleFactor(): number {
    return 750 + this.morale() * 5;
  }

  /** Nourriture consommée par jour par tout le domaine, en millièmes. */
  dailyFoodNeed(): number {
    const tick = this.state.tick;
    let n = 0;
    for (const v of this.state.villagers) n += dailyFood(v, tick);
    return n;
  }

  // ------------------------------------------------------------ emplois

  /**
   * Répartition automatique : les bâtiments reliés, par priorité puis par ancienneté, reçoivent
   * chacun un travailleur à tour de rôle (jusqu'à leur limite), le plus proche de son domicile.
   * Recalculé seulement quand la carte, la population ou les limites changent.
   */
  refreshWorkforce(): void {
    const key = `${this.sim.mapVersion}|${this.version}`;
    if (key === this.workforceKey) return;
    this.workforceKey = key;
    this.workersByBuilding.clear();
    this.jobByVillager.clear();
    this.laborByBuilding.clear();
    const tick = this.state.tick;
    const slots = this.state.buildings
      .filter((b) => (BUILDINGS[b.type]?.travailleurs ?? 0) > 0 && this.sim.isConnected(b.id))
      .map((b) => {
        const max = BUILDINGS[b.type]?.travailleurs ?? 0;
        return { b, want: Math.max(0, Math.min(max, b.workersLimit ?? max)), prio: BUILDINGS[b.type]?.prioriteEmploi ?? 9 };
      })
      .sort((a, c) => a.prio - c.prio || a.b.id - c.b.id);
    const free = this.state.villagers.filter((v) => !v.noble && ageOf(v, tick) >= D.ageTravail);
    const homeOf = new Map<number, Building | undefined>();
    for (const f of this.state.families) homeOf.set(f.id, this.home(f));
    // Par ordre de priorité (la nourriture d'abord) ; à priorité égale, à tour de rôle.
    const priorities = [...new Set(slots.map((sl) => sl.prio))];
    for (const prio of priorities) {
      const group = slots.filter((sl) => sl.prio === prio);
      const maxWant = group.reduce((m, sl) => Math.max(m, sl.want), 0);
      for (let pass = 0; pass < maxWant && free.length > 0; pass++) {
        this.fillPass(group, pass, free, homeOf);
      }
    }
  }

  private fillPass(
    group: { b: Building; want: number }[],
    pass: number,
    free: Villager[],
    homeOf: Map<number, Building | undefined>,
  ): void {
    {
      for (const slot of group) {
        if (slot.want <= pass || free.length === 0) continue;
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < free.length; i++) {
          const home = homeOf.get((free[i] as Villager).familyId);
          const d = home ? this.commute(home, slot.b) : 99;
          if (d < bestDist) {
            best = i;
            bestDist = d;
          }
        }
        const worker = free.splice(best, 1)[0] as Villager;
        const list = this.workersByBuilding.get(slot.b.id) ?? [];
        list.push(worker.id);
        this.workersByBuilding.set(slot.b.id, list);
        this.jobByVillager.set(worker.id, slot.b.id);
        this.laborByBuilding.set(slot.b.id, (this.laborByBuilding.get(slot.b.id) ?? 0) + this.workFactor(bestDist));
      }
    }
  }

  /** Distance domicile → travail (en cases, déplacement en diagonale compris). */
  private commute(home: Building, work: Building): number {
    const def = BUILDINGS[home.type];
    const [w, h] = def ? def.taille : [1, 1];
    return this.sim.distanceToBuilding(work, home.x + Math.floor(w / 2), home.y + Math.floor(h / 2));
  }

  /** Part du temps réellement travaillé selon la distance, en millièmes (500 à 1000). */
  workFactor(distance: number): number {
    const over = Math.max(0, distance - D.distanceTravailSansPerte);
    return Math.max(500, 1000 - Math.round(over * D.pertePourCentParCase * 10));
  }

  workers(buildingId: number): number[] {
    this.refreshWorkforce();
    return this.workersByBuilding.get(buildingId) ?? [];
  }

  /** Somme des parts de temps travaillé des travailleurs du bâtiment, en millièmes. */
  labor(buildingId: number): number {
    this.refreshWorkforce();
    return this.laborByBuilding.get(buildingId) ?? 0;
  }

  jobOf(villagerId: number): number | null {
    this.refreshWorkforce();
    return this.jobByVillager.get(villagerId) ?? null;
  }

  // ------------------------------------------------------------ journée

  /** Appelé une fois par jour de jeu (tous les 15 ticks). */
  daily(rng: Rng): void {
    const tick = this.state.tick;
    const date = dateOf(tick);
    this.birthdays(tick);
    this.housing();
    if (tick % TICKS_PER_SEASON === 0) {
      this.marriages(tick);
      if (date.seasonIndex <= 2) this.immigrate(rng, tick);
    }
    this.consume(date.seasonIndex);
    this.provision(tick, date.seasonIndex);
    this.mortality(rng, tick, date.seasonIndex);
    this.births(rng, tick);
    for (const f of this.state.families) f.morale = this.moraleOf(f, date.seasonIndex).total;
  }

  private birthdays(tick: number): void {
    for (const v of this.state.villagers) {
      const sinceBirthday = (tick - v.birthTick) % TICKS_PER_YEAR;
      if (sinceBirthday >= 0 && sinceBirthday < DAY_TICKS) {
        const age = ageOf(v, tick);
        if (age === D.ageTravail || age === D.ageMariage) this.version += 1;
      }
    }
  }

  /** Les foyers sans abri emménagent dans les maisons libres (les plus anciens d'abord). */
  private housing(): void {
    const occupied = new Set<number>();
    for (const f of this.state.families) {
      if (f.houseId !== null && !this.sim.building(f.houseId)) {
        f.houseId = null;
        this.version += 1;
      }
      if (f.houseId !== null) occupied.add(f.houseId);
    }
    const free = this.state.buildings.filter((b) => BUILDINGS[b.type]?.logement && !occupied.has(b.id));
    let moved = 0;
    for (const f of this.state.families) {
      if (f.houseId !== null || free.length === 0) continue;
      if (this.members(f.id).length === 0) continue;
      const house = free.shift() as Building;
      f.houseId = house.id;
      moved += 1;
    }
    if (moved > 0) {
      this.version += 1;
      this.sim.addLog(`${moved} famille${moved > 1 ? "s" : ""} emménage${moved > 1 ? "nt" : ""} dans ${moved > 1 ? "de nouvelles maisons" : "une nouvelle maison"}.`);
    }
  }

  private isMarried(v: Villager): boolean {
    const f = this.family(v.familyId);
    return f !== undefined && (f.husbandId === v.id || f.wifeId === v.id);
  }

  /** Au début de chaque saison, les jeunes adultes se marient s'il y a une maison libre pour eux. */
  private marriages(tick: number): void {
    const { men, women } = this.singles(tick);
    const free = this.freeHouses();
    let married = 0;
    const waiting = Math.min(men.length, women.length);
    while (men.length > 0 && women.length > 0 && free.length > 0) {
      const m = men.shift() as Villager;
      // Pas de mariage entre frère et sœur.
      const idx = women.findIndex((w) => w.familyId !== m.familyId);
      if (idx < 0) continue;
      const w = women.splice(idx, 1)[0] as Villager;
      const house = free.shift() as Building;
      const fam = this.newFamily(m.id, w.id, house.id);
      m.familyId = fam.id;
      w.familyId = fam.id;
      married += 1;
    }
    if (married > 0) {
      this.version += 1;
      const stats = this.state.yearStats;
      stats.marriages = (stats.marriages ?? 0) + married;
      this.sim.addLog(`${married} mariage${married > 1 ? "s" : ""} : ${married > 1 ? "de nouveaux foyers s'installent" : "un nouveau foyer s'installe"}.`);
    }
    if (waiting > married && free.length === 0) {
      const n = waiting - married;
      this.sim.addLog(`${n} jeune${n > 1 ? "s" : ""} couple${n > 1 ? "s attendent" : " attend"} une maison libre pour se marier.`);
    }
  }

  /** Célibataires en âge de se marier, triés par âge (les plus âgés d'abord). */
  private singles(tick: number): { men: Villager[]; women: Villager[] } {
    const singles = this.state.villagers.filter((v) => !v.noble && ageOf(v, tick) >= D.ageMariage && !this.isMarried(v));
    const order = (a: Villager, b: Villager) => a.birthTick - b.birthTick || a.id - b.id;
    return { men: singles.filter((v) => v.sex === "M").sort(order), women: singles.filter((v) => v.sex === "F").sort(order) };
  }

  /** Nombre de couples qui pourraient se marier aujourd'hui (même règle que les mariages). */
  waitingCouples(): number {
    const { men, women } = this.singles(this.state.tick);
    let n = 0;
    for (const m of men) {
      const idx = women.findIndex((w) => w.familyId !== m.familyId);
      if (idx < 0) continue;
      women.splice(idx, 1);
      n += 1;
    }
    return n;
  }

  /** Années avant qu'un garçon et une fille de foyers différents aient tous deux l'âge de se marier. */
  private nextMarriageYears(tick: number): number | null {
    const unmarried = this.state.villagers.filter((v) => !v.noble && !this.isMarried(v));
    const ready = (v: Villager) => v.birthTick + D.ageMariage * TICKS_PER_YEAR;
    const order = (a: Villager, b: Villager) => ready(a) - ready(b) || a.id - b.id;
    const men = unmarried.filter((v) => v.sex === "M").sort(order);
    const women = unmarried.filter((v) => v.sex === "F").sort(order);
    let best = Infinity;
    for (const m of men) {
      if (ready(m) >= best) break;
      const w = women.find((o) => o.familyId !== m.familyId);
      if (!w) continue;
      best = Math.min(best, Math.max(ready(m), ready(w)));
    }
    if (best === Infinity) return null;
    return Math.max(0, Math.ceil((best - tick) / TICKS_PER_YEAR));
  }

  /** Maisons libres (reliées d'abord exigées pour les nouveaux venus), dans l'ordre des identifiants. */
  private freeHouses(): Building[] {
    const occupied = new Set(this.state.families.map((f) => f.houseId).filter((h): h is number => h !== null));
    return this.state.buildings.filter((b) => BUILDINGS[b.type]?.logement && !occupied.has(b.id));
  }

  housingOutlook(): HousingOutlook {
    const tick = this.state.tick;
    const free = this.freeHouses();
    const homeless = this.state.families.filter((f) => f.houseId === null && this.members(f.id).length > 0).length;
    const waiting = this.waitingCouples();
    const spare = this.spareHouses(free, homeless, waiting).length;
    return {
      freeHouses: free.length,
      homeless,
      waitingCouples: waiting,
      spare,
      nextMarriageYears: waiting > 0 ? 0 : this.nextMarriageYears(tick),
      immigration: this.immigrationCheck(spare),
    };
  }

  /** Maisons libres et reliées qui restent une fois servis les sans-abri et les jeunes couples. */
  private spareHouses(free: Building[], homeless: number, waiting: number): Building[] {
    const reserved = homeless + waiting;
    if (free.length <= reserved) return [];
    const connected = free.filter((b) => this.sim.isConnected(b.id));
    return connected.slice(0, Math.max(0, free.length - reserved));
  }

  /** Une famille de nouveaux venus viendrait-elle au prochain début de saison ? */
  immigrationCheck(spare?: number): ImmigrationCheck {
    const im = D.immigration;
    const level = this.state.immigration;
    const perYear = im.famillesParAn[level] ?? 0;
    const arrived = this.state.yearStats.immigrants ?? 0;
    const need = this.dailyFoodNeed();
    const foodDays = need > 0 ? Math.floor((this.foodAvailable() * 1000) / need) : 9999;
    const morale = this.morale();
    if (spare === undefined) {
      const free = this.freeHouses();
      const homeless = this.state.families.filter((f) => f.houseId === null && this.members(f.id).length > 0).length;
      spare = this.spareHouses(free, homeless, this.waitingCouples()).length;
    }
    let reason: string | null = null;
    if (perYear === 0) reason = "Accueil des nouveaux venus fermé.";
    else if (arrived >= perYear) reason = `${arrived > 1 ? `${arrived} familles déjà accueillies` : "Une famille déjà accueillie"} cette année : la suivante au printemps.`;
    else if (spare <= 0) reason = "Aucune maison libre et reliée que personne n'attend.";
    else if (foodDays < im.vivresMinJours) reason = `Il faut ${im.vivresMinJours} jours de vivres d'avance (vous en avez ${foodDays}).`;
    else if (morale < im.moralMin) reason = `Il faut un moral d'au moins ${im.moralMin} (il est de ${morale}).`;
    return { level, perYear, arrived, ready: reason === null, reason, foodDays, morale };
  }

  /** Au début du printemps, de l'été et de l'automne : une famille de nouveaux venus s'installe si possible. */
  private immigrate(rng: Rng, tick: number): void {
    const check = this.immigrationCheck();
    if (!check.ready) return;
    const free = this.freeHouses();
    const homeless = this.state.families.filter((f) => f.houseId === null && this.members(f.id).length > 0).length;
    const house = this.spareHouses(free, homeless, this.waitingCouples())[0];
    if (!house) return;
    const im = D.immigration;
    const husband = this.newVillager(rng, "M", tick - this.ageTicks(rng, im.ageMin, im.ageMax), 0);
    const wife = this.newVillager(rng, "F", tick - this.ageTicks(rng, im.ageMin, im.ageMax), 0);
    const family = this.newFamily(husband.id, wife.id, house.id);
    husband.familyId = family.id;
    wife.familyId = family.id;
    const kidMax = Math.max(0, Math.min(im.ageEnfantMax, ageOf(wife, tick) - D.ageMariage));
    const kids = rng.int(0, im.enfantsMax);
    for (let k = 0; k < kids; k++) {
      this.newVillager(rng, rng.chance(0.5) ? "F" : "M", tick - this.ageTicks(rng, 0, kidMax), family.id);
    }
    this.version += 1;
    let daily = 0;
    for (const v of this.members(family.id)) daily += dailyFood(v, tick);
    family.food = daily * D.provisionsDepartJours;
    family.morale = this.moraleOf(family, dateOf(tick).seasonIndex).total;
    const stats = this.state.yearStats;
    stats.immigrants = (stats.immigrants ?? 0) + 1;
    this.sim.addLog(`Nouveaux venus : ${husband.name} et ${wife.name}${kids > 0 ? `, avec ${kids} enfant${kids > 1 ? "s" : ""},` : ""} s'installent dans une maison libre.`);
  }

  private consume(season: number): void {
    const tick = this.state.tick;
    const stats = this.state.yearStats;
    for (const f of this.state.families) {
      const people = this.members(f.id);
      if (people.length === 0) continue;
      let need = 0;
      for (const v of people) need += dailyFood(v, tick);
      if (f.food >= need) {
        f.food -= need;
        stats.eaten = (stats.eaten ?? 0) + need;
        f.hungryDays = 0;
      } else {
        stats.eaten = (stats.eaten ?? 0) + f.food;
        f.food = 0;
        f.hungryDays += 1;
      }
      if (season === 3) {
        // Sans maison, pas de foyer où faire du feu.
        if (f.houseId !== null && f.wood >= DAILY_WOOD) {
          f.wood -= DAILY_WOOD;
          stats.burned = (stats.burned ?? 0) + DAILY_WOOD;
          f.coldDays = 0;
        } else {
          f.coldDays += 1;
        }
      } else {
        f.coldDays = 0;
      }
    }
  }

  /** Cibles de provisions d'un foyer, en millièmes. */
  targets(f: Family, season: number): { food: number; wood: number } {
    const tick = this.state.tick;
    let daily = 0;
    for (const v of this.members(f.id)) daily += dailyFood(v, tick);
    const food = daily * D.provisions.joursNourriture;
    let wood = 0;
    if (f.houseId !== null) {
      if (season === 2) wood = DAILY_WOOD * (DAYS_PER_YEAR / 4);
      if (season === 3) {
        const inSeason = tick % TICKS_PER_SEASON;
        wood = DAILY_WOOD * Math.max(0, DAYS_PER_YEAR / 4 - Math.floor(inSeason / DAY_TICKS));
      }
    }
    return { food, wood };
  }

  /** Les foyers vont chercher nourriture et bois quand leurs provisions baissent. */
  private provision(tick: number, season: number): void {
    const manor = this.state.buildings.find((b) => b.type === "manoir");
    for (const f of this.state.families) {
      if (this.members(f.id).length === 0) continue;
      const target = this.targets(f, season);
      if (f.noble) {
        // Famille noble : servie directement, au manoir puis dans les autres réserves.
        if (manor) this.serveFromManor(f, manor, target);
        continue;
      }
      if (f.houseId === null) {
        // Sans abri : on se sert directement au manoir, sur place.
        if (manor && f.food < target.food / 2) {
          const want = Math.ceil((target.food - f.food) / 1000);
          const take = Math.min(want, manor.stock.nourriture ?? 0);
          if (take > 0) {
            manor.stock.nourriture = (manor.stock.nourriture ?? 0) - take;
            f.food += take * 1000;
          }
        }
        continue;
      }
      if (this.state.deliveries.some((d) => d.familyId === f.id)) continue;
      const house = this.sim.building(f.houseId);
      if (!house || !this.sim.isConnected(house.id)) continue;
      // Un trajet lointain se prépare plus tôt : il faut tenir jusqu'au retour.
      const route = this.sim.economy.routesFrom(house.id, "provisions")[0];
      const tripDays = route ? Math.ceil((2 * legTicks(route.path.length)) / DAY_TICKS) : 0;
      let daily = 0;
      for (const v of this.members(f.id)) daily += dailyFood(v, tick);
      let good: GoodId | null = null;
      let missing = 0;
      if (f.food < target.food / 2 || f.food < daily * (tripDays + 10)) {
        good = "nourriture";
        missing = Math.max(target.food, daily * (2 * tripDays + 20)) - f.food;
      } else if (target.wood > 0 && f.wood < target.wood / 2) {
        good = "bois";
        missing = target.wood - f.wood;
      }
      if (!good) continue;
      const want = Math.min(D.provisions.chargeFoyer, Math.ceil(missing / 1000));
      this.sim.economy.sendCollect(house, good, want, tick, f.id);
    }
  }

  /** Nourriture mangée par jour par un foyer, en millièmes. */
  familyDailyFood(familyId: number): number {
    const tick = this.state.tick;
    let n = 0;
    for (const v of this.members(familyId)) n += dailyFood(v, tick);
    return n;
  }

  /** Un foyer noble qui vient de se former prend tout de suite ses vivres au manoir. */
  provisionNoble(f: Family): void {
    const manor = this.state.buildings.find((b) => b.type === "manoir");
    if (manor) this.serveFromManor(f, manor, this.targets(f, dateOf(this.state.tick).seasonIndex));
  }

  /**
   * La famille noble se sert au manoir d'abord, puis dans les entrepôts et les marchés :
   * on lui porte ses vivres, où qu'ils soient rangés (partie test n° 3 : elle mourait de faim
   * à côté d'entrepôts pleins).
   */
  private serveFromManor(f: Family, manor: Building, target: { food: number; wood: number }): void {
    const sources = [manor, ...this.state.buildings.filter((b) => b.id !== manor.id && (BUILDINGS[b.type]?.stockage || BUILDINGS[b.type]?.marche))];
    const draw = (good: "nourriture" | "bois", want: number): number => {
      let got = 0;
      for (const src of sources) {
        if (got >= want) break;
        const take = Math.min(want - got, src.stock[good] ?? 0);
        if (take <= 0) continue;
        src.stock[good] = (src.stock[good] ?? 0) - take;
        got += take;
      }
      return got;
    };
    if (f.food < target.food / 2) f.food += draw("nourriture", Math.ceil((target.food - f.food) / 1000)) * 1000;
    if (target.wood > 0 && f.wood < target.wood / 2) f.wood += draw("bois", Math.ceil((target.wood - f.wood) / 1000)) * 1000;
  }

  private deathRate(age: number): number {
    for (const r of D.mortaliteParAn) if (age <= r.ageMax) return r.taux;
    return 1;
  }

  private mortality(rng: Rng, tick: number, season: number): void {
    const dead: { v: Villager; cause: "age" | "faim" | "froid" }[] = [];
    for (const v of this.state.villagers) {
      const f = this.family(v.familyId);
      const pNatural = this.deathRate(ageOf(v, tick)) / DAYS_PER_YEAR;
      const grace = D.joursAvantMortalite;
      const pHunger = f && f.hungryDays >= grace ? D.famineMortaliteParJour : 0;
      const pCold = f && season === 3 && f.coldDays >= grace ? D.froidMortaliteParJour : 0;
      const r = rng.next();
      if (r < pNatural) dead.push({ v, cause: "age" });
      else if (r < pNatural + pHunger) dead.push({ v, cause: "faim" });
      else if (r < pNatural + pHunger + pCold) dead.push({ v, cause: "froid" });
    }
    if (dead.length === 0) return;
    const stats = this.state.yearStats;
    for (const { v, cause } of dead) {
      this.remove(v);
      stats.deaths = (stats.deaths ?? 0) + 1;
      if (cause === "faim") stats.deathsHunger = (stats.deathsHunger ?? 0) + 1;
      if (cause === "froid") stats.deathsCold = (stats.deathsCold ?? 0) + 1;
    }
    const byCause = (c: string) => dead.filter((d) => d.cause === c).map((d) => `${d.v.name} (${ageOf(d.v, tick)} ans)`);
    const age = byCause("age");
    const hunger = byCause("faim");
    const cold = byCause("froid");
    if (age.length > 0) this.sim.addLog(`Décès : ${age.join(", ")}.`);
    if (hunger.length > 0) this.sim.addLog(`La faim emporte ${hunger.join(", ")}.`);
    if (cold.length > 0) this.sim.addLog(`Le froid emporte ${cold.join(", ")}.`);
    this.version += 1;
    this.sim.dynasty.onDeaths(dead.filter((x) => x.v.noble));
  }

  /** Retire un villageois du domaine (mort, ou départ d'un membre de la lignée). */
  remove(v: Villager): void {
    this.state.villagers = this.state.villagers.filter((o) => o.id !== v.id);
    const f = this.family(v.familyId);
    if (!f) return;
    if (f.husbandId === v.id) f.husbandId = null;
    if (f.wifeId === v.id) f.wifeId = null;
    this.version += 1;
    const left = this.members(f.id);
    if (left.length === 0) {
      this.state.families = this.state.families.filter((o) => o.id !== f.id);
      return;
    }
    if (f.husbandId === null && f.wifeId === null && !f.noble) {
      // Orphelins : recueillis par le plus petit autre foyer, ou ils restent ensemble.
      const tick = this.state.tick;
      const anyAdult = left.some((m) => ageOf(m, tick) >= D.ageMariage);
      if (anyAdult) return;
      const other = this.state.families
        .filter((o) => o.id !== f.id && (o.husbandId !== null || o.wifeId !== null))
        .sort((a, b) => this.members(a.id).length - this.members(b.id).length || a.id - b.id)[0];
      if (!other) return;
      for (const child of left) child.familyId = other.id;
      other.food += f.food;
      other.wood += f.wood;
      this.state.families = this.state.families.filter((o) => o.id !== f.id);
      this.version += 1;
    }
  }

  /** Supprime un foyer qui n'a plus personne. */
  dropIfEmpty(familyId: number): void {
    if (this.state.villagers.some((v) => v.familyId === familyId)) return;
    this.state.families = this.state.families.filter((f) => f.id !== familyId);
    this.version += 1;
  }

  private births(rng: Rng, tick: number): void {
    const fec = D.fecondite;
    const pBase = 1 / Math.max(1, fec.intervalleMoyenJours - fec.ecartMinJours);
    const born: string[] = [];
    for (const f of [...this.state.families]) {
      const mother = this.villager(f.wifeId);
      const father = this.villager(f.husbandId);
      if (!mother || !father) continue;
      const age = ageOf(mother, tick);
      if (age < fec.ageMin || age > fec.ageMax) continue;
      if (tick - f.lastBirthTick < fec.ecartMinJours * DAY_TICKS) continue;
      if (f.hungryDays > 0) continue;
      const p = (pBase * (500 + f.morale * 10)) / 1000;
      if (rng.next() >= p) continue;
      const sex: Sex = rng.chance(0.5) ? "F" : "M";
      const child = this.newVillager(rng, sex, tick, f.id, { fatherId: father.id, motherId: mother.id });
      this.sim.dynasty.onBirth(child, f.noble === true);
      f.lastBirthTick = tick;
      born.push(`${child.name}, ${sex === "F" ? "fille" : "fils"} de ${father.name} et ${mother.name}`);
    }
    if (born.length > 0) {
      const stats = this.state.yearStats;
      stats.births = (stats.births ?? 0) + born.length;
      this.sim.addLog(`Naissance${born.length > 1 ? "s" : ""} : ${born.join(" ; ")}.`);
      this.version += 1;
    }
  }

  // ------------------------------------------------------------ moral et impôts

  moraleOf(f: Family, season: number): MoraleBreakdown {
    const m = D.moral;
    const parts: { label: string; value: number }[] = [{ label: "Base", value: m.base }];
    parts.push(f.hungryDays > 0 ? { label: "Affamé", value: m.affame } : { label: "Nourri", value: m.nourri });
    if (season === 3) parts.push(f.coldDays > 0 ? { label: "Froid", value: m.froid } : { label: "Chauffé", value: m.chauffe });
    parts.push(f.houseId !== null ? { label: "Logé", value: m.loge } : { label: "Sans abri", value: m.sansAbri });
    const home = this.home(f);
    if (home) {
      if (this.servedBy(home, "eglise")) parts.push({ label: "Église proche", value: m.eglise });
      if (this.servedBy(home, "marche")) parts.push({ label: "Marché proche", value: m.marche });
    }
    const tax = m.impots[this.state.taxLevel];
    if (tax !== 0) parts.push({ label: `Impôts ${this.state.taxLevel === "aucun" ? "supprimés" : "lourds"}`, value: tax });
    if (this.state.dynasty.regency) parts.push({ label: "Régence", value: DYNASTY.regence.moral });
    const welcome = m.immigration[this.state.immigration] ?? 0;
    if (welcome !== 0) parts.push({ label: "Accueil ouvert aux nouveaux venus", value: welcome });
    const total = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.value, 0)));
    return { total, parts };
  }

  /** Une église (ou un marché) avec au moins un travailleur, à portée de ce domicile. */
  private servedBy(home: Building, type: "eglise" | "marche"): boolean {
    const def = BUILDINGS[type];
    const radius = def?.influence ?? 0;
    const hd = BUILDINGS[home.type];
    const [w, h] = hd ? hd.taille : [1, 1];
    for (const b of this.state.buildings) {
      if (b.type !== type) continue;
      if (this.workers(b.id).length === 0) continue;
      if (this.sim.distanceToBuilding(b, home.x + Math.floor(w / 2), home.y + Math.floor(h / 2)) <= radius) return true;
    }
    return false;
  }

  /** Bilan d'automne : chaque foyer logé paie l'impôt. */
  collectTaxes(): void {
    const rate = ECONOMY.impotsParFoyer[this.state.taxLevel];
    const housed = this.state.families.filter((f) => f.houseId !== null && !f.noble).length;
    const amount = rate * housed;
    if (amount > 0) {
      this.state.treasury += amount;
      this.state.yearStats.taxes = (this.state.yearStats.taxes ?? 0) + amount;
      this.sim.addLog(`Impôts de l'an ${dateOf(this.state.tick).year} : ${amount} or (${housed} foyer${housed > 1 ? "s" : ""}).`);
    } else if (housed === 0) {
      this.sim.addLog("Aucun foyer logé : pas d'impôts cette année.");
    }
  }

  /** Nourriture totale disponible : réserves, marchés, provisions des foyers et porteurs en route (unités). */
  foodAvailable(): number {
    let n = 0;
    for (const b of this.state.buildings) {
      const def = BUILDINGS[b.type];
      if (def?.stockage || def?.marche) n += b.stock.nourriture ?? 0;
    }
    for (const f of this.state.families) n += f.food / 1000;
    for (const d of this.state.deliveries as Delivery[]) if (d.good === "nourriture" && d.kind === "collecte" && d.status === "retour") n += d.amount;
    return Math.floor(n);
  }

  describeGood(g: GoodId): string {
    return RESOURCE_NAMES[g].toLowerCase();
  }

  /** Vitesse de marche, pour estimer les trajets des foyers (ticks par case). */
  get ticksPerTile(): number {
    return LOGISTICS.ticksParCase;
  }
}
