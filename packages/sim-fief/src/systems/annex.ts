/**
 * Annexion d'un fief acheté (J4) : son terrain rejoint le domaine, et le village de l'ancien
 * seigneur est reconstruit tel qu'il était : une maison forte (réserve et départ des routes),
 * une rue, des maisons habitées, une ou deux fermes et leurs champs, parfois un bûcheron,
 * et de quoi passer l'hiver.
 *
 * Le village est tiré au sort avec le générateur à graine du domaine, et posé avec les règles
 * de placement ordinaires (sans coût) : il respecte le terrain comme une construction du joueur.
 */
import { Rng, Terrain, generateFiefTerrain } from "@jeu/shared";
import { BOUGHT_VILLAGE, BUILDINGS } from "../data";
import type { DomainSim } from "../domain";
import type { Building, FiefTiles } from "../state";

export interface AnnexInput {
  fiefId: string;
  col: number;
  row: number;
  name: string;
  households: number;
  price: number;
}

export interface AnnexReport {
  houses: number;
  families: number;
  farms: number;
  fields: number;
  woodcutter: boolean;
  /** Foyers venus sans maison (place manquante). */
  homeless: number;
}

export function annexFief(sim: DomainSim, input: AnnexInput, rng: Rng): AnnexReport {
  const dims = sim.state.dims;
  const t = generateFiefTerrain(dims, input.col, input.row);
  const S = dims.fiefSize;
  const fief: FiefTiles = {
    id: input.fiefId,
    name: input.name,
    col: input.col,
    row: input.row,
    originX: input.col * S,
    originY: input.row * S,
    size: S,
    terrain: t.terrain,
    fertility: t.fertility,
  };
  sim.state.fiefs[input.fiefId] = fief;
  sim.refreshMap();
  return sim.withFreeBuild(() => buildVillage(sim, fief, input.households, rng));
}

function buildVillage(sim: DomainSim, fief: FiefTiles, households: number, rng: Rng): AnnexReport {
  const report: AnnexReport = { houses: 0, families: 0, farms: 0, fields: 0, woodcutter: false, homeless: 0 };
  const hub = placeHub(sim, fief);
  if (!hub) return report;
  // Rue principale sous la maison forte (qu'elle touche), assez longue pour le village.
  const streetY = hub.y + 2;
  sim.apply({ type: "road", x: hub.x, y: streetY });
  sim.apply({ type: "road", x: hub.x + 1, y: streetY });
  const half = Math.ceil(households / 2) + 2;
  const ends: number[] = [hub.x, hub.x + 1];
  for (const dir of [-1, 1]) {
    let x = dir < 0 ? hub.x : hub.x + 1;
    for (let i = 1; i <= half; i++) {
      if (!sim.apply({ type: "road", x: x + dir, y: streetY }).ok) break;
      x += dir;
    }
    ends.push(x);
  }
  // Fermes d'abord : elles prennent les meilleures terres le long de la rue.
  const farms = Math.max(1, Math.ceil(households / BOUGHT_VILLAGE.foyersParFerme));
  const placeFarms = () => {
    while (report.farms < farms) {
      const farm = bestSpot(sim, fief, "ferme", (x, y) => fertilityAround(sim, x, y, BUILDINGS.ferme?.rayonChamps ?? 4));
      if (!farm) return;
      sim.apply({ type: "build", building: "ferme", x: farm[0], y: farm[1] });
      report.farms += 1;
      report.fields += paintFields(sim, farm[0], farm[1]);
    }
  };
  placeFarms();
  // Puis les maisons, au plus près de la maison forte ; des ruelles s'ajoutent s'il manque de place.
  const houses: Building[] = [];
  const placeHouses = () => {
    for (const [x, y] of frontage(sim, fief, hub)) {
      if (houses.length >= households) return;
      if (sim.apply({ type: "build", building: "maison", x, y }).ok) houses.push(sim.buildingAt(x, y) as Building);
    }
  };
  placeHouses();
  // Ruelles perpendiculaires : aux deux bouts de la rue, puis tous les 4 pas.
  const branches = [...ends.slice(2)];
  for (let x = Math.min(...ends) + 2; x < Math.max(...ends); x += 4) branches.push(x);
  for (const x of branches) {
    if (houses.length >= households && report.farms >= farms) break;
    for (const dir of [-1, 1]) {
      for (let i = 1; i <= 10; i++) if (!sim.apply({ type: "road", x, y: streetY + dir * i }).ok) break;
    }
    placeFarms();
    placeHouses();
  }
  report.houses = houses.length;
  // Un bûcheron si la forêt est à portée de la route.
  const mill = households >= 4 ? bestSpot(sim, fief, "bucheron", (x, y) => forestAround(sim, x, y)) : null;
  if (mill) report.woodcutter = sim.apply({ type: "build", building: "bucheron", x: mill[0], y: mill[1] }).ok;
  // Les foyers dans leurs maisons, et de quoi passer l'hiver dans la maison forte.
  for (const h of houses) {
    sim.population.spawnFamily(rng, h.id, 18, 45, 3, 15);
    report.families += 1;
  }
  // Faute de place, les autres foyers viennent quand même : ils campent en attendant une maison.
  for (let i = houses.length; i < households; i++) {
    sim.population.spawnFamily(rng, null, 18, 45, 3, 15);
    report.families += 1;
    report.homeless += 1;
  }
  const cap = BUILDINGS.maisonforte?.stockage?.capacite ?? 300;
  const food = Math.min(cap, houses.length * BOUGHT_VILLAGE.vivresParFoyer);
  hub.stock = { nourriture: food, bois: Math.min(cap - food, houses.length * BOUGHT_VILLAGE.boisParFoyer) };
  return report;
}

