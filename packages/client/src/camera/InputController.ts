/**
 * Souris et clavier sur la carte. Traduit les gestes en commandes pour la simulation
 * ou en mouvements de caméra. N'applique aucune règle de jeu elle-même.
 *
 * - Clic gauche : action de l'outil actif (glisser pour tracer routes et champs).
 * - Outil Inspecter : glisser pour déplacer la carte, clic pour sélectionner.
 * - Clic droit ou molette enfoncée : déplacer la carte. Clic droit court : revenir à Inspecter.
 * - Molette : zoom vers le curseur. Double-clic : zoomer sur le fief visé.
 */
import type { Command } from "@jeu/sim-fief";
import type { Game } from "../game/Game";
import type { CameraController } from "./CameraController";

export const TILE = 32;

type Drag =
  | { mode: "pan"; lastX: number; lastY: number; moved: number; button: number }
  | { mode: "paint"; lastTx: number; lastTy: number; failures: number; lastReason: string | null; done: number };

export class InputController {
  private drag: Drag | null = null;
  private lastClick = { time: 0, x: 0, y: 0 };

  constructor(
    private readonly el: HTMLElement,
    private readonly game: Game,
    private readonly camera: CameraController,
    private readonly onFocusFief: (wx: number, wy: number) => void,
  ) {
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", () => {
      if (!this.drag) this.game.hover = null;
    });
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private tileAt(sx: number, sy: number): { tx: number; ty: number } {
    const w = this.camera.screenToWorld(sx, sy);
    return { tx: Math.floor(w.x / TILE), ty: Math.floor(w.y / TILE) };
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.camera.zoomAt(p.x, p.y, Math.exp(-delta * 0.0015));
  };

  private onDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.el.setPointerCapture(e.pointerId);
    const tool = this.game.tool;
    if (e.button === 1 || e.button === 2 || tool.kind === "inspect" || this.game.viewLevel === "monde") {
      this.drag = { mode: "pan", lastX: p.x, lastY: p.y, moved: 0, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    const { tx, ty } = this.tileAt(p.x, p.y);
    if (tool.kind === "build") {
      const a = this.game.buildAnchor(tool.building, tx, ty);
      this.game.command({ type: "build", building: tool.building, x: a.x, y: a.y });
      return;
    }
    this.drag = { mode: "paint", lastTx: tx, lastTy: ty, failures: 0, lastReason: null, done: 0 };
    this.paintTile(tx, ty);
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const { tx, ty } = this.tileAt(p.x, p.y);
    this.game.hover = { x: tx, y: ty };
    const d = this.drag;
    if (!d) return;
    if (d.mode === "pan") {
      const dx = p.x - d.lastX;
      const dy = p.y - d.lastY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.lastX = p.x;
      d.lastY = p.y;
      this.camera.pan(dx, dy);
      return;
    }
    if (tx === d.lastTx && ty === d.lastTy) return;
    for (const [x, y] of line(d.lastTx, d.lastTy, tx, ty).slice(1)) this.paintTile(x, y);
    d.lastTx = tx;
    d.lastTy = ty;
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (!d) return;
    const p = this.local(e);
    if (d.mode === "pan" && d.moved < 5) {
      if (d.button === 2) {
        this.game.setTool({ kind: "inspect" });
        return;
      }
      this.click(p.x, p.y);
    }
    if (d.mode === "paint" && d.failures > 0 && d.done === 0 && d.lastReason) {
      this.game.toast(d.lastReason, "error");
    }
  };

  private click(sx: number, sy: number): void {
    const now = performance.now();
    const isDouble = now - this.lastClick.time < 350 && Math.abs(sx - this.lastClick.x) + Math.abs(sy - this.lastClick.y) < 8;
    this.lastClick = { time: now, x: sx, y: sy };
    const w = this.camera.screenToWorld(sx, sy);
    if (isDouble || this.game.viewLevel === "monde") {
      this.onFocusFief(w.x, w.y);
      return;
    }
    const { tx, ty } = this.tileAt(sx, sy);
    const b = this.game.session.sim.buildingAt(tx, ty);
    this.game.select(b ? b.id : null);
  }

  private paintTile(x: number, y: number): void {
    const d = this.drag;
    if (!d || d.mode !== "paint") return;
    const tool = this.game.tool;
    let cmd: Command | null = null;
    if (tool.kind === "road") cmd = { type: "road", x, y };
    else if (tool.kind === "field") cmd = { type: "field", x, y };
    else if (tool.kind === "demolish") cmd = { type: "demolish", x, y };
    if (!cmd) return;
    // Pendant un tracé, on ignore en silence les cases déjà faites ; on ne signale qu'un vrai blocage.
    const r = this.game.command(cmd, true);
    if (r.ok) d.done += 1;
    else {
      d.failures += 1;
      d.lastReason = r.reason ?? null;
      if (r.reason?.startsWith("Pas assez")) this.game.toast(r.reason, "error");
    }
  }
}

/**
 * Cases traversées par un segment (Bresenham), extrémités comprises.
 * Variante « 4-connexe » : jamais de pas en diagonale, pour que les routes tracées
 * en biais restent continues (une route ne se relie que par les côtés).
 */
export function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    const stepX = e2 >= dy;
    const stepY = e2 <= dx;
    if (stepX) {
      err += dy;
      x += sx;
    }
    if (stepX && stepY) out.push([x, y]);
    if (stepY) {
      err += dx;
      y += sy;
    }
  }
  return out;
}
