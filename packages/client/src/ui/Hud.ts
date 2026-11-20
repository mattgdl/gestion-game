/**
 * Interface (DOM) posée au-dessus de la carte : ressources, date, vitesse, outils,
 * panneau du domaine, journal, sauvegardes, étiquettes des fiefs.
 * Elle lit l'état et envoie des commandes ; elle ne contient aucune règle de jeu.
 */
import { DOMINANTS, RESOURCE_IDS, RESOURCE_NAMES, TERRAIN_NAMES, Terrain, type TradeGood } from "@jeu/shared";
import {
  BUILDINGS,
  BUILDING_IDS,
  DAYS_PER_YEAR,
  DEMOGRAPHY,
  ECONOMY,
  GOOD_IDS,
  GOOD_NAMES,
  ageOf,
  dateOf,
  goodsTotal,
  nextMarriageText,
  type Building,
  type DomainSim,
  type GoodId,
  type Goods,
  type ImmigrationLevel,
  type SuccessionLaw,
  type TaxLevel,
  type YearStats,
} from "@jeu/sim-fief";
import { fiefById, lordById, type FiefMeta } from "@jeu/sim-monde";
import type { Multiplayer } from "../net/multiplayer";
import type { RankingRow, RoomPlayer, RoomSettings } from "../net/protocol";
import { hostRoomCodes } from "../save/storage";
import { chatLogHtml, createFormHtml, incomingOffersHtml, joinFormHtml, lobbyHtml, lordLabel, multiMenuHtml, multiStatusHtml, playersHtml, rankingHtml } from "./multi";
import { TILE } from "../camera/InputController";
import type { CameraController } from "../camera/CameraController";
import type { Game, Tool } from "../game/Game";
import type { Speed } from "../game/Session";
import { lordColor } from "../render/palette";
import { parseSave, serializeSave, SaveError, type SaveGame } from "../save/save";
import { readSlot, slotInfo, writeSlot, type SlotId } from "../save/storage";
import type { Journal } from "../telemetry/journal";
import { computeAlerts, foodDays } from "./alerts";
import { chronicleHtml, decisionHtml, lineagePanelHtml, successionHtml } from "./lineage";
import { myFiefsHtml, neighborFiefs, neighborsHtml, offerHtml, realmName } from "./expansion";
import { lordTag, partnerMarketHtml, proposeHtml, suggestedPrice, tradePanelHtml } from "./trade";
import { declareHtml, warPanelHtml } from "./war";
import { fairHtml, fairPotential, needsFacts } from "./needs";
import { escapeHtml, formatCost, formatRealDate } from "./format";

export interface HudActions {
  newGame(seedText: string): void;
  load(save: SaveGame): void;
  focusFief(fiefId: string): void;
  focusHome(): void;
  worldView(): void;
  /** Partie à plusieurs (J7). */
  multi: Multiplayer;
  /** Retour à la partie seule après avoir quitté une salle. */
  backToSolo(): void;
}

interface ToolDef {
  id: string;
  label: string;
  key: string;
  tool: Tool;
  hint: string;
}

const TOOL_DEFS: ToolDef[] = [
  { id: "inspect", label: "Inspecter", key: "Échap", tool: { kind: "inspect" }, hint: "Glisser pour se déplacer, cliquer pour sélectionner." },
  { id: "road", label: "Route", key: "R", tool: { kind: "road" }, hint: "Glisser pour tracer. Les routes relient les bâtiments au manoir." },
  { id: "field", label: "Champ", key: "C", tool: { kind: "field" }, hint: "Glisser pour peindre des champs autour d'une ferme." },
  { id: "demolish", label: "Démolir", key: "X", tool: { kind: "demolish" }, hint: "Rembourse la moitié du coût." },
];

/** Familles de la barre de construction, dans l'ordre (la famille de chaque bâtiment est dans buildings.json). */
const BUILD_CATEGORIES: { id: string; nom: string }[] = [
  { id: "habitat", nom: "Habitat" },
  { id: "vivres", nom: "Vivres" },
  { id: "ressources", nom: "Ressources" },
  { id: "artisanat", nom: "Artisanat" },
  { id: "logistique", nom: "Logistique" },
  { id: "services", nom: "Services" },
  { id: "armee", nom: "Armée" },
];

const BUILD_KEYS: Record<string, string> = {
  maison: "H",
  ferme: "F",
  bucheron: "B",
  carriere: "P",
  entrepot: "E",
  marche: "N",
  eglise: "G",
  forge: "K",
  bergerie: "U",
  tisserand: "T",
  guerisseur: "J",
  relais: "Y",
  caserne: "V",
  armurerie: "I",
};

function toolId(tool: Tool): string {
  return tool.kind === "build" ? `build:${tool.building}` : tool.kind;
}

function seasonClass(index: number): string {
  return ["printemps", "ete", "automne", "hiver"][index] ?? "printemps";
}

