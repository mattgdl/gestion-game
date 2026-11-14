# Consignes pour Claude

Jeu de gestion médiéval à dynastie, développé en « vibe coding » avec Matthieu (graphiste et communicant, pas développeur).

## Avant toute modification

1. Lire **DESIGN.md** (règles et décisions, avec leur raison) et **ROADMAP.md** (fait / en cours / à faire).
2. Travailler sur un seul jalon à la fois. Toute idée hors du jalon en cours va dans ROADMAP.md, pas dans le code.

## Règles d'architecture (DESIGN.md, section 7)

- `sim-fief`, `sim-monde` et `shared` sont en TypeScript pur : aucun import de Phaser.
- L'interface ne modifie jamais l'état directement : elle envoie des commandes à la simulation.
- Couches Fief et Monde : elles ne communiquent que par les messages de `shared/src/messages.ts`.
- Déterminisme : pas de `Math.random()` dans la simulation (générateur à graine `Rng`), pas de `Math.sin/log/exp/pow`, calculs en entiers quand c'est possible, ordre de parcours fixe.
- Tout chiffre d'équilibrage vit dans `packages/data/*.json`, pas dans le code.
- Changement du format d'état : incrémenter `SAVE_VERSION` et ajouter la migration dans `packages/client/src/save/save.ts`, avec un test.

## Avant de livrer

```
npm run typecheck
npm test
npm run build:artifact
```

Puis jouer la version construite dans un navigateur, mettre à jour DESIGN.md (section 4 pour les règles décidées en codant, journal en section 11) et ROADMAP.md.

## Communication

- En français, simplement, sans jargon inutile.
- Challenger les idées de design quand elles nuisent au fun, à la faisabilité ou au périmètre ; poser la question avant toute décision structurante.
- Résumer en quelques lignes ce qui a été fait et comment le tester.
