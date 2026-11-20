/**
 * Guerre et conquête (J6), côté Monde : déclarations, sièges, pillages, conquêtes.
 *
 * - Une guerre vise un fief qui touche les terres de l'attaquant. Déclarée au bilan, son premier
 *   assaut a lieu au bilan suivant : le défenseur a un an pour se préparer.
 * - Un assaut par bilan : force de l'attaquant contre force du défenseur (avantagé), avec un peu
 *   de hasard. Conquête après plusieurs assauts gagnés ; pillage dès le premier ; siège levé après
 *   plusieurs assauts perdus.
 * - Les seigneurs IA déclarent selon leur goût de la guerre, leur relation et le rapport de forces.
 *
 * Le fief de départ d'un joueur ne peut pas être conquis (seulement pillé). Tout est déterministe.
 */
import guerreJson from "@jeu/data/guerre.json";
import type { ProposeAction, Rng, WarGoal, WarInfo, WorldEvent } from "@jeu/shared";
import { archetypeOf, clampRelation } from "./ai/archetypes";
import { activeAiLords } from "./ai/neighbors";
import { adjacent } from "./fiefs";
import { fiefById, isStartFief, type FiefMeta, type Lord, type WorldState } from "./state";

export interface GuerreDef {
  forceSoldat: number;
  armeFacteur: number;
  forceMercenaire: number;
  prixMercenaire: number;
  soldeParAn: number;
  usureArmes: number;
  forceMilice: number;
  bonusDefense: number;
  hasardMin: number;
  hasardMax: number;
  pertesPerdant: number;
  pertesGagnant: number;
  assautsConquete: number;
  assautsPerdus: number;
  pillageOr: number;
  pillageReserves: number;
  pillageMorts: number;
  moralGuerre: number;
  ia: { soldatsParFoyer: number; recuperation: number; declarationParAn: number; graceAnnees: number; avantageRequis: number; mercenairesPartOr: number; attraitJoueur: number; mercenairesMax: number; avantageJoueur: number };
  relationCible: number;
  relationAutres: number;
  treveAnnees: number;
}

/** Année de fin de trêve d'un seigneur (0 : aucune). */
export function truceUntil(world: WorldState, id: string): number {
  return world.truces?.[id] ?? 0;
}

function grantTruce(world: WorldState, id: string): void {
  world.truces ??= {};
  world.truces[id] = Math.max(truceUntil(world, id), world.year + GUERRE.treveAnnees);
}
export const GUERRE = guerreJson as unknown as GuerreDef;

const isAi = (id: string) => id.startsWith("ia-");

function lordOf(world: WorldState, id: string): Lord | undefined {
  return world.lords.find((l) => l.id === id);
}

function nameOf(world: WorldState, id: string): string {
  const l = lordOf(world, id);
  if (!l) return "un seigneur";
  return l.isPlayer ? "vous" : `la ${l.name}`;
}

/** Fief de départ d'un joueur : jamais conquis. */
export function isHomeFief(world: WorldState, meta: FiefMeta): boolean {
  return meta.ownerId !== null && !isAi(meta.ownerId) && isStartFief(world, meta);
}

/** Soldats d'un seigneur IA : selon ses foyers et son goût de la guerre, moins ses blessés. */
export function aiSoldiers(world: WorldState, lord: Lord): number {
  if (!lord.ai) return 0;
  const households = world.fiefs.filter((f) => f.ownerId === lord.id).reduce((n, f) => n + f.households, 0);
  const g = GUERRE.ia;
  const base = Math.floor((households * g.soldatsParFoyer * (500 + archetypeOf(lord.ai.archetype).guerre)) / 1_000_000);
  return Math.max(0, base - (lord.ai.wounded ?? 0));
}

/** Mercenaires qu'un seigneur IA loue pour attaquer : une part de son or. */
export function aiMercenaries(lord: Lord): number {
  if (!lord.ai) return 0;
  const g = GUERRE;
  return Math.min(g.ia.mercenairesMax, Math.floor((lord.ai.gold * g.ia.mercenairesPartOr) / 1000 / g.prixMercenaire));
}

