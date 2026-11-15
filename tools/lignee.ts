/**
 * Outil d'équilibrage de la lignée (J3) : simule seulement la famille du seigneur (vivres
 * illimités, pas de village) pendant N années, sur plusieurs graines, et compte les extinctions
 * selon la loi de succession et la façon de marier les enfants.
 *
 * Usage : npx tsx tools/lignee.ts [années=150] [graines=20]
 *
 * Façons de faire (le « joueur » décide à chaque affaire de famille) :
 * - prudent : tout le monde se marie au domaine, avec le prétendant le plus jeune ;
 * - equilibre : l'héritier épouse le plus jeune ; les cadets se marient tant que la ligne de
 *   succession compte moins de 4 personnes, sinon ils entrent dans l'Église ;
 * - risque : l'héritier épouse le plus âgé (grosse dot), les cadets partent tous.
 */
import { DEMOGRAPHY, DomainSim, SUCCESSION_LAWS, type SuccessionLaw } from "@jeu/sim-fief";
import { PLAYER_ID, createWorld, fiefsOwnedBy, lineageSetupFor, resolveBarrier } from "@jeu/sim-monde";

declare const process: { argv: string[] };

const years = Number(process.argv[2] ?? 150);
const seeds = Number(process.argv[3] ?? 20);
type Policy = "prudent" | "equilibre" | "risque";
const POLICIES: Policy[] = ((process.argv[4] ?? "prudent,equilibre,risque").split(",") as Policy[]);

// Pas de village dans cet outil : la défaite par dépeuplement est désactivée.
(DEMOGRAPHY as { seuilDefaite: number }).seuilDefaite = 0;

function run(seed: string, law: SuccessionLaw, policy: Policy): { extinctYear: number | null; reigns: number; maxLiving: number } {
  const world = createWorld(seed);
  const sim = DomainSim.create({
    ownerId: PLAYER_ID,
    dims: world.dims,
    fiefs: fiefsOwnedBy(world, PLAYER_ID).map((f) => ({ id: f.id, col: f.col, row: f.row })),
    lineage: lineageSetupFor(world, PLAYER_ID),
  });
  sim.state.dynasty.law = law;
  sim.state.villagers = sim.state.villagers.filter((v) => v.noble);
  sim.state.families = sim.state.families.filter((f) => f.noble);
  sim.population.version += 1;
  const manor = sim.state.buildings.find((b) => b.type === "manoir")!;
  let maxLiving = 0;
  while (sim.state.tick < years * 1800 && !sim.state.gameOver) {
    manor.stock.nourriture = 400;
    manor.stock.bois = 100;
    const ev = sim.step();
    if (ev.some((e) => e.type === "barrier")) {
      sim.applyBarrierResult(resolveBarrier(world, [{ ownerId: PLAYER_ID, summary: sim.summary(), ready: true, actions: [] }]));
    }
    for (const dec of [...sim.state.dynasty.decisions]) {
      const line = sim.dynasty.lineOfSuccession();
      const isHeir = dec.memberId === sim.state.dynasty.lordId || dec.memberId === line[0];
      let choice: number | "eglise" = 0;
      if (policy === "risque") choice = isHeir ? 2 : "eglise";
      else if (policy === "equilibre") choice = isHeir || line.length < 4 ? 0 : "eglise";
      const r = sim.apply({ type: "familyDecision", memberId: dec.memberId, choice });
      if (!r.ok) sim.apply({ type: "familyDecision", memberId: dec.memberId, choice: 0 });
    }
    maxLiving = Math.max(maxLiving, sim.state.villagers.length);
  }
  const extinct = sim.state.gameOver?.reason === "extinction";
  return { extinctYear: extinct ? Math.floor(sim.state.tick / 1800) + 1 : null, reigns: sim.state.dynasty.reigns.length, maxLiving };
}

console.log("loi;facon;extinctions;anneeMoyenneExtinction;regnesMoyens;familleMax");
for (const law of SUCCESSION_LAWS) {
  for (const policy of POLICIES) {
    let ext = 0;
    let extYears = 0;
    let reigns = 0;
    let maxLiving = 0;
    for (let i = 0; i < seeds; i++) {
      const r = run(`lignee-${i}`, law, policy);
      if (r.extinctYear !== null) {
        ext += 1;
        extYears += r.extinctYear;
      }
      reigns += r.reigns;
      maxLiving = Math.max(maxLiving, r.maxLiving);
    }
    console.log([law, policy, `${ext}/${seeds}`, ext > 0 ? Math.round(extYears / ext) : "-", (reigns / seeds).toFixed(1), maxLiving].join(";"));
  }
}
