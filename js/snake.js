/* js/snake.js
   Mini-jeu Snake (vue du dessus) pour MultiGame Kids.
   - Contrôles : flèches + ZQSD (AZERTY) + WASD + swipe sur mobile.
   - Gameplay : récupère des boules rouges, le serpent grandit, score + vitesse progressive.
   - Défaite : collision murs (si wallMode) + collision avec soi-même.
   - Visuel : tête distincte avec yeux + langue bifide bien visible (sort brièvement).
*/
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const randInt = (a, b) => (a + Math.floor(Math.random() * (b - a + 1)));
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function keyToDir(key) {
    const k = String(key || "").toLowerCase();
    if (k === "arrowup" || k === "z" || k === "w") return { dx: 0, dy: -1 };
    if (k === "arrowdown" || k === "s") return { dx: 0, dy: 1 };
    if (k === "arrowleft" || k === "q" || k === "a") return { dx: -1, dy: 0 };
    if (k === "arrowright" || k === "d") return { dx: 1, dy: 0 };
    return null;
  }

  class SnakeGame {
    constructor(opts) {
      this.opts = opts || {};
      this.canvas = this.opts.canvas;
      this.ctx = this.canvas.getContext("2d");

      this.hud = this.opts.hud || {};
      this.onShowOverlay = this.opts.onShowOverlay || (() => {});
      this.onHideOverlay = this.opts.onHideOverlay || (() => {});
      this.onBackToMenu = this.opts.onBackToMenu || (() => {});
      this.isActive = this.opts.isActive || (() => true);

      this.baseW = Number(this.canvas.getAttribute("width")) || 900;
      this.baseH = Number(this.canvas.getAttribute("height")) || 540;

      this.dpr = 1;
      this._setupCanvasDpr();

      this._running = false;
      this._lastTs = 0;

      // État
      this.state = "menu"; // menu, ready, playing, gameOver
      this.paused = false;

      // Paramètres Snake
      this.cell = 24; // sera recalculé selon canvas
      this.grid = { cols: 0, rows: 0, offX: 0, offY: 0, w: 0, h: 0 };

      // Mode mur : ON = toucher bords => défaite ; OFF = wrap
      this.wallMode = true;

      // Snake
      this.snake = []; // [{x,y}]
      this.dir = { dx: 1, dy: 0 };
      this.nextDir = { dx: 1, dy: 0 };
      this.dirQueue = [];

      this.food = { x: 0, y: 0 };
      this.score = 0;
      this.eaten = 0;

      this.baseIntervalMs = 150;
      this.intervalMs = this.baseIntervalMs;
      this.minIntervalMs = 70;
      this.accMs = 0;

      // Petite "grâce" après GO pour éviter les morts instantanées (mur ON)
      this.startDelayRemainingMs = 0;

      // UX: ne commence à avancer qu'après la 1ère direction (évite la mort rapide si on hésite)
      this.waitingForFirstInput = false;

      // Animation / head features
      this._lastStepAt = nowMs();
      this.tongueTime = 0; // secondes depuis dernier pas
      this.tonguePulseEvery = 0.55; // rythme d'animation
      this.tongueVisibleFor = 0.16;

      // Touch swipe
      this.touch = { down: false, sx: 0, sy: 0, t0: 0 };

      this._recalcGrid();
      this._bindInput();
      this._updateHud();
    }

    _setupCanvasDpr() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      if (this.dpr === dpr) return;
      this.dpr = dpr;

      this.canvas.width = Math.round(this.baseW * this.dpr);
      this.canvas.height = Math.round(this.baseH * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
    }

    _recalcGrid() {
      // Ajuste la taille de cellule pour que la grille rentre bien, sans être minuscule.
      const desired = 24;
      const maxCols = Math.floor(this.baseW / desired);
      const maxRows = Math.floor(this.baseH / desired);

      // On réserve une marge pour le style (visuel kids)
      const cols = clamp(maxCols - 2, 18, 32);
      const rows = clamp(maxRows - 2, 12, 22);

      const cellW = Math.floor(this.baseW / cols);
      const cellH = Math.floor(this.baseH / rows);
      const cell = clamp(Math.min(cellW, cellH), 18, 30);

      const gridW = cols * cell;
      const gridH = rows * cell;
      const offX = Math.floor((this.baseW - gridW) / 2);
      const offY = Math.floor((this.baseH - gridH) / 2);

      this.cell = cell;
      this.grid = { cols, rows, offX, offY, w: gridW, h: gridH };
    }

    start() {
      if (this._running) return;
      this._running = true;
      this.state = "menu";

      const loop = (ts) => {
        if (!this._running) return;
        const dt = clamp((ts - (this._lastTs || ts)) / 1000, 0, 1 / 20);
        this._lastTs = ts;

        this._setupCanvasDpr();
        this._recalcGrid();

        if (!this.paused) this._update(dt);
        this._render(dt);

        requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
    }

    stop() {
      this._running = false;
    }

    isPaused() {
      return !!this.paused;
    }

    pause(on) {
      this.paused = !!on;
    }

    toggleWallMode() {
      this.wallMode = !this.wallMode;
      this._updateHud();
    }

    resetAndStart() {
      this.score = 0;
      this.eaten = 0;
      this.baseIntervalMs = 150;
      this.intervalMs = this.baseIntervalMs;
      this.accMs = 0;
      this.startDelayRemainingMs = 0;
      this.waitingForFirstInput = false;

      this.dir = { dx: 1, dy: 0 };
      this.nextDir = { dx: 1, dy: 0 };
      this.dirQueue.length = 0;

      const midX = (this.grid.cols / 2) | 0;
      const midY = (this.grid.rows / 2) | 0;

      this.snake = [
        { x: midX - 2, y: midY },
        { x: midX - 1, y: midY },
        { x: midX, y: midY },
        { x: midX + 1, y: midY }, // tête à droite
      ];

      this._spawnFood();

      this.state = "ready";
      this.paused = false;
      this._lastStepAt = nowMs();
      this.tongueTime = 0;

      this._updateHud();
    }

    launch() {
      if (this.paused) return;
      if (this.state === "ready") {
        this.state = "playing";
        this.accMs = 0;

        // Start moving only after the first direction input (kid-friendly)
        this.startDelayRemainingMs = 0;
        this.waitingForFirstInput = true;

        this._lastStepAt = nowMs();
        this.onHideOverlay();
      }
    }

    setDirection(dx, dy) {
      // Ignore when not active / not in gameplay
      if (!this.isActive()) return;
      if (this.state !== "ready" && this.state !== "playing") return;

      const nd = { dx: clamp(dx | 0, -1, 1), dy: clamp(dy | 0, -1, 1) };
      if (nd.dx === 0 && nd.dy === 0) return;
      if (nd.dx !== 0 && nd.dy !== 0) return; // pas de diagonale

      // Empêche l'inversion directe
      const last = this.dirQueue.length ? this.dirQueue[this.dirQueue.length - 1] : this.nextDir;
      if (last.dx === -nd.dx && last.dy === -nd.dy) return;

      // First input after GO arms the movement
      if (this.state === "playing" && this.waitingForFirstInput) {
        this.waitingForFirstInput = false;
        this.accMs = 0;
        this._lastStepAt = nowMs();
      }

      // Petite queue d'input pour un contrôle fluide
      this.dirQueue.push(nd);
      if (this.dirQueue.length > 3) this.dirQueue.shift();
    }

    _bindInput() {
      const rectOf = () => this.canvas.getBoundingClientRect();
      const toClient = (e) => ({ x: e.clientX, y: e.clientY });

      const onKeyDown = (e) => {
        if (!this.isActive()) return;

        // Mode mur toggle
        if (String(e.key || "").toLowerCase() === "m") {
          e.preventDefault();
          this.toggleWallMode();
          return;
        }

        const d = keyToDir(e.key);
        if (!d) return;

        // Évite que la page scroll quand on joue
        if (this.state === "ready" || this.state === "playing") e.preventDefault();

        this.setDirection(d.dx, d.dy);
      };

      window.addEventListener("keydown", onKeyDown);

      const pointerDown = (e) => {
        if (!this.isActive()) return;
        if (window.AudioKit) window.AudioKit.unlock();

        const p = toClient(e);
        this.touch.down = true;
        this.touch.sx = p.x;
        this.touch.sy = p.y;
        this.touch.t0 = nowMs();

        // Tap pour lancer (simple)
        if (this.state === "ready") this.launch();
      };

      const pointerUp = (e) => {
        if (!this.isActive()) return;
        if (!this.touch.down) return;
        this.touch.down = false;

        const p = toClient(e);
        const dx = p.x - this.touch.sx;
        const dy = p.y - this.touch.sy;

        const r = rectOf();
        const scale = Math.max(1, Math.min(r.width, r.height) / 320);
        const threshold = 18 * scale;

        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

        if (Math.abs(dx) > Math.abs(dy)) {
          this.setDirection(dx > 0 ? 1 : -1, 0);
        } else {
          this.setDirection(0, dy > 0 ? 1 : -1);
        }
      };

      this.canvas.addEventListener("pointerdown", pointerDown, { passive: true });
      this.canvas.addEventListener("pointerup", pointerUp, { passive: true });
      this.canvas.addEventListener("pointercancel", () => (this.touch.down = false), { passive: true });

      window.addEventListener("resize", () => this._setupCanvasDpr());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && (this.state === "ready" || this.state === "playing")) this.pause(true);
      });
    }

    _spawnFood() {
      const occ = new Set(this.snake.map((s) => `${s.x},${s.y}`));
      for (let tries = 0; tries < 500; tries++) {
        const x = randInt(0, this.grid.cols - 1);
        const y = randInt(0, this.grid.rows - 1);
        const key = `${x},${y}`;
        if (occ.has(key)) continue;
        this.food.x = x;
        this.food.y = y;
        return;
      }

      // Fallback : si la grille est pleine, on place "à côté" (rare)
      this.food.x = 0;
      this.food.y = 0;
    }

    _speedUp() {
      // Accélération progressive à chaque boule
      const newInterval = this.baseIntervalMs - this.eaten * 4;
      this.intervalMs = clamp(newInterval, this.minIntervalMs, this.baseIntervalMs);
    }

    _updateHud() {
      if (this.hud.score) this.hud.score.textContent = String(this.score);

      // Réutilise les autres champs du HUD pour infos utiles (sans casser le layout)
      if (this.hud.level) this.hud.level.textContent = String(1 + (this.eaten / 3) | 0); // "vitesse"
      if (this.hud.lives) this.hud.lives.textContent = this.wallMode ? "ON" : "OFF"; // Mode mur
      if (this.hud.combo) this.hud.combo.textContent = String(this.snake.length); // longueur
    }

    _applyQueuedDir() {
      if (!this.dirQueue.length) return;

      const nd = this.dirQueue.shift();
      // Empêche inversion par rapport à direction actuelle réelle
      if (nd.dx === -this.dir.dx && nd.dy === -this.dir.dy) return;

      this.nextDir = nd;
    }

    _step() {
      if (this.state !== "playing") return;

      this._applyQueuedDir();
      this.dir = this.nextDir;

      const head = this.snake[this.snake.length - 1];
      let nx = head.x + this.dir.dx;
      let ny = head.y + this.dir.dy;

      // Bords
      if (this.wallMode) {
        if (nx < 0 || nx >= this.grid.cols || ny < 0 || ny >= this.grid.rows) {
          this._gameOver();
          return;
        }
      } else {
        // Wrap
        if (nx < 0) nx = this.grid.cols - 1;
        if (nx >= this.grid.cols) nx = 0;
        if (ny < 0) ny = this.grid.rows - 1;
        if (ny >= this.grid.rows) ny = 0;
      }

      // Collision avec soi-même (classique)
      const occ = new Set(this.snake.map((s) => `${s.x},${s.y}`));
      const nextKey = `${nx},${ny}`;
      // Autorise le déplacement sur la dernière case de la queue (si on ne grandit pas)
      const tail = this.snake[0];
      const tailKey = `${tail.x},${tail.y}`;
      const willEat = nx === this.food.x && ny === this.food.y;

      if (occ.has(nextKey) && (willEat || nextKey !== tailKey)) {
        this._gameOver();
        return;
      }

      // Avance
      this.snake.push({ x: nx, y: ny });

      if (willEat) {
        this.score += 1;
        this.eaten += 1;
        if (window.AudioKit) window.AudioKit.powerUp();

        this._speedUp();
        this._spawnFood();
      } else {
        this.snake.shift(); // garde la taille
      }

      this._lastStepAt = nowMs();
      this.tongueTime = 0;
      this._updateHud();
    }

    _gameOver() {
      this.state = "gameOver";
      this.paused = true;
      if (window.AudioKit) window.AudioKit.lose();

      const score = this.score;
      this.onShowOverlay({
        title: "Perdu !",
        text: "Score : " + score,
        tiny: "Flèches / ZQSD — Swipe — M = mode mur (" + (this.wallMode ? "ON" : "OFF") + ")",
        primaryText: "Rejouer",
        secondaryText: "Menu",
        onPrimary: () => {
          this.onHideOverlay();
          this.paused = false;
          this.resetAndStart();
          this.paused = true;
          this.onShowOverlay({
            title: "Prêt ?",
            text: "Attrape les boules rouges !",
            tiny: "Espace / Entrée / Tape = GO — M = mur (" + (this.wallMode ? "ON" : "OFF") + ")",
            primaryText: "GO !",
            secondaryText: "Menu",
            onPrimary: () => { this.paused = false; this.onHideOverlay(); this.launch(); },
            onSecondary: () => { this.pause(true); this.onBackToMenu(); },
          });
        },
        onSecondary: () => {
          this.pause(true);
          this.onBackToMenu();
        },
      });
    }

    _update(dt) {
      if (!this.isActive()) return;
      if (this.state !== "ready" && this.state !== "playing" && this.state !== "gameOver") return;

      // Clignotement langue (si on ne bouge pas, on pulse quand même un peu)
      this.tongueTime += dt;

      if (this.state !== "playing") return;

      // Wait for first direction after GO (prevents instant wall deaths)
      if (this.waitingForFirstInput) return;

      // Grace period right after GO
      if (this.startDelayRemainingMs > 0) {
        this.startDelayRemainingMs = Math.max(0, this.startDelayRemainingMs - dt * 1000);
        return;
      }

      this.accMs += dt * 1000;
      while (this.accMs >= this.intervalMs) {
        this.accMs -= this.intervalMs;
        this._step();
        if (this.state !== "playing") break;
      }
    }

    _renderGrid(ctx) {
      const { offX, offY, cols, rows } = this.grid;
      const cs = this.cell;

      // Fond
      const bg = ctx.createLinearGradient(0, offY, 0, offY + rows * cs);
      bg.addColorStop(0, "rgba(12,18,48,0.85)");
      bg.addColorStop(1, "rgba(6,10,28,0.92)");
      ctx.fillStyle = bg;
      roundRect(ctx, offX - 10, offY - 10, cols * cs + 20, rows * cs + 20, 22);
      ctx.fill();

      // Grille subtile
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "rgba(255,255,255,.16)";
      ctx.lineWidth = 1;

      for (let x = 0; x <= cols; x++) {
        const xx = offX + x * cs + 0.5;
        ctx.beginPath();
        ctx.moveTo(xx, offY);
        ctx.lineTo(xx, offY + rows * cs);
        ctx.stroke();
      }
      for (let y = 0; y <= rows; y++) {
        const yy = offY + y * cs + 0.5;
        ctx.beginPath();
        ctx.moveTo(offX, yy);
        ctx.lineTo(offX + cols * cs, yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    _cellToPx(x, y) {
      return {
        x: this.grid.offX + x * this.cell,
        y: this.grid.offY + y * this.cell,
      };
    }

    _renderFood(ctx) {
      const cs = this.cell;
      const p = this._cellToPx(this.food.x, this.food.y);

      const cx = p.x + cs / 2;
      const cy = p.y + cs / 2;
      const r = cs * 0.30;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 6;

      // Boule rouge bien visible
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 2, cx, cy, r + 8);
      g.addColorStop(0, "rgba(255,255,255,.95)");
      g.addColorStop(0.35, "rgba(255,90,90,.95)");
      g.addColorStop(1, "rgba(255,40,90,.95)");

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      // Petit highlight
      ctx.beginPath();
      ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.fill();
    }

    _renderSnake(ctx, dt) {
      const cs = this.cell;
      const pad = Math.max(2, Math.floor(cs * 0.10));
      const r = Math.max(6, Math.floor(cs * 0.28));

      // Interpolation pour un rendu plus fluide entre 2 steps
      const t = clamp((nowMs() - this._lastStepAt) / this.intervalMs, 0, 1);

      // Corps
      for (let i = 0; i < this.snake.length; i++) {
        const s = this.snake[i];
        const p = this._cellToPx(s.x, s.y);

        // Couleur légèrement dégradée
        const bodyG = ctx.createLinearGradient(p.x, p.y, p.x, p.y + cs);
        bodyG.addColorStop(0, "rgba(46,230,166,.95)");
        bodyG.addColorStop(1, "rgba(27,193,139,.98)");

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.20)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 6;

        roundRect(ctx, p.x + pad, p.y + pad, cs - pad * 2, cs - pad * 2, r);
        ctx.fillStyle = bodyG;
        ctx.fill();
        ctx.restore();

        // Séparations douces
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = "rgba(255,255,255,.30)";
        ctx.lineWidth = 2;
        roundRect(ctx, p.x + pad + 1, p.y + pad + 1, cs - pad * 2 - 2, cs - pad * 2 - 2, r - 2);
        ctx.stroke();
        ctx.restore();
      }

      // Tête distincte
      if (!this.snake.length) return;
      const head = this.snake[this.snake.length - 1];
      const prev = this.snake.length > 1 ? this.snake[this.snake.length - 2] : head;

      // Position interpolée (entre prev et head)
      const hx = prev.x + (head.x - prev.x) * t;
      const hy = prev.y + (head.y - prev.y) * t;
      const hp = this._cellToPx(hx, hy);

      const headX = hp.x + pad - 1;
      const headY = hp.y + pad - 1;
      const headW = cs - pad * 2 + 2;
      const headH = cs - pad * 2 + 2;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 7;

      const hg = ctx.createLinearGradient(headX, headY, headX, headY + headH);
      hg.addColorStop(0, "rgba(73,166,255,.95)");
      hg.addColorStop(1, "rgba(255,79,216,.88)");
      roundRect(ctx, headX, headY, headW, headH, r + 2);
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.restore();

      // Yeux
      const centerX = headX + headW / 2;
      const centerY = headY + headH / 2;

      const dir = this.dir;
      const perp = { x: -dir.dy, y: dir.dx };

      const eyeDist = cs * 0.18;
      const eyeFwd = cs * 0.10;

      const ex1 = centerX + perp.x * eyeDist + dir.dx * eyeFwd;
      const ey1 = centerY + perp.y * eyeDist + dir.dy * eyeFwd;
      const ex2 = centerX - perp.x * eyeDist + dir.dx * eyeFwd;
      const ey2 = centerY - perp.y * eyeDist + dir.dy * eyeFwd;

      const eyeR = cs * 0.11;
      const pupilR = cs * 0.05;

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.beginPath(); ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.beginPath(); ctx.arc(ex1 + dir.dx * (eyeR * 0.25), ey1 + dir.dy * (eyeR * 0.25), pupilR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2 + dir.dx * (eyeR * 0.25), ey2 + dir.dy * (eyeR * 0.25), pupilR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Langue bifide (bien visible sur petit écran)
      const pulse = (Math.sin((nowMs() / 1000) * (Math.PI * 2 / this.tonguePulseEvery)) + 1) * 0.5; // 0..1
      const tongueOn = (this.tongueTime < this.tongueVisibleFor) || pulse > 0.82;

      if (tongueOn) {
        const tongueLen = cs * 0.38;
        const forkLen = cs * 0.16;
        const forkSep = cs * 0.10;

        const tx0 = centerX + dir.dx * (cs * 0.30);
        const ty0 = centerY + dir.dy * (cs * 0.30);

        const tx1 = tx0 + dir.dx * tongueLen;
        const ty1 = ty0 + dir.dy * tongueLen;

        ctx.save();
        ctx.strokeStyle = "rgba(255,40,90,.98)";
        ctx.lineWidth = Math.max(3, Math.floor(cs * 0.10));
        ctx.lineCap = "round";

        // Tronc
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(tx1, ty1);
        ctx.stroke();

        // Fourche (2 branches)
        const fx = tx1;
        const fy = ty1;
        const bx1 = fx + perp.x * forkSep + dir.dx * forkLen;
        const by1 = fy + perp.y * forkSep + dir.dy * forkLen;
        const bx2 = fx - perp.x * forkSep + dir.dx * forkLen;
        const by2 = fy - perp.y * forkSep + dir.dy * forkLen;

        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(bx1, by1);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(bx2, by2);
        ctx.stroke();

        ctx.restore();
      }
    }

    _render(dt) {
      // Important: BrickBreakerGame and SnakeGame both have their own render loops
      // and share the same canvas. Only render when Snake is the active game.
      if (!this.isActive()) return;

      const ctx = this.ctx;
      const W = this.baseW;
      const H = this.baseH;

      ctx.clearRect(0, 0, W, H);

      // Fond doux (bubbles)
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, H * 0.9);
      vg.addColorStop(0, "rgba(255,255,255,0.03)");
      vg.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      this._renderGrid(ctx);

      if (this.state !== "menu") {
        this._renderFood(ctx);
        this._renderSnake(ctx, dt);
      }

      // Message simple si menu/ready
      if (this.state === "menu") {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,.90)";
        ctx.font = "1000 28px system-ui, Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SNAKE", W / 2, H * 0.46);

        ctx.fillStyle = "rgba(255,255,255,.75)";
        ctx.font = "900 14px system-ui, Segoe UI, Arial";
        ctx.fillText("Choisis Snake dans le menu", W / 2, H * 0.54);
        ctx.restore();
      }

      if (this.state === "ready") {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,.90)";
        ctx.font = "1000 20px system-ui, Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("GO !", W / 2, H * 0.16);

        ctx.fillStyle = "rgba(255,255,255,.70)";
        ctx.font = "900 12px system-ui, Segoe UI, Arial";
        ctx.fillText("Swipe / Flèches / ZQSD — M = mode mur", W / 2, H * 0.21);
        ctx.restore();
      }

      // Petit badge mode mur
      if (this.state === "ready" || this.state === "playing") {
        ctx.save();
        const txt = "Mur: " + (this.wallMode ? "ON" : "OFF");
        ctx.font = "1000 12px system-ui, Segoe UI, Arial";
        const pad = 10;
        const w = ctx.measureText(txt).width + pad * 2;
        const x = 14;
        const y = 14;
        ctx.fillStyle = "rgba(255,255,255,.10)";
        roundRect(ctx, x, y, w, 28, 14);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.18)";
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.88)";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, x + pad, y + 14);
        ctx.restore();
      }
    }
  }

  window.SnakeGame = SnakeGame;
})();