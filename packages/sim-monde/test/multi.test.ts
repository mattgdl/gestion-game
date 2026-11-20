import { describe, expect, it } from "vitest";
import type { BarrierInput, ProposeAction, WorldEvent } from "@jeu/shared";
import { adjacent, createWorld, fiefById, isStartFief, resolveBarrier, type WorldState } from "../src";

const PLAYERS = ["Alice", "Bruno", "Chloé", "David", "Emma", "Félix", "Gaëlle", "Hugo"].map((pseudo, i) => ({ id: `j${i + 1}`, pseudo }));

function summaryOf(world: WorldState, id: string, gold = 1000) {
  return { ownerId: id, fiefIds: world.fiefs.filter((f) => f.ownerId === id).map((f) => f.id), population: 50, gold, prestige: 0, lineageAlive: true };
}
function barrier(world: WorldState, actions: Record<string, ProposeAction[]>, gold: Record<string, number> = {}): WorldEvent[] {
  const inputs: BarrierInput[] = Object.keys(actions).map((id) => ({ ownerId: id, summary: summaryOf(world, id, gold[id] ?? 1000), ready: true, actions: actions[id]! }));
  return resolveBarrier(world, inputs).events;
}
const home = (world: WorldState, id: string) => world.fiefs.find((f) => f.ownerId === id && isStartFief(world, f))!;

/** Donne à `b` un fief IA voisin de son départ, et à `a` un fief IA qui touche ce dernier : ils deviennent voisins. */
function makeNeighbours(world: WorldState, a: string, b: string): { aFief: string; bFief: string } {
  const hb = home(world, b);
  const extra = world.fiefs.find((f) => adjacent(f, hb) && f.ownerId?.startsWith("ia-"))!;
  extra.ownerId = b;
  const touch = world.fiefs.find((f) => adjacent(f, extra) && f.ownerId?.startsWith("ia-") && !adjacent(f, hb))!;
  touch.ownerId = a;
  return { aFief: touch.id, bFief: extra.id };
}

/** Donne à `a` un fief IA qui touche le fief de départ de `b`. */
function besideHome(world: WorldState, a: string, b: string): void {
  const hb = home(world, b);
  world.fiefs.find((f) => adjacent(f, hb) && f.ownerId?.startsWith("ia-"))!.ownerId = a;
}

describe("monde à plusieurs joueurs", () => {
  it("carte 7 × 7 : 8 joueurs espacés sur des fiefs de départ préparés, 41 seigneurs IA, noms distincts", () => {
    const world = createWorld("multi", undefined, PLAYERS);
    expect(world.dims.cols).toBe(7);
    expect(world.fiefs).toHaveLength(49);
    expect(new Set(world.fiefs.map((f) => f.name)).size).toBe(49);
    const players = world.lords.filter((l) => l.isPlayer);
    expect(players.map((p) => p.pseudo).sort()).toEqual(PLAYERS.map((p) => p.pseudo).sort());
    expect(world.lords.filter((l) => l.ai)).toHaveLength(41);
    const starts = PLAYERS.map((p) => home(world, p.id));
    for (const s of starts) {
      expect(isStartFief(world, s)).toBe(true);
      for (const o of starts) if (o !== s) expect(adjacent(s, o)).toBe(false);
    }
    expect(world.dims.startFief).toBeNull();
    expect(new Set(players.map((p) => p.colorIndex)).size).toBe(8);
    for (const l of world.lords) if (l.ai) for (const p of PLAYERS) expect(l.ai.relations[p.id]).toBeDefined();
    expect(createWorld("multi", undefined, PLAYERS)).toEqual(world);
  });

  it("indique les participants du bilan (un absent n'en fait pas partie)", () => {
    const world = createWorld("absent", undefined, PLAYERS.slice(0, 3));
    const r = resolveBarrier(world, [{ ownerId: "j1", summary: summaryOf(world, "j1"), ready: true, actions: [] }]);
    expect(r.participants).toEqual(["j1"]);
  });
});