/** Force d'un camp, sans le bonus du défenseur. Milice : chaque foyer défend un peu ses terres. */
export function strengthOf(world: WorldState, id: string, defending: boolean): number {
  const lord = lordOf(world, id);
  if (!lord) return 0;
  const militia = (households: number) => (defending ? households * GUERRE.forceMilice : 0);
  if (lord.ai) {
    const households = world.fiefs.filter((f) => f.ownerId === lord.id).reduce((n, f) => n + f.households, 0);
    const mercs = defending ? 0 : aiMercenaries(lord) * GUERRE.forceMercenaire;
    return aiSoldiers(world, lord) * GUERRE.forceSoldat + mercs + militia(households);
  }
  const a = world.armies[id];
  if (!a) return 0;
  const unarmed = Math.max(0, a.soldiers - a.armed);
  const raw = (a.armed * GUERRE.armeFacteur + unarmed) * GUERRE.forceSoldat + a.mercenaries * GUERRE.forceMercenaire;
  return Math.floor((raw * a.morale) / 1000) + militia(a.households);
}

/** Force de défense d'un fief (bonus du défenseur compris). */
export function defenseOf(world: WorldState, meta: FiefMeta): number {
  if (!meta.ownerId) return 0;
  return Math.floor((strengthOf(world, meta.ownerId, true) * GUERRE.bonusDefense) / 1000);
}

/** Un seigneur peut-il déclarer la guerre à ce fief ? */
export function checkWar(world: WorldState, attackerId: string, fiefId: string, goal: WarGoal): { ok: boolean; reason: string } {
  const meta = fiefById(world, fiefId);
  if (!meta || !meta.ownerId) return { ok: false, reason: "Ce fief n'a pas de seigneur." };
  if (meta.ownerId === attackerId) return { ok: false, reason: `${meta.name} est déjà à vous.` };
  if (!world.fiefs.some((f) => f.ownerId === attackerId && adjacent(f, meta))) return { ok: false, reason: `${meta.name} ne touche aucun de vos fiefs.` };
  if (world.wars.some((w) => w.fiefId === fiefId)) return { ok: false, reason: `${meta.name} est déjà assiégé.` };
  if (world.wars.some((w) => w.attackerId === attackerId)) return { ok: false, reason: "Vous menez déjà une guerre : une à la fois." };
  if (goal === "conquete" && isHomeFief(world, meta)) return { ok: false, reason: "Le fief de départ d'une lignée ne peut être que pillé." };
  const truce = truceUntil(world, meta.ownerId);
  if (truce >= world.year) return { ok: false, reason: `${nameOf(world, meta.ownerId)} est en trêve jusqu'à l'an ${truce} : il se relève d'une défaite.` };
  return { ok: true, reason: "" };
}

function shiftRelation(world: WorldState, lordId: string, playerId: string, delta: number): void {
  const l = lordOf(world, lordId);
  if (!l?.ai) return;
  l.ai.relations[playerId] = clampRelation((l.ai.relations[playerId] ?? 0) + delta);
}

