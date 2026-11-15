# ROADMAP.md

> Mise à jour : 15/11/2026 · Référence des règles : DESIGN.md (v0.7)
> Chaque jalon se termine par un jeu qui se lance et se joue. Une idée qui sort du jalon en cours est notée ici, pas codée.

## En cours

- **Partie test de J3 — La lignée** (critère : jouer deux successions, puis perdre par extinction en l'ayant vue venir), puis **J4 — S'étendre**.

## À faire

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
- 15/11/2026 : **J3 — La lignée** livré, à valider en partie test.
  - Famille du seigneur au manoir (fondateur, épouse, enfant), qui vit, mange, a des enfants et meurt avec le village, sans travailler ni payer d'impôts.
  - Trois lois de succession (masculine seule, les fils d'abord, aînesse absolue), changées par décret appliqué un an plus tard ; ordre de succession complet (petits-enfants, frères et sœurs, neveux).
  - Succession avec fenêtre et pause, régence (moral −10) jusqu'aux 16 ans, fin de partie par extinction.
  - Affaires de famille à 16 ans : 3 prétendants (âge, dot, maison voisine), Église ou mariage chez un voisin ; remariage du seigneur veuf.
  - Prestige (bandeau, panneau, résumé envoyé au Monde), chronique de la lignée et règnes, écran de fin avec la chronique.
  - Panneau Lignée, alertes (un seul héritier, aucun héritier, décret dangereux, affaires en attente), bilan d'automne et journal de partie enrichis.
  - Outil `lignee` (extinctions selon la loi et les mariages) ; `simulate` gère les affaires de famille.
  - Sauvegardes format v5. 102 tests automatiques.
- 15/11/2026 : **Retours de la partie test n° 2** (graine orge-349, ans 3 à 7, 14 min).
  - Nouveaux venus : une famille s'installe dans une maison libre que personne n'attend, s'il y a 120 jours de vivres et du moral ; accueil réglable (fermé, normal = 1 par an, ouvert = 3 par an et moral −10).
  - La fiche de l'outil Maison et celle d'une maison vide disent qui viendra l'habiter, ou pourquoi personne, et dans combien de temps le prochain mariage est possible.
  - Les alertes nomment les bâtiments sans travailleur (« Église : ne soutient plus le moral ») et les postes vacants.
  - Le journal n'écrit plus rien tant que la partie n'a pas été jouée (fini les parties vides).
  - Correction : les foyers de départ reçoivent bien leurs 10 jours de vivres.
  - Outil `simulate` : réglage de l'accueil, colonne des nouveaux venus, joueur type qui ajoute aussi bûcherons et maisons.
  - Sauvegardes format v4. 80 tests automatiques.
- 15/11/2026 : **J2b — Le village vit** livré et jouable.
  - Population : 10 couples de 20 à 25 ans et leurs enfants, tentes autour du manoir, naissances, décès, mariages, orphelins recueillis.
  - Maisons, emplois automatiques par priorité avec nombre réglable, temps de trajet domicile-travail.
  - Foyers qui vont chercher nourriture et bois ; marché ravitaillé par ses marchands ; chauffage l'hiver.
  - Faim et froid (après 5 jours), moral par foyer (église, marché, impôts), impôts au bilan d'automne.
  - Interface : habitants et moral dans le bandeau, panneau Village, impôts, alertes, fiche des foyers, travailleurs − / +, bilan d'automne en pause, fin de partie.
  - Outil `simulate` ; équilibrage des fermes (12 par champ, grange de 300, charrettes de 12), manoir de 500 places, chauffage 4 par hiver.
  - Sauvegardes format v3. 73 tests automatiques.
- 15/11/2026 : **Retours de la partie test n° 1** (graine orge-349, 3 ans, 9 min) : fiche d'outil avant construction, avertissement des champs en trop, reprise automatique de la dernière partie, sauvegarde automatique toutes les 30 s, bilan annuel sur quatre saisons.
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
- Remariage des veufs et veuves (aujourd'hui un foyer qui perd un parent ne se reforme pas).
- Arrivées des nouveaux venus selon la tendance des vivres (récolte attendue), pas seulement les réserves.
- Lignée : contrepartie pour la loi masculine seule ; décision par défaut pour les cadets ; fécondité propre à la noblesse ; arbre généalogique dessiné.
- Export de sauvegarde (fichier) inopérant dans la page publiée sur claude.ai : passer par la capacité de téléchargement de l'artefact.
- Villageois visibles sur la carte (aller au travail, au marché).
- Priorités d'emploi réglables par le joueur (aujourd'hui l'église et le marché passent en dernier ; à revoir si l'alerte qui les nomme ne suffit pas).
- Chantiers : les matériaux de construction livrés par porteurs (aujourd'hui la construction est instantanée).
- Épuisement des forêts et des carrières, repousse des arbres.
- Déménager le contenu d'une réserve vers une autre à la demande.
- Charrettes (charge plus grande, besoin d'une route plus large) pour les longues distances.
- Ponts pour franchir les rivières (aujourd'hui l'eau bloque les routes).
- Rotation des bâtiments (exclue de la V1).
- Pincer pour zoomer sur écran tactile.
- Rivières continues d'un fief à l'autre (aujourd'hui chaque rivière reste dans son fief).
