/**
 * Emplacements de sauvegarde dans le navigateur (localStorage).
 * Le stockage peut être indisponible (navigation privée, aperçu) : chaque accès est protégé.
 */
import { parseSave, serializeSave, type SaveGame } from "./save";

export type SlotId = "manuelle" | "auto";
const PREFIX = "seigneurie.sauvegarde.";

export interface SlotInfo {
  slot: SlotId;
  savedAt: string;
  year: number;
  seedText: string;
}

export function writeSlot(slot: SlotId, save: SaveGame): boolean {
  try {
    localStorage.setItem(PREFIX + slot, serializeSave(save));
    return true;
  } catch {
    return false;
  }
}

export function readSlot(slot: SlotId): SaveGame | null {
  try {
    const text = localStorage.getItem(PREFIX + slot);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

export function slotInfo(slot: SlotId): SlotInfo | null {
  const save = readSlot(slot);
  if (!save) return null;
  return { slot, savedAt: save.savedAt, year: save.world.year, seedText: save.world.seedText };
}

// ------------------------------------------------------------ parties à plusieurs (J7)

const MULTI = "seigneurie.multi.";
const HOST = "seigneurie.salle.";
const TOKEN = "seigneurie.jeton.";

/** Domaine de ce joueur dans la salle `code` (sauvegardé à chaque bilan). */
export function writeMulti(code: string, playerId: string, save: SaveGame): boolean {
  try {
    localStorage.setItem(`${MULTI}${code}.${playerId}`, serializeSave(save));
    return true;
  } catch {
    return false;
  }
}

export function readMulti(code: string, playerId: string): SaveGame | null {
  try {
    const text = localStorage.getItem(`${MULTI}${code}.${playerId}`);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

/** Salle tenue par ce navigateur (hôte), pour la reprendre. */
export function writeHostRoom(code: string, data: unknown): boolean {
  try {
    localStorage.setItem(HOST + code, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readHostRoom<T>(code: string): T | null {
  try {
    const text = localStorage.getItem(HOST + code);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/** Codes des salles que ce navigateur peut reprendre comme hôte. */
export function hostRoomCodes(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(HOST)) out.push(k.slice(HOST.length));
    }
  } catch {
    // Stockage indisponible.
  }
  return out.sort();
}

/** Jeton de ce navigateur pour une salle : il garde sa place en cas de reconnexion. */
export function roomToken(code: string): string {
  const fresh = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const known = localStorage.getItem(TOKEN + code);
    if (known) return known;
    const t = fresh();
    localStorage.setItem(TOKEN + code, t);
    return t;
  } catch {
    return fresh();
  }
}
