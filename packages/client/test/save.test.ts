import { describe, expect, it } from "vitest";
import { SAVE_VERSION } from "@jeu/shared";
import { Session } from "../src/game/Session";
import { SaveError, migrateSave, parseSave, serializeSave } from "../src/save/save";

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

  it("convertit une sauvegarde de J1 (v1) : ressources rangées au manoir, or au trésor", () => {
    const session = Session.newGame("ancienne");
    const v2 = session.toSave();
    // Reconstitue le format v1 de J1 à partir d'une partie neuve.
    const { treasury: _t, crops: _c, deliveries: _d, yearStats: _y, ...domain } = v2.domain;
    const v1 = {
      saveVersion: 1,
      savedAt: v2.savedAt,
      world: v2.world,
      domain: {
        ...domain,
        resources: { nourriture: 90, bois: 120, pierre: 40, or: 175 },
        buildings: domain.buildings.map(({ stock: _s, progress: _p, lastWork: _l, ...b }) => b),
      },
    };
    const migrated = migrateSave(JSON.parse(JSON.stringify(v1)));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    const restored = Session.fromSave(migrated);
    expect(restored.sim.totals()).toEqual({ nourriture: 90, bois: 120, pierre: 40, or: 175 });
    expect(restored.sim.state.deliveries).toEqual([]);
    play(restored, 30);
    expect(restored.sim.date.year).toBe(1);
  });

  it("convertit une sauvegarde de J2a (v2) : la population de départ arrive", () => {
    const session = Session.newGame("j2a");
    const v3 = session.toSave();
    const { villagers: _v, families: _f, taxLevel: _t, gameOver: _g, ...domain } = v3.domain;
    const v2 = { ...v3, saveVersion: 2, domain };
    const migrated = migrateSave(JSON.parse(JSON.stringify(v2)));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.domain.families.filter((f) => !f.noble)).toHaveLength(10);
    expect(migrated.domain.villagers.filter((v) => !v.noble).length).toBeGreaterThanOrEqual(20);
    expect(migrated.domain.taxLevel).toBe("normal");
    const restored = Session.fromSave(migrated);
    play(restored, 20);
    expect(restored.sim.state.villagers.length).toBeGreaterThan(15);
  });

  it("convertit une sauvegarde de J2b (v3) : accueil des nouveaux venus au rythme normal", () => {
    const session = Session.newGame("j2b");
    play(session, 20);
    const v5 = session.toSave();
    const { immigration: _i, dynasty: _d, ...domain } = v5.domain;
    const villagers = domain.villagers.filter((v) => !v.noble);
    const families = domain.families.filter((f) => !f.noble);
    const v3 = { ...v5, saveVersion: 3, domain: { ...domain, villagers, families } };
    const migrated = migrateSave(JSON.parse(JSON.stringify(v3)));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.domain.immigration).toBe("normale");
    // Même sauvegarde convertie deux fois : même partie.
    const a = Session.fromSave(migrated);
    const b = Session.fromSave(migrateSave(JSON.parse(JSON.stringify(v3))));
    play(a, 30);
    play(b, 30);
    expect(a.sim.toJSON()).toEqual(b.sim.toJSON());
  });

  it("convertit une sauvegarde de J2b (v4) : la lignée du seigneur s'installe au manoir", () => {
    const session = Session.newGame("j3");
    play(session, 20);
    const v5 = session.toSave();
    const { dynasty: _d, ...domain } = v5.domain;
    const v4 = {
      ...v5,
      saveVersion: 4,
      domain: { ...domain, villagers: domain.villagers.filter((v) => !v.noble), families: domain.families.filter((f) => !f.noble) },
    };
    const migrated = migrateSave(JSON.parse(JSON.stringify(v4)));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    const dyn = migrated.domain.dynasty;
    expect(dyn.name).toMatch(/^Maison de /);
    expect(dyn.lordId).toBe(dyn.founderId);
    expect(dyn.law).toBe("preference-masculine");
    expect(dyn.members.length).toBeGreaterThanOrEqual(3);
    expect(dyn.neighbors.length).toBeGreaterThan(0);
    expect(migrated.domain.families.filter((f) => f.noble)).toHaveLength(1);
    const restored = Session.fromSave(migrated);
    play(restored, 20);
    expect(restored.sim.dynasty.lord?.status).toBe("vivant");
  });

  it("convertit une sauvegarde de J3 (v5) : villages voisins, dimensions du monde, offres et titre", () => {
    const session = Session.newGame("j4");
    play(session, 20);
    const v6 = session.toSave();
    const { dims: _dims, offers: _o, ...domain } = v6.domain;
    const { title: _t, ...dynasty } = domain.dynasty;
    const world = { ...v6.world, fiefs: v6.world.fiefs.map(({ households: _h, land: _l, ...f }) => f) };
    const v5 = { ...v6, saveVersion: 5, world, domain: { ...domain, dynasty } };
    const migrated = migrateSave(JSON.parse(JSON.stringify(v5)));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.domain.dims).toEqual(v6.world.dims);
    expect(migrated.domain.offers).toEqual([]);
    expect(migrated.domain.dynasty.title).toBe("seigneur");
    const ai = migrated.world.fiefs.filter((f) => f.ownerId !== "joueur");
    expect(ai.every((f) => f.households >= 3 && f.land.herbe > 0)).toBe(true);
    const restored = Session.fromSave(migrated);
    play(restored, 20);
    expect(restored.sim.state.tick).toBeGreaterThan(v6.domain.tick);
  });
});

