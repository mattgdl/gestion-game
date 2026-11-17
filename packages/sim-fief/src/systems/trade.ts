/**
 * Commerce du domaine avec les seigneurs IA (J5), côté Fief.
 *
 * - Les accords viennent du Monde (propositions des seigneurs IA, réponses aux propositions
 *   du domaine) ; le domaine lui remet au bilan ce qu'il a livré ou reçu.
 * - Le relais rassemble ce qu'il faut livrer (ses porteurs vont le chercher dans les réserves),
 *   ses charretiers partent en convoi : une charrette par charretier, 30 marchandises au plus,
 *   10 jours de route par fief de distance, autant au retour.
 * - Vente : la marchandise compte à l'arrivée chez le partenaire, l'or arrive au bilan.
 *   Achat : la charrette part à vide, paie sur place (selon le trésor) et rapporte la marchandise
 *   au relais, d'où les porteurs la rangent dans les réserves.
 *
 * Tout est en entiers et suit l'ordre des identifiants : déterministe.
 */
import { TRADE_GOODS, parseFiefId, type ProposeAction, type TradeGood, type WorldEvent } from "@jeu/shared";
import type { CheckResult, Command } from "../commands";
import { BUILDINGS } from "../data";
import type { DomainSim } from "../domain";
import { GOOD_NAMES, type Agreement, type Building, type Convoy } from "../state";
import { DAY_TICKS } from "./population";
import { BARRIER_OFFSET, TICKS_PER_YEAR, dateOf } from "./seasons";

type TradeCommand = Extract<
  Command,
  { type: "acceptTradeProposal" | "refuseTradeProposal" | "proposeTrade" | "withdrawTradeProposal" | "cancelTrade" }
>;

const goodName = (g: TradeGood) => GOOD_NAMES[g].toLowerCase();

export class Trade {
  constructor(private readonly sim: DomainSim) {}

  private get t() {
    return this.sim.state.trade;
  }

  private year(): number {
    return dateOf(this.sim.state.tick).year;
  }

  /** L'accord court-il cette année ? */
  isActive(a: Agreement): boolean {
    const y = this.year();
    return a.terms.firstYear <= y && y <= a.terms.lastYear;
  }

  /** Ce qui est dû cette année : moins si l'accord a été accepté en cours d'année. */
  due(a: Agreement): number {
    if (!this.isActive(a)) return 0;
    const yearStart = (this.year() - 1) * TICKS_PER_YEAR;
    if (a.startTick === null || a.startTick <= yearStart) return a.terms.perYear;
    const left = Math.max(0, yearStart + BARRIER_OFFSET - a.startTick);
    return Math.floor((a.terms.perYear * left) / BARRIER_OFFSET);
  }

  /** Quantité en route pour cet accord, pas encore comptée. */
  private inTransit(a: Agreement): number {
    let n = 0;
    for (const c of this.t.convoys) if (c.agreementId === a.terms.id && c.status === "aller" && !c.counted) n += c.qty;
    return n;
  }

  /** Ventes parties mais pas encore arrivées : elles comptent pour l'année où elles ont quitté le domaine. */
  private salesOnTheRoad(a: Agreement): number {
    if (a.terms.side !== "vente") return 0;
    return this.inTransit(a);
  }

  /** Ce qu'il reste à livrer ou à recevoir cette année, convois en route compris. */
  remaining(a: Agreement): number {
    return Math.max(0, this.due(a) - a.done - this.inTransit(a));
  }

  relays(): Building[] {
    return this.sim.state.buildings.filter((b) => BUILDINGS[b.type]?.relais && this.sim.isConnected(b.id));
  }

  /** Marchandises que le domaine vend par accord (les porteurs du relais les rassemblent). */
  saleGoods(): Set<TradeGood> {
    return new Set(this.t.agreements.filter((a) => a.terms.side === "vente" && this.isActive(a)).map((a) => a.terms.good));
  }

  /** Ce que le relais doit rassembler, par marchandise : le reste à livrer, une charrette au plus de plus que le stock. */
  relayTargets(relay: Building): Partial<Record<TradeGood, number>> {
    const def = BUILDINGS[relay.type]?.relais;
    const out: Partial<Record<TradeGood, number>> = {};
    if (!def) return out;
    for (const a of this.t.agreements) {
      if (a.terms.side !== "vente" || !this.isActive(a)) continue;
      out[a.terms.good] = Math.min(def.chargeConvoi * 2, (out[a.terms.good] ?? 0) + this.remaining(a));
    }
    return out;
  }

