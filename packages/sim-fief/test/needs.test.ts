import { describe, expect, it } from "vitest";
import { DAY_TICKS, NEEDS, type DomainSim } from "../src";
import { build, labGame, manorOf, road, runUntil } from "./helpers";

const SEASON = 450;
const AUTUMN = 900;

/** Village du laboratoire avec une rue au sud du manoir (y = 27). */
function village(blocks: Parameters<typeof labGame>[0] = []) {
  const { sim, world } = labGame(blocks);
  road(sim, 73, 27, 92, 27);
  return { sim, world };
}

function houses(sim: DomainSim, n: number): void {
  for (let i = 0; i < n; i++) build(sim, "maison", 73 + i, 28);
}

describe("ateliers de transformation", () => {
  it("la forge va chercher bois et pierre, et livre des outils", () => {
    const { sim, world } = village();
    houses(sim, 10);
    manorOf(sim).stock = { nourriture: 100, bois: 150, pierre: 150 };
    const forge = build(sim, "forge", 84, 25);
    runUntil(sim, world, SEASON);
    expect(sim.population.workers(forge.id).length).toBe(2);
    const made = sim.state.yearStats.produced.outils ?? 0;
    // 30 par an à plein effectif : environ 7 en une saison.
    expect(made).toBeGreaterThanOrEqual(4);
    expect(made).toBeLessThanOrEqual(9);
    expect((manorOf(sim).stock.bois ?? 0) + (forge.stock.bois ?? 0)).toBeLessThan(150);
    expect(sim.economy.stockOf("outils") + (forge.stock.outils ?? 0)).toBeGreaterThan(0);
  });

  it("la bergerie tond la laine des prés libres, le tisserand en fait des vêtements (2 laines pour 1)", () => {
    const { sim, world } = village();
    houses(sim, 10);
    const sheep = build(sim, "bergerie", 86, 25);
    const weaver = build(sim, "tisserand", 80, 25);
    expect(sim.economy.efficiency(sheep.id)).toBeGreaterThan(500);
    runUntil(sim, world, 2 * SEASON);
    const stats = sim.state.yearStats.produced;
    expect(stats.laine ?? 0).toBeGreaterThan(10);
    expect(stats.vetements ?? 0).toBeGreaterThan(0);
    expect(weaver.stock.laine ?? 0).toBeLessThanOrEqual(16);
  });
});

describe("besoins du village", () => {
  it("les outils s'usent et rendent ateliers et fermes plus productifs", () => {
    const { sim, world } = village();
    houses(sim, 10);
    build(sim, "ferme", 84, 25);
    manorOf(sim).stock = { nourriture: 100, outils: 100 };
    expect(sim.economy.toolFactor()).toBe(1000);
    runUntil(sim, world, 40 * DAY_TICKS);
    expect(sim.state.needs.outils.coverage).toBeGreaterThan(600);
    expect(sim.economy.toolFactor()).toBeGreaterThan(1150);
    // Usure : 0,5 outil par travailleur et par an (la ferme emploie 3 personnes).
    const used = (100 - (manorOf(sim).stock.outils ?? 0)) * 1000 + sim.state.needs.outils.owed;
    expect(used).toBeGreaterThan(0);
  });

  it("des vêtements : moral meilleur et froid moins mortel ; sans, rien", () => {
    const { sim, world } = village();
    houses(sim, 10);
    const family = sim.state.families.find((f) => !f.noble)!;
    expect(sim.needs.coldFactor()).toBe(1000);
    manorOf(sim).stock = { nourriture: 100, vetements: 100 };
    runUntil(sim, world, 40 * DAY_TICKS);
    expect(sim.state.needs.vetements.coverage).toBeGreaterThanOrEqual(NEEDS.seuilMoralPourMille);
    expect(sim.population.moraleOf(family, 0).parts).toContainEqual({ label: "Bien vêtus", value: 10 });
    expect(sim.needs.coldFactor()).toBeLessThan(700);
  });

  it("la natalité suit le bien-être : un enfant tous les 2,5 ans au plus bas, tous les 1,5 an au mieux", () => {
    const { sim } = village();
    expect(sim.needs.birthInterval(50)).toBe(300);
    // Moral au plus haut mais rien pour se vêtir ni s'équiper : les besoins freinent les naissances.
    expect(sim.needs.birthInterval(100)).toBe(300 - Math.floor((120 * (1000 - NEEDS.natalite.partBesoinsPourMille)) / 1000));
    sim.state.needs.outils.coverage = 1000;
    sim.state.needs.vetements.coverage = 1000;
    expect(sim.needs.birthInterval(100)).toBe(180);
  });

  it("la couverture est proportionnelle : servir un tiers des besoins affiche environ un tiers", () => {
    const { sim, world } = village();
    houses(sim, 10);
    const manor = manorOf(sim);
    manor.stock = { nourriture: 200 };
    sim.state.needs.vetements.coverage = 0;
    const perDay = (sim.state.villagers.length * NEEDS.vetementsParHabitantParAn) / 120;
    // Tous les 3 jours, de quoi couvrir un jour de besoins.
    let given = 0;
    for (let day = 1; day <= 90; day++) {
      runUntil(sim, world, sim.state.tick + DAY_TICKS);
      const due = Math.floor(day * perDay / 3) - given;
      if (due > 0) {
        manor.stock.vetements = (manor.stock.vetements ?? 0) + due;
        given += due;
      }
    }
    const cov = sim.state.needs.vetements.coverage;
    expect(cov).toBeGreaterThan(200);
    expect(cov).toBeLessThan(500);
  });

  it("dit où bloque la chaîne des vêtements : laine ou tisserands", () => {
    const { sim } = village();
    houses(sim, 10);
    expect(sim.needs.clothesAdvice()).toContain("bergerie puis tisserand");
    build(sim, "tisserand", 80, 25);
    build(sim, "tisserand", 83, 25);
    expect(sim.needs.clothesAdvice()).toContain("Il manque de la laine");
    expect(sim.needs.chain().besoinVetements).toBe(Math.ceil(sim.state.villagers.length * NEEDS.vetementsParHabitantParAn));
  });
});

