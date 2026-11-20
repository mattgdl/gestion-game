import { describe, expect, it } from "vitest";
import type { BarrierInput } from "@jeu/shared";
import { PLAYER_ID, createWorld, resolveBarrier } from "../src";

const summary = (traits: string[] = []) => ({ ownerId: PLAYER_ID, fiefIds: ["f-2-2"], population: 30, gold: 0, prestige: 0, lineageAlive: true, traits });
const input = (traits: string[] = []): BarrierInput[] => [{ ownerId: PLAYER_ID, summary: summary(traits), ready: true, actions: [] }];

describe("événements régionaux et traits, côté Monde (J8)", () => {
  it("de temps en temps, un événement régional touche une zone de fiefs", () => {
    const world = createWorld("region");
    const seen: { eventId: string; fiefIds: string[] }[] = [];
    for (let i = 0; i < 30; i++) {
      for (const e of resolveBarrier(world, input()).events) if (e.type === "regionalEvent") seen.push(e);
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBeLessThanOrEqual(15);
    for (const e of seen) {
      expect(["hiver-rigoureux", "peste", "disette"]).toContain(e.eventId);
      expect(e.fiefIds.length).toBeGreaterThanOrEqual(4);
      expect(e.fiefIds.length).toBeLessThanOrEqual(9);
    }
  });

  it("les seigneurs IA apprécient un seigneur diplomate, se méfient d'un cruel", () => {
    const good = createWorld("reputation");
    const bad = createWorld("reputation");
    for (let i = 0; i < 5; i++) {
      resolveBarrier(good, input(["diplomate"]));
      resolveBarrier(bad, input(["cruel"]));
    }
    const rel = (w: typeof good) => w.lords.filter((l) => l.ai).reduce((n, l) => n + (l.ai!.relations[PLAYER_ID] ?? 0), 0);
    expect(rel(good)).toBeGreaterThan(rel(bad));
  });
});
