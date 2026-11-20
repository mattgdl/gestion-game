/**
 * Événements (J8) : événements du domaine tirés au hasard, événements régionaux reçus du Monde,
 * décisions à options (option par défaut à l'échéance), effets immédiats et temporaires.
 * Les traits du seigneur et les monuments passent aussi par ici : c'est le recueil des
 * « modificateurs » que lisent la population, l'économie et l'armée.
 */
import type { Rng } from "@jeu/shared";
import type { CheckResult } from "../commands";
import { BUILDINGS, EVENTS, TRAITS, type EventDef, type EventEffects, type EventOption } from "../data";
import type { DomainSim } from "../domain";
import { GOOD_IDS, type GoodId, type PendingEvent, type TimedEffect } from "../state";
import { DAY_TICKS } from "./population";
import { BARRIER_OFFSET, TICKS_PER_YEAR, dateOf } from "./seasons";
import { ruleEffects } from "./traits";

export interface EventView {
  pending: PendingEvent;
  def: EventDef;
  options: { option: EventOption; ok: boolean; reason?: string }[];
}

export type EventSimEvent = { type: "domainEvent"; key: string; title: string; text: string; choice: boolean };

const findDef = (id: string, regional: boolean): EventDef | undefined => (regional ? EVENTS.regionaux : EVENTS.evenements).find((e) => e.id === id);

export class Events {
  private queue: EventSimEvent[] = [];

  constructor(private readonly sim: DomainSim) {}

  private get e() {
    return this.sim.state.events;
  }

  drainEvents(): EventSimEvent[] {
    return this.queue.splice(0);
  }

  // ------------------------------------------------------------ modificateurs

  /** Effets des traits du seigneur régnant et de son conjoint. */
  rule() {
    const dyn = this.sim.dynasty;
    const lord = dyn.member(this.sim.state.dynasty.lordId);
    const spouse = lord ? dyn.livingSpouse(lord) : undefined;
    return ruleEffects(lord, spouse);
  }

  /** Somme des effets temporaires d'un genre, actifs maintenant (‰ ou points). */
  timed(kind: TimedEffect["kind"]): number {
    const t = this.sim.state.tick;
    let n = 0;
    for (const f of this.e.effects) if (f.kind === kind && f.fromTick <= t && t < f.untilTick) n += f.value;
    return n;
  }

  /** Facteur de récolte en millièmes (événements). */
  harvestFactor(): number {
    return Math.max(0, 1000 + this.timed("recolte"));
  }

  /** Facteur de production des ateliers en millièmes (événements et traits). */
  productionFactor(): number {
    return Math.max(0, 1000 + this.timed("production") + this.rule().production);
  }

  /** Facteur de bois brûlé l'hiver en millièmes (hiver rigoureux). */
  heatingFactor(): number {
    return Math.max(0, 1000 + this.timed("chauffage"));
  }

  /** Lignes de moral venues des événements, des traits et des monuments. */
  moraleParts(): { label: string; value: number }[] {
    const parts: { label: string; value: number }[] = [];
    const t = this.sim.state.tick;
    for (const f of this.e.effects) if (f.kind === "moral" && f.fromTick <= t && t < f.untilTick) parts.push({ label: f.label, value: f.value });
    const lord = this.sim.dynasty.member(this.sim.state.dynasty.lordId);
    const spouse = lord ? this.sim.dynasty.livingSpouse(lord) : undefined;
    const traitMoral = (ids: string[] | undefined, half: boolean) =>
      (ids ?? []).map((id) => ({ id, v: half ? Math.trunc((TRAITS[id]?.effets.moral ?? 0) / 2) : (TRAITS[id]?.effets.moral ?? 0) })).filter((x) => x.v !== 0);
    for (const { id, v } of traitMoral(lord?.traits, false)) parts.push({ label: `Seigneur ${TRAITS[id]!.nom.toLowerCase()}`, value: v });
    for (const { id, v } of traitMoral(spouse?.traits, true)) parts.push({ label: `Conjoint ${TRAITS[id]!.nom.toLowerCase()}`, value: v });
    for (const m of this.monuments()) parts.push({ label: BUILDINGS[m]!.nom, value: BUILDINGS[m]!.monument!.moral });
    return parts;
  }

