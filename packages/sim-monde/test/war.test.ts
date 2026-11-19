import { describe, expect, it } from "vitest";
import type { BarrierInput, ProposeAction } from "@jeu/shared";
import { GUERRE, PLAYER_ID, checkWar, createWorld, fiefById, resolveBarrier, type WorldState } from "../src";

const summary = { ownerId: PLAYER_ID, fiefIds: ["f-2-2"], population: 60, gold: 1000, prestige: 0, lineageAlive: true };
const army = (soldiers: number, armed = soldiers, mercenaries = 0): ProposeAction => ({
  type: "armyReport",
  actionId: `armee-${soldiers}-${Math.random()}`,
  ownerId: PLAYER_ID,
  soldiers,
  armed,
  mercenaries,
  morale: 1000,
  households: 15,
});
const input = (actions: ProposeAction[]): BarrierInput[] => [{ ownerId: PLAYER_ID, summary, ready: true, actions }];
const declare = (fiefId: string, goal: "conquete" | "pillage"): ProposeAction => ({ type: "declareWar", actionId: `d-${fiefId}`, ownerId: PLAYER_ID, fiefId, goal });
const lordOf = (world: WorldState, fiefId: string) => world.lords.find((l) => l.id === fiefById(world, fiefId)!.ownerId)!;

describe("guerre déclarée par le joueur", () => {
  it("la déclaration coûte de la réputation, rompt les accords avec l'ennemi, et le premier assaut attend l'an suivant", () => {
    const world = createWorld("guerre");
    const target = lordOf(world, "f-2-1");
    const other = lordOf(world, "f-1-2");
    target.ai!.relations[PLAYER_ID] = 0;
    other.ai!.relations[PLAYER_ID] = 0;
    world.agreements.push({ id: "x", ownerId: PLAYER_ID, partnerId: target.id, partnerFiefId: "f-2-1", good: "bois", side: "achat", perYear: 10, price: 2, firstYear: 3, lastYear: 5 });
    const r = resolveBarrier(world, input([army(0), declare("f-2-1", "pillage")]));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "warDeclared" }));
    expect(r.events.some((e) => e.type === "warRound")).toBe(false);
    expect(world.wars[0]).toMatchObject({ attackerId: PLAYER_ID, fiefId: "f-2-1", firstYear: world.year });
    expect(target.ai!.relations[PLAYER_ID]).toBe(GUERRE.relationCible);
    expect(other.ai!.relations[PLAYER_ID]).toBe(GUERRE.relationAutres);
    expect(world.agreements).toEqual([]);
  });

  it("pillage : un assaut gagné rapporte une part de l'or du seigneur, et la guerre s'arrête", () => {
    const world = createWorld("pillage");
    const target = lordOf(world, "f-2-1");
    target.ai!.gold = 1000;
    resolveBarrier(world, input([army(0), declare("f-2-1", "pillage")]));
    const r = resolveBarrier(world, input([army(40)]));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "warRound", attackerWon: true }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "paymentReceived", ownerId: PLAYER_ID }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "warEnded", outcome: "pille" }));
    expect(world.wars).toEqual([]);
  });

  it("conquête : le fief tombe après 3 assauts gagnés, avec son village", () => {
    const world = createWorld("conquete-joueur");
    const f = fiefById(world, "f-2-1")!;
    resolveBarrier(world, input([army(0), declare("f-2-1", "conquete")]));
    let transferred = false;
    for (let i = 0; i < 3; i++) {
      const r = resolveBarrier(world, input([army(60)]));
      transferred ||= r.events.some((e) => e.type === "fiefTransferred" && e.conquest === true && e.toOwnerId === PLAYER_ID);
    }
    expect(transferred).toBe(true);
    expect(f.ownerId).toBe(PLAYER_ID);
  });

  it("un attaquant trop faible voit le siège levé après 2 assauts perdus", () => {
    const world = createWorld("siege-leve");
    resolveBarrier(world, input([army(0), declare("f-2-1", "conquete")]));
    resolveBarrier(world, input([army(0)]));
    const r = resolveBarrier(world, input([army(0)]));
    expect(r.events).toContainEqual(expect.objectContaining({ type: "warEnded", outcome: "leve" }));
    expect(fiefById(world, "f-2-1")!.ownerId).not.toBe(PLAYER_ID);
  });

  it("refuse une guerre loin de ses terres, ou une seconde guerre ; le fief de départ ne se conquiert pas", () => {
    const world = createWorld("refus-guerre");
    expect(checkWar(world, PLAYER_ID, "f-0-0", "pillage").ok).toBe(false);
    const ia = lordOf(world, "f-2-1");
    expect(checkWar(world, ia.id, "f-2-2", "conquete").reason).toContain("ne peut être que pillé");
    expect(checkWar(world, ia.id, "f-2-2", "pillage").ok).toBe(true);
  });
});

describe("guerres des seigneurs IA", () => {
  it("un seigneur IA belliqueux et fort finit par attaquer un voisin faible (le joueur sans armée : pillage)", () => {
    const world = createWorld("ia-attaque");
    for (const l of world.lords) if (l.ai) l.ai.archetype = "conquerant";
    for (const f of world.fiefs) if (f.ownerId !== PLAYER_ID) f.households = 14;
    let declared = false;
    let pillaged = false;
    for (let i = 0; i < 20 && !pillaged; i++) {
      const r = resolveBarrier(world, input([army(0)]));
      declared ||= r.events.some((e) => e.type === "warDeclared" && e.war.defenderId === PLAYER_ID);
      pillaged ||= r.events.some((e) => e.type === "pillaged" && e.ownerId === PLAYER_ID);
    }
    expect(declared).toBe(true);
    expect(pillaged).toBe(true);
    expect(fiefById(world, "f-2-2")!.ownerId).toBe(PLAYER_ID);
  });
});

describe("textes de guerre", () => {
  it("« vous déclare la guerre », pas « déclare la guerre à vous »", () => {
    const world = createWorld("texte-guerre");
    for (const l of world.lords) if (l.ai) l.ai.archetype = "conquerant";
    for (const f of world.fiefs) if (f.ownerId !== PLAYER_ID) f.households = 14;
    const texts: string[] = [];
    for (let i = 0; i < 15; i++) {
      const r = resolveBarrier(world, input([army(0)]));
      for (const e of r.events) if (e.type === "warDeclared" && e.war.defenderId === PLAYER_ID) texts.push(e.text);
    }
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t).toContain("vous déclare la guerre");
      expect(t).not.toContain("à vous");
    }
  });
});
