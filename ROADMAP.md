# ROADMAP.md

> Mise à jour : 16/11/2026 · Référence des règles : DESIGN.md (v0.9)
> Chaque jalon se termine par un jeu qui se lance et se joue. Une idée qui sort du jalon en cours est notée ici, pas codée.

## En cours

- Rien. Prochain jalon : **J5 — Voisins IA et commerce**. Critère J3 (deux successions) encore à vérifier dans une partie longue.

## À faire

> **Ordre revu le 16/11/2026** (choix du joueur) : une partie de la V2 passe avant le multi. Elle donne plus de jeu au solo et de la matière pour l'équilibrage. Garde-fou : chaque nouveauté se résout au bilan d'automne, passe par les messages de `shared/src/messages.ts` et reste déterministe, pour que le multi n'ait rien à réécrire.

### J4c — Réglages (courte passe)
- Vêtements : couverture proportionnelle (plus de « tout ou rien ») et message qui dit où la chaîne bloque (laine, tisserand).
- Guérisseurs : remèdes gardés sur place, plus d'alerte « porteurs ».
- Foire : la vente doit valoir le clic ; journal de la foire de l'année seulement.
- Moral et natalité : moins de plafond à 99, naissances freinées sans vêtements.
- **Critère de fin :** une partie de 20 ans où les vêtements sont couverts avec 2 ou 3 bergeries, la foire sert, et le chômage reste contenu.

### J5 — Voisins IA et commerce
- Seigneurs IA qui vivent : leurs villages grandissent, ils achètent des fiefs libres, vendent, refusent.
- Commerce entre fiefs : convois et accords récurrents (débouché des surplus).
- Nouveaux métiers liés au commerce.

### J6 — Guerre et conquête
- Soldats (métier qui absorbe le chômage), conquête résolue par calcul au bilan d'automne.

### J7 — Événements et traits
- Événements saisonniers annoncés, choix au bilan d'automne.
- Traits des personnages (seigneur, héritiers, conjoints).

### J8 — Prototype multi (2 joueurs)
- Cloudflare Worker + Durable Object (une salle par partie), RemoteWorld, WebSockets.
- Barrière annuelle en réseau, délai maximal pour un joueur absent.
- Instantanés visuels des voisins (`NeighborView`), achat de terres entre joueurs.
- Durée de partie choisie au lancement, classement au prestige, sauvegarde de la salle.
- Architecture prête pour 8 joueurs ; tests à 2.
- **Critère de fin :** deux joueurs sur deux PC finissent une partie de 30 ans.

### J9 — Équilibrage et graphismes
- Équilibrage avec `simulate` et des parties tests (solo et multi).
- Vrais visuels (vue 3/4), animations des porteurs et charrettes, sons.

## V2 — Candidats (après le multi)
- Mariages diplomatiques et héritage de fiefs.
- Branche cadette pour un joueur éliminé (option de partie).
- Multi à 3-4 joueurs équilibré, puis mode « grande partie » à 8.

## Peut-être (idées sans pilier validé)
- *(vide)*

## Fait
- 16/11/2026 : **J4c — Réglages** validé par le joueur (guérisseur : soigne tout son fief) : couverture proportionnelle et chaîne expliquée, malus « Bras inoccupés », natalité freinée sans vêtements, guérisseur, foire plus rentable.
- 16/11/2026 : **J4b — Métiers et besoins** validé par le joueur (partie test n° 5, 22 ans).
  - Forge (outils, production +25 %), bergerie et tisserand (vêtements : moral, froid), guérisseur (remèdes).
  - Natalité de 1,5 à 2,5 ans selon le moral et les besoins.
  - Épidémies rares et annoncées ; un guérisseur à portée divise la mortalité par quatre.
  - Foire d'automne : achat et vente à prix fixes.
  - Sauvegardes format v7. 124 tests automatiques.
