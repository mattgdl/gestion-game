/**
 * Salle multijoueur (J7).
 *
 * - L'hôte (le créateur) tient la salle : il accueille les joueurs, crée le monde au lancement,
 *   reçoit les bilans, résout la barrière quand tout le monde est prêt (ou après le délai
 *   d'attente d'un absent), renvoie le résultat et le monde à chacun. Il règle la vitesse
 *   commune et la pause, relaie la messagerie, et annonce la fin de partie avec le classement.
 * - Chaque joueur (l'hôte compris) fait tourner son propre domaine ; il ne voit du Monde que
 *   l'instantané envoyé à chaque bilan.
 *
 * Aucun Phaser ici, et l'horloge est injectable : la salle se teste sans réseau ni navigateur.
 */
import type { BarrierInput, BarrierResult } from "@jeu/shared";
import { createWorld, resolveBarrier, type WorldState } from "@jeu/sim-monde";
import { PROTOCOL_VERSION, type NetMessage, type RankingRow, type RoomPlayer, type RoomSettings } from "./protocol";
import type { HostEndpoint, Link, Network } from "./transport";

export const MAX_PLAYERS = 8;
/** Attente maximale d'un absent au bilan, en millisecondes. */
export const BARRIER_TIMEOUT_MS = 60_000;
/** Reconnexion d'un joueur dont la liaison tombe : nombre d'essais et délai entre deux. */
const RECONNECT_TRIES = 5;
export const RECONNECT_DELAY_MS = 2_000;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Ce que l'interface écoute d'une salle (hôte ou joueur). */
export interface RoomEvents {
  lobby?: (players: RoomPlayer[], settings: RoomSettings) => void;
  start?: (info: { playerId: string; world: WorldState; settings: RoomSettings; gameId: string; resume: boolean }) => void;
  result?: (year: number, result: BarrierResult, world: WorldState) => void;
  control?: (speed: 1 | 2 | 3, paused: boolean) => void;
  waiting?: (year: number, missing: string[], deadline: number | null) => void;
  said?: (from: string, text: string, at: number) => void;
  end?: (ranking: RankingRow[]) => void;
  refused?: (reason: string) => void;
  closed?: () => void;
}

/** Ce qu'il faut garder pour reprendre une salle (chez l'hôte). */
export interface HostSave {
  code: string;
  settings: RoomSettings;
  gameId: string;
  players: { id: string; pseudo: string; token: string }[];
  world: WorldState;
  /** Dernier résultat de barrière, pour un joueur en retard. */
  last: { year: number; result: BarrierResult } | null;
  speed: 1 | 2 | 3;
  ended: RankingRow[] | null;
}

/** Interface commune à l'hôte et au joueur, vue par la partie en cours. */
export interface RoomLike {
  readonly isHost: boolean;
  playerId: string | null;
  world: WorldState | null;
  players: RoomPlayer[];
  speed: 1 | 2 | 3;
  paused: boolean;
  /** Réglages de la salle (connus du joueur dès le salon). */
  readonly settings: RoomSettings | null;
  submitBarrier(input: BarrierInput): Promise<BarrierResult>;
  say(text: string): void;
  /** Ce joueur a perdu son domaine : on ne l'attend plus aux bilans. */
  retire(): void;
  on(events: RoomEvents): void;
  close(): void;
}

class Emitter {
  protected listeners: RoomEvents[] = [];
  on(events: RoomEvents): void {
    this.listeners.push(events);
  }
  protected emit<K extends keyof RoomEvents>(key: K, ...args: Parameters<NonNullable<RoomEvents[K]>>): void {
    for (const l of this.listeners) (l[key] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }
}

// ------------------------------------------------------------------ hôte

interface Seat {
  id: string;
  pseudo: string;
  token: string;
  link: Link | null;
  /** Domaine perdu : le joueur regarde, on ne l'attend plus. */
  out?: boolean;
}

export class HostRoom extends Emitter implements RoomLike {
  readonly isHost = true;
  playerId: string | null = "j1";
  world: WorldState | null = null;
  speed: 1 | 2 | 3;
  paused = false;
  gameId: string;
  ended: RankingRow[] | null = null;
  private seats: Seat[] = [];
  private endpoint: HostEndpoint | null = null;
  private inputs = new Map<string, BarrierInput>();
  private waitingYear: number | null = null;
  private deadline: number | null = null;
  private timer: unknown = null;
  private last: { year: number; result: BarrierResult } | null = null;
  /** Promesse du bilan de l'hôte lui-même. */
  private ownResolve: ((r: BarrierResult) => void) | null = null;

