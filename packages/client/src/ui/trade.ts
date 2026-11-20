/**
 * Interface du commerce (J5) : propositions des seigneurs IA, accords en cours, propositions
 * du domaine, fenêtre « Proposer un accord ». Lecture seule : tout passe par des commandes.
 */
import { TRADE_GOODS, deNom, type TradeGood, type TradeTerms } from "@jeu/shared";
import { GOOD_NAMES, type DomainSim } from "@jeu/sim-fief";
import { IA, activeAiLords, archetypeOf, fiefById, goodLabel, lordById, lordTradeRoom, nearestFiefOf, unitPrice, type Lord, type WorldState } from "@jeu/sim-monde";
import { escapeHtml } from "./format";

const e = escapeHtml;

/** « le Marchand · relation +20 » */
export function lordTag(lord: Lord | undefined, ownerId: string): string {
  if (!lord?.ai) return "";
  const rel = lord.ai.relations[ownerId] ?? 0;
  const tone = rel >= 20 ? "ok" : rel <= -20 ? "warn" : "muted";
  return `${e(archetypeOf(lord.ai.archetype).nom)} · <span class="${tone}">relation ${rel > 0 ? "+" : ""}${rel}</span>`;
}

function termsText(t: TradeTerms): string {
  const verb = t.side === "vente" ? "Vous livrez" : "Vous achetez";
  return `${verb} <strong>${t.perYear} ${e(goodLabel(t.good))}</strong> par an à <strong>${t.price} or</strong> l'unité (${t.perYear * t.price} or par an)`;
}

function yearsText(t: TradeTerms): string {
  return t.firstYear === t.lastYear ? `l'an ${t.firstYear}` : `de l'an ${t.firstYear} à l'an ${t.lastYear}`;
}

/** Jours de route (aller) depuis le relais le plus proche, si l'on en a un. */
function travelText(sim: DomainSim, partnerFiefId: string): string {
  const relays = sim.trade.relays();
  if (relays.length === 0) return "aucun relais";
  const days = Math.min(...relays.map((r) => sim.trade.travelDays(r, partnerFiefId)));
  return `${days} jours de route`;
}

