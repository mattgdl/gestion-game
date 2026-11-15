import { describe, expect, it } from "vitest";
import { Session } from "../src/game/Session";
import { parseSave } from "../src/save/save";
import { Journal, type JournalDb } from "../src/telemetry/journal";

function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const db: JournalDb = {
    doc: (path) => ({
      set: async (data) => {
        docs.set(path, JSON.parse(JSON.stringify(data)));
      },
    }),
  };
  return { db, docs };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe("journal de partie", () => {
  it("reste inactif sans base de données", async () => {
    const journal = new Journal(Session.newGame("sans-base"), memoryStorage());
    journal.attach(null);
    expect(journal.status).toBe("indisponible");
  });

  it("n'écrit rien tant que la partie n'est pas jouée, puis l'état avec une sauvegarde rechargeable", async () => {
    const session = Session.newGame("journal");
    const { db, docs } = fakeDb();
    const journal = new Journal(session, memoryStorage());
    journal.attach(db, "u-123");
    await flushPromises();
    // Page ouverte sans jouer : pas de partie vide dans le journal.
    expect(docs.size).toBe(0);
    session.paused = true;
    journal.onFrame(10_000);
    await flushPromises();
    expect(docs.size).toBe(0);
    session.paused = false;
    journal.onFrame(6_000);
    await flushPromises();
    expect(journal.hasPlayed).toBe(true);
    const doc = docs.get(`parties/${session.gameId}`);
    expect(doc).toMatchObject({ graine: "journal", joueur: "u-123", batiments: { manoir: 1 }, nouveauxVenus: { accueil: "normale" } });
    const restored = Session.fromSave(parseSave(String(doc?.sauvegarde)));
    expect(restored.gameId).toBe(session.gameId);
    expect(restored.sim.toJSON()).toEqual(session.sim.toJSON());
  });

  it("compte les actions, les refus montrés au joueur et le temps par vitesse", async () => {
    const session = Session.newGame("compteurs");
    const { db, docs } = fakeDb();
    const journal = new Journal(session, memoryStorage(), 1000);
    journal.attach(db);
    const manor = session.sim.state.buildings[0]!;
    const ok = { type: "build" as const, building: "maison", x: manor.x + 4, y: manor.y };
    journal.onCommand(ok, session.command(ok), false);
    const bad = { type: "build" as const, building: "maison", x: manor.x, y: manor.y };
    journal.onCommand(bad, session.command(bad), false);
    journal.onCommand({ type: "road", x: 0, y: 0 }, { ok: false, reason: "Hors de votre domaine." }, true);
    journal.onFrame(2000);
    session.speed = 3;
    journal.onFrame(1000);
    session.paused = true;
    journal.onFrame(500);
    await journal.flush();
    await flushPromises();
    const doc = docs.get(`parties/${session.gameId}`) as Record<string, unknown>;
    expect(doc.actions).toEqual({ "build:maison": { ok: 1, refus: 1 }, road: { ok: 0, refus: 0 } });
    expect(doc.refus).toEqual({ "Emplacement occupé.": 1 });
    expect(doc.constructions).toEqual({ maison: 1 });
    expect(doc.tempsReel).toEqual({ totalS: 3.5, pauseS: 0.5, x1S: 2, x2S: 0, x3S: 1 });
  });

  it("écrit un bilan à la fin de chaque automne et repart de zéro pour l'année suivante", async () => {
    const session = Session.newGame("bilan");
    const { db, docs } = fakeDb();
    const journal = new Journal(session, memoryStorage(), 1e9);
    journal.attach(db);
    session.onEvents((events) => {
      if (events.some((e) => e.type === "barrier")) journal.onBarrier();
    });
    for (let i = 0; i < 1800 * 2; i++) {
      session.update(100);
      journal.onFrame(100);
    }
    await flushPromises();
    const an1 = docs.get(`parties/${session.gameId}/bilans/an-01`) as Record<string, unknown>;
    const an2 = docs.get(`parties/${session.gameId}/bilans/an-02`) as Record<string, unknown>;
    expect(an1).toMatchObject({ annee: 1, date: { saison: "Automne" } });
    expect((an1.tempsReel as { x1S: number }).x1S).toBeCloseTo(134.9, 0);
    expect((an2.tempsReel as { x1S: number }).x1S).toBeCloseTo(180, 0);
  });

  it("n'écrit plus rien une fois désactivé, et s'en souvient", async () => {
    const storage = memoryStorage();
    const session = Session.newGame("off");
    const { db, docs } = fakeDb();
    const journal = new Journal(session, storage);
    journal.setEnabled(false);
    journal.attach(db);
    await journal.flush();
    expect(docs.size).toBe(0);
    expect(new Journal(session, storage).status).toBe("desactive");
  });
});
