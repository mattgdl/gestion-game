# ROADMAP.md

> Mise à jour : 14/11/2026 · Référence des règles : DESIGN.md (v0.4)
> Chaque jalon se termine par un jeu qui se lance et se joue. Une idée qui sort du jalon en cours est notée ici, pas codée.

## En cours

- **Retours de jeu sur J2a**, puis démarrage de **J2b — Le village vit**.

## À faire

### J2b — Le village vit
- Villageois individuels : âge, foyer, métier, naissances, morts.
- Logement, emplois, trajet domicile-travail (les ateliers et fermes emploient de vrais villageois).
- Consommation de nourriture, chauffage en hiver (bois), marché qui distribue aux foyers.
- Impôts : première source d'or.
- Équilibrage avec l'outil `simulate`.
- Famine et défaite (moins de 5 habitants sur le domaine).
- Indicateurs (réserves pour l'hiver, récolte prévue) et alertes.
- Bilan d'automne (pause automatique en solo, désactivable).
- Outil `simulate` (N années sans affichage, export CSV).
- **Critère de fin :** une partie de 20 min tient debout ; on peut perdre par famine en la voyant venir.

### J3 — La lignée
- Famille seigneuriale, mariage simple, naissances, mortalité, majorité.
- Ordre de succession (règle à trancher, voir DESIGN 9), extinction, écran de succession.
- Chronique de la dynastie, premier calcul du prestige.
- **Critère de fin :** jouer deux successions, puis perdre par extinction en l'ayant vue venir.

### J4 — S'étendre
- Vue Monde complète.
- Achat d'un fief voisin : proposition, séquestre, résolution à la barrière.
- Extension de la zone constructible, titres.
- **Critère de fin :** acheter un fief, y construire, débloquer un titre.

### J5 — Prototype multi (2 joueurs)
- Cloudflare Worker + Durable Object (une salle par partie), RemoteWorld, WebSockets.
- Barrière annuelle en réseau, délai maximal pour un joueur absent.
- Instantanés visuels des voisins (`NeighborView`), achat de terres entre joueurs.
- Durée de partie choisie au lancement, classement au prestige, sauvegarde de la salle.
- Architecture prête pour 8 joueurs ; tests à 2.
- **Critère de fin :** deux joueurs sur deux PC finissent une partie de 30 ans.

### J6 — Équilibrage et graphismes
- Équilibrage avec `simulate` et des parties tests.
- Vrais visuels (vue 3/4), animations des porteurs et charrettes, sons.

## V2 — Candidats
- Mariages diplomatiques et héritage de fiefs.
- Guerre et conquête (résolues par calcul).
- Maladies et événements saisonniers (choix au bilan d'automne).
- Voisins IA actifs.
- Commerce entre fiefs : convois et accords récurrents.
- Branche cadette pour un joueur éliminé (option de partie).
- Multi à 3-4 joueurs équilibré, puis mode « grande partie » à 8.
- Traits de personnages.

## Peut-être (idées sans pilier validé)
- *(vide)*

## Fait
- 15/11/2026 : **Journal de partie** dans la page publiée : état toutes les 30 s et bilan annuel, lus par Claude via la base de l'artefact.
- 14/11/2026 : **J2a — L'économie circule** livré et jouable.
  - Réserves physiques : manoir (400) et entrepôts (300) ; l'or au trésor.
  - Porteurs qui suivent le plus court chemin par la route jusqu'à la réserve la plus proche ayant de la place.
  - Bûcheron et carrière : rendement selon le terrain à portée ; arrêt quand la production s'entasse.
  - Ferme : semailles au début de l'été, moisson à l'automne, rendement selon la fertilité, champs perdus à l'hiver.
  - Affichage : porteurs animés, champs qui mûrissent, pastilles d'état, caisses en attente, carte de fertilité.
  - Débogage : itinéraire du bâtiment sélectionné, itinéraires de tous les porteurs (L), panneau Logistique.
  - Sauvegardes format v2, conversion automatique des sauvegardes de J1.
  - 51 tests automatiques.
- 12/11/2026 : **J1 — Le terrain et le temps** livré et jouable.
  - Carte continue de 3 fiefs générée par graine (terrains dominants, fertilité, rivière, départ garanti).
  - Zoom à trois niveaux (proche, fiefs, Monde) avec étiquettes des fiefs, saut vers un fief, retour au manoir.
  - Placement : routes (tracé continu, défrichage), 7 bâtiments de tailles variables, champs peints, démolition remboursée à 50 %.
  - Bâtiments « reliés » ou non au manoir, avec signal visuel.
  - Horloge : 3 min par an, saisons visibles sur la carte, pause et x1/x2/x3.
  - Barrière annuelle en fin d'automne (vide pour l'instant), passerelle LocalWorld.
  - Sauvegarde manuelle, automatique (chaque bilan d'automne), export et import.
  - 37 tests automatiques : déterminisme, règles de placement, calendrier, barrière, sauvegarde.
- 12/11/2026 : brief fondateur, DESIGN.md v0.1 à v0.3, réponses aux questions Q1 à Q8, création de cette ROADMAP.

## Idées notées (à trier)
- Chantiers : les matériaux de construction livrés par porteurs (aujourd'hui la construction est instantanée).
- Épuisement des forêts et des carrières, repousse des arbres.
- Déménager le contenu d'une réserve vers une autre à la demande.
- Charrettes (charge plus grande, besoin d'une route plus large) pour les longues distances.
- Ponts pour franchir les rivières (aujourd'hui l'eau bloque les routes).
- Rotation des bâtiments (exclue de la V1).
- Pincer pour zoomer sur écran tactile.
- Rivières continues d'un fief à l'autre (aujourd'hui chaque rivière reste dans son fief).
