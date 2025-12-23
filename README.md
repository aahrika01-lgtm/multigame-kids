# MultiGame Kids — Prototype

Prototype “produit fini” d’une compilation **4 jeux classiques** dans une interface type **écran de caméra/jouet pour enfant**.  
Pour l’instant : **Jeu 1 = Casse-briques** (jouable).

## Lancer le jeu (le plus simple)

### Option A — avec Python (recommandé)
Dans un terminal ouvert dans le dossier du projet :

- `python -m http.server 8000`

Ensuite ouvre :
- `http://localhost:8000/index.html`

### Option B — si tu as Node.js
- `npx http-server -p 8000`

Puis :
- `http://localhost:8000/index.html`

> Remarque : certains navigateurs limitent l’audio si tu ouvres en `file://`. Via un petit serveur local, tout marche mieux.

## Contrôles (enfant-friendly)

### Menu
- Souris/tactile : clique sur **Casse-briques**
- Clavier : `Entrée` ou `Espace` pour jouer

### En jeu
- Clavier : `◀` / `▶` = bouger la raquette
- `Espace` ou `Entrée` = **GO** (lancer la balle)
- `P` = pause
- `Échap` = pause

### Tactile / tablette
- Glisser sur l’écran = bouger la raquette
- Boutons géants : `◀`, `GO`, `▶`

## Gameplay

- **Vies** (3), **Score**, **Combo** (x1 → x12)
- **Pause**, **Fin de partie**, **Victoire**
- **5 niveaux** progressifs (doux, pas punitifs)
- **Power-ups** (icônes qui tombent) :
  - `↔` = raquette plus grande (durée limitée)
  - `●●` = multi-balles
  - `🐢` = balle plus lente (durée limitée)
  - `★` = gros bonus de points

## Structure des fichiers

- [`index.html`](index.html:1) — UI “caméra enfant”, menu 4 jeux, zone Canvas + overlay
- [`styles.css`](styles.css:1) — direction artistique (formes rondes, couleurs vives, gros boutons)
- [`js/app.js`](js/app.js:1) — navigation menu ↔ jeu, pause/overlay, bouton son
- [`js/brickbreaker.js`](js/brickbreaker.js:1) — moteur du casse-briques (Canvas)
- [`js/audio.js`](js/audio.js:1) — effets sonores WebAudio (sans assets)

## Notes “produit enfant”

- Textes courts
- Feedback visuel + sons “jouet”
- Continuer après une perte de balle (pas trop dur)
- Angles de rebond “safe” (évite la balle trop horizontale)