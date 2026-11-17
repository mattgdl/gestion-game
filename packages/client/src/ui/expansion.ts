/**
 * Interface de l'expansion (J4) : fiefs voisins à vendre, offres en cours, titres, fenêtre
 * d'offre. Lecture seule : les offres passent par les commandes makeOffer et cancelOffer.
 */
import { DOMINANTS, deNom } from "@jeu/shared";
import { TITLES, titleDef, type DomainSim } from "@jeu/sim-fief";
import { PLAYER_ID, adjacent, archetypeOf, lordById, priceRange, type FiefMeta, type WorldState } from "@jeu/sim-monde";
import { escapeHtml } from "./format";
import { lordTag, rumors } from "./trade";

const e = escapeHtml;

export interface NeighborFief {
  meta: FiefMeta;
  range: [number, number];
  offer: number | null;
}

/** Fiefs IA qui touchent le domaine : les seuls qu'on peut acheter. */
export function neighborFiefs(world: WorldState, sim: DomainSim): NeighborFief[] {
  const mine = world.fiefs.filter((f) => f.ownerId === PLAYER_ID);
  return world.fiefs
    .filter((f) => f.ownerId !== null && f.ownerId !== PLAYER_ID && f.ownerId.startsWith("ia-") && mine.some((m) => adjacent(m, f)))
    .map((meta) => ({ meta, range: priceRange(world, meta, sim.state.ownerId), offer: sim.state.offers.find((o) => o.fiefId === meta.id)?.price ?? null }));
}

function landText(meta: FiefMeta): string {
  const total = meta.land.herbe + meta.land.foret + meta.land.roche + meta.land.eau;
  const pct = (n: number) => Math.round((n * 100) / Math.max(1, total));
  return `terre ${pct(meta.land.herbe)} % (fertilité ${meta.land.fertilite}), forêt ${pct(meta.land.foret)} %, roche ${pct(meta.land.roche)} %${meta.land.eau > 0 ? `, eau ${pct(meta.land.eau)} %` : ""}`;
}

/** « Baronnie de Clairfonds » */
export function realmName(sim: DomainSim, home: string): string {
  const t = titleDef(sim.state.dynasty.title) ?? TITLES[0]!;
  return `${t.domaine} ${deNom(home)}`;
}

/** Progression vers le titre suivant. */
export function nextTitleHtml(sim: DomainSim): string {
  const current = TITLES.findIndex((t) => t.id === sim.state.dynasty.title);
  const next = TITLES[current + 1];
  const name = sim.titleName();
  if (!next) return `<p class="muted small">Titre : <strong>${e(name)}</strong>, le plus haut.</p>`;
  const fiefs = Object.keys(sim.state.fiefs).length;
  const people = sim.state.villagers.length;
  const ok = (have: number, need: number) => `<span class="${have >= need ? "ok" : ""}">${have} / ${need}</span>`;
  return `<p class="small">Titre : <strong>${e(name)}</strong>. Pour devenir ${e(next.nomM)} : ${ok(fiefs, next.fiefs)} fiefs, ${ok(people, next.habitants)} habitants <span class="muted">(+${next.prestige} prestige, moral +${next.moral})</span>.</p>`;
}

