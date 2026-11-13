import { RESOURCE_IDS, RESOURCE_NAMES, type Cost } from "@jeu/shared";

export function formatCost(cost: Cost | undefined): string {
  if (!cost) return "gratuit";
  const parts = RESOURCE_IDS.filter((id) => (cost[id] ?? 0) > 0).map((id) => `${cost[id]} ${RESOURCE_NAMES[id].toLowerCase()}`);
  return parts.length > 0 ? parts.join(" · ") : "gratuit";
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function formatRealDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}
