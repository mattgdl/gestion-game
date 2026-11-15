import { describe, expect, it } from "vitest";
import { Terrain } from "@jeu/shared";
import { legTicks } from "../src";
import { build, everywhere, labGame, manorOf, road, runUntil } from "./helpers";

const SPRING = 0;
const SUMMER = 450;
const WINTER = 1350;
const YEAR = 1800;

/** Bûcheron proche du manoir : forêt (80..85, 26..31), bûcheron en (78, 28), route le long de y = 27. */
function nearWoodcutter() {
  const game = labGame([{ terrain: Terrain.Foret, x: 80, y: 26, w: 6, h: 6 }]);
  road(game.sim, 73, 27, 78, 27);
  const mill = build(game.sim, "bucheron", 78, 28);
  return { ...game, mill };
}

/** Bûcheron éloigné : forêt (50..55, 40..45), bûcheron en (56, 41), 34 cases de route jusqu'au manoir. */
function farWoodcutter() {
  const game = labGame([{ terrain: Terrain.Foret, x: 50, y: 40, w: 6, h: 6 }]);
  road(game.sim, 72, 31, 72, 43);
  road(game.sim, 71, 43, 56, 43);
  const mill = build(game.sim, "bucheron", 56, 41);
  return { ...game, mill };
}

