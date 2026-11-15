import { describe, expect, it } from "vitest";
import { DAY_TICKS, ageOf, type DomainSim } from "../src";
import { build, labGame, manorOf, newGame, road, runUntil } from "./helpers";

const SUMMER = 450;
const WINTER = 1350;
const YEAR = 1800;

/** Maisons alignées le long d'une route horizontale en y = 27, au sud du manoir. */
function houses(sim: DomainSim, n: number, startX = 73): number[] {
  road(sim, 73, 27, startX + n, 27);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(build(sim, "maison", startX + i, 28).id);
  return ids;
}

describe("population de départ", () => {
  it("compte 10 couples de 20 à 25 ans et leurs jeunes enfants, sans maison", () => {
    const { sim } = newGame();
    const tick = sim.state.tick;
    const fams = sim.state.families;
    expect(fams).toHaveLength(10);
    for (const f of fams) {
      const h = sim.population.villager(f.husbandId);
      const w = sim.population.villager(f.wifeId);
      expect(h?.sex).toBe("M");
      expect(w?.sex).toBe("F");
      for (const p of [h!, w!]) {
        expect(ageOf(p, tick)).toBeGreaterThanOrEqual(20);
        expect(ageOf(p, tick)).toBeLessThanOrEqual(25);
      }
      expect(f.houseId).toBeNull();
    }
    const kids = sim.state.villagers.filter((v) => ageOf(v, tick) < 17);
    expect(sim.state.villagers.length).toBe(20 + kids.length);
    for (const k of kids) expect(ageOf(k, tick)).toBeLessThanOrEqual(5);
    expect(sim.population.counts()).toMatchObject({ adults: 20, homeless: 10, families: 10 });
  });

  it("est la même pour la même graine", () => {
    expect(newGame("graine-x").sim.state.villagers).toEqual(newGame("graine-x").sim.state.villagers);
  });
});

describe("logement et moral", () => {
  it("installe les familles dans les maisons dès le jour suivant, et le moral monte", () => {
    const { sim, world } = labGame();
    houses(sim, 4);
    runUntil(sim, world, DAY_TICKS + 1);
    expect(sim.population.counts().homeless).toBe(6);
    const housed = sim.state.families.find((f) => f.houseId !== null)!;
    const homeless = sim.state.families.find((f) => f.houseId === null)!;
    // Base 50 + nourri 15 ; logé +10, sans abri −20.
    expect(housed.morale).toBe(75);
    expect(homeless.morale).toBe(45);
    expect(sim.state.log.map((l) => l.text)).toContain("4 familles emménagent dans de nouvelles maisons.");
  });

  it("a froid l'hiver sans maison, et la nuit d'hiver coûte du moral", () => {
    const { sim, world } = labGame();
    runUntil(sim, world, WINTER + DAY_TICKS + 1);
    const f = sim.state.families[0]!;
    expect(f.coldDays).toBeGreaterThan(0);
    expect(sim.population.moraleOf(f, 3).parts.map((p) => p.label)).toContain("Froid");
  });
});

describe("emplois", () => {
  it("emploie automatiquement les plus proches, sans les enfants, dans la limite choisie", () => {
    const { sim } = labGame();
    const farm = build(sim, "ferme", 73, 28);
    expect(sim.population.workers(farm.id)).toHaveLength(3);
    for (const id of sim.population.workers(farm.id)) {
      expect(ageOf(sim.population.villager(id)!, sim.state.tick)).toBeGreaterThanOrEqual(14);
    }
    expect(sim.apply({ type: "setWorkers", buildingId: farm.id, count: 1 }).ok).toBe(true);
    expect(sim.population.workers(farm.id)).toHaveLength(1);
    expect(sim.economy.fieldCapacity(farm.id)).toBe(4);
    expect(sim.apply({ type: "setWorkers", buildingId: farm.id, count: 9 })).toMatchObject({ ok: false });
  });

  it("perd du temps de travail quand le domicile est loin", () => {
    const { sim } = labGame();
    expect(sim.population.workFactor(5)).toBe(1000);
    expect(sim.population.workFactor(30)).toBe(750);
    expect(sim.population.workFactor(200)).toBe(500);
  });
});

