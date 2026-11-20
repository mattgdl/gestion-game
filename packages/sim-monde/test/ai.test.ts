import { describe, expect, it } from "vitest";
import type { BarrierInput, ProposeAction, WorldEvent } from "@jeu/shared";
import {
  IA,
  PLAYER_ID,
  adjacent,
  createWorld,
  fiefById,
  fiefValue,
  floorPrice,
  nearestFiefOf,
  resolveBarrier,
  unitPrice,
  type WorldState,
} from "../src";

const summary = { ownerId: PLAYER_ID, fiefIds: ["f-2-2"], population: 30, gold: 0, prestige: 0, lineageAlive: true };
const input = (actions: ProposeAction[] = []): BarrierInput[] => [{ ownerId: PLAYER_ID, summary, ready: true, actions }];
const lordOf = (world: WorldState, fiefId: string) => world.lords.find((l) => l.id === fiefById(world, fiefId)!.ownerId)!;

describe("seigneurs IA à archétypes", () => {
  it("chaque seigneur IA reçoit un archétype, de l'or, des vivres et une relation ; les 10 archétypes sont présents", () => {
    const world = createWorld("archetypes");
    const ais = world.lords.filter((l) => !l.isPlayer);
    expect(ais).toHaveLength(24);
    expect(new Set(ais.map((l) => l.ai!.archetype)).size).toBe(10);
    for (const l of ais) {
      expect(l.ai!.gold).toBeGreaterThanOrEqual(IA.orDepart[0]);
      expect(l.ai!.stock.nourriture).toBeGreaterThan(0);
      expect(l.ai!.relations[PLAYER_ID]).toBeGreaterThanOrEqual(-100);
    }
    expect(createWorld("archetypes")).toEqual(world);
  });

  it("au fil des bilans, les villages IA grandissent et les seigneurs s'enrichissent", () => {
    const world = createWorld("croissance");
    const before = world.fiefs.filter((f) => f.ownerId !== PLAYER_ID).reduce((n, f) => n + f.households, 0);
    const goldBefore = world.lords.reduce((n, l) => n + (l.ai?.gold ?? 0), 0);
    for (let i = 0; i < 10; i++) resolveBarrier(world, input());
    const after = world.fiefs.filter((f) => f.ownerId !== PLAYER_ID && f.ownerId?.startsWith("ia-")).reduce((n, f) => n + f.households, 0);
    expect(after).toBeGreaterThan(before);
    expect(world.lords.reduce((n, l) => n + (l.ai?.gold ?? 0), 0)).toBeGreaterThan(goldBefore);
  });

  it("un seigneur IA ambitieux prépare un achat (rumeur), puis achète le fief voisin l'an suivant, village compris", () => {
    const world = createWorld("conquete");
    const buyer = lordOf(world, "f-0-1");
    buyer.ai!.archetype = "conquerant";
    buyer.ai!.gold = 100000;
    // Un seigneur IA ne rachète pas le dernier fief d'un autre : chaque voisin en reçoit un second, loin.
    const far = world.fiefs.filter((f) => f.ownerId?.startsWith("ia-") && f.ownerId !== buyer.id && !world.fiefs.some((m) => m.ownerId === buyer.id && adjacent(m, f)));
    const neighbours = world.fiefs.filter((f) => f.ownerId?.startsWith("ia-") && f.ownerId !== buyer.id && world.fiefs.some((m) => m.ownerId === buyer.id && adjacent(m, f)));
    neighbours.forEach((n, i) => {
      if (far[i]) far[i]!.ownerId = n.ownerId;
    });
    let year = 0;
    while (!buyer.ai!.plan && year < 20) {
      resolveBarrier(world, input());
      year += 1;
    }
    expect(buyer.ai!.plan).not.toBeNull();
    const target = fiefById(world, buyer.ai!.plan!.fiefId)!;
    expect(world.fiefs.some((f) => f.ownerId === buyer.id && adjacent(f, target))).toBe(true);
    const seller = lordOf(world, target.id);
    // Un vendeur prodigue : son prix plancher reste sous l'offre d'un conquérant.
    seller.ai!.archetype = "prodigue";
    const households = target.households;
    const sellerGold = seller.ai!.gold;
    const r = resolveBarrier(world, input());
    expect(r.events).toContainEqual(expect.objectContaining({ type: "fiefTransferred", fiefId: target.id, toOwnerId: buyer.id }));
    expect(r.events.some((e) => e.type === "info" && e.text.includes(`achète ${target.name}`))).toBe(true);
    expect(target.ownerId).toBe(buyer.id);
    expect(target.households).toBeGreaterThanOrEqual(households - 1);
    expect(seller.ai!.gold).toBeGreaterThan(sellerGold);
  });

  it("le joueur peut surenchérir sur l'achat préparé par un seigneur IA : la meilleure offre l'emporte", () => {
    const world = createWorld("surenchere");
    const target = fiefById(world, "f-2-1")!;
    const buyer = lordOf(world, "f-1-1");
    buyer.ai!.gold = 100000;
    buyer.ai!.archetype = "opportuniste";
    buyer.ai!.plan = { fiefId: target.id, year: world.year };
    const taxes = (IA.economie.impotsParFoyer - IA.economie.entretienParFoyer) * world.fiefs.filter((f) => f.ownerId === buyer.id).reduce((n, f) => n + f.households, 0);
    const price = Math.max(floorPrice(world, target, PLAYER_ID), fiefValue(target) * 2);
    const r = resolveBarrier(world, input([{ type: "buyFief", actionId: "a-1", ownerId: PLAYER_ID, fiefId: target.id, price }]));
    expect(target.ownerId).toBe(PLAYER_ID);
    // L'or de l'offre perdue revient au seigneur IA, sans message pour le joueur.
    expect(r.events.some((e) => e.type === "escrowReleased" && e.ownerId === buyer.id)).toBe(false);
    expect(buyer.ai!.gold).toBe(100000 + taxes);
  });

  it("l'archétype et la relation changent le prix d'un fief", () => {
    const world = createWorld("prix");
    const f = fiefById(world, "f-2-1")!;
    const lord = lordOf(world, f.id);
    lord.ai!.archetype = "avare";
    const dear = floorPrice(world, f, PLAYER_ID);
    lord.ai!.archetype = "prodigue";
    const cheap = floorPrice(world, f, PLAYER_ID);
    expect(dear).toBeGreaterThan(cheap);
    lord.ai!.relations[PLAYER_ID] = 50;
    expect(floorPrice(world, f, PLAYER_ID)).toBeLessThan(cheap);
  });
});

