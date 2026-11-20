/**
 * Interface de la partie à plusieurs (J7) : salon, joueurs, messagerie, offres reçues,
 * classement final. Lecture seule : les réponses passent par des commandes ou par la salle.
 */
import { DOMINANTS } from "@jeu/shared";
import type { DomainSim } from "@jeu/sim-fief";
import { fiefById, lordById, type WorldState } from "@jeu/sim-monde";
import type { ChatLine } from "../net/multiplayer";
import type { RankingRow, RoomPlayer, RoomSettings } from "../net/protocol";
import { lordColor } from "../render/palette";
import { escapeHtml } from "./format";

const e = escapeHtml;

/** Durées proposées en années ; 0 = sans limite (l'hôte termine quand il veut). */
export const DUREES = [30, 60, 100, 150, 200, 0] as const;

export function dureeText(years: number): string {
  return years > 0 ? `${years} ans` : "durée libre";
}

/** « Mathilde (Maison Clairfonds) » pour un joueur, le nom de la maison pour une IA. */
export function lordLabel(world: WorldState, id: string | null): string {
  const lord = lordById(world, id);
  if (!lord) return "Sans seigneur";
  return lord.pseudo ? `${lord.pseudo} (${lord.name})` : lord.name;
}

/** Bloc « Jouer à plusieurs » du panneau Partie, hors salle. */
export function multiMenuHtml(resumable: string[], inArtifact: boolean, siteUrl: string): string {
  if (inArtifact)
    return `<h3>Jouer à plusieurs</h3>
    <p class="muted small">La partie à plusieurs (jusqu'à 8 joueurs) se joue sur le site du jeu, pas ici : cette page ne peut pas se relier aux autres navigateurs.</p>
    <p class="small"><a href="${e(siteUrl)}" target="_blank" rel="noopener">${e(siteUrl)}</a></p>`;
  const resume = resumable.length
    ? `<div class="save-row">${resumable.map((c) => `<button type="button" class="btn btn-small" data-mp="resume" data-code="${e(c)}">Reprendre la salle ${e(c)}</button>`).join("")}</div>`
    : "";
  return `<h3>Jouer à plusieurs</h3>
    <p class="muted small">Jusqu'à 8 joueurs sur une carte de 7 × 7 fiefs. L'hôte garde la page ouverte : son navigateur fait tourner le monde.</p>
    <div class="save-row">
      <button type="button" class="btn" data-mp="create">Créer une salle</button>
      <button type="button" class="btn" data-mp="join">Rejoindre</button>
    </div>${resume}`;
}

/** Bloc du panneau Partie pendant une partie à plusieurs. */
export function multiStatusHtml(code: string, isHost: boolean, years: number, year: number, confirmEnd: boolean): string {
  const left = years > 0 ? `${Math.max(0, years - year + 1)} an${years - year + 1 > 1 ? "s" : ""} restant${years - year + 1 > 1 ? "s" : ""} sur ${years}` : "durée libre";
  const endBtn = isHost
    ? confirmEnd
      ? `<p class="warn small">Terminer maintenant ? Le classement est fait sur le dernier bilan d'automne, pour toute la salle.</p><div class="save-row"><button type="button" class="btn btn-danger" data-mp="endConfirm">Oui, terminer</button><button type="button" class="btn" data-mp="endCancel">Non</button></div>`
      : `<div class="save-row"><button type="button" class="btn" data-mp="end">Terminer la partie</button></div>`
    : "";
  return `<h3>Partie à plusieurs</h3>
    <p class="small">Salle <strong class="room-code">${e(code)}</strong>${isHost ? " · vous êtes l'hôte" : ""} · ${left}.</p>${endBtn}
    <p class="muted small">Votre domaine est sauvegardé dans ce navigateur à chaque bilan.${isHost ? " Fermer la page arrête la partie pour tout le monde ; elle se reprend depuis ce panneau." : ""}</p>
    <div class="save-row"><button type="button" class="btn" data-mp="leave">Quitter la salle</button></div>`;
}

export function createFormHtml(pseudo: string): string {
  return `<form data-el="mpForm" class="mp-form">
      <label class="offer-row">Votre nom <input name="pseudo" maxlength="20" value="${e(pseudo)}" required /></label>
      <label class="offer-row">Durée <select name="years">${DUREES.map((d) => `<option value="${d}" ${d === 60 ? "selected" : ""}>${d > 0 ? `${d} ans` : "Sans limite"}</option>`).join("")}</select></label>
      <label class="offer-row">Vitesse <select name="speed"><option value="1">×1</option><option value="2" selected>×2</option><option value="3">×3</option></select></label>
      <p class="muted small">Compter environ 1 à 1,5 min par an à ×3, 2 à 3 min à ×1-×2 avec les pauses. La partie se reprend en plusieurs séances. Sans limite : vous la terminez quand vous voulez depuis le panneau Partie.</p>
      <p class="muted small">Vous recevrez un code de salle à donner aux autres joueurs. La vitesse et la pause valent pour toute la salle ; vous seul les réglez.</p>
      <p class="warn small" data-el="mpError" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
    </form>`;
}

export function joinFormHtml(pseudo: string, code: string): string {
  return `<form data-el="mpForm" class="mp-form">
      <label class="offer-row">Code de la salle <input name="code" maxlength="5" value="${e(code)}" required autocomplete="off" spellcheck="false" style="text-transform:uppercase" /></label>
      <label class="offer-row">Votre nom <input name="pseudo" maxlength="20" value="${e(pseudo)}" required /></label>
      <p class="muted small">Si vous aviez déjà une place dans cette salle, ce navigateur la reprend.</p>
      <p class="warn small" data-el="mpError" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Annuler</button><button type="submit" class="btn btn-primary">Rejoindre</button></div>
    </form>`;
}