export function tradePanelHtml(world: WorldState, sim: DomainSim): string {
  const me = sim.state.ownerId;
  const t = sim.state.trade;
  const parts: string[] = [];
  const relays = sim.trade.relays();
  if (t.proposals.length > 0) {
    const cards = t.proposals
      .map((p) => {
        const lord = lordById(world, p.terms.partnerId);
        const fief = fiefById(world, p.terms.partnerFiefId);
        return `<li class="sale">
          <span><strong>${e(lord?.name ?? "Un voisin")}</strong> <span class="muted small">${lordTag(lord, me)}</span></span>
          <span class="small">${termsText(p.terms)}, ${yearsText(p.terms)}.</span>
          <span class="muted small">Convois vers ${e(fief?.name ?? "son fief")} (${travelText(sim, p.terms.partnerFiefId)}). Réponse avant le bilan de l'an ${p.expiresYear}.</span>
          <span class="sale-actions"><button type="button" class="btn btn-small btn-primary" data-accept="${e(p.terms.id)}">Accepter</button><button type="button" class="btn btn-small" data-refuse="${e(p.terms.id)}">Refuser</button></span>
        </li>`;
      })
      .join("");
    parts.push(`<h3>Propositions</h3><ul class="sales">${cards}</ul>`);
  }
  if (t.agreements.length > 0) {
    const cards = t.agreements
      .map((a) => {
        const lord = lordById(world, a.terms.partnerId);
        const active = sim.trade.isActive(a);
        const due = sim.trade.due(a);
        const convoys = t.convoys.filter((c) => c.agreementId === a.terms.id).length;
        const progress = active
          ? `${a.terms.side === "vente" ? "Livré" : "Reçu"} cette année : <strong>${a.done} / ${due}</strong>${convoys > 0 ? ` · ${convoys} charrette${convoys > 1 ? "s" : ""} en route` : ""}`
          : `Commence en l'an ${a.terms.firstYear}.`;
        return `<li class="sale">
          <span><strong>${e(lord?.name ?? "Un voisin")}</strong> <span class="muted small">${lordTag(lord, me)}</span></span>
          <span class="small">${termsText(a.terms)}, ${yearsText(a.terms)}.</span>
          <span class="small">${progress}</span>
          <span class="sale-actions"><button type="button" class="btn btn-small" data-break="${e(a.terms.id)}" title="La relation en souffre (${IA.commerce.relation.rompu})">Rompre</button></span>
        </li>`;
      })
      .join("");
    parts.push(`<h3>Accords en cours</h3><ul class="sales">${cards}</ul>`);
  }
  if (t.pending.length > 0) {
    const items = t.pending
      .map((p) => {
        const lord = lordById(world, p.partnerId);
        return `<li class="sale"><span class="small">À la ${e(lord?.name ?? "maison voisine")} : ${p.side === "vente" ? "vendre" : "acheter"} ${p.perYear} ${e(goodLabel(p.good))} par an à ${p.price} or, ${p.years} an${p.years > 1 ? "s" : ""}. Réponse au bilan.</span>
          <span class="sale-actions"><button type="button" class="btn btn-small" data-withdraw="${e(p.actionId)}">Retirer</button></span></li>`;
      })
      .join("");
    parts.push(`<h3>Vos propositions</h3><ul class="sales">${items}</ul>`);
  }
  if (parts.length === 0) parts.push(`<p class="muted small">Aucun accord. Les seigneurs voisins proposent parfois des accords au bilan d'automne ; vous pouvez aussi en proposer.</p>`);
  const relayNote =
    relays.length === 0
      ? `<p class="warn small">Sans relais, aucun convoi ne part : bâtissez-en un (touche Y).</p>`
      : `<p class="muted small">${relays.length} relais · ${t.convoys.length} charrette${t.convoys.length > 1 ? "s" : ""} en route.</p>`;
  return `${parts.join("")}${relayNote}<button type="button" class="btn btn-small" data-act="propose">Proposer un accord</button>`;
}

/** Seigneurs IA avec qui l'on peut commercer, du plus proche au plus lointain. */
export function tradePartners(world: WorldState, ownerId: string): { lord: Lord; fiefId: string; distance: number }[] {
  // Les autres joueurs (J7) aussi : on ne peut que leur vendre.
  const players = world.lords.filter((l) => !l.ai && l.id !== ownerId && world.fiefs.some((f) => f.ownerId === l.id));
  return [...activeAiLords(world), ...players]
    .map((lord) => {
      const near = nearestFiefOf(world, lord.id, ownerId);
      return near ? { lord, fiefId: near.fief.id, distance: near.distance } : null;
    })
    .filter((x): x is { lord: Lord; fiefId: string; distance: number } => x !== null)
    .sort((a, b) => a.distance - b.distance || (a.lord.id < b.lord.id ? -1 : 1));
}

