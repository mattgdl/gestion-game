import { describe, expect, it } from "vitest";
import type { TradeTerms } from "@jeu/shared";
import { DAY_TICKS, type DomainSim } from "../src";
import { build, labGame, manorOf, road, runUntil } from "./helpers";

/** Village du laboratoire avec une rue au sud du manoir, des maisons et un relais. */
function withRelay() {
  const { sim, world } = labGame();
  road(sim, 73, 27, 92, 27);
  for (let i = 0; i < 10; i++) build(sim, "maison", 73 + i, 28);
  const relay = build(sim, "relais", 84, 25);
  return { sim, world, relay };
}

function agreement(sim: DomainSim, over: Partial<TradeTerms> = {}): TradeTerms {
  const terms: TradeTerms = {
    id: "accord-1",
    ownerId: sim.state.ownerId,
    partnerId: "ia-1",
    partnerFiefId: "f-0-0",
    good: "bois",
    side: "vente",
    perYear: 60,
    price: 3,
    firstYear: 1,
    lastYear: 3,
    ...over,
  };
  sim.state.trade.agreements.push({ terms, done: 0, paid: 0, startTick: null });
  return terms;
}

describe("relais et convois", () => {
  it("vente : les porteurs rassemblent la marchandise au relais, les charrettes la livrent en 10 jours par fief", () => {
    const { sim, world, relay } = withRelay();
    manorOf(sim).stock = { nourriture: 100, bois: 200 };
    agreement(sim);
    runUntil(sim, world, 5 * DAY_TICKS);
    expect(sim.population.workers(relay.id).length).toBe(3);
    runUntil(sim, world, 25 * DAY_TICKS);
    const convoys = sim.state.trade.convoys;
    expect(convoys.length).toBeGreaterThan(0);
    const c = convoys[0]!;
    expect(c.arriveTick - c.departTick).toBe(10 * DAY_TICKS);
    // Une charrette pleine à l'aller, vide au retour d'une vente.
    expect(c.qty).toBe(c.status === "aller" ? 30 : 0);
    runUntil(sim, world, 80 * DAY_TICKS);
    const a = sim.state.trade.agreements[0]!;
    expect(a.done).toBe(60);
    // Rien de plus que l'accord : 60 par an.
    expect(sim.state.trade.convoys.every((x) => x.status === "retour")).toBe(true);
    expect(200 - (manorOf(sim).stock.bois ?? 0)).toBeGreaterThanOrEqual(60);
  });

  it("achat : la charrette paie sur place et rapporte la marchandise, rangée ensuite dans les réserves", () => {
    const { sim, world } = withRelay();
    sim.state.treasury = 1000;
    manorOf(sim).stock = { nourriture: 100 };
    agreement(sim, { good: "pierre", side: "achat", perYear: 30, price: 4 });
    runUntil(sim, world, 50 * DAY_TICKS);
    const a = sim.state.trade.agreements[0]!;
    expect(a.done).toBe(30);
    expect(a.paid).toBe(120);
    expect(sim.state.treasury).toBe(1000 - 120);
    expect(sim.economy.stockOf("pierre")).toBe(30);
  });

  it("sans or, la charrette ne part pas acheter", () => {
    const { sim, world } = withRelay();
    sim.state.treasury = 10;
    agreement(sim, { good: "pierre", side: "achat", perYear: 30, price: 4 });
    runUntil(sim, world, 20 * DAY_TICKS);
    expect(sim.state.trade.convoys).toEqual([]);
  });

  it("au bilan, le domaine rend compte de ses livraisons et reçoit l'or des ventes", () => {
    const { sim, world } = withRelay();
    manorOf(sim).stock = { nourriture: 100, bois: 200 };
    const terms = agreement(sim, { partnerId: world.lords.find((l) => l.ai)!.id });
    world.agreements.push({ ...terms });
    const lord = world.lords.find((l) => l.id === terms.partnerId)!;
    lord.ai!.gold = 10000;
    const gold = sim.state.treasury;
    runUntil(sim, world, 1360);
    expect(sim.state.log.some((l) => l.text.includes("60 bois livrés sur 60, 180 or reçus"))).toBe(true);
    expect(sim.state.treasury).toBeGreaterThanOrEqual(gold + 180);
    expect(sim.state.trade.agreements[0]!.done).toBe(0);
  });
});

