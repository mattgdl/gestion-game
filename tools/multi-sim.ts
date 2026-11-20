/**
 * Outil d'équilibrage (J7) : simule une partie à 8 joueurs sur la carte 7 × 7, jouée par des
 * robots, pendant N années. Le Monde (seigneurs IA, guerres, commerce) tourne comme chez l'hôte.
 *
 * Usage : npx tsx tools/multi-sim.ts [graine=partie-1] [années=50]
 *
 * Les robots jouent « raisonnablement » sans tricher (aucune ressource offerte) :
 * maisons pour les sans-abri, fermes et champs selon la récolte attendue, bûcherons, carrières,
 * entrepôts, église, marché, ateliers des besoins, guérisseur, achats de fiefs voisins.
 * Trois caractères : bâtisseur (prudent), marchand (accepte les accords, relais), guerrier
 * (caserne, armurerie, attaque le voisin IA le plus faible). Sortie : JSON sur la sortie standard.
 */
import { Terrain } from "@jeu/shared";
import { BUILDINGS, DomainSim, TICKS_PER_YEAR, ageOf, type Command } from "@jeu/sim-fief";
import {
  adjacent,
  createWorld,
  defenseOf,
  fiefsOwnedBy,
  isStartFief,
  lineageSetupFor,
  priceRange,
  resolveBarrier,
  type WorldState,
} from "@jeu/sim-monde";
import type { BarrierInput, WorldEvent } from "@jeu/shared";

declare const process: { argv: string[]; env: Record<string, string | undefined>; stdout: { write(s: string): void }; stderr: { write(s: string): void } };

const seed = process.argv[2] ?? "partie-1";
const YEARS = Number(process.argv[3] ?? 50);
const GRID = 6;
const ACT_EVERY = 75; // ticks (5 jours)

type Character = "batisseur" | "marchand" | "guerrier";
const CHARACTERS: Character[] = ["batisseur", "marchand", "guerrier", "batisseur", "marchand", "batisseur", "guerrier", "marchand"];

const players = Array.from({ length: 8 }, (_, i) => ({ id: `j${i + 1}`, pseudo: `Robot ${i + 1}` }));
const world: WorldState = createWorld(seed, undefined, players);

interface Bot {
  id: string;
  character: Character;
  sim: DomainSim;
  /** Ancre de la grille de routes de chaque fief (manoir ou maison forte). */
  anchors: Map<string, { x: number; y: number }>;
  stats: { builds: Record<string, number>; offers: number; wars: number; refused: number; morts: Record<string, number> };
}

const bots: Bot[] = players.map((p, i) => {
  const owned = fiefsOwnedBy(world, p.id);
  const sim = DomainSim.create({
    ownerId: p.id,
    dims: world.dims,
    fiefs: owned.map((f) => ({ id: f.id, col: f.col, row: f.row })),
    lineage: lineageSetupFor(world, p.id),
  });
  return { id: p.id, character: CHARACTERS[i]!, sim, anchors: new Map(), stats: { builds: {}, offers: 0, wars: 0, refused: 0, morts: {} } };
});

// ------------------------------------------------------------------ placement

function fiefOfTile(sim: DomainSim, x: number, y: number) {
  for (const f of Object.values(sim.state.fiefs)) {
    if (x >= f.originX && y >= f.originY && x < f.originX + f.size && y < f.originY + f.size) return f;
  }
  return null;
}

function anchorOf(bot: Bot, fiefId: string): { x: number; y: number } | null {
  const known = bot.anchors.get(fiefId);
  if (known) return known;
  const root = bot.sim.state.buildings.find((b) => b.fiefId === fiefId && (b.type === "manoir" || b.type === "maisonforte"));
  if (!root) return null;
  // La ligne de route de départ du manoir passe sous lui (x du centre) : on cale la grille dessus.
  const a = { x: root.x + 1, y: root.y + (root.type === "manoir" ? 3 : 2) };
  bot.anchors.set(fiefId, a);
  return a;
}

