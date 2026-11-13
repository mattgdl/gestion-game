/**
 * Calendrier. Le temps est compté en ticks fixes ; tout le reste (année, saison, jour)
 * s'en déduit. 1 an = secondesParAn × ticksParSeconde ticks (1 800 par défaut).
 */
import { SEASONS } from "../data";

export const TICKS_PER_SECOND = SEASONS.ticksParSeconde;
export const TICKS_PER_YEAR = SEASONS.secondesParAn * SEASONS.ticksParSeconde;
export const TICKS_PER_SEASON = TICKS_PER_YEAR / 4;
/** La barrière annuelle tombe à la fin de l'automne, juste avant le premier tick de l'hiver. */
export const BARRIER_OFFSET = 3 * TICKS_PER_SEASON;

export interface GameDate {
  year: number;
  seasonIndex: number;
  seasonId: string;
  seasonName: string;
  /** Jour dans la saison, de 1 à joursParSaison. */
  day: number;
  /** Avancement de la saison, de 0 à 1. */
  seasonProgress: number;
}

export function dateOf(tick: number): GameDate {
  const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
  const inYear = tick % TICKS_PER_YEAR;
  const seasonIndex = Math.floor(inYear / TICKS_PER_SEASON);
  const inSeason = inYear % TICKS_PER_SEASON;
  const season = SEASONS.saisons[seasonIndex] ?? { id: "printemps", nom: "Printemps" };
  return {
    year,
    seasonIndex,
    seasonId: season.id,
    seasonName: season.nom,
    day: Math.floor((inSeason / TICKS_PER_SEASON) * SEASONS.joursParSaison) + 1,
    seasonProgress: inSeason / TICKS_PER_SEASON,
  };
}
