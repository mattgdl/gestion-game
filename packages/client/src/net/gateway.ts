/**
 * Passerelle Monde d'une partie à plusieurs (J7) : le monde est l'instantané reçu de l'hôte,
 * la barrière part à la salle et la réponse arrive quand l'hôte a résolu l'année.
 */
import type { BarrierInput, BarrierResult } from "@jeu/shared";
import type { WorldState } from "@jeu/sim-monde";
import type { WorldGateway } from "../world-gateway/LocalWorld";
import type { RoomLike } from "./room";

export class RoomWorld implements WorldGateway {
  constructor(readonly room: RoomLike) {}

  get world(): WorldState {
    return this.room.world as WorldState;
  }

  submitBarrier(input: BarrierInput): Promise<BarrierResult> {
    return this.room.submitBarrier(input);
  }
}
