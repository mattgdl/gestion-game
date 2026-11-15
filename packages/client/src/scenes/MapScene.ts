/**
 * Scène principale : dessine la carte continue (sol, routes, champs, bâtiments,
 * frontières, vue Monde) et fait avancer la session à chaque image.
 * Lit l'état de la simulation, ne le modifie jamais.
 */
import Phaser from "phaser";
import { generateFiefTerrain } from "@jeu/shared";
import { BUILDINGS, GOOD_IDS, type Building, type DomainSim } from "@jeu/sim-fief";
import { lordById } from "@jeu/sim-monde";
import { CameraController } from "../camera/CameraController";
import { TILE } from "../camera/InputController";
import type { Game } from "../game/Game";
import { paintGround, type GroundSource } from "../render/ground";
import { GOOD_COLORS, ROAD_COLORS, fieldColor, hex, lordColor, shade, toInt } from "../render/palette";

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
  private fieldsGfx!: Phaser.GameObjects.Graphics;
  private structures!: Phaser.GameObjects.Graphics;
  private routesGfx!: Phaser.GameObjects.Graphics;
  private badges!: Phaser.GameObjects.Graphics;
  private porters!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private drawn = { mapVersion: -1, season: -1, level: "", selection: -2, zoomBucket: -1, session: -1 };
  private drawnFields = { key: "" };
  private badgeTimer = 0;
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
    this.fieldsGfx = this.add.graphics().setDepth(9);
    this.structures = this.add.graphics().setDepth(10);
    this.routesGfx = this.add.graphics().setDepth(11);
    this.badges = this.add.graphics().setDepth(12);
    this.porters = this.add.graphics().setDepth(14);
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
    this.drawnFields = { key: "" };
    this.badgeTimer = 0;
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
    // Champs : redessinés quand les cultures changent ou que la saison avance (blés qui mûrissent).
    const phase = Math.floor(sim.date.seasonProgress * 6);
    const fieldsKey = `${sim.mapVersion}|${sim.cropVersion}|${season}|${phase}|${level}`;
    if (fieldsKey !== this.drawnFields.key) {
      this.drawFields(sim, season, sim.date.seasonProgress, level);
      this.drawnFields.key = fieldsKey;
    }
    // Badges d'état et marchandises en attente : quatre fois par seconde suffit.
    this.badgeTimer -= delta;
    if (this.badgeTimer <= 0 || sim.mapVersion !== this.drawn.mapVersion || level !== this.drawn.level) {
      this.drawBadges(sim, level);
      this.badgeTimer = 250;
    }

    this.drawn.mapVersion = sim.mapVersion;
    this.drawn.season = season;
    this.drawn.level = level;
    this.drawn.selection = game.selectedBuildingId ?? -1;
    this.drawn.zoomBucket = zoomBucket;

    this.drawRoutesAndPorters(sim, level);
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

  // ------------------------------------------------------------ champs

  private drawFields(sim: DomainSim, season: number, progress: number, level: string): void {
    const g = this.fieldsGfx;
    g.clear();
    const W = sim.state.worldWidth;
    for (const k of sim.state.fields) {
      const x = (k % W) * TILE;
      const y = Math.floor(k / W) * TILE;
      const farmId = sim.economy.farmOfField(k);
      const worked = farmId !== null && sim.isConnected(farmId);
      const crop = sim.state.crops[String(k)];
      const color = fieldColor(crop, season, progress, worked);
      g.fillStyle(toInt(color), worked ? 1 : 0.75);
      g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      if (level !== "proche") continue;
      // Sillons, ou gerbes une fois moissonné.
      g.fillStyle(toInt(shade(color, crop === "recolte" ? 0.7 : 0.82)), 1);
      if (crop === "recolte" && season !== 3) {
        g.fillRect(x + 8, y + 9, 5, 12);
        g.fillRect(x + 19, y + 13, 5, 12);
      } else {
        for (let i = 1; i <= 3; i++) g.fillRect(x + 3, y + i * 8 - 1, TILE - 6, 2);
      }
      if (!worked) {
        // Hachure : champ que personne ne travaille.
        g.lineStyle(2, 0x3a2f25, 0.55);
        g.lineBetween(x + 4, y + TILE - 4, x + TILE - 4, y + 4);
      }
    }
  }

  // ------------------------------------------------------------ badges d'état

  private drawBadges(sim: DomainSim, level: string): void {
    const g = this.badges;
    g.clear();
    if (level === "monde") return;
    for (const b of sim.state.buildings) {
      const def = BUILDINGS[b.type];
      if (!def) continue;
      const [w, h] = def.taille;
      const x = b.x * TILE;
      const y = b.y * TILE;
      const pw = w * TILE;
      const ph = h * TILE;
      const cx = x + pw - 6;
      const cy = y + 6;
      if (!sim.isConnected(b.id)) {
        g.fillStyle(0xb3261e, 1);
        g.fillCircle(cx, cy, 8);
        g.fillStyle(0xffffff, 1);
        g.fillRect(cx - 1.5, cy - 5, 3, 6);
        g.fillRect(cx - 1.5, cy + 2.5, 3, 3);
        continue;
      }
      const status = sim.economy.status(b.id);
      if (status.blocked) {
        // Pastille orange « pause » : bloqué par manque de place ou de porteurs.
        g.fillStyle(0xd9822b, 1);
        g.fillCircle(cx, cy, 8);
        g.fillStyle(0xffffff, 1);
        g.fillRect(cx - 4, cy - 4, 3, 8);
        g.fillRect(cx + 1, cy - 4, 3, 8);
      }
      // Marchandises en attente : une caisse par charge de porteur, le long du bas du bâtiment.
      if (level === "proche" && !def.stockage && def.transport) {
        for (const good of GOOD_IDS) {
          const n = b.stock[good] ?? 0;
          if (n <= 0) continue;
          const crates = Math.min(6, Math.ceil(n / def.transport.charge));
          const color = Phaser.Display.Color.HexStringToColor(GOOD_COLORS[good]).color;
          for (let i = 0; i < crates; i++) {
            const bx = x + 4 + i * 9;
            const by = y + ph + 2;
            g.fillStyle(0x2a2118, 1);
            g.fillRect(bx - 1, by - 1, 9, 9);
            g.fillStyle(color, 1);
            g.fillRect(bx, by, 7, 7);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ porteurs et itinéraires

  private center(b: Building): { x: number; y: number } {
    const def = BUILDINGS[b.type];
    const [w, h] = def ? def.taille : [1, 1];
    return { x: (b.x + w / 2) * TILE, y: (b.y + h / 2) * TILE };
  }

  private pathPoints(sim: DomainSim, path: number[]): { x: number; y: number }[] {
    const W = sim.state.worldWidth;
    return path.map((k) => ({ x: ((k % W) + 0.5) * TILE, y: (Math.floor(k / W) + 0.5) * TILE }));
  }

  private strokePath(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]): void {
    if (pts.length < 2) return;
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.strokePath();
  }

  private drawRoutesAndPorters(sim: DomainSim, level: string): void {
    const routes = this.routesGfx;
    const porters = this.porters;
    routes.clear();
    porters.clear();
    if (level === "monde") return;
    const game = this.game_;

    // Itinéraire du bâtiment sélectionné vers la réserve que ses porteurs utiliseront.
    const selected = game.selectedBuildingId !== null ? sim.building(game.selectedBuildingId) : undefined;
    if (selected && BUILDINGS[selected.type]?.transport && sim.isConnected(selected.id)) {
      const list = sim.economy.routesFrom(selected.id);
      const route =
        list.find((r) => {
          const s = sim.building(r.storageId);
          return s !== undefined && sim.economy.freeSpace(s) > 0;
        }) ?? list[0];
      const dest = route ? sim.building(route.storageId) : undefined;
      if (route && dest) {
        const pts = [this.center(selected), ...this.pathPoints(sim, route.path), this.center(dest)];
        routes.lineStyle(10, 0xe8c15a, 0.35);
        this.strokePath(routes, pts);
        routes.lineStyle(3, 0xe8c15a, 0.95);
        this.strokePath(routes, pts);
      }
    }

    const tick = sim.state.tick + game.session.tickFraction;
    for (const d of sim.state.deliveries) {
      const from = sim.building(d.fromId);
      const to = sim.building(d.toId);
      const pts = [
        from ? this.center(from) : this.pathPoints(sim, [d.path[0] ?? 0])[0]!,
        ...this.pathPoints(sim, d.path),
        to ? this.center(to) : this.pathPoints(sim, [d.path[d.path.length - 1] ?? 0])[0]!,
      ];
      if (game.showRoutes && tick < d.arriveTick) {
        routes.lineStyle(3, Phaser.Display.Color.HexStringToColor(GOOD_COLORS[d.good]).color, 0.6);
        this.strokePath(routes, pts);
      }
      const outbound = tick < d.arriveTick;
      const t = outbound
        ? (tick - d.departTick) / Math.max(1, d.arriveTick - d.departTick)
        : (tick - d.arriveTick) / Math.max(1, d.returnTick - d.arriveTick);
      const along = outbound ? pts : [...pts].reverse();
      const pos = pointAlong(along, Math.min(1, Math.max(0, t)));
      const loaded = outbound || d.status === "rapporte";
      if (loaded) {
        porters.fillStyle(0x1d160e, 1);
        porters.fillCircle(pos.x, pos.y, 8);
        porters.fillStyle(Phaser.Display.Color.HexStringToColor(GOOD_COLORS[d.good]).color, 1);
        porters.fillCircle(pos.x, pos.y, 6);
      } else {
        porters.fillStyle(0xf3ead7, 1);
        porters.fillCircle(pos.x, pos.y, 5);
        porters.fillStyle(0x3a2f25, 1);
        porters.fillCircle(pos.x, pos.y, 3.5);
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
    if (showFarmZones && hover) {
      // Carte de fertilité autour du curseur : rouge = pauvre, vert = riche.
      const R = 7;
      for (let y = hover.y - R; y <= hover.y + R; y++) {
        for (let x = hover.x - R; x <= hover.x + R; x++) {
          if (sim.terrainAt(x, y) !== 0) continue;
          const occ = sim.occupantAt(x, y);
          if (occ && occ.kind !== "field") continue;
          const f = sim.fertilityAt(x, y) ?? 0;
          g.fillStyle(fertilityColor(f), 0.38);
          g.fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6);
        }
      }
    }
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
    let idle = false;
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
      // Champ possible mais qu'aucune ferme ne travaillera : orange, il restera en friche.
      if (ok && !sim.economy.fieldWouldBeWorked(hover.x, hover.y)) idle = true;
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
    const color = idle ? 0xd9822b : ok ? 0x3f9d5a : 0xb3261e;
    g.fillStyle(color, 0.42);
    g.fillRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
    g.lineStyle(2, color, 0.95);
    g.strokeRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
  }
}

/** Point situé à la fraction t (0 à 1) d'une ligne brisée aux segments de même durée. */
function pointAlong(pts: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (pts.length === 1) return pts[0]!;
  const segs = pts.length - 1;
  const pos = t * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const f = pos - i;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Rouge (fertilité 0) → jaune (50) → vert (100). */
function fertilityColor(f: number): number {
  const t = Math.max(0, Math.min(1, f / 100));
  const r = t < 0.5 ? 214 : Math.round(214 - (t - 0.5) * 2 * 150);
  const g = t < 0.5 ? Math.round(70 + t * 2 * 130) : 200;
  return (r << 16) | (g << 8) | 60;
}
