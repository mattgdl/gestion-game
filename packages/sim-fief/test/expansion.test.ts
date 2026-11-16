import { describe, expect, it } from "vitest";
import { fiefById, floorPrice } from "@jeu/sim-monde";
import type { DomainSim, SimEvent } from "../src";
import { newGame, runUntil } from "./helpers";

const WINTER = 1350;

/** Avance jusqu'à l'hiver en gardant les événements de la simulation. */
function untilWinter(sim: DomainSim, world: Parameters<typeof runUntil>[1]): SimEvent[] {
  const events: SimEvent[] = [];
  const step = sim.step.bind(sim);
  sim.step = () => {
    const e = step();
    events.push(...e);
    return e;
  };
  runUntil(sim, world, WINTER + 20);
  sim.step = step;
  return events;
}

describe("offres d'achat", () => {
  it("met l'or sous séquestre, et le rend si l'on retire l'offre", () => {
    const { sim } = newGame("offre");
    sim.state.treasury = 1000;
    expect(sim.apply({ type: "makeOffer", fiefId: "f-0-0", price: 600 }).ok).toBe(true);
    expect(sim.state.treasury).toBe(400);
    expect(sim.apply({ type: "makeOffer", fiefId: "f-0-0", price: 100 }).reason).toContain("déjà en cours");
    expect(sim.apply({ type: "makeOffer", fiefId: "f-2-0", price: 500 }).reason).toContain("Pas assez d'or");
    expect(sim.apply({ type: "makeOffer", fiefId: "f-1-0", price: 10 }).reason).toContain("déjà à vous");
    expect(sim.apply({ type: "cancelOffer", fiefId: "f-0-0" }).ok).toBe(true);
    expect(sim.state.treasury).toBe(1000);
    expect(sim.state.offers).toEqual([]);
  });

  it("rend l'or d'une offre refusée au bilan d'automne, avec la raison", () => {
    const { sim, world } = newGame("refus");
    sim.state.treasury = 1000;
    sim.apply({ type: "makeOffer", fiefId: "f-2-0", price: 10 });
    const events = untilWinter(sim, world);
    expect(sim.state.treasury).toBeGreaterThanOrEqual(1000);
    expect(sim.state.offers).toEqual([]);
    expect(events.find((e) => e.type === "offerRefused")).toMatchObject({ fiefId: "f-2-0" });
    expect(sim.state.log.some((l) => l.text.includes("bien trop basse"))).toBe(true);
  });
});

describe("annexion d'un fief acheté", () => {
  it("ajoute le fief et son village : maison forte, rue, maisons habitées, ferme et champs, vivres", () => {
    const { sim, world } = newGame("annexion");
    const meta = fiefById(world, "f-0-0")!;
    const households = meta.households;
    const price = floorPrice(world, meta);
    sim.state.treasury = price;
    const families = sim.state.families.length;
    expect(sim.apply({ type: "makeOffer", fiefId: "f-0-0", price }).ok).toBe(true);
    const events = untilWinter(sim, world);
    expect(events).toContainEqual({ type: "fiefAcquired", fiefId: "f-0-0", name: meta.name, price });
    expect(sim.state.fiefs["f-0-0"]).toBeDefined();
    expect(sim.state.treasury).toBe(0);
    const inFief = sim.state.buildings.filter((b) => b.fiefId === "f-0-0");
    const hub = inFief.find((b) => b.type === "maisonforte")!;
    expect(hub).toBeDefined();
    expect(hub.stock.nourriture).toBeGreaterThan(0);
    const houses = inFief.filter((b) => b.type === "maison");
    expect(houses.length).toBe(households);
    expect(inFief.some((b) => b.type === "ferme")).toBe(true);
    for (const b of inFief) expect(sim.isConnected(b.id)).toBe(true);
    expect(sim.state.families.length).toBe(families + households);
    for (const h of houses) expect(sim.population.familyInHouse(h.id)).toBeDefined();
    expect(sim.state.fields.length).toBeGreaterThanOrEqual(12);
    expect(sim.apply({ type: "demolish", x: hub.x, y: hub.y }).ok).toBe(false);
    // On peut construire dans le nouveau fief.
    expect(sim.state.dynasty.chronicle.some((c) => c.text.startsWith("Achat ") && c.text.includes(meta.name))).toBe(true);
  });

  it("donne le titre de baron à 2 fiefs et 100 habitants, définitivement, avec prestige et moral", () => {
    const { sim, world } = newGame("titre");
    const meta = fiefById(world, "f-0-0")!;
    sim.state.treasury = 99999;
    sim.apply({ type: "makeOffer", fiefId: "f-0-0", price: 99999 });
    untilWinter(sim, world);
    expect(sim.state.dynasty.title).toBe("seigneur");
    const extra = 100 - sim.state.villagers.length;
    for (let i = 0; i < extra; i++) sim.state.villagers.push({ id: sim.state.nextId++, name: "X", sex: "M", birthTick: sim.state.tick, familyId: sim.state.families[0]!.id });
    sim.population.version += 1;
    sim.checkTitle();
    expect(sim.state.dynasty.title).toBe("baron");
    expect(sim.titleName()).toBe("baron");
    expect(sim.dynasty.prestige().parts).toContainEqual({ label: "Titre", value: 100 });
    const village = sim.state.families.find((f) => !f.noble)!;
    expect(sim.population.moraleOf(village, 0).parts).toContainEqual({ label: "Titre : baron", value: 5 });
    sim.state.villagers.splice(-extra, extra);
    sim.checkTitle();
    expect(sim.state.dynasty.title).toBe("baron");
    expect(meta.ownerId).toBe("joueur");
  });
});