/** Déclare la guerre : réputation, accords rompus avec l'ennemi, annonce. */
function declare(world: WorldState, attackerId: string, meta: FiefMeta, goal: WarGoal, events: WorldEvent[]): void {
  const defenderId = meta.ownerId as string;
  const war: WarInfo = { id: `g-${world.year}-${attackerId}-${meta.id}`, attackerId, defenderId, fiefId: meta.id, goal, firstYear: world.year + 1, won: 0, lost: 0 };
  world.wars.push(war);
  // Réputation d'un joueur qui attaque : sa cible lui en veut, les autres s'en méfient.
  if (!isAi(attackerId)) {
    for (const l of world.lords) if (l.ai) shiftRelation(world, l.id, attackerId, l.id === defenderId ? GUERRE.relationCible : GUERRE.relationAutres);
  } else if (!isAi(defenderId)) {
    shiftRelation(world, attackerId, defenderId, GUERRE.relationCible / 2);
  }
  // Plus de commerce avec l'ennemi.
  for (const t of [...world.agreements]) {
    const between = (t.ownerId === attackerId && t.partnerId === defenderId) || (t.ownerId === defenderId && t.partnerId === attackerId);
    if (!between) continue;
    world.agreements = world.agreements.filter((x) => x.id !== t.id);
    const partner = lordOf(world, t.partnerId);
    events.push({
      type: "tradeSettled",
      ownerId: t.ownerId,
      agreementId: t.id,
      quantity: 0,
      gold: 0,
      relation: partner?.ai?.relations[t.ownerId] ?? 0,
      ended: true,
      text: `La guerre met fin à l'accord avec la ${partner?.name ?? "maison voisine"}.`,
    });
  }
  const what = goal === "conquete" ? `pour prendre ${meta.name}` : `pour piller ${meta.name}`;
  const att = nameOf(world, attackerId);
  const Att = `${att.charAt(0).toUpperCase()}${att.slice(1)}`;
  const text = isAi(attackerId)
    ? isAi(defenderId)
      ? `${Att} déclare la guerre à ${nameOf(world, defenderId)} ${what} : premier assaut au bilan de l'an ${war.firstYear}.`
      : `${Att} vous déclare la guerre ${what} : premier assaut au bilan de l'an ${war.firstYear}.`
    : `Vous déclarez la guerre à ${nameOf(world, defenderId)} ${what} : premier assaut au bilan de l'an ${war.firstYear}.`;
  events.push({ type: "warDeclared", war: { ...war }, text });
}

/** Déclarations et levées de siège des domaines joueurs, et leurs armées du bilan. */
export function playerWarActions(world: WorldState, actions: ProposeAction[], events: WorldEvent[]): void {
  for (const a of actions) {
    if (a.type === "armyReport") {
      world.armies[a.ownerId] = { soldiers: a.soldiers, armed: a.armed, mercenaries: a.mercenaries, morale: a.morale, households: a.households };
    }
  }
  for (const a of actions) {
    if (a.type === "endWar") {
      const w = world.wars.find((x) => x.id === a.warId && x.attackerId === a.ownerId);
      if (!w) continue;
      world.wars = world.wars.filter((x) => x !== w);
      const meta = fiefById(world, w.fiefId);
      events.push({ type: "warEnded", warId: w.id, attackerId: w.attackerId, defenderId: w.defenderId, fiefId: w.fiefId, outcome: "abandon", text: `Vous levez le siège de ${meta?.name ?? "ce fief"}.` });
    }
    if (a.type === "declareWar") {
      const verdict = checkWar(world, a.ownerId, a.fiefId, a.goal);
      const meta = fiefById(world, a.fiefId);
      if (!verdict.ok || !meta) {
        events.push({ type: "info", ownerId: a.ownerId, text: `Guerre impossible : ${verdict.reason}` });
        continue;
      }
      declare(world, a.ownerId, meta, a.goal, events);
    }
  }
}

