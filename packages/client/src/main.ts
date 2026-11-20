/**
 * Point d'entrée du client : crée la partie, l'affichage Phaser, l'interface et les contrôles.
 */
import Phaser from "phaser";
import "./style.css";
import { TILE, InputController } from "./camera/InputController";
import { CameraController } from "./camera/CameraController";
import { Game } from "./game/Game";
import { Session } from "./game/Session";
import { MapScene } from "./scenes/MapScene";
import { Hud, pauseAtBilan, type HudActions } from "./ui/Hud";
import { parseSave, serializeSave, type SaveGame } from "./save/save";
import { readSlot, writeSlot } from "./save/storage";
import { Multiplayer } from "./net/multiplayer";
import { EVENTS } from "@jeu/sim-fief";
import { Journal, type JournalDb } from "./telemetry/journal";

interface HotData {
  save?: string;
  camera?: { cx: number; cy: number; zoom: number };
}

interface HotApi {
  snapshot?: (fn: () => HotData) => void;
  ready?: (start: (data: HotData) => void) => void;
  data?: HotData;
}

interface UserApi {
  id(): Promise<string | null>;
}

declare global {
  interface Window {
    /** Fourni par claude.ai quand le jeu est ouvert comme artefact publié. */
    claude?: { hot?: HotApi; use?: (name: string) => Promise<unknown> };
  }
}

/** Branche le journal de partie sur la base de données de l'artefact, si la page en a une. */
async function connectJournal(journal: Journal): Promise<void> {
  const claude = window.claude;
  if (!claude?.use) {
    journal.attach(null);
    return;
  }
  try {
    const db = (await claude.use("db")) as JournalDb | null;
    let userId: string | null = null;
    try {
      const user = (await claude.use("user")) as UserApi | null;
      userId = user ? await user.id() : null;
    } catch {
      userId = null;
    }
    journal.attach(db, userId);
  } catch {
    journal.attach(null);
  }
}

