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
