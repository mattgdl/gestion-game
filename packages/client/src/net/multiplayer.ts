/**
 * Partie à plusieurs côté interface (J7) : crée, rejoint ou reprend une salle, branche la
 * partie de ce joueur dessus, sauvegarde son domaine à chaque bilan, et prévient l'interface
 * (salon, attente au bilan, messagerie, classement final).
 */
import type { Session } from "../game/Session";
import { Session as SessionClass } from "../game/Session";
import { readHostRoom, readMulti, roomToken, writeHostRoom, writeMulti } from "../save/storage";
import { PeerNetwork } from "./peer";
import type { RankingRow, RoomPlayer, RoomSettings } from "./protocol";
import { ClientRoom, HostRoom, type HostSave, type RoomLike } from "./room";
import type { Network } from "./transport";

export interface MultiUi {
  /** La partie de ce joueur commence (ou reprend) : elle remplace la partie affichée. */
  play(session: Session, resumed: boolean): void;
  lobby(players: RoomPlayer[], settings: RoomSettings, code: string, isHost: boolean, started: boolean): void;
  waiting(text: string | null): void;
  said(from: string, text: string): void;
  ended(ranking: RankingRow[]): void;
  error(text: string): void;
}

export interface ChatLine {
  from: string;
  text: string;
  at: number;
}

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newRoomCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}

export class Multiplayer {
  room: RoomLike | null = null;
  code: string | null = null;
  chat: ChatLine[] = [];
  private session: Session | null = null;

  constructor(
    private readonly ui: MultiUi,
    private readonly network: Network = new PeerNetwork(),
  ) {}

  get isHost(): boolean {
    return this.room?.isHost ?? false;
  }

  /** Nom affiché d'un joueur : son pseudo. */
  pseudoOf(id: string): string {
    return this.room?.players.find((p) => p.id === id)?.pseudo ?? id;
  }

  async create(pseudo: string, settings: RoomSettings): Promise<void> {
    const code = newRoomCode();
    const room = new HostRoom(code, settings, pseudo, roomToken(code));
    await room.open(this.network);
    this.bind(room, code);
    this.ui.lobby(room.players, settings, code, true, false);
  }

  async resume(code: string): Promise<void> {
    const save = readHostRoom<HostSave>(code);
    if (!save) throw new Error("Aucune salle à reprendre sous ce code.");
    const room = HostRoom.resume(save);
    await room.open(this.network);
    this.bind(room, code);
    this.ui.lobby(room.players, save.settings, code, true, true);
  }

  async join(code: string, pseudo: string): Promise<void> {
    const clean = code.trim().toUpperCase();
    const room = new ClientRoom(clean, pseudo, roomToken(clean));
    this.bind(room, clean);
    await room.open(this.network);
  }

  /** L'hôte lance la partie (ou la relance après une reprise). */
  launch(): void {
    if (!(this.room instanceof HostRoom)) return;
    if (this.room.started) this.room.restart();
    else this.room.start();
  }

  /** L'hôte termine la partie et affiche le classement. */
  endNow(): void {
    if (this.room instanceof HostRoom) this.room.endNow();
  }

  setControl(speed: 1 | 2 | 3, paused: boolean): void {
    if (this.room instanceof HostRoom) this.room.setControl(speed, paused);
  }

  say(text: string): void {
    this.room?.say(text);
  }

  /** Ce joueur a perdu son domaine. */
  retire(): void {
    this.room?.retire();
  }

  /** Sauvegarde du domaine (et de la salle, chez l'hôte) après un bilan. */
  saveNow(): void {
    if (!this.room || !this.code || !this.session || !this.room.playerId) return;
    writeMulti(this.code, this.room.playerId, this.session.toSave());
    if (this.room instanceof HostRoom && this.room.world) writeHostRoom(this.code, this.room.toSave());
  }

  leave(): void {
    if (this.room instanceof HostRoom && this.room.world && this.code) writeHostRoom(this.code, this.room.toSave());
    this.room?.close();
    this.room = null;
    this.code = null;
    this.session = null;
    this.chat = [];
    this.ui.waiting(null);
  }

  private bind(room: RoomLike, code: string): void {
    this.room = room;
    this.code = code;
    this.chat = [];
    room.on({
      lobby: (players, settings) => this.ui.lobby(players, settings, code, room.isHost, room instanceof HostRoom ? room.started : false),
      start: ({ playerId, world, gameId, resume }) => {
        // Départ reçu deux fois (reconnexion) alors que la partie tourne déjà ici : on garde la partie en cours.
        if (this.session && this.session.sim.state.ownerId === playerId && !(room instanceof HostRoom)) return;
        let session: Session;
        const saved = resume ? readMulti(code, playerId) : null;
        if (saved) session = SessionClass.multiFromSave(room, saved);
        else session = SessionClass.multi(room, playerId, world, gameId);
        this.session = session;
        this.ui.play(session, resume && saved !== null);
        if (resume && !saved && world.year > 1) this.ui.error("Pas de sauvegarde de cette partie sur cet appareil : votre domaine repart de zéro.");
      },
      result: () => {
        this.ui.waiting(null);
      },
      waiting: (_year, missing, deadline) => {
        const others = missing.filter((id) => id !== room.playerId).map((id) => this.pseudoOf(id));
        if (others.length === 0) {
          this.ui.waiting(null);
          return;
        }
        const secs = deadline !== null ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null;
        this.ui.waiting(`En attente de ${others.join(", ")}${secs !== null ? ` (au plus ${secs} s)` : ""}`);
      },
      said: (from, text, at) => {
        this.chat.push({ from, text, at });
        if (this.chat.length > 100) this.chat.shift();
        this.ui.said(from, text);
      },
      end: (ranking) => {
        // La partie est finie : le temps s'arrête pour tout le monde.
        if (this.session) this.session.stopped = true;
        this.ui.ended(ranking);
      },
      refused: (reason) => this.ui.error(reason),
      closed: () => {
        if (this.room === room) this.ui.error("La liaison avec la salle est coupée.");
      },
    });
  }
}
