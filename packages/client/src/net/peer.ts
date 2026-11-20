/**
 * Transport PeerJS (J7) : les navigateurs se relient en direct (WebRTC). Le serveur public de
 * PeerJS ne sert qu'à se trouver (le « code de salle ») ; les messages passent ensuite d'un
 * navigateur à l'autre. L'hôte prend l'identifiant `seigneurie-<code>`.
 *
 * Pour les essais en local, `?peer=hôte:port` dans l'adresse de la page vise un serveur PeerJS
 * à soi (npx peerjs --port 9000).
 */
import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import type { NetMessage } from "./protocol";
import type { HostEndpoint, Link, Network } from "./transport";

const PREFIX = "seigneurie-";
const JOIN_TIMEOUT_MS = 15_000;

function peerOptions(): PeerOptions {
  const opts: PeerOptions = { debug: 1 };
  try {
    const custom = new URLSearchParams(location.search).get("peer");
    if (custom) {
      const [host, port] = custom.split(":");
      Object.assign(opts, { host, port: Number(port ?? 9000), path: "/", secure: location.protocol === "https:" && host !== "localhost" });
    }
  } catch {
    // Pas de page (tests) : options par défaut.
  }
  return opts;
}

function wrap(conn: DataConnection): Link {
  return {
    send: (msg) => {
      if (conn.open) void conn.send(msg);
    },
    onMessage: (fn) => conn.on("data", (d) => fn(d as NetMessage)),
    onClose: (fn) => {
      conn.on("close", fn);
      conn.on("error", fn);
    },
    close: () => conn.close(),
  };
}

function explain(err: unknown): string {
  const type = (err as { type?: string })?.type ?? "";
  if (type === "unavailable-id") return "Ce code de salle est déjà pris : choisissez-en un autre.";
  if (type === "peer-unavailable") return "Aucune salle ouverte sous ce code (l'hôte doit garder la page ouverte).";
  if (type === "network" || type === "server-error" || type === "socket-error") return "Impossible de joindre le serveur de mise en relation : vérifiez la connexion Internet.";
  if (type === "browser-incompatible") return "Ce navigateur ne permet pas le multijoueur.";
  return `Connexion impossible (${type || String(err)}).`;
}

export class PeerNetwork implements Network {
  host(code: string): Promise<HostEndpoint> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, peerOptions());
      let handler: ((link: Link) => void) | null = null;
      let opened = false;
      peer.on("open", () => {
        opened = true;
        resolve({
          onConnection: (fn) => {
            handler = fn;
          },
          close: () => peer.destroy(),
        });
      });
      peer.on("connection", (conn) => {
        conn.on("open", () => handler?.(wrap(conn)));
      });
      peer.on("error", (err) => {
        if (!opened) {
          peer.destroy();
          reject(new Error(explain(err)));
        }
      });
      // Le serveur de mise en relation coupe parfois : on se reconnecte (les liens restent).
      peer.on("disconnected", () => {
        if (!peer.destroyed) peer.reconnect();
      });
    });
  }

  join(code: string): Promise<Link> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      let done = false;
      const fail = (msg: string) => {
        if (done) return;
        done = true;
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail("La salle ne répond pas : vérifiez le code, et que l'hôte a la page ouverte."), JOIN_TIMEOUT_MS);
      peer.on("open", () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
        conn.on("open", () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const link = wrap(conn);
          const close = link.close;
          link.close = () => {
            close();
            peer.destroy();
          };
          resolve(link);
        });
      });
      peer.on("error", (err) => {
        clearTimeout(timer);
        fail(explain(err));
      });
    });
  }
}
