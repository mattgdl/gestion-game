import { describe, expect, it } from "vitest";
import { BARRIER_OFFSET, TICKS_PER_SEASON, TICKS_PER_YEAR, dateOf } from "../src";
import { newGame, runUntil } from "./helpers";

describe("calendrier", () => {
  it("compte 3 minutes par an à 10 ticks par seconde", () => {
    expect(TICKS_PER_YEAR).toBe(1800);
    expect(TICKS_PER_SEASON).toBe(450);
  });

  it("déduit année, saison et jour du tick", () => {
    expect(dateOf(0)).toMatchObject({ year: 1, seasonId: "printemps", day: 1 });
    expect(dateOf(450)).toMatchObject({ year: 1, seasonId: "ete", day: 1 });
    expect(dateOf(1350)).toMatchObject({ year: 1, seasonId: "hiver" });
    expect(dateOf(1800)).toMatchObject({ year: 2, seasonId: "printemps", day: 1 });
    expect(dateOf(449).day).toBe(30);
  });
});

describe("barrière annuelle", () => {
  it("arrête le temps à la fin de l'automne jusqu'à la réponse du Monde", () => {
    const { sim } = newGame();
    let barrierAt = -1;
    for (let i = 0; i < 2000 && barrierAt < 0; i++) {
      if (sim.step().some((e) => e.type === "barrier")) barrierAt = sim.state.tick;
    }
    expect(barrierAt).toBe(BARRIER_OFFSET - 1);
    expect(dateOf(barrierAt).seasonId).toBe("automne");
    expect(sim.state.awaitingBarrier).toBe(true);
    for (let i = 0; i < 10; i++) expect(sim.step()).toEqual([]);
    expect(sim.state.tick).toBe(barrierAt);
  });

  it("reprend après la résolution, entre en hiver puis dans l'an 2", () => {
    const { sim, world } = newGame();
    const barriers = runUntil(sim, world, TICKS_PER_YEAR + 10);
    expect(barriers).toBe(1);
    expect(world.year).toBe(2);
    expect(sim.date.year).toBe(2);
    const texts = sim.state.log.map((l) => l.text);
    const bilan = texts.findIndex((t) => t.startsWith("Bilan de l'an 1"));
    const hiver = texts.indexOf("Hiver de l'an 1.");
    expect(bilan).toBeGreaterThan(-1);
    expect(hiver).toBeGreaterThan(bilan);
    expect(texts).toContain("L'an 2 commence.");
  });

  it("déclenche une barrière par an", () => {
    const { sim, world } = newGame();
    // Assez de vivres pour que le village survive cinq ans sans ferme.
    for (const f of sim.state.families) f.food = 1e9;
    expect(runUntil(sim, world, TICKS_PER_YEAR * 5)).toBe(5);
  });
});