/** Ce que ce seigneur vend et achète, avec ses prix : pour guider une proposition. */
export function partnerMarketHtml(world: WorldState, ownerId: string, lordId: string): string {
  const lord = lordById(world, lordId);
  const near = lord ? nearestFiefOf(world, lordId, ownerId) : null;
  if (lord && !lord.ai && near) return `<p class="small">${e(lord.pseudo ?? lord.name)} est un autre joueur : vous pouvez seulement lui <strong>vendre</strong> (il accepte ou refuse lui-même, et paie à chaque livraison). Pour lui acheter, demandez-lui par message de vous faire une proposition.</p>`;
  if (!lord?.ai || !near) return "";
  const rows = TRADE_GOODS.map((g) => {
    const room = lordTradeRoom(world, lord, g);
    const buy = unitPrice(world, lord, near.fief, g, "achat", ownerId);
    const sell = unitPrice(world, lord, near.fief, g, "vente", ownerId);
    return `<tr><th scope="row">${e(GOOD_NAMES[g])}</th>
      <td class="num">${room.surplus > 0 ? `${room.surplus} / an` : "—"}</td><td class="num">${buy} or</td>
      <td class="num">${room.manque > 0 ? `${room.manque} / an` : "—"}</td><td class="num">${sell} or</td></tr>`;
  }).join("");
  return `<p class="small">${e(lord.name)} — ${lordTag(lord, ownerId)}. ${e(archetypeOf(lord.ai.archetype).description)}</p>
    <div class="fair-wrap"><table class="fair"><thead><tr><th></th><th>Il vend</th><th>Son prix</th><th>Il lui manque</th><th>Il paie</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Fenêtre « Proposer un accord ». */
export function proposeHtml(world: WorldState, sim: DomainSim, lordId?: string): string {
  const me = sim.state.ownerId;
  const partners = tradePartners(world, me);
  const chosen = lordId ?? partners[0]?.lord.id ?? "";
  const options = partners
    .map((p) => {
      const fief = fiefById(world, p.fiefId);
      return `<option value="${e(p.lord.id)}" ${p.lord.id === chosen ? "selected" : ""}>${e(p.lord.pseudo ? `${p.lord.pseudo} — ${p.lord.name}` : p.lord.name)} (${e(p.lord.ai ? archetypeOf(p.lord.ai.archetype).nom : "joueur")}, ${p.distance} fief${p.distance > 1 ? "s" : ""} ${fief ? `· ${e(fief.name)}` : ""})</option>`;
    })
    .join("");
  const goods = TRADE_GOODS.map((g) => `<option value="${g}">${e(GOOD_NAMES[g as TradeGood])}</option>`).join("");
  return `<label class="offer-row">Seigneur <select data-el="tpLord">${options}</select></label>
    <div data-el="tpMarket">${partnerMarketHtml(world, me, chosen)}</div>
    <div class="offer-grid">
      <label class="offer-row">Vous <select data-el="tpSide"><option value="vente">vendez</option><option value="achat">achetez</option></select></label>
      <label class="offer-row">Marchandise <select data-el="tpGood">${goods}</select></label>
      <label class="offer-row">Par an <input type="number" min="5" max="300" step="5" value="20" data-el="tpQty" /></label>
      <label class="offer-row">Prix (or l'unité) <input type="number" min="1" max="100" step="1" value="3" data-el="tpPrice" /></label>
      <label class="offer-row">Durée (ans) <input type="number" min="1" max="5" step="1" value="3" data-el="tpYears" /></label>
    </div>
    <p class="muted small">Réponse au bilan d'automne ; si le seigneur accepte, les convois partent l'an suivant depuis votre relais. Il refuse un prix moins bon que le sien, ou plus de marchandise qu'il n'en a ou n'en veut.</p>
    <p class="warn small" data-el="tpError" hidden></p>
    <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="button" class="btn btn-primary" data-act="tpSend">Proposer</button></div>`;
}

/** Prix que le seigneur proposerait pour cette marchandise et ce sens (pour préremplir). */
export function suggestedPrice(world: WorldState, ownerId: string, lordId: string, good: TradeGood, side: "vente" | "achat"): number {
  const lord = lordById(world, lordId);
  const near = lord ? nearestFiefOf(world, lordId, ownerId) : null;
  if (!lord || !near) return IA.commerce.prixBase[good];
  return unitPrice(world, lord, near.fief, good, side, ownerId);
}

/** Rumeurs d'achats préparés par les seigneurs IA qui touchent le domaine. */
export function rumors(world: WorldState, ownerId: string): string[] {
  const mine = world.fiefs.filter((f) => f.ownerId === ownerId);
  const out: string[] = [];
  for (const lord of activeAiLords(world)) {
    const plan = lord.ai?.plan;
    if (!plan) continue;
    const target = fiefById(world, plan.fiefId);
    if (!target) continue;
    const near = mine.some((m) => Math.abs(m.col - target.col) + Math.abs(m.row - target.row) === 1);
    if (near) out.push(`La ${lord.name} prépare l'achat ${deNom(target.name)} au bilan de l'an ${plan.year}.`);
  }
  return out;
}
