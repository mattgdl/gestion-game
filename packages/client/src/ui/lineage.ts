/**
 * Interface de la lignée (J3) : panneau Lignée, fenêtres d'affaire de famille, de succession
 * et de chronique. Lecture seule de la simulation : les choix passent par des commandes
 * (decreeLaw, familyDecision) envoyées par le Hud.
 */
import {
  DEMOGRAPHY,
  DYNASTY,
  LAW_HINTS,
  LAW_NAMES,
  SUCCESSION_LAWS,
  TICKS_PER_YEAR,
  bySex,
  dateOf,
  type DomainSim,
  type DynastyMember,
} from "@jeu/sim-fief";
import { escapeHtml } from "./format";

function e(text: string): string {
  return escapeHtml(text);
}

/** « an 4, été » */
export function when(tick: number): string {
  const d = dateOf(tick);
  return `an ${d.year}, ${d.seasonName.toLowerCase()}`;
}

/** Lien de parenté lisible d'un membre avec le seigneur (fils, fille, frère, petite-fille…). */
export function relation(sim: DomainSim, m: DynastyMember): string {
  const dyn = sim.dynasty;
  const lord = dyn.lord;
  if (!lord) return "";
  const isChildOf = (x: DynastyMember | undefined, parentId: number) => x !== undefined && (x.fatherId === parentId || x.motherId === parentId);
  if (m.id === lord.id) return bySex(m.sex, "seigneur", "dame");
  if (lord.spouseIds.includes(m.id)) return bySex(m.sex, "époux", "épouse");
  if (m.id === lord.fatherId || m.id === lord.motherId) return bySex(m.sex, "père", "mère");
  if (isChildOf(m, lord.id)) return bySex(m.sex, "fils", "fille");
  const parents = [dyn.member(m.fatherId), dyn.member(m.motherId)];
  if (parents.some((p) => isChildOf(p, lord.id))) return bySex(m.sex, "petit-fils", "petite-fille");
  const lordParents = [lord.fatherId, lord.motherId].filter((p): p is number => p !== null);
  const sibling = (x: DynastyMember | undefined) => x !== undefined && x.id !== lord.id && lordParents.some((p) => isChildOf(x, p));
  if (m.blood && sibling(m)) return bySex(m.sex, "frère", "sœur");
  if (m.blood && parents.some((p) => sibling(p))) return bySex(m.sex, "neveu", "nièce");
  if (!m.blood) {
    const spouses = m.spouseIds.map((id) => dyn.member(id));
    if (spouses.some((x) => isChildOf(x, lord.id))) return bySex(m.sex, "gendre", "belle-fille");
    if (spouses.some((x) => sibling(x))) return bySex(m.sex, "beau-frère", "belle-sœur");
    return bySex(m.sex, "allié", "alliée");
  }
  return bySex(m.sex, "cousin", "cousine");
}

function person(sim: DomainSim, m: DynastyMember): string {
  return `${e(m.name)}, ${sim.dynasty.ageOf(m)} ans`;
}

/** Années fécondes d'un couple, et nombre d'enfants à attendre en moyenne. */
export function fertility(womanAge: number): { years: number; children: number } {
  const f = DEMOGRAPHY.fecondite;
  const years = Math.max(0, f.ageMax - Math.max(womanAge, f.ageMin));
  const perYear = TICKS_PER_YEAR / 15 / f.intervalleMoyenJours;
  return { years, children: Math.round(years * perYear) };
}

