/**
 * État de l'interface autour d'une partie : outil actif, tuile survolée, sélection,
 * messages. Fait le lien entre l'affichage (Phaser), l'interface (DOM) et la Session.
 */
import { BUILDINGS, type CheckResult, type Command } from "@jeu/sim-fief";

/** Observateur des commandes (journal de partie). `quiet` = refus non montré au joueur (tracé de route…). */
export type CommandObserver = (cmd: Command, result: CheckResult, quiet: boolean) => void;
import { Session } from "./Session";

export type Tool =
  | { kind: "inspect" }
  | { kind: "road" }
  | { kind: "field" }
  | { kind: "demolish" }
  | { kind: "build"; building: string };

export type ViewLevel = "proche" | "moyenne" | "monde";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

type Listener = () => void;
type GameEvent = "session" | "tool" | "selection" | "toast" | "view" | "routes";

export class Game {
  session: Session;
  tool: Tool = { kind: "inspect" };
  hover: { x: number; y: number } | null = null;
  selectedBuildingId: number | null = null;
  viewLevel: ViewLevel = "proche";
  /** Affiche les itinéraires de tous les porteurs en route (touche L). */
  showRoutes = false;
  toasts: Toast[] = [];
  commandObserver: CommandObserver | null = null;
  private nextToast = 1;
  private listeners = new Map<string, Set<Listener>>();

  constructor(session: Session) {
    this.session = session;
  }

  on(event: GameEvent, fn: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }

  emit(event: GameEvent): void {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  replaceSession(session: Session): void {
    this.session = session;
    this.selectedBuildingId = null;
    this.tool = { kind: "inspect" };
    this.emit("session");
    this.emit("tool");
    this.emit("selection");
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.emit("tool");
  }

  toggleRoutes(): void {
    this.showRoutes = !this.showRoutes;
    this.emit("routes");
  }

  setViewLevel(level: ViewLevel): void {
    if (level === this.viewLevel) return;
    this.viewLevel = level;
    this.emit("view");
  }

  select(buildingId: number | null): void {
    this.selectedBuildingId = buildingId;
    this.emit("selection");
  }

  toast(text: string, tone: Toast["tone"] = "info"): void {
    const t: Toast = { id: this.nextToast++, text, tone };
    this.toasts.push(t);
    if (this.toasts.length > 3) this.toasts.shift();
    this.emit("toast");
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.emit("toast");
    }, 3200);
  }

  /** Commande envoyée à la simulation, avec retour visuel en cas de refus. */
  command(cmd: Command, quiet = false): CheckResult {
    const result = this.session.command(cmd);
    this.commandObserver?.(cmd, result, quiet);
    if (!result.ok && !quiet && result.reason) this.toast(result.reason, "error");
    if (result.ok) this.emit("selection");
    return result;
  }

  /** Emplacement du bâtiment quand le curseur est sur (tx, ty) : le curseur est au centre. */
  buildAnchor(building: string, tx: number, ty: number): { x: number; y: number } {
    const def = BUILDINGS[building];
    const [w, h] = def ? def.taille : [1, 1];
    return { x: tx - Math.floor((w - 1) / 2), y: ty - Math.floor((h - 1) / 2) };
  }
}
