/**
 * Lignée du seigneur (J3) : famille noble, ordre de succession selon la loi, décrets,
 * régence, extinction, affaires de famille (mariages, Église, alliances), prestige et
 * chronique de la dynastie.
 *
 * Les membres vivants de la lignée sont aussi des villageois : ils vieillissent, mangent,
 * ont des enfants et meurent avec le reste de la population. L'arbre complet, morts et
 * partis compris, est gardé dans state.dynasty.members : il sert à l'ordre de succession
 * (un petit-fils peut hériter de son grand-père si son père est mort) et à la chronique.
 *
 * Tout est parcouru dans un ordre fixe et tiré au sort avec le générateur à graine.
 */
import type { LineageSetup } from "@jeu/shared";
import { Rng } from "@jeu/shared";
import { DEMOGRAPHY, DYNASTY, NAMES } from "../data";
import type { DomainSim, SimEvent } from "../domain";
import type { DynastyMember, DynastyState, Sex, SuccessionLaw, Suitor, Villager } from "../state";
import { DAY_TICKS, ageOf } from "./population";
import { TICKS_PER_YEAR, dateOf } from "./seasons";

export const LAW_NAMES: Record<SuccessionLaw, string> = {
  masculine: "Masculine seule",
  "preference-masculine": "Les fils d'abord",
  absolue: "Aînesse absolue",
};

export const LAW_HINTS: Record<SuccessionLaw, string> = {
  masculine: "Seuls les fils héritent, et seulement par les hommes : une fille et ses enfants n'héritent jamais.",
  "preference-masculine": "Les fils d'abord, du plus âgé au plus jeune ; une fille seulement s'il n'y a aucun fils.",
  absolue: "L'aîné(e) hérite, fils ou fille.",
};

/** Choix pour une affaire de famille : l'indice d'un prétendant, ou une autre voie. */
export type DecisionChoice = number | "eglise" | "alliance" | "refuser";

export interface PrestigeBreakdown {
  total: number;
  parts: { label: string; value: number }[];
}

export function emptyDynasty(): DynastyState {
  return {
    name: "",
    founderId: -1,
    lordId: null,
    law: DYNASTY.loiDepart,
    pendingLaw: null,
    regency: null,
    decisions: [],
    members: [],
    reigns: [],
    chronicle: [],
    prestigeAcquis: 0,
    neighbors: [],
  };
}

/** « fils » ou « fille », « seigneur » ou « dame »… */
export function bySex(sex: Sex, m: string, f: string): string {
  return sex === "F" ? f : m;
}

export class Dynasty {
  private events: SimEvent[] = [];
  /** Index des membres par identifiant (la liste ne fait que grandir). */
  private index = new Map<number, DynastyMember>();
  private indexedList: DynastyMember[] | null = null;
  private indexedCount = 0;

  constructor(private readonly sim: DomainSim) {}

  private get d(): DynastyState {
    return this.sim.state.dynasty;
  }

  // ------------------------------------------------------------ départ

