import { describe, expect, it } from "vitest";
import { Rng, Terrain, generateFiefTerrain, hashString, type WorldDims } from "../src";

function dims(seedText: string, dominants: WorldDims["dominants"] = ["foret", "plaines", "riviere"]): WorldDims {
  return {
    seed: hashString(seedText),
    fiefSize: 48,
    cols: 3,
    rows: 1,
    dominants,
    startFief: { col: 1, row: 0 },
    startClearRadius: 6,
    startMinForestTiles: 160,
    startMinRockTiles: 24,
  };
}

const count = (arr: number[], v: number) => arr.filter((x) => x === v).length;

describe("générateur aléatoire", () => {
  it("donne la même suite pour la même graine", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it("reprend exactement là où il s'était arrêté à partir de son état", () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(a.state);
    expect(b.next()).toBe(a.next());
  });

  it("respecte les bornes de int()", () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe("génération du terrain", () => {
  it("est déterministe", () => {
    expect(generateFiefTerrain(dims("abc"), 0, 0)).toEqual(generateFiefTerrain(dims("abc"), 0, 0));
  });

  it("change avec la graine", () => {
    expect(generateFiefTerrain(dims("abc"), 0, 0).terrain).not.toEqual(generateFiefTerrain(dims("xyz"), 0, 0).terrain);
  });

  it("dégage le centre du fief de départ et y garantit bois et pierre", () => {
    for (const seed of ["un", "deux", "trois", "quatre", "cinq"]) {
      const d = dims(seed);
      const { terrain } = generateFiefTerrain(d, 1, 0);
      const c = 24;
      for (let y = c - 6; y <= c + 6; y++) for (let x = c - 6; x <= c + 6; x++) expect(terrain[y * 48 + x]).toBe(Terrain.Herbe);
      expect(count(terrain, Terrain.Foret)).toBeGreaterThanOrEqual(d.startMinForestTiles);
      expect(count(terrain, Terrain.Roche)).toBeGreaterThanOrEqual(d.startMinRockTiles);
    }
  });

  it("donne plus de forêt à un fief forestier qu'à des plaines", () => {
    const d = dims("comparaison", ["foret", "plaines", "pierre"]);
    const forest = generateFiefTerrain({ ...d, startFief: null }, 0, 0).terrain;
    const plains = generateFiefTerrain({ ...d, startFief: null }, 1, 0).terrain;
    const stone = generateFiefTerrain({ ...d, startFief: null }, 2, 0).terrain;
    expect(count(forest, Terrain.Foret)).toBeGreaterThan(count(plains, Terrain.Foret));
    expect(count(stone, Terrain.Roche)).toBeGreaterThan(count(plains, Terrain.Roche));
  });

  it("fait couler une rivière dans une vallée de rivière", () => {
    const { terrain } = generateFiefTerrain(dims("eau"), 2, 0);
    expect(count(terrain, Terrain.Eau)).toBeGreaterThanOrEqual(96);
  });

  it("garde la fertilité entre 5 et 100", () => {
    const { fertility } = generateFiefTerrain(dims("fertile"), 1, 0);
    expect(Math.min(...fertility)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...fertility)).toBeLessThanOrEqual(100);
  });
});
