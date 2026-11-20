/**
 * Affaires du domaine (J8) : événements en attente de décision, effets en cours.
 * Lecture seule : les réponses passent par la commande answerEvent.
 */
import { DAY_TICKS, dateOf, type DomainSim } from "@jeu/sim-fief";
import { escapeHtml } from "./format";

const e = escapeHtml;

const KIND: Record<string, string> = { recolte: "récolte", production: "ateliers", chauffage: "bois de chauffage", moral: "moral" };

export function affairsCount(sim: DomainSim): number {
  return sim.state.events.pending.length;
}

export function affairsHtml(sim: DomainSim): string {
  const st = sim.state;
  const items = st.events.pending
    .map((p) => {
      const v = sim.events.view(p);
      if (!v) return "";
      const def = v.options.find((o) => o.option.defaut)?.option;
      const by = dateOf(p.deadlineTick);
      const buttons = v.options
        .map(
          ({ option, ok, reason }) =>
            `<div class="affair-option"><button type="button" class="btn btn-small ${option.defaut ? "" : "btn-primary"}" data-evkey="${e(p.key)}" data-evopt="${e(option.id)}" ${ok ? "" : "disabled"}>${e(option.texte)}</button>
             <span class="muted small">${e(option.resume)}${ok ? "" : ` <span class="warn">${e(reason ?? "")}</span>`}</span></div>`,
        )
        .join("");
      return `<li class="affair">
        <strong>${e(v.def.titre)}</strong>
        <p class="small">${e(p.text)}</p>
        <div class="affair-options">${buttons}</div>
        <p class="muted small">Réponse avant le bilan d'automne de l'an ${by.year}${def ? ` ; sinon : « ${e(def.texte)} »` : ""}.</p>
      </li>`;
    })
    .join("");
  const now = st.tick;
  const effects = st.events.effects
    .filter((f) => f.kind !== "moral" && f.value !== 0)
    .map((f) => {
      const days = Math.ceil((f.untilTick - Math.max(now, f.fromTick)) / DAY_TICKS);
      const pct = Math.round(f.value / 10);
      const soon = f.fromTick > now ? ` à partir de ${dateOf(f.fromTick).seasonName.toLowerCase()} de l'an ${dateOf(f.fromTick).year}` : "";
      return `<li class="small">${e(f.label)} : ${KIND[f.kind] ?? f.kind} ${pct > 0 ? "+" : ""}${pct} %${soon} (${days} jours)</li>`;
    })
    .join("");
  if (!items && !effects) return "";
  return `${items ? `<ul class="affairs">${items}</ul>` : ""}${effects ? `<h3>Effets en cours</h3><ul class="effects">${effects}</ul>` : ""}`;
}