describe("convois au moment du bilan (partie test J5)", () => {
  it("une vente encore en route au bilan compte pour l'année où elle est partie, et pas deux fois", () => {
    const { sim, world, relay } = withRelay();
    manorOf(sim).stock = { nourriture: 100 };
    runUntil(sim, world, 1275);
    const terms = agreement(sim, { partnerId: world.lords.find((l) => l.ai)!.id, perYear: 30 });
    world.agreements.push({ ...terms });
    world.lords.find((l) => l.id === terms.partnerId)!.ai!.gold = 10000;
    relay.stock.bois = 30;
    runUntil(sim, world, 1300);
    expect(sim.state.trade.convoys.some((c) => c.status === "aller" && c.qty === 30)).toBe(true);
    runUntil(sim, world, 1360);
    expect(sim.state.log.some((l) => l.text.includes("30 bois livrés sur 30"))).toBe(true);
    // À l'arrivée, l'an suivant, la charrette ne compte plus rien.
    runUntil(sim, world, 1360 + 20 * DAY_TICKS);
    expect(sim.state.trade.agreements[0]!.done).toBe(0);
  });

  it("en fin d'année, une charrette part sans attendre d'être pleine", () => {
    const { sim, world, relay } = withRelay();
    manorOf(sim).stock = { nourriture: 100 };
    runUntil(sim, world, 1200);
    agreement(sim, { perYear: 60 });
    relay.stock.bois = 12;
    runUntil(sim, world, 1200 + 2 * DAY_TICKS);
    expect(sim.state.trade.convoys.some((c) => c.qty === 12)).toBe(true);
  });
});

describe("commandes de commerce", () => {
  it("accepter une proposition l'active tout de suite ; on ne peut pas acheter et vendre la même marchandise", () => {
    const { sim } = withRelay();
    const terms: TradeTerms = { id: "p-1", ownerId: sim.state.ownerId, partnerId: "ia-1", partnerFiefId: "f-0-0", good: "bois", side: "achat", perYear: 30, price: 2, firstYear: 1, lastYear: 2 };
    sim.state.trade.proposals.push({ terms, expiresYear: 1 });
    sim.state.trade.proposals.push({ terms: { ...terms, id: "p-2", side: "vente" }, expiresYear: 1 });
    expect(sim.apply({ type: "acceptTradeProposal", proposalId: "p-1" }).ok).toBe(true);
    expect(sim.state.trade.agreements).toHaveLength(1);
    expect(sim.state.trade.accepted).toEqual(["p-1"]);
    expect(sim.apply({ type: "acceptTradeProposal", proposalId: "p-2" }).reason).toContain("à la fois");
    expect(sim.barrierActions().map((a) => a.type).filter((t) => t !== "armyReport").sort()).toEqual(["acceptTrade", "tradeReport"]);
  });

  it("proposer un accord, le retirer, rompre un accord", () => {
    const { sim } = withRelay();
    const cmd = { type: "proposeTrade" as const, partnerId: "ia-1", good: "outils" as const, side: "vente" as const, perYear: 20, price: 10, years: 3 };
    expect(sim.apply(cmd).ok).toBe(true);
    expect(sim.apply(cmd).reason).toContain("déjà en cours");
    expect(sim.barrierActions().filter((a) => a.type === "proposeTrade")).toHaveLength(1);
    const id = sim.state.trade.pending[0]!.actionId;
    expect(sim.apply({ type: "withdrawTradeProposal", actionId: id }).ok).toBe(true);
    agreement(sim);
    expect(sim.apply({ type: "cancelTrade", agreementId: "accord-1" }).ok).toBe(true);
    expect(sim.state.trade.agreements).toEqual([]);
    expect(sim.barrierActions()).toContainEqual(expect.objectContaining({ type: "cancelTrade", agreementId: "accord-1" }));
  });
});