export class Hud {
  private el: Record<string, HTMLElement> = {};
  private fiefLabels = new Map<string, HTMLElement>();
  private lastLogLength = -1;
  private lastLogTick = -1;
  private lastSeason = -1;
  private confirmNewGame = false;
  private lastLive = 0;
  private modalOnClose: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
    private readonly camera: CameraController,
    private readonly actions: HudActions,
    private readonly journal: Journal | null = null,
  ) {
    this.render();
    this.bind();
    this.syncPanelButtons();
    game.on("tool", () => {
      this.renderTools();
      this.renderToolCard();
    });
    game.on("selection", () => this.renderSelection());
    game.on("toast", () => this.renderToasts());
    game.on("view", () => this.renderView());
    game.on("session", () => {
      this.buildFiefLabels();
      this.renderDomain();
      this.renderTrade(true);
      this.renderSelection();
      this.renderSaves();
      this.lastLogLength = -1;
    });
    this.buildFiefLabels();
    this.renderDomain();
    this.renderTools();
    this.renderSelection();
    this.renderSaves();
    this.renderView();
    this.root.dataset.panel = "domaine";
    if (window.innerWidth < 900) this.root.classList.add("panel-closed");

    // Les hauteurs du bandeau et de la barre d'outils varient (retour à la ligne sur petit écran) :
    // on les mesure pour placer le reste.
    const topbar = this.root.querySelector<HTMLElement>(".topbar")!;
    const toolbar = this.root.querySelector<HTMLElement>(".toolbar")!;
    const measure = () => {
      this.root.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
      this.root.style.setProperty("--toolbar-h", `${toolbar.offsetHeight}px`);
    };
    measure();
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(measure);
      ro.observe(topbar);
      ro.observe(toolbar);
    }
  }

  /** Zones de l'écran couvertes par l'interface, pour cadrer la caméra sur ce qui reste visible. */
  insets(): { top: number; right: number; bottom: number; left: number } {
    const topbar = this.root.querySelector<HTMLElement>(".topbar")!;
    const toolbar = this.root.querySelector<HTMLElement>(".toolbar")!;
    const panel = this.el.panel!;
    const panelOpen = !this.root.classList.contains("panel-closed") && panel.offsetWidth > 0;
    const panelCoversSide = panelOpen && panel.offsetWidth < window.innerWidth * 0.6;
    return {
      top: topbar.offsetHeight + 10,
      bottom: toolbar.offsetHeight + 10,
      right: panelCoversSide ? window.innerWidth - panel.getBoundingClientRect().left + 10 : 0,
      left: 0,
    };
  }

  // ------------------------------------------------------------ structure

  private render(): void {
    const resources = RESOURCE_IDS.map(
      (id) => `<div class="res res-${id}" title="${RESOURCE_NAMES[id]}">
          <span class="res-label">${RESOURCE_NAMES[id]}</span>
          <span class="res-value" data-res="${id}">0</span>
        </div>`,
    ).join("");

    const tools = TOOL_DEFS.map(
      (t) => `<button class="tool" type="button" data-tool="${t.id}" title="${escapeHtml(t.hint)}">
          <span class="tool-top"><span class="tool-name">${t.label}</span><span class="tool-key">${t.key}</span></span>
        </button>`,
    ).join("");

    const buildButton = (id: string) => {
      const def = BUILDINGS[id]!;
      return `<button class="tool tool-build" type="button" data-tool="build:${id}" title="${escapeHtml(def.utilite)}">
          <span class="tool-top">
            <span class="swatch" style="background:${def.couleur}"></span>
            <span class="tool-name">${def.nom}</span>
            <span class="tool-key">${BUILD_KEYS[id] ?? ""}</span>
          </span>
          <span class="tool-cost">${formatCost(def.cout)}</span>
        </button>`;
    };
    // Les bâtiments sont rangés par famille : un bouton par famille, qui ouvre ses bâtiments.
    const constructible = BUILDING_IDS.filter((id) => BUILDINGS[id]?.constructible);
    const categories = BUILD_CATEGORIES.filter((c) => constructible.some((id) => BUILDINGS[id]?.categorie === c.id));
    const builds = categories
      .map((c) => {
        const ids = constructible.filter((id) => BUILDINGS[id]?.categorie === c.id);
        const keys = ids.map((id) => BUILD_KEYS[id]).filter(Boolean).join(" ");
        return `<button class="tool tool-cat" type="button" data-cat="${c.id}" title="${escapeHtml(ids.map((id) => BUILDINGS[id]!.nom).join(", "))}">
          <span class="tool-top"><span class="tool-name">${c.nom}</span><span class="tool-key">${keys}</span></span>
          <span class="tool-cost">${ids.map((id) => BUILDINGS[id]!.nom).join(" · ")}</span>
        </button>`;
      })
      .join("");
    const menus = categories
      .map((c) => `<div class="build-menu" data-menu="${c.id}" hidden>${constructible.filter((id) => BUILDINGS[id]?.categorie === c.id).map(buildButton).join("")}</div>`)
      .join("");

    this.root.innerHTML = `
      <header class="topbar">
        <div class="realm">
          <span class="realm-name" data-el="realmName"></span>
          <span class="realm-sub" data-el="realmSub"></span>
        </div>
        <div class="resources">${resources}
          <div class="res res-stock" title="Marchandises en réserve / capacité des réserves (manoir et entrepôts)">
            <span class="res-label">Réserves</span>
            <span class="res-value" data-el="stockValue">0</span>
          </div>
          <div class="res res-pop" title="Habitants : adultes et enfants">
            <span class="res-label">Habitants</span>
            <span class="res-value" data-el="popValue">0</span>
          </div>
          <div class="res res-moral" title="Moral moyen des foyers, de 0 à 100 (50 = neutre)">
            <span class="res-label">Moral</span>
            <span class="res-value" data-el="moraleValue">0</span>
          </div>
          <div class="res res-prestige" title="Prestige de la lignée : population, or, ancienneté, successions, Église et alliances">
            <span class="res-label">Prestige</span>
            <span class="res-value" data-el="prestigeValue">0</span>
          </div>
        </div>
        <div class="clock">
          <div class="date" data-el="date"></div>
          <div class="season-track" aria-hidden="true"><span data-el="seasonFill"></span></div>
          <div class="speed" role="group" aria-label="Vitesse">
            <button type="button" class="speed-btn" data-speed="0" title="Pause (Espace)">❚❚</button>
            <button type="button" class="speed-btn" data-speed="1" title="Vitesse normale (1)">×1</button>
            <button type="button" class="speed-btn" data-speed="2" title="Vitesse ×2 (2)">×2</button>
            <button type="button" class="speed-btn" data-speed="3" title="Vitesse ×3 (3)">×3</button>
          </div>
          <div class="wait-banner small" data-el="waitBanner" hidden></div>
        </div>
        <div class="panel-toggles" role="group" aria-label="Panneaux">
          <button type="button" class="panel-toggle" data-panel-toggle="domaine" title="Votre domaine : village, lignée, logistique, fiefs">Domaine</button>
          <button type="button" class="panel-toggle" data-panel-toggle="voisins" title="Les seigneurs voisins : achats, guerre, commerce">Voisins<span class="badge" data-el="voisinsBadge" hidden></span></button>
        </div>
      </header>

      <div class="fief-labels" data-el="fiefLabels"></div>

      <div class="view-controls">
        <span class="view-level" data-el="viewLevel"></span>
        <button type="button" data-act="home" title="Revenir au manoir (O)">Mon fief</button>
        <button type="button" data-act="world" title="Vue Monde (M)">Vue Monde</button>
        <button type="button" data-act="zoomin" aria-label="Zoomer" title="Zoomer (+)">+</button>
        <button type="button" data-act="zoomout" aria-label="Dézoomer" title="Dézoomer (−)">−</button>
      </div>
      <ul class="alerts" data-el="alerts" aria-live="polite"></ul>

      <div class="info-stack">
        <div class="hover-card" data-el="hoverCard" hidden></div>
        <div class="tool-card" data-el="toolCard" hidden></div>
      </div>
      <div class="toasts" data-el="toasts" aria-live="polite"></div>

      <aside class="panel" data-el="panel">
        <section class="panel-section" data-panel="domaine">
          <h2>Sélection</h2>
          <div data-el="selection"></div>
        </section>
        <section class="panel-section" data-panel="domaine">
          <h2>Village</h2>
          <div data-el="village"></div>
          <div class="tax" role="group" aria-label="Impôts">
            <span class="tax-label">Impôts</span>
            <button type="button" class="btn btn-small" data-tax="aucun" title="0 or par foyer · moral +10">Aucun</button>
            <button type="button" class="btn btn-small" data-tax="normal" title="4 or par foyer · moral 0">Normaux</button>
            <button type="button" class="btn btn-small" data-tax="lourd" title="8 or par foyer · moral −15">Lourds</button>
          </div>
          <p class="muted small" data-el="taxHint"></p>
          <div class="tax tax-stack" role="group" aria-label="Nouveaux venus">
            <span class="tax-label">Nouveaux venus</span>
            <button type="button" class="btn btn-small" data-immigration="fermee" title="Personne ne vient s'installer">Fermé</button>
            <button type="button" class="btn btn-small" data-immigration="normale" title="${perYear("normale")} · moral ${signed(DEMOGRAPHY.moral.immigration.normale)}">Normal</button>
            <button type="button" class="btn btn-small" data-immigration="ouverte" title="${perYear("ouverte")} · moral ${signed(DEMOGRAPHY.moral.immigration.ouverte)}">Ouvert</button>
          </div>
          <p class="muted small" data-el="immigrationHint"></p>
        </section>
        <section class="panel-section" data-panel="domaine">
          <h2>Lignée</h2>
          <div class="lineage" data-el="lineage"></div>
        </section>
        <section class="panel-section" data-panel="domaine">
          <h2>Logistique</h2>
          <div data-el="logistics"></div>
          <button type="button" class="btn btn-small" data-act="routes" aria-pressed="false">Montrer les itinéraires (L)</button>
        </section>
        <section class="panel-section" data-panel="domaine">
          <h2>Vos fiefs</h2>
          <div class="domain" data-el="fiefList"></div>
        </section>
        <section class="panel-section" data-panel="voisins" data-el="playersSection" hidden>
          <h2>Joueurs</h2>
          <div data-el="players"></div>
          <div data-el="incoming"></div>
          <h3>Messages</h3>
          <ol class="chat" data-el="chatLog"></ol>
          <form class="chat-form" data-el="chatForm"><input name="msg" maxlength="300" autocomplete="off" placeholder="Écrire à toute la salle…" /><button type="submit" class="btn btn-small">Envoyer</button></form>
        </section>
        <section class="panel-section" data-panel="voisins">
          <h2>Fiefs voisins</h2>
          <div class="domain" data-el="neighbors"></div>
        </section>
        <section class="panel-section" data-panel="voisins">
          <h2>Guerre</h2>
          <div class="domain" data-el="war"></div>
        </section>
        <section class="panel-section" data-panel="voisins">
          <h2>Commerce</h2>
          <div class="domain" data-el="trade"></div>
        </section>
        <section class="panel-section" data-panel="domaine">
          <h2>Événements</h2>
          <ol class="log" data-el="log"></ol>
        </section>
        <section class="panel-section" data-panel="domaine">
          <h2>Partie</h2>
          <div data-el="saves"></div>
          <div class="journal" data-el="journal"></div>
        </section>
      </aside>

      <nav class="toolbar" aria-label="Outils">
        <div class="build-menus">${menus}</div>
        <div class="toolbar-inner">
          <div class="tool-group">${tools}</div>
          <div class="tool-group tool-group-build">${builds}</div>
        </div>
      </nav>

      <div class="modal" data-el="modal" hidden>
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title" data-el="modalTitle"></h2>
          <div data-el="modalBody"></div>
        </div>
      </div>
    `;
    this.root.querySelectorAll<HTMLElement>("[data-el]").forEach((n) => {
      this.el[n.dataset.el as string] = n;
    });
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
      b.addEventListener("click", () => this.selectToolById(b.dataset.tool as string));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) => {
      b.addEventListener("click", () => this.openCategory(this.openCat === b.dataset.cat ? null : (b.dataset.cat as string)));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => {
      b.addEventListener("click", () => this.setSpeed(Number(b.dataset.speed)));
    });
    this.root.querySelector('[data-act="home"]')?.addEventListener("click", () => this.actions.focusHome());
    this.root.querySelector('[data-act="routes"]')?.addEventListener("click", () => this.game.toggleRoutes());
    this.root.querySelectorAll<HTMLButtonElement>("[data-tax]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.game.command({ type: "setTax", level: btn.dataset.tax as TaxLevel });
        this.renderVillage();
      }),
    );
    this.el.lineage!.addEventListener("click", (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-decide],[data-law],[data-act]");
      if (!target) return;
      if (target.dataset.decide) this.openDecision(Number(target.dataset.decide));
      else if (target.dataset.law) {
        const result = this.game.command({ type: "decreeLaw", law: target.dataset.law as SuccessionLaw });
        if (!result.ok && result.reason) this.game.toast(result.reason);
        this.renderLineage();
      } else if (target.dataset.act === "chronicle") this.openChronicle();
    });
    this.el.village!.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest('[data-act="fair"]')) this.openFair();
    });
    const fiefClicks = (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-fief],[data-offer],[data-cancel],[data-war]");
      if (!target) return;
      if (target.dataset.war) this.openDeclare(target.dataset.war);
      else if (target.dataset.offer) this.openOffer(target.dataset.offer);
      else if (target.dataset.cancel) {
        const result = this.game.command({ type: "cancelOffer", fiefId: target.dataset.cancel });
        if (!result.ok && result.reason) this.game.toast(result.reason);
        this.renderDomain();
      } else if (target.dataset.fief) this.actions.focusFief(target.dataset.fief);
    };
    this.el.fiefList!.addEventListener("click", fiefClicks);
    this.el.incoming!.addEventListener("click", (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-answer]");
      if (!target) return;
      const result = this.game.command({ type: "answerFiefOffer", offerId: target.dataset.answer!, accept: target.dataset.accept === "1" });
      if (!result.ok && result.reason) this.game.toast(result.reason, "error");
      this.renderMulti(true);
    });
    this.el.chatForm!.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const input = this.el.chatForm!.querySelector<HTMLInputElement>("input")!;
      const text = input.value.trim();
      if (!text) return;
      this.actions.multi.say(text);
      input.value = "";
    });
    this.el.neighbors!.addEventListener("click", fiefClicks);
    this.el.war!.addEventListener("click", (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-endwar],[data-unwar],[data-act]");
      if (!target) return;
      const run = (cmd: Parameters<Game["command"]>[0]) => {
        const result = this.game.command(cmd);
        if (!result.ok && result.reason) this.game.toast(result.reason);
        this.renderWar(true);
      };
      if (target.dataset.endwar) run({ type: "endWar", warId: target.dataset.endwar });
      else if (target.dataset.unwar) run({ type: "cancelWarDeclaration", actionId: target.dataset.unwar });
      else if (target.dataset.act === "hire") {
        const input = this.el.war!.querySelector<HTMLInputElement>('[data-el="mercCount"]');
        run({ type: "hireMercenaries", count: Math.floor(Number(input?.value ?? 0)) });
      }
    });
    this.el.trade!.addEventListener("click", (ev) => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-accept],[data-refuse],[data-break],[data-withdraw],[data-act]");
      if (!target) return;
      const run = (cmd: Parameters<Game["command"]>[0]) => {
        const result = this.game.command(cmd);
        if (!result.ok && result.reason) this.game.toast(result.reason);
        this.renderTrade(true);
      };
      if (target.dataset.accept) run({ type: "acceptTradeProposal", proposalId: target.dataset.accept });
      else if (target.dataset.refuse) run({ type: "refuseTradeProposal", proposalId: target.dataset.refuse });
      else if (target.dataset.withdraw) run({ type: "withdrawTradeProposal", actionId: target.dataset.withdraw });
      else if (target.dataset.break) {
        // Deux clics : rompre coûte de la relation.
        if (target.dataset.confirm !== "1") {
          target.dataset.confirm = "1";
          target.textContent = "Confirmer la rupture";
          target.classList.add("btn-danger");
          return;
        }
        run({ type: "cancelTrade", agreementId: target.dataset.break });
      } else if (target.dataset.act === "propose") this.openPropose();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-immigration]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.game.command({ type: "setImmigration", level: btn.dataset.immigration as ImmigrationLevel });
        this.renderVillage();
      }),
    );
    this.game.on("routes", () => {
      const btn = this.root.querySelector<HTMLButtonElement>('[data-act="routes"]');
      if (!btn) return;
      btn.setAttribute("aria-pressed", String(this.game.showRoutes));
      btn.textContent = this.game.showRoutes ? "Masquer les itinéraires (L)" : "Montrer les itinéraires (L)";
      btn.classList.toggle("is-active", this.game.showRoutes);
    });
    this.root.querySelector('[data-act="world"]')?.addEventListener("click", () => this.actions.worldView());
    this.root.querySelector('[data-act="zoomin"]')?.addEventListener("click", () => this.zoomCenter(1.4));
    this.root.querySelector('[data-act="zoomout"]')?.addEventListener("click", () => this.zoomCenter(1 / 1.4));
    this.root.querySelectorAll<HTMLButtonElement>("[data-panel-toggle]").forEach((btn) =>
      btn.addEventListener("click", () => this.togglePanel(btn.dataset.panelToggle as "domaine" | "voisins")),
    );
    this.el.modal!.addEventListener("click", (e) => {
      if (e.target === this.el.modal) this.closeModal();
    });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.camera.keys.clear());
  }

  private zoomCenter(factor: number): void {
    this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, factor);
  }

  private selectToolById(id: string): void {
    if (this.openCat !== null) this.openCategory(null);
    if (id.startsWith("build:")) this.game.setTool({ kind: "build", building: id.slice(6) });
    else {
      const def = TOOL_DEFS.find((t) => t.id === id);
      if (def) this.game.setTool(def.tool);
    }
  }

  private setSpeed(speed: number): void {
    const s = this.game.session;
    if (s.room) {
      // Partie à plusieurs : l'hôte règle la vitesse et la pause de toute la salle.
      if (!s.room.isHost) {
        this.game.toast("Seul l'hôte règle la vitesse et la pause de la salle.");
        return;
      }
      if (speed === 0) this.actions.multi.setControl(s.room.speed, !s.room.paused);
      else this.actions.multi.setControl(speed as Speed, false);
      return;
    }
    if (speed === 0) s.paused = !s.paused;
    else {
      s.paused = false;
      s.speed = speed as Speed;
    }
  }

  // ------------------------------------------------------------ clavier

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (!this.el.modal!.hidden) {
      if (e.key === "Escape") this.closeModal();
      return;
    }
    const pan: Record<string, string> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      KeyA: "left",
      KeyD: "right",
      KeyW: "up",
      KeyS: "down",
    };
    const dir = pan[e.code];
    if (dir) {
      this.camera.keys.add(dir);
      e.preventDefault();
      return;
    }
    if (e.code === "Space") {
      this.setSpeed(0);
      e.preventDefault();
      return;
    }
    if (e.code === "Digit1" || e.code === "Numpad1") return this.setSpeed(1);
    if (e.code === "Digit2" || e.code === "Numpad2") return this.setSpeed(2);
    if (e.code === "Digit3" || e.code === "Numpad3") return this.setSpeed(3);
    const key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (this.openCat !== null) return this.openCategory(null);
      return this.game.setTool({ kind: "inspect" });
    }
    if (key === "r") return this.selectToolById("road");
    if (key === "c") return this.selectToolById("field");
    if (key === "x" || e.key === "Delete") return this.selectToolById("demolish");
    if (key === "m") return this.actions.worldView();
    if (key === "l") return this.game.toggleRoutes();
    if (key === "o" || e.key === "Home") return this.actions.focusHome();
    if (e.key === "+" || e.code === "NumpadAdd") return this.zoomCenter(1.4);
    if (e.key === "-" || e.code === "NumpadSubtract") return this.zoomCenter(1 / 1.4);
    for (const [id, k] of Object.entries(BUILD_KEYS)) {
      if (key === k.toLowerCase()) return this.selectToolById(`build:${id}`);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const map: Record<string, string> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      KeyA: "left",
      KeyD: "right",
      KeyW: "up",
      KeyS: "down",
    };
    const dir = map[e.code];
    if (dir) this.camera.keys.delete(dir);
  };

  // ------------------------------------------------------------ rendus ponctuels

  /** Famille de bâtiments ouverte au-dessus de la barre (null : aucune). */
  private openCat: string | null = null;

  private openCategory(cat: string | null): void {
    this.openCat = cat;
    this.root.querySelectorAll<HTMLElement>("[data-menu]").forEach((m) => (m.hidden = m.dataset.menu !== cat));
    this.renderTools();
  }

  private renderTools(): void {
    const active = toolId(this.game.tool);
    // La famille du bâtiment choisi est mise en avant ; son menu se referme une fois le bâtiment choisi.
    const activeCat = this.game.tool.kind === "build" ? BUILDINGS[this.game.tool.building]?.categorie : undefined;
    this.root.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.cat === activeCat);
      b.classList.toggle("is-open", b.dataset.cat === this.openCat);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
      const on = b.dataset.tool === active;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    this.root.classList.toggle("tool-active", this.game.tool.kind !== "inspect");
  }

  private renderView(): void {
    const names = { proche: "Vue proche", moyenne: "Vue des fiefs", monde: "Vue Monde" };
    this.el.viewLevel!.textContent = names[this.game.viewLevel];
    this.root.dataset.view = this.game.viewLevel;
  }

  private renderToasts(): void {
    this.el.toasts!.innerHTML = this.game.toasts
      .map((t) => `<div class="toast toast-${t.tone}">${escapeHtml(t.text)}</div>`)
      .join("");
  }

  private renderSelection(): void {
    const sim = this.game.session.sim;
    const id = this.game.selectedBuildingId;
    const b = id !== null ? sim.building(id) : undefined;
    const box = this.el.selection!;
    if (!b) {
      box.innerHTML = `<p class="muted">Cliquez sur un bâtiment avec l'outil Inspecter pour voir son état.</p>`;
      return;
    }
    const def = BUILDINGS[b.type]!;
    const connected = sim.isConnected(b.id);
    const fief = fiefById(this.game.session.world, b.fiefId);
    const refund = sim.check({ type: "demolish", x: b.x, y: b.y });
    box.innerHTML = `
      <div class="sel-head"><span class="swatch" style="background:${def.couleur}"></span><strong>${def.nom}</strong></div>
      <p>${escapeHtml(def.description)}</p>
      <dl class="facts">
        <div><dt>Taille</dt><dd>${def.taille[0]} × ${def.taille[1]} cases</dd></div>
        <div><dt>Fief</dt><dd>${escapeHtml(fief?.name ?? b.fiefId)}</dd></div>
        <div><dt>Route</dt><dd class="${connected ? "ok" : "bad"}">${connected ? "Relié au manoir" : "Non relié : tracez une route jusqu'au manoir"}</dd></div>
      </dl>
      ${
        def.travailleurs
          ? `<div class="workers-ctl" role="group" aria-label="Travailleurs">
              <span>Travailleurs</span>
              <button type="button" class="btn btn-small" data-act="w-minus" aria-label="Un travailleur de moins">−</button>
              <strong data-el="wCount"></strong>
              <button type="button" class="btn btn-small" data-act="w-plus" aria-label="Un travailleur de plus">+</button>
            </div>`
          : ""
      }
      <div class="sel-live" data-el="selLive"></div>
      ${
        b.type !== "manoir"
          ? `<button type="button" class="btn btn-danger" data-act="demolish-selected">Démolir (rend ${formatCost(refund.refund)})</button>`
          : ""
      }`;
    box.querySelector('[data-act="demolish-selected"]')?.addEventListener("click", () => this.demolish(b));
    const setWorkers = (delta: number) => {
      const max = def.travailleurs ?? 0;
      const current = b.workersLimit ?? max;
      const next = Math.max(0, Math.min(max, current + delta));
      if (next !== current) this.game.command({ type: "setWorkers", buildingId: b.id, count: next });
      this.renderSelectionLive();
    };
    box.querySelector('[data-act="w-minus"]')?.addEventListener("click", () => setWorkers(-1));
    box.querySelector('[data-act="w-plus"]')?.addEventListener("click", () => setWorkers(1));
    this.renderSelectionLive();
  }

  /** Partie vivante du panneau de sélection (état, stocks, porteurs), rafraîchie 4 fois par seconde. */
  private renderSelectionLive(): void {
    const live = this.el.selection!.querySelector<HTMLElement>('[data-el="selLive"]');
    const sim = this.game.session.sim;
    const id = this.game.selectedBuildingId;
    const b = id !== null ? sim.building(id) : undefined;
    if (!live || !b) return;
    const def = BUILDINGS[b.type]!;
    const eco = sim.economy;
    const status = eco.status(b.id);
    const rows: string[] = [];
    if (status.text) rows.push(`<p class="status status-${status.tone}">${escapeHtml(status.text)}</p>`);
    const facts: string[] = [];
    if (def.stockage) {
      facts.push(`<div><dt>Contenu</dt><dd>${formatGoods(b.stock, "vide")}</dd></div>`);
      facts.push(`<div><dt>Rempli</dt><dd>${goodsTotal(b.stock)} / ${def.stockage.capacite}</dd></div>`);
      const incoming = eco.incoming(b.id);
      if (incoming > 0) facts.push(`<div><dt>En route</dt><dd>+${incoming}</dd></div>`);
    }
    if (def.production) {
      const prod = def.production;
      facts.push(`<div><dt>Rendement</dt><dd>${Math.round(eco.efficiency(b.id) / 10)} % de ${prod.parAn} ${GOOD_NAMES[prod.ressource].toLowerCase()} par an</dd></div>`);
    }
    if (def.agriculture) {
      const info = eco.farmInfo(b.id);
      if (info) {
        facts.push(`<div><dt>Champs</dt><dd>${info.fields.length} / ${info.max} travaillés</dd></div>`);
        if (info.idleNearby > 0) facts.push(`<div><dt>En friche</dt><dd class="bad">${info.idleNearby} champ${info.idleNearby > 1 ? "s" : ""} de trop</dd></div>`);
        facts.push(`<div><dt>Récolte</dt><dd>${info.expected > 0 ? `${info.expected} nourriture attendue` : "rien d'attendu"}</dd></div>`);
      }
    }
    if (def.transport && !def.marche) {
      facts.push(`<div><dt>En attente</dt><dd>${formatGoods(b.stock, "rien")} <span class="muted">(max ${def.stockMax ?? 0})</span></dd></div>`);
    }
    if (def.marche) {
      facts.push(`<div><dt>Étals</dt><dd>${formatGoods(b.stock, "vides")} <span class="muted">(${def.marche.capacite} places)</span></dd></div>`);
    }
    if (facts.length > 0) rows.push(`<dl class="facts">${facts.join("")}</dl>`);
    const pop = sim.population;
    const tick = sim.state.tick;
    if (def.travailleurs) {
      const max = def.travailleurs;
      const limit = b.workersLimit ?? max;
      const ids = pop.workers(b.id);
      const wCount = this.el.selection!.querySelector<HTMLElement>('[data-el="wCount"]');
      const wText = `${ids.length} / ${limit}${limit < max ? ` (sur ${max})` : ""}`;
      if (wCount && wCount.textContent !== wText) wCount.textContent = wText;
      if (ids.length > 0) {
        const names = ids.map((id) => {
          const v = pop.villager(id);
          return v ? `${escapeHtml(v.name)} (${ageOf(v, tick)} ans)` : "";
        });
        rows.push(`<p class="small muted">${names.join(", ")}</p>`);
      }
    }
    if (def.logement) {
      const fam = pop.familyInHouse(b.id);
      if (fam) {
        const people = pop.members(fam.id).map((v) => {
          const role = v.id === fam.husbandId || v.id === fam.wifeId ? "" : v.sex === "F" ? ", fille" : ", fils";
          return `${escapeHtml(v.name)} (${ageOf(v, tick)} ans${role})`;
        });
        const season = sim.date.seasonIndex;
        const morale = pop.moraleOf(fam, season);
        let daily = 0;
        for (const v of pop.members(fam.id)) daily += ageOf(v, tick) >= 14 ? 50 : 25;
        const days = daily > 0 ? Math.floor(fam.food / daily) : 0;
        rows.push(`<h3>Foyer</h3><p class="small">${people.join(", ")}</p>`);
        rows.push(`<dl class="facts">
          <div><dt>Vivres</dt><dd>${days} jours</dd></div>
          <div><dt>Bois</dt><dd>${(fam.wood / 1000).toFixed(1)}</dd></div>
          <div><dt>Moral</dt><dd>${morale.total} <span class="muted">(${morale.parts.map((p) => `${escapeHtml(p.label)} ${p.value > 0 && p.label !== "Base" ? "+" : ""}${p.value}`).join(", ")})</span></dd></div>
        </dl>`);
      }
    }
    if (def.transport) {
      const tick = sim.state.tick;
      const porters = eco.porters(b.id).map(({ delivery: d }, i) => {
        if (!d) return `<li><span class="porter-n">${i + 1}</span>Au repos</li>`;
        const dest = sim.building(d.toId);
        const destName = dest ? (BUILDINGS[dest.type]?.nom ?? "réserve") : "réserve démolie";
        const goods = `${d.amount} ${GOOD_NAMES[d.good].toLowerCase()}`;
        if (d.kind === "collecte") {
          if (d.status === "aller") return `<li><span class="porter-n">${i + 1}</span>Va chercher ${goods} à ${escapeHtml(destName)} · ${seconds(d.arriveTick - tick)}</li>`;
          return `<li><span class="porter-n">${i + 1}</span>Rapporte ${goods} · ${seconds(d.returnTick - tick)}</li>`;
        }
        if (d.status === "aller") return `<li><span class="porter-n">${i + 1}</span>Porte ${goods} vers ${escapeHtml(destName)} · ${seconds(d.arriveTick - tick)}</li>`;
        if (d.status === "rapporte") return `<li><span class="porter-n">${i + 1}</span>Rapporte ${goods} · ${seconds(d.returnTick - tick)}</li>`;
        return `<li><span class="porter-n">${i + 1}</span>Revient à vide · ${seconds(d.returnTick - tick)}</li>`;
      });
      rows.push(`<h3>Porteurs (charge ${def.transport.charge})</h3><ul class="porters">${porters.join("")}</ul>`);
    } else if (def.logement) {
      const trip = sim.state.deliveries.find((d) => d.fromId === b.id);
      if (trip) {
        const dest = sim.building(trip.toId);
        const destName = dest ? (BUILDINGS[dest.type]?.nom ?? "réserve") : "réserve";
        const goods = `${trip.amount} ${GOOD_NAMES[trip.good].toLowerCase()}`;
        const text = trip.status === "aller" ? `Va chercher ${goods} à ${escapeHtml(destName)}` : `Rapporte ${goods}`;
        rows.push(`<p class="small">${text} · ${seconds((trip.status === "aller" ? trip.arriveTick : trip.returnTick) - tick)}</p>`);
      }
    }
    const html = rows.join("");
    if (live.innerHTML !== html) live.innerHTML = html;
  }

  /** Fiche de l'outil actif : à quoi sert le bâtiment, ce qu'il coûte, où le poser. */
  private renderToolCard(): void {
    const card = this.el.toolCard!;
    const tool = this.game.tool;
    const sim = this.game.session.sim;
    let html = "";
    if (tool.kind === "build") {
      const def = BUILDINGS[tool.building];
      if (def) {
        const totals = sim.totals();
        const costs = RESOURCE_IDS.filter((id) => (def.cout[id] ?? 0) > 0).map((id) => {
          const need = def.cout[id] ?? 0;
          const missing = totals[id] < need;
          return `<span class="${missing ? "bad" : ""}">${need} ${RESOURCE_NAMES[id].toLowerCase()}${missing ? ` (vous avez ${Math.floor(totals[id])})` : ""}</span>`;
        });
        const conds: string[] = [];
        if (def.procheDe) {
          const terrain = def.procheDe.terrain === "foret" ? "d'une forêt" : def.procheDe.terrain === "roche" ? "d'une roche" : `de : ${def.procheDe.terrain}`;
          conds.push(`À ${def.procheDe.rayon} cases au plus ${terrain}.`);
        }
        conds.push("Doit toucher une route reliée au manoir pour fonctionner.");
        if (def.uniqueParFief) conds.push("Une seule par fief.");
        if (def.unique) {
          const built = sim.state.buildings.some((b) => b.type === tool.building);
          conds.push(built ? "Un seul exemplaire possible : déjà construit." : "Un seul exemplaire possible.");
        }
        html = `
          <div class="tc-head"><span class="swatch" style="background:${def.couleur}"></span><strong>${escapeHtml(def.nom)}</strong><span class="tc-size">${def.taille[0]} × ${def.taille[1]} cases</span></div>
          <div class="tc-cost">${costs.length > 0 ? costs.join(" · ") : "gratuit"}</div>
          <p>${escapeHtml(def.utilite)}</p>
          ${def.actifDes ? `<p class="tc-warn">Pas encore d'effet dans cette version : il servira à partir de ${escapeHtml(def.actifDes)}.</p>` : ""}
          ${def.logement ? newHouseLine(sim) : ""}
          <ul class="tc-conds">${conds.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`;
      }
    } else if (tool.kind === "road") {
      html = `<div class="tc-head"><strong>Route</strong><span class="tc-size">${formatCost(ECONOMY.coutRoute)} par case</span></div>
        <p>Relie les bâtiments au manoir. Les porteurs ne circulent que sur les routes, par le plus court chemin.</p>
        <ul class="tc-conds"><li>Glisser pour tracer ; la forêt est défrichée au passage.</li><li>Sur l'eau, la route devient un pont : ${formatCost(ECONOMY.coutPont)} par case.</li><li>Pas sur la roche.</li></ul>`;
    } else if (tool.kind === "field") {
      html = `<div class="tc-head"><strong>Champ</strong><span class="tc-size">gratuit</span></div>
        <p>Une ferme travaille au plus 12 champs, les plus proches d'abord. Les autres restent en friche (hachurés, aperçu orange).</p>
        <ul class="tc-conds"><li>Couleurs : fertilité, du rouge (pauvre) au vert (riche).</li><li>Un champ peint après le printemps ne donne rien avant l'an prochain.</li></ul>`;
    } else if (tool.kind === "demolish") {
      html = `<div class="tc-head"><strong>Démolir</strong></div>
        <p>Rend la moitié du coût. Le contenu d'un entrepôt démoli est déménagé dans les autres réserves.</p>`;
    }
    const compact = html.replace(/\s+/g, " ").trim();
    if (card.dataset.html !== compact) {
      card.dataset.html = compact;
      card.innerHTML = html;
    }
    card.hidden = html === "";
  }

  /** État du journal de partie (partagé avec Claude ou non), avec le bouton pour l'activer ou l'arrêter. */
  private renderJournal(): void {
    const j = this.journal;
    const box = this.el.journal!;
    if (!j) return;
    let text = "";
    let button = "";
    switch (j.status) {
      case "actif": {
        const ago = j.lastSentAt === null ? null : Math.round((Date.now() - j.lastSentAt) / 1000);
        text = `Journal de partie partagé avec Claude${ago === null ? "." : ` · envoyé il y a ${ago} s.`}`;
        button = "Arrêter le partage";
        break;
      }
      case "attente":
        text = "Journal de partie : connexion…";
        break;
      case "desactive":
        text = "Journal de partie : non partagé.";
        button = "Partager avec Claude";
        break;
      case "erreur":
        text = `Journal de partie : dernier envoi en échec (${j.lastError ?? "inconnu"}), nouvel essai sous 30 s.`;
        button = "Arrêter le partage";
        break;
      default:
        text = "Journal de partie : disponible seulement dans la page publiée sur claude.ai.";
    }
    const html = `<p class="muted small">${escapeHtml(text)}</p>${button ? `<button type="button" class="btn btn-small" data-act="journal">${button}</button>` : ""}`;
    if (box.innerHTML !== html) box.innerHTML = html;
    if (!box.dataset.bound) {
      box.dataset.bound = "1";
      box.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest('[data-act="journal"]')) return;
        j.setEnabled(!j.isEnabled);
        this.renderJournal();
      });
    }
  }

  private renderVillage(): void {
    const sim = this.game.session.sim;
    const pop = sim.population;
    const c = pop.counts();
    const stats = sim.state.yearStats;
    const yearly = Math.round((pop.dailyFoodNeed() * DAYS_PER_YEAR) / 1000);
    const days = foodDays(sim);
    const facts = [
      `<div><dt>Habitants</dt><dd>${c.total} <span class="muted">(${c.adults} adultes, ${c.children} enfants)</span></dd></div>`,
      `<div><dt>Foyers</dt><dd>${c.families}${c.homeless > 0 ? ` <span class="bad">dont ${c.homeless} sans abri</span>` : ""}</dd></div>`,
      `<div><dt>Emplois</dt><dd>${c.employed} / ${c.jobs} occupés <span class="muted">(${c.workers} en âge de travailler)</span></dd></div>`,
      `<div><dt>Vivres</dt><dd class="${days < 30 ? "bad" : ""}">${days === Infinity ? "—" : `${days} jours`} <span class="muted">(on mange ${yearly} par an)</span></dd></div>`,
      `<div><dt>Récolte</dt><dd>${sim.economy.expectedHarvest()} encore attendue</dd></div>`,
      `<div><dt>Cette année</dt><dd>${stats.births ?? 0} naissance${(stats.births ?? 0) > 1 ? "s" : ""}, ${stats.deaths ?? 0} décès${(stats.marriages ?? 0) > 0 ? `, ${stats.marriages} mariage${(stats.marriages ?? 0) > 1 ? "s" : ""}` : ""}</dd></div>`,
    ];
    facts.push(...needsFacts(sim));
    const fair = sim.needs.fairOpen()
      ? `<button type="button" class="btn btn-small btn-primary" data-act="fair">Foire d'automne : ouverte</button>`
      : `<button type="button" class="btn btn-small" data-act="fair">Foire d'automne (prix)</button>`;
    const html = `<dl class="facts">${facts.join("")}</dl>${fair}`;
    if (this.el.village!.innerHTML !== html) this.el.village!.innerHTML = html;
    const level = sim.state.taxLevel;
    this.root.querySelectorAll<HTMLButtonElement>("[data-tax]").forEach((btn) => {
      const on = btn.dataset.tax === level;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const housed = c.families - c.homeless;
    const rates: Record<TaxLevel, number> = ECONOMY.impotsParFoyer;
    const hint = `Perçus au bilan d'automne : ${rates[level] * housed} or (${housed} foyer${housed > 1 ? "s" : ""} logé${housed > 1 ? "s" : ""}).`;
    if (this.el.taxHint!.textContent !== hint) this.el.taxHint!.textContent = hint;
    const welcome = sim.state.immigration;
    this.root.querySelectorAll<HTMLButtonElement>("[data-immigration]").forEach((btn) => {
      const on = btn.dataset.immigration === welcome;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const im = pop.immigrationCheck();
    const arrived = im.arrived > 0 ? `${im.arrived} famille${im.arrived > 1 ? "s" : ""} accueillie${im.arrived > 1 ? "s" : ""} cette année. ` : "";
    const moraleCost = DEMOGRAPHY.moral.immigration[welcome];
    const rate = `${perYear(welcome)}${moraleCost !== 0 ? `, moral ${signed(moraleCost)}` : ""}. `;
    const imHint =
      welcome === "fermee" ? "Personne ne vient s'installer." : `${rate}${arrived}${im.ready ? `Une famille arrivera ${nextArrival(sim.date.seasonIndex)}.` : (im.reason ?? "")}`;
    if (this.el.immigrationHint!.textContent !== imHint) this.el.immigrationHint!.textContent = imHint;
  }

  private renderLineage(): void {
    const html = lineagePanelHtml(this.game.session.sim);
    const box = this.el.lineage!;
    if (box.dataset.html !== html) {
      box.dataset.html = html;
      box.innerHTML = html;
    }
  }

  /** Fenêtre d'une affaire de famille : la partie se met en pause le temps de choisir. */
  openDecision(memberId: number): void {
    const session = this.game.session;
    const view = decisionHtml(session.sim, memberId);
    if (!view) return;
    const wasPaused = session.paused;
    session.paused = true;
    const body = this.openModal(view.title, view.body, () => {
      if (this.game.session === session) session.paused = wasPaused;
    });
    body.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const raw = btn.dataset.choice as string;
        const choice = /^\d+$/.test(raw) ? Number(raw) : (raw as "eglise" | "alliance" | "refuser");
        const result = this.game.command({ type: "familyDecision", memberId, choice });
        if (!result.ok) {
          this.game.toast(result.reason ?? "Choix impossible.");
          return;
        }
        this.closeModal();
        this.renderLineage();
      }),
    );
  }

  /** Chronique de la lignée : la partie se met en pause pendant la lecture. */
  openChronicle(): void {
    const session = this.game.session;
    const sim = session.sim;
    const body = `<div class="chronicle-box">${chronicleHtml(sim)}</div><div class="modal-actions"><button type="button" class="btn btn-primary" data-act="close">Fermer</button></div>`;
    // La fenêtre précédente (succession) se ferme d'abord et rend la main à la vitesse d'avant.
    this.openModal(`Chronique de la ${sim.state.dynasty.name}`, body);
    const wasPaused = session.paused;
    session.paused = true;
    this.modalOnClose = () => {
      if (this.game.session === session) session.paused = wasPaused;
    };
  }

  /** Mort du seigneur : la partie se met en pause sur la fenêtre de succession. */
  showSuccession(deadId: number, heirId: number, onClose: () => void): void {
    const view = successionHtml(this.game.session.sim, deadId, heirId);
    const body = this.openModal(view.title, view.body, onClose);
    body.querySelector('[data-act="chronicle"]')?.addEventListener("click", () => this.openChronicle());
  }

  private renderAlerts(): void {
    const alerts = computeAlerts(this.game.session.sim, this.game.session.world);
    const html = alerts.map((a) => `<li class="alert alert-${a.tone}">${escapeHtml(a.text)}</li>`).join("");
    if (this.el.alerts!.innerHTML !== html) this.el.alerts!.innerHTML = html;
  }

  /** Bilan d'automne : la partie se met en pause (désactivable) le temps de lire l'année. */
  showBilan(year: number, stats: YearStats, onClose: () => void): void {
    const sim = this.game.session.sim;
    const c = sim.population.counts();
    const prod = formatGoods(stats.produced, "rien");
    const deaths = stats.deaths ?? 0;
    const causes = [
      stats.deathsHunger ? `${stats.deathsHunger} de faim` : "",
      stats.deathsCold ? `${stats.deathsCold} de froid` : "",
      stats.deathsDisease ? `${stats.deathsDisease} de maladie` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const days = foodDays(sim);
    const body = this.openModal(
      `Bilan de l'an ${year}`,
      `<dl class="facts bilan">
        <div><dt>Moisson</dt><dd>${stats.harvested} nourriture (${stats.fieldsHarvested} champs)</dd></div>
        <div><dt>Ateliers</dt><dd>${prod}</dd></div>
        <div><dt>Naissances</dt><dd>${stats.births ?? 0}</dd></div>
        <div><dt>Décès</dt><dd>${deaths}${causes ? ` <span class="bad">(${causes})</span>` : ""}</dd></div>
        <div><dt>Mariages</dt><dd>${stats.marriages ?? 0}</dd></div>
        <div><dt>Nouveaux venus</dt><dd>${stats.immigrants ?? 0} famille${(stats.immigrants ?? 0) > 1 ? "s" : ""}</dd></div>
        <div><dt>Impôts</dt><dd>${stats.taxes ?? 0} or</dd></div>
        <div><dt>Village</dt><dd>${c.total} habitants, ${c.families} foyers, moral ${sim.population.morale()}</dd></div>
        <div><dt>Lignée</dt><dd>${lineageSummary(sim)}</dd></div>
        ${affairsRow(sim)}
        <div><dt>Vivres</dt><dd>${days === Infinity ? "—" : `${days} jours d'avance`} pour l'hiver qui vient</dd></div>
      </dl>
      <label class="check"><input id="bilan-pause" type="checkbox" ${pauseAtBilan() ? "checked" : ""} /> Mettre en pause à chaque bilan d'automne</label>
      <div class="modal-actions"><button type="button" class="btn" data-act="bilan-fair">Foire d'automne${fairPotential(sim) >= 20 ? ` · surplus à vendre : ${fairPotential(sim)} or` : ""}</button><button type="button" class="btn btn-primary" data-act="bilan-ok">Continuer</button></div>`,
      onClose,
    );
    body.querySelector<HTMLInputElement>("#bilan-pause")?.addEventListener("change", (e) => setPauseAtBilan((e.target as HTMLInputElement).checked));
    body.querySelector('[data-act="bilan-ok"]')?.addEventListener("click", () => this.closeModal());
    // La foire remplace la fenêtre du bilan ; la partie reste en pause jusqu'à sa fermeture.
    body.querySelector('[data-act="bilan-fair"]')?.addEventListener("click", () => {
      const resume = this.modalOnClose;
      this.modalOnClose = null;
      this.openFair();
      const fairClose = this.modalOnClose as (() => void) | null;
      this.modalOnClose = () => {
        fairClose?.();
        resume?.();
      };
    });
  }

  showGameOver(onNewGame: () => void): void {
    const sim = this.game.session.sim;
    const year = sim.date.year;
    const manual = slotInfo("manuelle");
    const extinct = sim.state.gameOver?.reason === "extinction";
    const text = extinct
      ? `<p>En l'an ${year}, la ${escapeHtml(sim.state.dynasty.name)} s'éteint : plus personne ne peut hériter selon la loi.</p>`
      : `<p>En l'an ${year}, il ne reste que ${sim.state.villagers.length} habitant${sim.state.villagers.length > 1 ? "s" : ""} : votre lignée n'a plus personne à gouverner.</p>`;
    const body = this.openModal(
      extinct ? "La lignée s'est éteinte" : "Le domaine s'est vidé",
      `${text}
       <p>Prestige final : <strong>${sim.dynasty.prestige().total}</strong>.</p>
       <div class="chronicle-box">${chronicleHtml(sim)}</div>
       <div class="modal-actions">
         ${manual ? `<button type="button" class="btn" data-act="go-load">Charger la sauvegarde de l'an ${manual.year}</button>` : ""}
         <button type="button" class="btn btn-primary" data-act="go-new">Nouvelle partie</button>
       </div>`,
    );
    body.querySelector('[data-act="go-new"]')?.addEventListener("click", () => {
      this.closeModal();
      onNewGame();
    });
    body.querySelector('[data-act="go-load"]')?.addEventListener("click", () => {
      const save = readSlot("manuelle");
      this.closeModal();
      if (save) this.actions.load(save);
    });
  }

  private renderLogistics(): void {
    const sim = this.game.session.sim;
    const eco = sim.economy;
    const usage = eco.storageUsage();
    const waiting = eco.waiting();
    const trips = sim.state.deliveries.length;
    const stats = sim.state.yearStats;
    const hasFarm = sim.state.buildings.some((b) => BUILDINGS[b.type]?.agriculture);
    const facts = [
      `<div><dt>Réserves</dt><dd>${usage.used} / ${usage.capacity}${usage.incoming > 0 ? ` <span class="muted">· +${usage.incoming} en route</span>` : ""}</dd></div>`,
      `<div><dt>En attente</dt><dd>${formatGoods(waiting, "rien dans les ateliers")}</dd></div>`,
      `<div><dt>Porteurs</dt><dd>${trips} en route</dd></div>`,
      `<div><dt>Bilan</dt><dd>${stats.year > 1 ? "depuis l'hiver" : "depuis le début"} : ${formatGoods({ ...stats.produced, nourriture: stats.harvested }, "rien")}</dd></div>`,
    ];
    if (hasFarm) facts.push(`<div><dt>Récolte</dt><dd>${eco.expectedHarvest()} nourriture encore attendue</dd></div>`);
    const html = `<dl class="facts">${facts.join("")}</dl>`;
    if (this.el.logistics!.innerHTML !== html) this.el.logistics!.innerHTML = html;
  }

  private demolish(b: Building): void {
    const r = this.game.command({ type: "demolish", x: b.x, y: b.y });
    if (r.ok) this.game.select(null);
  }

  private renderDomain(): void {
    const world = this.game.session.world;
    const sim = this.game.session.sim;
    const start = world.dims.startFief;
    const me = sim.state.ownerId;
    const home = world.fiefs.find((f) => f.ownerId === me && (!start || (f.col === start.col && f.row === start.row))) ?? world.fiefs.find((f) => f.ownerId === me);
    const realm = home ? realmName(sim, home.name) : "Votre lignée";
    if (this.el.realmName!.textContent !== realm) this.el.realmName!.textContent = realm;
    const room = this.game.session.room;
    this.el.realmSub!.textContent = room ? `Salle ${this.actions.multi.code ?? ""} · ${room.players.length} joueurs` : `Graine « ${world.seedText} »`;
    const put = (box: HTMLElement, html: string) => {
      if (box.dataset.html !== html) {
        box.dataset.html = html;
        box.innerHTML = html;
      }
    };
    put(this.el.fiefList!, myFiefsHtml(world, sim));
    put(this.el.neighbors!, neighborsHtml(world, sim));
    // Pastille du bouton Voisins : ce qui attend une décision (propositions, guerres).
    const waiting =
      sim.state.trade.proposals.length +
      sim.state.army.wars.filter((w) => w.defenderId === sim.state.ownerId).length +
      sim.state.deals.incoming.filter((o) => !sim.state.deals.answers.some((a) => a.offerId === o.offerId)).length;
    const badge = this.el.voisinsBadge!;
    badge.hidden = waiting === 0;
    badge.textContent = String(waiting);
  }

  /** Ouvre le panneau demandé, ou le ferme s'il est déjà affiché. */
  togglePanel(mode: "domaine" | "voisins"): void {
    const closed = this.root.classList.contains("panel-closed");
    if (!closed && this.root.dataset.panel === mode) {
      this.root.classList.add("panel-closed");
    } else {
      this.root.dataset.panel = mode;
      this.root.classList.remove("panel-closed");
      this.el.panel!.scrollTop = 0;
    }
    this.syncPanelButtons();
  }

  private syncPanelButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-panel-toggle]").forEach((b) =>
      b.classList.toggle("is-active", !this.root.classList.contains("panel-closed") && b.dataset.panelToggle === this.root.dataset.panel),
    );
  }

  /** Le monde a changé (fief acheté, bilan) : étiquettes et panneaux à refaire. */
  refreshWorld(): void {
    this.buildFiefLabels();
    this.renderDomain();
    this.renderTrade(true);
    this.renderWar(true);
    this.renderMulti(true);
  }

  private renderWar(force = false): void {
    const box = this.el.war!;
    // On ne redessine pas sous le doigt du joueur qui tape un nombre de mercenaires.
    if (!force && box.contains(document.activeElement)) return;
    const html = warPanelHtml(this.game.session.world, this.game.session.sim);
    if (box.dataset.html !== html) {
      box.dataset.html = html;
      box.innerHTML = html;
    }
  }

  /** Fenêtre « Déclarer la guerre » à un fief voisin. */
  openDeclare(fiefId: string): void {
    const session = this.game.session;
    const view = declareHtml(session.world, session.sim, fiefId);
    if (!view) return;
    const body = this.openModal(view.title, view.body);
    body.querySelector('[data-act="close"]')?.addEventListener("click", () => this.closeModal());
    body.querySelectorAll<HTMLButtonElement>("[data-goal]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const result = this.game.command({ type: "declareWar", fiefId, goal: btn.dataset.goal as "conquete" | "pillage" });
        if (!result.ok) {
          const err = body.querySelector<HTMLElement>('[data-el="warError"]')!;
          err.hidden = false;
          err.textContent = result.reason ?? "Guerre impossible.";
          return;
        }
        this.closeModal();
        this.game.toast("Déclaration de guerre prête : elle partira au bilan d'automne.");
        this.renderWar(true);
      }),
    );
  }

  private renderTrade(force = false): void {
    const box = this.el.trade!;
    // Pendant une confirmation de rupture, on ne redessine pas sous le doigt du joueur.
    if (!force && box.querySelector('[data-confirm="1"]')) return;
    const html = tradePanelHtml(this.game.session.world, this.game.session.sim);
    if (box.dataset.html !== html) {
      box.dataset.html = html;
      box.innerHTML = html;
    }
  }

  /** Fenêtre « Proposer un accord » à un seigneur IA. */
  openPropose(lordId?: string): void {
    const session = this.game.session;
    const world = session.world;
    const me = session.sim.state.ownerId;
    const body = this.openModal("Proposer un accord", proposeHtml(world, session.sim, lordId));
    const q = <T extends HTMLElement>(name: string) => body.querySelector<T>(`[data-el="${name}"]`)!;
    const lord = q<HTMLSelectElement>("tpLord");
    const side = q<HTMLSelectElement>("tpSide");
    const good = q<HTMLSelectElement>("tpGood");
    const price = q<HTMLInputElement>("tpPrice");
    const error = q<HTMLElement>("tpError");
    const refreshPrice = () => {
      price.value = String(suggestedPrice(world, me, lord.value, good.value as TradeGood, side.value as "vente" | "achat"));
    };
    lord.addEventListener("change", () => {
      q<HTMLElement>("tpMarket").innerHTML = partnerMarketHtml(world, me, lord.value);
      refreshPrice();
    });
    side.addEventListener("change", refreshPrice);
    good.addEventListener("change", refreshPrice);
    refreshPrice();
    body.querySelector('[data-act="close"]')?.addEventListener("click", () => this.closeModal());
    body.querySelector('[data-act="tpSend"]')?.addEventListener("click", () => {
      const result = this.game.command({
        type: "proposeTrade",
        partnerId: lord.value,
        good: good.value as TradeGood,
        side: side.value as "vente" | "achat",
        perYear: Math.floor(Number(q<HTMLInputElement>("tpQty").value)),
        price: Math.floor(Number(price.value)),
        years: Math.floor(Number(q<HTMLInputElement>("tpYears").value)),
      });
      if (!result.ok) {
        error.hidden = false;
        error.textContent = result.reason ?? "Proposition impossible.";
        return;
      }
      this.closeModal();
      this.game.toast("Proposition envoyée : réponse au bilan d'automne.");
      this.renderTrade(true);
    });
  }

  /** Foire d'automne : la partie se met en pause le temps des échanges. */
  openFair(): void {
    const session = this.game.session;
    const wasPaused = session.paused;
    session.paused = true;
    const render = () => {
      const body = this.el.modalBody!;
      body.innerHTML = fairHtml(session.sim);
      body.querySelector('[data-act="close"]')?.addEventListener("click", () => this.closeModal());
      body.querySelectorAll<HTMLButtonElement>("[data-trade]").forEach((btn) =>
        btn.addEventListener("click", () => {
          const result = this.game.command({
            type: "trade",
            good: btn.dataset.trade as GoodId,
            qty: Number(btn.dataset.qty),
            side: btn.dataset.side as "achat" | "vente",
          });
          if (!result.ok) this.game.toast(result.reason ?? "Échange impossible.");
          render();
        }),
      );
    };
    this.openModal("Foire d'automne", "", () => {
      if (this.game.session === session) session.paused = wasPaused;
    });
    render();
  }

  /** Fenêtre d'offre d'achat d'un fief voisin. */
  openOffer(fiefId: string): void {
    const session = this.game.session;
    const view = offerHtml(session.world, session.sim, fiefId);
    if (!view) return;
    const body = this.openModal(view.title, view.body);
    const input = body.querySelector<HTMLInputElement>('[data-el="offerPrice"]')!;
    const error = body.querySelector<HTMLElement>('[data-el="offerError"]')!;
    input.focus();
    input.select();
    const submit = () => {
      const result = this.game.command({ type: "makeOffer", fiefId, price: Math.floor(Number(input.value)) });
      if (!result.ok) {
        error.hidden = false;
        error.textContent = result.reason ?? "Offre impossible.";
        return;
      }
      this.closeModal();
      this.game.toast("Offre faite : réponse au bilan d'automne.");
      this.renderDomain();
    };
    body.querySelector('[data-act="offer"]')?.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit();
    });
  }

  private buildFiefLabels(): void {
    const layer = this.el.fiefLabels!;
    layer.innerHTML = "";
    this.fiefLabels.clear();
    const world = this.game.session.world;
    const neighbors = new Set(neighborFiefs(world, this.game.session.sim).map((n) => n.meta.id));
    for (const f of world.fiefs) {
      const lord = lordById(world, f.ownerId);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "fief-label";
      label.style.setProperty("--lord", lordColor(lord?.colorIndex));
      const forSale = neighbors.has(f.id);
      label.classList.toggle("for-sale", forSale);
      label.innerHTML = `<span class="fl-name">${escapeHtml(f.name)}</span>${forSale ? '<span class="fl-sale">à vendre</span>' : ""}
        <span class="fl-owner">${escapeHtml(f.ownerId === this.game.session.sim.state.ownerId ? "Votre lignée" : lordLabel(world, f.ownerId))}</span>
        ${lord?.ai ? `<span class="fl-terrain">${lordTag(lord, this.game.session.sim.state.ownerId)}</span>` : ""}
        ${lord?.ai?.plan ? `<span class="fl-sale">convoite ${escapeHtml(world.fiefs.find((x) => x.id === lord.ai!.plan!.fiefId)?.name ?? "")}</span>` : ""}
        ${world.wars.some((w) => w.fiefId === f.id) ? `<span class="fl-sale fl-war">assiégé</span>` : ""}
        <span class="fl-terrain">${escapeHtml(DOMINANTS[f.dominant].nom)}</span>`;
      label.addEventListener("click", () => this.actions.focusFief(f.id));
      layer.appendChild(label);
      this.fiefLabels.set(f.id, label);
    }
  }

  // ------------------------------------------------------------ sauvegardes

  private renderSaves(): void {
    const box = this.el.saves!;
    const manual = slotInfo("manuelle");
    const auto = slotInfo("auto");
    const slotLine = (label: string, info: ReturnType<typeof slotInfo>, slot: SlotId) =>
      info
        ? `<button type="button" class="btn" data-load="${slot}">Charger ${label}</button>
           <span class="muted small">An ${info.year} · « ${escapeHtml(info.seedText)} » · ${formatRealDate(info.savedAt)}</span>`
        : `<span class="muted small">Aucune sauvegarde ${label}.</span>`;
    box.innerHTML = `
      <div class="save-row">
        <button type="button" class="btn btn-primary" data-act="save">Sauvegarder</button>
        <button type="button" class="btn" data-act="export">Exporter</button>
        <button type="button" class="btn" data-act="import">Importer</button>
      </div>
      <div class="save-slot">${slotLine("manuelle", manual, "manuelle")}</div>
      <div class="save-slot">${slotLine("automatique", auto, "auto")}</div>
      <p class="muted small">Sauvegarde automatique toutes les 30 s et à chaque bilan d'automne ; la dernière partie reprend à l'ouverture du jeu.</p>
      <form class="new-game" data-el="newGameForm">
        <label for="seed-input">Nouvelle partie, graine</label>
        <div class="new-game-row">
          <input id="seed-input" name="seed" type="text" autocomplete="off" spellcheck="false" />
          <button type="submit" class="btn">${this.confirmNewGame ? "Confirmer" : "Lancer"}</button>
        </div>
        ${this.confirmNewGame ? `<p class="warn small">La sauvegarde automatique de la partie en cours sera remplacée. Sauvegardez-la d'abord pour la garder, puis cliquez sur Confirmer.</p>` : ""}
      </form>
      <div class="multi-box">${this.actions.multi.room && this.actions.multi.code ? multiStatusHtml(this.actions.multi.code, this.actions.multi.isHost) : multiMenuHtml(hostRoomCodes(), Boolean(window.claude), SITE_URL)}</div>`;
    box.querySelectorAll<HTMLButtonElement>("[data-mp]").forEach((b) =>
      b.addEventListener("click", () => {
        const what = b.dataset.mp;
        if (what === "create") this.openCreateRoom();
        else if (what === "join") this.openJoinRoom();
        else if (what === "resume") void this.runMulti(() => this.actions.multi.resume(b.dataset.code!));
        else if (what === "leave") this.leaveRoom();
      }),
    );
    const input = box.querySelector<HTMLInputElement>("#seed-input")!;
    input.value = randomSeed();
    box.querySelector('[data-act="save"]')?.addEventListener("click", () => {
      const ok = writeSlot("manuelle", this.game.session.toSave());
      this.game.toast(ok ? "Partie sauvegardée dans ce navigateur." : "Sauvegarde impossible ici : utilisez Exporter.", ok ? "info" : "error");
      this.renderSaves();
    });
    box.querySelector('[data-act="export"]')?.addEventListener("click", () => this.openExport());
    box.querySelector('[data-act="import"]')?.addEventListener("click", () => this.openImport());
    box.querySelectorAll<HTMLButtonElement>("[data-load]").forEach((b) =>
      b.addEventListener("click", () => {
        const save = readSlot(b.dataset.load as SlotId);
        if (save) this.actions.load(save);
        else this.game.toast("Cette sauvegarde est illisible.", "error");
      }),
    );
    box.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const seed = input.value.trim() || randomSeed();
      if (!this.confirmNewGame) {
        this.confirmNewGame = true;
        this.renderSaves();
        const again = this.el.saves!.querySelector<HTMLInputElement>("#seed-input");
        if (again) again.value = seed;
        return;
      }
      this.confirmNewGame = false;
      this.actions.newGame(seed);
    });
  }

  // ------------------------------------------------------------ partie à plusieurs (J7)

  private lastChat = -1;

  /** Section Joueurs (panneau Voisins) : présents, offres reçues, messages. */
  renderMulti(force = false): void {
    const session = this.game.session;
    const room = session.room;
    this.el.playersSection!.hidden = !room;
    if (!room) return;
    const put = (box: HTMLElement, html: string) => {
      if (force || box.dataset.html !== html) {
        box.dataset.html = html;
        box.innerHTML = html;
      }
    };
    put(this.el.players!, playersHtml(session.world, room.players, session.sim.state.ownerId));
    put(this.el.incoming!, incomingOffersHtml(session.world, session.sim));
    const chat = this.actions.multi.chat;
    if (force || chat.length !== this.lastChat) {
      this.lastChat = chat.length;
      this.el.chatLog!.innerHTML = chatLogHtml(chat, room.players);
      this.el.chatLog!.scrollTop = this.el.chatLog!.scrollHeight;
    }
  }

  /** Bandeau « En attente de … » au bilan. */
  setWaiting(text: string | null): void {
    const el = this.el.waitBanner!;
    el.hidden = text === null;
    if (text !== null) el.textContent = text;
  }

  private storedPseudo(): string {
    try {
      return localStorage.getItem("seigneurie.pseudo") ?? "";
    } catch {
      return "";
    }
  }

  private storePseudo(p: string): void {
    try {
      localStorage.setItem("seigneurie.pseudo", p);
    } catch {
      // Stockage indisponible.
    }
  }

  /** Lance une action réseau ; une erreur s'affiche dans la fenêtre ouverte, sinon en bandeau. */
  private async runMulti(fn: () => Promise<void>, error?: HTMLElement, button?: HTMLButtonElement): Promise<boolean> {
    if (button) button.disabled = true;
    try {
      await fn();
      this.renderSaves();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (error) {
        error.hidden = false;
        error.textContent = msg;
      } else this.game.toast(msg, "error");
      this.actions.multi.leave();
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  private openCreateRoom(): void {
    const body = this.openModal("Créer une salle", createFormHtml(this.storedPseudo()));
    const form = body.querySelector<HTMLFormElement>("form")!;
    const error = body.querySelector<HTMLElement>('[data-el="mpError"]')!;
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const data = new FormData(form);
      const pseudo = String(data.get("pseudo") ?? "").trim().slice(0, 20);
      if (!pseudo) return;
      this.storePseudo(pseudo);
      const years = Number(data.get("years"));
      const speed = Number(data.get("speed")) as Speed;
      const seed = randomSeed();
      error.hidden = true;
      error.textContent = "";
      const btn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      btn.textContent = "Ouverture…";
      void this.runMulti(() => this.actions.multi.create(pseudo, { seed, years, speed }), error, btn).then(() => (btn.textContent = "Créer"));
    });
  }

  private openJoinRoom(): void {
    const body = this.openModal("Rejoindre une salle", joinFormHtml(this.storedPseudo(), ""));
    const form = body.querySelector<HTMLFormElement>("form")!;
    const error = body.querySelector<HTMLElement>('[data-el="mpError"]')!;
    form.querySelector<HTMLInputElement>('[name="code"]')?.focus();
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const data = new FormData(form);
      const pseudo = String(data.get("pseudo") ?? "").trim().slice(0, 20);
      const code = String(data.get("code") ?? "").trim().toUpperCase();
      if (!pseudo || !code) return;
      this.storePseudo(pseudo);
      error.hidden = true;
      const btn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      btn.textContent = "Connexion…";
      void this.runMulti(() => this.actions.multi.join(code, pseudo), error, btn).then(() => (btn.textContent = "Rejoindre"));
    });
  }

  /** Salon : la liste se met à jour à chaque arrivée. */
  showLobby(players: RoomPlayer[], settings: RoomSettings, code: string, isHost: boolean, resumed: boolean): void {
    const body = this.openModal(`Salle ${code}`, lobbyHtml(players, settings, code, isHost, resumed));
    body.querySelector('[data-act="copyCode"]')?.addEventListener("click", () => {
      navigator.clipboard?.writeText(code).then(
        () => this.game.toast("Code copié."),
        () => this.game.toast(`Code : ${code}`),
      );
    });
    body.querySelector('[data-act="mpLaunch"]')?.addEventListener("click", () => {
      this.closeModal();
      this.actions.multi.launch();
    });
    body.querySelector('[data-act="mpLeave"]')?.addEventListener("click", () => {
      this.closeModal();
      this.leaveRoom();
    });
  }

  /** Le salon est-il la fenêtre ouverte ? (pour le rafraîchir sans en ouvrir un autre) */
  lobbyOpen(): boolean {
    return !this.el.modal!.hidden && (this.el.modalTitle!.textContent ?? "").startsWith("Salle ");
  }

  closeLobby(): void {
    if (this.lobbyOpen()) this.closeModal();
  }

  showRanking(ranking: RankingRow[], me: string | null): void {
    this.openModal("Fin de la partie", rankingHtml(ranking, me));
  }

  private leaveRoom(): void {
    const wasPlaying = this.game.session.room !== null;
    this.actions.multi.leave();
    this.renderSaves();
    if (wasPlaying) this.actions.backToSolo();
  }

  refreshSaves(): void {
    this.renderSaves();
  }

  /** Ouvre la fenêtre ; onClose est appelé à sa fermeture (bouton, Échap, clic à côté, ou autre fenêtre). */
  private openModal(title: string, body: string, onClose: (() => void) | null = null): HTMLElement {
    const previous = this.modalOnClose;
    this.modalOnClose = null;
    previous?.();
    this.modalOnClose = onClose;
    this.el.modalTitle!.textContent = title;
    this.el.modalBody!.innerHTML = body;
    this.el.modal!.hidden = false;
    this.el.modalBody!.querySelector('[data-act="close"]')?.addEventListener("click", () => this.closeModal());
    return this.el.modalBody!;
  }

  private closeModal(): void {
    this.el.modal!.hidden = true;
    const cb = this.modalOnClose;
    this.modalOnClose = null;
    cb?.();
  }

  private openExport(): void {
    const text = serializeSave(this.game.session.toSave());
    const body = this.openModal(
      "Exporter la partie",
      `<p>Copiez ce texte et gardez-le dans un fichier : il contient toute la partie.</p>
       <textarea id="export-text" readonly rows="8">${escapeHtml(text)}</textarea>
       <div class="modal-actions">
         <button type="button" class="btn btn-primary" data-act="copy">Copier</button>
         <button type="button" class="btn" data-act="close">Fermer</button>
       </div>`,
    );
    const area = body.querySelector<HTMLTextAreaElement>("#export-text")!;
    body.querySelector('[data-act="copy"]')?.addEventListener("click", () => {
      navigator.clipboard
        .writeText(text)
        .then(() => this.game.toast("Sauvegarde copiée."))
        .catch(() => {
          area.focus();
          area.select();
          this.game.toast("Texte sélectionné : copiez-le avec Ctrl+C.");
        });
    });
  }

  private openImport(): void {
    const body = this.openModal(
      "Importer une partie",
      `<p>Collez le texte d'une sauvegarde exportée, ou choisissez le fichier.</p>
       <textarea id="import-text" rows="8" placeholder="Collez la sauvegarde ici"></textarea>
       <input id="import-file" type="file" accept=".json,.txt,application/json,text/plain" />
       <p class="warn small" data-el="importError" hidden></p>
       <div class="modal-actions">
         <button type="button" class="btn btn-primary" data-act="do-import">Charger cette partie</button>
         <button type="button" class="btn" data-act="close">Annuler</button>
       </div>`,
    );
    const area = body.querySelector<HTMLTextAreaElement>("#import-text")!;
    const error = body.querySelector<HTMLElement>('[data-el="importError"]')!;
    body.querySelector<HTMLInputElement>("#import-file")?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        area.value = String(reader.result ?? "");
      };
      reader.readAsText(file);
    });
    body.querySelector('[data-act="do-import"]')?.addEventListener("click", () => {
      try {
        const save = parseSave(area.value.trim());
        this.closeModal();
        this.actions.load(save);
      } catch (err) {
        error.hidden = false;
        error.textContent = err instanceof SaveError ? err.message : "Sauvegarde illisible.";
      }
    });
  }

  // ------------------------------------------------------------ à chaque image

  update(): void {
    const session = this.game.session;
    const sim = session.sim;
    const state = sim.state;

    const totals = sim.totals();
    for (const id of RESOURCE_IDS) {
      const node = this.root.querySelector<HTMLElement>(`[data-res="${id}"]`);
      const value = String(Math.floor(totals[id]));
      if (node && node.textContent !== value) node.textContent = value;
    }
    const counts = sim.population.counts();
    const popText = String(counts.total);
    if (this.el.popValue!.textContent !== popText) this.el.popValue!.textContent = popText;
    const morale = sim.population.morale();
    const moraleText = String(morale);
    if (this.el.moraleValue!.textContent !== moraleText) this.el.moraleValue!.textContent = moraleText;
    const prestigeText = String(sim.dynasty.prestige().total);
    if (this.el.prestigeValue!.textContent !== prestigeText) this.el.prestigeValue!.textContent = prestigeText;
    this.el.moraleValue!.parentElement?.classList.toggle("is-low", morale < 40);
    const usage = sim.economy.storageUsage();
    const stockText = `${usage.used}/${usage.capacity}`;
    if (this.el.stockValue!.textContent !== stockText) this.el.stockValue!.textContent = stockText;
    this.el.stockValue!.parentElement?.classList.toggle("is-full", usage.capacity > 0 && usage.used >= usage.capacity * 0.9);

    const now = performance.now();
    if (now - this.lastLive >= 250) {
      this.lastLive = now;
      this.renderToolCard();
      this.renderVillage();
      this.renderLineage();
      this.renderDomain();
      this.renderTrade();
      this.renderWar();
      this.renderMulti();
      this.renderAlerts();
      this.renderLogistics();
      this.renderSelectionLive();
      this.renderJournal();
    }

    const date = sim.date;
    const dateText = `${date.seasonName}, an ${date.year} · jour ${date.day}`;
    if (this.el.date!.textContent !== dateText) this.el.date!.textContent = dateText;
    this.el.seasonFill!.style.width = `${(date.seasonProgress * 100).toFixed(1)}%`;
    if (date.seasonIndex !== this.lastSeason) {
      this.lastSeason = date.seasonIndex;
      this.root.dataset.season = seasonClass(date.seasonIndex);
    }
    const activeSpeed = session.paused ? 0 : session.speed;
    this.root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => {
      const on = Number(b.dataset.speed) === activeSpeed;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    this.root.classList.toggle("is-paused", session.paused);

    const lastEntry = state.log[state.log.length - 1];
    if (state.log.length !== this.lastLogLength || (lastEntry?.tick ?? -1) !== this.lastLogTick) {
      this.lastLogLength = state.log.length;
      this.lastLogTick = lastEntry?.tick ?? -1;
      this.el.log!.innerHTML = [...state.log]
        .reverse()
        .slice(0, 14)
        .map((l) => {
          const d = dateOf(l.tick);
          return `<li><span class="log-date">${d.seasonName} ${d.year}</span><span>${escapeHtml(l.text)}</span></li>`;
        })
        .join("");
    }

    this.updateHoverCard();
    this.updateFiefLabels();
  }

  private updateHoverCard(): void {
    const card = this.el.hoverCard!;
    const hover = this.game.hover;
    const session = this.game.session;
    const sim = session.sim;
    if (!hover || this.game.viewLevel === "monde") {
      card.hidden = true;
      return;
    }
    const world = session.world;
    const S = world.dims.fiefSize;
    const meta: FiefMeta | undefined = world.fiefs.find(
      (f) => f.col === Math.floor(hover.x / S) && f.row === Math.floor(hover.y / S),
    );
    if (!meta) {
      card.hidden = true;
      return;
    }
    const lord = lordById(world, meta.ownerId);
    const lines: string[] = [`<div class="hc-title">${escapeHtml(meta.name)} <span class="muted">· ${escapeHtml(lord?.name ?? "Sans seigneur")}</span></div>`];
    const terrain = sim.terrainAt(hover.x, hover.y);
    if (terrain !== undefined) {
      const fert = sim.fertilityAt(hover.x, hover.y) ?? 0;
      const occ = sim.occupantAt(hover.x, hover.y);
      let what = TERRAIN_NAMES[terrain];
      if (terrain === 0) what += ` · fertilité ${fert} %`;
      if (occ?.kind === "road") what = `${sim.terrainAt(hover.x, hover.y) === Terrain.Eau ? "Pont" : "Route"}${sim.connectedRoads().has(sim.key(hover.x, hover.y)) ? " reliée" : " non reliée"}`;
      if (occ?.kind === "field") what = `Champ · fertilité ${fert} % · ${fieldState(this.game, hover.x, hover.y)}`;
      if (occ?.kind === "building") {
        const b = sim.building(occ.id);
        what = BUILDINGS[b?.type ?? ""]?.nom ?? what;
        const status = b ? sim.economy.status(b.id) : null;
        if (status?.text) what += ` · <span class="${status.tone === "ok" ? "ok" : status.tone === "info" ? "" : "bad"}">${escapeHtml(status.text)}</span>`;
      }
      lines.push(`<div>${what}</div>`);
    } else {
      lines.push(`<div class="muted">Hors de votre domaine</div>`);
    }

    const tool = this.game.tool;
    if (tool.kind !== "inspect") {
      let check;
      let label = "";
      if (tool.kind === "build") {
        const a = this.game.buildAnchor(tool.building, hover.x, hover.y);
        check = sim.check({ type: "build", building: tool.building, x: a.x, y: a.y });
        label = BUILDINGS[tool.building]?.nom ?? "";
      } else if (tool.kind === "road") {
        check = sim.check({ type: "road", x: hover.x, y: hover.y });
        label = "Route";
      } else if (tool.kind === "field") {
        check = sim.check({ type: "field", x: hover.x, y: hover.y });
        label = "Champ";
      } else {
        check = sim.check({ type: "demolish", x: hover.x, y: hover.y });
        label = "Démolir";
      }
      let detail = check.ok
        ? tool.kind === "demolish"
          ? `rend ${formatCost(check.refund)}`
          : formatCost(check.cost)
        : (check.reason ?? "Impossible ici.");
      let tone = check.ok ? "ok" : "bad";
      if (check.ok && tool.kind === "field" && !sim.economy.fieldWouldBeWorked(hover.x, hover.y)) {
        detail = "restera en friche : les fermes à portée travaillent déjà 12 champs.";
        tone = "warn";
      }
      lines.push(`<div class="hc-tool ${tone}"><strong>${label}</strong> · ${escapeHtml(detail)}</div>`);
    }
    card.innerHTML = lines.join("");
    card.hidden = false;
  }

  private updateFiefLabels(): void {
    const level = this.game.viewLevel;
    const world = this.game.session.world;
    const S = world.dims.fiefSize * TILE;
    const topLimit = level === "moyenne" ? this.insets().top + 70 : 0;
    for (const f of world.fiefs) {
      const label = this.fiefLabels.get(f.id);
      if (!label) continue;
      if (level === "proche") {
        if (!label.hidden) label.hidden = true;
        continue;
      }
      label.hidden = false;
      const center = this.camera.worldToScreen((f.col + 0.5) * S, (f.row + 0.5) * S);
      // Les étiquettes tiennent dans leur fief : en vue Monde sur une grande carte, seul le nom reste.
      const width = Math.round(this.camera.worldToScreen((f.col + 1) * S, 0).x - this.camera.worldToScreen(f.col * S, 0).x);
      const compact = width < 230;
      if (label.classList.contains("compact") !== compact) label.classList.toggle("compact", compact);
      const max = `${Math.max(60, width - 10)}px`;
      if (label.style.maxWidth !== max) label.style.maxWidth = max;
      let y = center.y;
      if (level === "moyenne") {
        // Vue des fiefs : l'étiquette se cale en haut de la partie visible du fief, sans masquer la ville.
        const top = this.camera.worldToScreen(0, f.row * S).y;
        const bottom = this.camera.worldToScreen(0, (f.row + 1) * S).y;
        y = Math.min(bottom - 40, Math.max(top + 40, topLimit));
      }
      label.style.transform = `translate(${Math.round(center.x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    }
  }
}

const SEED_WORDS = ["blé", "chêne", "orge", "seigle", "lin", "houblon", "tilleul", "aulne", "frêne", "saule", "noyer", "avoine"];
/** Adresse du jeu publié sur GitHub Pages, où se joue la partie à plusieurs. */
const SITE_URL = "https://mattgdl.github.io/gestion-game/";

function randomSeed(): string {
  const w = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)] ?? "blé";
  return `${w}-${Math.floor(Math.random() * 900 + 100)}`;
}

function formatGoods(goods: Goods, empty: string): string {
  const parts = GOOD_IDS.filter((g) => (goods[g] ?? 0) > 0).map((g) => `${goods[g]} ${GOOD_NAMES[g].toLowerCase()}`);
  return parts.length > 0 ? parts.join(" · ") : empty;
}

/** Durée en secondes de jeu à vitesse ×1 (10 ticks par seconde). */
function seconds(ticks: number): string {
  return `${Math.max(0, Math.ceil(ticks / 10))} s`;
}

function fieldState(game: Game, x: number, y: number): string {
  const sim = game.session.sim;
  const k = sim.key(x, y);
  const farmId = sim.economy.farmOfField(k);
  if (farmId === null) return "en friche (ferme déjà à 12 champs)";
  if (!sim.isConnected(farmId)) return "sa ferme n'est pas reliée";
  const crop = sim.state.crops[String(k)];
  const season = sim.date.seasonIndex;
  if (crop === "recolte") return "moissonné";
  if (crop === "seme") return season === 2 ? "à moissonner" : "semé";
  if (season === 0) return "en semailles";
  if (season === 3) return "au repos";
  return "non semé (semailles au printemps)";
}

const PAUSE_KEY = "seigneurie.pauseBilan";
export function pauseAtBilan(): boolean {
  try {
    return localStorage.getItem(PAUSE_KEY) !== "off";
  } catch {
    return true;
  }
}
function setPauseAtBilan(on: boolean): void {
  try {
    localStorage.setItem(PAUSE_KEY, on ? "on" : "off");
  } catch {
    /* préférence non mémorisée */
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}

function perYear(level: ImmigrationLevel): string {
  const n = DEMOGRAPHY.immigration.famillesParAn[level];
  return `${n} famille${n > 1 ? "s" : ""} par an au plus`;
}

/** Moment de la prochaine arrivée possible : début du printemps, de l'été ou de l'automne. */
function nextArrival(seasonIndex: number): string {
  if (seasonIndex === 0) return "au début de l'été";
  if (seasonIndex === 1) return "au début de l'automne";
  return "au printemps";
}

/** Fiche de la maison : qui viendra l'habiter, ou pourquoi elle restera vide. */
function newHouseLine(sim: DomainSim): string {
  const o = sim.population.housingOutlook();
  const free = o.freeHouses;
  if (o.homeless > free) return `<p>Une famille sans abri s'y installera dès le lendemain.</p>`;
  if (o.homeless + o.waitingCouples > free) return `<p>Un jeune couple s'y mariera au début de la prochaine saison.</p>`;
  const im = sim.population.immigrationCheck(o.spare + 1);
  if (im.ready && o.spare < im.perYear - im.arrived) {
    return `<p>Une famille de nouveaux venus pourrait s'y installer ${nextArrival(sim.date.seasonIndex)}.</p>`;
  }
  let why = im.reason ?? "";
  if (im.ready) why = `${o.spare} maison${o.spare > 1 ? "s" : ""} libre${o.spare > 1 ? "s" : ""} attend${o.spare > 1 ? "ent" : ""} déjà les nouveaux venus (${perYear(im.level)}).`;
  return `<p class="tc-warn">Personne ne l'attend : elle restera vide. ${escapeHtml(why)} ${escapeHtml(nextMarriageText(o.nextMarriageYears))}</p>`;
}

/** « Foulques, 42 ans · 3 héritiers · prestige 120 » (bilan d'automne). */
function lineageSummary(sim: DomainSim): string {
  const lord = sim.dynasty.lord;
  if (!lord) return "éteinte";
  const n = sim.dynasty.lineOfSuccession().length;
  return `${escapeHtml(lord.name)}, ${sim.dynasty.ageOf(lord)} ans · ${n === 0 ? '<span class="bad">aucun héritier</span>' : `${n} héritier${n > 1 ? "s" : ""}`} · prestige ${sim.dynasty.prestige().total}`;
}

/** Affaires entre seigneurs réglées à ce bilan (achats, refus, titre). */
function affairsRow(sim: DomainSim): string {
  const lines = sim.barrierEvents.map((ev) => {
    if (ev.type === "fiefAcquired") return `<span class="ok">${escapeHtml(ev.name)} est à vous (${ev.price} or).</span>`;
    if (ev.type === "offerRefused") return escapeHtml(ev.reason);
    if (ev.type === "title") return `<strong>Nouveau titre : ${escapeHtml(sim.titleName())}.</strong>`;
    if (ev.type === "tradeNews") return escapeHtml(ev.text);
    return "";
  });
  const text = lines.filter(Boolean).join("<br />");
  return text ? `<div><dt>Affaires</dt><dd>${text}</dd></div>` : "";
}
