/**
 * Armée du domaine (J6), côté Fief.
 *
 * - Les soldats sont les travailleurs des casernes ; un soldat compte double s'il a une arme
 *   (les porteurs de la caserne en vont chercher). Mercenaires : loués en or pour le bilan.
 * - Au bilan : la solde est payée, une part des armes s'use, et le domaine annonce ses forces
 *   au Monde, avec ses déclarations de guerre et ses levées de siège.
 * - Le Monde renvoie les assauts : le domaine perd ses soldats tombés, subit un pillage, perd
 *   ou gagne un fief.
 */
import { type ProposeAction, type WorldEvent } from "@jeu/shared";
import type { CheckResult, Command } from "../commands";
import { BUILDINGS, GUERRE_FIEF } from "../data";
import type { DomainSim } from "../domain";
import { GOOD_IDS, type Building, type Villager } from "../state";

type ArmyCommand = Extract<Command, { type: "declareWar" | "endWar" | "hireMercenaries" | "cancelWarDeclaration" }>;

export class Army {
  constructor(private readonly sim: DomainSim) {}

  private get a() {
    return this.sim.state.army;
  }

  casernes(): Building[] {
    return this.sim.state.buildings.filter((b) => BUILDINGS[b.type]?.caserne && this.sim.isConnected(b.id));
  }

  /** Soldats : les travailleurs des casernes. */
  soldiers(): Villager[] {
    const out: Villager[] = [];
    for (const b of this.casernes()) {
      for (const id of this.sim.population.workers(b.id)) {
        const v = this.sim.population.villager(id);
        if (v) out.push(v);
      }
    }
    return out.sort((x, y) => x.id - y.id);
  }

  armsInBarracks(): number {
    return this.casernes().reduce((n, b) => n + (b.stock.armes ?? 0), 0);
  }

  armed(): number {
    return Math.min(this.soldiers().length, this.armsInBarracks());
  }

  /** Force d'attaque estimée (la même formule que le Monde), moral compris. */
  strength(): number {
    const g = GUERRE_FIEF;
    const soldiers = this.soldiers().length;
    const armed = this.armed();
    const raw = (armed * g.armeFacteur + (soldiers - armed)) * g.forceSoldat + this.a.mercenaries * g.forceMercenaire;
    return Math.floor((raw * this.sim.population.moraleFactor()) / 1000);
  }

  /** Le domaine est-il en guerre (moral) ? */
  atWar(): boolean {
    return this.a.wars.length > 0;
  }

  // ------------------------------------------------------------ commandes

  check(cmd: ArmyCommand): CheckResult {
    const a = this.a;
    switch (cmd.type) {
      case "declareWar":
        if (cmd.goal !== "conquete" && cmd.goal !== "pillage") return { ok: false, reason: "But de guerre inconnu." };
        if (this.sim.state.fiefs[cmd.fiefId]) return { ok: false, reason: "Ce fief est déjà à vous." };
        if (a.pending.length > 0 || a.wars.some((w) => w.attackerId === this.sim.state.ownerId)) return { ok: false, reason: "Vous menez déjà une guerre : une à la fois." };
        return { ok: true };
      case "cancelWarDeclaration":
        return a.pending.some((p) => p.actionId === cmd.actionId) ? { ok: true } : { ok: false, reason: "Aucune déclaration à retirer." };
      case "endWar":
        return a.wars.some((w) => w.id === cmd.warId && w.attackerId === this.sim.state.ownerId) ? { ok: true } : { ok: false, reason: "Vous ne menez pas ce siège." };
      case "hireMercenaries": {
        if (!Number.isInteger(cmd.count) || cmd.count < 1 || cmd.count > 50) return { ok: false, reason: "Entre 1 et 50 mercenaires." };
        const gold = cmd.count * GUERRE_FIEF.prixMercenaire;
        if (gold > this.sim.state.treasury) return { ok: false, reason: `Pas assez d'or (il en faut ${gold}).` };
        return { ok: true };
      }
    }
  }

  apply(cmd: ArmyCommand): void {
    const a = this.a;
    const tick = this.sim.state.tick;
    switch (cmd.type) {
      case "declareWar":
        a.pending.push({ actionId: `${this.sim.state.ownerId}-${tick}-guerre-${cmd.fiefId}`, fiefId: cmd.fiefId, goal: cmd.goal });
        this.sim.addLog("Déclaration de guerre préparée : elle partira au bilan d'automne, le premier assaut l'an suivant.");
        return;
      case "cancelWarDeclaration":
        a.pending = a.pending.filter((p) => p.actionId !== cmd.actionId);
        return;
      case "endWar":
        if (!a.ends.includes(cmd.warId)) a.ends.push(cmd.warId);
        this.sim.addLog("Le siège sera levé au bilan d'automne.");
        return;
      case "hireMercenaries": {
        const gold = cmd.count * GUERRE_FIEF.prixMercenaire;
        this.sim.state.treasury -= gold;
        a.mercenaries += cmd.count;
        this.sim.addLog(`${cmd.count} mercenaire${cmd.count > 1 ? "s" : ""} loué${cmd.count > 1 ? "s" : ""} pour ${gold} or, jusqu'au bilan.`);
        return;
      }
    }
  }

  // ------------------------------------------------------------ barrière

