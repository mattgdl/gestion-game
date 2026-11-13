import { PLAYER_ID, createWorld, fiefsOwnedBy, resolveBarrier, type WorldState } from "@jeu/sim-monde";
import { DomainSim } from "../src";

export function newGame(seed = "test"): { world: WorldState; sim: DomainSim } {
  const world = createWorld(seed);
  const sim = DomainSim.create({
    ownerId: PLAYER_ID,
    dims: world.dims,
    fiefs: fiefsOwnedBy(world, PLAYER_ID).map((f) => ({ id: f.id, col: f.col, row: f.row })),
  });
  return { world, sim };
}

/** Avance jusqu'au tick voulu, en résolvant les barrières annuelles au passage. */
export function runUntil(sim: DomainSim, world: WorldState, targetTick: number): number {
  let barriers = 0;
  while (sim.state.tick < targetTick) {
    const events = sim.step();
    if (events.some((e) => e.type === "barrier")) {
      barriers += 1;
      sim.applyBarrierResult(
        resolveBarrier(world, [{ ownerId: sim.state.ownerId, summary: sim.summary(), ready: true, actions: [] }]),
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
