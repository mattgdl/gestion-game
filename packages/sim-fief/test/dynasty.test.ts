import { describe, expect, it } from "vitest";
import { DAY_TICKS, type DomainSim, type DynastyMember, type Sex, type Villager } from "../src";
import { labGame, manorOf, newGame, runUntil } from "./helpers";

const YEAR = 1800;

/** Ajoute un membre à l'arbre (sans villageois : sert aux tests de l'ordre de succession). */
function member(sim: DomainSim, name: string, sex: Sex, birthYearsAgo: number, parents: [number | null, number | null], opts: Partial<DynastyMember> = {}): DynastyMember {
  const m: DynastyMember = {
    id: sim.state.nextId++,
    name,
    sex,
    birthTick: sim.state.tick - birthYearsAgo * YEAR,
    fatherId: parents[0],
    motherId: parents[1],
    blood: true,
    status: "vivant",
    endTick: null,
    spouseIds: [],
    ...opts,
  };
  sim.state.dynasty.members.push(m);
  return m;
}

function names(sim: DomainSim, ids: number[]): string[] {
  return ids.map((id) => sim.dynasty.member(id)?.name ?? "?");
}

/** Fait mourir un villageois de la lignée, comme le ferait la mortalité du jour. */
function kill(sim: DomainSim, id: number): void {
  const v = sim.population.villager(id) as Villager;
  sim.population.remove(v);
  sim.dynasty.onDeaths([{ v, cause: "age" }]);
}

/** Vieillit un membre vivant (villageois et fiche de la lignée) jusqu'à l'âge voulu. */
function setAge(sim: DomainSim, id: number, years: number, extraTicks = 0): void {
  const birth = sim.state.tick - years * YEAR - extraTicks;
  const v = sim.population.villager(id);
  if (v) v.birthTick = birth;
  sim.dynasty.member(id)!.birthTick = birth;
  sim.population.version += 1;
}

describe("fondation de la lignée", () => {
  it("installe au manoir le fondateur, son épouse et leur enfant, avec la loi par défaut", () => {
    const { sim } = newGame("lignee");
    const d = sim.state.dynasty;
    const lord = sim.dynasty.lord!;
    expect(d.name).toMatch(/^Maison de /);
    expect(d.founderId).toBe(lord.id);
    expect(lord.sex).toBe("M");
    expect(sim.dynasty.ageOf(lord)).toBeGreaterThanOrEqual(22);
    expect(sim.dynasty.ageOf(lord)).toBeLessThanOrEqual(26);
    expect(d.law).toBe("preference-masculine");
    expect(d.members).toHaveLength(3);
    expect(d.neighbors.length).toBeGreaterThan(0);
    const fam = sim.state.families.find((f) => f.noble)!;
    expect(fam.houseId).toBe(manorOf(sim).id);
    expect(sim.population.members(fam.id)).toHaveLength(3);
    expect(sim.dynasty.heir()?.blood).toBe(true);
    expect(d.chronicle[0]!.text).toContain(`fonde la ${d.name}`);
  });

  it("ne fait ni travailler ni payer d'impôts la famille noble, qui se sert au manoir", () => {
    const { sim, world } = labGame();
    const fam = sim.state.families.find((f) => f.noble)!;
    fam.food = 0;
    const before = manorOf(sim).stock.nourriture ?? 0;
    runUntil(sim, world, DAY_TICKS + 1);
    expect(fam.food).toBeGreaterThan(0);
    expect(manorOf(sim).stock.nourriture ?? 0).toBeLessThan(before);
    const nobles = sim.state.villagers.filter((v) => v.noble).map((v) => v.id);
    for (const id of nobles) expect(sim.population.jobOf(id)).toBeNull();
    expect(sim.population.counts().nobles).toBe(3);
  });

  it("est la même pour la même graine", () => {
    const a = newGame("meme-graine").sim;
    const b = newGame("meme-graine").sim;
    expect(a.state.dynasty).toEqual(b.state.dynasty);
  });
});

