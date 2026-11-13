/**
 * Caméra : zoom, déplacement, et niveau de vue (proche / moyenne / monde).
 * Toutes les conversions écran ↔ monde passent par ici.
 */
import type { ViewLevel } from "../game/Game";

export const LEVEL_PROCHE = 0.75;
export const LEVEL_MONDE = 0.3;

interface Flight {
  fromX: number;
  fromY: number;
  fromZoom: number;
  toX: number;
  toY: number;
  toZoom: number;
  elapsed: number;
  duration: number;
}

export class CameraController {
  zoom = 1;
  cx = 0;
  cy = 0;
  viewW = 800;
  viewH = 600;
  maxZoom = 2.5;
  /** Touches de déplacement enfoncées (clavier). */
  readonly keys = new Set<string>();
  private flight: Flight | null = null;

  constructor(
    public worldW: number,
    public worldH: number,
  ) {
    this.cx = worldW / 2;
    this.cy = worldH / 2;
  }

  setWorld(worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
    this.clamp();
  }

  setView(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.zoom = Math.max(this.zoom, this.minZoom);
    this.clamp();
  }

  /** Zoom auquel toute la carte tient à l'écran. */
  get fitZoom(): number {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
  }

  get minZoom(): number {
    return Math.min(this.fitZoom * 0.5, 0.25);
  }

  get level(): ViewLevel {
    if (this.zoom >= LEVEL_PROCHE) return "proche";
    if (this.zoom >= Math.min(LEVEL_MONDE, this.fitZoom * 1.15)) return "moyenne";
    return "monde";
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.cx + (sx - this.viewW / 2) / this.zoom, y: this.cy + (sy - this.viewH / 2) / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.cx) * this.zoom + this.viewW / 2, y: (wy - this.cy) * this.zoom + this.viewH / 2 };
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.flight = null;
    const anchor = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.cx = anchor.x - (sx - this.viewW / 2) / this.zoom;
    this.cy = anchor.y - (sy - this.viewH / 2) / this.zoom;
    this.clamp();
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.flight = null;
    this.cx -= dxScreen / this.zoom;
    this.cy -= dyScreen / this.zoom;
    this.clamp();
  }

  flyTo(x: number, y: number, zoom: number, duration = 450): void {
    const toZoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.flight = { fromX: this.cx, fromY: this.cy, fromZoom: this.zoom, toX: x, toY: y, toZoom, elapsed: 0, duration };
  }

  jumpTo(x: number, y: number, zoom: number): void {
    this.flight = null;
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.cx = x;
    this.cy = y;
    this.clamp();
  }

  update(deltaMs: number): void {
    if (this.flight) {
      const f = this.flight;
      f.elapsed += deltaMs;
      const t = Math.min(1, f.elapsed / f.duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // Zoom interpolé en échelle logarithmique : le mouvement paraît régulier.
      this.zoom = f.fromZoom * Math.pow(f.toZoom / f.fromZoom, e);
      this.cx = f.fromX + (f.toX - f.fromX) * e;
      this.cy = f.fromY + (f.toY - f.fromY) * e;
      if (t >= 1) this.flight = null;
    }
    if (this.keys.size > 0) {
      const speed = (900 * deltaMs) / 1000;
      let dx = 0;
      let dy = 0;
      if (this.keys.has("left")) dx += speed;
      if (this.keys.has("right")) dx -= speed;
      if (this.keys.has("up")) dy += speed;
      if (this.keys.has("down")) dy -= speed;
      if (dx !== 0 || dy !== 0) this.pan(dx, dy);
    }
    this.clamp();
  }

  /** Garde le centre de la vue au-dessus de la carte : on ne peut pas la perdre de vue. */
  private clamp(): void {
    this.cx = Math.min(this.worldW, Math.max(0, this.cx));
    this.cy = Math.min(this.worldH, Math.max(0, this.cy));
  }
}
