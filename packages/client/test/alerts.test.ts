import { describe, expect, it } from "vitest";
import { Session } from "../src/game/Session";
import { computeAlerts, jobAlerts } from "../src/ui/alerts";

/** Pose un bâtiment le long de la route de départ (qui descend du manoir), à la première place libre. */
function buildNearStartRoad(session: Session, building: string): number {
  const sim = session.sim;
  const manor = sim.state.buildings.find((b) => b.type === "manoir")!;
  for (let dy = 3; dy < 8; dy++) {
    for (const dx of [1, -3]) {
      const r = session.command({ type: "build", building, x: manor.x + 1 + dx, y: manor.y + dy });
      if (!r.ok) continue;
      const b = sim.buildingAt(manor.x + 1 + dx, manor.y + dy)!;
      if (sim.isConnected(b.id)) return b.id;
      session.command({ type: "demolish", x: b.x, y: b.y });
    }
  }
  throw new Error(`${building} impossible le long de la route de départ`);
}

describe("alertes", () => {
  it("nomme le bâtiment resté sans travailleur, et dit que l'effet sur le moral est perdu", () => {
    const session = Session.newGame("alertes");
    const sim = session.sim;
    buildNearStartRoad(session, "eglise");
    // Tout le monde redevient enfant : plus personne en âge de travailler.
    for (const v of sim.state.villagers) v.birthTick = sim.state.tick - 10 * 1800;
    sim.population.version += 1;
    const alerts = jobAlerts(sim);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.tone).toBe("warn");
    expect(alerts[0]!.text).toContain("Sans travailleur, à l'arrêt : Église.");
    expect(alerts[0]!.text).toContain("L'église ne soutient plus le moral.");
    expect(computeAlerts(sim).map((a) => a.text)).toContain(alerts[0]!.text);
  });

  it("ne signale rien quand chaque poste est pourvu", () => {
    const session = Session.newGame("alertes-ok");
    buildNearStartRoad(session, "eglise");
    expect(jobAlerts(session.sim)).toEqual([]);
  });
});
