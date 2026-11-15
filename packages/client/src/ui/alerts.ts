/**
 * Alertes du village : ce qui va mal ou va bientôt mal tourner, pour que la défaite ne soit
 * jamais une surprise (DESIGN.md, « défaite prévisible »). Lecture seule de la simulation.
 */
import { BUILDINGS, DAYS_PER_YEAR, DAILY_WOOD, ageOf, type DomainSim } from "@jeu/sim-fief";
import demographyJson from "@jeu/data/demography.json";

export interface Alert {
  tone: "bad" | "warn" | "info";
  text: string;
}

const AGE_MARIAGE = (demographyJson as { ageMariage: number }).ageMariage;

/** Jours de nourriture d'avance pour tout le village (réserves, marchés, foyers). */
export function foodDays(sim: DomainSim): number {
  const need = sim.population.dailyFoodNeed();
  if (need <= 0) return Infinity;
  return Math.floor((sim.population.foodAvailable() * 1000) / need);
}

export function computeAlerts(sim: DomainSim): Alert[] {
  const out: Alert[] = [];
  const season = sim.date.seasonIndex;
  const fams = sim.state.families;
  const pop = sim.population;

  const days = foodDays(sim);
  if (days < 30) out.push({ tone: "bad", text: `Nourriture pour ${days} jours seulement.` });
  else if (days < 60) out.push({ tone: "warn", text: `Nourriture pour ${days} jours.` });

  if (season <= 1) {
    const yearly = (pop.dailyFoodNeed() * DAYS_PER_YEAR) / 1000;
    const expected = sim.economy.expectedHarvest();
    if (pop.foodAvailable() + expected < yearly) {
      out.push({ tone: "warn", text: `Récolte attendue (${expected}) trop faible pour l'année (${Math.round(yearly)} à manger) : ajoutez une ferme ou des champs.` });
    }
  }

  const hungry = fams.filter((f) => f.hungryDays > 0).length;
  if (hungry > 0) out.push({ tone: "bad", text: `${hungry} foyer${hungry > 1 ? "s ont" : " a"} faim.` });
  const cold = fams.filter((f) => season === 3 && f.coldDays > 0 && f.houseId !== null).length;
  if (cold > 0) out.push({ tone: "bad", text: `${cold} foyer${cold > 1 ? "s ont" : " a"} froid : plus de bois de chauffage.` });

  const homeless = fams.filter((f) => f.houseId === null).length;
  if (homeless > 0) {
    const winterSoon = season >= 2;
    out.push({
      tone: winterSoon ? "bad" : "warn",
      text: `${homeless} famille${homeless > 1 ? "s" : ""} sans abri${winterSoon ? " : elles auront froid cet hiver" : ""}. Bâtissez des maisons.`,
    });
  }

  if (season === 2) {
    let wood = 0;
    for (const b of sim.state.buildings) {
      const def = BUILDINGS[b.type];
      if (def?.stockage || def?.marche) wood += b.stock.bois ?? 0;
    }
    let pantry = 0;
    for (const f of fams) pantry += f.wood;
    const housed = fams.filter((f) => f.houseId !== null).length;
    const need = (housed * DAILY_WOOD * (DAYS_PER_YEAR / 4)) / 1000;
    if (wood + pantry / 1000 < need) out.push({ tone: "warn", text: `Bois de chauffage insuffisant pour l'hiver (${Math.round(need)} nécessaires).` });
  }

  const unlinked = fams.filter((f) => f.houseId !== null && !sim.isConnected(f.houseId)).length;
  if (unlinked > 0) out.push({ tone: "warn", text: `${unlinked} maison${unlinked > 1 ? "s" : ""} habitée${unlinked > 1 ? "s" : ""} sans route : pas de ravitaillement.` });

  const usage = sim.economy.storageUsage();
  if (usage.capacity > 0 && usage.used >= usage.capacity * 0.95) out.push({ tone: "warn", text: "Réserves pleines : bâtissez un entrepôt." });

  const c = pop.counts();
  if (c.jobs > c.employed) {
    const n = c.jobs - c.employed;
    out.push({ tone: "info", text: `${n} emploi${n > 1 ? "s" : ""} vacant${n > 1 ? "s" : ""} : pas assez de bras.` });
  }

  const tick = sim.state.tick;
  const married = new Set<number>();
  for (const f of fams) {
    if (f.husbandId !== null) married.add(f.husbandId);
    if (f.wifeId !== null) married.add(f.wifeId);
  }
  const singles = sim.state.villagers.filter((v) => ageOf(v, tick) >= AGE_MARIAGE && !married.has(v.id));
  const pairs = Math.min(singles.filter((v) => v.sex === "M").length, singles.filter((v) => v.sex === "F").length);
  const occupied = new Set(fams.map((f) => f.houseId).filter((h): h is number => h !== null));
  const freeHouses = sim.state.buildings.filter((b) => BUILDINGS[b.type]?.logement && !occupied.has(b.id)).length;
  if (pairs > freeHouses) {
    const n = pairs - freeHouses;
    out.push({ tone: "info", text: `${n} jeune${n > 1 ? "s" : ""} couple${n > 1 ? "s attendent" : " attend"} une maison pour se marier.` });
  }
  return out;
}