/** Case prévue pour une route (grille régulière autour de l'ancre du fief). */
function plannedRoad(bot: Bot, x: number, y: number): boolean {
  const f = fiefOfTile(bot.sim, x, y);
  if (!f) return false;
  const a = anchorOf(bot, f.id);
  if (!a) return false;
  return ((x - a.x) % GRID === 0) || ((y - a.y) % GRID === 0);
}

function rectFree(bot: Bot, x: number, y: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (plannedRoad(bot, x + dx, y + dy)) return false;
  return true;
}

function dist2(a: { x: number; y: number }, x: number, y: number): number {
  return (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
}

/** Cherche un emplacement relié à la route pour ce bâtiment, le plus proche de l'ancre. */
function findSpot(bot: Bot, type: string, prefer?: (x: number, y: number) => number): { x: number; y: number } | null {
  const def = BUILDINGS[type];
  if (!def) return null;
  const [w, h] = def.taille;
  const sim = bot.sim;
  const roads = sim.connectedRoads();
  const W = sim.state.worldWidth;
  const seen = new Set<number>();
  let best: { x: number; y: number; score: number } | null = null;
  for (const k of roads) {
    const rx = k % W;
    const ry = Math.floor(k / W);
    const cands: [number, number][] = [];
    for (let x = rx - w + 1; x <= rx; x++) cands.push([x, ry + 1], [x, ry - h]);
    for (let y = ry - h + 1; y <= ry; y++) cands.push([rx + 1, y], [rx - w, y]);
    for (const [x, y] of cands) {
      const key = y * W + x;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!rectFree(bot, x, y, w, h)) continue;
      if (!sim.check({ type: "build", building: type, x, y }).ok) continue;
      const f = fiefOfTile(sim, x, y)!;
      const a = anchorOf(bot, f.id)!;
      const score = prefer ? prefer(x, y) : dist2(a, x, y);
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  return best;
}

/** Prolonge la grille de routes d'un tronçon (vers la cible si donnée). */
function extendRoads(bot: Bot, toward?: (x: number, y: number) => number): boolean {
  const sim = bot.sim;
  const roads = sim.connectedRoads();
  const W = sim.state.worldWidth;
  let best: { x: number; y: number; dx: number; dy: number; score: number } | null = null;
  for (const k of roads) {
    const rx = k % W;
    const ry = Math.floor(k / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = rx + dx;
      const y = ry + dy;
      if (!plannedRoad(bot, x, y) || sim.occupantAt(x, y)) continue;
      if (!sim.check({ type: "road", x, y }).ok) continue;
      const f = fiefOfTile(sim, x, y)!;
      const a = anchorOf(bot, f.id)!;
      // Les ponts coûtent cher : on les évite tant qu'il y a d'autres directions.
      const water = sim.terrainAt(x, y) === Terrain.Eau ? 400 : 0;
      const score = (toward ? toward(x, y) : dist2(a, x, y)) + water;
      if (!best || score < best.score) best = { x, y, dx, dy, score };
    }
  }
  if (!best) return false;
  let { x, y } = best;
  for (let i = 0; i < GRID; i++) {
    if (!plannedRoad(bot, x, y) || sim.occupantAt(x, y)) break;
    if (!sim.apply({ type: "road", x, y }).ok) break;
    x += best.dx;
    y += best.dy;
  }
  return true;
}

function nearestTerrain(bot: Bot, terrain: number): (x: number, y: number) => number {
  const sim = bot.sim;
  const targets: { x: number; y: number }[] = [];
  for (const f of Object.values(sim.state.fiefs)) {
    for (let i = 0; i < f.terrain.length; i += 3) {
      if (f.terrain[i] === terrain) targets.push({ x: f.originX + (i % f.size), y: f.originY + Math.floor(i / f.size) });
    }
  }
  return (x, y) => {
    let d = Infinity;
    for (const t of targets) d = Math.min(d, dist2(t, x, y));
    return d;
  };
}

function canAfford(bot: Bot, cost: Record<string, number | undefined>): boolean {
  const t = bot.sim.totals() as Record<string, number>;
  for (const [g, n] of Object.entries(cost)) {
    if (!n) continue;
    const have = g === "or" ? bot.sim.state.treasury : (t[g] ?? 0);
    if (have < n) return false;
  }
  return true;
}

function build(bot: Bot, type: string): boolean {
  const def = BUILDINGS[type];
  if (!def) return false;
  // Pas les moyens : on ne trace pas de route pour rien.
  if (!canAfford(bot, def.cout as Record<string, number>)) return false;
  const terrainPref = def.procheDe ? nearestTerrain(bot, def.procheDe.terrain === "foret" ? Terrain.Foret : def.procheDe.terrain === "roche" ? Terrain.Roche : Terrain.Herbe) : undefined;
  const fertile = type === "ferme" ? farmScore(bot) : undefined;
  // Bûcheron, carrière : le rendement dépend du nombre de cases de forêt (roche) autour.
  const rich = (type === "bucheron" || type === "carriere") && def.procheDe ? resourceScore(bot, type) : undefined;
  let spot = findSpot(bot, type, fertile ?? rich);
  // Bûcheron ou carrière trop loin de la forêt (roche) dense : on avance d'abord la route vers elle.
  if (spot && rich && -rich(spot.x, spot.y) + 0 < 12 && !roadsThisTurn.has(bot.id)) {
    roadsThisTurn.add(bot.id);
    if (extendRoads(bot, denseTarget(bot, type))) spot = findSpot(bot, type, rich);
    if (spot && -rich(spot.x, spot.y) < 6) return false;
  }
  // Pas de route sans pierre : on la garde pour les bâtiments vitaux.
  const vital = type === "bucheron" || type === "carriere" || type === "ferme" || type === "maison";
  if (!spot && !roadsThisTurn.has(bot.id) && (vital || bot.sim.totals().pierre >= 30)) {
    // Pas de place reliée : on prolonge la route une fois (vers le bon terrain), puis on réessaie.
    roadsThisTurn.add(bot.id);
    if (extendRoads(bot, terrainPref)) spot = findSpot(bot, type, fertile ?? rich);
  }
  if (!spot) {
    if (process.env.BOTDBG === bot.id) process.stderr.write(`t${bot.sim.state.tick} ${type}: pas d'emplacement (bois ${Math.round(bot.sim.totals().bois)} pierre ${Math.round(bot.sim.totals().pierre)} or ${bot.sim.state.treasury})\n`);
    return false;
  }
  const r = bot.sim.apply({ type: "build", building: type, x: spot.x, y: spot.y });
  if (!r.ok) return false;
  bot.stats.builds[type] = (bot.stats.builds[type] ?? 0) + 1;
  if (type === "ferme") paintFields(bot, spot.x, spot.y);
  return true;
}

/** Distance au plus proche coin riche (au moins la moitié des cases autour sont du bon terrain). */
function denseTarget(bot: Bot, type: string): (x: number, y: number) => number {
  const def = BUILDINGS[type]!;
  const terrain = def.procheDe!.terrain === "foret" ? Terrain.Foret : Terrain.Roche;
  const sim = bot.sim;
  const pts: { x: number; y: number }[] = [];
  for (const f of Object.values(sim.state.fiefs)) {
    for (let ly = 4; ly < f.size - 4; ly += 3) for (let lx = 4; lx < f.size - 4; lx += 3) {
      let n = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (f.terrain[(ly + dy) * f.size + lx + dx] === terrain) n += 1;
      if (n >= 30) pts.push({ x: f.originX + lx, y: f.originY + ly });
    }
  }
  if (pts.length === 0) return nearestTerrain(bot, terrain);
  return (x, y) => {
    let d = Infinity;
    for (const t of pts) d = Math.min(d, dist2(t, x, y));
    return d;
  };
}

function resourceScore(bot: Bot, type: string): (x: number, y: number) => number {
  const def = BUILDINGS[type]!;
  const terrain = def.procheDe!.terrain === "foret" ? Terrain.Foret : Terrain.Roche;
  const r = def.procheDe!.rayon;
  const [w, h] = def.taille;
  return (x, y) => {
    let n = 0;
    for (let ty = y - r; ty < y + h + r; ty++) for (let tx = x - r; tx < x + w + r; tx++) if (bot.sim.terrainAt(tx, ty) === terrain) n += 1;
    // Un autre atelier du même genre tout près se partage la ressource.
    const near = bot.sim.state.buildings.filter((b) => b.type === type && Math.abs(b.x - x) <= 2 * r && Math.abs(b.y - y) <= 2 * r).length;
    return -n + near * 15;
  };
}

/** Une ferme se place là où la terre libre et fertile abonde autour. */
function farmScore(bot: Bot): (x: number, y: number) => number {
  const sim = bot.sim;
  return (x, y) => {
    let total = 0;
    for (let dy = -4; dy <= 5; dy++) for (let dx = -4; dx <= 5; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (sim.terrainAt(tx, ty) !== Terrain.Herbe || sim.occupantAt(tx, ty) || plannedRoad(bot, tx, ty)) continue;
      const f = fiefOfTile(sim, tx, ty);
      if (!f) continue;
      total += f.fertility[(ty - f.originY) * f.size + (tx - f.originX)] ?? 0;
    }
    return -total;
  };
}

function paintFields(bot: Bot, fx: number, fy: number): void {
  const sim = bot.sim;
  const cands: { x: number; y: number; fert: number }[] = [];
  for (let dy = -4; dy <= 5; dy++) for (let dx = -4; dx <= 5; dx++) {
    const x = fx + dx;
    const y = fy + dy;
    if (plannedRoad(bot, x, y)) continue;
    if (!sim.check({ type: "field", x, y }).ok) continue;
    const f = fiefOfTile(sim, x, y)!;
    cands.push({ x, y, fert: f.fertility[(y - f.originY) * f.size + (x - f.originX)] ?? 0 });
  }
  cands.sort((a, b) => b.fert - a.fert || a.y - b.y || a.x - b.x);
  for (const c of cands.slice(0, 12)) sim.apply({ type: "field", x: c.x, y: c.y });
}

// ------------------------------------------------------------------ décisions

const count = (bot: Bot, type: string) => bot.sim.state.buildings.filter((b) => b.type === type).length;
const stock = (bot: Bot, g: "bois" | "pierre" | "nourriture") => bot.sim.totals()[g];

const roadsThisTurn = new Set<string>();

function act(bot: Bot): void {
  roadsThisTurn.delete(bot.id);
  const sim = bot.sim;
  if (sim.state.gameOver) return;
  const pop = sim.state.villagers.length;
  const homeless = sim.state.families.filter((f) => f.houseId === null).length;
  // 0. Foire d'automne : on achète ce qui manque avec l'or en trop (en gardant une réserve).
  if (sim.needs.fairOpen()) {
    const need = (sim.population.dailyFoodNeed() * 120) / 1000;
    const wants: ["bois" | "pierre" | "nourriture", number][] = [
      ["nourriture", Math.max(0, Math.round(need * 1.2 - stock(bot, "nourriture")))],
      ["bois", Math.max(0, 120 - Math.round(stock(bot, "bois")))],
      ["pierre", Math.max(0, 80 - Math.round(stock(bot, "pierre")))],
    ];
    // Surplus de vivres revendu (au-delà de deux ans de besoins).
    const surplus = Math.round(stock(bot, "nourriture") - need * 2);
    for (let qty = surplus; qty >= 10; qty = Math.floor(qty / 2)) {
      if (sim.needs.checkTrade("nourriture", qty, "vente").ok) {
        sim.apply({ type: "trade", good: "nourriture", qty, side: "vente" });
        break;
      }
    }
    // La laine en trop encombre les réserves : on la vend.
    const wool = Math.round(sim.economy.stockOf("laine") - 150);
    for (let qty = wool; qty >= 10; qty = Math.floor(qty / 2)) {
      if (sim.needs.checkTrade("laine", qty, "vente").ok) {
        sim.apply({ type: "trade", good: "laine", qty, side: "vente" });
        break;
      }
    }
    for (const [good, qty0] of wants) {
      const keep = good === "pierre" && stock(bot, "pierre") < 10 ? 30 : 150;
      for (let qty = qty0; qty >= 5; qty = Math.floor(qty / 2)) {
        const c = sim.needs.checkTrade(good, qty, "achat");
        if (c.ok && sim.state.treasury - (c.gold ?? 0) >= keep) {
          sim.apply({ type: "trade", good, qty, side: "achat" });
          bot.stats.builds[`foire:${good}`] = (bot.stats.builds[`foire:${good}`] ?? 0) + qty;
          break;
        }
      }
    }
  }
  // 1. Bois : sans bûcherons, rien ne se bâtit et l'hiver tue. On garde le bois pour eux tant qu'il en manque.
  const woodTarget = 3 + Math.floor(pop / 25);
  const woodFirst = count(bot, "bucheron") < woodTarget;
  // La pierre paie les routes : une carrière dès que deux bûcherons tournent.
  if (count(bot, "bucheron") >= 2 && count(bot, "carriere") === 0 && build(bot, "carriere")) return;
  if (woodFirst && build(bot, "bucheron")) return;
  if (bot.character === "guerrier" && sim.date.year >= 8 && count(bot, "caserne") < 1 + Math.floor(pop / 120)) build(bot, "caserne");
  if (woodFirst && count(bot, "bucheron") < 2 && stock(bot, "bois") < 40) {
    // Seules les maisons des sans-abri passent avant, en laissant de quoi bâtir un bûcheron.
    if (homeless > 0 && stock(bot, "bois") >= 8 + 15) build(bot, "maison");
    return;
  }
  // 2. Loger les sans-abri.
  for (let i = 0; i < Math.min(homeless, 3); i++) if (!build(bot, "maison")) break;
  // 3. Stockage : une réserve pleine bloque les porteurs.
  const usage = sim.economy.storageUsage();
  if (usage.used + usage.incoming > usage.capacity * 0.8 && stock(bot, "bois") >= 50 && count(bot, "entrepot") < 4 + Math.floor(pop / 20)) build(bot, "entrepot");
  // 4. Pierre.
  if (count(bot, "carriere") < 1 + Math.floor(pop / 80) && stock(bot, "pierre") < 60) build(bot, "carriere");
  // 5. Nourriture : une ferme si la récolte attendue ne couvre pas l'an (pas en hiver).
  const season = sim.date.seasonIndex;
  const need = (sim.population.dailyFoodNeed() * 120) / 1000;
  const food = stock(bot, "nourriture");
  if (season < 2 && sim.economy.expectedHarvest() < need * 1.3 && food < need * 3) build(bot, "ferme");
  if (pop >= 40 && count(bot, "marche") === 0) build(bot, "marche");
  if (pop >= 45 && count(bot, "eglise") === 0) build(bot, "eglise");
  if (pop >= 50) {
    if (sim.state.needs.outils.coverage < 600 && count(bot, "forge") < 1 + Math.floor(pop / 120)) build(bot, "forge");
    // Une bergerie par tisserand, pas plus : la laine en trop remplit les réserves.
    const cap = 1 + Math.floor(pop / 60);
    if (sim.state.needs.vetements.coverage < 600 && count(bot, "tisserand") < cap) build(bot, count(bot, "bergerie") < count(bot, "tisserand") || count(bot, "bergerie") === 0 ? "bergerie" : "tisserand");
  }
  if (pop >= 60 && count(bot, "guerisseur") < Object.keys(sim.state.fiefs).length) build(bot, "guerisseur");
  // 6. Place pour les jeunes couples et les nouveaux venus.
  const tick = sim.state.tick;
  const singles = sim.state.villagers.filter((v) => ageOf(v, tick) >= 16).length - 2 * sim.state.families.length;
  if ((singles >= 2 || sim.population.housingOutlook().spare === 0) && stock(bot, "bois") > 30) build(bot, "maison");
  // 7. Caractères.
  const year = sim.date.year;
  if (bot.character === "marchand" && year >= 5 && count(bot, "relais") === 0) build(bot, "relais");
  if (bot.character === "guerrier" && year >= 8 && count(bot, "caserne") > 0 && count(bot, "armurerie") === 0 && count(bot, "forge") > 0) build(bot, "armurerie");
  // Toute autre ville finit par se défendre quand la guerre la menace.
  if (sim.state.army.wars.some((w) => w.defenderId === bot.id) && count(bot, "caserne") === 0) build(bot, "caserne");
}

/** Une fois par an, au printemps : achats, guerres, accords. */
function yearly(bot: Bot): void {
  const sim = bot.sim;
  if (sim.state.gameOver) return;
  const mine = world.fiefs.filter((f) => f.ownerId === bot.id);
  const reserve = bot.character === "guerrier" ? 150 : 250;
  for (const f of world.fiefs) {
    if (!f.ownerId?.startsWith("ia-") || !mine.some((m) => adjacent(m, f))) continue;
    if (sim.state.offers.length > 0) break;
    const [lo, hi] = priceRange(world, f, bot.id);
    const price = Math.round((lo + hi) / 2 / 10) * 10 + (bot.character === "marchand" ? 0 : 0);
    if (sim.state.treasury - reserve >= price && sim.apply({ type: "makeOffer", fiefId: f.id, price }).ok) bot.stats.offers += 1;
  }
  if (bot.character === "guerrier" && sim.state.army.wars.length === 0 && sim.date.year >= 10) {
    const force = sim.army.strength();
    let target: { id: string; def: number } | null = null;
    for (const f of world.fiefs) {
      if (!f.ownerId?.startsWith("ia-") || !mine.some((m) => adjacent(m, f))) continue;
      if (world.wars.some((w) => w.fiefId === f.id)) continue;
      const def = defenseOf(world, f);
      const mercs = Math.min(20, Math.max(0, Math.floor((sim.state.treasury - 150) / 25)));
      if (force + mercs * 12 > def * 1.3 && (!target || def < target.def)) target = { id: f.id, def };
    }
    if (process.env.BOTDBG === bot.id) {
      const defs = world.fiefs.filter((f) => f.ownerId?.startsWith("ia-") && mine.some((m) => adjacent(m, f))).map((f) => defenseOf(world, f));
      process.stderr.write(`an ${sim.date.year} force ${force} soldats ${sim.army.soldiers().length} défenses voisines ${defs.join(",")}\n`);
    }
    if (target) {
      const goal = isStartFief(world, fiefById(target.id)) ? "pillage" : "conquete";
      if (sim.apply({ type: "declareWar", fiefId: target.id, goal }).ok) bot.stats.wars += 1;
    }
  }
  // En guerre comme attaquant : des mercenaires pour l'assaut du bilan.
  if (sim.state.army.wars.some((w) => w.attackerId === bot.id)) {
    const n = Math.min(20, Math.floor((sim.state.treasury - 100) / 25));
    if (n > 0) sim.apply({ type: "hireMercenaries", count: n });
  }
  // Accords proposés par les seigneurs IA : le marchand les prend tous, les autres ce qui manque.
  const shortages = sim.summary().shortages ?? [];
  for (const p of [...sim.state.trade.proposals]) {
    const wanted = bot.character === "marchand" || (p.terms.side === "vente" ? false : shortages.includes(p.terms.good));
    const cmd: Command = wanted ? { type: "acceptTradeProposal", proposalId: p.terms.id } : { type: "refuseTradeProposal", proposalId: p.terms.id };
    if (!sim.apply(cmd).ok) {
      bot.stats.refused += 1;
      sim.apply({ type: "refuseTradeProposal", proposalId: p.terms.id });
    }
  }
}

function fiefById(id: string) {
  return world.fiefs.find((f) => f.id === id)!;
}

function familyMatters(bot: Bot): void {
  const sim = bot.sim;
  for (const dec of [...sim.state.dynasty.decisions]) {
    const line = sim.dynasty.lineOfSuccession();
    const isHeir = dec.memberId === sim.state.dynasty.lordId || dec.memberId === line[0];
    const r = sim.apply({ type: "familyDecision", memberId: dec.memberId, choice: isHeir || line.length < 4 ? 0 : "eglise" });
    if (!r.ok) sim.apply({ type: "familyDecision", memberId: dec.memberId, choice: 0 });
  }
  for (const o of sim.state.deals.incoming) sim.apply({ type: "answerFiefOffer", offerId: o.offerId, accept: false });
}

// ------------------------------------------------------------------ boucle

const aiLog: Record<string, number> = {};
const playerAttacked: Record<string, number> = {};
const yearly_ai: { year: number; aiLords: number; aiFiefs: number; playerFiefs: number; wars: number; aiGoldAvg: number }[] = [];
const bump = (k: string) => (aiLog[k] = (aiLog[k] ?? 0) + 1);

const pillagedBy: Record<string, number> = {};
const side = (id: string) => (id.startsWith("ia-") ? "IA" : "joueur");

function tally(events: WorldEvent[]): void {
  for (const e of events) {
    if (e.type === "warDeclared") {
      bump(`guerre ${side(e.war.attackerId)}→${side(e.war.defenderId)}`);
      if (e.war.attackerId.startsWith("ia-") && !e.war.defenderId.startsWith("ia-")) playerAttacked[e.war.defenderId] = (playerAttacked[e.war.defenderId] ?? 0) + 1;
    } else if (e.type === "warEnded") {
      bump(`fin de guerre ${side(e.attackerId)}→${side(e.defenderId)} : ${e.outcome}`);
    } else if (e.type === "fiefTransferred") {
      bump(`${e.conquest ? "conquête" : "achat"} ${side(e.toOwnerId ?? "")}←${side(e.fromOwnerId ?? "")}`);
    } else if (e.type === "pillaged") {
      if (!e.ownerId.startsWith("ia-")) pillagedBy[e.ownerId] = (pillagedBy[e.ownerId] ?? 0) + 1;
      bump(`pillage subi par ${side(e.ownerId)}`);
    } else if (e.type === "tradeProposed") {
      bump("accord proposé par IA à un joueur");
    }
  }
}

for (let year = 1; year <= YEARS; year++) {
  const inputs: BarrierInput[] = [];
  for (const bot of bots) {
    const sim = bot.sim;
    if (sim.state.gameOver) continue;
    const target = (year - 1) * TICKS_PER_YEAR + 1352;
    let atBarrier = false;
    while (!atBarrier && !sim.state.gameOver && sim.state.tick < target + 10) {
      const ev = sim.step();
      if (sim.state.dynasty.decisions.length > 0 || sim.state.deals.incoming.length > 0) familyMatters(bot);
      if (sim.state.tick % ACT_EVERY === 0) act(bot);
      if (sim.state.tick % TICKS_PER_YEAR === 20) yearly(bot);
      if (ev.some((e) => e.type === "barrier")) atBarrier = true;
    }
    const ys = sim.state.yearStats;
    for (const [k, v] of Object.entries({ faim: ys.deathsHunger, froid: ys.deathsCold, maladie: ys.deathsDisease, autres: (ys.deaths ?? 0) - (ys.deathsHunger ?? 0) - (ys.deathsCold ?? 0) - (ys.deathsDisease ?? 0), naissances: ys.births, venus: ys.immigrants })) {
      bot.stats.morts[k] = (bot.stats.morts[k] ?? 0) + (v ?? 0);
    }
    if (process.env.DEATHS === bot.id) process.stderr.write(`an ${year} ${bot.id} pop ${sim.state.villagers.length} ${JSON.stringify(ys)} vivres ${Math.round(sim.totals().nourriture)}\n`);
    if (atBarrier) inputs.push({ ownerId: bot.id, summary: sim.summary(), ready: true, actions: sim.barrierActions() });
  }
  const result = resolveBarrier(world, inputs);
  tally(result.events);
  for (const bot of bots) if (inputs.some((i) => i.ownerId === bot.id)) bot.sim.applyBarrierResult(result);
  // Fin d'année (hiver) jusqu'au printemps suivant, sans nouveau bilan.
  for (const bot of bots) {
    const sim = bot.sim;
    while (!sim.state.gameOver && sim.state.tick < year * TICKS_PER_YEAR) {
      sim.step();
      if (sim.state.dynasty.decisions.length > 0) familyMatters(bot);
      if (sim.state.tick % ACT_EVERY === 0) act(bot);
    }
  }
  if (process.env.TRACE) {
    for (const bot of bots.slice(0, Number(process.env.TRACE))) {
      const s = bot.sim;
      const t = s.totals();
      process.stderr.write(`an ${year} ${bot.id} pop ${s.state.villagers.length} fam ${s.state.families.length} sansabri ${s.state.families.filter((f) => f.houseId === null).length} vivres ${Math.round(t.nourriture)} bois ${Math.round(t.bois)} pierre ${Math.round(t.pierre)} or ${s.state.treasury} recolte ${s.economy.expectedHarvest()} moral ${s.population.morale()} bat ${JSON.stringify(bot.stats.builds)}\n`);
      if (process.env.DETAIL) for (const b of s.state.buildings.filter((b) => b.type === "bucheron" || b.type === "ferme")) process.stderr.write(`   ${b.type} relié=${s.isConnected(b.id)} eff=${s.economy.efficiency(b.id)} pos=${b.x},${b.y} stock=${JSON.stringify(b.stock)} travailleurs=${[...((s.population as any).jobByVillager as Map<number, number>).values()].filter((j) => j === b.id).length}\n`);
      if (process.env.DETAIL) process.stderr.write(`   produit ${JSON.stringify(s.state.yearStats.produced)} compte ${JSON.stringify(s.population.counts())}\n`);
    }
  }
  const ai = world.lords.filter((l) => l.ai && world.fiefs.some((f) => f.ownerId === l.id));
  yearly_ai.push({
    year,
    aiLords: ai.length,
    aiFiefs: world.fiefs.filter((f) => f.ownerId?.startsWith("ia-")).length,
    playerFiefs: world.fiefs.filter((f) => f.ownerId?.startsWith("j")).length,
    wars: world.wars.length,
    aiGoldAvg: ai.length ? Math.round(ai.reduce((s, l) => s + (l.ai?.gold ?? 0), 0) / ai.length) : 0,
  });
}

const players_out = bots.map((bot) => {
  const sim = bot.sim;
  return {
    id: bot.id,
    caractere: bot.character,
    prestige: sim.dynasty.prestige().total,
    titre: sim.titleName(),
    fiefs: world.fiefs.filter((f) => f.ownerId === bot.id).length,
    habitants: sim.state.villagers.length,
    or: sim.state.treasury,
    finie: sim.state.gameOver?.reason ?? null,
    attaquePar_IA: playerAttacked[bot.id] ?? 0,
    pille: pillagedBy[bot.id] ?? 0,
    soldats: sim.army.soldiers().length,
    force: sim.army.strength(),
    offres: bot.stats.offers,
    guerres: bot.stats.wars,
    batiments: bot.stats.builds,
    demographie: bot.stats.morts,
  };
});
const aiLeft = world.lords.filter((l) => l.ai && world.fiefs.some((f) => f.ownerId === l.id));
process.stdout.write(
  JSON.stringify({
    seed,
    years: YEARS,
    players: players_out,
    ai: {
      events: aiLog,
      timeline: yearly_ai.filter((y) => y.year % 10 === 0 || y.year === 1),
      left: aiLeft.map((l) => ({ name: l.name, archetype: l.ai!.archetype, fiefs: world.fiefs.filter((f) => f.ownerId === l.id).length, gold: l.ai!.gold })),
    },
  }) + "\n",
);
