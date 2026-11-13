/**
 * Scène principale : dessine la carte continue (sol, routes, champs, bâtiments,
 * frontières, vue Monde) et fait avancer la session à chaque image.
 * Lit l'état de la simulation, ne le modifie jamais.
 */
import Phaser from "phaser";
import { generateFiefTerrain } from "@jeu/shared";
import { BUILDINGS } from "@jeu/sim-fief";
import { lordById } from "@jeu/sim-monde";
import { CameraController } from "../camera/CameraController";
import { TILE } from "../camera/InputController";
import type { Game } from "../game/Game";
import { paintGround, type GroundSource } from "../render/ground";
import { FIELD_COLORS, ROAD_COLORS, hex, lordColor, shade, toInt } from "../render/palette";

interface GroundEntry {
  fiefId: string;
  key: string;
  owned: boolean;
  source: GroundSource;
  texture: Phaser.Textures.CanvasTexture;
  image: Phaser.GameObjects.Image;
}

export class MapScene extends Phaser.Scene {
  private grounds: GroundEntry[] = [];
  private generation = 0;
  private structures!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private drawn = { mapVersion: -1, season: -1, level: "", selection: -2, zoomBucket: -1, session: -1 };
  private sessionCounter = 0;
  private boundSession: unknown = null;

  constructor(
    private readonly game_: Game,
    private readonly camera: CameraController,
    private readonly onFrame: (deltaMs: number) => void,
  ) {
    super({ key: "carte" });
  }

  create(): void {
    this.structures = this.add.graphics().setDepth(10);
    this.overlay = this.add.graphics().setDepth(20);
    this.ghost = this.add.graphics().setDepth(30);
    this.scale.on("resize", (size: Phaser.Structs.Size) => this.camera.setView(size.width, size.height));
    this.camera.setView(this.scale.width, this.scale.height);
    this.rebuildWorld();
  }

  /** (Re)crée le sol de tous les fiefs. Appelé au démarrage et à chaque changement de partie. */
  rebuildWorld(): void {
    for (const g of this.grounds) {
      g.image.destroy();
      this.textures.remove(g.key);
    }
    this.grounds = [];
    this.generation += 1;
    const session = this.game_.session;
    const world = session.world;
    const S = world.dims.fiefSize;
    this.camera.setWorld(world.dims.cols * S * TILE, world.dims.rows * S * TILE);

    for (const meta of world.fiefs) {
      const ownedTiles = session.sim.state.fiefs[meta.id];
      const terrain = ownedTiles ?? { ...generateFiefTerrain(world.dims, meta.col, meta.row) };
      const source: GroundSource = {
        size: S,
        originX: meta.col * S,
        originY: meta.row * S,
        terrain: terrain.terrain,
        fertility: terrain.fertility,
      };
      const key = `sol-${this.generation}-${meta.id}`;
      const texture = this.textures.createCanvas(key, S, S);
      if (!texture) continue;
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      const image = this.add
        .image(source.originX * TILE, source.originY * TILE, key)
        .setOrigin(0, 0)
        .setScale(TILE)
        .setDepth(0);
      this.grounds.push({ fiefId: meta.id, key, owned: Boolean(ownedTiles), source, texture, image });
    }
    this.boundSession = session;
    this.sessionCounter += 1;
    this.drawn = { mapVersion: -1, season: -1, level: "", selection: -2, zoomBucket: -1, session: this.sessionCounter };
  }

