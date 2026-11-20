/**
 * Barrière annuelle (DESIGN.md, section 7.3).
 *
 * À la fin de chaque automne, chaque domaine envoie son résumé et ses actions.
 * Quand tout le monde est prêt, le Monde résout tout dans un ordre fixe, puis
 * renvoie les événements et le signal "année résolue".
 *
 * Ordre de résolution (déterministe) :
 * 1. commerce : accords acceptés ou rompus, règlement de l'année, réponses aux propositions ;
 * 2. achats de fiefs (domaines et seigneurs IA ensemble : la meilleure offre l'emporte) ;
 * 3. guerres : déclarations des domaines, assauts, pillages et conquêtes ;
 * 4. vie des seigneurs IA : production, consommation, croissance des villages ;
 * 5. projets des seigneurs IA : achats préparés (rumeurs), propositions d'accords, guerres.
 */
import { Rng, type BarrierInput, type BarrierResult, type ProposeAction, type WorldEvent } from "@jeu/shared";
import { aiEconomy, aiOffers, aiPlans, settleAiGold } from "./ai/neighbors";
import { FIEFS, adjacent, floorPrice } from "./fiefs";
import { fiefById, isStartFief, lordById, type FiefOffer, type WorldState } from "./state";
import { aiProposals, resolveTrade } from "./trade";
import { aiWars, playerWarActions, resolveWars } from "./war";

export function resolveBarrier(world: WorldState, inputs: BarrierInput[]): BarrierResult {
  const rng = new Rng(world.rngState);
  let events: WorldEvent[] = [];
  const sorted = [...inputs].sort((a, b) => (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0));

  for (const input of sorted) {
    world.lastSummaries[input.ownerId] = input.summary;
  }
  const playerActions = sorted.flatMap((i) => i.actions);

  // 1. Commerce.
  resolveTrade(world, playerActions, rng, events);
  // 2. Achats de fiefs : offres des domaines et des seigneurs IA.
  const offers = [...playerActions, ...aiOffers(world)];
  resolveOffers(world, offers, events, new Set(sorted.map((i) => i.ownerId)));
  events = settleAiGold(world, events);
  // 3. Guerres : déclarations et levées de siège des domaines, puis les assauts de l'année.
  playerWarActions(world, playerActions, events);
  resolveWars(world, rng, events);
  // 4. Vie des seigneurs IA.
  aiEconomy(world, rng);
  // 5. Projets des seigneurs IA pour l'an prochain.
  const players = world.lords.filter((l) => l.isPlayer).map((l) => l.id);
  aiPlans(world, rng, events);
  aiProposals(world, rng, players, events);
  aiWars(world, rng, events);

  events.unshift({
    type: "info",
    ownerId: null,
    text: events.length === 0 ? `Bilan de l'an ${world.year} : aucune affaire entre seigneurs.` : `Bilan de l'an ${world.year} : affaires entre seigneurs.`,
  });

  const resolvedYear = world.year;
  world.year += 1;
  world.rngState = rng.state;
  return { events, resolved: { type: "yearResolved", year: resolvedYear }, participants: sorted.map((i) => i.ownerId) };
}