describe("entre joueurs", () => {
  it("achat de fief : le vendeur est prévenu, puis accepte au bilan suivant (or et fief changent de mains)", () => {
    const world = createWorld("achat-joueur", undefined, PLAYERS.slice(0, 2));
    const { bFief } = makeNeighbours(world, "j1", "j2");
    const offer: ProposeAction = { type: "buyFief", actionId: "o-1", ownerId: "j1", fiefId: bFief, price: 500 };
    const e1 = barrier(world, { j1: [offer], j2: [] });
    expect(e1).toContainEqual(expect.objectContaining({ type: "fiefOfferReceived", ownerId: "j2", offerId: "o-1", price: 500 }));
    expect(e1.some((e) => e.type === "escrowReleased")).toBe(false);
    const e2 = barrier(world, { j1: [offer], j2: [{ type: "answerFiefOffer", actionId: "r", ownerId: "j2", offerId: "o-1", accept: true, households: 6 }] });
    expect(e2).toContainEqual(expect.objectContaining({ type: "fiefTransferred", fiefId: bFief, fromOwnerId: "j2", toOwnerId: "j1", households: 6 }));
    expect(e2).toContainEqual(expect.objectContaining({ type: "paymentReceived", ownerId: "j2", gold: 500 }));
    expect(fiefById(world, bFief)!.ownerId).toBe("j1");
  });

  it("achat de fief refusé : l'or revient ; le fief de départ ne se vend pas", () => {
    const world = createWorld("refus-joueur", undefined, PLAYERS.slice(0, 2));
    const { bFief } = makeNeighbours(world, "j1", "j2");
    const offer: ProposeAction = { type: "buyFief", actionId: "o-2", ownerId: "j1", fiefId: bFief, price: 500 };
    barrier(world, { j1: [offer], j2: [] });
    const e2 = barrier(world, { j1: [offer], j2: [{ type: "answerFiefOffer", actionId: "r", ownerId: "j2", offerId: "o-2", accept: false, households: 0 }] });
    expect(e2).toContainEqual(expect.objectContaining({ type: "escrowReleased", ownerId: "j1", gold: 500 }));
    const homeOffer: ProposeAction = { type: "buyFief", actionId: "o-3", ownerId: "j1", fiefId: home(world, "j2").id, price: 9999 };
    const e3 = barrier(world, { j1: [homeOffer], j2: [] });
    expect(e3).toContainEqual(expect.objectContaining({ type: "escrowReleased", ownerId: "j1", gold: 9999 }));
  });

  it("commerce : le vendeur propose, l'acheteur accepte ; au bilan, l'un reçoit l'or, l'autre la marchandise", () => {
    const world = createWorld("commerce-joueurs", undefined, PLAYERS.slice(0, 2));
    const e1 = barrier(world, { j1: [{ type: "proposeTrade", actionId: "t-1", ownerId: "j1", partnerId: "j2", good: "outils", side: "vente", perYear: 20, price: 9, years: 2 }], j2: [] });
    expect(e1).toContainEqual(expect.objectContaining({ type: "tradeProposed", ownerId: "j2" }));
    const e2 = barrier(world, { j1: [], j2: [{ type: "acceptTrade", actionId: "a", ownerId: "j2", proposalId: "t-1" }] });
    const agreed = e2.find((e) => e.type === "tradeAgreed");
    expect(agreed).toMatchObject({ ownerId: "j1", terms: { firstYear: world.year, partnerId: "j2" } });
    const e3 = barrier(
      world,
      { j1: [{ type: "tradeReport", actionId: "r", ownerId: "j1", agreementId: "t-1", quantity: 20, due: 20, paid: 0 }], j2: [] },
      { j2: 100 },
    );
    expect(e3).toContainEqual(expect.objectContaining({ type: "tradeSettled", ownerId: "j1", gold: 100 }));
    expect(e3).toContainEqual(expect.objectContaining({ type: "goodsDelivered", ownerId: "j2", good: "outils", qty: 20, gold: 100 }));
  });

  it("guerre : un joueur pille le fief de départ d'un autre", () => {
    const world = createWorld("guerre-joueurs", undefined, PLAYERS.slice(0, 2));
    besideHome(world, "j1", "j2");
    const army = (id: string, soldiers: number): ProposeAction => ({ type: "armyReport", actionId: `a-${id}`, ownerId: id, soldiers, armed: soldiers, mercenaries: 0, morale: 1000, households: 10 });
    barrier(world, { j1: [army("j1", 30), { type: "declareWar", actionId: "d", ownerId: "j1", fiefId: home(world, "j2").id, goal: "pillage" }], j2: [army("j2", 0)] });
    const e = barrier(world, { j1: [army("j1", 30)], j2: [army("j2", 0)] });
    expect(e).toContainEqual(expect.objectContaining({ type: "pillaged", ownerId: "j2" }));
    expect(e).toContainEqual(expect.objectContaining({ type: "paymentReceived", ownerId: "j1" }));
  });
});
