import { describe, expect, it } from "vitest";
import { Terrain, hashString } from "@jeu/shared";
import { DomainSim } from "../src";
import { manorOf, newGame, startCenter } from "./helpers";

describe("début de partie", () => {
  it("place le manoir au centre du fief, relié, avec ses routes de départ", () => {
    const { sim } = newGame();
    const manor = sim.state.buildings.find((b) => b.type === "manoir");
    expect(manor).toBeDefined();
    expect(sim.isConnected(manor!.id)).toBe(true);
    expect(sim.state.roads).toHaveLength(5);
    expect(sim.connectedRoads().size).toBe(5);
    expect(sim.totals()).toEqual({ nourriture: 180, bois: 150, pierre: 100, or: 200 });
    expect(manorOf(sim).stock).toEqual({ nourriture: 180, bois: 150, pierre: 100 });
  });
});

describe("construction", () => {
  it("construit une maison au bord d'une route, la paie et la relie", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    const r = sim.apply({ type: "build", building: "maison", x: cx + 1, y: cy + 3 });
    expect(r.ok).toBe(true);
    expect(sim.totals().bois).toBe(150 - 8);
    const house = sim.buildingAt(cx + 1, cy + 3)!;
    expect(sim.isConnected(house.id)).toBe(true);
  });

  it("signale un bâtiment sans route comme non relié", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    sim.apply({ type: "build", building: "maison", x: cx + 4, y: cy - 4 });
    expect(sim.isConnected(sim.buildingAt(cx + 4, cy - 4)!.id)).toBe(false);
  });

  it("refuse un emplacement occupé", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    const r = sim.apply({ type: "build", building: "maison", x: cx, y: cy });
    expect(r).toMatchObject({ ok: false, reason: "Emplacement occupé." });
  });

  it("refuse de construire hors du domaine", () => {
    const { sim } = newGame();
    expect(sim.apply({ type: "build", building: "maison", x: 5, y: 5 })).toMatchObject({ ok: false, reason: "Hors de votre domaine." });
  });

  it("refuse la forêt comme terrain à bâtir", () => {
    const { sim } = newGame();
    const fief = Object.values(sim.state.fiefs)[0]!;
    const i = fief.terrain.findIndex((t) => t === Terrain.Foret);
    const x = fief.originX + (i % fief.size);
    const y = fief.originY + Math.floor(i / fief.size);
    expect(sim.check({ type: "build", building: "maison", x, y })).toMatchObject({ ok: false, reason: "Terrain impropre : forêt." });
  });

  it("refuse si les ressources manquent, sans rien dépenser", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    manorOf(sim).stock.pierre = 10;
    const r = sim.apply({ type: "build", building: "eglise", x: cx + 2, y: cy - 5 });
    expect(r).toMatchObject({ ok: false, reason: "Pas assez de pierre (il en faut 60)." });
    expect(sim.totals().pierre).toBe(10);
  });

  it("n'autorise qu'une seule église", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    expect(sim.apply({ type: "build", building: "eglise", x: cx + 2, y: cy - 5 }).ok).toBe(true);
    manorOf(sim).stock = { nourriture: 300, bois: 300, pierre: 300 };
    sim.state.treasury = 999;
    expect(sim.apply({ type: "build", building: "eglise", x: cx - 5, y: cy - 5 })).toMatchObject({ ok: false });
  });

  it("exige des roches à proximité pour une carrière", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    expect(sim.check({ type: "build", building: "carriere", x: cx, y: cy - 3 })).toMatchObject({
      ok: false,
      reason: "Doit se trouver à moins de 3 cases de : roche.",
    });
  });

  it("interdit un bâtiment à cheval sur deux fiefs", () => {
    const seed = hashString("frontiere");
    const dims = {
      seed,
      fiefSize: 48,
      cols: 2,
      rows: 1,
      dominants: ["plaines", "plaines"] as ("plaines")[],
      startFief: { col: 0, row: 0 },
      startClearRadius: 6,
      startMinForestTiles: 0,
      startMinRockTiles: 0,
    };
    const sim = DomainSim.create({ ownerId: "joueur", dims, fiefs: [{ id: "f-0-0", col: 0, row: 0 }, { id: "f-1-0", col: 1, row: 0 }] });
    // Force de l'herbe à la frontière pour isoler la règle testée.
    for (const f of Object.values(sim.state.fiefs)) f.terrain.fill(Terrain.Herbe);
    expect(sim.check({ type: "build", building: "ferme", x: 47, y: 10 })).toMatchObject({
      ok: false,
      reason: "Le bâtiment doit tenir entièrement dans un seul fief.",
    });
    expect(sim.check({ type: "road", x: 47, y: 10 }).ok).toBe(true);
    expect(sim.check({ type: "road", x: 48, y: 10 }).ok).toBe(true);
  });
});