describe("commerce", () => {
  it("les prix dépendent du terrain : le bois est moins cher chez un seigneur forestier", () => {
    const world = createWorld("prix-terrain");
    const forest = world.fiefs.find((f) => f.dominant === "foret" && f.ownerId !== PLAYER_ID)!;
    const plains = world.fiefs.find((f) => f.dominant === "plaines" && f.ownerId !== PLAYER_ID)!;
    for (const f of [forest, plains]) {
      const l = lordOf(world, f.id);
      l.ai!.archetype = "marchand";
      l.ai!.relations[PLAYER_ID] = 0;
    }
    const woodForest = unitPrice(world, lordOf(world, forest.id), forest, "bois", "achat", PLAYER_ID);
    const woodPlains = unitPrice(world, lordOf(world, plains.id), plains, "bois", "achat", PLAYER_ID);
    expect(woodForest).toBeLessThan(woodPlains);
    // Ce qu'aucun seigneur IA ne fabrique se vend bien : les outils.
    expect(unitPrice(world, lordOf(world, plains.id), plains, "outils", "vente", PLAYER_ID)).toBeGreaterThan(IA.commerce.prixBase.outils);
  });

  it("un seigneur IA finit par proposer un accord ; accepté, il se règle au bilan : or, réserves, relation", () => {
    const world = createWorld("accord");
    for (const l of world.lords) if (l.ai) l.ai.archetype = "marchand";
    let proposal: Extract<WorldEvent, { type: "tradeProposed" }> | undefined;
    for (let i = 0; i < 5 && !proposal; i++) {
      const r = resolveBarrier(world, input());
      proposal = r.events.find((e): e is Extract<WorldEvent, { type: "tradeProposed" }> => e.type === "tradeProposed");
    }
    expect(proposal).toBeDefined();
    const t = proposal!.terms;
    expect(t.firstYear).toBe(world.year);
    expect(nearestFiefOf(world, t.partnerId, PLAYER_ID)!.distance).toBeLessThanOrEqual(2);
    const lord = world.lords.find((l) => l.id === t.partnerId)!;
    lord.ai!.gold = 10000;
    const relation = lord.ai!.relations[PLAYER_ID]!;
    const gold = lord.ai!.gold;
    const r = resolveBarrier(
      world,
      input([
        { type: "acceptTrade", actionId: "b-1", ownerId: PLAYER_ID, proposalId: t.id },
        { type: "tradeReport", actionId: "b-2", ownerId: PLAYER_ID, agreementId: t.id, quantity: t.perYear, due: t.perYear, paid: t.side === "achat" ? t.perYear * t.price : 0 },
      ]),
    );
    const settled = r.events.find((e) => e.type === "tradeSettled" && e.agreementId === t.id);
    expect(settled).toMatchObject({ quantity: t.perYear, gold: t.side === "vente" ? t.perYear * t.price : 0 });
    expect(lord.ai!.relations[PLAYER_ID]).toBeGreaterThan(relation);
    if (t.side === "vente") expect(lord.ai!.gold).toBeLessThan(gold + 1000);
  });

  it("refuse un accord trop cher ou trop gros, accepte un accord raisonnable pour l'an suivant", () => {
    const world = createWorld("proposition");
    const lord = lordOf(world, "f-2-1");
    lord.ai!.archetype = "marchand";
    lord.ai!.gold = 5000;
    const fief = fiefById(world, "f-2-1")!;
    const fair = unitPrice(world, lord, fief, "outils", "vente", PLAYER_ID);
    const propose = (actionId: string, price: number, perYear: number): ProposeAction => ({
      type: "proposeTrade",
      actionId,
      ownerId: PLAYER_ID,
      partnerId: lord.id,
      good: "outils",
      side: "vente",
      perYear,
      price,
      years: 3,
    });
    const r = resolveBarrier(world, input([propose("t-1", fair + 5, 10), propose("t-2", fair, 500), propose("t-3", fair, 10)]));
    const refused = r.events.filter((e) => e.type === "tradeRefused");
    expect(refused.map((e) => (e as { actionId: string }).actionId).sort()).toEqual(["t-1", "t-2"]);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "tradeAgreed", actionId: "t-3" }));
    expect(world.agreements.find((a) => a.id === "t-3")).toMatchObject({ firstYear: world.year, lastYear: world.year + 2 });
  });

  it("rompre un accord coûte de la relation", () => {
    const world = createWorld("rupture");
    const lord = lordOf(world, "f-2-1");
    lord.ai!.relations[PLAYER_ID] = 0;
    world.agreements.push({ id: "x", ownerId: PLAYER_ID, partnerId: lord.id, partnerFiefId: "f-2-1", good: "bois", side: "achat", perYear: 10, price: 2, firstYear: 1, lastYear: 5 });
    resolveBarrier(world, input([{ type: "cancelTrade", actionId: "c", ownerId: PLAYER_ID, agreementId: "x" }]));
    expect(world.agreements.find((a) => a.id === "x")).toBeUndefined();
    expect(lord.ai!.relations[PLAYER_ID]).toBe(IA.commerce.relation.rompu);
  });
});

