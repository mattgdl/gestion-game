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
