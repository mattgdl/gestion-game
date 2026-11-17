import { describe, expect, it } from "vitest";
import { GUERRE_FIEF, type DomainSim } from "../src";
import { build, labGame, manorOf, newGame, road, runUntil } from "./helpers";
import { PLAYER_ID, fiefById, floorPrice, resolveBarrier } from "@jeu/sim-monde";

function village() {
  const { sim, world } = labGame();
  road(sim, 73, 27, 92, 27);
  for (let i = 0; i < 10; i++) build(sim, "maison", 73 + i, 28);
  return { sim, world };
}

const result = (sim: DomainSim, events: Parameters<DomainSim["applyBarrierResult"]>[0]["events"]) => {
  sim.state.awaitingBarrier = true;
  sim.applyBarrierResult({ events, resolved: { type: "yearResolved", year: sim.date.year } });
};

describe("armée", () => {
  it("la caserne prend les bras inoccupés, l'armurerie forge des armes, la caserne s'en équipe", () => {
    const { sim, world } = village();
    manorOf(sim).stock = { nourriture: 100, bois: 150, pierre: 100 };
    const barracks = build(sim, "caserne", 84, 25);
    build(sim, "armurerie", 80, 25);
    manorOf(sim).stock = { nourriture: 100, bois: 100, outils: 40 };
    runUntil(sim, world, 300);
    const soldiers = sim.army.soldiers().length;
    expect(soldiers).toBeGreaterThan(0);
    expect(sim.state.yearStats.produced.armes ?? 0).toBeGreaterThan(0);
    runUntil(sim, world, 900);
    expect(barracks.stock.armes ?? 0).toBeGreaterThan(0);
    expect(sim.army.armed()).toBeGreaterThan(0);
    expect(sim.army.strength()).toBeGreaterThan(soldiers * GUERRE_FIEF.forceSoldat);
  });

  it("au bilan : solde payée, armes usées ; les mercenaires coûtent de l'or et partent après le bilan", () => {
    const { sim, world } = village();
    manorOf(sim).stock = { nourriture: 100, bois: 150, pierre: 100 };
    sim.state.treasury = 1030;
    const barracks = build(sim, "caserne", 84, 25);
    runUntil(sim, world, 300);
    const soldiers = sim.army.soldiers().length;
    barracks.stock.armes = 8;
    expect(sim.apply({ type: "hireMercenaries", count: 5 }).ok).toBe(true);
    expect(sim.state.treasury).toBe(1000 - 5 * GUERRE_FIEF.prixMercenaire);
    const before = sim.state.treasury;
    const report = () => sim.barrierActions().find((a) => a.type === "armyReport");
    expect(report()).toMatchObject({ soldiers, mercenaries: 5 });
    runUntil(sim, world, 1360);
    expect(sim.state.treasury).toBeLessThanOrEqual(before - soldiers * GUERRE_FIEF.soldeParAn + 200);
    expect(barracks.stock.armes).toBeLessThan(8);
    expect(sim.state.army.mercenaries).toBe(0);
  });

  it("un assaut perdu tue des soldats ; un pillage coûte or, réserves et villageois ; « En guerre » pèse sur le moral", () => {
    const { sim, world } = village();
    manorOf(sim).stock = { nourriture: 100, bois: 150, pierre: 100 };
    build(sim, "caserne", 84, 25);
    runUntil(sim, world, 300);
    const people0 = sim.state.villagers.length;
    const war = { id: "g1", attackerId: "ia-1", defenderId: PLAYER_ID, fiefId: "f-1-0", goal: "pillage" as const, firstYear: 1, won: 0, lost: 0 };
    result(sim, [{ type: "warDeclared", war, text: "La Maison X vous déclare la guerre." }]);
    const fam = sim.state.families.find((f) => !f.noble)!;
    expect(sim.population.moraleOf(fam, 0).parts).toContainEqual({ label: "En guerre", value: GUERRE_FIEF.moralGuerre });
    result(sim, [{ type: "warRound", warId: "g1", attackerId: "ia-1", defenderId: PLAYER_ID, fiefId: "f-1-0", attack: 50, defense: 10, attackerWon: true, attackerLosses: 0, defenderLosses: 2, text: "Assaut." }]);
    // Deux soldats tombent (la caserne reprendra des bras inoccupés).
    expect(sim.state.villagers.length).toBe(people0 - 2);
    expect(sim.state.log.some((l) => l.text.startsWith("Tombés au combat"))).toBe(true);
    sim.state.treasury = 1000;
    manorOf(sim).stock = { nourriture: 100, bois: 100 };
    const people = sim.state.villagers.length;
    result(sim, [
      { type: "pillaged", ownerId: PLAYER_ID, goldPermille: 300, reservesPermille: 250, deaths: 3, text: "Pillage." },
      { type: "warEnded", warId: "g1", attackerId: "ia-1", defenderId: PLAYER_ID, fiefId: "f-1-0", outcome: "pille", text: "Fin." },
    ]);
    expect(sim.state.treasury).toBe(700);
    expect(manorOf(sim).stock.bois).toBe(75);
    expect(sim.state.villagers.length).toBe(people - 3);
    expect(sim.army.atWar()).toBe(false);
  });

  it("un fief perdu emporte ses bâtiments et ses habitants ; le fief de départ reste", () => {
    const { sim, world } = newGame("perte");
    const meta = fiefById(world, "f-0-0")!;
    sim.state.treasury = 99999;
    sim.apply({ type: "makeOffer", fiefId: "f-0-0", price: Math.max(floorPrice(world, meta, PLAYER_ID), 5000) });
    runUntil(sim, world, 1360);
    expect(sim.state.fiefs["f-0-0"]).toBeDefined();
    const families = sim.state.families.length;
    const inFief = sim.state.buildings.filter((b) => b.fiefId === "f-0-0").length;
    expect(inFief).toBeGreaterThan(0);
    result(sim, [{ type: "fiefTransferred", fiefId: "f-0-0", col: 0, row: 0, name: meta.name, fromOwnerId: PLAYER_ID, toOwnerId: "ia-1", price: 0, households: 5, conquest: true }]);
    expect(sim.state.fiefs["f-0-0"]).toBeUndefined();
    expect(sim.state.buildings.some((b) => b.fiefId === "f-0-0")).toBe(false);
    expect(sim.state.families.length).toBeLessThan(families);
    expect(sim.state.buildings.some((b) => b.type === "manoir")).toBe(true);
    runUntil(sim, world, 1360 + 200);
    void resolveBarrier;
  });
});
