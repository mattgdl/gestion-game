/**
 * Besoins du village, maladie et foire (J4b).
 *
 * - Outils et vêtements s'usent chaque jour ; on les prend dans les réserves, sans porteur.
 *   La « couverture » (part des besoins servis, lissée sur 30 jours) donne les effets :
 *   production des ateliers et des fermes (outils), moral, froid et naissances (vêtements).
 * - Épidémie : rare, annoncée, dans un rayon autour d'une maison ; un guérisseur à portée,
 *   qui a des remèdes, divise la mortalité par quatre.
 * - Foire d'automne : achat et vente à prix fixes, avec un plafond par an et par marchandise.
 *
 * Tout est en entiers (millièmes) et tiré au sort avec le générateur à graine du domaine.
 */
import { Rng } from "@jeu/shared";
import { BUILDINGS, NEEDS } from "../data";
import type { DomainSim, SimEvent } from "../domain";
import { GOOD_NAMES, type Building, type GoodId, type NeedState, type Villager } from "../state";
import { DAYS_PER_YEAR, DAY_TICKS, ageOf } from "./population";
import { TICKS_PER_YEAR, dateOf } from "./seasons";

export type TradeSide = "achat" | "vente";

export class Needs {
  private events: SimEvent[] = [];

  constructor(private readonly sim: DomainSim) {}

