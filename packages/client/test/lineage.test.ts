import { describe, expect, it } from "vitest";
import { Session } from "../src/game/Session";
import { lineageAlerts } from "../src/ui/alerts";
import { chronicleHtml, decisionHtml, fertility, lineagePanelHtml, relation } from "../src/ui/lineage";

function play(session: Session, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) session.update(100);
}

describe("interface de la lignée", () => {
  it("nomme les liens de parenté avec le seigneur", () => {
    const { sim } = Session.newGame("parente");
    const lord = sim.dynasty.lord!;
    const wife = sim.dynasty.member(lord.spouseIds[0])!;
    const child = sim.dynasty.heir()!;
    expect(relation(sim, lord)).toBe("seigneur");
    expect(relation(sim, wife)).toBe("épouse");
    expect(relation(sim, child)).toBe(child.sex === "F" ? "fille" : "fils");
  });

  it("prévient quand la lignée est fragile, puis quand elle n'a plus d'héritier", () => {
    const { sim } = Session.newGame("fragile");
    // Un seul enfant, mais le couple du seigneur peut en avoir d'autres : pas d'alerte.
    expect(lineageAlerts(sim)).toEqual([]);
    sim.dynasty.member(sim.dynasty.lord!.spouseIds[0])!.status = "mort";
    expect(lineageAlerts(sim).map((a) => a.tone)).toEqual(["warn"]);
    sim.dynasty.heir()!.status = "mort";
    const alerts = lineageAlerts(sim);
    expect(alerts[0]!.tone).toBe("bad");
    expect(alerts[0]!.text).toContain("la lignée s'éteindra");
    expect(lineagePanelHtml(sim)).toContain("aucun : à sa mort, la lignée s'éteint");
  });

  it("ouvre une affaire de famille quand l'enfant atteint 16 ans, avec trois prétendants", () => {
    const session = Session.newGame("affaire");
    const sim = session.sim;
    const child = sim.dynasty.heir()!;
    const birth = sim.state.tick - 16 * 1800;
    child.birthTick = birth;
    sim.population.villager(child.id)!.birthTick = birth;
    sim.population.version += 1;
    expect(decisionHtml(sim, child.id)).toBeNull();
    play(session, 3);
    const view = decisionHtml(sim, child.id)!;
    expect(view.title).toBe(`Avenir de ${child.name}`);
    expect(view.body.match(/data-choice="\d"/g)).toHaveLength(3);
    expect(view.body).toContain('data-choice="eglise"');
    expect(lineageAlerts(sim).some((a) => a.text.startsWith("Affaire de famille"))).toBe(true);
    expect(chronicleHtml(sim)).toContain("fonde la Maison de");
  });

  it("estime les enfants à attendre selon l'âge de l'épouse", () => {
    expect(fertility(16).years).toBe(23);
    expect(fertility(35).children).toBeLessThan(fertility(18).children);
    expect(fertility(45)).toEqual({ years: 0, children: 0 });
  });
});
