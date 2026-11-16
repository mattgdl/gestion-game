/**
 * Outil d'équilibrage : simule N années d'un village type, sans affichage, et affiche un CSV.
 *
 * Usage : npx tsx tools/simulate.ts [années=20] [fermes=3] [fertilité=70] [graine=simulation] [adaptatif|fixe] [fermee|normale|ouverte]
 *
 * Le village type : terrain plat (fertilité choisie), une forêt et une carrière proches,
 * 25 maisons le long d'une route, des fermes avec 12 champs, un bûcheron, une carrière,
 * un marché et une église. On regarde si la population survit, grandit, et où ça coince.
 */
import { Terrain } from "@jeu/shared";

declare const process: { argv: string[] };
import { DomainSim, ageOf, type Building, type ImmigrationLevel } from "@jeu/sim-fief";
import { PLAYER_ID, WORLD_CONFIG, adjacent, createWorld, fiefsOwnedBy, lineageSetupFor, priceRange, resolveBarrier } from "@jeu/sim-monde";

const years = Number(process.argv[2] ?? 20);
const farms = Number(process.argv[3] ?? 3);
const fertility = Number(process.argv[4] ?? 70);
const seed = process.argv[5] ?? "simulation";
const immigration = (process.argv[7] ?? "normale") as ImmigrationLevel;

// Le village type est dessiné sur un monde de 3 fiefs en ligne (coordonnées fixes ci-dessous).
const world = createWorld(seed, { ...WORLD_CONFIG, cols: 3, rows: 1, playerFief: { col: 1, row: 0 } });
const created = DomainSim.create({
  ownerId: PLAYER_ID,
  dims: world.dims,
  fiefs: fiefsOwnedBy(world, PLAYER_ID).map((f) => ({ id: f.id, col: f.col, row: f.row })),
  lineage: lineageSetupFor(world, PLAYER_ID),
});
const state = created.toJSON();
for (const f of Object.values(state.fiefs)) {
  f.terrain.fill(Terrain.Herbe);
  f.fertility.fill(fertility);
  const stamp = (t: number, x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f.terrain[(y - f.originY) * f.size + (x - f.originX)] = t;
  };
  stamp(Terrain.Foret, 86, 30, 8, 8);
  stamp(Terrain.Roche, 86, 14, 5, 4);
}
const sim = DomainSim.fromState(state);
sim.state.treasury = 5000;
must(sim.apply({ type: "setImmigration", level: immigration }).ok, `accueil ${immigration}`);
const manor = sim.state.buildings.find((b) => b.type === "manoir") as Building;
// Matériaux de construction fournis par l'outil (hors équilibrage) ; la nourriture reste celle du départ.
manor.stock = { nourriture: 180, bois: 400, pierre: 400 };

function must(ok: boolean, what: string): void {
  if (!ok) throw new Error(`Impossible : ${what}`);
}
function road(x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  for (let x = x0, y = y0; ; x += dx, y += dy) {
    if (!sim.occupantAt(x, y)) must(sim.apply({ type: "road", x, y }).ok, `route ${x},${y}`);
    if (x === x1 && y === y1) break;
  }
}
function build(type: string, x: number, y: number): void {
  const r = sim.apply({ type: "build", building: type, x, y });
  must(r.ok, `${type} en ${x},${y} : ${r.reason}`);
}

