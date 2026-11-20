import { describe, expect, it } from "vitest";
import { PLAYER_ID, createWorld, fiefsOwnedBy, lineageSetupFor, resolveBarrier } from "@jeu/sim-monde";
import { DomainSim, EVENTS, TICKS_PER_YEAR, TRAITS, rollTraits, type EventDef } from "../src";
import { SMALL_WORLD, build, manorOf, newGame, runUntil, startCenter } from "./helpers";

const def = (id: string): EventDef => (EVENTS.evenements.find((e) => e.id === id) ?? EVENTS.regionaux.find((e) => e.id === id))!;
const start = (sim: DomainSim, id: string, regional = false) => sim.withRng((rng) => sim.events.start(def(id), regional, rng));
const pendingKey = (sim: DomainSim) => sim.state.events.pending[0]!.key;

describe("événements du domaine (J8)", () => {
  it("un événement à options attend une décision ; le choix applique coût et effets", () => {
    const { sim } = newGame();
    start(sim, "pelerins");
    expect(sim.state.events.pending).toHaveLength(1);
    const food = sim.economy.stockOf("nourriture");
    const prestige = sim.dynasty.prestige().total;
    expect(sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "accueillir" }).ok).toBe(true);
    expect(sim.state.events.pending).toHaveLength(0);
    expect(sim.economy.stockOf("nourriture")).toBe(food - 40);
    expect(sim.dynasty.prestige().total).toBe(prestige + 8);
    // Moral +3 pendant 60 jours.
    const fam = sim.state.families[0]!;
    expect(sim.population.moraleOf(fam, 0).parts).toContainEqual({ label: "Des pèlerins à la porte", value: 3 });
  });

  it("une option impossible est refusée (bâtiment manquant, or insuffisant)", () => {
    const { sim } = newGame();
    start(sim, "pelerins");
    expect(sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "eglise" }).ok).toBe(false);
    start(sim, "marchand");
    sim.state.treasury = 10;
    const key = sim.state.events.pending.find((p) => p.eventId === "marchand")!.key;
    expect(sim.check({ type: "answerEvent", key, option: "outils" })).toMatchObject({ ok: false });
  });

  it("sans réponse, l'option par défaut s'applique au bilan d'automne", () => {
    const { sim, world } = newGame();
    start(sim, "querelle");
    runUntil(sim, world, TICKS_PER_YEAR);
    expect(sim.state.events.pending).toHaveLength(0);
    expect(sim.state.log.some((l) => l.text.includes("faute de décision"))).toBe(true);
  });

  it("incendie : laisser faire détruit le bâtiment visé ; reconstruire coûte son prix", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    const house = build(sim, "maison", cx + 1, cy + 3);
    sim.state.buildings = sim.state.buildings.filter((b) => b.type === "manoir" || b.id === house.id);
    start(sim, "incendie");
    expect(sim.state.events.pending[0]!.targetId).toBe(house.id);
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "laisser" });
    expect(sim.building(house.id)).toBeUndefined();

    const again = build(sim, "maison", cx + 1, cy + 3);
    start(sim, "incendie");
    const bois = sim.totals().bois;
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "reconstruire" });
    expect(sim.building(again.id)).toBeDefined();
    expect(sim.totals().bois).toBe(bois - 8);
  });

  it("été sec : la récolte baisse de 30 % ; un puits divise la perte par deux", () => {
    const { sim } = newGame();
    expect(sim.events.harvestFactor()).toBe(1000);
    start(sim, "ete-sec");
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "attendre" });
    expect(sim.events.harvestFactor()).toBe(700);
    sim.state.events.effects = [];
    sim.state.events.unlocked.push("puits");
    const { cx, cy } = startCenter(sim);
    build(sim, "puits", cx + 1, cy + 3);
    start(sim, "ete-sec");
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "attendre" });
    expect(sim.events.harvestFactor()).toBe(850);
  });

  it("le puits et la cathédrale ne se bâtissent qu'une fois débloqués", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    expect(sim.check({ type: "build", building: "puits", x: cx + 1, y: cy + 3 })).toMatchObject({ ok: false });
    start(sim, "ete-sec");
    manorOf(sim).stock.pierre = 100;
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "puits" });
    expect(sim.state.events.unlocked).toContain("puits");
    expect(sim.check({ type: "build", building: "puits", x: cx + 1, y: cy + 3 }).ok).toBe(true);
  });

  it("au fil des ans, des événements arrivent d'eux-mêmes (environ un tous les 2 à 3 ans)", () => {
    const { sim, world } = newGame("evenements");
    let seen = 0;
    while (sim.state.tick < 12 * TICKS_PER_YEAR && !sim.state.gameOver) {
      const ev = sim.step();
      seen += ev.filter((e) => e.type === "domainEvent").length;
      if (ev.some((e) => e.type === "barrier")) {
        sim.applyBarrierResult(resolveBarrier(world, [{ ownerId: sim.state.ownerId, summary: sim.summary(), ready: true, actions: sim.barrierActions() }]));
      }
    }
    expect(seen).toBeGreaterThanOrEqual(1);
    expect(seen).toBeLessThanOrEqual(10);
  });

  it("peste régionale : le domaine touché choisit ; par défaut, l'épidémie se déclare", () => {
    const { sim } = newGame();
    const { cx, cy } = startCenter(sim);
    build(sim, "maison", cx + 1, cy + 3);
    for (let i = 0; i < 40; i++) sim.step();
    const fief = Object.keys(sim.state.fiefs)[0]!;
    sim.withRng((rng) => sim.events.onRegional("peste", ["f-autre"], rng));
    expect(sim.state.events.pending).toHaveLength(0);
    sim.withRng((rng) => sim.events.onRegional("peste", [fief], rng));
    expect(sim.state.events.pending[0]!.eventId).toBe("peste");
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "laisser" });
    expect(sim.state.epidemic).not.toBeNull();
  });

  it("hiver rigoureux : moitié plus de bois brûlé, mais seulement l'hiver suivant", () => {
    const { sim } = newGame();
    start(sim, "hiver-rigoureux", true);
    sim.apply({ type: "answerEvent", key: pendingKey(sim), option: "endurer" });
    expect(sim.events.heatingFactor()).toBe(1000);
    sim.state.tick += 125 * (TICKS_PER_YEAR / 120);
    expect(sim.events.heatingFactor()).toBe(1500);
  });
});