describe("provisions des foyers", () => {
  /** Partie avec vrais besoins : maisons reliées, foyers sans provisions. */
  function hungryVillage() {
    const { sim, world } = newGame("provisions");
    // Terrain dégagé autour du manoir pour la route de test.
    for (const f of Object.values(sim.state.fiefs)) f.terrain.fill(0);
    const ids = houses(sim, 10);
    return { sim, world, ids };
  }

  it("va chercher sa nourriture au manoir par la route", () => {
    const { sim, world } = hungryVillage();
    const start = manorOf(sim).stock.nourriture ?? 0;
    runUntil(sim, world, DAY_TICKS * 3);
    expect(sim.state.deliveries.some((d) => d.kind === "collecte" && d.familyId !== undefined)).toBe(true);
    runUntil(sim, world, DAY_TICKS * 10);
    expect(manorOf(sim).stock.nourriture ?? 0).toBeLessThan(start);
    expect(sim.state.families.every((f) => f.hungryDays === 0)).toBe(true);
  });

  it("fait ses provisions de bois à l'automne et se chauffe l'hiver", () => {
    const { sim, world } = hungryVillage();
    runUntil(sim, world, WINTER + DAY_TICKS * 5);
    expect(sim.state.families.filter((f) => f.houseId !== null).every((f) => f.coldDays === 0)).toBe(true);
    expect(sim.state.yearStats.burned ?? 0).toBeGreaterThan(0);
  });

  it("le marché va chercher la nourriture et les foyers voisins s'y servent", () => {
    const { sim, world } = hungryVillage();
    road(sim, 84, 27, 86, 27);
    const market = build(sim, "marche", 84, 28);
    runUntil(sim, world, DAY_TICKS * 20);
    expect(sim.population.workers(market.id)).toHaveLength(2);
    const fromMarket = sim.state.deliveries.filter((d) => d.toId === market.id && d.familyId !== undefined);
    const stocked = (market.stock.nourriture ?? 0) > 0 || sim.state.deliveries.some((d) => d.fromId === market.id);
    expect(stocked || fromMarket.length > 0).toBe(true);
  });
});

describe("naissances, décès, fin de partie", () => {
  it("fait naître environ deux enfants par foyer en trois ans quand tout va bien", () => {
    const { sim, world } = labGame();
    houses(sim, 10);
    let births = 0;
    for (let y = 0; y < 3; y++) {
      runUntil(sim, world, (y + 1) * YEAR - 460);
      births += sim.state.yearStats.births ?? 0;
      runUntil(sim, world, (y + 1) * YEAR - 449);
    }
    expect(births).toBeGreaterThanOrEqual(8);
    expect(births).toBeLessThanOrEqual(40);
  });

  it("marie les jeunes adultes de familles différentes quand une maison est libre", () => {
    const { sim, world } = labGame();
    const tick = sim.state.tick;
    // Deux « enfants » de 17 ans, d'un sexe différent et de deux foyers différents.
    const [a, b] = [sim.state.families[0]!, sim.state.families[1]!];
    const boy = { id: sim.state.nextId++, name: "Colin", sex: "M" as const, birthTick: tick - 17 * YEAR - 10, familyId: a.id };
    const girl = { id: sim.state.nextId++, name: "Oda", sex: "F" as const, birthTick: tick - 17 * YEAR - 10, familyId: b.id };
    sim.state.villagers.push(boy, girl);
    sim.population.version += 1;
    houses(sim, 11);
    runUntil(sim, world, SUMMER + 1);
    expect(sim.state.families).toHaveLength(11);
    const couple = sim.state.families.find((f) => f.husbandId === boy.id);
    expect(couple?.wifeId).toBe(girl.id);
    expect(couple?.houseId).not.toBeNull();
  });

  it("perd des habitants à la famine, jusqu'à la fin de la partie sous 5 habitants", () => {
    const { sim, world } = newGame("famine");
    manorOf(sim).stock.nourriture = 0;
    runUntil(sim, world, 5 * YEAR);
    expect(sim.state.gameOver?.reason).toBe("depeuple");
    expect(sim.state.villagers.length).toBeLessThan(5);
    expect(sim.state.log.some((l) => l.text.startsWith("La faim emporte"))).toBe(true);
    // Le temps est arrêté.
    const t = sim.state.tick;
    sim.step();
    expect(sim.state.tick).toBe(t);
  });
});

describe("impôts", () => {
  it("lève l'impôt des foyers logés au bilan d'automne, selon le niveau choisi", () => {
    const { sim, world } = labGame();
    houses(sim, 4);
    const gold = sim.state.treasury;
    runUntil(sim, world, WINTER + 1);
    expect(sim.state.treasury).toBe(gold + 4 * 4);
    expect(sim.state.log.map((l) => l.text)).toContain("Impôts de l'an 1 : 16 or (4 foyers).");
    expect(sim.apply({ type: "setTax", level: "lourd" }).ok).toBe(true);
    const housed = sim.state.families.find((f) => f.houseId !== null)!;
    expect(sim.population.moraleOf(housed, 0).parts.map((p) => p.label)).toContain("Impôts lourds");
  });
});