function initialSeed(): string {
  const words = ["blé", "chêne", "orge", "seigle", "houblon", "tilleul"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

/** Dernière partie sauvegardée dans ce navigateur (automatique ou manuelle, la plus récente). */
function latestSave(): SaveGame | null {
  const saves = [readSlot("auto"), readSlot("manuelle")].filter((s): s is SaveGame => s !== null);
  saves.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return saves[0] ?? null;
}

const AUTOSAVE_MS = 30_000;

function start(data: HotData = {}): void {
  let session: Session;
  let resumed: SaveGame | null = null;
  try {
    if (data.save) session = Session.fromSave(parseSave(data.save));
    else {
      resumed = latestSave();
      // Une partie terminée ne se reprend pas : on en commence une nouvelle.
      if (resumed?.domain.gameOver) resumed = null;
      session = resumed ? Session.fromSave(resumed) : Session.newGame(initialSeed());
    }
  } catch {
    resumed = null;
    session = Session.newGame(initialSeed());
  }

  const game = new Game(session);
  const journal = new Journal(session);
  game.commandObserver = (cmd, result, quiet) => journal.onCommand(cmd, result, quiet);
  const dims = session.world.dims;
  const camera = new CameraController(dims.cols * dims.fiefSize * TILE, dims.rows * dims.fiefSize * TILE);
  camera.setView(window.innerWidth, window.innerHeight);

  const fiefCenter = (col: number, row: number) => {
    const S = game.session.world.dims.fiefSize * TILE;
    return { x: (col + 0.5) * S, y: (row + 0.5) * S };
  };

  /**
   * Cadre une zone du monde (centre wx, wy ; taille w × h) dans la partie de l'écran
   * que l'interface ne couvre pas. Sans taille : garde le zoom donné.
   */
  const frame = (wx: number, wy: number, w: number | null, h: number | null, zoom: number, instant = false): void => {
    const ins = hud.insets();
    const availW = Math.max(100, camera.viewW - ins.left - ins.right);
    const availH = Math.max(100, camera.viewH - ins.top - ins.bottom);
    const z = w !== null && h !== null ? Math.min(availW / w, availH / h) * 0.94 : zoom;
    const cx = wx + (ins.right - ins.left) / 2 / z;
    const cy = wy + (ins.bottom - ins.top) / 2 / z;
    if (instant) camera.jumpTo(cx, cy, z);
    else camera.flyTo(cx, cy, z);
  };

  const focusHome = (instant = false): void => {
    const manor = game.session.sim.state.buildings.find((b) => b.type === "manoir");
    if (!manor) return;
    frame((manor.x + 1.5) * TILE, (manor.y + 1.5) * TILE, null, null, 1, instant);
  };

  const focusFief = (fiefId: string): void => {
    const meta = game.session.world.fiefs.find((f) => f.id === fiefId);
    if (!meta) return;
    const c = fiefCenter(meta.col, meta.row);
    const S = game.session.world.dims.fiefSize * TILE;
    frame(c.x, c.y, S, S, 1);
  };

  /** Sauvegarde automatique : l'emplacement « auto » en solo, celui de la salle à plusieurs. */
  const saveAuto = (s: Session): boolean => {
    if (s.room) {
      if (s === game.session) multi.saveNow();
      return false;
    }
    return writeSlot("auto", s.toSave());
  };

  const attachSession = (s: Session): void => {
    // À plusieurs, le résultat du bilan arrive après coup : on rafraîchit à son arrivée.
    s.onBarrierDone(() => {
      if (!s.room) return;
      hud.refreshWorld();
      saveAuto(s);
    });
    s.onEvents((events) => {
      if (events.some((e) => e.type === "barrier")) {
        hud.refreshWorld();
        if (saveAuto(s)) hud.refreshSaves();
        journal.onBarrier();
        if (pauseAtBilan()) {
          const wasPaused = s.paused;
          s.paused = true;
          hud.showBilan(s.sim.date.year, structuredClone(s.sim.state.yearStats), () => {
            s.paused = wasPaused;
          });
        }
      }
      for (const ev of events) {
        if (ev.type === "succession") {
          if (saveAuto(s)) hud.refreshSaves();
          const wasPaused = s.paused;
          s.paused = true;
          hud.showSuccession(ev.deadId, ev.heirId, () => {
            s.paused = wasPaused;
          });
        } else if (ev.type === "fiefAcquired") {
          hud.refreshWorld();
          if (saveAuto(s)) hud.refreshSaves();
          game.toast(`${ev.name} rejoint votre domaine.`);
        } else if (ev.type === "epidemic") {
          game.toast("Une maladie se déclare dans le domaine !");
        } else if (ev.type === "domainEvent") {
          game.toast(ev.choice ? `${ev.title} : décision à prendre (panneau Domaine).` : ev.text);
          hud.renderAffairs(true);
        } else if (ev.type === "tradeNews" && s.room) {
          game.toast(ev.text);
        } else if (ev.type === "offerRefused") {
          game.toast(ev.reason);
        } else if (ev.type === "title") {
          game.toast(`Nouveau titre : ${s.sim.titleName()} !`);
          hud.refreshWorld();
        } else if (ev.type === "familyMatter") {
          const m = s.sim.dynasty.member(ev.memberId);
          if (m) game.toast(`Affaire de famille : ${m.name} a ${s.sim.dynasty.ageOf(m)} ans. Décidez de son avenir (panneau Lignée).`);
        }
      }
      if (events.some((e) => e.type === "gameOver")) {
        saveAuto(s);
        void journal.flush();
        if (s.room) {
          // Domaine perdu dans une partie à plusieurs : la salle n'attend plus ce joueur.
          multi.retire();
          game.toast("Votre lignée est hors jeu : vous pouvez suivre la partie jusqu'au classement.", "error");
        } else hud.showGameOver(() => actions.newGame(initialSeed()));
      }
    });
  };

  /** Remplace la partie affichée (taille du monde comprise : 7 × 7 à plusieurs). */
  const play = (s: Session): void => {
    attachSession(s);
    game.replaceSession(s);
    journal.setSession(s);
    const d = s.world.dims;
    camera.setWorld(d.cols * d.fiefSize * TILE, d.rows * d.fiefSize * TILE);
    focusHome(true);
  };

  const multi = new Multiplayer({
    play(s, resumedGame) {
      hud.closeLobby();
      play(s);
      hud.refreshSaves();
      game.toast(resumedGame ? `Partie reprise : an ${s.sim.date.year}.` : "La partie commence ! Vos voisins sont aussi des joueurs : panneau Voisins.");
    },
    lobby(players, settings, code, isHost, started) {
      // En cours de partie, les arrivées et départs se voient dans le panneau Voisins.
      if (game.session.room && !hud.lobbyOpen()) {
        hud.renderMulti(true);
        return;
      }
      hud.showLobby(players, settings, code, isHost, started);
    },
    waiting(text) {
      hud.setWaiting(text);
    },
    said(from, text) {
      hud.renderMulti();
      if (from !== multi.room?.playerId) game.toast(`${multi.pseudoOf(from)} : ${text}`);
    },
    ended(ranking) {
      multi.saveNow();
      hud.showRanking(ranking, multi.room?.playerId ?? null);
    },
    error(text) {
      hud.closeLobby();
      game.toast(text, "error");
      hud.refreshSaves();
    },
  });

  const actions: HudActions = {
    multi,
    backToSolo() {
      const save = latestSave();
      const s = save && !save.domain.gameOver ? Session.fromSave(save) : Session.newGame(initialSeed());
      play(s);
      game.toast("Retour à votre partie seule.");
    },
    newGame(seedText) {
      if (multi.room) multi.leave();
      play(Session.newGame(seedText));
      game.toast(`Nouvelle partie : graine « ${seedText} ».`);
    },
    load(save: SaveGame) {
      if (multi.room) multi.leave();
      play(Session.fromSave(save));
      game.toast(`Partie chargée : an ${save.world.year}.`);
    },
    focusFief,
    focusHome: () => focusHome(false),
    worldView: () => frame(camera.worldW / 2, camera.worldH / 2, camera.worldW, camera.worldH, 1),
  };

  const hud = new Hud(document.getElementById("hud") as HTMLElement, game, camera, actions, journal);
  attachSession(session);
  void connectJournal(journal);
  let sinceAutosave = 0;
  const autosave = () => {
    sinceAutosave = 0;
    saveAuto(game.session);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    autosave();
    void journal.flush();
  });
  if (resumed) game.toast(`Partie reprise : an ${resumed.world.year}, graine « ${resumed.world.seedText} ».`);

  const scene = new MapScene(game, camera, (delta) => {
    game.session.update(delta);
    journal.onFrame(delta);
    sinceAutosave += delta;
    if (sinceAutosave >= AUTOSAVE_MS) autosave();
    hud.update();
  });

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0d1016",
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    disableContextMenu: true,
    banner: false,
    render: { antialias: true },
    scene: [scene],
  });

  new InputController(document.getElementById("game") as HTMLElement, game, camera, (wx, wy) => {
    const S = game.session.world.dims.fiefSize * TILE;
    const meta = game.session.world.fiefs.find((f) => f.col === Math.floor(wx / S) && f.row === Math.floor(wy / S));
    if (meta) focusFief(meta.id);
  });

  if (data.camera) camera.jumpTo(data.camera.cx, data.camera.cy, data.camera.zoom);
  else focusHome(true);

  // Accès de débogage depuis la console du navigateur (window.__jeu.game, window.__jeu.camera).
  (window as unknown as { __jeu: unknown }).__jeu = { game, camera, TILE, actions, journal, multi, EVENTS };

  window.claude?.hot?.snapshot?.(() => ({
    save: serializeSave(game.session.toSave()),
    camera: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom },
  }));
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