  /** Monuments qui ont au moins un travailleur. */
  monuments(): string[] {
    const out: string[] = [];
    for (const b of this.sim.state.buildings) {
      const def = BUILDINGS[b.type];
      if (def?.monument && this.sim.population.workers(b.id).length > 0) out.push(b.type);
    }
    return out;
  }

  /** Prestige des monuments et des traits du seigneur. */
  prestigeBonus(): { monuments: number; traits: number } {
    const monuments = this.monuments().reduce((n, id) => n + (BUILDINGS[id]?.monument?.prestige ?? 0), 0);
    return { monuments, traits: this.rule().prestige };
  }

  /** Bâtiment verrouillé (puits, cathédrale) pas encore débloqué ? */
  locked(type: string): boolean {
    return BUILDINGS[type]?.verrou === true && !this.e.unlocked.includes(type);
  }

  /** Accueil des nouveaux venus fermé par un événement (peste). */
  closedToNewcomers(): boolean {
    return (this.e.closedUntil ?? 0) > this.sim.state.tick;
  }

  // ------------------------------------------------------------ tirage

  daily(rng: Rng): void {
    const st = this.sim.state;
    const tick = st.tick;
    // Échéances : l'option par défaut s'applique.
    for (const p of [...this.e.pending]) if (tick >= p.deadlineTick) this.resolveDefault(p, rng);
    this.e.effects = this.e.effects.filter((f) => f.untilTick > tick);
    const f = EVENTS.frequence;
    if (tick < f.graceAnnees * TICKS_PER_YEAR) return;
    if (this.e.pending.some((p) => !p.regional)) return;
    if (rng.next() * f.joursMoyens >= 1) return;
    const def = this.pick(rng);
    if (def) this.start(def, false, rng);
  }

  /** Avant le bilan : les décisions échues passent à leur option par défaut. */
  beforeBarrier(rng: Rng): void {
    for (const p of [...this.e.pending]) if (this.sim.state.tick + 1 >= p.deadlineTick) this.resolveDefault(p, rng);
  }

  private pick(rng: Rng): EventDef | undefined {
    const st = this.sim.state;
    const date = dateOf(st.tick);
    const pop = st.villagers.length;
    const ok = EVENTS.evenements.filter((d) => {
      const c = d.conditions ?? {};
      if (d.saisons && !d.saisons.includes(date.seasonIndex)) return false;
      if (c.anMin !== undefined && date.year < c.anMin) return false;
      if (c.habitantsMin !== undefined && pop < c.habitantsMin) return false;
      if (c.batiment && !st.buildings.some((b) => b.type === c.batiment)) return false;
      if (d.unique && this.e.done.includes(d.id)) return false;
      if (d.id === "cathedrale" && (this.e.unlocked.includes("cathedrale") || st.buildings.some((b) => b.type === "cathedrale"))) return false;
      if (d.cible && this.targets().length === 0) return false;
      return true;
    });
    const total = ok.reduce((n, d) => n + (d.poids ?? 1), 0);
    if (total <= 0) return undefined;
    let r = Math.floor(rng.next() * total);
    for (const d of ok) {
      r -= d.poids ?? 1;
      if (r < 0) return d;
    }
    return undefined;
  }

  /** Bâtiments que peut viser un incendie : maisons et ateliers (ni manoir ni maison forte). */
  private targets() {
    return this.sim.state.buildings.filter((b) => b.type !== "manoir" && b.type !== "maisonforte" && b.type !== "cathedrale");
  }

  /** Prochain bilan à au moins delaiMinJours jours. */
  private deadline(): number {
    const tick = this.sim.state.tick;
    const base = Math.floor(tick / TICKS_PER_YEAR) * TICKS_PER_YEAR + BARRIER_OFFSET - 1;
    let d = base;
    while (d < tick + EVENTS.frequence.delaiMinJours * DAY_TICKS) d += TICKS_PER_YEAR;
    return d;
  }

