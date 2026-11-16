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
    need.owed = Math.min(need.owed, daily * 7 + 999);
    if (daily <= 0) return;
    // Part des besoins servis aujourd'hui (une dette réglée compte : servir un tiers des besoins
    // donne environ 33 %), lissée sur 30 jours. Un jour sans unité due compte comme servi s'il
    // en reste en réserve, et ne change rien sinon (la dette le dira le jour suivant).
    let served: number;
    if (units > 0) served = Math.floor((taken * 1000 * 1000) / daily);
    else if (this.sim.economy.stockOf(good) > 0) served = 1000;
    else return;
    need.coverage = Math.max(0, Math.min(1000, Math.floor((need.coverage * 29 + served) / 30)));
  }

  /**
   * La chaîne de production des besoins, en unités par an au rythme actuel (emplois occupés,
   * terrain, moral et outils compris) : de quoi dire au joueur où elle bloque.
   */
  chain(): {
    besoinOutils: number;
    besoinVetements: number;
    outils: number;
    laine: number;
    tissage: number;
    /** Ateliers bâtis mais sans personne pour y travailler. */
    sansBras: { forge: number; bergerie: number; tisserand: number };
  } {
    const eco = this.sim.economy;
    const pop = this.sim.population;
    const factor = Math.floor((pop.moraleFactor() * eco.toolFactor()) / 1000);
    const idle = { forge: 0, bergerie: 0, tisserand: 0 };
    const rate = (type: "forge" | "bergerie" | "tisserand"): number => {
      let perMille = 0;
      for (const b of this.state.buildings) {
        if (b.type !== type || !this.sim.isConnected(b.id)) continue;
        const def = BUILDINGS[type];
        if (!def) continue;
        const max = def.travailleurs ?? 0;
        if (max > 0 && pop.workers(b.id).length === 0) idle[type] += 1;
        const labor = max > 0 ? Math.floor(pop.labor(b.id) / max) : 1000;
        const parAn = def.production?.parAn ?? def.transformation?.parAn ?? 0;
        const eff = def.production ? eco.efficiency(b.id) : 1000;
        perMille += Math.floor((parAn * Math.floor((eff * labor) / 1000) * factor) / 1000);
      }
      return Math.floor(perMille / 1000);
    };
    const counts = pop.counts();
    return {
      besoinOutils: Math.ceil(counts.employed * NEEDS.outilsParTravailleurParAn),
      besoinVetements: Math.ceil(this.state.villagers.length * NEEDS.vetementsParHabitantParAn),
      outils: rate("forge"),
      laine: rate("bergerie"),
      tissage: rate("tisserand"),
      sansBras: idle,
    };
  }

  /** Ce qui manque à la chaîne des vêtements, en une phrase (null si elle suffit). */
  clothesAdvice(): string | null {
    const c = this.chain();
    const madeFromWool = Math.floor(c.laine / 2);
    const made = Math.min(madeFromWool, c.tissage);
    if (made >= c.besoinVetements) return null;
    if (c.tissage === 0 && c.laine === 0) return `Il faut ${c.besoinVetements} vêtements par an : bergerie puis tisserand.`;
    if (madeFromWool < c.tissage) {
      if (c.sansBras.bergerie > 0) return `${c.sansBras.bergerie > 1 ? `${c.sansBras.bergerie} bergeries n'ont` : "Une bergerie n'a"} personne pour garder les moutons : il manque des bras.`;
      return `Il manque de la laine : ${c.laine} par an pour ${2 * c.besoinVetements} (${c.besoinVetements} vêtements). Une bergerie de plus, entourée de prés libres.`;
    }
    if (c.sansBras.tisserand > 0) return `${c.sansBras.tisserand > 1 ? `${c.sansBras.tisserand} tisserands n'ont` : "Un tisserand n'a"} personne au métier : il manque des bras${c.laine > 2 * c.tissage ? " (la laine attend)" : ""}.`;
    return `Il manque des tisserands : ils font ${c.tissage} vêtements par an pour ${c.besoinVetements} nécessaires${c.laine > 2 * c.tissage ? " (la laine attend)" : ""}.`;
  }

  /** Ce qui manque à la chaîne des outils, en une phrase (null si elle suffit). */
  toolsAdvice(): string | null {
    const c = this.chain();
    if (c.outils >= c.besoinOutils) return null;
    if (c.sansBras.forge > 0) return `${c.sansBras.forge > 1 ? `${c.sansBras.forge} forges n'ont` : "Une forge n'a"} pas de forgeron : il manque des bras.`;
    if (c.outils === 0) return `Il faut ${c.besoinOutils} outils par an : une forge (bois + pierre).`;
    return `La forge fait ${c.outils} outils par an pour ${c.besoinOutils} nécessaires : une forge de plus, ou des forgerons.`;
  }

  /** Les vêtements protègent du froid : facteur de mortalité par le froid, en millièmes. */
  coldFactor(): number {
    return 1000 - Math.floor((NEEDS.protectionFroidPourMille * this.state.needs.vetements.coverage) / 1000);
  }

  /**
   * Bien-être d'un foyer (‰) pour les naissances : le moral, multiplié par les besoins servis.
   * Sans vêtements ni outils, il reste (1000 - partBesoins) ‰ du moral ; vêtements et outils
   * se partagent le reste à parts égales.
   */
  wellbeing(morale: number): number {
    const moraleScore = Math.max(0, Math.min(1000, (morale - 50) * 20));
    const n = this.state.needs;
    const part = NEEDS.natalite.partBesoinsPourMille;
    const needs = 1000 - part + Math.floor((part * (n.vetements.coverage + n.outils.coverage)) / 2000);
    return Math.floor((moraleScore * needs) / 1000);
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
