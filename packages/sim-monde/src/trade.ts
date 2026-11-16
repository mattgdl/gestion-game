/**
 * Commerce entre les domaines et les seigneurs IA (J5) : prix selon le terrain, l'archétype et
 * la relation ; propositions des seigneurs IA ; réponse aux propositions des domaines ;
 * règlement des accords au bilan. Tout se résout à la barrière annuelle.
 */
import { TRADE_GOODS, type ProposeAction, type Rng, type TradeGood, type TradeTerms, type WorldEvent } from "@jeu/shared";
import { IA, archetypeOf, clampRelation } from "./ai/archetypes";
import { activeAiLords, spendable } from "./ai/neighbors";
import type { FiefMeta, Lord, WorldState } from "./state";

const GOOD_LABEL: Record<TradeGood, string> = {
  nourriture: "vivres",
  bois: "bois",
  pierre: "pierre",
  laine: "laine",
  outils: "outils",
  vetements: "vêtements",
};

export function goodLabel(g: TradeGood): string {
  return GOOD_LABEL[g];
}

/** Production et consommation annuelles d'un seigneur IA, par marchandise. */
export function lordBalance(world: WorldState, lord: Lord): Record<TradeGood, { prod: number; cons: number }> {
  const out = {} as Record<TradeGood, { prod: number; cons: number }>;
  for (const g of TRADE_GOODS) out[g] = { prod: 0, cons: 0 };
  const arch = lord.ai ? archetypeOf(lord.ai.archetype) : null;
  for (const f of world.fiefs) {
    if (f.ownerId !== lord.id) continue;
    const prod = IA.economie.productionParFoyer[f.dominant] ?? {};
    for (const g of TRADE_GOODS) {
      const base = (prod[g] ?? 0) * f.households;
      out[g].prod += base + Math.floor((base * (arch?.bonusProduction?.[g] ?? 0)) / 1000);
      out[g].cons += Math.floor((IA.economie.consommationParFoyer[g] ?? 0) * f.households);
    }
  }
  return out;
}