describe("ordre de succession", () => {
  /**
   * Fondateur Hugues ; ses enfants, du plus âgé au plus jeune : Agnès (mère de Thibaut),
   * Robert (mort, père de Gautier), Louis.
   */
  function family(): { sim: DomainSim; founder: number } {
    const { sim } = newGame("arbre");
    const d = sim.state.dynasty;
    d.members = [];
    const hugues = member(sim, "Hugues", "M", 60, [null, null]);
    const berthe = member(sim, "Berthe", "F", 58, [null, null], { blood: false });
    const agnes = member(sim, "Agnès", "F", 40, [hugues.id, berthe.id]);
    const etranger = member(sim, "Étienne", "M", 42, [null, null], { blood: false });
    member(sim, "Thibaut", "M", 18, [etranger.id, agnes.id]);
    const robert = member(sim, "Robert", "M", 38, [hugues.id, berthe.id], { status: "mort", endTick: 0 });
    member(sim, "Gautier", "M", 12, [robert.id, null]);
    member(sim, "Louis", "M", 35, [hugues.id, berthe.id]);
    d.founderId = hugues.id;
    d.lordId = hugues.id;
    return { sim, founder: hugues.id };
  }

  it("les fils d'abord : le fils d'un fils mort passe avant ses oncles et tantes", () => {
    const { sim } = family();
    expect(names(sim, sim.dynasty.lineOfSuccession("preference-masculine"))).toEqual(["Gautier", "Louis", "Agnès", "Thibaut"]);
  });

  it("aînesse absolue : l'aînée et ses enfants d'abord", () => {
    const { sim } = family();
    expect(names(sim, sim.dynasty.lineOfSuccession("absolue"))).toEqual(["Agnès", "Thibaut", "Gautier", "Louis"]);
  });

  it("masculine seule : ni les filles ni leurs enfants", () => {
    const { sim } = family();
    expect(names(sim, sim.dynasty.lineOfSuccession("masculine"))).toEqual(["Gautier", "Louis"]);
  });

  it("remonte aux frères, sœurs et neveux quand le seigneur n'a pas d'enfant", () => {
    const { sim } = family();
    const louis = sim.state.dynasty.members.find((m) => m.name === "Louis")!;
    sim.state.dynasty.members.find((m) => m.name === "Hugues")!.status = "mort";
    expect(names(sim, sim.dynasty.lineOfSuccession("preference-masculine", louis.id))).toEqual(["Gautier", "Agnès", "Thibaut"]);
  });
});

describe("succession, régence et extinction", () => {
  it("l'enfant mineur succède à son père, sous la régence de sa mère, avec un malus de moral", () => {
    const { sim, world } = labGame();
    const lord = sim.dynasty.lord!;
    const child = sim.dynasty.heir()!;
    const wifeId = lord.spouseIds[0]!;
    kill(sim, lord.id);
    const d = sim.state.dynasty;
    expect(d.lordId).toBe(child.id);
    expect(d.regency).toEqual({ regentId: wifeId });
    expect(d.reigns).toHaveLength(2);
    expect(sim.dynasty.drainEvents()).toContainEqual({ type: "succession", deadId: lord.id, heirId: child.id });
    const village = sim.state.families.find((f) => !f.noble)!;
    expect(sim.population.moraleOf(village, 0).parts).toContainEqual({ label: "Régence", value: -10 });
    // La régence prend fin à sa majorité (16 ans).
    setAge(sim, child.id, 15, YEAR - 2 * DAY_TICKS);
    runUntil(sim, world, sim.state.tick + 4 * DAY_TICKS);
    expect(d.regency).toBeNull();
    expect(sim.state.log.some((l) => l.text.includes("fin de la régence"))).toBe(true);
  });

  it("s'éteint à la mort du seigneur quand plus personne ne peut hériter : fin de partie", () => {
    const { sim } = labGame();
    const lord = sim.dynasty.lord!;
    kill(sim, sim.dynasty.heir()!.id);
    expect(sim.dynasty.heir()).toBeUndefined();
    kill(sim, lord.id);
    expect(sim.state.gameOver?.reason).toBe("extinction");
    expect(sim.state.dynasty.lordId).toBeNull();
    expect(sim.state.dynasty.chronicle.at(-1)!.text).toContain("s'éteint");
    const t = sim.state.tick;
    sim.step();
    expect(sim.state.tick).toBe(t);
  });

  it("avec la loi masculine seule, une fille unique n'hérite pas", () => {
    const { sim } = labGame();
    const child = sim.dynasty.heir()!;
    child.sex = "F";
    sim.population.villager(child.id)!.sex = "F";
    sim.state.dynasty.law = "masculine";
    expect(sim.dynasty.heir()).toBeUndefined();
    sim.state.dynasty.law = "preference-masculine";
    expect(sim.dynasty.heir()?.id).toBe(child.id);
  });
});