  /** Au bilan : solde, usure des armes, puis forces et intentions remises au Monde. */
  barrierActions(): ProposeAction[] {
    const me = this.sim.state.ownerId;
    const tick = this.sim.state.tick;
    const out: ProposeAction[] = [];
    out.push({
      type: "armyReport",
      actionId: `${me}-${tick}-armee`,
      ownerId: me,
      soldiers: this.soldiers().length,
      armed: this.armed(),
      mercenaries: this.a.mercenaries,
      // Le trait Guerrier du seigneur renforce l'armée (J8) : il passe par le facteur de moral.
      morale: Math.floor((this.sim.population.moraleFactor() * (1000 + this.sim.events.rule().force)) / 1000),
      households: this.sim.state.families.filter((f) => !f.noble).length,
    });
    for (const p of this.a.pending) out.push({ type: "declareWar", actionId: p.actionId, ownerId: me, fiefId: p.fiefId, goal: p.goal });
    for (const id of this.a.ends) out.push({ type: "endWar", actionId: `${me}-${tick}-paix-${id}`, ownerId: me, warId: id });
    return out;
  }

  /** Solde et usure, payées au moment du bilan (appelé une fois, avant la résolution). */
  upkeep(): void {
    const g = GUERRE_FIEF;
    const soldiers = this.soldiers().length;
    if (soldiers > 0) {
      const pay = Math.min(this.sim.state.treasury, soldiers * g.soldeParAn);
      this.sim.state.treasury -= pay;
      this.sim.addLog(`Solde de ${soldiers} soldat${soldiers > 1 ? "s" : ""} : ${pay} or.`);
    }
    for (const b of this.casernes()) {
      const n = b.stock.armes ?? 0;
      b.stock.armes = n - Math.floor((n * g.usureArmes) / 1000);
    }
  }

  /** Un événement du Monde qui touche l'armée du domaine. Renvoie un texte pour le bilan, s'il y a lieu. */
  applyEvent(e: WorldEvent): string | null {
    const me = this.sim.state.ownerId;
    const a = this.a;
    switch (e.type) {
      case "warDeclared": {
        if (e.war.attackerId !== me && e.war.defenderId !== me) return null;
        a.wars.push({ ...e.war });
        if (e.war.attackerId === me) a.pending = a.pending.filter((p) => p.fiefId !== e.war.fiefId);
        this.sim.addLog(e.text);
        this.sim.dynasty.chronicle(e.text);
        return e.text;
      }
      case "warRound": {
        if (e.attackerId !== me && e.defenderId !== me) return null;
        const w = a.wars.find((x) => x.id === e.warId);
        if (w) {
          if (e.attackerWon) w.won += 1;
          else w.lost += 1;
        }
        const losses = e.attackerId === me ? e.attackerLosses : e.defenderLosses;
        this.loseSoldiers(losses);
        this.sim.addLog(e.text);
        return e.text;
      }
      case "warEnded": {
        if (e.attackerId !== me && e.defenderId !== me) return null;
        a.wars = a.wars.filter((x) => x.id !== e.warId);
        a.ends = a.ends.filter((x) => x !== e.warId);
        this.sim.addLog(e.text);
        this.sim.dynasty.chronicle(e.text);
        return e.text;
      }
      case "pillaged":
        if (e.ownerId !== me) return null;
        this.suffer(e.goldPermille, e.reservesPermille, e.deaths);
        this.sim.addLog(e.text);
        this.sim.dynasty.chronicle(e.text);
        return e.text;
      case "paymentReceived":
        if (e.ownerId !== me) return null;
        this.sim.state.treasury += e.gold;
        this.sim.addLog(e.reason);
        return e.reason;
      case "info":
        // Les déclarations refusées par le Monde : la déclaration en attente disparaît.
        if (e.ownerId === me && e.text.startsWith("Guerre impossible")) {
          a.pending = [];
          return e.text;
        }
        return null;
      default:
        return null;
    }
  }

  afterBarrier(): void {
    this.a.mercenaries = 0;
    this.a.pending = [];
    this.a.ends = [];
  }

  /** Les soldats tombés (les plus anciens soldats d'abord, ordre fixe). */
  private loseSoldiers(n: number): void {
    if (n <= 0) return;
    const dead = this.soldiers().slice(0, n);
    for (const v of dead) this.sim.population.remove(v);
    const stats = this.sim.state.yearStats;
    stats.deaths = (stats.deaths ?? 0) + dead.length;
    if (dead.length > 0) this.sim.addLog(`Tombés au combat : ${dead.map((v) => v.name).join(", ")}.`);
  }

  /** Pillage subi : or, réserves et quelques villageois (hors lignée). */
  private suffer(goldPermille: number, reservesPermille: number, deaths: number): void {
    const st = this.sim.state;
    st.treasury -= Math.floor((st.treasury * goldPermille) / 1000);
    for (const s of this.sim.economy.storages()) {
      for (const g of GOOD_IDS) {
        const n = s.stock[g] ?? 0;
        if (n > 0) s.stock[g] = n - Math.floor((n * reservesPermille) / 1000);
      }
    }
    const victims = st.villagers.filter((v) => !v.noble).sort((x, y) => y.id - x.id).slice(0, deaths);
    for (const v of victims) this.sim.population.remove(v);
    st.yearStats.deaths = (st.yearStats.deaths ?? 0) + victims.length;
  }
}
