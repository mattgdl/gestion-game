# DESIGN.md — Jeu de gestion médiéval à dynastie

> **Titre provisoire :** « Seigneurie » (nom de travail, à remplacer) · **Version du document :** 0.9 · **Dernière mise à jour :** 16/11/2026
> **Statut :** J4b livré (métiers et besoins), à valider en partie test. Prochain jalon : J5 (prototype multi).
> Ce document est la référence du projet. En cas de doute, c'est lui qui tranche, et chaque décision y est consignée avec sa raison (section 11).

## Sommaire

1. Pitch
2. Piliers de design
3. Décisions actées
4. Règles fixées en codant
5. Systèmes clés
6. Risques identifiés
7. Architecture : couches Fief et Monde
8. Arborescence du projet
9. Questions reportées
10. Glossaire
11. Journal des décisions

---

## 1. Pitch

Le joueur incarne une lignée de seigneurs locaux, en vue « divine ». Il bâtit sa ville sur son fief, saison après saison, puis génération après génération. Quand la place manque, il regarde de l'autre côté de la frontière : acheter, épouser, hériter ou conquérir les fiefs voisins.

La partie se termine quand la lignée s'éteint ou quand le domaine se vide. Le jeu se joue seul, puis entre amis : chaque joueur est alors un seigneur voisin.

---

## 2. Piliers de design

| Pilier | Ce que le joueur ressent | Question à poser pour toute nouvelle fonctionnalité |
|---|---|---|
| **Bâtir** | Sa ville grandit sous ses yeux | Est-ce que ça rend la ville plus vivante ou plus satisfaisante à construire ? |
| **Transmettre** | Ses choix pèsent sur ses descendants | Est-ce que ça crée une conséquence qui survit au seigneur ? |
| **S'étendre** | Le manque d'espace pousse vers les voisins | Est-ce que ça rend l'acquisition de terres désirable ou disputée ? |

Une fonctionnalité qui ne sert aucun pilier va dans la ROADMAP, rubrique « peut-être », et pas dans le code.

---

## 3. Décisions actées

| Sujet | Décision | Raison |
|---|---|---|
| Point de vue | Vue divine. Le seigneur est une présence abstraite, pas un avatar contrôlé. | Rester un city-builder pur. |
| Plateforme | Navigateur. TypeScript + Vite + Phaser 4. | Itération rapide, testable, multijoueur web naturel. |
| Temps (Q1) | 4 saisons par an. **1 an = 3 min** en vitesse normale, soit environ 45 s par saison. Pause et x2/x3 en solo uniquement. Valeur réglable dans la config. | Environ 1 h 30 par génération : le pilier Transmettre se ressent, même en multi. |
| Carte (Q2) | Une seule carte continue, découpée en fiefs, avec zoom à plusieurs niveaux jusqu'à une vue Monde. Chaque fief a un terrain dominant. | L'expansion se voit physiquement ; la vue Monde sert la diplomatie. |
| Fin de partie (Q3) | Solo : bac à sable jusqu'à la défaite, avec des titres à débloquer. Multi : durée choisie au lancement + classement au prestige, salle sauvegardable. | Donner un objectif de long terme en solo, une fin claire en multi. |
| Joueur éliminé (Q3) | Son domaine devient terre libre. Option de partie : repartir avec une branche cadette. | Entretenir la rivalité sans exclure personne. |
| Joueurs (Q4) | Plafond technique : 8. Conception et équilibrage : 2 à 4. Le mode 8 joueurs est validé après la V2. | 8 coûte peu côté serveur, mais beaucoup en tests et en équilibrage. |
| Villageois (Q5) | Individus « fiches » + **logistique par flux** (marchandises transportées sur les routes avec temps de trajet, sans simulation tuile par tuile). | Se rapprocher de l'option A (Banished, Manor Lords) sans son coût. |
| Placement (Q6) | Routes obligatoires, bâtiments de tailles variables, champs peints autour des fermes, fertilité par tuile, pas de rotation en V1. | Casse-tête spatial au service du pilier Bâtir. |
| Perspective (Q7) | Vue de dessus « 3/4 » sur grille carrée : les bâtiments montrent leur façade. | Beau rendu pour un coût de développement et de dessin raisonnable. |
| Saisons (Q8) | Option C : calendrier agricole et chauffage dès J2, événements saisonniers en V2. | L'hiver rend la famine prévisible ; les événements apportent de la variété. |
| Défaite 1 | Extinction de la lignée : plus aucun descendant vivant et éligible du fondateur. | La défaite découle d'une suite de choix, pas d'un tirage. |
| Défaite 2 | Population du **domaine entier** sous 5 habitants. Perdre ou vider un fief ne fait pas perdre la partie. | Avec plusieurs fiefs, seul le domaine compte. |
| Défaite prévisible | Indicateurs visibles et alertes avant le point de non-retour. Jamais de défaite par un seul tirage aléatoire. | Une défaite doit sembler juste. |
| Chronique | Écran « Chronique de la dynastie » en fin de partie. | Pilier Transmettre. |
| Multijoueur | Sessions synchrones, Cloudflare Workers + Durable Objects, barrière annuelle. | Évite la synchronisation complète des simulations. |
| Architecture | Couches Fief et Monde séparées, simulation en TypeScript pur, état en JSON, commandes, ticks à pas fixe, aléatoire à graine. | Permet le multi et les tests sans réécriture. |
| Graphismes | Formes simples (placeholders) jusqu'à J6. | Valider le fun avant de dessiner. |

---

## 4. Règles fixées en codant

Règles décidées pendant le développement, à contester si elles ne te conviennent pas.

### 4.1 J1 — Le terrain et le temps

| Sujet | Règle | Raison |
|---|---|---|
| Bâtiments et frontières | Un bâtiment doit tenir entièrement dans un seul fief. Les routes, elles, traversent les frontières. | Un fief cédé (achat, héritage) part avec ses bâtiments entiers. |
| Bâtiment « relié » | Relié si une route reliée au manoir touche un de ses côtés. Un bâtiment non relié porte un « ! » rouge. | Prépare J2a : un bâtiment non relié ne fonctionnera pas. |
| Routes en biais | Un tracé en biais devient un escalier de cases (jamais de diagonale). | Les routes ne se relient que par les côtés. |
| Défrichage | Une route peut passer sur la forêt : la case devient de l'herbe. Pas de route sur la roche ni sur l'eau. | Les ponts viendront plus tard. |
| Champs | Peints à moins de 4 cases d'une ferme ; démolir la ferme abandonne ses champs. | Règle Q6. |
| Démolition | Rend la moitié du coût. Le manoir ne se démolit pas. | Éviter les erreurs coûteuses sans rendre la construction gratuite. |
| Bâtiments uniques | Manoir et église : un seul exemplaire. | L'église sera liée aux mariages et successions (J3). |
| Exigences de terrain | Bûcheron à moins de 4 cases d'une forêt, carrière à moins de 3 cases d'une roche. | Lisibilité : le terrain dicte l'emplacement. |
| Départ | Manoir au centre du fief, 5 routes, 100 nourriture, 150 bois, 60 pierre, 200 or. Centre dégagé, forêt et roche garanties dans le fief de départ. | Un départ jouable quelle que soit la graine. |
| Sauvegarde | Emplacement manuel + sauvegarde automatique à chaque bilan d'automne, export et import en texte. | Les fichiers à télécharger ne fonctionnent pas dans la version publiée. |
| Interface | Une seule ambiance sombre ; couleurs des seigneurs tirées des émaux héraldiques (azur pour le joueur). | Placeholder cohérent jusqu'à J6. |

### 4.2 J2a — L'économie circule