// Routes : axe est-ouest en y = 27, axe nord-sud en x = 72 (prolonge les routes de départ).
road(52, 27, 95, 27);
road(72, 2, 72, 26);
road(72, 31, 72, 44);
road(85, 13, 85, 26);
road(85, 28, 85, 41);
road(73, 22, 85, 22);
// Ateliers.
build("bucheron", 83, 31);
build("bucheron", 83, 34);
build("carriere", 83, 15);
// Maisons : 12 au sud de la route (y = 28), 13 au nord (y = 26), à l'est du manoir.
for (let i = 0; i < 12; i++) build("maison", 73 + i, 28);
for (let i = 0; i < 11; i++) build("maison", 74 + i, 26);
for (let i = 0; i < 2; i++) build("maison", 86 + i, 28);
// On remet les réserves au niveau d'une partie normale une fois le village posé.
const afterBuild = () => {
  manor.stock.bois = Math.min(manor.stock.bois ?? 0, 150);
  manor.stock.pierre = 0;
  // L'or des constructions de départ était fourni par l'outil : on repart avec l'or d'une partie normale.
  sim.state.treasury = 200;
};
build("marche", 76, 20);
build("eglise", 80, 19);
// Fermes à l'ouest, avec 12 champs chacune : rangée sud (ferme en y = 28, champs dessous),
// puis rangée nord (ferme en y = 25, champs dessus).
const farmSpots: { fx: number; fy: number; fields: [number, number, number, number] }[] = [];
for (const fx of [66, 60, 54]) farmSpots.push({ fx, fy: 28, fields: [fx - 1, 30, 4, 4] });
for (const fx of [66, 60, 54]) farmSpots.push({ fx, fy: 25, fields: [fx - 1, 21, 4, 4] });
// Puis au nord, le long de la route x = 72 (champs à l'ouest).
for (const fy of [14, 9, 3]) farmSpots.push({ fx: 70, fy, fields: [66, fy - 1, 4, 3] });
let farmCount = 0;
function addFarm(): boolean {
  const spot = farmSpots[farmCount];
  if (!spot) return false;
  manor.stock.bois = Math.max(manor.stock.bois ?? 0, 20);
  build("ferme", spot.fx, spot.fy);
  const [x0, y0, w, h] = spot.fields;
  let n = 0;
  for (let y = y0; y < y0 + h && n < 12; y++) for (let x = x0; x < x0 + w && n < 12; x++) {
    if (sim.apply({ type: "field", x, y }).ok) n += 1;
  }
  farmCount += 1;
  return true;
}
for (let i = 0; i < farms; i++) addFarm();
// Maisons supplémentaires (jeunes couples, nouveaux venus) : à l'est, puis le long de l'axe nord-sud.
const houseSpots: [number, number][] = [];
for (let i = 0; i < 6; i++) houseSpots.push([89 + i, 28], [89 + i, 26]);
for (let y = 31; y <= 44; y++) houseSpots.push([71, y], [73, y]);
let extraHouses = 0;
function addHouse(): boolean {
  const spot = houseSpots[extraHouses];
  if (!spot) return false;
  manor.stock.bois = Math.max(manor.stock.bois ?? 0, 8);
  build("maison", spot[0], spot[1]);
  extraHouses += 1;
  return true;
}
// Entrepôts supplémentaires le long de la route nord-sud x = 72, au nord du manoir.
let depots = 0;
function addDepot(): boolean {
  if (depots >= 4) return false;
  manor.stock.bois = Math.max(manor.stock.bois ?? 0, 30);
  manor.stock.pierre = Math.max(manor.stock.pierre ?? 0, 10);
  build("entrepot", 73, 18 - depots * 3);
  depots += 1;
  return true;
}
// Bûcherons supplémentaires au sud de la forêt, le long de la route x = 85.
const woodSpots: [number, number][] = [[83, 37], [86, 38], [83, 39], [86, 40]];
let extraWood = 0;
function addWoodcutter(): boolean {
  const spot = woodSpots[extraWood];
  if (!spot) return false;
  manor.stock.bois = Math.max(manor.stock.bois ?? 0, 15);
  manor.stock.pierre = Math.max(manor.stock.pierre ?? 0, 5);
  build("bucheron", spot[0], spot[1]);
  extraWood += 1;
  return true;
}
let lastWood = 0;
// Ateliers (J4b) : petits emplacements au sud de la route y = 22, bergeries à l'est de la route x = 85.
const smallSpots: [number, number][] = [[74, 23], [76, 23], [78, 23], [80, 23], [82, 23], [74, 20], [83, 20]];
const sheepSpots: [number, number][] = [[86, 18], [86, 21], [86, 24]];
let usedSmall = 0;
let usedSheep = 0;
function addWorkshop(type: string): boolean {
  const spots = type === "bergerie" ? sheepSpots : smallSpots;
  const i = type === "bergerie" ? usedSheep : usedSmall;
  const spot = spots[i];
  if (!spot) return false;
  manor.stock.bois = Math.max(manor.stock.bois ?? 0, 30);
  manor.stock.pierre = Math.max(manor.stock.pierre ?? 0, 20);
  sim.state.treasury += 20;
  build(type, spot[0], spot[1]);
  if (type === "bergerie") usedSheep += 1;
  else usedSmall += 1;
  return true;
}
const count = (type: string) => sim.state.buildings.filter((b) => b.type === type).length;
const adaptive = process.argv[6] !== "fixe";
/** Un joueur raisonnable : chaque printemps, une ferme de plus si la récolte attendue ne couvre pas l'année. */
function playerSpring(): string {
  const need = (sim.population.dailyFoodNeed() * 120) / 1000;
  const expected = sim.economy.expectedHarvest();
  const notes: string[] = [`attendu ${expected} besoin ${Math.round(need)}`];
  if (expected < need * 1.3 && addFarm()) notes.push("ferme+");
  const usage = sim.economy.storageUsage();
  if (usage.used > usage.capacity * 0.75 && addDepot()) notes.push("entrepot+");
  // Du bois pour le chauffage (4 par maison) et les constructions.
  const housed = sim.state.families.filter((f) => f.houseId !== null).length;
  if (lastWood < housed * 4 + 30 && addWoodcutter()) notes.push("bucheron+");
  const tick = sim.state.tick;
  const singles = sim.state.villagers.filter((v) => ageOf(v, tick) >= 16).length - 2 * sim.state.families.filter((f) => f.husbandId !== null && f.wifeId !== null).length;
  if (singles >= 2 && addHouse()) notes.push("maison+");
  // Besoins (J4b) : une forge, puis bergeries et tisserands, quand le village grandit.
  if (sim.state.villagers.length >= 50) {
    if (sim.state.needs.outils.coverage < 600 && count("forge") < 3 && addWorkshop("forge")) notes.push("forge+");
    if (sim.state.needs.vetements.coverage < 600) {
      if (count("bergerie") <= count("tisserand") ? addWorkshop("bergerie") : addWorkshop("tisserand")) notes.push("laine/tissage+");
    }
  }
  // Une maison pour les nouveaux venus quand seul le logement leur manque.
  const outlook = sim.population.housingOutlook();
  if (outlook.spare === 0 && sim.population.immigrationCheck(1).ready && addHouse()) notes.push("maison(venus)+");
  // Un voisin s'achète dès que le trésor couvre le haut de son estimation.
  const mine = world.fiefs.filter((f) => f.ownerId === PLAYER_ID);
  for (const f of world.fiefs) {
    if (!f.ownerId?.startsWith("ia-") || !mine.some((m) => adjacent(m, f))) continue;
    const price = priceRange(f)[1];
    if (sim.state.treasury - 200 >= price && sim.apply({ type: "makeOffer", fiefId: f.id, price }).ok) notes.push(`offre ${f.name} ${price}`);
  }
  return notes.join(" ");
}