  /** Le fondateur, son épouse et leur jeune enfant s'installent au manoir. */
  createStart(rng: Rng, setup: LineageSetup): void {
    const f = DYNASTY.fondateur;
    const pop = this.sim.population;
    const tick = this.sim.state.tick;
    const manor = this.sim.state.buildings.find((b) => b.type === "manoir");
    const d = this.d;
    d.name = `Maison de ${setup.houseName}`;
    d.neighbors = [...setup.neighbors];
    const lord = pop.newVillager(rng, "M", tick - this.ageTicks(rng, f.ageMin, f.ageMax), 0, { noble: true });
    const wife = pop.newVillager(rng, "F", tick - this.ageTicks(rng, f.conjointAgeMin, f.conjointAgeMax), 0, { noble: true });
    const fam = pop.newFamily(lord.id, wife.id, manor ? manor.id : null);
    fam.noble = true;
    lord.familyId = fam.id;
    wife.familyId = fam.id;
    this.addMember(lord, true);
    const wifeMember = this.addMember(wife, false);
    wifeMember.house = this.pickHouse(rng);
    this.link(lord.id, wife.id);
    let lastBirth = -Infinity;
    for (let i = 0; i < f.enfants; i++) {
      const birth = tick - this.ageTicks(rng, 0, f.ageEnfantMax);
      const child = pop.newVillager(rng, rng.chance(0.5) ? "F" : "M", birth, fam.id, { noble: true, fatherId: lord.id, motherId: wife.id });
      this.addMember(child, true);
      lastBirth = Math.max(lastBirth, birth);
    }
    if (lastBirth > -Infinity) fam.lastBirthTick = lastBirth;
    pop.version += 1;
    // Comme les familles du village : quelques jours de vivres apportés avec soi.
    fam.food = pop.familyDailyFood(fam.id) * DEMOGRAPHY.provisionsDepartJours;
    d.founderId = lord.id;
    d.lordId = lord.id;
    d.reigns = [{ lordId: lord.id, fromTick: tick, toTick: null }];
    const kids = this.childrenOf(lord.id);
    const kidText = kids.length > 0 ? ` et ${kids.length > 1 ? "leurs enfants" : `leur ${bySex(kids[0]!.sex, "fils", "fille")}`} ${kids.map((k) => k.name).join(", ")}` : "";
    this.chronicle(`${lord.name}, ${ageOf(lord, tick)} ans, fonde la ${d.name} avec son épouse ${wife.name}${kidText}.`);
  }

  private ageTicks(rng: Rng, minYears: number, maxYears: number): number {
    return rng.int(minYears * TICKS_PER_YEAR, (maxYears + 1) * TICKS_PER_YEAR - 1);
  }

  private pickHouse(rng: Rng): string {
    if (this.d.neighbors.length > 0) return rng.pick(this.d.neighbors);
    return `Maison de ${rng.pick(NAMES.fiefs)}`;
  }

  private addMember(v: Villager, blood: boolean): DynastyMember {
    const m: DynastyMember = {
      id: v.id,
      name: v.name,
      sex: v.sex,
      birthTick: v.birthTick,
      fatherId: v.fatherId ?? null,
      motherId: v.motherId ?? null,
      blood,
      status: "vivant",
      endTick: null,
      spouseIds: [],
    };
    this.d.members.push(m);
    return m;
  }

  private link(a: number, b: number): void {
    this.member(a)?.spouseIds.push(b);
    this.member(b)?.spouseIds.push(a);
  }

  // ------------------------------------------------------------ lecture

  member(id: number | null | undefined): DynastyMember | undefined {
    if (id === null || id === undefined) return undefined;
    const list = this.d.members;
    if (list !== this.indexedList || list.length !== this.indexedCount) {
      this.index = new Map(list.map((m) => [m.id, m]));
      this.indexedList = list;
      this.indexedCount = list.length;
    }
    return this.index.get(id);
  }

  get lord(): DynastyMember | undefined {
    return this.member(this.d.lordId);
  }

  ageOf(m: DynastyMember, tick = this.sim.state.tick): number {
    return Math.floor(((m.status === "vivant" ? tick : (m.endTick ?? tick)) - m.birthTick) / TICKS_PER_YEAR);
  }

  isAdult(m: DynastyMember, tick = this.sim.state.tick): boolean {
    return this.ageOf(m, tick) >= DYNASTY.majorite;
  }

  /** Conjoint vivant, s'il y en a un. */
  livingSpouse(m: DynastyMember): DynastyMember | undefined {
    for (const id of m.spouseIds) {
      const s = this.member(id);
      if (s && s.status === "vivant") return s;
    }
    return undefined;
  }

  /** Enfants de sang d'un membre, du plus âgé au plus jeune. */
  childrenOf(id: number): DynastyMember[] {
    return this.d.members
      .filter((m) => m.blood && (m.fatherId === id || m.motherId === id))
      .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  }

  /** Le parent par lequel un membre descend du fondateur. */
  private bloodParent(m: DynastyMember, byId: Map<number, DynastyMember>): DynastyMember | undefined {
    const father = m.fatherId !== null ? byId.get(m.fatherId) : undefined;
    if (father?.blood) return father;
    const mother = m.motherId !== null ? byId.get(m.motherId) : undefined;
    if (mother?.blood) return mother;
    return undefined;
  }