| Sujet | Règle | Raison |
|---|---|---|
| Réserves | Les marchandises (nourriture, bois, pierre) existent physiquement : dans le manoir (400 places), un entrepôt (300 places), un atelier (en attente) ou sur le dos d'un porteur. L'or reste un total, le trésor, sans limite. | Sans réserves pleines, la logistique n'aurait aucun enjeu. |
| Construction | Instantanée : les matériaux sont prélevés directement dans les réserves, où qu'elles soient. | Simplification assumée ; les chantiers livrés par porteurs sont notés pour plus tard. |
| Porteurs | Bûcheron et carrière : 1 porteur, charge 5. Ferme : 2 porteurs, charge 8. Un porteur part quand la charge est pleine, ou avec une charge partielle après 15 s sans production. | Les fermes produisent par à-coups pendant la moisson. |
| Destination | La réserve la plus proche **par la route** qui a de la place. La place est réservée au départ du porteur. | Placer un entrepôt près des ateliers raccourcit les trajets. |
| Vitesse | 0,5 s par case de route à vitesse ×1 (2 cases par seconde), plus une case pour entrer et sortir. | Un atelier à plus de ~20 cases de sa réserve commence à manquer de porteurs. |
| Arrêt | Un atelier s'arrête quand sa production en attente atteint son maximum (20 pour bûcheron et carrière, 150 pour la ferme). Pastille orange sur la carte. | Signal visible du goulot d'étranglement. |
| Réserve démolie | Son contenu est déménagé dans les autres réserves ; ce qui ne tient pas est perdu (signalé dans la chronique). Un porteur en route rapporte sa charge. | Rien ne disparaît sans explication. |
| Rendement | Bûcheron : 40 bois par an avec 24 cases de forêt à 4 cases ou moins. Carrière : 24 pierre par an avec 10 cases de roche à 3 cases ou moins. En dessous, rendement proportionnel. Pas d'épuisement en J2a. | Le terrain dicte l'emplacement ; l'épuisement est noté pour plus tard. |
| Ferme | Travaille jusqu'à 12 champs, les plus proches d'abord ; chaque champ est confié à la ferme la plus proche qui a de la place. Les champs en trop restent en friche (hachurés). | Limite de main-d'œuvre, en attendant les vrais travailleurs (J2b). |
| Semailles | Un champ est semé s'il existe et que sa ferme est reliée **au début de l'été**. Un champ créé en été ne donne rien avant l'année suivante. | Calendrier agricole lisible (Q8). |
| Moisson | À l'automne, un champ toutes les 2,5 s par ferme ; rendement = 8 × fertilité. Les champs non moissonnés au début de l'hiver sont perdus. | La fertilité compte ; une ferme bloquée perd sa récolte. |
| Fertilité | Avec l'outil Champ ou en posant une ferme, une carte de fertilité s'affiche autour du curseur (rouge pauvre, vert riche). | Rendre visible le choix de l'emplacement. |
| Chauffage | Reporté en J2b. | Il dépend des foyers, qui arrivent en J2b. |
| Sauvegardes | Format v2. Les sauvegardes de J1 sont converties : les ressources sont rangées au manoir. | Les vieilles parties restent jouables. |
| Fiche d'outil | Choisir un outil affiche sa fiche : à quoi sert le bâtiment, coût (en rouge s'il manque), taille, conditions, et « pas encore d'effet » pour ceux qui ne servent qu'à partir d'un jalon futur. | Retour de jeu : on construisait marché et maisons sans savoir à quoi ils servent. |
| Champs en trop | Un champ qu'aucune ferme ne travaillera s'affiche en orange à la pose, avec un avertissement. Il reste autorisé. | Journal de partie : 48 champs sur 72 étaient en friche. |
| Reprise | À l'ouverture, le jeu reprend la partie la plus récente (sauvegarde automatique ou manuelle). Sauvegarde automatique toutes les 30 s, quand on quitte l'onglet et à chaque bilan d'automne. | Journal de partie : rouvrir la page lançait une nouvelle partie. |
| Année agricole | Les statistiques de l'année vont du début de l'hiver à la fin de l'automne ; le bilan d'automne couvre donc quatre saisons. | Le bilan ne comptait que neuf mois de production. |
| Journal de partie | Dans la page publiée sur claude.ai, le jeu écrit dans la base de l'artefact : l'état de la partie toutes les 30 s (avec la sauvegarde complète) et un bilan à chaque fin d'automne (production, moisson, bâtiments bloqués, actions, refus, temps réel par vitesse). Lecture réservée au propriétaire de l'artefact. Désactivable dans le panneau Partie. Rien n'est écrit tant que la partie n'a pas été jouée pendant la visite (une action acceptée ou 5 s hors pause). | Permettre à Claude d'analyser les vraies parties de test. Ouvrir la page sans jouer créait des parties vides dans le journal. |

---

### 4.3 J2b — Le village vit