function resolveOffers(world: WorldState, actions: ProposeAction[], events: WorldEvent[], present: Set<string>): void {
  const answers = new Map<string, Extract<ProposeAction, { type: "answerFiefOffer" }>>();
  for (const a of actions) if (a.type === "answerFiefOffer") answers.set(a.offerId, a);
  const pendingBefore = world.fiefOffers ?? [];
  const pendingNow: FiefOffer[] = [];
  const release = (a: Extract<ProposeAction, { type: "buyFief" }>, reason: string) =>
    events.push({ type: "escrowReleased", ownerId: a.ownerId, actionId: a.actionId, fiefId: a.fiefId, gold: a.price, reason });
  const byFief = new Map<string, Extract<ProposeAction, { type: "buyFief" }>[]>();
  for (const a of [...actions].sort((x, y) => (x.actionId < y.actionId ? -1 : x.actionId > y.actionId ? 1 : 0))) {
    if (a.type !== "buyFief") continue;
    const list = byFief.get(a.fiefId) ?? [];
    list.push(a);
    byFief.set(a.fiefId, list);
  }
  for (const fiefId of [...byFief.keys()].sort()) {
    const offers = (byFief.get(fiefId) ?? []).sort((a, b) => b.price - a.price || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0));
    const meta = fiefById(world, fiefId);
    if (!meta) {
      for (const a of offers) release(a, "Ce fief n'existe pas.");
      continue;
    }
    let sold = false;
    for (const a of offers) {
      const sellerIsAi = meta.ownerId !== null && meta.ownerId.startsWith("ia-");
      if (sold) {
        const winner = world.lords.find((l) => l.id === meta.ownerId);
        release(a, `${winner && !winner.isPlayer ? `La ${winner.name}` : "Un autre seigneur"} a offert davantage pour ${meta.name}.`);
        continue;
      }
      const mine = world.fiefs.filter((f) => f.ownerId === a.ownerId);
      const sellerIsPlayer = meta.ownerId !== null && !sellerIsAi && lordById(world, meta.ownerId)?.isPlayer === true;
      if (meta.ownerId === a.ownerId) release(a, `${meta.name} est déjà à vous.`);
      else if (sellerIsPlayer && !a.ownerId.startsWith("ia-")) {
        // Entre joueurs (J7) : le vendeur répond ; sans réponse, l'offre attend (l'or reste de côté).
        const sellerId = meta.ownerId as string;
        const seller = lordById(world, sellerId);
        if (!mine.some((f) => adjacent(f, meta))) release(a, `${meta.name} ne touche plus aucun de vos fiefs.`);
        else if (isStartFief(world, meta)) release(a, `${meta.name} est le fief de départ d'une lignée : il ne se vend pas.`);
        else {
          const answer = answers.get(a.actionId);
          const known = pendingBefore.find((o) => o.offerId === a.actionId);
          if (answer && answer.ownerId === sellerId && answer.accept) {
            events.push({ type: "fiefTransferred", fiefId, col: meta.col, row: meta.row, name: meta.name, fromOwnerId: sellerId, toOwnerId: a.ownerId, price: a.price, households: Math.max(0, answer.households) });
            events.push({ type: "paymentReceived", ownerId: sellerId, gold: a.price, reason: `Vente de ${meta.name} : ${a.price} or reçus.` });
            meta.ownerId = a.ownerId;
            meta.households = 0;
            sold = true;
          } else if (answer && answer.ownerId === sellerId) {
            release(a, `${seller?.pseudo ?? seller?.name ?? "Le seigneur"} refuse de vous vendre ${meta.name}.`);
          } else if (known && present.has(sellerId) && known.year < world.year) {
            release(a, `${seller?.pseudo ?? seller?.name ?? "Le seigneur"} n'a pas répondu à votre offre pour ${meta.name}.`);
          } else {
            const offer: FiefOffer = known ?? { offerId: a.actionId, buyerId: a.ownerId, sellerId, fiefId, price: a.price, year: world.year };
            pendingNow.push(offer);
            events.push({ type: "fiefOfferReceived", ownerId: sellerId, offerId: offer.offerId, buyerId: a.ownerId, fiefId, price: a.price });
          }
        }
      } else if (!sellerIsAi) release(a, `${meta.name} n'est pas à vendre.`);
      else if (!mine.some((f) => adjacent(f, meta))) release(a, `${meta.name} ne touche plus aucun de vos fiefs.`);
      else {
        const floor = floorPrice(world, meta, a.ownerId);
        if (a.price >= floor) {
          const buyerIsAi = a.ownerId.startsWith("ia-");
          events.push({
            type: "fiefTransferred",
            fiefId,
            col: meta.col,
            row: meta.row,
            name: meta.name,
            fromOwnerId: meta.ownerId,
            toOwnerId: a.ownerId,
            price: a.price,
            households: meta.households,
          });
          meta.ownerId = a.ownerId;
          // Un domaine reconstruit le village chez lui ; un seigneur IA le garde tel quel.
          if (!buyerIsAi) meta.households = 0;
          sold = true;
        } else {
          const close = a.price >= floor * FIEFS.negociation.seuilHesitation;
          const lord = world.lords.find((l) => l.id === meta.ownerId);
          release(
            a,
            close
              ? `${lord?.name ?? "Le seigneur"} hésite : votre offre pour ${meta.name} était proche. Retentez l'an prochain.`
              : `${lord?.name ?? "Le seigneur"} juge votre offre pour ${meta.name} bien trop basse.`,
          );
        }
      }
    }
  }
  world.fiefOffers = pendingNow;
}
