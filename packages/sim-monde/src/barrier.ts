/**
 * Barrière annuelle (DESIGN.md, section 7.3).
 *
 * À la fin de chaque automne, chaque domaine envoie son résumé et ses actions.
 * Quand tout le monde est prêt, le Monde résout tout dans un ordre fixe, puis
 * renvoie les événements et le signal "année résolue".
 *
 * Ordre de résolution (déterministe) : transactions, puis IA voisines, puis éliminations.
 * J4 : offres d'achat de fiefs. Chaque fief va à la meilleure offre (à égalité, au premier
 * seigneur dans l'ordre des identifiants), si elle atteint le prix plancher de son seigneur IA ;
 * les autres offres sont rendues avec la raison.
 */
import { Rng, type BarrierInput, type BarrierResult, type ProposeAction, type WorldEvent } from "@jeu/shared";
import { aiActions } from "./ai/neighbors";
import { FIEFS, adjacent, floorPrice, growVillages } from "./fiefs";
import { fiefById, type WorldState } from "./state";

export function resolveBarrier(world: WorldState, inputs: BarrierInput[]): BarrierResult {
  const rng = new Rng(world.rngState);
  const events: WorldEvent[] = [];
  const sorted = [...inputs].sort((a, b) => (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0));

  for (const input of sorted) {
    world.lastSummaries[input.ownerId] = input.summary;
  }

  // 1. Transactions : achats de fiefs.
  const playerActions = sorted.flatMap((i) => i.actions);
  resolveOffers(world, playerActions, events);
  // 2. Actions des voisins IA (passifs en V1).
  const ai = aiActions(world, rng);
  if (playerActions.length === 0 && ai.length === 0) {
    events.push({ type: "info", ownerId: null, text: `Bilan de l'an ${world.year} : aucune affaire entre seigneurs.` });
  }
  // 3. Éliminations (à venir).
  // 4. Les villages des voisins grandissent.
  growVillages(world, rng);

  const resolvedYear = world.year;
  world.year += 1;
  world.rngState = rng.state;
  return { events, resolved: { type: "yearResolved", year: resolvedYear } };
}

function resolveOffers(world: WorldState, actions: ProposeAction[], events: WorldEvent[]): void {
  const release = (a: ProposeAction, reason: string) =>
    events.push({ type: "escrowReleased", ownerId: a.ownerId, actionId: a.actionId, fiefId: a.fiefId, gold: a.price, reason });
  const byFief = new Map<string, ProposeAction[]>();
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
    const sellerIsAi = meta.ownerId !== null && meta.ownerId.startsWith("ia-");
    let sold = false;
    for (const a of offers) {
      if (sold) {
        release(a, `Un autre seigneur a offert davantage pour ${meta.name}.`);
        continue;
      }
      const mine = world.fiefs.filter((f) => f.ownerId === a.ownerId);
      if (meta.ownerId === a.ownerId) release(a, `${meta.name} est déjà à vous.`);
      else if (!sellerIsAi) release(a, `${meta.name} n'est pas à vendre.`);
      else if (!mine.some((f) => adjacent(f, meta))) release(a, `${meta.name} ne touche plus aucun de vos fiefs.`);
      else {
        const floor = floorPrice(world, meta);
        if (a.price >= floor) {
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
          meta.households = 0;
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
}
