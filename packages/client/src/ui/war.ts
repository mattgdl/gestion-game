/**
 * Interface de la guerre (J6) : armée du domaine, guerres en cours, déclarations, mercenaires,
 * fenêtre « Déclarer la guerre ». Lecture seule : tout passe par des commandes.
 */
import { deNom } from "@jeu/shared";
import { GUERRE_FIEF, type DomainSim } from "@jeu/sim-fief";
import { GUERRE, PLAYER_ID, adjacent, aiMercenaries, aiSoldiers, archetypeOf, checkWar, defenseOf, fiefById, isHomeFief, lordById, type WorldState } from "@jeu/sim-monde";
import { escapeHtml } from "./format";
import { lordTag } from "./trade";

const e = escapeHtml;

/** Force que le Monde comptera pour ce domaine (soldats, armes, mercenaires, moral), sans milice. */
function myStrength(sim: DomainSim): number {
  return sim.army.strength();
}

/** Défense du domaine : son armée et sa milice, avec le bonus du défenseur. */
function myDefense(sim: DomainSim): number {
  const militia = sim.state.families.filter((f) => !f.noble).length * GUERRE.forceMilice;
  return Math.floor(((myStrength(sim) + militia) * GUERRE.bonusDefense) / 1000);
}

/** Force d'attaque d'un seigneur IA (soldats et mercenaires qu'il peut louer). */
function aiAttack(world: WorldState, lordId: string): number {
  const lord = lordById(world, lordId);
  if (!lord?.ai) return 0;
  return aiSoldiers(world, lord) * GUERRE.forceSoldat + aiMercenaries(lord) * GUERRE.forceMercenaire;
}

function odds(attack: number, defense: number): string {
  if (defense <= 0) return '<span class="ok">largement favorable</span>';
  const r = attack / defense;
  if (r >= 1.3) return '<span class="ok">favorable</span>';
  if (r >= 1.0) return '<span class="warn">serré</span>';
  return '<span class="bad">défavorable</span>';
}

export function warPanelHtml(world: WorldState, sim: DomainSim): string {
  const me = sim.state.ownerId;
  const a = sim.state.army;
  const soldiers = sim.army.soldiers().length;
  const armed = sim.army.armed();
  const casernes = sim.army.casernes().length;
  const parts: string[] = [];
  parts.push(`<p class="small">${casernes === 0 ? '<span class="warn">Aucune caserne (touche V)</span>' : `${soldiers} soldat${soldiers > 1 ? "s" : ""}, dont ${armed} armé${armed > 1 ? "s" : ""}`}${a.mercenaries > 0 ? ` · ${a.mercenaries} mercenaire${a.mercenaries > 1 ? "s" : ""}` : ""} · force <strong>${myStrength(sim)}</strong> · défense du domaine <strong>${myDefense(sim)}</strong> <span class="muted">(milice comprise)</span></p>`);
  if (a.wars.length > 0) {
    const cards = a.wars
      .map((w) => {
        const fief = fiefById(world, w.fiefId);
        const attacking = w.attackerId === me;
        const enemy = lordById(world, attacking ? w.defenderId : w.attackerId);
        const att = attacking ? myStrength(sim) : aiAttack(world, w.attackerId);
        const def = fief ? defenseOf(world, fief) : 0;
        const myDef = attacking ? def : myDefense(sim);
        const goal = w.goal === "conquete" ? "conquête" : "pillage";
        const next = w.firstYear > sim.date.year ? `premier assaut au bilan de l'an ${w.firstYear}` : "assaut au prochain bilan";
        const need = w.goal === "conquete" ? ` · ${w.won} / ${GUERRE.assautsConquete} assauts gagnés` : "";
        return `<li class="sale">
          <span><strong>${attacking ? "Vous assiégez" : "Assiégé par"} ${e(enemy?.name ?? "un seigneur")}</strong> <span class="muted small">${lordTag(enemy, me)}</span></span>
          <span class="small">${e(fief?.name ?? "")} · ${goal} · ${next}${need} · ${w.lost} perdu${w.lost > 1 ? "s" : ""}</span>
          <span class="small">Forces estimées : attaque ${att} contre défense ${myDef} — ${attacking ? odds(att, myDef) : odds(myDef, att)} pour vous.</span>
          ${attacking ? `<span class="sale-actions"><button type="button" class="btn btn-small" data-endwar="${e(w.id)}">${a.ends.includes(w.id) ? "Levée au bilan" : "Lever le siège"}</button></span>` : ""}
        </li>`;
      })
      .join("");
    parts.push(`<h3>Guerres</h3><ul class="sales">${cards}</ul>`);
  }
  for (const p of a.pending) {
    const fief = fiefById(world, p.fiefId);
    parts.push(`<p class="small warn">Déclaration prête contre ${e(fief?.name ?? "")} (${p.goal === "conquete" ? "conquête" : "pillage"}) : elle partira au bilan. <button type="button" class="btn btn-small" data-unwar="${e(p.actionId)}">Retirer</button></p>`);
  }
  parts.push(`<div class="offer-row small">Mercenaires (${GUERRE_FIEF.prixMercenaire} or chacun, jusqu'au bilan) <input type="number" min="1" max="50" value="5" data-el="mercCount" /> <button type="button" class="btn btn-small" data-act="hire">Louer</button></div>`);
  parts.push(`<p class="muted small">Pour attaquer : section Fiefs voisins, bouton « Guerre… » d'un fief voisin.</p>`);
  return parts.join("");
}