  /** Un événement arrive : une décision à prendre, ou une simple nouvelle s'il n'y a qu'une option. */
  start(def: EventDef, regional: boolean, rng: Rng): void {
    const st = this.sim.state;
    let text = def.texte;
    let targetId: number | undefined;
    if (def.cible) {
      const all = this.targets();
      const target = all[rng.int(0, all.length - 1)]!;
      targetId = target.id;
      const name = BUILDINGS[target.type]?.nom ?? "un bâtiment";
      const fief = st.fiefs[target.fiefId]?.name;
      text = text.replace("{batiment}", `${name === "Maison" ? "une maison" : `le bâtiment « ${name} »`}${fief ? ` à ${fief}` : ""}`);
    }
    const p: PendingEvent = { key: `ev-${this.e.nextKey++}`, eventId: def.id, regional, createdTick: st.tick, deadlineTick: this.deadline(), targetId, text };
    if (def.options.length === 1) {
      this.apply(p, def, def.options[0]!, rng);
      this.queue.push({ type: "domainEvent", key: p.key, title: def.titre, text: `${def.titre} : ${text}`, choice: false });
      return;
    }
    this.e.pending.push(p);
    this.sim.addLog(`${def.titre}. ${text} Décision à prendre (panneau Domaine).`);
    this.queue.push({ type: "domainEvent", key: p.key, title: def.titre, text, choice: true });
  }

  /** Événement régional annoncé par le Monde : il touche ce domaine si l'un de ses fiefs est dans la zone. */
  onRegional(eventId: string, fiefIds: string[], rng: Rng): void {
    if (!fiefIds.some((id) => this.sim.state.fiefs[id])) return;
    const def = findDef(eventId, true);
    if (def) this.start(def, true, rng);
  }

  // ------------------------------------------------------------ décisions

  view(p: PendingEvent): EventView | null {
    const def = findDef(p.eventId, p.regional);
    if (!def) return null;
    return { pending: p, def, options: def.options.map((option) => ({ option, ...this.checkOption(p, option) })) };
  }

  /** Coût en matériaux et en or d'une option (biens négatifs, or négatif, prix du bâtiment visé). */
  costOf(p: PendingEvent, o: EventOption): Partial<Record<GoodId | "or", number>> {
    const cost: Partial<Record<GoodId | "or", number>> = {};
    if ((o.effets.or ?? 0) < 0) cost.or = -(o.effets.or ?? 0);
    for (const g of GOOD_IDS) {
      const n = o.effets.biens?.[g] ?? 0;
      if (n < 0) cost[g] = -n;
    }
    if (o.coutCible && p.targetId !== undefined) {
      const b = this.sim.building(p.targetId);
      const c = b ? (BUILDINGS[b.type]?.cout ?? {}) : {};
      for (const [k, v] of Object.entries(c)) if (v) cost[k as GoodId | "or"] = (cost[k as GoodId | "or"] ?? 0) + v;
    }
    return cost;
  }

  checkOption(p: PendingEvent, o: EventOption): { ok: boolean; reason?: string } {
    const st = this.sim.state;
    const c = o.condition;
    if (c?.batiment && !st.buildings.some((b) => b.type === c.batiment)) return { ok: false, reason: `Il faut : ${BUILDINGS[c.batiment]?.nom.toLowerCase() ?? c.batiment}.` };
    if (c?.soldats && this.sim.army.soldiers().length < c.soldats) return { ok: false, reason: `Il faut ${c.soldats} soldats.` };
    if (o.coutCible && (p.targetId === undefined || !this.sim.building(p.targetId))) return { ok: false, reason: "Le bâtiment n'existe plus." };
    if (o.defaut) return { ok: true };
    for (const [k, v] of Object.entries(this.costOf(p, o))) {
      const have = k === "or" ? st.treasury : this.sim.economy.stockOf(k as GoodId);
      if ((v ?? 0) > have) return { ok: false, reason: `Pas assez ${k === "or" ? "d'or" : `de ${k}`} (il en faut ${v}).` };
    }
    return { ok: true };
  }

  check(key: string, optionId: string): CheckResult {
    const p = this.e.pending.find((x) => x.key === key);
    if (!p) return { ok: false, reason: "Cette affaire est déjà réglée." };
    const def = findDef(p.eventId, p.regional);
    const o = def?.options.find((x) => x.id === optionId);
    if (!def || !o) return { ok: false, reason: "Choix inconnu." };
    return this.checkOption(p, o);
  }

  choose(key: string, optionId: string, rng: Rng): void {
    const p = this.e.pending.find((x) => x.key === key)!;
    const def = findDef(p.eventId, p.regional)!;
    const o = def.options.find((x) => x.id === optionId)!;
    this.e.pending = this.e.pending.filter((x) => x !== p);
    this.apply(p, def, o, rng);
  }