describe("ateliers et porteurs", () => {
  it("produit 40 bois par an à plein rendement et les livre au manoir", () => {
    const { sim, world, mill } = nearWoodcutter();
    expect(sim.economy.efficiency(mill.id)).toBe(1000);
    const start = sim.totals().bois;
    runUntil(sim, world, YEAR - 1);
    expect(sim.totals().bois).toBeGreaterThanOrEqual(start + 30);
    // Rien ne se perd : réserves + atelier + porteurs = départ + production.
    expect(everywhere(sim, "bois")).toBe(start + 39);
  });

  it("compte dans le bilan d'une année les quatre saisons, hiver précédent compris", () => {
    const { sim, world } = nearWoodcutter();
    runUntil(sim, world, WINTER + 1);
    expect(sim.state.yearStats).toMatchObject({ year: 2, produced: {} });
    runUntil(sim, world, YEAR + WINTER - 2);
    expect(sim.state.yearStats.year).toBe(2);
    expect(sim.state.yearStats.produced.bois).toBeGreaterThanOrEqual(39);
    expect(sim.state.yearStats.produced.bois).toBeLessThanOrEqual(40);
  });

  it("sait si un nouveau champ serait travaillé", () => {
    const { sim } = labGame();
    build(sim, "ferme", 73, 28);
    expect(sim.economy.fieldWouldBeWorked(76, 28)).toBe(true);
    for (let y = 30; y <= 32; y++) for (let x = 75; x <= 78; x++) sim.apply({ type: "field", x, y });
    expect(sim.economy.fieldWouldBeWorked(76, 28)).toBe(false);
    expect(sim.economy.fieldWouldBeWorked(90, 28)).toBe(false);
  });

  it("suit le plus court chemin par la route et met le temps prévu", () => {
    const { sim, world, mill } = nearWoodcutter();
    const route = sim.economy.routesFrom(mill.id)[0];
    expect(route?.storageId).toBe(manorOf(sim).id);
    expect(route?.distance).toBe(8);
    runUntil(sim, world, 300);
    const trip = sim.state.deliveries.find((d) => d.fromId === mill.id) ?? null;
    const first = trip ?? { arriveTick: 0, departTick: 0, returnTick: 0 };
    expect(first.arriveTick - first.departTick).toBe(legTicks(8));
    expect(first.returnTick - first.arriveTick).toBe(legTicks(8));
  });

  it("livre moins quand la réserve est loin, et un entrepôt proche y remédie", () => {
    const far = farWoodcutter();
    const farStart = far.sim.totals().bois;
    runUntil(far.sim, far.world, YEAR - 10);
    const deliveredFar = far.sim.totals().bois - farStart;

    const near = farWoodcutter();
    build(near.sim, "entrepot", 58, 44);
    expect(near.sim.economy.routesFrom(near.mill.id)[0]?.distance).toBe(2);
    const nearStart = near.sim.totals().bois;
    runUntil(near.sim, near.world, YEAR - 10);
    const deliveredNear = near.sim.totals().bois - nearStart;

    expect(deliveredNear).toBeGreaterThanOrEqual(deliveredFar + 10);
  });

  it("s'arrête quand toutes les réserves sont pleines", () => {
    const { sim, world, mill } = nearWoodcutter();
    manorOf(sim).stock = { nourriture: 100, bois: 150, pierre: 148 };
    runUntil(sim, world, YEAR - 1);
    expect(sim.economy.storageUsage()).toMatchObject({ used: 400, capacity: 400 });
    expect(mill.stock.bois).toBe(20);
    expect(sim.economy.status(mill.id)).toMatchObject({ blocked: true, tone: "bad" });
  });

  it("ne travaille pas sans route jusqu'au manoir", () => {
    const { sim, world } = labGame([{ terrain: Terrain.Foret, x: 80, y: 26, w: 6, h: 6 }]);
    const mill = build(sim, "bucheron", 78, 28);
    runUntil(sim, world, 900);
    expect(mill.stock.bois ?? 0).toBe(0);
    expect(sim.economy.status(mill.id).text).toContain("Non relié");
  });

  it("rapporte la marchandise si la réserve disparaît pendant le trajet, sans rien perdre", () => {
    const { sim, world, mill } = farWoodcutter();
    const depot = build(sim, "entrepot", 58, 44);
    runUntil(sim, world, 600);
    const before = everywhere(sim, "bois");
    const producedBefore = sim.state.yearStats.produced.bois ?? 0;
    // On démolit l'entrepôt alors qu'un porteur s'y rend.
    runUntil(sim, world, sim.state.tick + 1);
    while (!sim.state.deliveries.some((d) => d.toId === depot.id && d.status === "aller")) runUntil(sim, world, sim.state.tick + 1);
    const result = sim.apply({ type: "demolish", x: 58, y: 44 });
    expect(result.ok).toBe(true);
    runUntil(sim, world, sim.state.tick + 400);
    const produced = (sim.state.yearStats.produced.bois ?? 0) - producedBefore;
    // Démolir rend 15 bois (moitié du coût) ; le contenu de l'entrepôt est déménagé au manoir.
    expect(everywhere(sim, "bois")).toBe(before + produced + 15);
    expect(sim.state.deliveries.every((d) => d.toId !== depot.id)).toBe(true);
    expect(mill.stock.bois ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("agriculture", () => {
  /** Ferme en (73, 28), reliée par les routes de départ ; champs à fertilité 100 (8 nourriture chacun). */
  function farm(fieldsAt: [number, number][], paintAtTick = SPRING) {
    const game = labGame();
    const f = build(game.sim, "ferme", 73, 28);
    if (paintAtTick > 0) runUntil(game.sim, game.world, paintAtTick);
    for (const [x, y] of fieldsAt) {
      const r = game.sim.apply({ type: "field", x, y });
      if (!r.ok) throw new Error(r.reason);
    }
    return { ...game, farm: f };
  }

  const FIVE: [number, number][] = [
    [76, 28],
    [76, 29],
    [77, 28],
    [77, 29],
    [76, 30],
  ];

  it("sème au début de l'été, moissonne à l'automne et livre la récolte", () => {
    const { sim, world, farm: f } = farm(FIVE);
    expect(sim.economy.farmInfo(f.id)?.expected).toBe(40);
    runUntil(sim, world, SUMMER + 1);
    expect(Object.values(sim.state.crops).filter((c) => c === "seme")).toHaveLength(5);
    runUntil(sim, world, WINTER - 2);
    expect(sim.state.yearStats).toMatchObject({ year: 1, harvested: 40, fieldsHarvested: 5 });
    runUntil(sim, world, WINTER + 100);
    expect(sim.state.yearStats).toMatchObject({ year: 2, harvested: 0 });
    expect(sim.totals().nourriture).toBe(140);
    const texts = sim.state.log.map((l) => l.text);
    expect(texts).toContain("Semailles terminées : 5 champs ensemencés.");
    expect(texts).toContain("Moisson de l'an 1 : 40 nourriture sur 5 champs.");
  });

  it("ne récolte rien d'un champ créé après le printemps, mais le sème l'année suivante", () => {
    const { sim, world, farm: f } = farm(FIVE, SUMMER + 50);
    runUntil(sim, world, 1000);
    expect(sim.economy.status(f.id).text).toContain("Rien de semé");
    runUntil(sim, world, WINTER - 2);
    expect(sim.state.yearStats.harvested).toBe(0);
    runUntil(sim, world, YEAR + WINTER + 100);
    expect(sim.state.log.map((l) => l.text)).toContain("Moisson de l'an 2 : 40 nourriture sur 5 champs.");
  });

  it("ne travaille que 12 champs par ferme", () => {
    const fields: [number, number][] = [];
    for (let y = 30; y <= 33; y++) for (let x = 75; x <= 78; x++) fields.push([x, y]);
    const { sim, farm: f } = farm(fields);
    const info = sim.economy.farmInfo(f.id);
    expect(info).toMatchObject({ max: 12, idleNearby: 4, expected: 96 });
    expect(info?.fields).toHaveLength(12);
  });

  it("ne sème rien si la ferme n'est pas reliée", () => {
    const { sim, world } = labGame();
    build(sim, "ferme", 80, 10);
    sim.apply({ type: "field", x: 83, y: 10 });
    runUntil(sim, world, SUMMER + 5);
    expect(sim.state.crops).toEqual({});
  });

  it("perd à l'hiver les champs qu'il n'a pas eu le temps de moissonner", () => {
    const { sim, world, farm: f } = farm(FIVE);
    runUntil(sim, world, SUMMER + 1);
    // On bloque la ferme pendant tout l'automne : son stock est plein et les réserves aussi.
    manorOf(sim).stock = { nourriture: 200, bois: 100, pierre: 100 };
    f.stock.nourriture = 150;
    runUntil(sim, world, WINTER + 1);
    expect(sim.state.log.map((l) => l.text).some((t) => t.includes("5 champs non moissonnés"))).toBe(true);
    expect(sim.state.crops).toEqual({});
  });
});

describe("réserves", () => {
  it("prélève les coûts dans les réserves et y range les remboursements", () => {
    const { sim } = labGame();
    const depot = build(sim, "entrepot", 75, 27);
    expect(sim.totals()).toMatchObject({ bois: 120, pierre: 50, or: 200 });
    depot.stock = { bois: 100 };
    manorOf(sim).stock.bois = 0;
    build(sim, "maison", 73, 30);
    expect(depot.stock.bois).toBe(92);
    expect(sim.economy.storageUsage().capacity).toBe(700);
  });

  it("déménage le contenu d'un entrepôt démoli et signale ce qui ne tient pas", () => {
    const { sim } = labGame();
    const depot = build(sim, "entrepot", 75, 27);
    depot.stock = { pierre: 200 };
    manorOf(sim).stock = { nourriture: 100, bois: 120, pierre: 50 };
    sim.apply({ type: "demolish", x: 75, y: 27 });
    // Le manoir (400) contient 270 : il reste 130 places pour 200 pierres + le remboursement.
    expect(sim.economy.storageUsage().used).toBe(400);
    expect(sim.state.log.at(-1)?.text).toContain("perdu");
  });
});