/** Cases libres qui bordent une route reliée de ce fief, de la plus proche à la plus lointaine de la maison forte. */
function frontage(sim: DomainSim, fief: FiefTiles, hub: Building): [number, number][] {
  const roads = sim.connectedRoads();
  const W = sim.state.worldWidth;
  const out: [number, number][] = [];
  const seen = new Set<number>();
  for (const k of roads) {
    const x = k % W;
    const y = Math.floor(k / W);
    if (x < fief.originX || y < fief.originY || x >= fief.originX + fief.size || y >= fief.originY + fief.size) continue;
    for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]] as [number, number][]) {
      const nk = ny * W + nx;
      if (seen.has(nk) || sim.occupantAt(nx, ny) || sim.terrainAt(nx, ny) !== Terrain.Herbe) continue;
      seen.add(nk);
      out.push([nx, ny]);
    }
  }
  const cx = hub.x + 1;
  const cy = hub.y + 1;
  return out.sort((a, b) => Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)) || a[1] - b[1] || a[0] - b[0]);
}

/** La maison forte, au plus près du centre du fief, sur une place dégagée où la rue peut passer. */
function placeHub(sim: DomainSim, fief: FiefTiles): Building | undefined {
  const cx = fief.originX + Math.floor(fief.size / 2) - 1;
  const cy = fief.originY + Math.floor(fief.size / 2) - 1;
  const limit = Math.floor(fief.size / 2) - 6;
  for (let r = 0; r <= limit; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (openTiles(sim, x - 4, y - 3, 10, 9) < 60) continue;
        if (!sim.check({ type: "road", x, y: y + 2 }).ok || !sim.check({ type: "road", x: x + 1, y: y + 2 }).ok) continue;
        if (sim.apply({ type: "build", building: "maisonforte", x, y }).ok) return sim.buildingAt(x, y) as Building;
      }
    }
  }
  return undefined;
}

function openTiles(sim: DomainSim, x0: number, y0: number, w: number, h: number): number {
  let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (sim.terrainAt(x, y) === Terrain.Herbe && !sim.occupantAt(x, y)) n += 1;
  return n;
}

/** Meilleur emplacement d'un bâtiment qui touche une route reliée, dans ce fief. */
function bestSpot(sim: DomainSim, fief: FiefTiles, type: string, score: (x: number, y: number) => number): [number, number] | null {
  const roads = sim.connectedRoads();
  let best: [number, number] | null = null;
  let bestScore = 0;
  for (let y = fief.originY + 1; y < fief.originY + fief.size - 2; y++) {
    for (let x = fief.originX + 1; x < fief.originX + fief.size - 2; x++) {
      if (!sim.check({ type: "build", building: type, x, y }).ok) continue;
      if (!sim.perimeterOf(type, x, y).some((k) => roads.has(k))) continue;
      const s = score(x, y);
      if (s > bestScore) {
        best = [x, y];
        bestScore = s;
      }
    }
  }
  return best;
}

function fertilityAround(sim: DomainSim, x: number, y: number, radius: number): number {
  let n = 0;
  for (let ty = y - radius; ty < y + 2 + radius; ty++) {
    for (let tx = x - radius; tx < x + 2 + radius; tx++) {
      if (tx >= x && tx < x + 2 && ty >= y && ty < y + 2) continue;
      if (sim.terrainAt(tx, ty) === Terrain.Herbe && !sim.occupantAt(tx, ty)) n += sim.fertilityAt(tx, ty) ?? 0;
    }
  }
  return n;
}

function forestAround(sim: DomainSim, x: number, y: number): number {
  let n = 0;
  for (let ty = y - 4; ty < y + 6; ty++) for (let tx = x - 4; tx < x + 6; tx++) if (sim.terrainAt(tx, ty) === Terrain.Foret) n += 1;
  return n;
}

/** Les champs les plus fertiles autour de la ferme. */
function paintFields(sim: DomainSim, fx: number, fy: number): number {
  const radius = BUILDINGS.ferme?.rayonChamps ?? 4;
  const tiles: [number, number, number][] = [];
  for (let y = fy - radius; y < fy + 2 + radius; y++) {
    for (let x = fx - radius; x < fx + 2 + radius; x++) {
      // Les bords de route restent libres pour les maisons.
      const byRoad = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]].some(([nx, ny]) => sim.occupantAt(nx!, ny!)?.kind === "road");
      if (!byRoad && sim.check({ type: "field", x, y }).ok) tiles.push([x, y, sim.fertilityAt(x, y) ?? 0]);
    }
  }
  tiles.sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
  let n = 0;
  for (const [x, y] of tiles) {
    if (n >= BOUGHT_VILLAGE.champsParFerme) break;
    if (sim.apply({ type: "field", x, y }).ok) n += 1;
  }
  return n;
}

