import { PLAYER_ID, WORLD_CONFIG, createWorld, fiefsOwnedBy, lineageSetupFor, resolveBarrier, type WorldState } from "@jeu/sim-monde";

/** Monde des tests : 3 fiefs en ligne (le joueur au centre), comme avant J4, pour garder les coordonnées. */
export const SMALL_WORLD = { ...WORLD_CONFIG, cols: 3, rows: 1, playerFief: { col: 1, row: 0 } };
import { DomainSim, type Building } from "../src";

export function newGame(seed = "test", config = SMALL_WORLD): { world: WorldState; sim: DomainSim } {
  const world = createWorld(seed, config);
  const sim = DomainSim.create({
    ownerId: PLAYER_ID,
    dims: world.dims,
    fiefs: fiefsOwnedBy(world, PLAYER_ID).map((f) => ({ id: f.id, col: f.col, row: f.row })),
    lineage: lineageSetupFor(world, PLAYER_ID),
  });
  return { world, sim };
}

/** Avance jusqu'au tick voulu, en résolvant les barrières annuelles au passage. */
export function runUntil(sim: DomainSim, world: WorldState, targetTick: number): number {
  let barriers = 0;
  while (sim.state.tick < targetTick && !sim.state.gameOver) {
    const events = sim.step();
    if (events.some((e) => e.type === "barrier")) {
      barriers += 1;
      sim.applyBarrierResult(
        resolveBarrier(world, [{ ownerId: sim.state.ownerId, summary: sim.summary(), ready: true, actions: sim.barrierActions() }]),
      );
    }
  }
  return barriers;
}

/** Centre du fief de départ (coordonnées globales). Les routes de départ descendent de (cx, cy + 2). */
export function startCenter(sim: DomainSim): { cx: number; cy: number } {
  const manor = sim.state.buildings.find((b) => b.type === "manoir");
  if (!manor) throw new Error("pas de manoir");
  return { cx: manor.x + 1, cy: manor.y + 1 };
}

export function manorOf(sim: DomainSim): Building {
  const manor = sim.state.buildings.find((b) => b.type === "manoir");
  if (!manor) throw new Error("pas de manoir");
  return manor;
}

export interface Block {
  terrain: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Partie « laboratoire » : le fief du joueur est remis à plat (herbe, fertilité 100),
 * puis on y dessine les blocs de terrain voulus. Le manoir occupe (71..73, 23..25) et
 * les routes de départ descendent de (72, 26) à (72, 30).
 */
export function labGame(blocks: Block[] = [], seed = "labo"): { world: WorldState; sim: DomainSim } {
  const { world, sim } = newGame(seed);
  const state = sim.toJSON();
  for (const f of Object.values(state.fiefs)) {
    f.terrain.fill(0);
    f.fertility.fill(100);
    for (const b of blocks) {
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const lx = x - f.originX;
          const ly = y - f.originY;
          if (lx >= 0 && ly >= 0 && lx < f.size && ly < f.size) f.terrain[ly * f.size + lx] = b.terrain;
        }
      }
    }
  }
  // Réserves du laboratoire : celles de J2a (310 marchandises), pour garder de la place.
  const manor = state.buildings.find((b) => b.type === "manoir");
  if (manor) manor.stock = { nourriture: 100, bois: 150, pierre: 60 };
  // Les foyers du laboratoire ont des provisions à vie : ils ne puisent pas dans les réserves.
  for (const f of state.families) {
    f.food = 1e9;
    f.wood = 1e9;
  }
  return { world, sim: DomainSim.fromState(state) };
}

/** Trace une route en ligne droite (horizontale ou verticale), extrémités comprises. */
export function road(sim: DomainSim, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  for (let x = x0, y = y0; ; x += dx, y += dy) {
    if (!sim.occupantAt(x, y)) {
      const r = sim.apply({ type: "road", x, y });
      if (!r.ok) throw new Error(`route impossible en ${x},${y} : ${r.reason}`);
    }
    if (x === x1 && y === y1) break;
  }
}

export function build(sim: DomainSim, building: string, x: number, y: number): Building {
  const r = sim.apply({ type: "build", building, x, y });
  if (!r.ok) throw new Error(`${building} impossible en ${x},${y} : ${r.reason}`);
  return sim.buildingAt(x, y) as Building;
}

/** Toute la marchandise d'un type présente dans le domaine : réserves, ateliers et porteurs chargés. */
export function everywhere(sim: DomainSim, good: "nourriture" | "bois" | "pierre"): number {
  let n = 0;
  for (const b of sim.state.buildings) n += b.stock[good] ?? 0;
  for (const d of sim.state.deliveries) if (d.good === good && d.status !== "retour") n += d.amount;
  return n;
}
