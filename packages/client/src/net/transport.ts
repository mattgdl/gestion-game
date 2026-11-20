/**
 * Transport du multijoueur (J7) : des liens qui portent des messages JSON entre l'hôte et
 * chaque joueur. Deux réalisations : PeerJS (navigateurs reliés en direct) et une boucle en
 * mémoire pour les tests (plusieurs joueurs dans un même programme).
 */
import type { NetMessage } from "./protocol";

export interface Link {
  send(msg: NetMessage): void;
  onMessage(fn: (msg: NetMessage) => void): void;
  onClose(fn: () => void): void;
  close(): void;
}

export interface HostEndpoint {
  onConnection(fn: (link: Link) => void): void;
  close(): void;
}

export interface Network {
  /** Ouvre une salle sous ce code (l'hôte). */
  host(code: string): Promise<HostEndpoint>;
  /** Rejoint la salle de ce code. */
  join(code: string): Promise<Link>;
}

/** Réseau en mémoire : livraison asynchrone, dans l'ordre, comme un vrai lien fiable. */
export class LoopbackNetwork implements Network {
  private hosts = new Map<string, (link: Link) => void>();

  async host(code: string): Promise<HostEndpoint> {
    if (this.hosts.has(code)) throw new Error("Cette salle existe déjà.");
    let handler: ((link: Link) => void) | null = null;
    this.hosts.set(code, (link) => handler?.(link));
    return {
      onConnection: (fn) => {
        handler = fn;
      },
      close: () => this.hosts.delete(code),
    };
  }

  async join(code: string): Promise<Link> {
    const accept = this.hosts.get(code);
    if (!accept) throw new Error("Aucune salle sous ce code.");
    const [a, b] = pair();
    accept(b);
    return a;
  }
}

function pair(): [Link, Link] {
  const make = () => ({ msg: [] as ((m: NetMessage) => void)[], close: [] as (() => void)[], open: true });
  const sa = make();
  const sb = make();
  const link = (self: typeof sa, other: typeof sb): Link => ({
    send: (m) => {
      if (!self.open || !other.open) return;
      const copy = JSON.parse(JSON.stringify(m)) as NetMessage;
      queueMicrotask(() => other.msg.forEach((fn) => fn(copy)));
    },
    onMessage: (fn) => self.msg.push(fn),
    onClose: (fn) => self.close.push(fn),
    close: () => {
      if (!self.open) return;
      self.open = false;
      other.open = false;
      queueMicrotask(() => {
        self.close.forEach((fn) => fn());
        other.close.forEach((fn) => fn());
      });
    },
  });
  return [link(sa, sb), link(sb, sa)];
}