  private get state() {
    return this.sim.state;
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------ outils et vêtements

  /** Usure du jour : on prend les unités dues dans les réserves, et on met à jour la couverture. */
  daily(rng: Rng): void {
    const counts = this.sim.population.counts();
    this.consume("outils", this.state.needs.outils, counts.employed * NEEDS.outilsParTravailleurParAn);
    this.consume("vetements", this.state.needs.vetements, this.state.villagers.length * NEEDS.vetementsParHabitantParAn);
    this.epidemicDay(rng);
  }

  private consume(good: GoodId, need: NeedState, perYear: number): void {
    const daily = Math.round((perYear * 1000) / DAYS_PER_YEAR);
    need.owed += daily;
    const units = Math.floor(need.owed / 1000);
    const taken = units > 0 ? this.sim.economy.take(good, units) : 0;
    need.owed -= taken * 1000;
    // Servi si l'on a pu prendre ce qui était dû, ou s'il en reste en réserve pour les jours suivants.
    // La dette ne dépasse pas une semaine.
    const ok = units > 0 ? taken === units : this.sim.economy.stockOf(good) > 0;
    need.owed = Math.min(need.owed, daily * 7 + 999);
    need.coverage = Math.floor((need.coverage * 29 + (ok ? 1000 : 0)) / 30);
  }

  /** Les vêtements protègent du froid : facteur de mortalité par le froid, en millièmes. */
  coldFactor(): number {
    return 1000 - Math.floor((NEEDS.protectionFroidPourMille * this.state.needs.vetements.coverage) / 1000);
  }

  /** Bien-être d'un foyer (‰) pour les naissances : moral (compte double), vêtements et outils. */
  wellbeing(morale: number): number {
    const moraleScore = Math.max(0, Math.min(1000, (morale - 50) * 20));
    const n = this.state.needs;
    return Math.floor((2 * moraleScore + n.vetements.coverage + n.outils.coverage) / 4);
  }

  /** Écart moyen entre deux naissances (jours) selon le bien-être. */
  birthInterval(morale: number): number {
    const nat = NEEDS.natalite;
    return nat.lentJours - Math.floor(((nat.lentJours - nat.rapideJours) * this.wellbeing(morale)) / 1000);
  }

  // ------------------------------------------------------------ épidémies

  private epidemicDay(rng: Rng): void {
    const st = this.state;
    const m = NEEDS.maladie;
    const ep = st.epidemic;
    if (ep) {
      if (st.tick >= ep.untilTick) {
        const text = `L'épidémie prend fin${ep.deaths > 0 ? ` : ${ep.deaths} mort${ep.deaths > 1 ? "s" : ""}` : ", sans faire de victime"}.`;
        this.sim.addLog(text);
        this.sim.dynasty.chronicle(text);
        st.epidemic = null;
      }
      return;
    }
    // Pas d'épidémie pendant les premières années : le village doit d'abord s'installer.
    if (st.tick < m.graceAnnees * TICKS_PER_YEAR) return;
    const chance = Math.min(m.chanceMax, m.chanceParAn + (m.parCentHabitants * st.villagers.length) / 100);
    if (rng.next() >= chance / DAYS_PER_YEAR) return;
    const housed = st.families.filter((f) => f.houseId !== null && !f.noble);
    if (housed.length === 0) return;
    const fam = housed[rng.int(0, housed.length - 1)]!;
    const house = this.sim.building(fam.houseId as number) as Building;
    st.epidemic = {
      fiefId: house.fiefId,
      x: house.x,
      y: house.y,
      radius: m.rayon,
      untilTick: st.tick + m.dureeJours * DAY_TICKS,
      deaths: 0,
      care: {},
    };
    const touched = this.touchedFamilies().length;
    const name = st.fiefs[house.fiefId]?.name;
    const text = `Une maladie se déclare${name ? ` à ${name}` : ""} : ${touched} foyer${touched > 1 ? "s" : ""} touché${touched > 1 ? "s" : ""}. Un guérisseur à portée, avec des remèdes, sauve des vies.`;
    this.sim.addLog(text);
    this.events.push({ type: "epidemic", fiefId: house.fiefId });
  }

  /** Foyers dans la zone de l'épidémie (leur maison, ou le manoir pour les sans-abri). */
  touchedFamilies() {
    const ep = this.state.epidemic;
    if (!ep) return [];
    return this.state.families.filter((f) => {
      const home = this.sim.population.home(f);
      if (!home) return false;
      return Math.max(Math.abs(home.x - ep.x), Math.abs(home.y - ep.y)) <= ep.radius;
    });
  }

  /** Guérisseur qui soigne ce domicile : à portée, avec un travailleur et des remèdes. */
  private healerFor(home: Building): Building | undefined {
    for (const b of this.state.buildings) {
      if (b.type !== "guerisseur") continue;
      const def = BUILDINGS[b.type];
      if (this.sim.population.workers(b.id).length === 0) continue;
      if ((b.stock.remedes ?? 0) <= 0) continue;
      if (this.sim.distanceToBuilding(b, home.x, home.y) <= (def?.influence ?? 0)) return b;
    }
    return undefined;
  }

  /**
   * Probabilité de mourir de la maladie aujourd'hui, pour chaque villageois touché (par identifiant),
   * en appliquant les soins (et en consommant les remèdes). Appelé une fois par jour.
   */
  diseaseRisks(tick: number): Map<number, number> {
    const out = new Map<number, number>();
    const ep = this.state.epidemic;
    if (!ep) return out;
    const m = NEEDS.maladie;
    for (const f of this.touchedFamilies()) {
      const home = this.sim.population.home(f);
      if (!home) continue;
      const healer = this.healerFor(home);
      if (healer) {
        const key = String(healer.id);
        ep.care[key] = (ep.care[key] ?? 0) + 1;
        if (ep.care[key]! >= m.remedeTousLesJours) {
          ep.care[key] = 0;
          healer.stock.remedes = Math.max(0, (healer.stock.remedes ?? 0) - 1);
        }
      }
      for (const v of this.sim.population.members(f.id) as Villager[]) {
        const age = ageOf(v, tick);
        let p = m.mortaliteParJour * (age < 5 || age >= 60 ? 2 : 1);
        if (healer) p = (p * m.soinPourMille) / 1000;
        out.set(v.id, p);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ foire d'automne

  /** La foire se tient tout l'automne (bilan compris). */
  fairOpen(): boolean {
    return dateOf(this.state.tick).seasonIndex === 2;
  }

  private fairBook(): { bought: Partial<Record<GoodId, number>>; sold: Partial<Record<GoodId, number>> } {
    const year = dateOf(this.state.tick).year;
    if (this.state.fair.year !== year) this.state.fair = { year, bought: {}, sold: {} };
    return this.state.fair;
  }

  /** Ce qu'on peut encore acheter ou vendre de cette marchandise cette année. */
  fairLeft(good: GoodId, side: TradeSide): number {
    const book = this.fairBook();
    const done = (side === "achat" ? book.bought[good] : book.sold[good]) ?? 0;
    return Math.max(0, NEEDS.foire.plafondParAn - done);
  }

  checkTrade(good: GoodId, qty: number, side: TradeSide): { ok: boolean; reason?: string; gold?: number } {
    const price = NEEDS.foire.prix[good];
    if (!price) return { ok: false, reason: "Le marchand ne fait pas commerce de cela." };
    if (!this.fairOpen()) return { ok: false, reason: "La foire se tient en automne." };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "Quantité invalide." };
    if (qty > this.fairLeft(good, side)) return { ok: false, reason: `Le marchand n'en ${side === "achat" ? "a" : "prend"} plus que ${this.fairLeft(good, side)} cette année.` };
    const name = GOOD_NAMES[good].toLowerCase();
    if (side === "achat") {
      const gold = price.achat * qty;
      if (gold > this.state.treasury) return { ok: false, reason: `Pas assez d'or (il en faut ${gold}).` };
      let room = 0;
      for (const s of this.sim.economy.storages()) room += Math.max(0, this.sim.economy.freeSpace(s));
      if (room < qty) return { ok: false, reason: `Pas assez de place dans les réserves (${room}).` };
      return { ok: true, gold };
    }
    if (this.sim.economy.stockOf(good) < qty) return { ok: false, reason: `Pas assez de ${name} dans les réserves.` };
    return { ok: true, gold: price.vente * qty };
  }

  applyTrade(good: GoodId, qty: number, side: TradeSide): void {
    const check = this.checkTrade(good, qty, side);
    const book = this.fairBook();
    const name = GOOD_NAMES[good].toLowerCase();
    if (side === "achat") {
      this.state.treasury -= check.gold ?? 0;
      this.sim.economy.deposit({ [good]: qty });
      book.bought[good] = (book.bought[good] ?? 0) + qty;
      this.sim.addLog(`Foire : achat de ${qty} ${name} pour ${check.gold} or.`);
    } else {
      this.sim.economy.take(good, qty);
      this.state.treasury += check.gold ?? 0;
      book.sold[good] = (book.sold[good] ?? 0) + qty;
      this.sim.addLog(`Foire : vente de ${qty} ${name} pour ${check.gold} or.`);
    }
  }
}