| Sujet | Règle | Raison |
|---|---|---|
| Départ | 10 couples de 20 à 25 ans et 0 à 2 enfants de 0 à 5 ans chacun (environ 30 habitants), sans maison : ils campent sous des tentes autour du manoir. 10 jours de vivres par foyer, le reste au manoir (180 nourriture, 150 bois, 60 pierre ; manoir de 500 places). | Choix du joueur : 20 adultes et leurs enfants. Premier objectif : loger tout le monde avant l'hiver. |
| Âges | Travail dès 14 ans, mariage dès 17 ans. Réglables dans `demography.json`. | Le joueur n'a pas tranché l'âge du travail. |
| Naissances | Une femme mariée de 17 à 40 ans a un enfant en moyenne tous les 180 jours de jeu (1,5 an), jamais moins de 120 jours après le précédent ; ×0,5 à ×1,5 selon le moral ; aucune quand le foyer a faim. | Choix du joueur (une naissance par famille tous les 1,5 an). |
| Mortalité | Par an : 5 % avant 5 ans, 1 % jusqu'à 49 ans, puis 4 %, 10 % et 25 %. Faim et froid : 0,4 % par jour, seulement après 5 jours consécutifs. | Un trajet de ravitaillement en retard ne tue personne ; une famine qui dure, si. |
| Mariages | Au début de chaque saison, les célibataires de 17 ans et plus (de foyers différents) se marient s'il y a une maison libre. Un veuf ou une veuve ne se remarie pas (pour l'instant). | Les maisons libres deviennent une condition de croissance. |
| Logement | Une maison = un foyer. Les sans-abri emménagent dans les maisons libres dès le lendemain. Une maison démolie remet son foyer à la rue. | Simple et lisible. |
| Emplois | Automatiques : la nourriture d'abord (fermes), puis bois, pierre, marché, église ; à priorité égale, à tour de rôle ; le travailleur le plus proche de son domicile. Le joueur peut limiter le nombre de travailleurs de chaque bâtiment (− / +). | Choix du joueur : automatique avec nombre réglable. Priorité à la nourriture : sans elle, le village meurt. |
| Trajet domicile-travail | Sans perte jusqu'à 10 cases, puis −1,25 % de temps de travail par case, jamais moins de 50 %. | Rapprocher maisons et lieux de travail compte. |
| Effectifs | Ferme 3 (4 champs par travailleur), bûcheron 2, carrière 2, marché 2, église 1 (prêtre). | Le rendement des ateliers est proportionnel aux emplois occupés. |
| Consommation | Adulte (14 ans et plus) 6 nourriture par an, enfant 3. Bois de chauffage : 4 par maison et par hiver. | Équilibré avec l'outil `simulate`. |
| Provisions | Chaque foyer vit sur ses provisions et envoie quelqu'un se ravitailler (15 au plus par voyage) à la réserve ou au marché le plus proche par la route : nourriture quand il en reste moins de 15 jours ou moins que l'aller-retour plus 10 jours ; bois en automne et en hiver. Les sans-abri se servent directement au manoir. | Choix du joueur : les familles vont se servir. La place des maisons compte. |
| Marché | Ses 2 marchands remplissent ses étals (120 places) jusqu'à 70 nourriture et 40 bois en allant aux réserves ; les foyers proches s'y servent. Moral +10 à 12 cases. | Le marché devient utile. |
| Église | Avec un prêtre : moral +15 pour les maisons à 15 cases. | L'église devient utile avant J3. |
| Moral | Par foyer, de 0 à 100 : base 50, nourri +15 / affamé −30, logé +10 / sans abri −20, l'hiver chauffé +5 / froid −20, église +15, marché +10, impôts aucun +10 / lourds −15, accueil ouvert aux nouveaux venus −10. Effets : ateliers ×0,75 à ×1,25 (neutre à 50), naissances ×0,5 à ×1,5. | Choix du joueur : moral simple. |
| Impôts | Au bilan d'automne, par foyer logé : aucun 0, normaux 4, lourds 8 or. Seule source d'or pour l'instant. | Premier revenu ; un vrai choix contre le moral. |
| Nouveaux venus | Au début du printemps, de l'été et de l'automne, une famille (un couple de 18 à 30 ans et 0 à 2 enfants de 8 ans au plus) s'installe dans une maison libre et reliée si : personne d'autre ne l'attend (ni foyer sans abri, ni jeune couple prêt à se marier), le domaine a au moins 120 jours de vivres d'avance et un moral d'au moins 50. Le joueur règle l'accueil dans le panneau Village : fermé, normal (1 famille par an au plus, par défaut) ou ouvert (3 par an au plus, moral −10). Elle arrive avec 10 jours de vivres. | Partie test n° 2 : aucun nouvel adulte avant l'an 14, trois maisons vides et un surplus de nourriture sans usage. Les maisons libres et les vivres deviennent un moyen de grandir ; le choix du rythme reste au joueur. |
| Maison vide | La fiche de l'outil Maison et la fiche d'une maison vide disent qui viendra l'habiter (famille sans abri, jeune couple, nouveaux venus) ou pourquoi elle restera vide, avec le délai avant le prochain mariage possible. | Partie test n° 2 : trois maisons bâties pour rien, sans avertissement. |
| Fermes (équilibrage) | 12 nourriture par champ à 100 % de fertilité (au lieu de 8) ; grange de 300 et porteurs de 12 ; une ferme moissonne tout champ semé à sa portée, même si ses emplois ont changé depuis les semailles. | L'outil `simulate` montrait des famines dues aux granges pleines et aux récoltes perdues. |
| Alertes | Vivres (moins de 60 jours), récolte attendue insuffisante pour l'année, foyers affamés ou sans feu, familles sans abri (rouge à partir de l'automne), bois de chauffage insuffisant à l'automne, maisons sans route, réserves pleines, bâtiments sans travailleur (nommés, avec l'effet perdu sur le moral pour l'église et le marché), postes vacants (nommés), jeunes couples sans maison, maisons libres qu'aucune famille ne viendra occuper (et pourquoi). | Défaite prévisible. Partie test n° 2 : l'église a perdu son prêtre à la construction du marché, et l'alerte disait seulement « 1 emploi vacant ». |
| Bilan d'automne | En solo, la partie se met en pause sur une fenêtre de bilan (désactivable dans la fenêtre). | Prévu en 5.3. |
| Fin de partie | Sous 5 habitants : le temps s'arrête, fenêtre de fin (nouvelle partie ou dernière sauvegarde manuelle). Une partie terminée ne se reprend pas automatiquement. | Condition de défaite n° 2. |
| Sauvegardes | Format v4. Les sauvegardes de J2a reçoivent la population de départ ; celles de J2b, l'accueil normal des nouveaux venus. | Les vieilles parties restent jouables. |
| Vivres de départ (correction) | Chaque foyer de départ arrive bien avec ses 10 jours de vivres (seul le premier les recevait). | Vu en préparant les nouveaux venus : des maisons bâties dès le premier jour laissaient 9 foyers sur 10 affamés pendant 5 à 6 jours. |

**Ce que montre l'outil `simulate`** (village type à 70 % de fertilité, joueur qui ajoute fermes et entrepôts quand il le faut) : la population passe d'environ 30 à 80 habitants en 10 ans, puis plafonne autour de 120 avec 6 fermes. Les enfants sont 3 fois plus nombreux que les adultes vers l'an 10 : il faut environ une ferme pour 15 à 20 habitants. Les premiers mariages n'arrivent que vers l'an 12 à 14 (les enfants de départ ont 5 ans au plus) : jusque-là, le nombre de foyers ne peut que baisser. Sans entrepôts, les réserves se remplissent de bois, les fermes ne peuvent plus livrer et le village meurt de faim vers l'an 12.

**Avec les nouveaux venus** (même village, 30 ans, joueur qui ajoute fermes, entrepôts, bûcherons et maisons ; 9 emplacements de ferme au plus) : à l'an 7, le village compte 19 adultes et 10 foyers sans accueil, 30 adultes et 16 foyers à l'accueil normal, 50 adultes et 26 foyers à l'accueil ouvert. Les arrivées s'arrêtent d'elles-mêmes quand les vivres baissent sous 120 jours. Avec l'accueil normal, le village atteint vers l'an 15 la limite de ce que 9 fermes peuvent nourrir (environ 200 habitants, dont deux tiers d'enfants) ; avec l'accueil ouvert, vers l'an 10. La règle des 120 jours regarde les réserves, pas la tendance : l'alerte « récolte attendue trop faible » reste le signal à surveiller. La terre du fief devient la vraie limite, ce qui prépare J4 (s'étendre).

### 4.4 J3 — La lignée