  constructor(
    readonly code: string,
    public settings: RoomSettings,
    hostPseudo: string,
    hostToken: string,
    private readonly clock: Clock = realClock,
    gameId = `m-${code}`,
  ) {
    super();
    this.speed = settings.speed;
    this.gameId = gameId;
    this.seats.push({ id: "j1", pseudo: hostPseudo, token: hostToken, link: null });
  }

  /** Reprend une salle sauvegardée (les joueurs se reconnectent avec leur jeton). */
  static resume(save: HostSave, clock: Clock = realClock): HostRoom {
    const host = save.players[0]!;
    const room = new HostRoom(save.code, save.settings, host.pseudo, host.token, clock, save.gameId);
    room.seats = save.players.map((p) => ({ ...p, link: null }));
    room.world = save.world;
    room.last = save.last;
    room.speed = save.speed;
    room.ended = save.ended;
    room.paused = true;
    return room;
  }

  get started(): boolean {
    return this.world !== null;
  }

  get players(): RoomPlayer[] {
    return this.seats.map((s) => ({ id: s.id, pseudo: s.pseudo, online: s.id === "j1" || s.link !== null }));
  }

  async open(network: Network): Promise<void> {
    this.endpoint = await network.host(this.code);
    this.endpoint.onConnection((link) => this.accept(link));
  }

  toSave(): HostSave {
    return {
      code: this.code,
      settings: this.settings,
      gameId: this.gameId,
      players: this.seats.map(({ id, pseudo, token }) => ({ id, pseudo, token })),
      world: structuredClone(this.world as WorldState),
      last: this.last,
      speed: this.speed,
      ended: this.ended,
    };
  }

  private accept(link: Link): void {
    let seat: Seat | null = null;
    link.onMessage((msg) => {
      if (msg.t === "hello") {
        if (msg.version !== PROTOCOL_VERSION) {
          link.send({ t: "refused", reason: "Versions du jeu différentes : rechargez la page." });
          return;
        }
        // Reconnexion : même jeton, même place.
        seat = this.seats.find((s) => s.token === msg.token) ?? null;
        if (!seat) {
          if (this.started) {
            link.send({ t: "refused", reason: "La partie a déjà commencé." });
            return;
          }
          if (this.seats.length >= MAX_PLAYERS) {
            link.send({ t: "refused", reason: `La salle est pleine (${MAX_PLAYERS} joueurs).` });
            return;
          }
          seat = { id: `j${this.seats.length + 1}`, pseudo: msg.pseudo.slice(0, 24) || "Seigneur", token: msg.token, link: null };
          this.seats.push(seat);
        }
        if (seat.link && seat.link !== link) seat.link.close();
        seat.link = link;
        this.broadcastLobby();
        if (this.started) {
          link.send({ t: "start", playerId: seat.id, world: this.world!, settings: this.settings, gameId: this.gameId, resume: true });
          link.send({ t: "control", speed: this.speed, paused: this.paused });
          if (this.ended) link.send({ t: "end", ranking: this.ended });
        }
        return;
      }
      if (!seat) return;
      if (msg.t === "barrier") this.receive(seat.id, msg.year, msg.input);
      if (msg.t === "chat") this.relayChat(seat.id, msg.text);
      if (msg.t === "out") this.retireSeat(seat.id);
    });
    link.onClose(() => {
      if (seat && seat.link === link) {
        seat.link = null;
        this.broadcastLobby();
        this.checkBarrier();
      }
    });
  }

  private send(msg: NetMessage): void {
    for (const s of this.seats) s.link?.send(msg);
  }

  private broadcastLobby(): void {
    const msg: NetMessage = { t: "lobby", players: this.players, settings: this.settings, started: this.started };
    this.send(msg);
    this.emit("lobby", this.players, this.settings);
  }

  /** Lance la partie : le monde est créé pour les joueurs présents. */
  start(): void {
    if (this.started) return;
    this.world = createWorld(
      this.settings.seed,
      undefined,
      this.seats.map((s) => ({ id: s.id, pseudo: s.pseudo })),
    );
    for (const s of this.seats) {
      s.link?.send({ t: "start", playerId: s.id, world: this.world, settings: this.settings, gameId: this.gameId, resume: false });
      s.link?.send({ t: "control", speed: this.speed, paused: this.paused });
    }
    this.broadcastLobby();
    this.emit("start", { playerId: "j1", world: this.world, settings: this.settings, gameId: this.gameId, resume: false });
    this.emit("control", this.speed, this.paused);
  }

  /** Reprise : chacun recharge son domaine sauvegardé ; la partie repart en pause. */
  restart(): void {
    if (!this.world) return;
    for (const s of this.seats) s.link?.send({ t: "start", playerId: s.id, world: this.world, settings: this.settings, gameId: this.gameId, resume: true });
    this.emit("start", { playerId: "j1", world: this.world, settings: this.settings, gameId: this.gameId, resume: true });
    this.setControl(this.speed, true);
  }

