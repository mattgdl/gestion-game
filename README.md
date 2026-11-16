# Seigneurie (nom de travail)

Jeu de gestion médiéval à dynastie, jouable dans le navigateur.
Les règles et décisions sont dans **DESIGN.md**, l'avancement dans **ROADMAP.md**.

## Prérequis

- [Node.js](https://nodejs.org) 20 ou plus récent (testé avec Node 22).

## Commandes

À lancer depuis le dossier du projet, dans un terminal :

| Commande | Ce qu'elle fait |
|---|---|
| `npm install` | Installe les dépendances (une seule fois, puis après chaque ajout de dépendance). |
| `npm run dev` | Lance le jeu en local avec rechargement automatique. Ouvrir l'adresse affichée (http://localhost:5173). |
| `npm test` | Lance les tests automatiques de la simulation. |
| `npm run typecheck` | Vérifie les types TypeScript de tout le projet. |
| `npm run build` | Construit le jeu en un seul fichier : `packages/client/dist/index.html`, qui s'ouvre directement dans un navigateur. |
| `npm run build:artifact` | Construit la version publiable sur claude.ai : `packages/client/dist/seigneurie.html`. |
| `npx tsx tools/lignee.ts 100 10` | Simule 100 ans de la seule famille du seigneur sur 10 graines et compte les extinctions selon la loi de succession et la façon de marier les enfants. |
| `npx tsx tools/simulate.ts 30 3 70` | Simule 30 ans d'un village type (3 fermes au départ, fertilité 70 %) et affiche un tableau (CSV) : population, naissances, décès, nouveaux venus, récoltes, vivres. Ajouter `simulation adaptatif fermee` (ou `ouverte`) pour changer l'accueil des nouveaux venus. |

## Commandes du jeu

| Action | Souris / clavier |
|---|---|
| Se déplacer | Glisser (outil Inspecter), clic droit glissé, ou ZQSD / WASD / flèches |
| Zoomer | Molette, ou + et − |
| Vue Monde / retour au manoir | M / O |
| Pause, vitesses | Espace, 1, 2, 3 |
| Outils | Échap (Inspecter), R (Route), C (Champ), X (Démolir) |
| Bâtiments | H Maison, F Ferme, B Bûcheron, P Carrière, E Entrepôt, N Marché, G Église, K Forge, U Bergerie, T Tisserand, J Guérisseur |
| Annuler l'outil | Clic droit |
| Zoomer sur un fief | Double-clic, ou clic en vue Monde |
| Itinéraires de tous les porteurs | L |

## Débogage

Dans la console du navigateur, `window.__jeu` donne accès à la partie (`__jeu.game.session`) et à la caméra.
Exemple pour avancer d'un an : `for (let i = 0; i < 1800; i++) __jeu.game.session.update(100)`.

## Journal de partie

Dans la page publiée sur claude.ai, le jeu enregistre l'état de la partie (toutes les 30 s) et un bilan à chaque fin d'automne dans la base de données de l'artefact (collection `parties`). Claude peut le lire pour analyser une partie. Le partage se coupe dans le panneau « Partie ». Ailleurs (fichier local, `npm run dev`), le journal reste inactif.

