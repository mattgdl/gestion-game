import { describe, expect, it } from "vitest";
import { PLAYER_ID, adjacent, createWorld, fiefById, fiefValue, fiefsOwnedBy, floorPrice, priceRange, resolveBarrier } from "../src";

describe("création du monde", () => {
  it("est déterministe", () => {
    expect(createWorld("graine")).toEqual(createWorld("graine"));
  });

  it("donne au joueur le fief central d'une carte 5 × 5, en plaines", () => {
    const world = createWorld("graine");
    const mine = fiefsOwnedBy(world, PLAYER_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ col: 2, row: 2, dominant: "plaines", households: 0 });
    expect(world.fiefs).toHaveLength(25);
  });

  it("crée 24 voisins IA aux noms distincts, avec un village et des terrains variés", () => {
    const world = createWorld("graine");
    const others = world.fiefs.filter((f) => f.ownerId !== PLAYER_ID);
    expect(others).toHaveLength(24);
    expect(new Set(others.map((f) => f.dominant)).size).toBe(4);
    expect(new Set(world.fiefs.map((f) => f.name)).size).toBe(25);
    expect(world.lords).toHaveLength(25);
    for (const f of others) {
      expect(f.households).toBeGreaterThanOrEqual(3);
      expect(f.households).toBeLessThanOrEqual(7);
      expect(f.land.herbe + f.land.foret + f.land.roche + f.land.eau).toBe(48 * 48);
    }
  });

  it("estime la valeur d'un fief : une fourchette autour d'une valeur de quelques centaines d'or", () => {
    const world = createWorld("graine");
    const f = fiefById(world, "f-2-1")!;
    const v = fiefValue(f);
    expect(v).toBeGreaterThan(300);
    expect(v).toBeLessThan(1500);
    const [lo, hi] = priceRange(world, f, PLAYER_ID);
    const floor = floorPrice(world, f, PLAYER_ID);
    expect(floor).toBeGreaterThanOrEqual(lo - 10);
    expect(floor).toBeLessThanOrEqual(hi + 10);
  });
});

describe("achat de fiefs", () => {
  const summary = { ownerId: PLAYER_ID, fiefIds: ["f-2-2"], population: 30, gold: 5000, prestige: 0, lineageAlive: true };
  const offer = (fiefId: string, price: number) => ({ type: "buyFief" as const, actionId: `a-${fiefId}`, ownerId: PLAYER_ID, fiefId, price });

  it("vend un fief voisin quand l'offre atteint le prix plancher, avec son village", () => {
    const world = createWorld("achat");
    const f = fiefById(world, "f-2-1")!;
    const households = f.households;
    const price = floorPrice(world, f, PLAYER_ID);
    const result = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [offer("f-2-1", price)] }]);
    expect(result.events).toContainEqual(expect.objectContaining({ type: "fiefTransferred", fiefId: "f-2-1", toOwnerId: PLAYER_ID, price, households }));
    expect(f.ownerId).toBe(PLAYER_ID);
    expect(f.households).toBe(0);
  });

  it("refuse une offre trop basse, dit si elle était proche, et rend l'or", () => {
    const world = createWorld("refus");
    const f = fiefById(world, "f-1-2")!;
    const floor = floorPrice(world, f, PLAYER_ID);
    const low = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [offer("f-1-2", Math.floor(floor * 0.5))] }]);
    const e = low.events.find((x) => x.type === "escrowReleased");
    expect(e).toMatchObject({ fiefId: "f-1-2", gold: Math.floor(floor * 0.5) });
    expect(e && "reason" in e ? e.reason : "").toContain("bien trop basse");
    const floor2 = floorPrice(world, f, PLAYER_ID);
    const close = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [offer("f-1-2", floor2 - 1)] }]);
    const e2 = close.events.find((x) => x.type === "escrowReleased");
    expect(e2 && "reason" in e2 ? e2.reason : "").toContain("hésite");
    expect(f.ownerId).not.toBe(PLAYER_ID);
  });

  it("refuse un fief qui ne touche aucun des vôtres", () => {
    const world = createWorld("loin");
    expect(adjacent({ col: 2, row: 2 }, { col: 0, row: 0 })).toBe(false);
    const result = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [offer("f-0-0", 99999)] }]);
    expect(result.events).toContainEqual(expect.objectContaining({ type: "escrowReleased", fiefId: "f-0-0", gold: 99999 }));
    expect(fiefById(world, "f-0-0")!.ownerId).not.toBe(PLAYER_ID);
  });

  it("fait grandir les villages des voisins au fil des ans", () => {
    const world = createWorld("croissance");
    const before = world.fiefs.reduce((n, f) => n + f.households, 0);
    for (let i = 0; i < 10; i++) resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [] }]);
    expect(world.fiefs.reduce((n, f) => n + f.households, 0)).toBeGreaterThan(before);
  });
});

describe("barrière annuelle", () => {
  it("enregistre le résumé, boucle l'année et renvoie un bilan", () => {
    const world = createWorld("graine");
    const summary = { ownerId: PLAYER_ID, fiefIds: ["f-2-2"], population: 0, gold: 200, prestige: 0, lineageAlive: true };
    const result = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [] }]);
    expect(result.resolved).toEqual({ type: "yearResolved", year: 1 });
    expect(world.year).toBe(2);
    expect(world.lastSummaries[PLAYER_ID]).toEqual(summary);
    expect(result.events.length).toBeGreaterThan(0);
  });
});
