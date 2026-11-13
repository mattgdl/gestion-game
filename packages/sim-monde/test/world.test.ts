import { describe, expect, it } from "vitest";
import { PLAYER_ID, createWorld, fiefsOwnedBy, resolveBarrier } from "../src";

describe("création du monde", () => {
  it("est déterministe", () => {
    expect(createWorld("graine")).toEqual(createWorld("graine"));
  });

  it("donne au joueur le fief central, en plaines", () => {
    const world = createWorld("graine");
    const mine = fiefsOwnedBy(world, PLAYER_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ col: 1, row: 0, dominant: "plaines" });
  });

  it("crée deux voisins IA avec des terrains dominants différents et des noms distincts", () => {
    const world = createWorld("graine");
    const others = world.fiefs.filter((f) => f.ownerId !== PLAYER_ID);
    expect(others).toHaveLength(2);
    expect(new Set(others.map((f) => f.dominant)).size).toBe(2);
    expect(new Set(world.fiefs.map((f) => f.name)).size).toBe(3);
    expect(world.lords).toHaveLength(3);
  });
});

describe("barrière annuelle", () => {
  it("enregistre le résumé, boucle l'année et renvoie un bilan", () => {
    const world = createWorld("graine");
    const summary = { ownerId: PLAYER_ID, fiefIds: ["f-1-0"], population: 0, gold: 200, prestige: 0, lineageAlive: true };
    const result = resolveBarrier(world, [{ ownerId: PLAYER_ID, summary, ready: true, actions: [] }]);
    expect(result.resolved).toEqual({ type: "yearResolved", year: 1 });
    expect(world.year).toBe(2);
    expect(world.lastSummaries[PLAYER_ID]).toEqual(summary);
    expect(result.events[0]?.type).toBe("info");
  });
});