/** Les assauts de l'année, puis la fin des guerres gagnées, perdues ou devenues sans objet. */
export function resolveWars(world: WorldState, rng: Rng, events: WorldEvent[]): void {
  const g = GUERRE;
  for (const w of [...world.wars].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const meta = fiefById(world, w.fiefId);
    const end = (outcome: "conquis" | "pille" | "leve" | "abandon", text: string) => {
      world.wars = world.wars.filter((x) => x !== w);
      events.push({ type: "warEnded", warId: w.id, attackerId: w.attackerId, defenderId: w.defenderId, fiefId: w.fiefId, outcome, text });
    };
    // Le fief a changé de mains, ou l'attaquant n'a plus de terres qui le touchent.
    if (!meta || meta.ownerId !== w.defenderId || !world.fiefs.some((f) => f.ownerId === w.attackerId && adjacent(f, meta))) {
      end("abandon", `La guerre pour ${meta?.name ?? "ce fief"} n'a plus d'objet.`);
      continue;
    }
    if (w.firstYear > world.year) continue;
    const roll = () => g.hasardMin + Math.floor(rng.next() * (g.hasardMax - g.hasardMin + 1));
    const attack = Math.floor((strengthOf(world, w.attackerId, false) * roll()) / 1000);
    // Un seigneur IA assiégé loue des mercenaires pour l'assaut, avec la même part de son or.
    const def = lordOf(world, w.defenderId);
    const defMercs = def?.ai ? aiMercenaries(def) : 0;
    if (def?.ai) def.ai.gold -= defMercs * g.prixMercenaire;
    const defense = Math.floor(((defenseOf(world, meta) + Math.floor((defMercs * g.forceMercenaire * g.bonusDefense) / 1000)) * roll()) / 1000);
    const won = attack > defense;
    // Un seigneur IA qui attaque paie ses mercenaires à chaque assaut.
    const att = lordOf(world, w.attackerId);
    if (att?.ai) att.ai.gold -= aiMercenaries(att) * g.prixMercenaire;
    const soldiers = (id: string) => (isAi(id) ? aiSoldiers(world, lordOf(world, id)!) : (world.armies[id]?.soldiers ?? 0));
    // Le perdant perd au moins un soldat s'il en a ; le gagnant, sa part arrondie.
    const losses = (n: number, lost: boolean) => (lost ? Math.ceil((n * g.pertesPerdant) / 1000) : Math.round((n * g.pertesGagnant) / 1000));
    const attackerLosses = losses(soldiers(w.attackerId), !won);
    const defenderLosses = losses(soldiers(w.defenderId), won);
    for (const [id, n] of [
      [w.attackerId, attackerLosses],
      [w.defenderId, defenderLosses],
    ] as [string, number][]) {
      const l = lordOf(world, id);
      if (l?.ai) l.ai.wounded = (l.ai.wounded ?? 0) + n;
      else if (world.armies[id]) world.armies[id].soldiers = Math.max(0, world.armies[id].soldiers - n);
    }
    if (won) w.won += 1;
    else w.lost += 1;
    const text = `Assaut sur ${meta.name} (${nameOf(world, w.attackerId)} contre ${nameOf(world, w.defenderId)}) : force ${attack} contre ${defense}, ${won ? "l'assaillant l'emporte" : "les défenseurs tiennent"}. Pertes : ${attackerLosses} et ${defenderLosses} soldats.`;
    events.push({ type: "warRound", warId: w.id, attackerId: w.attackerId, defenderId: w.defenderId, fiefId: w.fiefId, attack, defense, attackerWon: won, attackerLosses, defenderLosses, text });

    if (won && w.goal === "pillage") {
      pillage(world, w, meta, events);
      grantTruce(world, w.defenderId);
      end("pille", `${meta.name} est pillé.`);
    } else if (won && w.won >= g.assautsConquete) {
      conquer(world, w, meta, events);
      grantTruce(world, w.defenderId);
      end("conquis", `${meta.name} tombe aux mains ${isAi(w.attackerId) ? `de la ${lordOf(world, w.attackerId)?.name}` : "de votre lignée"}.`);
    } else if (!won && w.lost >= g.assautsPerdus) {
      end("leve", `Le siège de ${meta.name} est levé : les défenseurs ont tenu.`);
    }
  }
  // Les blessés des seigneurs IA reviennent peu à peu.
  for (const l of world.lords) if (l.ai?.wounded) l.ai.wounded = Math.floor((l.ai.wounded * (1000 - g.ia.recuperation)) / 1000);
}

function pillage(world: WorldState, w: WarInfo, meta: FiefMeta, events: WorldEvent[]): void {
  const g = GUERRE;
  const victim = lordOf(world, w.defenderId);
  let loot = 0;
  if (victim?.ai) {
    loot = Math.floor((victim.ai.gold * g.pillageOr) / 1000);
    victim.ai.gold -= loot;
    if (meta.households > 1) meta.households -= 1;
  } else {
    loot = Math.floor(((world.lastSummaries[w.defenderId]?.gold ?? 0) * g.pillageOr) / 1000);
    events.push({
      type: "pillaged",
      ownerId: w.defenderId,
      goldPermille: g.pillageOr,
      reservesPermille: g.pillageReserves,
      deaths: g.pillageMorts,
      text: `${nameOf(world, w.attackerId).replace(/^la/, "La")} pille ${meta.name} : ${g.pillageOr / 10} % de votre or et ${g.pillageReserves / 10} % de vos réserves sont perdus, ${g.pillageMorts} villageois tués.`,
    });
  }
  const attacker = lordOf(world, w.attackerId);
  if (attacker?.ai) attacker.ai.gold += loot;
  else if (loot > 0) events.push({ type: "paymentReceived", ownerId: w.attackerId, gold: loot, reason: `Butin du pillage de ${meta.name} : ${loot} or.` });
}

