import { describe, expect, it } from "vitest";
import { createWorld, fiefsOwnedBy, lineageSetupFor } from "@jeu/sim-monde";
import { DomainSim } from "../src";

const PLAYERS = [
  { id: "j1", pseudo: "Alice" },
  { id: "j2", pseudo: "Bruno" },
];

function domainOf(id: string) {
  const world = createWorld("fief-multi", undefined, PLAYERS);
  const sim = DomainSim.create({
    ownerId: id,
    dims: world.dims,
    fiefs: fiefsOwnedBy(world, id).map((f) => ({ id: f.id, col: f.col, row: f.row })),
    lineage: lineageSetupFor(world, id),
  });
  return { world, sim };
}

const apply = (sim: DomainSim, events: Parameters<DomainSim["applyBarrierResult"]>[0]["events"], participants?: string[]) => {
  sim.state.awaitingBarrier = true;
  sim.applyBarrierResult({ events, resolved: { type: "yearResolved", year: 1 }, ...(participants ? { participants } : {}) });
};

describe("domaine d'une partie à plusieurs", () => {
  it("chaque joueur a son manoir dans son propre fief de départ", () => {
    for (const p of PLAYERS) {
      const { world, sim } = domainOf(p.id);
      const manor = sim.state.buildings.find((b) => b.type === "manoir")!;
      expect(world.fiefs.find((f) => f.id === manor.fiefId)!.ownerId).toBe(p.id);
      expect(sim.state.dynasty.name).toContain("Maison");
    }
  });

  it("offre reçue d'un joueur : réponse remise au bilan ; le fief du manoir ne se vend pas", () => {
    const { sim } = domainOf("j2");
    const manorFief = sim.state.buildings.find((b) => b.type === "manoir")!.fiefId;
    apply(sim, [
      { type: "fiefOfferReceived", ownerId: "j2", offerId: "o1", buyerId: "j1", fiefId: manorFief, price: 500 },
      { type: "fiefOfferReceived", ownerId: "j2", offerId: "o2", buyerId: "j1", fiefId: "f-9-9", price: 400 },
    ]);
    expect(sim.state.deals.incoming).toHaveLength(2);
    expect(sim.apply({ type: "answerFiefOffer", offerId: "o1", accept: true }).reason).toContain("manoir");
    expect(sim.apply({ type: "answerFiefOffer", offerId: "o2", accept: false }).ok).toBe(true);
    expect(sim.barrierActions()).toContainEqual(expect.objectContaining({ type: "answerFiefOffer", offerId: "o2", accept: false }));
    apply(sim, []);
    expect(sim.state.deals.answers).toEqual([]);
    expect(sim.state.deals.incoming).toEqual([]);
  });

  it("marchandises livrées par un joueur : rangées en réserve, payées au bilan", () => {
    const { sim } = domainOf("j1");
    sim.state.treasury = 300;
    const before = sim.economy.stockOf("outils");
    apply(sim, [{ type: "goodsDelivered", ownerId: "j1", agreementId: "t", good: "outils", qty: 20, gold: 180, text: "Livraison." }]);
    expect(sim.economy.stockOf("outils")).toBe(before + 20);
    expect(sim.state.treasury).toBe(120);
  });

  it("accepter la vente d'un autre joueur ne crée pas d'accord chez l'acheteur (le vendeur livre)", () => {
    const { sim } = domainOf("j2");
    const terms = { id: "t-1", ownerId: "j1", partnerId: "j2", partnerFiefId: "f-1-1", good: "outils" as const, side: "vente" as const, perYear: 20, price: 9, firstYear: 2, lastYear: 3 };
    sim.state.trade.proposals.push({ terms, expiresYear: 2 });
    expect(sim.apply({ type: "acceptTradeProposal", proposalId: "t-1" }).ok).toBe(true);
    expect(sim.state.trade.agreements).toEqual([]);
    expect(sim.barrierActions()).toContainEqual(expect.objectContaining({ type: "acceptTrade", proposalId: "t-1" }));
  });

  it("absent d'un bilan : ses intentions restent pour le suivant", () => {
    const { sim } = domainOf("j1");
    sim.apply({ type: "declareWar", fiefId: "f-0-0", goal: "pillage" });
    apply(sim, [], ["j2"]);
    expect(sim.state.army.pending).toHaveLength(1);
    apply(sim, [], ["j1", "j2"]);
    expect(sim.state.army.pending).toHaveLength(0);
  });
});