- 16/11/2026 : **Retours de la partie test n° 4** (25 ans, 3 fiefs, baron) : une église par fief, routes à 1 or + 1 pierre, ravitaillement corrigé entre fiefs (les foyers d'un fief acheté mouraient de faim), alerte « vivres à N cases ». 115 tests.
- 16/11/2026 : **J4 — S'étendre** livré, à valider en partie test.
  - Carte 5 × 5 (nouvelles parties), 24 seigneurs IA avec un village qui grandit.
  - Négociation : offre sous séquestre, prix plancher secret tiré chaque année, réponse et avis au bilan d'automne.
  - Fief acheté : terrain et village reconstruits (maison forte, rue, maisons habitées, fermes et champs, bûcheron, vivres pour l'hiver).
  - Titres baron, comte, duc (fiefs + habitants), avec prestige et moral ; nom du domaine dans le bandeau.
  - Vue Monde lisible, panneau « Domaine et voisins », fenêtre d'offre, ligne « Affaires » au bilan, alerte quand une offre est possible.
  - Sauvegardes format v6. 113 tests automatiques.
- 16/11/2026 : **Retours de la partie test n° 3** (graine chêne-832, 13 ans, 33 min) : la famille noble se sert dans toutes les réserves (elle mourait de faim manoir vide) ; alertes « le village mange plus qu'il ne récolte » et « villageois sans emploi ». 103 tests.
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
- **Retours de la partie test n° 5 (J4b, 22 ans, environ 70 min)** :
  - Vêtements : couverture à 0 % de l'an 16 à la fin. Une seule bergerie (≈ 60 laines par an) pour 4 tisserands, quand il en faut 2 à 3 pour 170 habitants. L'écran ne dit pas où la chaîne bloque. Et la couverture compte « tout ou rien » chaque jour : un tiers des besoins servis s'affiche 0 %. À rendre proportionnelle, et à expliquer (« il manque de la laine : une bergerie de plus »).
  - Outils trop faciles : une forge suffit pour toute la partie, 199 outils en stock dormant.
  - Guérisseurs signalés « porteurs ne suivent pas » alors que leurs remèdes doivent rester chez eux : ne pas les livrer, ne pas alerter.
  - Réserves pleines (1 360 vivres) et foire presque jamais utilisée (bois les ans 1 et 3, pierre l'an 11, aucune vente) : la vente rapporte peu face aux impôts. Le journal recopie aussi l'ancienne foire d'une année sur l'autre (à corriger).
  - Moral à 90-99 dès l'an 12 (église puis titre) : plus de tension ; la natalité reste rapide même sans vêtements (le moral compte double). Résultat : 116 enfants sur 178 habitants à l'an 20, et le chômage revient (28 sans emploi à l'an 22) quand ils grandiront.
  - Premier achat de fief seulement à l'an 21 (900 or) : 20 ans sur un seul fief.
- (Traité en partie par J4b ; à revoir après la partie test.) **Chômage massif** (partie test n° 4 : 72 villageois sans emploi sur 143 à l'an 25) et **ennui en fin de partie** (1 à 12 actions par an, tout en vitesse ×3) : il faut des métiers et des besoins nouveaux. Idée du joueur : les événements (maladies, guerres) créeront des métiers (guérisseurs, soldats) qui absorberont ce chômage. À cadrer avant ou avec la V2 ; la natalité (une naissance tous les 1,5 an par foyer) gonfle aussi la population plus vite que les emplois.
- Remariage des veufs et veuves (aujourd'hui un foyer qui perd un parent ne se reforme pas).
- Arrivées des nouveaux venus selon la tendance des vivres (récolte attendue), pas seulement les réserves.
- L'or et la pierre s'accumulent sans usage (872 or, 188 pierre à l'an 14). J4 donne un débouché à l'or (achat de fiefs) ; la pierre reste sans usage.
- Voir le village d'un voisin sur la carte avant de l'acheter.
- Construire soi-même une maison forte dans un fief éloigné.
- Début de partie rude sur terre pauvre (famine des ans 2 à 4) : conseiller la carte de fertilité à la pose de la première ferme.
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