export function lineagePanelHtml(sim: DomainSim): string {
  const dyn = sim.dynasty;
  const d = sim.state.dynasty;
  const lord = dyn.lord;
  if (!lord) {
    return `<p class="bad">La ${e(d.name)} s'est éteinte.</p><button type="button" class="btn btn-small" data-act="chronicle">Chronique de la lignée</button>`;
  }
  const facts: string[] = [];
  const founded = d.reigns[0] ? dateOf(d.reigns[0].fromTick).year : 1;
  facts.push(`<div><dt>Maison</dt><dd>${e(d.name)} <span class="muted">(fondée en l'an ${founded}, ${d.reigns.length}<sup>${d.reigns.length === 1 ? "er" : "e"}</sup> règne)</span></dd></div>`);
  facts.push(`<div><dt>${bySex(lord.sex, "Seigneur", "Dame")}</dt><dd>${person(sim, lord)}</dd></div>`);
  const spouse = dyn.livingSpouse(lord);
  if (spouse) {
    facts.push(`<div><dt>${bySex(spouse.sex, "Époux", "Épouse")}</dt><dd>${person(sim, spouse)}${spouse.house ? ` <span class="muted">(${e(spouse.house)})</span>` : ""}</dd></div>`);
  } else if (lord.spouseIds.length > 0) {
    facts.push(`<div><dt>Conjoint</dt><dd class="muted">${bySex(lord.sex, "veuf", "veuve")}</dd></div>`);
  }
  if (d.regency) {
    const regent = dyn.member(d.regency.regentId);
    facts.push(
      `<div><dt>Régence</dt><dd class="warn">${regent ? e(regent.name) : "Un conseil"} gouverne jusqu'aux ${DYNASTY.majorite} ans de ${e(lord.name)} (moral ${DYNASTY.regence.moral})</dd></div>`,
    );
  }
  const line = dyn.lineOfSuccession();
  const heir = dyn.member(line[0]);
  if (heir) {
    facts.push(`<div><dt>Héritier</dt><dd>${person(sim, heir)} <span class="muted">(${relation(sim, heir)})</span></dd></div>`);
  } else {
    facts.push(`<div><dt>Héritier</dt><dd class="bad">aucun : à sa mort, la lignée s'éteint</dd></div>`);
  }
  if (line.length > 1) {
    const rest = line.slice(1, 4).map((id) => e(dyn.member(id)?.name ?? "?"));
    facts.push(`<div><dt>Puis</dt><dd>${rest.join(", ")}${line.length > 4 ? ` <span class="muted">et ${line.length - 4} autre${line.length - 4 > 1 ? "s" : ""}</span>` : ""}</dd></div>`);
  }
  const p = dyn.prestige();
  facts.push(
    `<div><dt>Prestige</dt><dd>${p.total} <span class="muted">(${p.parts
      .filter((x) => x.value !== 0)
      .map((x) => `${x.label.toLowerCase()} ${x.value}`)
      .join(", ")})</span></dd></div>`,
  );

  const family = d.members
    .filter((m) => m.status === "vivant" && m.id !== lord.id && m.id !== spouse?.id)
    .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  const familyHtml =
    family.length === 0
      ? ""
      : `<h3>Famille au manoir</h3><ul class="kin">${family
          .map((m) => {
            const rank = line.indexOf(m.id);
            const married = dyn.livingSpouse(m);
            const tag = rank >= 0 ? `<span class="kin-rank" title="Rang dans l'ordre de succession">n° ${rank + 1}</span>` : "";
            const note = married ? ` · ${bySex(m.sex, "marié", "mariée")}` : m.spouseIds.length > 0 ? ` · ${bySex(m.sex, "veuf", "veuve")}` : "";
            return `<li>${tag}${e(m.name)} <span class="muted">${dyn.ageOf(m)} ans · ${relation(sim, m)}${note}</span></li>`;
          })
          .join("")}</ul>`;

  const decisions = d.decisions
    .map((x) => dyn.member(x.memberId))
    .filter((m): m is DynastyMember => m !== undefined)
    .map(
      (m) =>
        `<li><span>${person(sim, m)} attend votre décision</span><button type="button" class="btn btn-small btn-primary" data-decide="${m.id}">Décider</button></li>`,
    )
    .join("");
  const decisionsHtml = decisions ? `<h3>Affaires de famille</h3><ul class="matters">${decisions}</ul>` : "";

  const laws = SUCCESSION_LAWS.map((law) => {
    const on = law === d.law;
    const pending = d.pendingLaw?.law === law;
    return `<button type="button" class="btn btn-small${on ? " is-active" : ""}${pending ? " is-pending" : ""}" data-law="${law}" aria-pressed="${on}" title="${e(LAW_HINTS[law])}">${e(LAW_NAMES[law])}</button>`;
  }).join("");
  let lawHint = e(LAW_HINTS[d.law]);
  if (d.pendingLaw) {
    const after = dyn.member(dyn.lineOfSuccession(d.pendingLaw.law)[0]);
    lawHint = `Décret pris : « ${e(LAW_NAMES[d.pendingLaw.law])} » à partir de l'${when(d.pendingLaw.effectiveTick)}. ${
      after ? `L'héritier serait alors ${e(after.name)}.` : `<span class="bad">Il n'y aurait alors plus aucun héritier.</span>`
    } Cliquez sur la loi en vigueur pour annuler.`;
  }

  return `<dl class="facts">${facts.join("")}</dl>
    ${decisionsHtml}
    ${familyHtml}
    <div class="tax tax-stack" role="group" aria-label="Loi de succession">
      <span class="tax-label">Loi de succession <span class="muted">(un décret s'applique un an plus tard)</span></span>
      ${laws}
    </div>
    <p class="muted small">${lawHint}</p>
    <button type="button" class="btn btn-small" data-act="chronicle">Chronique de la lignée</button>`;
}