  /** Jours de route (aller) entre le fief du relais et celui du partenaire. */
  travelDays(relay: Building, partnerFiefId: string): number {
    const def = BUILDINGS[relay.type]?.relais;
    const here = this.sim.state.fiefs[relay.fiefId];
    const there = parseFiefId(partnerFiefId);
    if (!def || !here || !there) return 0;
    const d = Math.max(1, Math.abs(here.col - there.col) + Math.abs(here.row - there.row));
    return d * def.joursParFief;
  }

  // ------------------------------------------------------------ journée

  /** Appelé une fois par jour : arrivées, retours, départs des charrettes. */
  daily(): void {
    const tick = this.sim.state.tick;
    for (const c of [...this.t.convoys]) {
      if (c.status === "aller" && tick >= c.arriveTick) this.arrive(c);
      if (c.status === "retour" && tick >= c.returnTick) this.returnHome(c);
    }
    for (const relay of this.relays()) this.depart(relay, tick);
  }

  private agreement(id: string): Agreement | undefined {
    return this.t.agreements.find((a) => a.terms.id === id);
  }

  private arrive(c: Convoy): void {
    const a = this.agreement(c.agreementId);
    c.status = "retour";
    if (!a) return;
    if (c.side === "vente") {
      if (!c.counted) a.done += c.qty;
      c.qty = 0;
      return;
    }
    // Achat : on paie sur place ce que le trésor permet.
    const qty = Math.min(c.qty, Math.floor(this.sim.state.treasury / a.terms.price));
    const cost = qty * a.terms.price;
    this.sim.state.treasury -= cost;
    a.done += qty;
    a.paid += cost;
    c.qty = qty;
    if (qty === 0) this.sim.addLog(`Une charrette revient à vide : pas assez d'or pour payer ${goodName(c.good)}.`);
  }

  private returnHome(c: Convoy): void {
    this.t.convoys = this.t.convoys.filter((x) => x.id !== c.id);
    const relay = this.sim.building(c.relayId);
    if (relay && c.qty > 0) relay.stock[c.good] = (relay.stock[c.good] ?? 0) + c.qty;
  }

  private depart(relay: Building, tick: number): void {
    const def = BUILDINGS[relay.type]?.relais;
    if (!def) return;
    const carters = this.sim.population.workers(relay.id).length;
    let free = carters - this.t.convoys.filter((c) => c.relayId === relay.id).length;
    if (free <= 0) return;
    const ordered = [...this.t.agreements].sort((x, y) => (x.terms.id < y.terms.id ? -1 : 1));
    for (const a of ordered) {
      if (free <= 0) break;
      if (!this.isActive(a)) continue;
      const left = this.remaining(a);
      if (left <= 0) continue;
      let load = Math.min(def.chargeConvoi, left);
      const days = this.travelDays(relay, a.terms.partnerFiefId);
      if (a.terms.side === "vente") {
        const have = relay.stock[a.terms.good] ?? 0;
        // En fin d'année, on n'attend plus une charrette pleine : on part avec ce qu'on a.
        if (have < load && have > 0 && this.daysToBarrier() <= days + 10) load = have;
        if (have < load) continue;
        relay.stock[a.terms.good] = have - load;
      } else {
        // Une charrette ne part acheter que si le trésor peut payer son chargement.
        if (this.sim.state.treasury < load * a.terms.price) continue;
      }
      this.t.convoys.push({
        id: this.sim.state.nextId++,
        agreementId: a.terms.id,
        relayId: relay.id,
        good: a.terms.good,
        qty: load,
        side: a.terms.side,
        partnerFiefId: a.terms.partnerFiefId,
        departTick: tick,
        arriveTick: tick + days * DAY_TICKS,
        returnTick: tick + 2 * days * DAY_TICKS,
        status: "aller",
      });
      free -= 1;
    }
  }

  /** Jours avant le bilan d'automne de l'année en cours (0 s'il est passé). */
  private daysToBarrier(): number {
    const yearStart = (this.year() - 1) * TICKS_PER_YEAR;
    return Math.max(0, Math.floor((yearStart + BARRIER_OFFSET - this.sim.state.tick) / DAY_TICKS));
  }