  private paintGrounds(onlyOwned: boolean, season: number): void {
    const sim = this.game_.session.sim;
    for (const g of this.grounds) {
      if (onlyOwned && !g.owned) continue;
      if (g.owned) {
        const tiles = sim.state.fiefs[g.fiefId];
        if (tiles) {
          g.source.terrain = tiles.terrain;
          g.source.fertility = tiles.fertility;
        }
      }
      const ctx = g.texture.getContext();
      const image = ctx.createImageData(g.source.size, g.source.size);
      paintGround(image, g.source, season);
      ctx.putImageData(image, 0, 0);
      g.texture.refresh();
      // Le rafraîchissement peut remettre le lissage par défaut : on force des tuiles nettes.
      g.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }

  override update(_time: number, delta: number): void {
    const game = this.game_;
    if (game.session !== this.boundSession) this.rebuildWorld();
    this.onFrame(delta);

    this.camera.update(delta);
    const cam = this.cameras.main;
    cam.setZoom(this.camera.zoom);
    cam.centerOn(this.camera.cx, this.camera.cy);
    game.setViewLevel(this.camera.level);

    const sim = game.session.sim;
    const season = sim.date.seasonIndex;
    const level = game.viewLevel;
    const zoomBucket = Math.round(Math.log2(this.camera.zoom) * 8);

    if (season !== this.drawn.season) {
      this.paintGrounds(false, season);
    } else if (sim.mapVersion !== this.drawn.mapVersion) {
      this.paintGrounds(true, season);
    }
    if (
      sim.mapVersion !== this.drawn.mapVersion ||
      season !== this.drawn.season ||
      level !== this.drawn.level ||
      game.selectedBuildingId !== this.drawn.selection
    ) {
      this.drawStructures(season, level);
    }
    if (level !== this.drawn.level || zoomBucket !== this.drawn.zoomBucket || sim.mapVersion !== this.drawn.mapVersion) {
      this.drawOverlay(level);
    }
    this.drawn.mapVersion = sim.mapVersion;
    this.drawn.season = season;
    this.drawn.level = level;
    this.drawn.selection = game.selectedBuildingId ?? -1;
    this.drawn.zoomBucket = zoomBucket;

    this.drawGhost();
  }

  // ------------------------------------------------------------ structures

  private drawStructures(season: number, level: string): void {
    const g = this.structures;
    const sim = this.game_.session.sim;
    g.clear();
    for (const l of this.labels) l.destroy();
    this.labels = [];

    const W = sim.state.worldWidth;
    const connected = sim.connectedRoads();
    const roadSet = new Set(sim.state.roads);
    const road = ROAD_COLORS[season] ?? ROAD_COLORS[0]!;
    const roadEdge = shade(road, 0.72);
    for (const k of sim.state.roads) {
      const x = (k % W) * TILE;
      const y = Math.floor(k / W) * TILE;
      const linked = connected.has(k);
      g.fillStyle(toInt(linked ? road : shade(road, 0.82)), linked ? 1 : 0.85);
      g.fillRect(x, y, TILE, TILE);
      g.fillStyle(toInt(roadEdge), 1);
      const edge = 3;
      if (!roadSet.has(k - W)) g.fillRect(x, y, TILE, edge);
      if (!roadSet.has(k + W)) g.fillRect(x, y + TILE - edge, TILE, edge);
      if (!roadSet.has(k - 1) || k % W === 0) g.fillRect(x, y, edge, TILE);
      if (!roadSet.has(k + 1) || (k + 1) % W === 0) g.fillRect(x + TILE - edge, y, edge, TILE);
    }

    const field = FIELD_COLORS[season] ?? FIELD_COLORS[0]!;
    for (const k of sim.state.fields) {
      const x = (k % W) * TILE;
      const y = Math.floor(k / W) * TILE;
      g.fillStyle(toInt(field), 1);
      g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      if (level === "proche") {
        g.fillStyle(toInt(shade(field, 0.8)), 1);
        for (let i = 1; i <= 3; i++) g.fillRect(x + 3, y + i * 8 - 1, TILE - 6, 2);
      }
    }

    for (const b of sim.state.buildings) {
      const def = BUILDINGS[b.type];
      if (!def) continue;
      const [w, h] = def.taille;
      const x = b.x * TILE;
      const y = b.y * TILE;
      const pw = w * TILE;
      const ph = h * TILE;
      const base = hex(def.couleur);
      if (level === "proche") {
        // Placeholder « vue 3/4 » : toit en haut, façade en bas, ombre portée.
        g.fillStyle(0x000000, 0.22);
        g.fillRect(x + 4, y + 5, pw - 2, ph - 2);
        const roofH = Math.round(ph * 0.55);
        g.fillStyle(toInt(shade(base, 0.78)), 1);
        g.fillRect(x + 2, y + 2, pw - 4, roofH);
        g.fillStyle(toInt(shade(base, 0.9)), 1);
        g.fillRect(x + 2, y + 2, pw - 4, 4);
        g.fillStyle(toInt(shade(base, 1.12)), 1);
        g.fillRect(x + 2, y + 2 + roofH, pw - 4, ph - 4 - roofH);
        g.fillStyle(toInt(shade(base, 0.45)), 1);
        const doorW = Math.max(6, Math.round(pw * 0.14));
        g.fillRect(x + pw / 2 - doorW / 2, y + ph - 2 - Math.round((ph - roofH) * 0.6), doorW, Math.round((ph - roofH) * 0.6) - 2);
        g.lineStyle(2, toInt(shade(base, 0.4)), 1);
        g.strokeRect(x + 2, y + 2, pw - 4, ph - 4);
      } else {
        g.fillStyle(toInt(base), 1);
        g.fillRect(x + 1, y + 1, pw - 2, ph - 2);
      }

      if (b.id === this.game_.selectedBuildingId) {
        g.lineStyle(4, 0xe8c15a, 1);
        g.strokeRect(x - 2, y - 2, pw + 4, ph + 4);
      }
      if (!sim.isConnected(b.id)) {
        const cx = x + pw - 6;
        const cy = y + 6;
        g.fillStyle(0xb3261e, 1);
        g.fillCircle(cx, cy, 8);
        g.fillStyle(0xffffff, 1);
        g.fillRect(cx - 1.5, cy - 5, 3, 6);
        g.fillRect(cx - 1.5, cy + 2.5, 3, 3);
      }
      if (level === "proche" && w * h >= 4) {
        const label = this.add
          .text(x + pw / 2, y + ph * 0.3, def.nom, {
            fontFamily: '"Alegreya Sans", "Segoe UI", system-ui, sans-serif',
            fontSize: "13px",
            fontStyle: "bold",
            color: "#fff8ea",
            stroke: "#2a2118",
            strokeThickness: 3,
          })
          .setOrigin(0.5, 0.5)
          .setResolution(2)
          .setDepth(15);
        this.labels.push(label);
      }
    }
  }

  // ------------------------------------------------------------ frontières, grille, vue Monde

  private drawOverlay(level: string): void {
    const g = this.overlay;
    const session = this.game_.session;
    const world = session.world;
    const S = world.dims.fiefSize * TILE;
    const zoom = this.camera.zoom;
    g.clear();

    for (const meta of world.fiefs) {
      const x = meta.col * S;
      const y = meta.row * S;
      const owned = Boolean(session.sim.state.fiefs[meta.id]);
      const color = Phaser.Display.Color.HexStringToColor(lordColor(lordById(world, meta.ownerId)?.colorIndex)).color;
      if (level === "monde") {
        g.fillStyle(color, 0.68);
        g.fillRect(x, y, S, S);
      } else if (!owned) {
        g.fillStyle(0x10131a, level === "proche" ? 0.22 : 0.3);
        g.fillRect(x, y, S, S);
      }
      if (level !== "proche") {
        g.lineStyle(Math.max(3, 5 / zoom), color, 0.95);
        g.strokeRect(x + 2.5 / zoom, y + 2.5 / zoom, S - 5 / zoom, S - 5 / zoom);
      }
    }

    // Frontières : trait sombre d'épaisseur constante à l'écran.
    g.lineStyle(Math.max(2, 2 / zoom), 0x1b1712, 0.75);
    for (const meta of world.fiefs) g.strokeRect(meta.col * S, meta.row * S, S, S);

    if (level === "proche") {
      g.lineStyle(1, 0x000000, 0.08);
      for (const f of Object.values(session.sim.state.fiefs)) {
        const x0 = f.originX * TILE;
        const y0 = f.originY * TILE;
        for (let i = 1; i < f.size; i++) {
          g.lineBetween(x0 + i * TILE, y0, x0 + i * TILE, y0 + f.size * TILE);
          g.lineBetween(x0, y0 + i * TILE, x0 + f.size * TILE, y0 + i * TILE);
        }
      }
    }
  }

  // ------------------------------------------------------------ aperçu de l'outil

  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const game = this.game_;
    const tool = game.tool;
    const hover = game.hover;
    const sim = game.session.sim;
    if (game.viewLevel === "monde") return;

    // Zones cultivables autour des fermes quand on peint des champs ou pose une ferme.
    const showFarmZones = tool.kind === "field" || (tool.kind === "build" && tool.building === "ferme");
    if (showFarmZones) {
      const r = BUILDINGS.ferme?.rayonChamps ?? 4;
      for (const b of sim.state.buildings) {
        if (b.type !== "ferme") continue;
        g.fillStyle(0xe8d27a, 0.12);
        g.fillRect((b.x - r) * TILE, (b.y - r) * TILE, (2 + 2 * r) * TILE, (2 + 2 * r) * TILE);
        g.lineStyle(2, 0xe8d27a, 0.6);
        g.strokeRect((b.x - r) * TILE, (b.y - r) * TILE, (2 + 2 * r) * TILE, (2 + 2 * r) * TILE);
      }
    }

    if (!hover || tool.kind === "inspect") return;
    let rect = { x: hover.x, y: hover.y, w: 1, h: 1 };
    let ok = false;
    if (tool.kind === "build") {
      const a = game.buildAnchor(tool.building, hover.x, hover.y);
      const def = BUILDINGS[tool.building];
      const [w, h] = def ? def.taille : [1, 1];
      rect = { x: a.x, y: a.y, w, h };
      ok = sim.check({ type: "build", building: tool.building, x: a.x, y: a.y }).ok;
      if (tool.building === "ferme") {
        const r = def?.rayonChamps ?? 4;
        g.lineStyle(2, 0xe8d27a, 0.8);
        g.strokeRect((a.x - r) * TILE, (a.y - r) * TILE, (w + 2 * r) * TILE, (h + 2 * r) * TILE);
      }
    } else if (tool.kind === "road") {
      ok = sim.check({ type: "road", x: hover.x, y: hover.y }).ok;
    } else if (tool.kind === "field") {
      ok = sim.check({ type: "field", x: hover.x, y: hover.y }).ok;
    } else if (tool.kind === "demolish") {
      const b = sim.buildingAt(hover.x, hover.y);
      if (b) {
        const def = BUILDINGS[b.type];
        const [w, h] = def ? def.taille : [1, 1];
        rect = { x: b.x, y: b.y, w, h };
      }
      ok = sim.check({ type: "demolish", x: hover.x, y: hover.y }).ok;
      g.fillStyle(0xb3261e, ok ? 0.45 : 0.15);
      g.fillRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
      g.lineStyle(2, 0xb3261e, 0.9);
      g.strokeRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
      return;
    }
    const color = ok ? 0x3f9d5a : 0xb3261e;
    g.fillStyle(color, 0.42);
    g.fillRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
    g.lineStyle(2, color, 0.95);
    g.strokeRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
  }
}