function conquer(world: WorldState, w: WarInfo, meta: FiefMeta, events: WorldEvent[]): void {
  // Un fief de joueur n'a pas de foyers comptés au Monde : son village passe à l'ennemi, estimé à 5 foyers.
  const households = isAi(w.defenderId) ? meta.households : 5;
  events.push({
    type: "fiefTransferred",
    fiefId: meta.id,
    col: meta.col,
    row: meta.row,
    name: meta.name,
    fromOwnerId: w.defenderId,
    toOwnerId: w.attackerId,
    price: 0,
    households,
    conquest: true,
  });
  meta.ownerId = w.attackerId;
  // Un joueur reconstruit le village chez lui ; un seigneur IA le garde, un peu éprouvé.
  meta.households = isAi(w.attackerId) ? Math.max(1, households - 1) : 0;
  if (isAi(w.attackerId) && isAi(w.defenderId)) {
    events.push({ type: "info", ownerId: null, text: `La ${lordOf(world, w.attackerId)?.name} prend ${meta.name} à la ${lordOf(world, w.defenderId)?.name} par les armes.` });
  }
}

/** Les seigneurs IA déclarent leurs guerres pour l'an prochain. */
export function aiWars(world: WorldState, rng: Rng, events: WorldEvent[]): void {
  const g = GUERRE;
  if (world.year < g.ia.graceAnnees) return;
  for (const lord of activeAiLords(world)) {
    if (world.wars.some((w) => w.attackerId === lord.id || w.defenderId === lord.id)) continue;
    const arch = archetypeOf(lord.ai!.archetype);
    if (rng.next() * 1_000_000 >= g.ia.declarationParAn * arch.guerre) continue;
    const attack = strengthOf(world, lord.id, false);
    const mine = world.fiefs.filter((f) => f.ownerId === lord.id);
    const targets = world.fiefs
      .filter((f) => f.ownerId && f.ownerId !== lord.id && mine.some((m) => adjacent(m, f)) && !world.wars.some((w) => w.fiefId === f.id))
      // Trêve : un seigneur qui vient d'être pillé ou de perdre un fief se relève en paix.
      .filter((f) => truceUntil(world, f.ownerId!) < world.year)
      .filter((f) => {
        // Un seigneur IA n'attaque pas un joueur avec qui il s'entend bien.
        if (!isAi(f.ownerId!) && (lord.ai!.relations[f.ownerId!] ?? 0) >= 30) return false;
        return attack * 1000 >= defenseOf(world, f) * (isAi(f.ownerId!) ? g.ia.avantageRequis : g.ia.avantageJoueur);
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((f) => {
        // Tirage parmi les voisins qu'il domine (et non toujours le plus faible) : un seigneur IA
        // pèse 1000, un joueur attraitJoueur, davantage s'ils sont en mauvais termes.
        let weight = 1000;
        if (!isAi(f.ownerId!)) {
          const rel = lord.ai!.relations[f.ownerId!] ?? 0;
          weight = Math.floor((g.ia.attraitJoueur * (1000 - Math.min(0, rel) * 10)) / 1000);
        }
        return { f, weight };
      });
    const total = targets.reduce((n, t) => n + t.weight, 0);
    if (total <= 0) continue;
    let draw = Math.floor(rng.next() * total);
    const target = targets.find((t) => (draw -= t.weight) < 0)?.f;
    if (!target) continue;
    const goal: WarGoal = isHomeFief(world, target) || arch.ambition < 300 ? "pillage" : "conquete";
    declare(world, lord.id, target, goal, events);
  }
}
