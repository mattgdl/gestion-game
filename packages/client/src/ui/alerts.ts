/**
 * Alertes du village : ce qui va mal ou va bientôt mal tourner, pour que la défaite ne soit
 * jamais une surprise (DESIGN.md, « défaite prévisible »). Lecture seule de la simulation.
 */
import { BUILDINGS, DAYS_PER_YEAR, DAILY_WOOD, type DomainSim } from "@jeu/sim-fief";

export interface Alert {
  tone: "bad" | "warn" | "info";
  text: string;
}

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

  out.push(...jobAlerts(sim));

  const housing = pop.housingOutlook();
  if (housing.waitingCouples > housing.freeHouses) {
    const n = housing.waitingCouples - housing.freeHouses;
    out.push({ tone: "info", text: `${n} jeune${n > 1 ? "s" : ""} couple${n > 1 ? "s attendent" : " attend"} une maison pour se marier.` });
  }
  const im = housing.immigration;
  if (housing.spare > 0 && im.perYear > 0 && im.arrived < im.perYear && !im.ready && im.reason) {
    out.push({ tone: "info", text: `Maison${housing.spare > 1 ? "s" : ""} libre${housing.spare > 1 ? "s" : ""}, mais aucune famille ne viendra : ${lowerFirst(im.reason)}` });
  }
  return out;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Emplois vacants, en nommant les bâtiments touchés : un bâtiment sans personne est à l'arrêt
 * (l'église sans prêtre ne soutient plus le moral), un bâtiment incomplet tourne moins vite.
 */
export function jobAlerts(sim: DomainSim): Alert[] {
  const pop = sim.population;
  const stopped = new Map<string, number>();
  const partial: string[] = [];
  for (const b of sim.state.buildings) {
    const def = BUILDINGS[b.type];
    const max = def?.travailleurs ?? 0;
    if (!def || max === 0 || !sim.isConnected(b.id)) continue;
    const want = Math.min(max, b.workersLimit ?? max);
    if (want === 0) continue;
    const have = pop.workers(b.id).length;
    if (have === 0) stopped.set(def.nom, (stopped.get(def.nom) ?? 0) + 1);
    else if (have < want) partial.push(`${def.nom} ${have}/${want}`);
  }
  const out: Alert[] = [];
  if (stopped.size > 0) {
    const names = [...stopped].map(([nom, n]) => (n > 1 ? `${nom} ×${n}` : nom)).join(", ");
    let morale = "";
    for (const type of ["eglise", "marche"]) {
      const nom = BUILDINGS[type]?.nom ?? "";
      if (!stopped.has(nom)) continue;
      const lower = nom.toLowerCase();
      morale += ` ${/^[aeiouéèêh]/.test(lower) ? `L'${lower}` : `Le ${lower}`} ne soutient plus le moral.`;
    }
    out.push({
      tone: "warn",
      text: `Sans travailleur, à l'arrêt : ${names}.${morale} Retirez un travailleur ailleurs (− dans la fiche d'un bâtiment).`,
    });
  }
  if (partial.length > 0) out.push({ tone: "info", text: `Postes vacants, faute de bras : ${partial.join(", ")}.` });
  return out;
}