describe("propositions selon les besoins du joueur (partie test J6)", () => {
  it("un domaine qui manque de bois reçoit des offres de bois ; sinon les propositions varient", () => {
    const world = createWorld("manque-bois");
    for (const l of world.lords) if (l.ai) l.ai.archetype = "marchand";
    const short = { ...summary, shortages: ["bois" as const] };
    const goods: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary: short, ready: true, actions: [] }]);
      for (const e of r.events) if (e.type === "tradeProposed") goods.push(`${e.terms.side}:${e.terms.good}`);
      world.proposals = [];
    }
    expect(goods).toContain("achat:bois");
    const world2 = createWorld("sans-manque");
    for (const l of world2.lords) if (l.ai) l.ai.archetype = "marchand";
    const kinds = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = resolveBarrier(world2, input());
      for (const e of r.events) if (e.type === "tradeProposed") kinds.add(e.terms.side);
      world2.proposals = [];
    }
    expect(kinds.size).toBe(2);
  });

  it("un seigneur IA ne prépare jamais l'achat du dernier fief d'un autre seigneur IA", () => {
    const world = createWorld("dernier-fief");
    for (const l of world.lords) if (l.ai) l.ai.gold = 100000;
    for (let i = 0; i < 6; i++) resolveBarrier(world, input());
    for (const l of world.lords) {
      const plan = l.ai?.plan;
      if (!plan) continue;
      const seller = fiefById(world, plan.fiefId)!.ownerId!;
      expect(world.fiefs.filter((f) => f.ownerId === seller).length).toBeGreaterThanOrEqual(2);
    }
  });
});
