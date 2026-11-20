import { describe, expect, it } from "vitest";
import { Session } from "../src/game/Session";
import { ClientRoom, HostRoom, BARRIER_TIMEOUT_MS, type Clock } from "../src/net/room";
import { LoopbackNetwork } from "../src/net/transport";

/** Horloge manuelle : le délai d'attente d'un absent se déclenche quand on avance le temps. */
class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  advance(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t);
    this.timers = this.timers.filter((x) => x.at > this.t);
    for (const d of due) d.fn();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(n: number) {
  const net = new LoopbackNetwork();
  const clock = new FakeClock();
  const host = new HostRoom("ABCD", { seed: "multi-test", years: 3, speed: 3 }, "Alice", "tok-1", clock);
  await host.open(net);
  const clients: ClientRoom[] = [];
  for (let i = 2; i <= n; i++) {
    const c = new ClientRoom("ABCD", `Joueur ${i}`, `tok-${i}`);
    await c.open(net);
    clients.push(c);
  }
  await flush();
  const sessions = new Map<string, Session>();
  const ended: unknown[] = [];
  const attach = (room: HostRoom | ClientRoom) =>
    room.on({
      start: ({ playerId, world, gameId }) => {
        const s = Session.multi(room, playerId, world, gameId);
        // Des domaines sans joueur : on les nourrit pour qu'ils tiennent jusqu'au bout du test.
        for (const f of s.sim.state.families) f.food = 1e9;
        sessions.set(playerId, s);
      },
      end: (ranking) => ended.push(ranking),
    });
  attach(host);
  for (const c of clients) attach(c);
  return { net, clock, host, clients, sessions, ended };
}

/** Fait avancer chaque session (100 ms par pas) ; `skip` : joueurs qui ne jouent pas (absents). */
async function play(sessions: Map<string, Session>, steps: number, skip: Set<string> = new Set()) {
  for (let i = 0; i < steps; i++) {
    for (const [id, s] of sessions) if (!skip.has(id)) s.update(100);
    if (i % 50 === 0) await flush();
  }
  await flush();
}

describe("salle multijoueur (réseau en mémoire)", () => {
  it("8 joueurs : salon, lancement, trois bilans communs, classement final", async () => {
    const { host, clients, sessions, ended } = await setup(8);
    expect(host.players).toHaveLength(8);
    expect(clients[6]!.players).toHaveLength(8);
    host.start();
    await flush();
    expect(sessions.size).toBe(8);
    for (const [id, s] of sessions) {
      expect(s.sim.state.ownerId).toBe(id);
      expect(s.world.fiefs.filter((f) => f.ownerId === id)).toHaveLength(1);
    }
    // Vitesse ×3 : un an = 600 pas de 100 ms.
    await play(sessions, 1900);
    expect(host.world!.year).toBe(4);
    for (const s of sessions.values()) {
      expect(s.sim.date.year).toBeGreaterThanOrEqual(3);
      expect(s.world.year).toBe(host.world!.year);
    }
    expect(ended).toHaveLength(8);
    const ranking = ended[0] as { id: string }[];
    expect(ranking.map((r) => r.id).sort()).toEqual(["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"]);
  }, 120_000);

  it("un joueur absent n'arrête pas la partie : après 60 s, le bilan se fait sans lui ; il le reçoit en revenant", async () => {
    const { host, clock, sessions } = await setup(3);
    host.start();
    await flush();
    // j3 ne joue pas : les autres arrivent au bilan et attendent.
    await play(sessions, 700, new Set(["j3"]));
    expect(host.world!.year).toBe(1);
    expect(sessions.get("j1")!.waiting).toBe(true);
    clock.advance(BARRIER_TIMEOUT_MS + 1);
    await play(sessions, 10, new Set(["j3"]));
    expect(host.world!.year).toBe(2);
    expect(sessions.get("j1")!.waiting).toBe(false);
    // j3 revient : il arrive au bilan de l'an 1 et reçoit le résultat déjà rendu, sans attendre.
    await play(sessions, 700, new Set(["j1", "j2"]));
    expect(sessions.get("j3")!.sim.date.year).toBeGreaterThanOrEqual(1);
    expect(sessions.get("j3")!.waiting).toBe(false);
  }, 120_000);

  it("messagerie relayée à tous ; vitesse et pause réglées par l'hôte ; la salle refuse un 9e joueur", async () => {
    const { net, host, clients } = await setup(8);
    const heard: string[] = [];
    clients[3]!.on({ said: (from, text) => heard.push(`${from}:${text}`) });
    clients[0]!.say("Bonjour à tous");
    host.say("Bienvenue");
    await flush();
    await flush();
    expect(heard.sort()).toEqual(["j1:Bienvenue", "j2:Bonjour à tous"]);
    host.start();
    await flush();
    host.setControl(2, true);
    await flush();
    expect(clients[5]!.speed).toBe(2);
    expect(clients[5]!.paused).toBe(true);
    const ninth = new ClientRoom("ABCD", "Intrus", "tok-9");
    const refused: string[] = [];
    ninth.on({ refused: (r) => refused.push(r) });
    await ninth.open(net);
    await flush();
    await flush();
    expect(refused[0]).toMatch(/commencé|pleine/);
  }, 60_000);

  it("un joueur qui a perdu son domaine n'est plus attendu aux bilans", async () => {
    const { host, clients, sessions } = await setup(3);
    host.start();
    await flush();
    clients[1]!.retire();
    await flush();
    await play(sessions, 650, new Set(["j3"]));
    expect(host.world!.year).toBe(2);
  }, 60_000);

  it("reconnexion : même jeton, même place ; la salle se sauvegarde et se reprend", async () => {
    const { net, host, clients } = await setup(2);
    host.start();
    await flush();
    clients[0]!.close();
    await flush();
    expect(host.players.find((p) => p.id === "j2")!.online).toBe(false);
    const back = new ClientRoom("ABCD", "Joueur 2", "tok-2");
    const starts: string[] = [];
    back.on({ start: ({ playerId, resume }) => starts.push(`${playerId}:${resume}`) });
    await back.open(net);
    await flush();
    await flush();
    expect(starts).toEqual(["j2:true"]);
    const save = JSON.parse(JSON.stringify(host.toSave()));
    const again = HostRoom.resume(save);
    expect(again.players.map((p) => p.id)).toEqual(["j1", "j2"]);
    expect(again.world!.year).toBe(host.world!.year);
  }, 60_000);
});
