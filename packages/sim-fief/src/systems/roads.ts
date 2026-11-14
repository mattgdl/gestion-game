/**
 * Réseau de routes.
 * J1 : quelles routes et quels bâtiments sont reliés au manoir.
 * J2a : itinéraires sur ce graphe pour la logistique par flux.
 */

export interface RoadGraphInput {
  worldWidth: number;
  roads: ReadonlySet<number>;
  /** Tuiles du manoir (racine du réseau). */
  rootTiles: number[];
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Voisins orthogonaux d'une tuile (clés), sans sortir de la carte en largeur. */
export function neighbors4(key: number, worldWidth: number): number[] {
  const x = key % worldWidth;
  const y = Math.floor(key / worldWidth);
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= worldWidth) continue;
    out.push(ny * worldWidth + nx);
  }
  return out;
}

export interface RoadPath {
  /** Nombre de cases de route parcourues. */
  distance: number;
  /** Cases de route, du départ vers l'arrivée. */
  path: number[];
}

/**
 * Plus courts chemins par la route, depuis les cases de route qui touchent le départ
 * vers chaque destination (identifiée par les cases de route qui la touchent).
 * Parcours en largeur : toutes les cases ont le même coût. Ordre de visite fixe : déterministe.
 */
export function shortestRoadPaths(
  worldWidth: number,
  roads: ReadonlySet<number>,
  startTiles: readonly number[],
  targets: ReadonlyMap<number, readonly number[]>,
): Map<number, RoadPath> {
  const parent = new Map<number, number>();
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const t of [...startTiles].sort((a, b) => a - b)) {
    if (!roads.has(t) || dist.has(t)) continue;
    dist.set(t, 1);
    parent.set(t, -1);
    queue.push(t);
  }
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    const d = dist.get(current) as number;
    for (const n of neighbors4(current, worldWidth)) {
      if (roads.has(n) && !dist.has(n)) {
        dist.set(n, d + 1);
        parent.set(n, current);
        queue.push(n);
      }
    }
  }
  const out = new Map<number, RoadPath>();
  for (const [targetId, tiles] of targets) {
    let best = -1;
    let bestDist = Infinity;
    for (const t of tiles) {
      const d = dist.get(t);
      if (d !== undefined && (d < bestDist || (d === bestDist && t < best))) {
        best = t;
        bestDist = d;
      }
    }
    if (best < 0) continue;
    const path: number[] = [];
    for (let k = best; k !== -1; k = parent.get(k) as number) path.push(k);
    path.reverse();
    out.set(targetId, { distance: bestDist, path });
  }
  return out;
}

/** Routes reliées au manoir (parcours en largeur depuis les routes qui le touchent). */
export function connectedRoads(input: RoadGraphInput): Set<number> {
  const { worldWidth, roads, rootTiles } = input;
  const visited = new Set<number>();
  const queue: number[] = [];
  for (const t of rootTiles) {
    for (const n of neighbors4(t, worldWidth)) {
      if (roads.has(n) && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const n of neighbors4(current, worldWidth)) {
      if (roads.has(n) && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited;
}
