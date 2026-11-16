import { describe, expect, it } from "vitest";
import { DAY_TICKS, ageOf, emptyHouseStatus, type DomainSim } from "../src";

/** Foyers du village (sans la famille noble, qui vit au manoir). */
function villageFamilies(sim: DomainSim) {
  return sim.state.families.filter((f) => !f.noble);
}
import { build, labGame, manorOf, newGame, road, runUntil } from "./helpers";

const SUMMER = 450;
const AUTUMN = 900;
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
    const fams = villageFamilies(sim);
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
    const villagers = sim.state.villagers.filter((v) => !v.noble);
    const kids = villagers.filter((v) => ageOf(v, tick) < 17);
    expect(villagers.length).toBe(20 + kids.length);
    for (const k of kids) expect(ageOf(k, tick)).toBeLessThanOrEqual(5);
    // Chaque foyer arrive avec 10 jours de vivres.
    for (const f of fams) {
      const daily = sim.population.members(f.id).reduce((n, v) => n + (ageOf(v, tick) >= 14 ? 50 : 25), 0);
      expect(f.food).toBe(daily * 10);
    }
    // Plus la famille du seigneur : lui, son épouse et leur enfant.
    expect(sim.population.counts()).toMatchObject({ adults: 22, homeless: 10, families: 10, nobles: 3 });
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

  it("va jusqu'à une réserve bien garnie plutôt qu'à un entrepôt proche presque vide", () => {
    const { sim, world } = hungryVillage();
    // Un entrepôt tout près des maisons, avec seulement 2 vivres ; le manoir en a plein.
    const depot = build(sim, "entrepot", 80, 25);
    depot.stock = { nourriture: 2 };
    for (const f of sim.state.families) if (!f.noble) f.food = 0;
    runUntil(sim, world, DAY_TICKS * 2);
    const trips = sim.state.deliveries.filter((d) => d.kind === "collecte" && d.familyId !== undefined && d.good === "nourriture");
    expect(trips.length).toBeGreaterThan(1);
    expect(trips.filter((d) => d.toId === depot.id)).toHaveLength(0);
    expect(trips.some((d) => d.toId === manorOf(sim).id && d.amount >= 5)).toBe(true);
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
    expect(villageFamilies(sim)).toHaveLength(11);
    const couple = sim.state.families.find((f) => f.husbandId === boy.id);
    expect(couple?.wifeId).toBe(girl.id);
    expect(couple?.houseId).not.toBeNull();
  });

  it("perd des habitants à la famine, jusqu'à la fin de la partie", () => {
    const { sim, world } = newGame("famine");
    manorOf(sim).stock.nourriture = 0;
    runUntil(sim, world, 10 * YEAR);
    // Le village se vide, ou la lignée affamée s'éteint la première.
    expect(["depeuple", "extinction"]).toContain(sim.state.gameOver?.reason);
    expect(sim.state.log.some((l) => l.text.startsWith("La faim emporte"))).toBe(true);
    // Le temps est arrêté.
    const t = sim.state.tick;
    sim.step();
    expect(sim.state.tick).toBe(t);
  });

  it("s'arrête quand le domaine compte moins de 5 habitants", () => {
    const { sim, world } = labGame();
    const lordId = sim.state.dynasty.lordId;
    sim.state.villagers = sim.state.villagers.filter((v) => v.noble || v.id === sim.state.villagers[0]!.id);
    sim.population.version += 1;
    expect(sim.state.villagers.length).toBeLessThan(5);
    runUntil(sim, world, DAY_TICKS + 1);
    expect(sim.state.gameOver?.reason).toBe("depeuple");
    expect(sim.state.dynasty.lordId).toBe(lordId);
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

describe("nouveaux venus", () => {
  it("accueille une famille par an au plus quand une maison libre et des vivres l'attendent", () => {
    const { sim, world } = labGame();
    houses(sim, 12);
    runUntil(sim, world, DAY_TICKS + 1);
    expect(sim.population.housingOutlook()).toMatchObject({ homeless: 0, waitingCouples: 0, spare: 2 });
    expect(sim.population.immigrationCheck().ready).toBe(true);
    runUntil(sim, world, SUMMER + 1);
    expect(villageFamilies(sim)).toHaveLength(11);
    const newcomers = villageFamilies(sim)[10]!;
    expect(newcomers.houseId).not.toBeNull();
    for (const id of [newcomers.husbandId, newcomers.wifeId]) {
      const age = ageOf(sim.population.villager(id)!, sim.state.tick);
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(30);
    }
    expect(sim.state.log.some((l) => l.text.startsWith("Nouveaux venus :"))).toBe(true);
    expect(sim.state.yearStats.immigrants).toBe(1);
    // Une seule famille par an au rythme normal : rien à l'automne, la suivante au printemps.
    expect(sim.population.immigrationCheck().reason).toContain("la suivante au printemps");
    runUntil(sim, world, AUTUMN + 1);
    expect(villageFamilies(sim)).toHaveLength(11);
    runUntil(sim, world, YEAR + 1);
    expect(villageFamilies(sim)).toHaveLength(12);
  });

  it("n'accueille personne si l'accueil est fermé, sans un an de vivres ou avec un moral trop bas", () => {
    const { sim, world } = labGame();
    houses(sim, 12);
    runUntil(sim, world, DAY_TICKS + 1);
    expect(sim.apply({ type: "setImmigration", level: "fermee" }).ok).toBe(true);
    expect(sim.population.immigrationCheck().reason).toBe("Accueil des nouveaux venus fermé.");
    runUntil(sim, world, SUMMER + 1);
    expect(villageFamilies(sim)).toHaveLength(10);

    sim.apply({ type: "setImmigration", level: "normale" });
    for (const f of sim.state.families) f.food = 0;
    manorOf(sim).stock.nourriture = 50;
    expect(sim.population.immigrationCheck().reason).toMatch(/^Il faut 120 jours de vivres d'avance/);

    for (const f of sim.state.families) {
      f.food = 1e9;
      f.morale = 30;
    }
    expect(sim.population.immigrationCheck().reason).toBe("Il faut un moral d'au moins 50 (il est de 30).");
  });

  it("garde les maisons libres pour les sans-abri et les jeunes couples, et dit pourquoi une maison reste vide", () => {
    const { sim, world } = labGame();
    houses(sim, 9);
    runUntil(sim, world, DAY_TICKS + 1);
    let o = sim.population.housingOutlook();
    expect(o).toMatchObject({ homeless: 1, spare: 0 });
    expect(o.immigration.reason).toBe("Aucune maison libre et reliée que personne n'attend.");
    // Les enfants de départ ont 5 ans au plus : pas de mariage avant une douzaine d'années.
    expect(o.nextMarriageYears).toBeGreaterThanOrEqual(12);
    sim.apply({ type: "setImmigration", level: "fermee" });
    houses(sim, 2, 82);
    runUntil(sim, world, 2 * DAY_TICKS + 1);
    o = sim.population.housingOutlook();
    expect(o).toMatchObject({ homeless: 0, freeHouses: 1, spare: 1 });
    const text = emptyHouseStatus(o).text;
    expect(text).toContain("Maison vide. Accueil des nouveaux venus fermé.");
    expect(text).toMatch(/Prochain mariage possible dans \d+ ans environ\./);
    expect(emptyHouseStatus(o).tone).toBe("warn");
  });

  it("accueille jusqu'à trois familles par an quand l'accueil est ouvert, au prix d'un peu de moral", () => {
    const { sim, world } = labGame();
    houses(sim, 14);
    expect(sim.apply({ type: "setImmigration", level: "ouverte" }).ok).toBe(true);
    runUntil(sim, world, AUTUMN + 1);
    expect(villageFamilies(sim)).toHaveLength(12);
    runUntil(sim, world, YEAR + 1);
    expect(villageFamilies(sim)).toHaveLength(13);
    const housed = sim.state.families[0]!;
    const parts = sim.population.moraleOf(housed, 0).parts;
    expect(parts).toContainEqual({ label: "Accueil ouvert aux nouveaux venus", value: -10 });
  });
});