  private resolveDefault(p: PendingEvent, rng: Rng): void {
    const def = findDef(p.eventId, p.regional);
    this.e.pending = this.e.pending.filter((x) => x !== p);
    if (!def) return;
    const o = def.options.find((x) => x.defaut) ?? def.options[def.options.length - 1]!;
    this.sim.addLog(`${def.titre} : faute de décision, « ${o.texte} ».`);
    this.apply(p, def, o, rng);
  }

  // ------------------------------------------------------------ effets

  private apply(p: PendingEvent, def: EventDef, o: EventOption, rng: Rng): void {
    const st = this.sim.state;
    const fx: EventEffects = o.effets;
    const tick = st.tick;
    const notes: string[] = [];
    // Coûts : payés autant que possible (l'option par défaut ne vérifie pas).
    const cost = this.costOf(p, o);
    for (const [k, v] of Object.entries(cost)) {
      if (!v) continue;
      if (k === "or") st.treasury = Math.max(0, st.treasury - v);
      else this.sim.economy.take(k as GoodId, v);
    }
    if ((fx.or ?? 0) > 0) st.treasury += fx.or!;
    if (fx.orPourMille) {
      const n = Math.floor((st.treasury * fx.orPourMille) / 1000);
      st.treasury = Math.max(0, st.treasury + n);
      if (n < 0) notes.push(`${-n} or perdus`);
    }
    const gains: Partial<Record<GoodId, number>> = {};
    for (const g of GOOD_IDS) if ((fx.biens?.[g] ?? 0) > 0) gains[g] = fx.biens![g];
    if (Object.keys(gains).length > 0) this.sim.economy.deposit(gains);
    const span = (x: { jours: number; debut?: number }) => ({ fromTick: tick + (x.debut ?? 0) * DAY_TICKS, untilTick: tick + ((x.debut ?? 0) + x.jours) * DAY_TICKS });
    const label = def.titre.replace(/ s'annonce$/, "");
    if (fx.moral) this.e.effects.push({ kind: "moral", value: fx.moral.valeur, label, ...span(fx.moral) });
    if (fx.recolte) {
      let v = fx.recolte.pourMille;
      // Un puits divise par deux la récolte perdue d'un été sec.
      if (v < 0 && def.attenuePar && st.buildings.some((b) => b.type === def.attenuePar)) v = Math.trunc(v / 2);
      this.e.effects.push({ kind: "recolte", value: v, label, ...span(fx.recolte) });
    }
    if (fx.production) this.e.effects.push({ kind: "production", value: fx.production.pourMille, label, ...span(fx.production) });
    if (fx.chauffage) this.e.effects.push({ kind: "chauffage", value: fx.chauffage.pourMille, label, ...span(fx.chauffage) });
    if (fx.prestige) st.dynasty.prestigeAcquis += fx.prestige;
    if (fx.morts) {
      const pool = st.villagers.filter((v) => !v.noble);
      const dead: string[] = [];
      for (let i = 0; i < fx.morts && pool.length > 0; i++) {
        const v = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
        this.sim.population.remove(v);
        st.yearStats.deaths = (st.yearStats.deaths ?? 0) + 1;
        dead.push(v.name);
      }
      if (dead.length > 0) notes.push(`mort de ${dead.join(", ")}`);
    }
    if (fx.detruire && p.targetId !== undefined) {
      const b = this.sim.building(p.targetId);
      if (b) {
        this.sim.destroyBuilding(b.id);
        notes.push(`${BUILDINGS[b.type]?.nom ?? "le bâtiment"} est perdu`);
      }
    }
    if (fx.debloque && !this.e.unlocked.includes(fx.debloque)) {
      this.e.unlocked.push(fx.debloque);
      notes.push(`${BUILDINGS[fx.debloque]?.nom ?? fx.debloque} constructible`);
    }
    if (fx.accueilFerme) this.e.closedUntil = Math.max(this.e.closedUntil ?? 0, tick + fx.accueilFerme * DAY_TICKS);
    if (fx.epidemie && rng.next() * 1000 < fx.epidemie) this.sim.needs.startEpidemic(rng);
    if (def.unique && !o.defaut) this.e.done.push(def.id);
    const text = `${def.titre} : ${o.texte.toLowerCase()}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}.`;
    this.sim.addLog(text);
    if (def.options.length > 1 || fx.prestige) this.sim.dynasty.chronicle(text);
  }
}