  setControl(speed: 1 | 2 | 3, paused: boolean): void {
    this.speed = speed;
    this.paused = paused;
    this.send({ t: "control", speed, paused });
    this.emit("control", speed, paused);
  }

  say(text: string): void {
    this.relayChat("j1", text);
  }

  private relayChat(from: string, text: string): void {
    const clean = text.trim().slice(0, 300);
    if (!clean) return;
    const at = this.clock.now();
    this.send({ t: "said", from, text: clean, at });
    this.emit("said", from, clean, at);
  }

  submitBarrier(input: BarrierInput): Promise<BarrierResult> {
    const year = this.world?.year ?? 1;
    return new Promise((resolve) => {
      this.ownResolve = resolve;
      this.receive("j1", year, input);
    });
  }

  /** Un bilan arrive. Une année déjà résolue : on renvoie son résultat (le joueur était en retard). */
  private receive(playerId: string, year: number, input: BarrierInput): void {
    if (!this.world) return;
    if (input.ownerId !== playerId) input = { ...input, ownerId: playerId };
    if (year < this.world.year) {
      if (this.last && this.last.year === year) this.deliver(playerId, year, this.last.result);
      return;
    }
    if (year > this.world.year) return;
    this.inputs.set(playerId, input);
    if (this.waitingYear !== year) {
      this.waitingYear = year;
      this.deadline = this.clock.now() + BARRIER_TIMEOUT_MS;
      if (this.timer !== null) this.clock.clearTimeout(this.timer);
      this.timer = this.clock.setTimeout(() => this.resolve(), BARRIER_TIMEOUT_MS);
    }
    this.checkBarrier();
  }

  /** Joueurs attendus au bilan : connectés et encore en jeu. */
  private expected(): string[] {
    return this.seats.filter((s) => (s.id === "j1" || s.link !== null) && !s.out).map((s) => s.id);
  }

  private retireSeat(id: string): void {
    const seat = this.seats.find((s) => s.id === id);
    if (!seat || seat.out) return;
    seat.out = true;
    this.relayChat(id, "(a perdu son domaine)");
    this.checkBarrier();
  }

  /** Le domaine de l'hôte est perdu : il reste l'hôte, mais on ne l'attend plus. */
  retire(): void {
    this.retireSeat("j1");
  }

  private checkBarrier(): void {
    if (!this.world || this.waitingYear === null) return;
    const missing = this.expected().filter((id) => !this.inputs.has(id));
    if (missing.length === 0) this.resolve();
    else {
      this.send({ t: "waiting", year: this.waitingYear, missing, deadline: this.deadline });
      this.emit("waiting", this.waitingYear, missing, this.deadline);
    }
  }

  /** Résout l'année avec les bilans reçus (les absents n'y participent pas). */
  private resolve(): void {
    if (!this.world || this.waitingYear === null) return;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    const year = this.waitingYear;
    const inputs = [...this.inputs.values()];
    this.inputs.clear();
    this.waitingYear = null;
    this.deadline = null;
    const result = resolveBarrier(this.world, inputs);
    this.last = { year, result };
    for (const s of this.seats) {
      if (s.id === "j1") continue;
      // Un joueur qui n'a pas remis son bilan le recevra quand il arrivera à la barrière.
      if (inputs.some((i) => i.ownerId === s.id)) s.link?.send({ t: "result", year, result, world: this.world });
    }
    this.emit("result", year, result, this.world);
    if (inputs.some((i) => i.ownerId === "j1")) this.deliverOwn(result);
    // Durée 0 : partie sans limite, que l'hôte termine quand il veut.
    if (this.settings.years > 0 && year >= this.settings.years) this.finish();
  }

  private deliver(playerId: string, year: number, result: BarrierResult): void {
    if (playerId === "j1") {
      this.deliverOwn(result);
      return;
    }
    this.seats.find((s) => s.id === playerId)?.link?.send({ t: "result", year, result, world: this.world! });
  }

  private deliverOwn(result: BarrierResult): void {
    const r = this.ownResolve;
    this.ownResolve = null;
    r?.(result);
  }

  /** L'hôte termine la partie maintenant (classement sur le dernier bilan). */
  endNow(): void {
    if (!this.ended) this.finish();
  }