/** Fenêtre « Avenir de … » : prétendants, Église, alliance, remariage. */
export function decisionHtml(sim: DomainSim, memberId: number): { title: string; body: string } | null {
  const dyn = sim.dynasty;
  const dec = dyn.decisionFor(memberId);
  const m = dyn.member(memberId);
  if (!dec || !m) return null;
  const d = sim.state.dynasty;
  const isLord = m.id === d.lordId;
  const widowed = m.spouseIds.length > 0;
  const tick = sim.state.tick;
  const line = dyn.lineOfSuccession();
  const parents = [dyn.member(m.fatherId), dyn.member(m.motherId)].filter((p): p is DynastyMember => p !== undefined);
  let intro = `<p>${person(sim, m)}${parents.length > 0 && !isLord ? `, ${bySex(m.sex, "fils", "fille")} de ${parents.map((p) => e(p.name)).join(" et ")}` : ""}.`;
  if (isLord) intro += widowed ? ` ${bySex(m.sex, "Veuf", "Veuve")} : un remariage peut donner de nouveaux héritiers.` : " Il faut un héritier à la lignée.";
  else if (line[0] === m.id) intro += ` <strong class="warn">${bySex(m.sex, "Héritier", "Héritière")} :</strong> l'envoyer au loin le retire de la succession.`;
  else if (line.includes(m.id)) intro += ` N° ${line.indexOf(m.id) + 1} dans l'ordre de succession.`;
  intro += "</p>";
  const cards = dec.suitors
    .map((s, i) => {
      const age = Math.floor((tick - s.birthTick) / TICKS_PER_YEAR);
      const womanAge = m.sex === "F" ? dyn.ageOf(m) : age;
      const f = fertility(womanAge);
      return `<div class="suitor">
        <div class="suitor-name">${e(s.name)}, ${age} ans</div>
        <div class="muted small">${e(s.house)}</div>
        <div class="suitor-dowry">Dot : ${s.dowry} or</div>
        <div class="muted small">${f.years > 0 ? `${f.years} années fécondes, environ ${f.children} enfant${f.children > 1 ? "s" : ""}` : "Plus d'enfant à attendre"}</div>
        <button type="button" class="btn btn-primary btn-small" data-choice="${i}">Épouser</button>
      </div>`;
    })
    .join("");
  const others: string[] = [];
  if (!isLord) {
    others.push(`<button type="button" class="btn" data-choice="eglise">Entrer dans l'Église <span class="muted">(+${DYNASTY.eglise.prestige} prestige)</span></button>`);
    others.push(
      `<button type="button" class="btn" data-choice="alliance">Marier chez un voisin <span class="muted">(+${DYNASTY.alliance.or} or, +${DYNASTY.alliance.prestige} prestige)</span></button>`,
    );
  }
  if (isLord && widowed) others.push(`<button type="button" class="btn" data-choice="refuser">Rester ${bySex(m.sex, "veuf", "veuve")}</button>`);
  others.push(`<button type="button" class="btn" data-act="close">Plus tard</button>`);
  const note = isLord ? "" : `<p class="muted small">Marié au domaine, il ou elle vit au manoir et ses enfants entrent dans l'ordre de succession. L'Église et le mariage chez un voisin l'en font sortir pour toujours.</p>`;
  return {
    title: `Avenir de ${m.name}`,
    body: `${intro}<div class="suitors">${cards}</div>${note}<div class="modal-actions">${others.join("")}</div>`,
  };
}