/** Salon : code, joueurs présents, bouton de lancement pour l'hôte. */
export function lobbyHtml(players: RoomPlayer[], settings: RoomSettings, code: string, isHost: boolean, resumed: boolean): string {
  const list = players
    .map((p) => `<li><span class="dot ${p.online ? "on" : ""}"></span>${e(p.pseudo)}${p.id === "j1" ? ` <span class="muted small">(hôte)</span>` : ""}${p.online ? "" : ` <span class="muted small">absent</span>`}</li>`)
    .join("");
  return `<p>Code de la salle : <strong class="room-code big">${e(code)}</strong> <button type="button" class="btn btn-small" data-act="copyCode">Copier</button></p>
    <p class="muted small">${dureeText(settings.years)} · vitesse ×${settings.speed} · ${players.length} / 8 joueurs</p>
    <ul class="players">${list}</ul>
    ${
      isHost
        ? `<p class="muted small">${resumed ? "Partie reprise : attendez que les joueurs reviennent, puis relancez." : "Donnez le code aux autres joueurs, puis lancez quand tout le monde est là. Personne ne peut entrer une fois la partie lancée."}</p>
           <div class="modal-actions"><button type="button" class="btn" data-act="mpLeave">Fermer la salle</button><button type="button" class="btn btn-primary" data-act="mpLaunch">${resumed ? "Reprendre la partie" : "Lancer la partie"}</button></div>`
        : `<p class="muted small">En attente du lancement par l'hôte…</p><div class="modal-actions"><button type="button" class="btn" data-act="mpLeave">Quitter</button></div>`
    }`;
}

/** Section Joueurs du panneau Voisins : qui est là, et leurs fiefs. */
export function playersHtml(world: WorldState, players: RoomPlayer[], me: string): string {
  const rows = players
    .map((p) => {
      const lord = lordById(world, p.id);
      const fiefs = world.fiefs.filter((f) => f.ownerId === p.id).length;
      const out = lord && fiefs === 0;
      return `<li><span class="dot ${p.online ? "on" : ""}"></span><span class="blazon" style="background:${lordColor(lord?.colorIndex)}"></span>
        <strong>${e(p.pseudo)}</strong>${p.id === me ? ` <span class="muted small">(vous)</span>` : ""}
        <span class="muted small player-detail">${e(lord?.name ?? "")} · ${out ? "sans terre" : `${fiefs} fief${fiefs > 1 ? "s" : ""}`}${p.online ? "" : " · absent"}</span></li>`;
    })
    .join("");
  return `<ul class="players">${rows}</ul>`;
}

export function chatLogHtml(chat: ChatLine[], players: RoomPlayer[]): string {
  if (chat.length === 0) return `<p class="muted small">Aucun message. Les messages vont à toute la salle.</p>`;
  const name = (id: string) => players.find((p) => p.id === id)?.pseudo ?? id;
  return chat
    .slice(-30)
    .map((m) => `<li><strong>${e(name(m.from))}</strong> : ${e(m.text)}</li>`)
    .join("");
}

/** Offres reçues d'autres joueurs pour vos fiefs. */
export function incomingOffersHtml(world: WorldState, sim: DomainSim): string {
  const deals = sim.state.deals;
  if (deals.incoming.length === 0) return "";
  const items = deals.incoming
    .map((o) => {
      const fief = fiefById(world, o.fiefId);
      const answer = deals.answers.find((a) => a.offerId === o.offerId);
      const status = answer
        ? `<span class="small ${answer.accept ? "ok" : ""}">${answer.accept ? "Vous acceptez" : "Vous refusez"} : réponse envoyée au prochain bilan.</span>`
        : `<button type="button" class="btn btn-small btn-primary" data-answer="${e(o.offerId)}" data-accept="1">Accepter</button><button type="button" class="btn btn-small" data-answer="${e(o.offerId)}" data-accept="0">Refuser</button>`;
      return `<li class="sale"><span class="small"><strong>${e(lordLabel(world, o.buyerId))}</strong> offre <strong>${o.price} or</strong> pour ${e(fief?.name ?? "un de vos fiefs")}${fief ? ` (${e(DOMINANTS[fief.dominant].nom.toLowerCase())})` : ""}. Le fief, ses maisons et ses habitants lui reviendraient.</span>
        <span class="sale-actions">${status}</span></li>`;
    })
    .join("");
  return `<h3>Offres pour vos fiefs</h3><ul class="sales">${items}</ul>`;
}

export function rankingHtml(ranking: RankingRow[], me: string | null): string {
  const rows = ranking
    .map((r, i) => `<tr class="${r.id === me ? "is-me" : ""}"><td class="num">${i + 1}</td><th scope="row">${e(r.pseudo)}<br><span class="muted small">${e(r.house)}</span></th><td class="num">${r.prestige}</td><td class="num">${r.fiefs}</td><td class="num">${r.population}</td></tr>`)
    .join("");
  const mine = ranking.findIndex((r) => r.id === me);
  return `<p>${mine === 0 ? "Votre lignée l'emporte : la plus prestigieuse de la contrée !" : mine > 0 ? `Votre lignée finit ${mine + 1}e sur ${ranking.length}.` : "La partie est terminée."}</p>
    <div class="fair-wrap"><table class="fair"><thead><tr><th>#</th><th>Lignée</th><th>Prestige</th><th>Fiefs</th><th>Habitants</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="close">Fermer</button></div>`;
}