/** Fenêtre « Déclarer la guerre » à un fief voisin. */
export function declareHtml(world: WorldState, sim: DomainSim, fiefId: string): { title: string; body: string } | null {
  const me = sim.state.ownerId;
  const meta = fiefById(world, fiefId);
  if (!meta || !meta.ownerId) return null;
  const lord = lordById(world, meta.ownerId);
  const verdict = checkWar(world, me, fiefId, "pillage");
  const attack = myStrength(sim);
  const defense = defenseOf(world, meta);
  const canConquer = !isHomeFief(world, meta);
  const others = world.lords.filter((l) => l.ai && l.id !== meta.ownerId && world.fiefs.some((f) => f.ownerId === l.id)).length;
  return {
    title: `Guerre contre ${lord?.name ?? meta.name}`,
    body: `<p>${e(lord?.name ?? "")} : ${lordTag(lord, me)}. ${lord?.ai ? e(archetypeOf(lord.ai.archetype).description) : ""}</p>
      <p>Votre force aujourd'hui : <strong>${attack}</strong>. Défense ${deNom(meta.name)} : <strong>${defense}</strong> (bonus du défenseur compris) — ${odds(attack, defense)}.</p>
      <p class="small">La déclaration part au bilan d'automne ; le premier assaut a lieu au bilan suivant, un par an. Conquête : ${GUERRE.assautsConquete} assauts gagnés ; pillage : un seul. Après ${GUERRE.assautsPerdus} assauts perdus, le siège est levé. Les deux camps perdent des soldats à chaque assaut.</p>
      <p class="warn small">Réputation : ${lord?.name ?? "ce seigneur"} ${GUERRE.relationCible}, les ${others} autres seigneurs ${GUERRE.relationAutres}. Les accords avec lui sont rompus. Moral du village ${GUERRE_FIEF.moralGuerre} pendant la guerre.</p>
      ${verdict.ok ? "" : `<p class="warn small">${e(verdict.reason)}</p>`}
      <p class="warn small" data-el="warError" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button>
        <button type="button" class="btn" data-goal="pillage" ${verdict.ok ? "" : "disabled"}>Piller</button>
        <button type="button" class="btn btn-danger" data-goal="conquete" ${verdict.ok && canConquer ? "" : "disabled"}>Conquérir</button></div>`,
  };
}

/** Fiefs voisins qu'on peut attaquer (de seigneurs IA, qui touchent les siens). */
export function attackableFiefs(world: WorldState, ownerId: string = PLAYER_ID): string[] {
  const mine = world.fiefs.filter((f) => f.ownerId === ownerId);
  return world.fiefs.filter((f) => f.ownerId && f.ownerId !== ownerId && mine.some((m) => adjacent(m, f))).map((f) => f.id);
}

/** Alertes de guerre : sièges en cours, assaut au prochain bilan, rapport de forces. */
export function warAlerts(world: WorldState, sim: DomainSim): { tone: "bad" | "warn" | "info"; text: string }[] {
  const out: { tone: "bad" | "warn" | "info"; text: string }[] = [];
  const me = sim.state.ownerId;
  for (const w of sim.state.army.wars) {
    const fief = fiefById(world, w.fiefId);
    const enemy = lordById(world, w.attackerId === me ? w.defenderId : w.attackerId);
    if (w.defenderId === me) {
      const att = aiAttack(world, w.attackerId);
      const def = myDefense(sim);
      out.push({
        tone: def >= att ? "warn" : "bad",
        text: `Guerre : la ${enemy?.name ?? "maison voisine"} assiège ${fief?.name ?? "votre fief"} (${w.goal === "conquete" ? "conquête" : "pillage"}). Attaque estimée ${att} contre votre défense ${def} : ${def >= att ? "vous devriez tenir" : "renforcez-vous (caserne, armes, mercenaires)"}.`,
      });
    } else {
      out.push({ tone: "info", text: `Siège de ${fief?.name ?? "ce fief"} en cours : ${w.won} assaut${w.won > 1 ? "s" : ""} gagné${w.won > 1 ? "s" : ""}.` });
    }
  }
  return out;
}