  /** Le relais vient d'être démoli : ses charrettes perdent leur point de retour. */
  forgetRelay(relayId: number): void {
    this.t.convoys = this.t.convoys.filter((c) => c.relayId !== relayId);
  }

  // ------------------------------------------------------------ commandes

  check(cmd: TradeCommand): CheckResult {
    const t = this.t;
    switch (cmd.type) {
      case "acceptTradeProposal":
      case "refuseTradeProposal": {
        const p = t.proposals.find((x) => x.terms.id === cmd.proposalId);
        if (!p) return { ok: false, reason: "Cette proposition n'existe plus." };
        if (cmd.type === "acceptTradeProposal") {
          const clash = t.agreements.find((a) => a.terms.good === p.terms.good && a.terms.side !== p.terms.side);
          if (clash) return { ok: false, reason: `Vous ne pouvez pas à la fois acheter et vendre des ${goodName(p.terms.good)}.` };
        }
        return { ok: true };
      }
      case "proposeTrade": {
        if (!TRADE_GOODS.includes(cmd.good)) return { ok: false, reason: "Marchandise inconnue." };
        if (!Number.isInteger(cmd.perYear) || cmd.perYear < 5 || cmd.perYear > 300) return { ok: false, reason: "Entre 5 et 300 par an." };
        if (!Number.isInteger(cmd.price) || cmd.price < 1 || cmd.price > 100) return { ok: false, reason: "Prix entre 1 et 100 or." };
        if (!Number.isInteger(cmd.years) || cmd.years < 1 || cmd.years > 5) return { ok: false, reason: "Durée de 1 à 5 ans." };
        if (t.pending.some((p) => p.partnerId === cmd.partnerId && p.good === cmd.good)) return { ok: false, reason: "Une proposition est déjà en cours avec ce seigneur pour cette marchandise." };
        const clash = [...t.agreements.map((a) => a.terms), ...t.pending].find((x) => x.good === cmd.good && x.side !== cmd.side);
        if (clash) return { ok: false, reason: `Vous ne pouvez pas à la fois acheter et vendre des ${goodName(cmd.good)}.` };
        return { ok: true };
      }
      case "withdrawTradeProposal":
        return t.pending.some((p) => p.actionId === cmd.actionId) ? { ok: true } : { ok: false, reason: "Aucune proposition à retirer." };
      case "cancelTrade":
        return t.agreements.some((a) => a.terms.id === cmd.agreementId) ? { ok: true } : { ok: false, reason: "Aucun accord à rompre." };
    }
  }

  apply(cmd: TradeCommand): void {
    const t = this.t;
    const tick = this.sim.state.tick;
    switch (cmd.type) {
      case "acceptTradeProposal": {
        const p = t.proposals.find((x) => x.terms.id === cmd.proposalId)!;
        t.proposals = t.proposals.filter((x) => x !== p);
        t.agreements.push({ terms: { ...p.terms }, done: 0, paid: 0, startTick: tick });
        t.accepted.push(p.terms.id);
        this.sim.addLog(`Accord conclu : ${p.terms.side === "vente" ? "vous livrez" : "vous achetez"} ${p.terms.perYear} ${goodName(p.terms.good)} par an à ${p.terms.price} or l'unité, jusqu'en l'an ${p.terms.lastYear}.${this.relays().length === 0 ? " Bâtissez un relais pour les convois." : ""}`);
        return;
      }
      case "refuseTradeProposal":
        t.proposals = t.proposals.filter((x) => x.terms.id !== cmd.proposalId);
        return;
      case "proposeTrade": {
        const { type: _type, ...rest } = cmd;
        t.pending.push({ actionId: `${this.sim.state.ownerId}-${tick}-t-${cmd.partnerId}-${cmd.good}`, ...rest });
        this.sim.addLog(`Proposition d'accord envoyée : réponse au bilan d'automne.`);
        return;
      }
      case "withdrawTradeProposal":
        t.pending = t.pending.filter((p) => p.actionId !== cmd.actionId);
        return;
      case "cancelTrade": {
        t.agreements = t.agreements.filter((a) => a.terms.id !== cmd.agreementId);
        t.cancelled.push(cmd.agreementId);
        // Les charrettes de cet accord font demi-tour (une vente rapporte sa marchandise).
        for (const c of t.convoys) {
          if (c.agreementId !== cmd.agreementId || c.status !== "aller") continue;
          c.status = "retour";
          if (c.side === "achat") c.qty = 0;
          c.returnTick = tick + (tick - c.departTick);
        }
        this.sim.addLog("Accord rompu : le seigneur voisin en sera informé au bilan.");
        return;
      }
    }
  }