| Sujet | Règle | Raison |
|---|---|---|
| Fondation | Le seigneur (homme, 22 à 26 ans), son épouse (18 à 22 ans, venue d'une maison voisine) et un enfant de 0 à 2 ans s'installent au manoir avec 10 jours de vivres. La lignée s'appelle « Maison de » + le nom du fief de départ. | Une lignée qui commence avec un héritier ; défaite par extinction impossible dès le début. |
| Famille noble | Ses membres (de sang ou par mariage) sont des villageois à part : ils vivent au manoir, se servent directement dans ses réserves (nourriture, bois l'hiver), ne travaillent pas, ne paient pas d'impôts et ne comptent ni dans le moral du village ni dans les foyers, mais comptent dans la population. Mêmes règles de naissance et de mortalité que le village. | Réutiliser la simulation de la population ; la lignée « coûte » des bouches à nourrir. |
| Majorité | 16 ans (`dynasty.json`). | Choix par défaut, réglable. |
| Lois de succession | Trois lois : **masculine seule** (les fils, et seulement par les hommes), **les fils d'abord** (une fille s'il n'y a aucun fils ; par défaut), **aînesse absolue** (l'aîné(e)). | Choix du joueur. |
| Ordre de succession | Les descendants du seigneur d'abord, de l'aîné au cadet selon la loi ; l'enfant d'un héritier mort prend sa place (avant ses oncles et tantes) ; puis les descendants de son parent (frères, sœurs, neveux…), et ainsi de suite jusqu'au fondateur. Seuls les membres de sang, vivants et restés au domaine, peuvent hériter. | Primogéniture classique, lisible. |
| Décret | Le joueur peut changer de loi dans le panneau Lignée ; elle s'applique 120 jours (un an) plus tard. Revenir à la loi en vigueur annule le décret. Le panneau dit qui serait l'héritier avec la nouvelle loi. Pas de contrepartie : la loi masculine seule reste un choix d'ambiance, plus risqué. | Choix du joueur : modifiable en jeu avec délai, pour empêcher de choisir l'héritier au dernier moment. |
| Succession | À la mort du seigneur, le premier de l'ordre de succession hérite ; la partie se met en pause sur une fenêtre de succession. | Écran de succession prévu au jalon. |
| Régence | Héritier de moins de 16 ans : un parent vivant et majeur gouverne (sinon l'adulte le plus âgé de la famille, sinon un conseil) jusqu'à sa majorité. Moral de chaque foyer du village −10 pendant la régence. | Choix du joueur : régent avec un malus. |
| Extinction | À la mort du seigneur, si personne ne peut hériter selon la loi en vigueur : fin de la partie. Alertes : un seul héritier quand le couple du seigneur ne peut plus avoir d'enfant (orange), aucun héritier (rouge), décret qui laisserait la lignée sans héritier (rouge). | Défaite n° 1, prévisible. |
| Affaires de famille | À 16 ans, chaque membre de sang non marié attend une décision : épouser l'un de 3 prétendants (16-19 ans et 10-30 or de dot, 20-26 ans et 30-60 or, 27-35 ans et 60-120 or ; venus des maisons voisines de la carte), entrer dans l'Église (+25 prestige) ou épouser quelqu'un chez un voisin (+40 or, +10 prestige) ; ces deux voies le font sortir de la lignée pour toujours. « Plus tard » laisse la décision en attente. Le seigneur ne peut pas quitter le domaine ; veuf (moins de 55 ans), il se voit proposer un remariage, qu'il peut refuser. La fenêtre de décision met la partie en pause. | Choix du joueur : prétendants au choix et cadets décidés par le joueur. Jeune conjoint = plus d'enfants ; conjoint âgé = grosse dot. |
| Couple marié | Un membre marié au domaine fonde un foyer noble au manoir, qui prend ses vivres dans les réserves ; ses enfants entrent dans la lignée. | Les cadets mariés sont des héritiers de secours, et des bouches à nourrir. |
| Prestige | Population (1 par habitant) + or (1 pour 10) + ancienneté de la lignée (2 par an) + successions (20 chacune) + Église et alliances. Affiché dans le bandeau, détaillé dans le panneau Lignée, envoyé au Monde dans le résumé de la barrière. | Premier calcul, prévu au jalon. Titres en J4. |
| Chronique | Fondation, naissances, mariages, morts, successions, régences, décrets, Église et alliances, datés ; règnes. Fenêtre « Chronique de la lignée » et écran de fin de partie (les deux défaites). | Pilier Transmettre. |
| Sauvegardes | Format v5. Une partie de J2b reçoit la lignée de départ à son ouverture. | Les vieilles parties restent jouables. |
| Vivres de la famille noble (correction) | Elle est servie au manoir d'abord, puis dans les entrepôts et les marchés. | Partie test n° 3 : deux épouses et trois enfants du seigneur morts de faim ou de froid, manoir vide à côté d'entrepôts garnis. |
| Alertes (partie test n° 3) | « Le village mange plus que les champs ne donnent » dès que la récolte attendue est sous la consommation de l'année, même avec des réserves ; « N villageois sans emploi » à partir de 3 bras inoccupés. | La récolte est restée à 330 pendant 8 ans, la consommation est passée de 175 à 441, 14 adultes étaient sans emploi, et rien ne le disait. |

**Ce que montre l'outil `lignee`** (famille du seigneur seule, vivres illimités, 10 graines, 100 ans) : environ 4 règnes par siècle, soit 25 ans par génération (environ 1 h 15 de jeu à vitesse normale ; la première succession vient vers l'an 30 à 45). Avec la même fécondité que le village, un couple noble a 8 à 12 enfants : en mariant l'héritier au prétendant le plus jeune et quelques cadets, aucune extinction en 100 ans, quelle que soit la loi. En mariant l'héritier au prétendant le plus âgé et en envoyant tous les cadets au loin, 2 à 6 lignées sur 10 s'éteignent vers l'an 70. Si l'on marie tous les enfants, la famille passe à plus de 700 personnes en 60 ans : la faim l'arrêtera, mais les décisions deviendront fastidieuses. Dans l'outil `simulate` (village à 9 fermes au plus), une famine longue a éteint la lignée vers l'an 39 : la famille noble meurt de faim comme le village quand le manoir est vide.

### 4.5 J4 — S'étendre

| Sujet | Règle | Raison |
|---|---|---|
| Carte | 5 × 5 fiefs de 48 × 48 cases ; le joueur au centre, 24 seigneurs IA. Les parties commencées avant J4 gardent leur carte de 3 fiefs. | Choix du joueur : grande carte. |
| Villages voisins | Chaque fief IA a un village de 3 à 7 foyers au départ, qui gagne un foyer avec 35 % de chances à chaque bilan (14 au plus). Les fiefs IA ne sont pas simulés : seuls ces chiffres existent. | Choix du joueur : fief acheté avec son village ; les voisins restent légers à calculer. |
| Valeur d'un fief | Herbe × 0,2 or × (0,5 + fertilité moyenne) + forêt × 0,12 + roche × 0,15 + 30 or par foyer ; × 1,1 en plaines, × 1,05 en vallée de rivière. Environ 400 à 900 or. Fourchette affichée : 0,85 à 1,35 × la valeur. | Le premier achat vient vers l'an 9 à 12 avec les impôts. |
| Négociation | On n'achète qu'un fief IA qui touche l'un des siens, une offre par fief. L'or part sous séquestre, et l'offre peut être retirée avant le bilan. Au bilan d'automne, le seigneur accepte si l'offre atteint son prix plancher secret, tiré chaque année entre 0,85 et 1,35 × la valeur. Un refus rend l'or avec un avis : « il hésite » (au moins 90 % du plancher) ou « bien trop basse ». Plusieurs offres sur un même fief (multi) : la plus haute l'emporte. | Choix du joueur : négociation. Le plancher change d'année en année, la patience peut payer. |
| Fief acheté | Son terrain rejoint le domaine avec le village reconstruit à l'identique de ses chiffres : une maison forte (réserve de 300, point de départ des routes comme le manoir, ni constructible ni démolissable), une rue, des ruelles, une maison par foyer, une ferme pour 6 foyers avec ses 12 champs les plus fertiles, un bûcheron si la forêt est à portée, 25 vivres et 8 bois par foyer. Les foyers sans place campent au manoir. | Choix du joueur : village construit. La maison forte évite de tirer une route depuis le manoir. |
| Titres | Définitifs une fois atteints : baron (2 fiefs, 100 habitants), comte (4 fiefs, 250), duc (8 fiefs, 500). Prestige +100 / +250 / +500, moral +5 / +10 / +15. Le domaine devient Seigneurie, Baronnie, Comté, Duché. | Choix du joueur : fiefs et population. |
| Interface | Vue Monde : étiquettes réduites au nom, avec « à vendre » sur les voisins achetables. Panneau « Domaine et voisins » : titre suivant et progression, vos fiefs, voisins à vendre (village, terrain, estimation, offre en cours). Fenêtre d'offre. Bilan d'automne : ligne « Affaires ». Alerte quand le trésor permet une offre. | Rendre l'expansion lisible. |
| Sauvegardes | Format v6. | Les vieilles parties restent jouables. |
| Église (partie test n° 4) | Une église par fief (au lieu d'une pour tout le domaine). | Retour du joueur : un domaine de plusieurs fiefs a besoin de plusieurs paroisses. |
| Routes (partie test n° 4) | 1 or et 1 pierre par case ; pierre de départ portée de 60 à 100. | Retour du joueur : routes trop faciles pour s'étendre. La pierre s'accumulait sans usage (716 à l'an 25) et remplissait les réserves. |
| Ravitaillement (correction, partie test n° 4) | Un foyer va à la réserve la plus proche qui peut lui fournir toute sa charge (25 au plus, au lieu de 15), sinon à celle qui en a le plus ; il prévoit son départ d'après le trajet jusqu'à une réserve capable de servir plusieurs foyers ; il ne part chercher du bois que si ses vivres tiennent le voyage ; jamais plus de deux mois de vivres d'avance. | Dans le fief acheté, les réserves étaient pleines de pierre et la moisson partait au manoir, à 50 cases : les foyers faisaient des allers-retours pour 1 ou 2 vivres à des étals presque vides, ou partaient au bois trop tard, et mouraient de faim. Sur la sauvegarde rejouée, la faim de ce fief passe de 167 à 16 jours-foyer par an. |
| Alerte (partie test n° 4) | « Les foyers de X vont chercher leurs vivres à N cases » quand c'est plus de 30 cases, avec « réserves du fief pleines » si c'est le cas. | Rendre visible le piège des réserves pleines dans un fief éloigné. |

**Ce que montre l'outil `simulate`** (village type, joueur qui offre le haut de l'estimation dès que son trésor le permet en gardant 200 or) : premier achat vers l'an 15, titre de baron vers l'an 16-18, deuxième achat vers l'an 22. Le joueur type n'utilise pas l'or ensuite : il en garde plus de 2000 à l'an 30. Un joueur qui offre au milieu de la fourchette achète plus tôt, au risque d'un refus.

### 4.6 J4b — Métiers et besoins

| Sujet | Règle | Raison |
|---|---|---|
| Nouvelles marchandises | Laine, outils, vêtements, remèdes (en plus de nourriture, bois, pierre). Elles se rangent dans les réserves comme les autres ; les remèdes restent chez le guérisseur. | Choix du joueur : besoins « outils » et « vêtements », plus la maladie. |
| Forge | 2 × 2 ; 30 bois, 20 pierre, 10 or ; 2 forgerons. Ses 2 porteurs vont chercher bois et pierre ; 1 bois + 1 pierre → 1 outil, 30 par an à plein effectif. | Donne un usage à la pierre et des emplois. |
| Bergerie | 3 × 2 ; 25 bois, 10 or ; 2 bergers. 40 laines par an à plein rendement, selon les prés libres (herbe sans champ, route ni bâtiment) à 3 cases. | Les prés deviennent une ressource. |
| Tisserand | 2 × 2 ; 20 bois, 10 pierre, 10 or ; 2 tisserands. 2 laines → 1 vêtement, 20 par an. | Une chaîne à deux étapes, lisible. |
| Guérisseur | 2 × 1 ; 15 bois, 5 pierre, 15 or ; 1 guérisseur. Prépare 20 remèdes par an avec les herbes de la forêt à 4 cases (gardés sur place, 20 au plus). | Choix du joueur : maladie et guérisseur. |
| Outils | Chaque travailleur en use 0,5 par an, pris dans les réserves sans porteur. Couverture (part des besoins servis, lissée sur 30 jours) : ateliers et fermes produisent jusqu'à +25 %. | Choix du joueur : les ateliers et fermes équipés produisent plus. |
| Vêtements | Chaque habitant en use 0,5 par an. Couverture d'au moins 60 % : moral +10 (« Bien vêtus ») ; la mortalité du froid baisse jusqu'à moitié. | Choix du joueur : moral +, moins de morts de froid. |
| Natalité | L'écart moyen entre deux naissances va de 2,5 ans (rien de satisfait) à 1,5 an (moral, vêtements et outils au plus haut ; le moral compte double). Remplace l'ancien effet du moral. La famille noble suit la même règle. | Choix du joueur : natalité selon le moral et les besoins. La population grandissait plus vite que les emplois. |
| Maladie | Pas avant l'an 4. Chaque jour, une épidémie peut se déclarer (15 % par an, +5 % par tranche de 100 habitants, 50 % au plus) autour d'une maison, dans un rayon de 10 cases, pour 40 jours. Chaque malade meurt avec 0,15 % de chances par jour (double avant 5 ans et après 60 ans), quatre fois moins s'il habite à 12 cases d'un guérisseur qui a un travailleur et des remèdes (1 remède pour 10 jours de soins d'un foyer). Alerte rouge pendant l'épidémie. | Choix du joueur. Pas de défaite par un seul tirage : environ 6 % des malades meurent sans soins. |
| Foire d'automne | Tout l'automne (et depuis le bilan) : achat et vente à prix fixes (nourriture 3 / 1 or, bois 2 / 1, pierre 3 / 1, laine 3 / 1, outils 8 / 4, vêtements 10 / 5), 80 unités de chaque marchandise par an et par sens. La partie se met en pause pendant la foire. | Choix du joueur : un usage de l'or au-delà des fiefs. |
| Interface | Panneau Village : outils, vêtements, laine, rythme des naissances, bouton Foire. Bouton « Foire d'automne » au bilan. Alertes : épidémie, manque d'outils ou de vêtements (à partir de 60 habitants). Barre d'outils sur deux lignes. Touches K forge, U bergerie, T tisserand, J guérisseur. | |
| Sauvegardes | Format v7. | Les vieilles parties restent jouables. |

**Ce que montre l'outil `simulate`** (joueur type qui ajoute forge, bergeries et tisserands à partir de 50 habitants) : la population passe d'environ 35 à 150-210 habitants en 30 ans (contre plus de 300 avant J4b), le chômage reste sous 30 personnes, une épidémie tue 0 à 10 personnes. Les ateliers manquent de bras tant que le village est petit : les outils arrivent vers l'an 6-15, les vêtements restent rares chez le joueur type (il construit trop de bergeries pour ses tisserands, la laine s'entasse).

## 5. Systèmes clés

### 5.1 Carte et caméra

- **Une seule carte continue**, découpée en fiefs (par exemple des carrés de 48 × 48 tuiles ; taille dans la config). Depuis J4 : 5 × 5 fiefs, ton fief au centre. La génération accepte n'importe quelle grille de fiefs (environ 5 × 5 pour une grande partie à 8).
- **Zoom à trois niveaux, qui change ce qui est affiché :**
  - **Proche :** tuiles, bâtiments, routes, porteurs.
  - **Moyen :** bâtiments simplifiés, frontières des fiefs bien marquées.
  - **Lointain = vue Monde :** chaque fief devient une zone colorée selon son propriétaire, avec son nom, son terrain dominant et des icônes (population, à vendre, plus tard alliances). C'est là que se font la diplomatie et les achats.
- **Navigation :** une liste de tes fiefs permet de sauter directement sur l'un d'eux (utile quand le domaine n'est plus d'un seul tenant, par exemple après un héritage lointain en V2). Un double-clic sur un fief en vue Monde zoome dessus.
- **Terrains dominants :** plaines fertiles, forêt, gisement de pierre, rivière. Chaque fief a un terrain dominant et un mélange secondaire, générés par la graine. Acheter devient un choix stratégique, pas seulement « + de surface ».
- **Construction :** uniquement sur ses propres fiefs. Les fiefs voisins sont visibles.
- **En multi :** les fiefs des autres joueurs sont affichés à partir d'un **instantané visuel** (bâtiments, routes, champs) envoyé à chaque barrière. On voit la ville des voisins grandir avec un an de décalage, sans simuler leurs fiefs chez soi.

### 5.2 Logistique par flux

Principe : les marchandises circulent vraiment sur les routes, avec un temps de trajet, mais aucun villageois ne « réfléchit » à chaque instant.

- **Le réseau de routes est un graphe.** Les itinéraires (bâtiment ↔ entrepôt, maison ↔ lieu de travail) sont calculés une fois, puis recalculés seulement quand une route est construite ou détruite.
- **Une livraison est un trajet planifié** : départ, durée (selon la longueur de l'itinéraire), quantité, capacité du porteur ou de la charrette. La simulation sait où en est chaque livraison sans la faire avancer tuile par tuile.
- **Ce que tu vois est ce qui est simulé.** L'affichage anime les porteurs le long des itinéraires à partir de ces trajets : de simples points en J2, de vrais porteurs et charrettes en J6.
- **Livré en J2a :** porteurs des ateliers et des fermes vers le manoir et les entrepôts. Chiffres et règles en section 4.2.
- **Trajet domicile-travail :** temps de marche calculé de la même façon, qui réduit le temps de travail effectif. Une maison éloignée de la ferme rend la ferme moins productive.
- **Effets de gameplay :** l'emplacement des entrepôts et des routes compte vraiment ; un village étalé est moins efficace ; les goulots d'étranglement se voient.
- **Commerce (V2) :** même principe à l'échelle du Monde, avec des convois entre fiefs (temps de trajet, capacité) et des accords commerciaux récurrents résolus à la barrière.
- **Ce que ce modèle ne fait pas :** pas d'embouteillages ni de collisions entre porteurs, pas de vie individuelle (aller à la taverne, flâner).
- **Outils de débogage (livrés en J2a) :** itinéraire du bâtiment sélectionné, itinéraires de tous les porteurs en route (touche L), état de chaque porteur dans le panneau de sélection, section Logistique (réserves, marchandises en attente, porteurs en route). Sans eux, « pourquoi personne ne livre ? » devient impossible à diagnostiquer.

### 5.3 Saisons et agriculture

- **1 an = 3 min**, donc environ 45 s par saison.
- **Le joueur ne gère pas les récoltes à la main.** Les fermes sèment, cultivent et récoltent seules selon la saison. Son rôle est stratégique : combien de champs, où, combien de stock pour l'hiver.
- **Calendrier (livré en J2a) :** labours et semailles au printemps, croissance en été, moisson à l'automne, aucune production agricole en hiver. Détails en section 4.2.
- **Chauffage (J2b) :** le bois de chauffage est consommé en hiver ; un foyer sans bois perd du moral et voit sa mortalité augmenter.
- **Lisibilité :** indicateurs permanents « réserves pour l'hiver : X jours » et « récolte prévue : Y ». Une alerte se déclenche dès l'été si la récolte prévue ne couvrira pas l'hiver : il reste alors une saison et demie pour réagir.
- **Bilan d'automne :** la barrière annuelle tombe à la fin de l'automne. C'est une pause naturelle chaque année pour planifier la suivante. En solo, une pause automatique au bilan est activée par défaut (désactivable).
- **Événements (V2) :** rares (environ un tous les 2 à 3 ans), annoncés une saison à l'avance quand c'est crédible (« un été sec s'annonce »). Les choix associés se font pendant le bilan d'automne : aucune décision ne se joue en temps réel, ce qui règle aussi le cas du multi, où il n'y a pas de pause.

### 5.4 Fin de partie, prestige et titres

- **Prestige :** score calculé à partir du domaine, de la population, de la richesse, de l'ancienneté de la lignée et des titres. Affiché en permanence et repris dans la chronique.
- **Titres (solo et multi) :** débloqués par la taille du domaine, par exemple seigneur → baron → comte. Seuils dans la config.
- **Durées de partie multi** (à 3 min par an) : 30 ans ≈ 1 h 30 ; 60 ans ≈ 3 h ; 100 ans ≈ 5 h, donc sur plusieurs soirées grâce à la sauvegarde de la salle.

### 5.5 Placement

- Routes obligatoires pour relier un bâtiment au manoir et à l'entrepôt. Ce réseau est le même graphe que celui de la logistique (5.2).
- Tailles variables, par exemple : maison 1 × 1, ferme 2 × 2, manoir 3 × 3.
- Champs peints par le joueur autour de la ferme. Le rendement dépend de la fertilité de chaque tuile.
- Pas de rotation des bâtiments en V1.

---

## 6. Risques identifiés

| # | Risque | Gravité | Parade |
|---|---|---|---|
| 1 | **Périmètre :** trois jeux en un (city-builder, dynastie, diplomatie et guerre). | Élevée | Tranche verticale stricte, un jalon à la fois, toute nouvelle idée passe d'abord par la ROADMAP. |
| 2 | **Équilibrage économique :** spirales de mort, ou économie trop facile. | Élevée | Outil `simulate` (100 ans de jeu simulés sans affichage, courbes en CSV). Tous les chiffres dans la config. |
| 3 | **Fin de partie creuse en solo.** | Élevée | Titres, prestige, pression sur l'espace, successions qui rebattent les cartes. |
| 4 | **Dérive du code en vibe coding.** | Élevée | DESIGN.md et ROADMAP.md relus à chaque session, TypeScript strict, tests sur la simulation, petits modules. |
| 5 | **Logistique opaque :** bugs du type « pourquoi personne ne livre ? ». | Moyenne | Outils de débogage (itinéraires, livraisons en cours) livrés en même temps que la logistique. |
| 6 | **Désaccord entre fief et monde en multi** (un joueur dépense l'or qu'il a promis). | Moyenne | Séquestre dès la proposition, résolution dans un ordre déterministe, égalités départagées par la graine. |
| 7 | **Transfert d'un fief entre deux joueurs.** | Moyenne | Message `FiefSnapshot` à la barrière ; format de fief autonome dès J1. |
| 8 | **Organisation du multi synchrone.** | Moyenne | Durée de partie choisie, salle sauvegardée, délai d'attente maximal à la barrière. |
| 9 | **Sauvegardes cassées** à chaque évolution du format. | Moyenne | Numéro de version et migrations dès J1. |
| 10 | **Triche** (chaque joueur simule son fief). | Faible (entre amis) | Assumé. Le serveur vérifie seulement la cohérence des transactions. |
| 11 | **Phaser 4 récent :** erreurs d'API possibles. | Faible | Vérification dans la documentation de Phaser 4 ; rendu isolé dans `client/src/render`. |
| — | ~~Changement tardif de perspective~~ | Résolu | Vue 3/4 actée (Q7). |
| — | ~~Dynastie peu ressentie~~ | Atténué | 3 min par an (Q1). |

---

## 7. Architecture : couches Fief et Monde

### 7.1 Schéma

```
┌──────────────────────────────────────────────────────────────┐
│ RENDU · Phaser 4                                [navigateur] │
│ scènes, interface, souris et clavier                         │
└──────────────────────────────────────────────────────────────┘
        │ commandes                     ▲ lecture seule de l'état
        │ (construire, démolir…)        │
        ▼                               │
┌──────────────────────────────────────────────────────────────┐
│ COUCHE FIEF · TypeScript pur                    [navigateur] │
│ bâtiments, routes, livraisons, ressources, population,       │
│ saisons, famille seigneuriale                                │
└──────────────────────────────────────────────────────────────┘
        │ ProposeAction, FiefSummary    ▲ WorldEvent,
        │ Ready, FiefSnapshot           │ YearResolved
        ▼                               │
┌──────────────────────────────────────────────────────────────┐
│ PASSERELLE MONDE                                [navigateur] │
│ solo  : LocalWorld  → appel direct                           │
│ multi : RemoteWorld → WebSocket                              │
└──────────────────────────────────────────────────────────────┘
        │                               ▲
        ▼                               │
┌──────────────────────────────────────────────────────────────┐
│ COUCHE MONDE · TypeScript pur, même code partout             │
│ propriété des fiefs, frontières, relations,                  │
│ transactions, séquestre, IA voisines, barrière annuelle      │
│                                                              │
│ solo  : exécutée dans le navigateur                          │
│ multi : Durable Object « salle de partie » (Cloudflare)      │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Ce qui transite entre les couches

| Message | Sens | Quand | Contenu |
|---|---|---|---|
| `ProposeAction` | Fief → Monde | Pendant l'année | Offre d'achat (fief visé, prix proposé). Plus tard : mariage, guerre, accord commercial. L'or engagé passe sous séquestre. |
| `FiefSummary` | Fief → Monde | À la barrière | Chiffres publics : population, richesse visible, nombre de fiefs, état de la lignée, prestige. Jamais l'état complet. |
| `NeighborView` | Fief → Monde → autres joueurs | À la barrière (multi) | Instantané visuel public : bâtiments, routes, champs. Sert uniquement à l'affichage. |
| `Ready` | Fief → Monde | À la barrière | Le joueur a terminé son année. |
| `FiefSnapshot` | Fief → Monde → Fief | À la barrière, si un fief change de propriétaire | État détaillé du fief cédé : tuiles, bâtiments, habitants. |
| `WorldEvent` | Monde → Fief | À la barrière | Résultats : offre acceptée ou refusée, fief gagné ou perdu, paiement reçu, séquestre libéré, décès d'un seigneur voisin, joueur éliminé. |
| `YearResolved` | Monde → Fief | Fin de la barrière | L'année suivante peut commencer. |

### 7.3 Déroulé de la barrière annuelle

1. **Fin de l'automne :** chaque fief se met en pause (bilan d'automne).
2. Chaque client envoie `FiefSummary` + `Ready`, plus `NeighborView` en multi et un `FiefSnapshot` si nécessaire.
3. Quand tous les joueurs sont prêts, ou après un délai maximal (par exemple 60 s pour un joueur absent), le Monde résout tout dans un ordre fixe : transactions, puis IA voisines, puis éliminations.
4. Le Monde envoie les `WorldEvent` et le `YearResolved`. Chaque fief les applique, et l'hiver commence.

En solo, c'est exactement le même code, exécuté instantanément dans le navigateur.

### 7.4 Règles d'or

- La couche Fief ne lit jamais directement l'état du Monde, et le Monde ne lit jamais l'état complet d'un fief : uniquement des messages.
- Le rendu Phaser lit l'état mais ne le modifie jamais : il envoie des commandes.
- Aucun `Math.random()` dans la simulation : uniquement le générateur à graine.
- Aucune fonction mathématique dont la précision varie selon le navigateur (`Math.sin`, `Math.log`, `Math.exp`, `Math.pow`…) dans la simulation : additions, multiplications, `Math.floor`, `Math.imul` et `Math.sqrt` seulement. Sinon deux joueurs pourraient obtenir des résultats différents.
- Aucun import de Phaser dans `sim-fief`, `sim-monde` ou `server`.

---

## 8. Arborescence du projet

Un seul dépôt, découpé en plusieurs « paquets ». `sim-monde` est importé à la fois par le client et par le serveur : aucune logique n'est dupliquée.

```
jeu-medieval/
├─ CLAUDE.md                  ← consignes pour chaque nouvelle session de Claude
├─ DESIGN.md                  ← ce document
├─ ROADMAP.md                 ← fait / en cours / à faire
├─ README.md                  ← installer, lancer, tester, publier
├─ package.json               ← paquets (npm workspaces) et commandes
├─ tsconfig.base.json         ← réglages TypeScript stricts communs
├─ vitest.config.ts           ← tests automatiques
│
├─ packages/
│  ├─ data/                   ← équilibrage, modifiable sans toucher au code
│  │  ├─ world.json           ← taille et grille des fiefs, conditions de départ
│  │  ├─ terrains.json        ← terrains dominants, part de forêt et de roche, fertilité
│  │  ├─ buildings.json       ← bâtiments : taille, coût, exigences de terrain
│  │  ├─ economy.json         ← ressources de départ, coût des routes, remboursement
│  │  ├─ seasons.json         ← durée d'une année, saisons
│  │  ├─ logistics.json       ← vitesse des porteurs, attente avant charge partielle
│  │  ├─ demography.json      ← départ, âges, naissances, mortalité, consommation, moral
│  │  └─ names.json           ← noms des fiefs et prénoms
│  │     (à venir : titles.json)
│  │
│  ├─ shared/                 ← outils communs aux deux couches
│  │  └─ src/
│  │     ├─ rng.ts            ← générateur aléatoire à graine
│  │     ├─ noise.ts          ← bruit déterministe (forêts, roches, fertilité)
│  │     ├─ terrain.ts        ← génération du terrain d'un fief
│  │     ├─ messages.ts       ← messages Fief ↔ Monde (section 7.2)
│  │     ├─ types.ts          ← ressources, terrains, identifiants
│  │     └─ index.ts          ← + numéro de version des sauvegardes
│  │
│  ├─ sim-fief/               ← couche Fief, TypeScript pur (aucun Phaser)
│  │  ├─ src/
│  │  │  ├─ state.ts          ← état complet du domaine (JSON)
│  │  │  ├─ commands.ts       ← construire, tracer une route, peindre un champ, démolir
│  │  │  ├─ domain.ts         ← DomainSim : règles de placement, temps, barrière
│  │  │  ├─ data.ts           ← lecture typée des fichiers de data/
│  │  │  └─ systems/
│  │  │     ├─ seasons.ts     ← calendrier (ticks → année, saison, jour)
│  │  │     ├─ roads.ts       ← réseau relié au manoir, plus courts chemins
│  │  │     ├─ economy.ts     ← réserves, production, agriculture, porteurs, marché
│  │  │     ├─ population.ts  ← villageois, foyers, emplois, provisions, moral, impôts
│  │  │     ├─ dynasty.ts     ← lignée : succession, régence, affaires de famille, prestige, chronique
│  │  │     └─ annex.ts       ← fief acheté : terrain et village reconstruit
│  │  └─ test/                ← tests automatiques
│  │
│  ├─ sim-monde/              ← couche Monde, partagée client/serveur
│  │  ├─ src/
│  │  │  ├─ state.ts          ← fiefs, seigneurs, année
│  │  │  ├─ worldgen.ts       ← création du monde à partir d'une graine
│  │  │  ├─ barrier.ts        ← barrière annuelle : achats de fiefs, villages voisins
│  │  │  ├─ fiefs.ts          ← valeur des fiefs, prix plancher, villages des voisins
│  │  │  └─ ai/neighbors.ts   ← voisins IA (passifs en V1)
│  │  └─ test/
│  │
│  ├─ client/                 ← le jeu affiché : Phaser 4 + Vite
│  │  ├─ index.html
│  │  ├─ src/
│  │  │  ├─ main.ts           ← démarrage
│  │  │  ├─ game/             ← Session (partie + temps réel), Game (outil actif, sélection)
│  │  │  ├─ scenes/           ← MapScene : dessin de la carte
│  │  │  ├─ camera/           ← zoom à trois niveaux, souris et clavier
│  │  │  ├─ render/           ← couleurs et sol (aucune règle de jeu)
│  │  │  ├─ ui/               ← interface : bandeau, outils, panneau, fenêtres
│  │  │  ├─ world-gateway/    ← LocalWorld (solo) ; RemoteWorld en J5
│  │  │  ├─ telemetry/        ← journal de partie (base de l'artefact claude.ai)
│  │  │  └─ save/             ← format de sauvegarde, migrations, emplacements
│  │  └─ test/                ← sauvegarde et déterminisme
│  │
│  └─ server/                 ← à partir de J5 : Cloudflare Worker + Durable Object
│
└─ tools/
   ├─ artifact.mjs            ← prépare la version publiable du jeu
   ├─ lignee.ts               ← extinctions de la lignée selon la loi et les mariages → CSV
   └─ simulate.ts             ← N années d'un village type sans affichage → CSV
```

**Outils :** Vitest (tests), tsx (scripts TypeScript), Vite + vite-plugin-singlefile (jeu en un seul fichier HTML). Wrangler (déploiement Cloudflare) à partir de J5.

---

## 9. Questions reportées

- ~~Avant J3 (dynastie) : ordre de succession, régence, choix du conjoint~~ : tranchés le 15/11 (section 4.4).
- **Après la partie test de J3 :**
  - Donner une contrepartie à la loi masculine seule (prestige ?) pour en faire un vrai pari ?
  - Fécondité de la famille noble : la même que le village (8 à 12 enfants par couple), ou plus faible ?
  - Une décision par défaut pour les cadets (Église au bout d'un an ?) si les affaires de famille deviennent trop nombreuses.
  - Prénoms : médiévaux français pour l'instant (`names.json`) ; flamands ou autres à décider avec l'univers.
- ~~Avant J4 : prix d'un fief, acceptation par l'IA, fief vide ou avec village, simulation des fiefs IA~~ : tranchés le 16/11 (section 4.5).
- **Après la partie test de J4 :**
  - Voir le village d'un voisin sur la carte avant de l'acheter (instantané visuel).
  - D'autres usages de l'or (après un premier achat, il s'accumule de nouveau).
- **Avant J6 (graphismes) :**
  - Taille des tuiles (32 px ? 48 px ?) et style graphique.
- **Général :**
  - Titre du jeu.
  - Univers : historique réaliste (quelle époque, quelle région ?) ou monde fictif d'inspiration médiévale ?
  - Langue de l'interface.

---

## 10. Glossaire

- **Domaine :** l'ensemble des fiefs possédés par une lignée.
- **Fief :** une parcelle de la carte ; unité d'achat, d'héritage et de conquête.
- **Lignée (ou dynastie) :** tous les descendants du fondateur.
- **Commande :** instruction envoyée par l'interface à la simulation (par exemple « construire une ferme ici »).
- **Barrière annuelle :** le rendez-vous de fin d'automne où la couche Monde résout toutes les actions diplomatiques en même temps.
- **Bilan d'automne :** la pause annuelle côté joueur, qui coïncide avec la barrière.
- **Livraison :** trajet planifié d'une quantité de marchandise sur un itinéraire du réseau de routes.
- **Séquestre :** ressources bloquées tant qu'une proposition n'est pas résolue.
- **Prestige :** score de réussite d'une lignée, en solo comme en multi.

---

## 11. Journal des décisions

| Date | Décision | Raison |
|---|---|---|
| 12/11/2026 | Brief initial validé : vision, piliers, conditions de défaite, architecture en deux couches, périmètre V1, feuille de route. | Brief fondateur. |
| 12/11/2026 | Seuil de défaite : 5 habitants, sur le domaine entier. | Choix du brief ; précision « domaine entier » ajoutée. |
| 12/11/2026 | Q1 : 1 an = 3 min (au lieu de 5). | 5 min par an donnait 2 h à 3 h 20 par génération. |
| 12/11/2026 | Q2 : carte continue + zoom à trois niveaux + vue Monde + terrains dominants. | Choix « mix A + B » ; interprétation à valider. |
| 12/11/2026 | Q3 : solo bac à sable + titres ; multi durée fixe + prestige + salle sauvegardable ; joueur éliminé → terre libre (branche cadette en option). | Recommandations validées. |
| 12/11/2026 | Q4 : plafond 8 joueurs, équilibrage pour 2 à 4. | Recommandation validée ; corrige l'incohérence 4/8 de la feuille de route. |
| 12/11/2026 | Q5 : individus « fiches » + logistique par flux. | Souhait de se rapprocher de l'option A ; entre-deux à valider. |
| 12/11/2026 | Q6 : routes obligatoires, tailles variables, champs peints, pas de rotation. | Recommandation validée. |
| 12/11/2026 | Q7 : vue de dessus 3/4. | Recommandation validée. |
| 12/11/2026 | Q8 : saisons option C (calendrier agricole en J2, événements en V2), avec bilan d'automne et récoltes automatiques. | Saisons de 45 s gérables si le joueur planifie au lieu de micro-gérer. |
| 12/11/2026 | Q2 et Q5 validés : carte continue à trois niveaux de zoom ; logistique par flux. | Confirmation du joueur. |
| 12/11/2026 | J1 livré : carte, placement, saisons, barrière annuelle (vide), sauvegarde. Règles complémentaires en section 4. | Premier jalon jouable. |
| 14/11/2026 | J2a livré : réserves physiques, porteurs, production, semailles et moisson. Chauffage reporté en J2b. Règles en section 4.2. | Deuxième jalon jouable. |
| 15/11/2026 | Journal de partie ajouté à la page publiée, lu par Claude pour analyser les parties de test. | Demande du joueur : suivre ses parties et en tirer des conclusions. |
| 15/11/2026 | Retours de la première partie test : fiche d'outil, avertissement des champs en trop, reprise automatique, bilan sur quatre saisons. | Analyse du journal de partie et retours du joueur. |
| 15/11/2026 | J2b : 20 adultes et leurs enfants au départ, naissances tous les 1,5 an par famille, emplois automatiques réglables, foyers qui se ravitaillent eux-mêmes, moral simple. Règles en section 4.3. | Choix du joueur (questions du 15/11), équilibrage avec `simulate`. |
| 16/11/2026 | J4b, intercalé avant le multi : besoins outils et vêtements (forge, bergerie, tisserand), maladie et guérisseur, natalité selon le moral et les besoins, foire d'automne. Règles en section 4.6. | Partie test n° 4 : chômage massif et ennui en fin de partie ; choix du joueur (questions du 16/11). |
| 16/11/2026 | Partie test n° 4 (orge-349 en 5 × 5, 25 ans, environ 45 min) : église par fief, routes en or et pierre, correction du ravitaillement entre fiefs, alerte de vivres lointains. Chômage et ennui de fin de partie notés pour la suite. | Retours du joueur et analyse du journal. |
| 16/11/2026 | J4 : carte 5 × 5, fiefs achetés avec leur village et une maison forte, négociation avec prix plancher secret, titres par fiefs et population. Règles en section 4.5. | Choix du joueur (questions du 16/11). |
| 16/11/2026 | Partie test n° 3 (chêne-832, 13 ans, 33 min) : famille noble servie dans toutes les réserves ; alertes de déficit de nourriture et de bras inoccupés. | Analyse du journal de partie. |
| 15/11/2026 | J3 : trois lois de succession au choix, modifiables par décret appliqué un an plus tard ; conjoint choisi parmi 3 prétendants ; régence avec moral −10 ; avenir des cadets décidé par le joueur (mariage au domaine, Église, alliance). Règles en section 4.4. | Choix du joueur (questions du 15/11). |
| 15/11/2026 | Nouveaux venus : une famille par an au plus (réglable : fermé, normal, ouvert), s'il reste une maison libre que personne n'attend, 120 jours de vivres et un moral d'au moins 50. Corrections d'interface : maison vide expliquée, bâtiment sans travailleur nommé, journal écrit seulement une fois la partie jouée. | Partie test n° 2 (orge-349, ans 3 à 7) : milieu de partie vide, maisons vides, surplus de nourriture sans usage. Validé par le joueur. |
