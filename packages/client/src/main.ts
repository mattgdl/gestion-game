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
import { Hud, type HudActions } from "./ui/Hud";
import { parseSave, serializeSave, type SaveGame } from "./save/save";
import { readSlot, writeSlot } from "./save/storage";
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

  const attachSession = (s: Session): void => {
    s.onEvents((events) => {
      if (events.some((e) => e.type === "barrier")) {
        if (writeSlot("auto", s.toSave())) hud.refreshSaves();
        journal.onBarrier();
      }
    });
  };

  const actions: HudActions = {
    newGame(seedText) {
      const s = Session.newGame(seedText);
      attachSession(s);
      game.replaceSession(s);
      journal.setSession(s);
      focusHome(true);
      game.toast(`Nouvelle partie : graine « ${seedText} ».`);
    },
    load(save: SaveGame) {
      const s = Session.fromSave(save);
      attachSession(s);
      game.replaceSession(s);
      journal.setSession(s);
      focusHome(true);
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
    writeSlot("auto", game.session.toSave());
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
  (window as unknown as { __jeu: unknown }).__jeu = { game, camera, TILE, actions, journal };

  window.claude?.hot?.snapshot?.(() => ({
    save: serializeSave(game.session.toSave()),
    camera: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom },
  }));
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