afterBuild();

/** Affaires de famille : l'héritier épouse le prétendant le plus jeune ; les cadets se marient tant que l'ordre de succession compte moins de 4 personnes, sinon l'Église. */
function familyMatters(): void {
  for (const dec of [...sim.state.dynasty.decisions]) {
    const line = sim.dynasty.lineOfSuccession();
    const isHeir = dec.memberId === sim.state.dynasty.lordId || dec.memberId === line[0];
    const r = sim.apply({ type: "familyDecision", memberId: dec.memberId, choice: isHeir || line.length < 4 ? 0 : "eglise" });
    if (!r.ok) sim.apply({ type: "familyDecision", memberId: dec.memberId, choice: 0 });
  }
}

const header = [
  "an",
  "habitants",
  "adultes",
  "enfants",
  "foyers",
  "sansAbri",
  "naissances",
  "deces",
  "faim",
  "froid",
  "mariages",
  "venus",
  "recolte",
  "mange",
  "bois",
  "brule",
  "nourritureDispo",
  "moral",
  "impots",
  "fermes",
  "travailleurs",
  "employes",
  "emplois",
  "champsTravailles",
  "champsMoissonnes",
  "seigneurAge",
  "regnes",
  "heritiers",
  "nobles",
  "prestige",
  "outils",
  "vetements",
  "chomeurs",
  "maladie",
  "fiefs",
  "titre",
  "or",
  "actions",
];
console.log(header.join(";"));
let actions = "";
for (let y = 1; y <= years; y++) {
  // Jusqu'à la fin de l'automne : bilan de l'année agricole.
  const target = (y - 1) * 1800 + 1348;
  while (sim.state.tick < target && !sim.state.gameOver) {
    const ev = sim.step();
    if (sim.state.dynasty.decisions.length > 0) familyMatters();
    if (ev.some((e) => e.type === "barrier")) {
      sim.applyBarrierResult(resolveBarrier(world, [{ ownerId: sim.state.ownerId, summary: sim.summary(), ready: true, actions: sim.barrierActions() }]));
    }
  }
  const s = sim.state.yearStats;
  lastWood = s.produced.bois ?? 0;
  const tick = sim.state.tick;
  const adults = sim.state.villagers.filter((v) => ageOf(v, tick) >= 17).length;
  const c = sim.population.counts();
  console.log(
    [
      y,
      sim.state.villagers.length,
      adults,
      sim.state.villagers.length - adults,
      c.families,
      c.homeless,
      s.births ?? 0,
      s.deaths ?? 0,
      s.deathsHunger ?? 0,
      s.deathsCold ?? 0,
      s.marriages ?? 0,
      s.immigrants ?? 0,
      s.harvested,
      Math.round((s.eaten ?? 0) / 1000),
      s.produced.bois ?? 0,
      Math.round((s.burned ?? 0) / 1000),
      sim.population.foodAvailable(),
      sim.population.morale(),
      s.taxes ?? 0,
      farmCount,
      c.workers,
      c.employed,
      c.jobs,
      sim.state.buildings.filter((b) => b.type === "ferme").reduce((n, b) => n + (sim.economy.farmInfo(b.id)?.fields.length ?? 0), 0),
      s.fieldsHarvested,
      sim.dynasty.lord ? sim.dynasty.ageOf(sim.dynasty.lord) : "-",
      sim.state.dynasty.reigns.length,
      sim.dynasty.lineOfSuccession().length,
      c.nobles,
      sim.dynasty.prestige().total,
      sim.state.needs.outils.coverage,
      sim.state.needs.vetements.coverage,
      c.workers - c.employed,
      s.deathsDisease ?? 0,
      Object.keys(sim.state.fiefs).length,
      sim.state.dynasty.title,
      sim.state.treasury,
      actions,
    ].join(";"),
  );
  if (process.argv[8] === "debug" && y % 4 === 0) {
    for (const b of sim.state.buildings.filter((x) => ["forge", "bergerie", "tisserand"].includes(x.type))) {
      console.log(`# ${b.type} relie=${sim.isConnected(b.id)} trav=${sim.population.workers(b.id).length} eff=${sim.economy.efficiency(b.id)} stock=${JSON.stringify(b.stock)} prog=${b.progress}`);
    }
    console.log(`# produit ${JSON.stringify(s.produced)} reserves outils=${sim.economy.stockOf("outils")} vet=${sim.economy.stockOf("vetements")} laine=${sim.economy.stockOf("laine")}`);
  }
  if (sim.state.gameOver) {
    console.log(`# fin de partie en l'an ${y} (${sim.state.gameOver.reason})`);
    break;
  }
  // Passe la barrière, puis va jusqu'au printemps suivant pour les décisions du joueur.
  while (sim.state.tick < y * 1800 + 1 && !sim.state.gameOver) {
    const ev = sim.step();
    if (sim.state.dynasty.decisions.length > 0) familyMatters();
    if (ev.some((e) => e.type === "barrier")) {
      sim.applyBarrierResult(resolveBarrier(world, [{ ownerId: sim.state.ownerId, summary: sim.summary(), ready: true, actions: sim.barrierActions() }]));
    }
  }
  actions = adaptive ? playerSpring() : "";
}