  /** Descend du fondateur d'homme en homme (condition de la loi masculine seule). */
  private agnatic(m: DynastyMember, byId: Map<number, DynastyMember>): boolean {
    let cur: DynastyMember | undefined = m;
    while (cur) {
      if (cur.sex !== "M") return false;
      if (cur.id === this.d.founderId) return true;
      const father: DynastyMember | undefined = cur.fatherId !== null ? byId.get(cur.fatherId) : undefined;
      if (!father || !father.blood) return false;
      cur = father;
    }
    return false;
  }

  private eligible(m: DynastyMember, law: SuccessionLaw, byId: Map<number, DynastyMember>): boolean {
    return m.blood && m.status === "vivant" && (law !== "masculine" || this.agnatic(m, byId));
  }

  /** Enfants dans l'ordre de la loi (la loi masculine ne passe que par les fils). */
  private ordered(kids: DynastyMember[], law: SuccessionLaw): DynastyMember[] {
    if (law === "absolue") return kids;
    const sons = kids.filter((k) => k.sex === "M");
    if (law === "masculine") return sons;
    return [...sons, ...kids.filter((k) => k.sex === "F")];
  }

  /**
   * Ordre de succession après `fromId` (le seigneur, par défaut) : ses descendants d'abord
   * (un enfant mort est remplacé par ses propres enfants), puis ceux de son parent (frères,
   * sœurs, neveux…), et ainsi de suite en remontant jusqu'au fondateur.
   */
  lineOfSuccession(law: SuccessionLaw = this.d.law, fromId: number | null = this.d.lordId): number[] {
    const holder = this.member(fromId);
    if (!holder) return [];
    const byId = new Map(this.d.members.map((m) => [m.id, m]));
    const kidsOf = new Map<number, DynastyMember[]>();
    for (const m of [...this.d.members].sort((a, b) => a.birthTick - b.birthTick || a.id - b.id)) {
      if (!m.blood) continue;
      const parent = this.bloodParent(m, byId);
      if (!parent) continue;
      const list = kidsOf.get(parent.id) ?? [];
      list.push(m);
      kidsOf.set(parent.id, list);
    }
    const out: number[] = [];
    const seen = new Set<number>([holder.id]);
    const visit = (id: number): void => {
      for (const c of this.ordered(kidsOf.get(id) ?? [], law)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        if (this.eligible(c, law, byId)) out.push(c.id);
        visit(c.id);
      }
    };
    visit(holder.id);
    for (let p = this.bloodParent(holder, byId); p; p = this.bloodParent(p, byId)) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        if (this.eligible(p, law, byId)) out.push(p.id);
      }
      visit(p.id);
    }
    return out;
  }

  heir(law: SuccessionLaw = this.d.law): DynastyMember | undefined {
    return this.member(this.lineOfSuccession(law)[0]);
  }

  /** Affaire de famille en attente pour ce membre. */
  decisionFor(memberId: number) {
    return this.d.decisions.find((x) => x.memberId === memberId);
  }

  // ------------------------------------------------------------ événements de la population

  /** Un enfant naît dans un foyer noble : il entre dans la lignée. */
  onBirth(child: Villager, familyNoble: boolean): void {
    if (!familyNoble) return;
    child.noble = true;
    this.addMember(child, true);
    const father = this.member(child.fatherId);
    const mother = this.member(child.motherId);
    const parents = [father?.name, mother?.name].filter(Boolean).join(" et ");
    this.chronicle(`Naissance de ${child.name}, ${bySex(child.sex, "fils", "fille")} de ${parents}.`);
  }

  /** Des villageois sont morts aujourd'hui : on met l'arbre à jour, et on règle la succession. */
  onDeaths(dead: { v: Villager; cause: string }[]): void {
    const tick = this.sim.state.tick;
    let lordDied = false;
    for (const { v, cause } of dead) {
      const m = this.member(v.id);
      if (!m) continue;
      m.status = "mort";
      m.endTick = tick;
      const taken = bySex(m.sex, "emporté", "emportée");
      const why = cause === "faim" ? `, ${taken} par la faim` : cause === "froid" ? `, ${taken} par le froid` : "";
      const of = m.id === this.d.lordId ? bySex(m.sex, "du seigneur", "de la dame") : "de";
      this.chronicle(`Mort ${of} ${m.name}, à ${this.ageOf(m, tick)} ans${why}.`);
      if (m.id === this.d.lordId) lordDied = true;
    }
    this.d.decisions = this.d.decisions.filter((x) => this.member(x.memberId)?.status === "vivant");
    if (lordDied) this.succeed();
    else this.checkRegent();
  }

  private succeed(): void {
    const d = this.d;
    const tick = this.sim.state.tick;
    const old = this.lord as DynastyMember;
    const reign = d.reigns[d.reigns.length - 1];
    if (reign && reign.toTick === null) reign.toTick = tick;
    const heir = this.heir();
    if (!heir) {
      d.lordId = null;
      d.regency = null;
      d.pendingLaw = null;
      const text = `Avec ${old.name} s'éteint la ${d.name} : plus aucun héritier selon la loi (${LAW_NAMES[d.law].toLowerCase()}). Fin de la partie.`;
      this.chronicle(text);
      this.sim.addLog(text);
      this.sim.state.gameOver = { reason: "extinction", tick };
      this.events.push({ type: "gameOver" });
      return;
    }
    d.lordId = heir.id;
    d.reigns.push({ lordId: heir.id, fromTick: tick, toTick: null });
    const age = this.ageOf(heir, tick);
    let regency = "";
    if (age < DYNASTY.majorite) {
      const regent = this.pickRegent(heir);
      d.regency = { regentId: regent?.id ?? null };
      regency = regent ? `, sous la régence de ${regent.name}` : ", sous la régence d'un conseil";
    } else {
      d.regency = null;
    }
    const text = `${heir.name}, ${age} ans, devient ${bySex(heir.sex, "seigneur", "dame")} de la ${d.name}${regency}.`;
    this.chronicle(text);
    this.sim.addLog(text);
    this.events.push({ type: "succession", deadId: old.id, heirId: heir.id });
  }

  /** Régent : un parent vivant et majeur du jeune seigneur, sinon l'adulte le plus âgé de la famille. */
  private pickRegent(lord: DynastyMember): DynastyMember | undefined {
    const parents = [this.member(lord.fatherId), this.member(lord.motherId)].filter(
      (p): p is DynastyMember => p !== undefined && p.status === "vivant" && this.isAdult(p),
    );
    if (parents.length > 0) return parents[0];
    return this.d.members
      .filter((m) => m.status === "vivant" && m.id !== lord.id && this.isAdult(m))
      .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id)[0];
  }

  private checkRegent(): void {
    const reg = this.d.regency;
    if (!reg || reg.regentId === null) return;
    if (this.member(reg.regentId)?.status === "vivant") return;
    const lord = this.lord;
    if (!lord) return;
    const regent = this.pickRegent(lord);
    reg.regentId = regent?.id ?? null;
    this.chronicle(regent ? `${regent.name} devient régent${bySex(regent.sex, "", "e")} pour ${lord.name}.` : `Un conseil de régence gouverne pour ${lord.name}.`);
  }

  /** Événements produits depuis le dernier appel (succession, fin de partie, affaire de famille). */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------ journée

  daily(rng: Rng): void {
    const d = this.d;
    if (d.lordId === null) return;
    const tick = this.sim.state.tick;
    if (d.pendingLaw && tick >= d.pendingLaw.effectiveTick) {
      d.law = d.pendingLaw.law;
      d.pendingLaw = null;
      const text = `Le décret entre en vigueur : la loi de succession devient « ${LAW_NAMES[d.law]} ».`;
      this.chronicle(text);
      this.sim.addLog(text);
    }
    const lord = this.lord;
    if (d.regency && lord && this.isAdult(lord, tick)) {
      d.regency = null;
      const text = `${lord.name} atteint sa majorité : fin de la régence.`;
      this.chronicle(text);
      this.sim.addLog(text);
    }
    for (const m of d.members) {
      if (!m.blood || m.status !== "vivant" || !this.isAdult(m, tick)) continue;
      if (this.livingSpouse(m) || this.decisionFor(m.id)) continue;
      if (m.spouseIds.length > 0) {
        // Veuf ou veuve : seul le seigneur se voit proposer un remariage.
        if (m.id !== d.lordId || m.noRemarriage || this.ageOf(m, tick) > DYNASTY.remariageAgeMax) continue;
      }
      d.decisions.push({ memberId: m.id, suitors: this.suitorsFor(rng, m, tick), createdTick: tick });
      this.sim.addLog(`Affaire de famille : ${m.name} a ${this.ageOf(m, tick)} ans. Décidez de son avenir (panneau Lignée).`);
      this.events.push({ type: "familyMatter", memberId: m.id });
    }
  }

  private suitorsFor(rng: Rng, m: DynastyMember, tick: number): Suitor[] {
    const sex: Sex = m.sex === "M" ? "F" : "M";
    const names = sex === "F" ? NAMES.prenomsF : NAMES.prenomsM;
    return DYNASTY.pretendants.map((band) => ({
      name: rng.pick(names),
      sex,
      birthTick: tick - this.ageTicks(rng, band.ageMin, band.ageMax),
      dowry: rng.int(band.dotMin, band.dotMax),
      house: this.pickHouse(rng),
    }));
  }

  // ------------------------------------------------------------ commandes

  checkDecision(memberId: number, choice: DecisionChoice): { ok: boolean; reason?: string } {
    const dec = this.decisionFor(memberId);
    const m = this.member(memberId);
    if (!dec || !m || m.status !== "vivant") return { ok: false, reason: "Aucune affaire de famille en attente pour cette personne." };
    if (typeof choice === "number") {
      if (!Number.isInteger(choice) || !dec.suitors[choice]) return { ok: false, reason: "Prétendant inconnu." };
      return { ok: true };
    }
    if (choice === "eglise" || choice === "alliance") {
      if (m.id === this.d.lordId) return { ok: false, reason: `${bySex(m.sex, "Le seigneur", "La dame")} ne peut pas quitter le domaine.` };
      return { ok: true };
    }
    if (choice === "refuser") {
      if (m.id !== this.d.lordId || m.spouseIds.length === 0) return { ok: false, reason: "Seul un seigneur veuf peut refuser de se remarier." };
      return { ok: true };
    }
    return { ok: false, reason: "Choix inconnu." };
  }

  applyDecision(memberId: number, choice: DecisionChoice): void {
    const d = this.d;
    const dec = this.decisionFor(memberId) as NonNullable<ReturnType<Dynasty["decisionFor"]>>;
    const m = this.member(memberId) as DynastyMember;
    d.decisions = d.decisions.filter((x) => x !== dec);
    if (typeof choice === "number") {
      this.marry(m, dec.suitors[choice] as Suitor);
    } else if (choice === "eglise") {
      this.leave(m, "eglise");
      d.prestigeAcquis += DYNASTY.eglise.prestige;
      this.chronicle(`${m.name} entre dans l'Église (+${DYNASTY.eglise.prestige} prestige).`);
    } else if (choice === "alliance") {
      const house = this.sim.withRng((rng) => this.pickHouse(rng));
      this.leave(m, "parti");
      d.prestigeAcquis += DYNASTY.alliance.prestige;
      this.sim.state.treasury += DYNASTY.alliance.or;
      this.chronicle(`${m.name} part épouser un membre de la ${house} (+${DYNASTY.alliance.or} or, +${DYNASTY.alliance.prestige} prestige).`);
    } else {
      m.noRemarriage = true;
      this.chronicle(`${m.name} choisit de ne pas se remarier.`);
    }
    this.sim.population.version += 1;
  }

  private marry(m: DynastyMember, s: Suitor): void {
    const pop = this.sim.population;
    const v = pop.villager(m.id) as Villager;
    const spouse = pop.addVillager({ name: s.name, sex: s.sex, birthTick: s.birthTick, familyId: 0, noble: true });
    const sm = this.addMember(spouse, false);
    sm.house = s.house;
    this.link(m.id, spouse.id);
    const current = pop.family(v.familyId);
    const own = current && (current.husbandId === v.id || current.wifeId === v.id);
    if (current && own) {
      // Seigneur veuf : le nouveau conjoint rejoint son foyer (et ses enfants).
      if (spouse.sex === "M") current.husbandId = spouse.id;
      else current.wifeId = spouse.id;
      spouse.familyId = current.id;
    } else {
      const manor = this.sim.state.buildings.find((b) => b.type === "manoir");
      const husband = m.sex === "M" ? v.id : spouse.id;
      const wife = m.sex === "M" ? spouse.id : v.id;
      const fam = pop.newFamily(husband, wife, manor ? manor.id : null);
      fam.noble = true;
      v.familyId = fam.id;
      spouse.familyId = fam.id;
      if (current) pop.dropIfEmpty(current.id);
      pop.version += 1;
      pop.provisionNoble(fam);
    }
    pop.version += 1;
    this.sim.state.treasury += s.dowry;
    const age = Math.floor((this.sim.state.tick - s.birthTick) / TICKS_PER_YEAR);
    this.chronicle(`${m.name} épouse ${s.name}, ${age} ans, de la ${s.house} (dot : ${s.dowry} or).`);
  }

  private leave(m: DynastyMember, status: "eglise" | "parti"): void {
    const v = this.sim.population.villager(m.id);
    if (v) this.sim.population.remove(v);
    m.status = status;
    m.endTick = this.sim.state.tick;
  }

  checkDecree(law: SuccessionLaw): { ok: boolean; reason?: string } {
    if (this.d.lordId === null) return { ok: false, reason: "La lignée est éteinte." };
    if (law === this.d.law && !this.d.pendingLaw) return { ok: false, reason: "Cette loi est déjà en vigueur." };
    if (this.d.pendingLaw?.law === law) return { ok: false, reason: "Ce décret est déjà pris." };
    return { ok: true };
  }

  /** Décret : la nouvelle loi s'applique après un délai ; revenir à la loi en vigueur annule le décret. */
  decree(law: SuccessionLaw): void {
    const d = this.d;
    const tick = this.sim.state.tick;
    if (law === d.law) {
      d.pendingLaw = null;
      this.chronicle(`Le décret est annulé : la loi « ${LAW_NAMES[d.law]} » reste en vigueur.`);
      return;
    }
    d.pendingLaw = { law, effectiveTick: tick + DYNASTY.delaiDecretJours * DAY_TICKS };
    const when = dateOf(d.pendingLaw.effectiveTick);
    this.chronicle(`Décret : la loi de succession deviendra « ${LAW_NAMES[law]} » (${when.seasonName.toLowerCase()} de l'an ${when.year}).`);
  }

  // ------------------------------------------------------------ prestige et chronique

  prestige(): PrestigeBreakdown {
    const P = DYNASTY.prestige;
    const d = this.d;
    const tick = this.sim.state.tick;
    const founded = d.reigns[0]?.fromTick ?? 0;
    const parts = [
      { label: "Population", value: this.sim.state.villagers.length * P.parHabitant },
      { label: "Trésor", value: Math.floor(this.sim.state.treasury / P.orParPoint) },
      { label: "Ancienneté de la lignée", value: Math.floor((tick - founded) / TICKS_PER_YEAR) * P.parAnDeLignee },
      { label: "Successions", value: Math.max(0, d.reigns.length - 1) * P.parSuccession },
      { label: "Église et alliances", value: d.prestigeAcquis },
    ];
    return { total: parts.reduce((s, p) => s + p.value, 0), parts };
  }

  chronicle(text: string): void {
    this.d.chronicle.push({ tick: this.sim.state.tick, text });
  }
}