  // ------------------------------------------------------------ barrière

  barrierActions(): ProposeAction[] {
    const me = this.sim.state.ownerId;
    const tick = this.sim.state.tick;
    const out: ProposeAction[] = [];
    for (const p of this.t.pending) out.push({ type: "proposeTrade", ...p, ownerId: me });
    for (const id of this.t.accepted) out.push({ type: "acceptTrade", actionId: `${me}-${tick}-acc-${id}`, ownerId: me, proposalId: id });
    for (const id of this.t.cancelled) out.push({ type: "cancelTrade", actionId: `${me}-${tick}-fin-${id}`, ownerId: me, agreementId: id });
    for (const a of this.t.agreements) {
      if (!this.isActive(a)) continue;
      out.push({
        type: "tradeReport",
        actionId: `${me}-${tick}-bilan-${a.terms.id}`,
        ownerId: me,
        agreementId: a.terms.id,
        quantity: a.done + this.salesOnTheRoad(a),
        due: this.due(a),
        paid: a.paid,
      });
    }
    return out;
  }

  /** Un événement du Monde concernant le commerce de ce domaine. Renvoie un texte pour le bilan, s'il y a lieu. */
  applyEvent(e: WorldEvent): string | null {
    const t = this.t;
    const me = this.sim.state.ownerId;
    switch (e.type) {
      case "tradeProposed":
        if (e.ownerId !== me) return null;
        t.proposals.push({ terms: e.terms, expiresYear: e.expiresYear });
        return null;
      case "tradeAgreed": {
        if (e.ownerId !== me) return null;
        t.pending = t.pending.filter((p) => p.actionId !== e.actionId);
        t.agreements.push({ terms: e.terms, done: 0, paid: 0, startTick: null });
        const text = `Accord accepté : ${e.terms.side === "vente" ? "vous livrerez" : "vous achèterez"} ${e.terms.perYear} ${goodName(e.terms.good)} par an à ${e.terms.price} or, de l'an ${e.terms.firstYear} à l'an ${e.terms.lastYear}.`;
        this.sim.addLog(text);
        return text;
      }
      case "tradeRefused":
        if (e.ownerId !== me) return null;
        t.pending = t.pending.filter((p) => p.actionId !== e.actionId);
        this.sim.addLog(`Proposition refusée. ${e.reason}`);
        return `Proposition refusée. ${e.reason}`;
      case "tradeSettled": {
        if (e.ownerId !== me) return null;
        this.sim.state.treasury += e.gold;
        if (e.ended) t.agreements = t.agreements.filter((a) => a.terms.id !== e.agreementId);
        this.sim.addLog(e.text);
        return e.text;
      }
      default:
        return null;
    }
  }

  /** Fin du bilan : compteurs de l'année remis à zéro, propositions échues retirées. */
  afterBarrier(resolvedYear: number): void {
    const t = this.t;
    // Les ventes en route ont été comptées dans ce bilan.
    for (const c of t.convoys) if (c.side === "vente" && c.status === "aller") c.counted = true;
    for (const a of t.agreements) {
      a.done = 0;
      a.paid = 0;
      a.startTick = null;
    }
    t.accepted = [];
    t.cancelled = [];
    t.pending = [];
    t.proposals = t.proposals.filter((p) => p.expiresYear > resolvedYear);
    // Un accord terminé dont une charrette roule encore : elle rentre sans rien compter.
  }

  /** Une phrase sur l'état du relais, pour sa fiche. */
  relayStatus(relay: Building): string {
    const carters = this.sim.population.workers(relay.id).length;
    const out = this.t.convoys.filter((c) => c.relayId === relay.id);
    const goods = TRADE_GOODS.filter((g) => (relay.stock[g] ?? 0) > 0).map((g) => `${relay.stock[g]} ${goodName(g)}`);
    if (this.t.agreements.length === 0) return "Aucun accord de commerce : le relais attend (panneau Voisins, Commerce).";
    return `${out.length} charrette${out.length > 1 ? "s" : ""} en route sur ${carters} charretier${carters > 1 ? "s" : ""}${goods.length > 0 ? ` · au relais : ${goods.join(", ")}` : ""}.`;
  }
}
