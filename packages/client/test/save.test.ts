import { describe, expect, it } from "vitest";
import { SAVE_VERSION } from "@jeu/shared";
import { Session } from "../src/game/Session";
import { SaveError, parseSave, serializeSave } from "../src/save/save";

/** Fait tourner une session à vitesse x1 pendant `seconds` secondes simulées. */
function play(session: Session, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) session.update(100);
}

function buildSomething(session: Session): void {
  const manor = session.sim.state.buildings.find((b) => b.type === "manoir")!;
  session.command({ type: "build", building: "ferme", x: manor.x + 2, y: manor.y + 3 });
  session.command({ type: "field", x: manor.x + 4, y: manor.y + 4 });
  session.command({ type: "road", x: manor.x + 1, y: manor.y - 1 });
}

describe("sauvegarde", () => {
  it("restitue exactement la partie après un aller-retour JSON", () => {
    const session = Session.newGame("sauvegarde");
    buildSomething(session);
    play(session, 40);
    const text = serializeSave(session.toSave());
    const restored = Session.fromSave(parseSave(text));
    expect(restored.sim.toJSON()).toEqual(session.sim.toJSON());
    expect(restored.world).toEqual(session.world);
  });

  it("donne le même résultat qu'une partie jouée d'une traite (déterminisme)", () => {
    const a = Session.newGame("determinisme");
    buildSomething(a);
    play(a, 400);

    const b = Session.newGame("determinisme");
    buildSomething(b);
    play(b, 200);
    const c = Session.fromSave(parseSave(serializeSave(b.toSave())));
    play(c, 200);

    expect(c.sim.toJSON()).toEqual(a.sim.toJSON());
    expect(c.world).toEqual(a.world);
    expect(a.world.year).toBe(3);
  });

  it("refuse un fichier illisible ou une version future", () => {
    expect(() => parseSave("pas du json")).toThrow(SaveError);
    expect(() => parseSave(JSON.stringify({ bonjour: 1 }))).toThrow(SaveError);
    expect(() => parseSave(JSON.stringify({ saveVersion: SAVE_VERSION + 1, world: {}, domain: {} }))).toThrow(
      "Cette sauvegarde vient d'une version plus récente du jeu.",
    );
  });
});
