/**
 * Passerelle vers la couche Monde.
 * - Solo : LocalWorld, le Monde tourne dans le navigateur et répond tout de suite.
 * - Multi (J5) : RemoteWorld, même interface, mais la réponse arrive du serveur par WebSocket.
 */
import type { BarrierInput, BarrierResult } from "@jeu/shared";
import { resolveBarrier, type WorldState } from "@jeu/sim-monde";

export interface WorldGateway {
  /** Instantané de l'état du Monde visible par ce joueur. */
  readonly world: WorldState;
  /** Remet le résumé de fin d'année. La réponse peut être immédiate (solo) ou différée (multi). */
  submitBarrier(input: BarrierInput): BarrierResult | Promise<BarrierResult>;
}

export class LocalWorld implements WorldGateway {
  constructor(public world: WorldState) {}

  submitBarrier(input: BarrierInput): BarrierResult {
    return resolveBarrier(this.world, [input]);
  }
}