/** Distance en fiefs (côtés à traverser) entre deux fiefs. */
export function fiefDistance(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** Fief d'un seigneur le plus proche des terres d'un domaine (à égalité, le premier identifiant). */
export function nearestFiefOf(world: WorldState, lordId: string, ownerId: string): { fief: FiefMeta; distance: number } | null {
  const mine = world.fiefs.filter((f) => f.ownerId === ownerId);
  let best: { fief: FiefMeta; distance: number } | null = null;
  for (const f of world.fiefs) {
    if (f.ownerId !== lordId) continue;
    for (const m of mine) {
      const d = fiefDistance(f, m);
      if (!best || d < best.distance || (d === best.distance && f.id < best.fief.id)) best = { fief: f, distance: d };
    }
  }
  return best;
}

/**
 * Prix d'une unité dans un accord avec ce seigneur IA, vu du domaine : « achat » = le domaine
 * achète (le seigneur vend), « vente » = le domaine vend (le seigneur achète).
 */
export function unitPrice(world: WorldState, lord: Lord, fief: FiefMeta, good: TradeGood, side: "vente" | "achat", ownerId: string): number {
  const c = IA.commerce;
  const ai = lord.ai;
  if (!ai) return c.prixBase[good];
  const arch = archetypeOf(ai.archetype);
  const produces = (IA.economie.productionParFoyer[fief.dominant]?.[good] ?? 0) > 0 || (arch.bonusProduction?.[good] ?? 0) > 0;
  const consumes = (IA.economie.consommationParFoyer[good] ?? 0) > 0;
  const local = produces ? c.produitPourMille : consumes ? c.manquePourMille : 1000;
  const relation = ai.relations[ownerId] ?? 0;
  const rel = relation * c.relationPourMilleParPoint;
  // Le seigneur vend plus cher et achète moins cher (sa marge) ; la relation corrige les deux.
  const margin = side === "achat" ? 1000 + arch.marge - rel : 1000 - arch.marge + rel;
  const price = Math.round((c.prixBase[good] * local * margin) / 1_000_000);
  return Math.max(1, price);
}

/** Accords en cours entre ce domaine et ce seigneur. */
function agreementsWith(world: WorldState, ownerId: string, lordId: string): TradeTerms[] {
  return world.agreements.filter((a) => a.ownerId === ownerId && a.partnerId === lordId);
}

/** Ce qu'un seigneur IA peut vendre par an (surplus) ou veut acheter (manque) d'une marchandise. */
export function lordTradeRoom(world: WorldState, lord: Lord, good: TradeGood): { surplus: number; manque: number } {
  const b = lordBalance(world, lord)[good];
  const stock = lord.ai?.stock[good] ?? 0;
  const committed = (side: "vente" | "achat") =>
    world.agreements.filter((a) => a.partnerId === lord.id && a.good === good && a.side === side).reduce((n, a) => n + a.perYear, 0);
  // Le domaine achète ce que le seigneur a en trop ; il vend ce qui lui manque.
  const surplus = Math.max(0, b.prod - b.cons + Math.floor(stock / 2) - committed("achat"));
  const manque = Math.max(0, b.cons - b.prod - committed("vente"));
  return { surplus, manque };
}

/** Le seigneur IA accepte-t-il cet accord proposé par un domaine ? */
export function judgeProposal(world: WorldState, a: Extract<ProposeAction, { type: "proposeTrade" }>): { ok: boolean; reason: string } {
  const lord = world.lords.find((l) => l.id === a.partnerId);
  const near = lord ? nearestFiefOf(world, lord.id, a.ownerId) : null;
  if (!lord?.ai || !near) return { ok: false, reason: "Ce seigneur n'a plus de terres." };
  const ai = lord.ai;
  const name = lord.name;
  const relation = ai.relations[a.ownerId] ?? 0;
  if (relation <= -50) return { ok: false, reason: `La ${name} refuse de traiter avec vous (relation ${relation}).` };
  if (agreementsWith(world, a.ownerId, lord.id).length >= IA.commerce.accordsMaxParSeigneur) {
    return { ok: false, reason: `La ${name} a déjà assez d'accords avec vous.` };
  }
  if (a.perYear < 1 || a.years < 1 || a.price < 1) return { ok: false, reason: "Accord invalide." };
  const fair = unitPrice(world, lord, near.fief, a.good, a.side, a.ownerId);
  const room = lordTradeRoom(world, lord, a.good);
  const label = goodLabel(a.good);
  if (a.side === "vente") {
    if (a.price > fair) return { ok: false, reason: `La ${name} ne paiera pas plus de ${fair} or l'unité de ${label}.` };
    if (a.perYear > Math.max(10, room.manque)) {
      return { ok: false, reason: room.manque > 0 ? `La ${name} n'a besoin que d'environ ${room.manque} ${label} par an.` : `La ${name} n'a pas besoin de ${label}.` };
    }
    if (a.perYear * a.price > spendable(lord) + IA.economie.impotsParFoyer * 10) return { ok: false, reason: `La ${name} n'a pas les moyens de payer autant.` };
  } else {
    if (a.price < fair) return { ok: false, reason: `La ${name} ne vend pas ses ${label} moins de ${fair} or l'unité.` };
    if (a.perYear > room.surplus) {
      return { ok: false, reason: room.surplus > 0 ? `La ${name} ne peut fournir qu'environ ${room.surplus} ${label} par an.` : `La ${name} n'a pas de ${label} à vendre.` };
    }
  }
  return { ok: true, reason: "" };
}

/** Propositions des seigneurs IA aux domaines (au plus quelques-unes en attente par domaine). */
export function aiProposals(world: WorldState, rng: Rng, players: string[], events: WorldEvent[]): void {
  const c = IA.commerce;
  // Les propositions expirées disparaissent.
  world.proposals = world.proposals.filter((p) => p.expiresYear > world.year);
  for (const ownerId of players) {
    let made = 0;
    // L'ordre des seigneurs change chaque année (tiré au sort) : pas toujours les mêmes en premier.
    for (const lord of rng.shuffle(activeAiLords(world))) {
      const pending = world.proposals.filter((p) => p.terms.ownerId === ownerId).length;
      if (pending >= c.propositionsMax || made >= c.propositionsParAn) break;
      const ai = lord.ai!;
      const arch = archetypeOf(ai.archetype);
      const near = nearestFiefOf(world, lord.id, ownerId);
      if (!near || near.distance > 2) continue;
      if ((ai.relations[ownerId] ?? 0) <= -50) continue;
      if (agreementsWith(world, ownerId, lord.id).length >= c.accordsMaxParSeigneur) continue;
      if (world.proposals.some((p) => p.terms.ownerId === ownerId && p.terms.partnerId === lord.id)) continue;
      if (rng.next() * 1000 >= arch.commerce) continue;
      // Ce qui lui manque le plus (en or), sinon ce qu'il a le plus en trop.
      let best: { good: TradeGood; side: "vente" | "achat"; qty: number; score: number } | null = null;
      for (const g of TRADE_GOODS) {
        const room = lordTradeRoom(world, lord, g);
        const want = { good: g, side: "vente" as const, qty: room.manque, score: room.manque * c.prixBase[g] * 2 };
        const sell = { good: g, side: "achat" as const, qty: room.surplus, score: room.surplus * c.prixBase[g] };
        for (const o of [want, sell]) if (o.qty >= 10 && (!best || o.score > best.score)) best = o;
      }
      if (!best) continue;
      const perYear = Math.min(60, Math.max(10, Math.floor(best.qty / 5) * 5));
      if (best.side === "vente" && perYear * unitPrice(world, lord, near.fief, best.good, "vente", ownerId) > spendable(lord) + ai.gold / 2) continue;
      const years = rng.int(c.dureeAns[0], c.dureeAns[1]) + (arch.id === "diplomate" ? 1 : 0);
      const terms: TradeTerms = {
        id: `p-${world.year}-${lord.id}-${ownerId}`,
        ownerId,
        partnerId: lord.id,
        partnerFiefId: near.fief.id,
        good: best.good,
        side: best.side,
        perYear,
        price: unitPrice(world, lord, near.fief, best.good, best.side, ownerId),
        firstYear: world.year + 1,
        lastYear: world.year + years,
      };
      world.proposals.push({ terms, expiresYear: world.year + c.expirationAns });
      made += 1;
      events.push({ type: "tradeProposed", ownerId, terms, expiresYear: world.year + c.expirationAns });
    }
  }
}

function relationText(delta: number): string {
  return delta > 0 ? ` (relation +${delta})` : delta < 0 ? ` (relation ${delta})` : "";
}

function shift(lord: Lord, ownerId: string, delta: number): number {
  const ai = lord.ai!;
  const arch = archetypeOf(ai.archetype);
  const d = delta > 0 ? Math.round((delta * arch.gainRelation) / 1000) : delta;
  ai.relations[ownerId] = clampRelation((ai.relations[ownerId] ?? 0) + d);
  return d;
}

/**
 * Accords au bilan : acceptations et ruptures des domaines, puis règlement de l'année (or,
 * réserves des seigneurs IA, relation), fin des accords échus ou rompus par l'IA, et réponses
 * aux propositions des domaines.
 */
export function resolveTrade(world: WorldState, actions: ProposeAction[], rng: Rng, events: WorldEvent[]): void {
  const c = IA.commerce;
  const sorted = [...actions].sort((x, y) => (x.actionId < y.actionId ? -1 : x.actionId > y.actionId ? 1 : 0));
  const lordOf = (id: string) => world.lords.find((l) => l.id === id);

  // 1. Propositions IA acceptées pendant l'année : elles deviennent des accords.
  for (const a of sorted) {
    if (a.type !== "acceptTrade") continue;
    const i = world.proposals.findIndex((p) => p.terms.id === a.proposalId && p.terms.ownerId === a.ownerId);
    if (i < 0) continue;
    const [p] = world.proposals.splice(i, 1);
    world.agreements.push({ ...p!.terms });
  }

  // 2. Ruptures demandées par les domaines.
  for (const a of sorted) {
    if (a.type !== "cancelTrade") continue;
    const i = world.agreements.findIndex((t) => t.id === a.agreementId && t.ownerId === a.ownerId);
    if (i < 0) continue;
    const [t] = world.agreements.splice(i, 1);
    const lord = lordOf(t!.partnerId);
    const d = lord?.ai ? shift(lord, a.ownerId, c.relation.rompu) : 0;
    events.push({
      type: "tradeSettled",
      ownerId: a.ownerId,
      agreementId: t!.id,
      quantity: 0,
      gold: 0,
      relation: lord?.ai?.relations[a.ownerId] ?? 0,
      ended: true,
      text: `Vous rompez l'accord avec la ${lord?.name ?? "maison voisine"}${relationText(d)}.`,
    });
  }

  // 3. Règlement de l'année pour chaque accord en cours.
  const reports = new Map<string, Extract<ProposeAction, { type: "tradeReport" }>>();
  for (const a of sorted) if (a.type === "tradeReport") reports.set(`${a.ownerId}|${a.agreementId}`, a);
  const reporting = new Set(sorted.map((a) => a.ownerId));
  for (const t of [...world.agreements].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (t.firstYear > world.year) continue;
    const lord = lordOf(t.partnerId);
    const label = goodLabel(t.good);
    const report = reports.get(`${t.ownerId}|${t.id}`);
    // Un domaine absent de cette barrière n'est pas jugé.
    if (!report && !reporting.has(t.ownerId)) continue;
    const q = report?.quantity ?? 0;
    const due = report?.due ?? t.perYear;
    let gold = 0;
    let text = "";
    if (lord?.ai) {
      const ai = lord.ai;
      if (t.side === "vente") {
        gold = Math.min(q * t.price, ai.gold);
        ai.gold -= gold;
        ai.stock[t.good] = (ai.stock[t.good] ?? 0) + q;
        text = `Accord avec la ${lord.name} : ${q} ${label} livrés sur ${due}, ${gold} or reçus`;
        if (gold < q * t.price) text += ` (il n'a pu payer que ${gold} or)`;
      } else {
        ai.gold += report?.paid ?? 0;
        ai.stock[t.good] = Math.max(0, (ai.stock[t.good] ?? 0) - q);
        text = `Accord avec la ${lord.name} : ${q} ${label} reçus sur ${due}, ${report?.paid ?? 0} or payés`;
      }
      let d = 0;
      if (due > 0) d = shift(lord, t.ownerId, q * 1000 >= due * c.seuilPartiel ? c.relation.honore : c.relation.partiel);
      text += `${relationText(d)}.`;
    }
    // Fin de l'accord : à son terme, si le partenaire n'a plus de terres, ou rompu par l'IA.
    let ended = false;
    const near = lord ? nearestFiefOf(world, lord.id, t.ownerId) : null;
    if (!near) {
      ended = true;
      text += " L'accord prend fin : ce seigneur n'a plus de terres.";
    } else if (t.lastYear <= world.year) {
      ended = true;
      text += " L'accord arrive à son terme.";
    } else if (lord?.ai && rng.next() * 2000 < 1000 - archetypeOf(lord.ai.archetype).fiabilite) {
      ended = true;
      text += ` La ${lord.name} met fin à l'accord.`;
    } else if (near.fief.id !== t.partnerFiefId) {
      t.partnerFiefId = near.fief.id;
    }
    if (ended) world.agreements = world.agreements.filter((x) => x.id !== t.id);
    events.push({
      type: "tradeSettled",
      ownerId: t.ownerId,
      agreementId: t.id,
      quantity: q,
      gold,
      relation: lord?.ai?.relations[t.ownerId] ?? 0,
      ended,
      text,
    });
  }

  // 4. Propositions des domaines : réponse des seigneurs IA, livraisons dès l'an prochain.
  for (const a of sorted) {
    if (a.type !== "proposeTrade") continue;
    const verdict = judgeProposal(world, a);
    if (!verdict.ok) {
      events.push({ type: "tradeRefused", ownerId: a.ownerId, actionId: a.actionId, reason: verdict.reason });
      continue;
    }
    const near = nearestFiefOf(world, a.partnerId, a.ownerId)!;
    const terms: TradeTerms = {
      id: a.actionId,
      ownerId: a.ownerId,
      partnerId: a.partnerId,
      partnerFiefId: near.fief.id,
      good: a.good,
      side: a.side,
      perYear: a.perYear,
      price: a.price,
      firstYear: world.year + 1,
      lastYear: world.year + a.years,
    };
    world.agreements.push(terms);
    events.push({ type: "tradeAgreed", ownerId: a.ownerId, actionId: a.actionId, terms });
  }
}
