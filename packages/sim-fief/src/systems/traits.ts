/**
 * Traits des personnages (J8) : tirage déterministe, et effets cumulés du seigneur régnant
 * (en plein) et de son conjoint (à moitié).
 */
import { Rng, hashString } from "@jeu/shared";
import { TRAITS, TRAITS_DEF, type TraitEffects } from "../data";
import type { DynastyMember } from "../state";

const KEYS: (keyof TraitEffects)[] = ["moral", "impots", "production", "construction", "force", "prestige", "natalite", "relationIA", "attraitGuerre"];

/** Un ou deux traits, jamais opposés, tirés d'après une clé stable (nom, naissance…). */
export function rollTraits(key: string): string[] {
  const rng = new Rng(hashString(`traits:${key}`));
  const ids = TRAITS_DEF.traits.map((t) => t.id);
  const first = ids[rng.int(0, ids.length - 1)]!;
  const out = [first];
  if (rng.next() * 1000 < TRAITS_DEF.deuxTraitsPourMille) {
    const banned = new Set([first, TRAITS[first]?.oppose].filter(Boolean));
    const rest = ids.filter((id) => !banned.has(id) && TRAITS[id]?.oppose !== first);
    if (rest.length > 0) out.push(rest[rng.int(0, rest.length - 1)]!);
  }
  return out;
}

export function traitNames(ids: string[] | undefined): string {
  return (ids ?? []).map((id) => TRAITS[id]?.nom ?? id).join(", ");
}

/** Effets cumulés : le seigneur en plein, son conjoint à moitié (arrondi vers zéro). */
export function ruleEffects(lord: DynastyMember | undefined, spouse: DynastyMember | undefined): Required<TraitEffects> {
  const out = Object.fromEntries(KEYS.map((k) => [k, 0])) as Required<TraitEffects>;
  const add = (m: DynastyMember | undefined, half: boolean) => {
    for (const id of m?.traits ?? []) {
      const fx = TRAITS[id]?.effets ?? {};
      for (const k of KEYS) {
        const v = fx[k] ?? 0;
        out[k] += half ? Math.trunc(v / 2) : v;
      }
    }
  };
  add(lord, false);
  add(spouse, true);
  return out;
}