/** Fenêtre de succession, à la mort du seigneur. */
export function successionHtml(sim: DomainSim, deadId: number, heirId: number): { title: string; body: string } {
  const dyn = sim.dynasty;
  const d = sim.state.dynasty;
  const dead = dyn.member(deadId);
  const heir = dyn.member(heirId);
  const reign = d.reigns.find((r) => r.lordId === deadId);
  const years = reign && reign.toTick !== null ? Math.floor((reign.toTick - reign.fromTick) / TICKS_PER_YEAR) : 0;
  const title = dead ? `${bySex(dead.sex, "Le seigneur est mort", "La dame est morte")}` : "Succession";
  let body = "";
  if (dead) body += `<p>${e(dead.name)} ${bySex(dead.sex, "est mort", "est morte")} à ${dyn.ageOf(dead)} ans, après ${years} an${years > 1 ? "s" : ""} de règne.</p>`;
  if (heir) {
    body += `<p><strong>${e(heir.name)}</strong>, ${dyn.ageOf(heir)} ans, devient ${bySex(heir.sex, "seigneur", "dame")} de la ${e(d.name)}`;
    if (d.regency) {
      const regent = dyn.member(d.regency.regentId);
      body += `, sous la régence de ${regent ? e(regent.name) : "un conseil"} jusqu'à ses ${DYNASTY.majorite} ans <span class="warn">(moral du village ${DYNASTY.regence.moral})</span>`;
    }
    body += ".</p>";
  }
  const next = dyn.heir();
  body += next
    ? `<p>Héritier désormais : ${person(sim, next)} (${relation(sim, next)}).</p>`
    : `<p class="bad">Plus aucun héritier : si ${heir ? e(heir.name) : "le seigneur"} meurt sans enfant, la lignée s'éteint.${
        heir && !dyn.livingSpouse(heir) ? ` ${bySex(heir.sex, "Mariez-le", "Mariez-la")} au plus vite.` : ""
      }</p>`;
  body += `<div class="modal-actions"><button type="button" class="btn" data-act="chronicle">Chronique</button><button type="button" class="btn btn-primary" data-act="close">Continuer</button></div>`;
  return { title, body };
}

/** Règnes et chronique de la lignée. */
export function chronicleHtml(sim: DomainSim): string {
  const dyn = sim.dynasty;
  const d = sim.state.dynasty;
  const reigns = d.reigns
    .map((r, i) => {
      const m = dyn.member(r.lordId);
      const from = dateOf(r.fromTick).year;
      const to = r.toTick === null ? "aujourd'hui" : `an ${dateOf(r.toTick).year}`;
      return `<li><strong>${i + 1}. ${e(m?.name ?? "?")}</strong> <span class="muted">— an ${from} à ${to}</span></li>`;
    })
    .join("");
  const entries = [...d.chronicle]
    .reverse()
    .map((c) => `<li><span class="muted">${when(c.tick)}</span> — ${e(c.text)}</li>`)
    .join("");
  return `<h3>Règnes</h3><ol class="reigns">${reigns}</ol><h3>Chronique</h3><ol class="chronicle">${entries}</ol>`;
}