describe("bras inoccupés", () => {
  it("au-delà de 15 % de travailleurs sans emploi, le moral baisse (pas pendant les premières années)", () => {
    const { sim, world } = village();
    houses(sim, 10);
    const family = sim.state.families.find((f) => !f.noble)!;
    const label = (parts: { label: string }[]) => parts.some((p) => p.label.startsWith("Bras inoccupés"));
    expect(sim.population.idleMalus().pct).toBeGreaterThan(50);
    expect(label(sim.population.moraleOf(family, 0).parts)).toBe(false);
    sim.state.tick = 6 * 1800;
    sim.population.version += 1;
    const idle = sim.population.idleMalus();
    expect(idle.malus).toBe(-Math.min(15, idle.pct - 15));
    expect(sim.population.moraleOf(family, 0).parts).toContainEqual({ label: `Bras inoccupés (${idle.pct} %)`, value: idle.malus });
    void world;
  });
});

describe("épidémie", () => {
  it("un guérisseur à portée, avec des remèdes, divise la mortalité par quatre et use ses remèdes", () => {
    const { sim, world } = village([{ terrain: 1, x: 80, y: 18, w: 6, h: 6 }]);
    houses(sim, 6);
    const healer = build(sim, "guerisseur", 80, 26);
    runUntil(sim, world, DAY_TICKS + 1);
    healer.stock.remedes = 0;
    sim.state.epidemic = { fiefId: "f-1-0", x: 75, y: 28, radius: 10, untilTick: sim.state.tick + 40 * DAY_TICKS, deaths: 0, care: {} };
    const housed = sim.state.families.find((f) => !f.noble && f.houseId !== null)!;
    const adult = sim.population.members(housed.id).find((v) => sim.state.tick - v.birthTick > 20 * 1800)!;
    const sick = sim.needs.diseaseRisks(sim.state.tick).get(adult.id);
    expect(sick).toBe(NEEDS.maladie.mortaliteParJour);
    healer.stock.remedes = 5;
    sim.population.version += 1;
    const treated = sim.needs.diseaseRisks(sim.state.tick).get(adult.id)!;
    expect(treated).toBeCloseTo((NEEDS.maladie.mortaliteParJour * NEEDS.maladie.soinPourMille) / 1000, 6);
    for (let i = 0; i < 20; i++) sim.needs.diseaseRisks(sim.state.tick);
    expect(healer.stock.remedes ?? 0).toBeLessThan(5);
    // Ses remèdes restent chez lui : plein, il est prêt, sans alerte de porteurs.
    healer.stock.remedes = 20;
    const status = sim.economy.status(healer.id);
    expect(status.text).toContain("Remèdes prêts");
    expect(status.blocked).toBe(false);
  });

  it("ne se déclare pas pendant les premières années, et finit par s'arrêter", () => {
    const { sim, world } = village();
    houses(sim, 10);
    runUntil(sim, world, 2 * 1800);
    expect(sim.state.epidemic).toBeNull();
    sim.state.epidemic = { fiefId: "f-1-0", x: 75, y: 28, radius: 10, untilTick: sim.state.tick + 5 * DAY_TICKS, deaths: 0, care: {} };
    runUntil(sim, world, sim.state.tick + 7 * DAY_TICKS);
    expect(sim.state.epidemic).toBeNull();
    expect(sim.state.log.some((l) => l.text.startsWith("L'épidémie prend fin"))).toBe(true);
  });
});

describe("foire d'automne", () => {
  it("achète et vend à prix fixes, en automne seulement, dans la limite de l'année", () => {
    const { sim, world } = village();
    sim.state.treasury = 1000;
    manorOf(sim).stock = { nourriture: 200, bois: 50 };
    expect(sim.apply({ type: "trade", good: "bois", qty: 10, side: "achat" }).reason).toContain("automne");
    runUntil(sim, world, AUTUMN + 1);
    expect(sim.apply({ type: "trade", good: "bois", qty: 10, side: "achat" }).ok).toBe(true);
    expect(sim.state.treasury).toBe(1000 - 10 * NEEDS.foire.prix.bois!.achat);
    expect(sim.apply({ type: "trade", good: "nourriture", qty: 50, side: "vente" }).ok).toBe(true);
    expect(sim.state.treasury).toBe(1000 - 10 * NEEDS.foire.prix.bois!.achat + 50 * NEEDS.foire.prix.nourriture!.vente);
    expect(sim.apply({ type: "trade", good: "nourriture", qty: 40, side: "vente" }).reason).toContain("plus que 30");
    expect(sim.apply({ type: "trade", good: "remedes", qty: 1, side: "achat" }).ok).toBe(false);
  });
});