describe("routes", () => {
  it("défriche la forêt et prolonge le réseau relié", () => {
    const { sim } = newGame();
    const fief = Object.values(sim.state.fiefs)[0]!;
    const i = fief.terrain.findIndex((t) => t === Terrain.Foret);
    const x = fief.originX + (i % fief.size);
    const y = fief.originY + Math.floor(i / fief.size);
    expect(sim.apply({ type: "road", x, y }).ok).toBe(true);
    expect(sim.terrainAt(x, y)).toBe(Terrain.Herbe);
    expect(sim.totals().or).toBe(199);
  });

  it("refuse l'eau et la roche", () => {
    const { sim } = newGame();
    const fief = Object.values(sim.state.fiefs)[0]!;
    const i = fief.terrain.findIndex((t) => t === Terrain.Roche);
    const x = fief.originX + (i % fief.size);
    const y = fief.originY + Math.floor(i / fief.size);
    expect(sim.check({ type: "road", x, y })).toMatchObject({ ok: false, reason: "Une route ne peut pas passer sur : roche." });
  });

  it("relie un bâtiment quand on construit la route qui le rejoint", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    sim.apply({ type: "build", building: "maison", x: cx + 2, y: cy + 6 });
    const id = sim.buildingAt(cx + 2, cy + 6)!.id;
    expect(sim.isConnected(id)).toBe(false);
    sim.apply({ type: "road", x: cx + 1, y: cy + 6 });
    expect(sim.isConnected(id)).toBe(true);
  });
});

describe("champs et démolition", () => {
  it("exige une ferme à proximité pour peindre un champ", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    expect(sim.check({ type: "field", x: cx + 3, y: cy + 3 })).toMatchObject({ ok: false });
    sim.apply({ type: "build", building: "ferme", x: cx + 1, y: cy + 2 });
    expect(sim.apply({ type: "field", x: cx + 3, y: cy + 3 }).ok).toBe(true);
    expect(sim.check({ type: "field", x: cx + 1 + 2 + 5, y: cy + 2 })).toMatchObject({ ok: false });
  });

  it("rembourse la moitié du coût et abandonne les champs d'une ferme démolie", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    sim.apply({ type: "build", building: "ferme", x: cx + 1, y: cy + 2 });
    sim.apply({ type: "field", x: cx + 3, y: cy + 3 });
    sim.apply({ type: "field", x: cx + 4, y: cy + 3 });
    const woodBefore = sim.totals().bois;
    expect(sim.apply({ type: "demolish", x: cx + 1, y: cy + 2 }).ok).toBe(true);
    expect(sim.totals().bois).toBe(woodBefore + 10);
    expect(sim.state.fields).toHaveLength(0);
  });

  it("refuse de démolir le manoir", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    expect(sim.apply({ type: "demolish", x: cx, y: cy })).toMatchObject({ ok: false, reason: "Le manoir ne peut pas être démoli." });
  });
});
