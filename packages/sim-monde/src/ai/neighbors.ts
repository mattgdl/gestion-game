/**
 * Seigneurs voisins contrôlés par l'IA (J5). Ils ne bâtissent rien : à chaque bilan, leurs
 * villages produisent et consomment, grandissent ou souffrent, et leur seigneur prépare ou
 * fait l'achat d'un fief voisin, selon son archétype.
 *
 * Tout se passe à la barrière, dans l'ordre des identifiants, avec le générateur à graine du
 * Monde : deux joueurs obtiennent le même monde.
 */
import { TRADE_GOODS, type ProposeAction, type Rng, type WorldEvent } from "@jeu/shared";
import { FIEFS, adjacent, fiefValue, sellerFactor } from "../fiefs";
import { fiefById, type Lord, type WorldState } from "../state";
import { IA, archetypeOf } from "./archetypes";

/** Seigneurs IA qui possèdent encore au moins un fief, dans l'ordre des identifiants. */
export function activeAiLords(world: WorldState): Lord[] {
  return world.lords
    .filter((l) => l.ai && world.fiefs.some((f) => f.ownerId === l.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Production, consommation, impôts et croissance des villages IA, pour l'année écoulée. */
export function aiEconomy(world: WorldState, rng: Rng): void {
  const eco = IA.economie;
  for (const lord of activeAiLords(world)) {
    const ai = lord.ai!;
    const arch = archetypeOf(ai.archetype);
    const fiefs = world.fiefs.filter((f) => f.ownerId === lord.id);
    let households = 0;
    for (const f of fiefs) {
      households += f.households;
      const prod = eco.productionParFoyer[f.dominant] ?? {};
      for (const g of TRADE_GOODS) {
        const base = (prod[g] ?? 0) * f.households;
        const bonus = Math.floor((base * (arch.bonusProduction?.[g] ?? 0)) / 1000);
        if (base + bonus > 0) ai.stock[g] = (ai.stock[g] ?? 0) + base + bonus;
      }
    }
    // On mange et on use : ce qui manque sera acheté si possible.
    ai.hungry = false;
    for (const g of TRADE_GOODS) {
      const need = Math.floor((eco.consommationParFoyer[g] ?? 0) * households);
      if (need <= 0) continue;
      const have = ai.stock[g] ?? 0;
      if (g === "nourriture" && have < need) ai.hungry = true;
      ai.stock[g] = Math.max(0, have - need);
    }
    const cap = eco.reserveMax * fiefs.length;
    for (const g of TRADE_GOODS) if ((ai.stock[g] ?? 0) > cap) ai.stock[g] = cap;
    ai.gold += (eco.impotsParFoyer - eco.entretienParFoyer) * households;
    // Croissance des villages (ou famine).
    const c = IA.croissance;
    const v = FIEFS.village;
    for (const f of fiefs) {
      if (ai.hungry) {
        if (f.households > 1 && rng.next() * 1000 < c.famineParAn) f.households -= 1;
      } else if (f.households < v.foyersMax && rng.next() * 1000 < Math.floor((c.chanceParAn * arch.croissance) / 1000)) {
        f.households += 1;
      }
    }
  }
}

/**
 * Valeur d'un fief telle qu'un acheteur IA l'estime : sa valeur, corrigée par le caractère du
 * vendeur (un avare vend cher). Sans cela, un seigneur visait chaque année le même fief d'un
 * avare ou d'un reclus et voyait son offre refusée (partie test J5).
 */
function askingValue(world: WorldState, meta: Parameters<typeof fiefValue>[0], buyerId: string): number {
  return Math.floor((fiefValue(meta) * sellerFactor(world, meta, buyerId)) / 1000);
}

/** Or qu'un seigneur IA peut dépenser : son trésor moins sa part d'épargne. */
export function spendable(lord: Lord): number {
  const ai = lord.ai;
  if (!ai) return 0;
  return Math.floor((ai.gold * (1000 - archetypeOf(ai.archetype).epargne)) / 1000);
}

/** Fiefs IA d'autres seigneurs qui touchent les siens : ceux qu'il peut acheter. */
export function purchasableBy(world: WorldState, lord: Lord) {
  const mine = world.fiefs.filter((f) => f.ownerId === lord.id);
  // Jamais le dernier fief d'un autre seigneur IA : les maisons ne disparaissent que par la guerre ou les joueurs.
  const owned = (id: string) => world.fiefs.filter((f) => f.ownerId === id).length;
  return world.fiefs.filter(
    (f) => f.ownerId !== null && f.ownerId !== lord.id && f.ownerId.startsWith("ia-") && mine.some((m) => adjacent(m, f)) && owned(f.ownerId) >= 2,
  );
}

/**
 * Offres des seigneurs IA dont l'achat préparé arrive à échéance cette année. L'or part sous
 * séquestre ; il revient si l'offre échoue (voir refundAi).
 */
export function aiOffers(world: WorldState): ProposeAction[] {
  const out: ProposeAction[] = [];
  const e = IA.expansion;
  for (const lord of activeAiLords(world)) {
    const ai = lord.ai!;
    const plan = ai.plan;
    if (!plan || plan.year !== world.year) continue;
    ai.plan = null;
    const meta = fiefById(world, plan.fiefId);
    if (!meta || !purchasableBy(world, lord).some((f) => f.id === meta.id)) continue;
    const arch = archetypeOf(ai.archetype);
    const factor = e.surenchereMin + Math.floor(((e.surenchereMax - e.surenchereMin) * arch.ambition) / 1000);
    const price = Math.floor((askingValue(world, meta, lord.id) * factor) / 1000);
    if (price > spendable(lord)) continue;
    ai.gold -= price;
    out.push({ type: "buyFief", actionId: `ia-${world.year}-${lord.id}`, ownerId: lord.id, fiefId: meta.id, price });
  }
  return out;
}

/**
 * Les seigneurs IA préparent leurs achats : selon leur ambition, s'ils en ont les moyens, ils
 * visent le fief voisin le moins cher (le plus cher qu'ils puissent payer pour un conquérant).
 * La rumeur est annoncée aux domaines dont un fief touche la cible.
 */
export function aiPlans(world: WorldState, rng: Rng, events: WorldEvent[]): void {
  for (const lord of activeAiLords(world)) {
    const ai = lord.ai!;
    if (ai.plan) continue;
    const arch = archetypeOf(ai.archetype);
    if (rng.next() * 1000 >= arch.ambition) continue;
    const budget = spendable(lord);
    const targets = purchasableBy(world, lord)
      .map((f) => ({ f, v: askingValue(world, f, lord.id) }))
      .filter((t) => t.v <= budget)
      .sort((a, b) => a.v - b.v || (a.f.id < b.f.id ? -1 : 1));
    const pick = arch.id === "conquerant" ? targets[targets.length - 1] : targets[0];
    if (!pick) continue;
    ai.plan = { fiefId: pick.f.id, year: world.year + 1 };
    const players = world.lords.filter((l) => l.isPlayer).map((l) => l.id);
    for (const p of players) {
      if (world.fiefs.some((f) => f.ownerId === p && adjacent(f, pick.f))) {
        events.push({ type: "info", ownerId: p, text: `Rumeur : la ${lord.name} prépare l'achat de ${pick.f.name} pour l'an prochain.` });
      }
    }
  }
}

/**
 * Règle l'or des seigneurs IA après les ventes : l'or des offres qui échouent revient à
 * l'acheteur IA, le prix d'un fief vendu va au seigneur IA vendeur. Ces écritures ne
 * concernent pas les domaines joueurs : elles sont retirées de la liste des événements.
 */
export function settleAiGold(world: WorldState, events: WorldEvent[]): WorldEvent[] {
  const kept: WorldEvent[] = [];
  for (const e of events) {
    if (e.type === "escrowReleased" && e.ownerId.startsWith("ia-")) {
      const lord = world.lords.find((l) => l.id === e.ownerId);
      if (lord?.ai) lord.ai.gold += e.gold;
      continue;
    }
    if (e.type === "fiefTransferred" && e.fromOwnerId?.startsWith("ia-")) {
      const seller = world.lords.find((l) => l.id === e.fromOwnerId);
      if (seller?.ai) seller.ai.gold += e.price;
      if (e.toOwnerId.startsWith("ia-")) {
        const buyer = world.lords.find((l) => l.id === e.toOwnerId);
        const left = world.fiefs.some((f) => f.ownerId === e.fromOwnerId);
        kept.push({
          type: "info",
          ownerId: null,
          text: `La ${buyer?.name ?? "maison voisine"} achète ${e.name} à la ${seller?.name ?? "maison voisine"} pour ${e.price} or.${left ? "" : ` La ${seller?.name ?? "maison"} n'a plus de terres.`}`,
        });
      }
    }
    kept.push(e);
  }
  return kept;
}