describe("décret de succession", () => {
  it("ne s'applique qu'après un an, et revenir à la loi en vigueur l'annule", () => {
    const { sim, world } = labGame();
    const d = sim.state.dynasty;
    expect(sim.apply({ type: "decreeLaw", law: "preference-masculine" }).ok).toBe(false);
    expect(sim.apply({ type: "decreeLaw", law: "absolue" }).ok).toBe(true);
    expect(d.law).toBe("preference-masculine");
    expect(d.pendingLaw?.effectiveTick).toBe(sim.state.tick + 120 * DAY_TICKS);
    expect(sim.apply({ type: "decreeLaw", law: "preference-masculine" }).ok).toBe(true);
    expect(d.pendingLaw).toBeNull();
    sim.apply({ type: "decreeLaw", law: "masculine" });
    runUntil(sim, world, d.pendingLaw!.effectiveTick - DAY_TICKS);
    expect(d.law).toBe("preference-masculine");
    runUntil(sim, world, sim.state.tick + 2 * DAY_TICKS);
    expect(d.law).toBe("masculine");
    expect(d.pendingLaw).toBeNull();
  });
});

describe("affaires de famille", () => {
  /** L'enfant du seigneur a 16 ans : une décision l'attend dès le lendemain. */
  function adultChild(): { sim: DomainSim; world: ReturnType<typeof labGame>["world"]; childId: number } {
    const { sim, world } = labGame();
    const child = sim.dynasty.heir()!;
    setAge(sim, child.id, 16);
    runUntil(sim, world, sim.state.tick + DAY_TICKS + 1);
    return { sim, world, childId: child.id };
  }

  it("propose trois prétendants à la majorité : du plus jeune (petite dot) au plus âgé (grosse dot)", () => {
    const { sim, childId } = adultChild();
    const dec = sim.dynasty.decisionFor(childId)!;
    expect(dec.suitors).toHaveLength(3);
    const ages = dec.suitors.map((s) => Math.floor((sim.state.tick - s.birthTick) / YEAR));
    expect(ages[0]).toBeLessThanOrEqual(19);
    expect(ages[2]).toBeGreaterThanOrEqual(27);
    expect(dec.suitors[0]!.dowry).toBeLessThanOrEqual(30);
    expect(dec.suitors[2]!.dowry).toBeGreaterThanOrEqual(60);
    for (const s of dec.suitors) expect(sim.state.dynasty.neighbors).toContain(s.house);
    expect(sim.state.log.some((l) => l.text.startsWith("Affaire de famille"))).toBe(true);
  });

  it("épouser un prétendant : un foyer noble au manoir, la dot au trésor, puis des enfants dans la lignée", () => {
    const { sim, world, childId } = adultChild();
    const suitor = sim.dynasty.decisionFor(childId)!.suitors[0]!;
    const gold = sim.state.treasury;
    expect(sim.apply({ type: "familyDecision", memberId: childId, choice: 0 }).ok).toBe(true);
    expect(sim.state.treasury).toBe(gold + suitor.dowry);
    expect(sim.dynasty.decisionFor(childId)).toBeUndefined();
    const v = sim.population.villager(childId)!;
    const fam = sim.population.family(v.familyId)!;
    expect(fam.noble).toBe(true);
    expect(fam.houseId).toBe(manorOf(sim).id);
    const spouse = sim.dynasty.livingSpouse(sim.dynasty.member(childId)!)!;
    expect(spouse.blood).toBe(false);
    expect(spouse.house).toBe(suitor.house);
    runUntil(sim, world, sim.state.tick + 3 * YEAR);
    const kids = sim.dynasty.childrenOf(childId);
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.every((k) => k.blood)).toBe(true);
    expect(sim.population.villager(kids[0]!.id)?.noble).toBe(true);
    // Ses enfants viennent juste après lui dans l'ordre de succession.
    const line = sim.dynasty.lineOfSuccession();
    const at = line.indexOf(childId);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(kids.map((k) => k.id)).toContain(line[at + 1]);
  });

  it("l'Église apporte du prestige, une alliance de l'or : la personne quitte la lignée", () => {
    const { sim, childId } = adultChild();
    const before = sim.dynasty.prestige().total;
    expect(sim.apply({ type: "familyDecision", memberId: childId, choice: "eglise" }).ok).toBe(true);
    expect(sim.dynasty.member(childId)!.status).toBe("eglise");
    expect(sim.population.villager(childId)).toBeUndefined();
    expect(sim.dynasty.lineOfSuccession()).not.toContain(childId);
    expect(sim.dynasty.prestige().total).toBe(before + 25 - 1);

    const second = adultChild();
    const gold = second.sim.state.treasury;
    expect(second.sim.apply({ type: "familyDecision", memberId: second.childId, choice: "alliance" }).ok).toBe(true);
    expect(second.sim.dynasty.member(second.childId)!.status).toBe("parti");
    expect(second.sim.state.treasury).toBe(gold + 40);
  });

  it("le seigneur ne quitte pas le domaine ; veuf, il peut se remarier ou refuser", () => {
    const { sim, world } = labGame();
    const lord = sim.dynasty.lord!;
    kill(sim, lord.spouseIds[0]!);
    runUntil(sim, world, sim.state.tick + DAY_TICKS + 1);
    expect(sim.dynasty.decisionFor(lord.id)).toBeDefined();
    expect(sim.apply({ type: "familyDecision", memberId: lord.id, choice: "eglise" }).ok).toBe(false);
    expect(sim.apply({ type: "familyDecision", memberId: lord.id, choice: 1 }).ok).toBe(true);
    // La nouvelle épouse rejoint son foyer, avec ses enfants.
    const fam = sim.population.family(sim.population.villager(lord.id)!.familyId)!;
    expect(fam.wifeId).toBe(sim.dynasty.livingSpouse(lord)!.id);
    expect(sim.population.members(fam.id).length).toBe(3);

    const other = labGame();
    const lord2 = other.sim.dynasty.lord!;
    kill(other.sim, lord2.spouseIds[0]!);
    runUntil(other.sim, other.world, other.sim.state.tick + DAY_TICKS + 1);
    expect(other.sim.apply({ type: "familyDecision", memberId: lord2.id, choice: "refuser" }).ok).toBe(true);
    runUntil(other.sim, other.world, other.sim.state.tick + 5 * DAY_TICKS);
    expect(other.sim.dynasty.decisionFor(lord2.id)).toBeUndefined();
  });
});

describe("prestige", () => {
  it("compte la population, l'or, l'ancienneté, les successions et les actes", () => {
    const { sim, world } = labGame();
    runUntil(sim, world, 2 * YEAR + 1);
    const p = sim.dynasty.prestige();
    const part = (label: string) => p.parts.find((x) => x.label === label)!.value;
    expect(part("Population")).toBe(sim.state.villagers.length);
    expect(part("Trésor")).toBe(Math.floor(sim.state.treasury / 10));
    expect(part("Ancienneté de la lignée")).toBe(4);
    expect(part("Successions")).toBe(0);
    expect(p.total).toBe(p.parts.reduce((s, x) => s + x.value, 0));
    expect(sim.summary().prestige).toBe(p.total);
    expect(sim.summary().lineageAlive).toBe(true);
  });
});
