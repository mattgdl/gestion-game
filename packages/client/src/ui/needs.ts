/**
 * Interface des besoins (J4b) : outils, vêtements, épidémie, foire d'automne.
 * Lecture seule : les échanges passent par la commande « trade ».
 */
import { DEMOGRAPHY, GOOD_NAMES, NEEDS, type DomainSim, type GoodId } from "@jeu/sim-fief";
import { escapeHtml } from "./format";

const pct = (permille: number) => `${Math.round(permille / 10)} %`;

/** Lignes du panneau Village : réserves et couverture des besoins, natalité. */
export function needsFacts(sim: DomainSim): string[] {
  const eco = sim.economy;
  const n = sim.state.needs;
  const chain = sim.needs.chain();
  const toolsTip = sim.needs.toolsAdvice();
  const clothesTip = sim.needs.clothesAdvice();
  const tools = `${eco.stockOf("outils")} en réserve · besoins servis ${pct(n.outils.coverage)} <span class="muted">(production +${Math.round((eco.toolFactor() - 1000) / 10)} %)</span>
    <br><span class="muted small">Il en faut ${chain.besoinOutils} par an ; la forge en fait ${chain.outils}.</span>${toolsTip ? `<br><span class="warn small">${escapeHtml(toolsTip)}</span>` : ""}`;
  const clothes = `${eco.stockOf("vetements")} en réserve · besoins servis ${pct(n.vetements.coverage)}${n.vetements.coverage >= NEEDS.seuilMoralPourMille ? ' <span class="ok">(moral +10)</span>' : ` <span class="muted">(moral +10 à partir de ${pct(NEEDS.seuilMoralPourMille)})</span>`}
    <br><span class="muted small">Il en faut ${chain.besoinVetements} par an ; laine : ${chain.laine} par an, tisserands : ${chain.tissage} vêtements par an${eco.stockOf("laine") > 0 ? `, ${eco.stockOf("laine")} laines en réserve` : ""}.</span>${clothesTip ? `<br><span class="warn small">${escapeHtml(clothesTip)}</span>` : ""}`;
  const days = sim.needs.birthInterval(sim.population.morale());
  const idle = sim.population.idleMalus();
  return [
    `<div><dt>Outils</dt><dd>${tools}</dd></div>`,
    `<div><dt>Vêtements</dt><dd>${clothes}</dd></div>`,
    `<div><dt>Naissances</dt><dd>une tous les ${(days / 120).toFixed(1).replace(".", ",")} ans par foyer <span class="muted">(1,5 à 2,5 ans : le moral, multiplié par les vêtements et les outils)</span></dd></div>`,
    `<div><dt>Sans emploi</dt><dd>${idle.pct} % des travailleurs${idle.malus < 0 ? ` <span class="warn">(moral ${idle.malus})</span>` : ` <span class="muted">(moral touché au-delà de ${DEMOGRAPHY.moral.chomage.toleranceParCent} %)</span>`}</dd></div>`,
  ];
}

const FAIR_GOODS: GoodId[] = ["nourriture", "bois", "pierre", "laine", "outils", "vetements"];

/** Jours de vivres gardés de côté quand on estime ce qu'on peut vendre. */
const FOOD_KEPT_DAYS = 120;

/** Or qu'on tirerait de la foire en vendant ses surplus (vivres : au-delà de 120 jours d'avance). */
export function fairPotential(sim: DomainSim): number {
  let gold = 0;
  for (const g of FAIR_GOODS) {
    const price = NEEDS.foire.prix[g];
    if (!price) continue;
    let stock = sim.economy.stockOf(g);
    if (g === "nourriture") stock = Math.max(0, stock - Math.ceil((sim.population.dailyFoodNeed() * FOOD_KEPT_DAYS) / 1000));
    gold += Math.min(stock, sim.needs.fairLeft(g, "vente")) * price.vente;
  }
  return gold;
}

/** Fenêtre de la foire d'automne. */
export function fairHtml(sim: DomainSim): string {
  const open = sim.needs.fairOpen();
  const rows = FAIR_GOODS.map((g) => {
    const price = NEEDS.foire.prix[g];
    if (!price) return "";
    const stock = sim.economy.stockOf(g);
    const buyLeft = sim.needs.fairLeft(g, "achat");
    const sellLeft = sim.needs.fairLeft(g, "vente");
    const btn = (side: "achat" | "vente", q: number, left: number) =>
      `<button type="button" class="btn btn-small" data-trade="${g}" data-side="${side}" data-qty="${q}" ${!open || left < q ? "disabled" : ""}>${side === "achat" ? "+" : "−"}${q}</button>`;
    return `<tr>
      <th scope="row">${escapeHtml(GOOD_NAMES[g])}</th>
      <td class="num">${stock}</td>
      <td class="num">${price.achat} or</td><td>${btn("achat", 10, buyLeft)}${btn("achat", 1, buyLeft)}</td>
      <td class="num">${price.vente} or</td><td>${btn("vente", 1, sellLeft)}${btn("vente", 10, sellLeft)}</td>
    </tr>`;
  }).join("");
  return `<p>${open ? "Un marchand ambulant tient boutique tout l'automne." : '<span class="warn">La foire se tient en automne.</span>'} Trésor : <strong>${sim.state.treasury} or</strong>. Il n'achète et ne vend que ${NEEDS.foire.plafondParAn} unités de chaque marchandise par an.</p>
    <div class="fair-wrap"><table class="fair">
      <thead><tr><th></th><th>En réserve</th><th>Il vend</th><th>Acheter</th><th>Il achète</th><th>Vendre</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="close">Fermer</button></div>`;
}