export function domainPanelHtml(world: WorldState, sim: DomainSim): string {
  const mine = world.fiefs.filter((f) => f.ownerId === PLAYER_ID);
  const myList = mine
    .map((f) => `<li><button type="button" class="fief-item" data-fief="${f.id}"><span class="blazon" style="background:#2f6fd0"></span><span class="fief-text"><span class="fief-name">${e(f.name)}</span><span class="fief-meta">${e(DOMINANTS[f.dominant].nom)}</span></span></button></li>`)
    .join("");
  const neighbors = neighborFiefs(world, sim);
  const cards = neighbors
    .map(({ meta, range, offer }) => {
      const lord = lordById(world, meta.ownerId);
      const action =
        offer !== null
          ? `<span class="small">Offre en cours : <strong>${offer} or</strong> (réponse au bilan d'automne)</span><button type="button" class="btn btn-small" data-cancel="${meta.id}">Retirer</button>`
          : `<button type="button" class="btn btn-small btn-primary" data-offer="${meta.id}">Faire une offre</button>`;
      const siege = world.wars.find((w) => w.fiefId === meta.id);
      const warBtn = siege ? `<span class="small warn">Assiégé</span>` : `<button type="button" class="btn btn-small" data-war="${meta.id}">Guerre…</button>`;
      return `<li class="sale">
        <button type="button" class="sale-name" data-fief="${meta.id}">${e(meta.name)}</button>
        <span class="muted small">${e(DOMINANTS[meta.dominant].nom)} · ${e(lord?.name ?? "")}${lord?.ai ? ` · ${lordTag(lord, sim.state.ownerId)}` : ""}</span>
        <span class="small">Village : ${meta.households} foyer${meta.households > 1 ? "s" : ""} · ${landText(meta)}</span>
        <span class="small">Estimé entre <strong>${range[0]}</strong> et <strong>${range[1]}</strong> or</span>
        <span class="sale-actions">${action}${warBtn}</span>
      </li>`;
    })
    .join("");
  const others = world.fiefs.filter((f) => f.ownerId !== PLAYER_ID).length - neighbors.length;
  const talk = rumors(world, sim.state.ownerId);
  const rumorHtml = talk.length > 0 ? `<h3>Rumeurs</h3><ul class="rumors">${talk.map((t) => `<li class="small warn">${e(t)}</li>`).join("")}</ul>` : "";
  return `${nextTitleHtml(sim)}
    <h3>Vos fiefs</h3><ul class="fief-list">${myList}</ul>
    <h3>Voisins à vendre</h3>
    ${cards ? `<ul class="sales">${cards}</ul>` : `<p class="muted small">Aucun fief à vendre ne touche les vôtres.</p>`}
    ${rumorHtml}
    ${others > 0 ? `<p class="muted small">${others} autre${others > 1 ? "s" : ""} fief${others > 1 ? "s" : ""} plus loin : achetable${others > 1 ? "s" : ""} quand il${others > 1 ? "s toucheront" : " touchera"} les vôtres.</p>` : ""}`;
}

/** Fenêtre d'offre : prix proposé, fourchette, or disponible. */
export function offerHtml(world: WorldState, sim: DomainSim, fiefId: string): { title: string; body: string } | null {
  const n = neighborFiefs(world, sim).find((x) => x.meta.id === fiefId);
  if (!n) return null;
  const lord = lordById(world, n.meta.ownerId);
  const gold = sim.state.treasury;
  const suggested = Math.min(gold, Math.round((n.range[0] + n.range[1]) / 2 / 10) * 10);
  return {
    title: `Acheter ${n.meta.name}`,
    body: `<p>${e(lord?.name ?? "Son seigneur")} possède ${e(n.meta.name)} : ${e(DOMINANTS[n.meta.dominant].nom.toLowerCase())}, un village de ${n.meta.households} foyer${n.meta.households > 1 ? "s" : ""}, ${landText(n.meta)}.</p>
      ${lord?.ai ? `<p class="small">${e(lord.name)} : ${lordTag(lord, sim.state.ownerId)}. ${e(archetypeOf(lord.ai.archetype).description)}</p>` : ""}
      <p>Vos conseillers l'estiment entre <strong>${n.range[0]}</strong> et <strong>${n.range[1]}</strong> or. Le seigneur a son prix, qu'il ne dit pas ; il change d'une année à l'autre, selon son caractère et ce qu'il pense de vous.</p>
      <label class="offer-row">Votre offre <input type="number" min="1" max="${gold}" step="10" value="${suggested}" data-el="offerPrice" /> or <span class="muted small">(trésor : ${gold} or)</span></label>
      <p class="muted small">L'or est mis de côté tout de suite. Réponse au bilan d'automne : si le seigneur accepte, le fief et son village sont à vous ; sinon l'or revient, avec son avis. Vous pouvez retirer l'offre avant.</p>
      <p class="warn small" data-el="offerError" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="button" class="btn btn-primary" data-act="offer">Proposer</button></div>`,
  };
}