  /** Fin de partie : classement au prestige (résumés du dernier bilan). */
  private finish(): void {
    if (!this.world) return;
    const ranking: RankingRow[] = this.seats
      .map((s) => {
        const sum = this.world!.lastSummaries[s.id];
        const lord = this.world!.lords.find((l) => l.id === s.id);
        return {
          id: s.id,
          pseudo: s.pseudo,
          house: lord?.name ?? "",
          prestige: sum?.prestige ?? 0,
          fiefs: this.world!.fiefs.filter((f) => f.ownerId === s.id).length,
          population: sum?.population ?? 0,
        };
      })
      .sort((a, b) => b.prestige - a.prestige || b.fiefs - a.fiefs);
    this.ended = ranking;
    this.send({ t: "end", ranking });
    this.emit("end", ranking);
  }

  close(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    for (const s of this.seats) s.link?.close();
    this.endpoint?.close();
    this.emit("closed");
  }
}

// ------------------------------------------------------------------ joueur

export class ClientRoom extends Emitter implements RoomLike {
  readonly isHost = false;
  playerId: string | null = null;
  world: WorldState | null = null;
  players: RoomPlayer[] = [];
  settings: RoomSettings | null = null;
  speed: 1 | 2 | 3 = 1;
  paused = false;
  private link: Link | null = null;
  private pending: { year: number; resolve: (r: BarrierResult) => void } | null = null;

  constructor(
    readonly code: string,
    readonly pseudo: string,
    readonly token: string,
    private readonly clock: Clock = realClock,
  ) {
    super();
  }

  private network: Network | null = null;
  private closing = false;

  async open(network: Network): Promise<void> {
    this.network = network;
    this.attach(await network.join(this.code));
  }

  private attach(link: Link): void {
    this.link = link;
    link.onMessage((msg) => {
      if (this.link === link) this.handle(msg);
    });
    link.onClose(() => {
      if (this.link !== link) return;
      this.link = null;
      if (!this.closing) void this.reconnect();
    });
    this.hello();
  }

  /** Liaison perdue : on retente quelques fois (le jeton garde la place), puis on prévient. */
  private async reconnect(): Promise<void> {
    for (let attempt = 0; attempt < RECONNECT_TRIES && !this.closing; attempt++) {
      await new Promise<void>((r) => this.clock.setTimeout(r, RECONNECT_DELAY_MS));
      if (this.closing || !this.network) return;
      try {
        this.attach(await this.network.join(this.code));
        // Un bilan en attente repart : l'hôte renvoie le résultat s'il est déjà tranché.
        if (this.pending && this.lastInput) this.link?.send({ t: "barrier", year: this.pending.year, input: this.lastInput });
        return;
      } catch {
        // Nouvel essai.
      }
    }
    if (!this.closing) this.emit("closed");
  }

  private lastHello = 0;

  private hello(): void {
    this.lastHello = Date.now();
    this.link?.send({ t: "hello", version: PROTOCOL_VERSION, pseudo: this.pseudo, token: this.token });
  }

  private handle(msg: NetMessage): void {
    switch (msg.t) {
      case "lobby":
        this.players = msg.players;
        this.settings = msg.settings;
        this.emit("lobby", msg.players, msg.settings);
        // Partie lancée sans que le départ soit arrivé ici : on se représente pour le recevoir.
        if (msg.started && this.playerId === null && Date.now() - this.lastHello > 3000) this.hello();
        return;
      case "start":
        this.playerId = msg.playerId;
        this.world = msg.world;
        this.settings = msg.settings;
        this.emit("start", { playerId: msg.playerId, world: msg.world, settings: msg.settings, gameId: msg.gameId, resume: msg.resume });
        return;
      case "result": {
        this.world = msg.world;
        this.emit("result", msg.year, msg.result, msg.world);
        const p = this.pending;
        if (p && p.year === msg.year) {
          this.pending = null;
          p.resolve(msg.result);
        }
        return;
      }
      case "control":
        this.speed = msg.speed;
        this.paused = msg.paused;
        this.emit("control", msg.speed, msg.paused);
        return;
      case "waiting":
        this.emit("waiting", msg.year, msg.missing, msg.deadline);
        return;
      case "said":
        this.emit("said", msg.from, msg.text, msg.at);
        return;
      case "end":
        this.emit("end", msg.ranking);
        return;
      case "refused":
        this.emit("refused", msg.reason);
        return;
      default:
        return;
    }
  }

  private lastInput: BarrierInput | null = null;

  submitBarrier(input: BarrierInput): Promise<BarrierResult> {
    const year = this.world?.year ?? 1;
    this.lastInput = input;
    return new Promise((resolve) => {
      this.pending = { year, resolve };
      this.link?.send({ t: "barrier", year, input });
    });
  }

  say(text: string): void {
    this.link?.send({ t: "chat", text });
  }

  retire(): void {
    this.link?.send({ t: "out" });
  }

  close(): void {
    this.closing = true;
    this.link?.close();
  }
}