describe("traits des personnages (J8)", () => {
  it("un ou deux traits, jamais opposés, stables pour une même clé", () => {
    for (let i = 0; i < 200; i++) {
      const t = rollTraits(`cle-${i}`);
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(2);
      if (t.length === 2) expect(TRAITS[t[0]!]!.oppose).not.toBe(t[1]);
      expect(rollTraits(`cle-${i}`)).toEqual(t);
    }
  });

  it("la lignée naît avec des traits", () => {
    const world = createWorld("traits", SMALL_WORLD);
    const sim = DomainSim.create({ ownerId: PLAYER_ID, dims: world.dims, fiefs: fiefsOwnedBy(world, PLAYER_ID).map((f) => ({ id: f.id, col: f.col, row: f.row })), lineage: lineageSetupFor(world, PLAYER_ID) });
    for (const m of sim.state.dynasty.members) expect(m.traits!.length).toBeGreaterThanOrEqual(1);
  });

  it("seigneur cruel : impôts +50 %, moral −8 ; son conjoint compte à moitié", () => {
    const { sim } = newGame();
    const lord = sim.dynasty.member(sim.state.dynasty.lordId)!;
    lord.traits = ["cruel"];
    expect(sim.events.rule().impots).toBe(500);
    const fam = sim.state.families.find((f) => !f.noble)!;
    expect(sim.population.moraleOf(fam, 0).parts).toContainEqual({ label: "Seigneur cruel", value: -8 });
    const spouse = sim.dynasty.livingSpouse(lord)!;
    spouse.traits = ["genereux"];
    expect(sim.events.rule().impots).toBe(500 - 125);
    expect(sim.population.moraleOf(fam, 0).parts).toContainEqual({ label: "Conjoint généreux", value: 3 });
    expect(sim.summary().traits).toEqual(["cruel"]);
  });

  it("seigneur bâtisseur : les bâtiments coûtent 15 % de bois et de pierre en moins", () => {
    const { sim } = newGame();
    sim.dynasty.member(sim.state.dynasty.lordId)!.traits = ["batisseur"];
    const { cx, cy } = startCenter(sim);
    const r = sim.check({ type: "build", building: "entrepot", x: cx + 1, y: cy + 3 });
    expect(r.cost).toMatchObject({ bois: 25, pierre: 8 });
  });
});
