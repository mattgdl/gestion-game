/**
 * Aléatoire déterministe.
 *
 * Règle d'or : la simulation n'utilise JAMAIS Math.random(). Tout passe par ce
 * générateur à graine, dont l'état (un simple entier) est sauvegardé avec la partie.
 * Même graine + mêmes commandes = même partie, sur n'importe quel ordinateur.
 */

/** Mélange un entier 32 bits (finaliseur de MurmurHash3). */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Transforme un texte (ex. la graine saisie par le joueur) en entier 32 bits. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** Hachage d'une position (x, y) pour une graine donnée. */
export function hash3(seed: number, x: number, y: number): number {
  return mix32((seed ^ mix32(Math.imul(x, 374761393) ^ mix32(Math.imul(y, 668265263)))) >>> 0);
}

/** Dérive une graine indépendante pour un usage précis (ex. "foret", "riviere-1-0"). */
export function deriveSeed(seed: number, label: string): number {
  return mix32((seed ^ hashString(label)) >>> 0);
}

/** Générateur Mulberry32 : rapide, déterministe, état sérialisable. */
export class Rng {
  state: number;

  constructor(state: number) {
    this.state = state >>> 0;
  }

  /** Nombre dans [0, 1[. */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [min, max] (bornes incluses). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick sur une liste vide");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Mélange la liste sur place (Fisher-Yates) et la renvoie. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}
