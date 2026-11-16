/**
 * Une partie en cours : relie la couche Fief (DomainSim), la passerelle Monde et le temps réel.
 * Aucun Phaser ici : l'affichage lit la session, l'interface lui envoie des commandes.
 */
import { DomainSim, TICKS_PER_SECOND, type Command, type CheckResult, type SimEvent } from "@jeu/sim-fief";
import { PLAYER_ID, createWorld, fiefsOwnedBy, lineageSetupFor } from "@jeu/sim-monde";
import { makeSave, type SaveGame } from "../save/save";
import { LocalWorld, type WorldGateway } from "../world-gateway/LocalWorld";

export type Speed = 1 | 2 | 3;

const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Évite de rattraper des minutes de retard d'un coup (onglet en arrière-plan). */
const MAX_TICKS_PER_FRAME = 60;

export class Session {
  paused = false;
  speed: Speed = 1;
  private accumulator = 0;
  private waitingForWorld = false;
  private listeners: ((events: SimEvent[]) => void)[] = [];

  constructor(
    public readonly gateway: WorldGateway,
    public readonly sim: DomainSim,
    /** Identifiant de la partie, conservé dans les sauvegardes (journal de partie). */
    public readonly gameId: string = newGameId(),
  ) {}

  static newGame(seedText: string): Session {
    const world = createWorld(seedText);
    const owned = fiefsOwnedBy(world, PLAYER_ID);
    const sim = DomainSim.create({
      ownerId: PLAYER_ID,
      dims: world.dims,
      fiefs: owned.map((f) => ({ id: f.id, col: f.col, row: f.row })),
      lineage: lineageSetupFor(world, PLAYER_ID),
    });
    return new Session(new LocalWorld(world), sim);
  }

  static fromSave(save: SaveGame): Session {
    return new Session(new LocalWorld(structuredClone(save.world)), DomainSim.fromState(save.domain), save.gameId ?? newGameId());
  }

  toSave(): SaveGame {
    return makeSave(this.gateway.world, this.sim.toJSON(), new Date(), this.gameId);
  }

  get world() {
    return this.gateway.world;
  }

  /** Fraction du tick en cours (0 à 1), pour animer les porteurs entre deux ticks. */
  get tickFraction(): number {
    if (this.paused || this.waitingForWorld || this.sim.state.awaitingBarrier) return 0;
    return Math.min(1, this.accumulator / TICK_MS);
  }

  onEvents(listener: (events: SimEvent[]) => void): void {
    this.listeners.push(listener);
  }

  command(cmd: Command): CheckResult {
    return this.sim.apply(cmd);
  }

  /** Appelé à chaque image avec le temps réel écoulé. Fait avancer la simulation à pas fixe. */
  update(deltaMs: number): void {
    if (this.paused || this.waitingForWorld) return;
    this.accumulator += deltaMs * this.speed;
    const events: SimEvent[] = [];
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < MAX_TICKS_PER_FRAME) {
      this.accumulator -= TICK_MS;
      steps += 1;
      const stepEvents = this.sim.step();
      events.push(...stepEvents);
      if (stepEvents.some((e) => e.type === "barrier")) {
        this.runBarrier();
        // On s'arrête là pour cette image : l'interface lit le bilan avant le passage à l'hiver.
        this.accumulator = 0;
        break;
      }
      if (stepEvents.some((e) => e.type === "gameOver")) {
        this.paused = true;
        this.accumulator = 0;
        break;
      }
    }
    if (steps >= MAX_TICKS_PER_FRAME) this.accumulator = 0;
    if (events.length > 0) for (const l of this.listeners) l(events);
  }

  private runBarrier(): void {
    const input = { ownerId: this.sim.state.ownerId, summary: this.sim.summary(), ready: true as const, actions: this.sim.barrierActions() };
    const result = this.gateway.submitBarrier(input);
    if (result instanceof Promise) {
      this.waitingForWorld = true;
      void result.then((r) => {
        this.sim.applyBarrierResult(r);
        this.waitingForWorld = false;
      });
    } else {
      this.sim.applyBarrierResult(result);
    }
  }
}

/** Identifiant lisible et unique d'une partie (hors simulation : l'aléatoire du navigateur est permis ici). */
export function newGameId(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `p-${stamp}-${Math.floor(Math.random() * 46656).toString(36).padStart(3, "0")}`;
}
