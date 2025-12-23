/* js/brickbreaker.js
   Casse-briques kids-friendly (Canvas).
   - Contrôles : clavier ◀ ▶, tactile (glisser), bouton GO.
   - Gameplay : vies, score, combo simple, 5 niveaux, power-ups (WIDE, MULTI, SLOW, POINTS).
   - Collisions : cercle vs rect robustes (balle, briques, raquette).
*/
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

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

  // Collision cercle-rect (retourne normal + profondeur)
  function circleRectResolve(cx, cy, r, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) return null;

    const d = Math.sqrt(Math.max(0.000001, d2));
    // Si le centre est dans le rect (rare), on force une normale
    if (d < 0.001) {
      // Choix de la sortie la plus proche
      const left = Math.abs(cx - rx);
      const right = Math.abs(rx + rw - cx);
      const top = Math.abs(cy - ry);
      const bottom = Math.abs(ry + rh - cy);
      const m = Math.min(left, right, top, bottom);
      if (m === left) return { nx: -1, ny: 0, depth: r };
      if (m === right) return { nx: 1, ny: 0, depth: r };
      if (m === top) return { nx: 0, ny: -1, depth: r };
      return { nx: 0, ny: 1, depth: r };
    }
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }

  class BrickBreakerGame {
    constructor(opts) {
      this.opts = opts || {};
      this.canvas = this.opts.canvas;
      this.ctx = this.canvas.getContext("2d");

      this.hud = this.opts.hud || {};
      this.onShowOverlay = this.opts.onShowOverlay || (() => {});
      this.onHideOverlay = this.opts.onHideOverlay || (() => {});
      this.onBackToMenu = this.opts.onBackToMenu || (() => {});

      this.baseW = Number(this.canvas.getAttribute("width")) || 900;
      this.baseH = Number(this.canvas.getAttribute("height")) || 540;

      this.dpr = 1;
      this._setupCanvasDpr();

      this._running = false;
      this._lastTs = 0;

      // État gameplay
      this.level = 1;
      this.maxLevels = 5;

      this.score = 0;
      this.lives = 3;
      this.combo = 1;

      this.state = "menu"; // menu, ready, playing, levelComplete, gameOver
      this.paused = false;

      // Raquette
      this.paddle = {
        wBase: 150,
        w: 150,
        h: 18,
        x: (this.baseW - 150) / 2,
        y: this.baseH - 48,
        targetX: (this.baseW - 150) / 2,
        speed: 680, // px/s
      };

      // Balle(s)
      this.balls = [];
      this.ballRadius = 10;
      this.ballBaseSpeed = 410;
      this.ballSpeedMul = 1;

      // Briques + powerups
      this.bricks = [];
      this.powerups = [];
      this.particles = [];

      // Contrôles
      this.moveDir = 0;

      // Effets temporaires
      this.effects = {
        WIDE: 0,
        SLOW: 0,
      };

      // Thème couleurs (kids)
      this.theme = {
        sky1: "rgba(73,166,255,0.18)",
        sky2: "rgba(255,79,216,0.14)",
        brick: ["#2ee6a6", "#49a6ff", "#ff4fd8", "#ffb703", "#f15bb5"],
        brickHit: "#ffffff",
        paddle1: "#2ee6a6",
        paddle2: "#1bc18b",
        ball1: "#ffffff",
        ball2: "#49a6ff",
      };

      this.levels = this._buildLevels();

      this._bindInput();
      this._resetBallsOnPaddle();
      this._updateHud();
    }

    _setupCanvasDpr() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      if (this.dpr === dpr) return;
      this.dpr = dpr;

      // On conserve la logique en coordonnées "base", on upscale seulement le buffer.
      this.canvas.width = Math.round(this.baseW * this.dpr);
      this.canvas.height = Math.round(this.baseH * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
    }

    _bindInput() {
      const rectOf = () => this.canvas.getBoundingClientRect();
      const toLocalX = (clientX) => {
        const r = rectOf();
        const x = (clientX - r.left) * (this.baseW / r.width);
        return clamp(x, 0, this.baseW);
      };

      const pointerMove = (e) => {
        if (this.state === "menu") return;
        const x = toLocalX(e.clientX);
        this.paddle.targetX = clamp(x - this.paddle.w / 2, 10, this.baseW - this.paddle.w - 10);
      };

      const pointerDown = (e) => {
        if (window.AudioKit) window.AudioKit.unlock();
        if (this.state === "ready") {
          // Taper pour lancer = pratique sur mobile
          this.launch();
        }
        pointerMove(e);
      };

      this.canvas.addEventListener("pointerdown", pointerDown, { passive: true });
      this.canvas.addEventListener("pointermove", pointerMove, { passive: true });

      window.addEventListener("resize", () => this._setupCanvasDpr());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.state !== "menu") this.pause(true);
      });
    }

    _buildLevels() {
      // 5 niveaux progressifs mais pas punitifs.
      return [
        { rows: 4, cols: 8, hpMax: 1, gap: 10, top: 70, speed: 380, powerChance: 0.18 },
        { rows: 5, cols: 9, hpMax: 1, gap: 10, top: 68, speed: 410, powerChance: 0.20 },
        { rows: 6, cols: 9, hpMax: 2, gap: 9,  top: 64, speed: 440, powerChance: 0.22 },
        { rows: 7, cols: 10, hpMax: 2, gap: 9, top: 62, speed: 470, powerChance: 0.24 },
        { rows: 8, cols: 10, hpMax: 3, gap: 8, top: 60, speed: 500, powerChance: 0.26 },
      ];
    }

    start() {
      if (this._running) return;
      this._running = true;
      this.state = "menu";
      const loop = (ts) => {
        if (!this._running) return;
        const dt = clamp((ts - (this._lastTs || ts)) / 1000, 0, 1 / 25);
        this._lastTs = ts;

        this._setupCanvasDpr();
        if (!this.paused) this._update(dt);
        this._render();

        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    isPaused() { return !!this.paused; }

    pause(on) {
      this.paused = !!on;
      // Si pause & balle collée, on la garde collée (pas de surprise)
    }

    setMoveDir(dir) {
      this.moveDir = clamp(dir | 0, -1, 1);
    }

    resetAndStartLevel(levelNumber) {
      this.level = clamp(levelNumber | 0, 1, this.maxLevels);

      this.score = 0;
      this.lives = 3;
      this.combo = 1;

      this.effects.WIDE = 0;
      this.effects.SLOW = 0;
      this.ballSpeedMul = 1;
      this._applyPaddleWidth();

      this._loadLevel(this.level);
      this._resetBallsOnPaddle();

      this.state = "ready";
      this.paused = false;
      this._updateHud();
    }

    launch() {
      if (this.paused) return;
      if (this.state === "ready") {
        for (const b of this.balls) b.stuck = false;
        this.state = "playing";
        this.onHideOverlay();
      }
    }

    _resetBallsOnPaddle() {
      this.balls.length = 0;
      const b = this._makeBall();
      b.stuck = true;
      this.balls.push(b);
    }

    _makeBall() {
      // Angle doux pour enfants (évite quasi-horizontal)
      const angle = rand(-Math.PI * 0.35, Math.PI * 0.35);
      const speed = this.ballBaseSpeed * this.ballSpeedMul;
      return {
        x: this.paddle.x + this.paddle.w / 2,
        y: this.paddle.y - this.ballRadius - 2,
        vx: Math.sin(angle) * speed,
        vy: -Math.cos(angle) * speed,
        r: this.ballRadius,
        stuck: true,
        trail: [],
      };
    }

    _loadLevel(level) {
      const cfg = this.levels[level - 1] || this.levels[0];
      this.ballBaseSpeed = cfg.speed;
      this.bricks.length = 0;
      this.powerups.length = 0;
      this.particles.length = 0;

      const paddingX = 38;
      const totalW = this.baseW - paddingX * 2;
      const gap = cfg.gap;
      const cols = cfg.cols;
      const rows = cfg.rows;

      const brickW = (totalW - gap * (cols - 1)) / cols;
      const brickH = 26;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Petit pattern “vague”
          const wave = Math.sin((c / cols) * Math.PI * 2 + r * 0.7);
          const hpBase = 1 + (cfg.hpMax > 1 ? (r >= Math.floor(rows * 0.55) ? 1 : 0) : 0);
          const hp = clamp(hpBase + (cfg.hpMax > 2 ? (wave > 0.55 ? 1 : 0) : 0), 1, cfg.hpMax);

          // Lignes diagonales: quelques trous pour respirer (moins punitif)
          const hole = (level >= 4) ? ((r + c) % 9 === 0) : false;
          if (hole) continue;

          const x = paddingX + c * (brickW + gap);
          const y = cfg.top + r * (brickH + gap);

          const color = this.theme.brick[(r + c + level) % this.theme.brick.length];
          this.bricks.push({
            x, y, w: brickW, h: brickH,
            hp,
            hpMax: cfg.hpMax,
            color,
            alive: true,
          });
        }
      }

      this._updateHud();
    }

    _applyPaddleWidth() {
      const wideOn = this.effects.WIDE > 0;
      const target = this.paddle.wBase * (wideOn ? 1.45 : 1.0);
      this.paddle.w = lerp(this.paddle.w, target, 1); // snap
      this.paddle.x = clamp(this.paddle.x, 10, this.baseW - this.paddle.w - 10);
      this.paddle.targetX = clamp(this.paddle.targetX, 10, this.baseW - this.paddle.w - 10);
    }

    _applySlow() {
      this.ballSpeedMul = (this.effects.SLOW > 0) ? 0.72 : 1.0;
      // Re-normalise les vitesses existantes pour garder un ressenti constant
      for (const b of this.balls) {
        if (b.stuck) continue;
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const desired = this.ballBaseSpeed * this.ballSpeedMul;
        b.vx = (b.vx / sp) * desired;
        b.vy = (b.vy / sp) * desired;
      }
    }

    _updateHud() {
      if (this.hud.level) this.hud.level.textContent = String(this.level);
      if (this.hud.lives) this.hud.lives.textContent = String(this.lives);
      if (this.hud.score) this.hud.score.textContent = String(this.score);
      if (this.hud.combo) this.hud.combo.textContent = "x" + String(this.combo);
    }

    _update(dt) {
      if (this.state === "menu") return;

      // Timers effets
      const dec = (k) => { this.effects[k] = Math.max(0, this.effects[k] - dt); };
      const wideWas = this.effects.WIDE > 0;
      const slowWas = this.effects.SLOW > 0;

      dec("WIDE");
      dec("SLOW");

      if (wideWas !== (this.effects.WIDE > 0)) this._applyPaddleWidth();
      if (slowWas !== (this.effects.SLOW > 0)) this._applySlow();

      // Déplacement raquette (simple et stable)
      if (this.moveDir !== 0) {
        this.paddle.x += this.moveDir * this.paddle.speed * dt;
        this.paddle.targetX = this.paddle.x;
      } else {
        this.paddle.x = lerp(this.paddle.x, this.paddle.targetX, 1 - Math.pow(0.0001, dt));
      }
      this.paddle.x = clamp(this.paddle.x, 10, this.baseW - this.paddle.w - 10);

      // Update ball(s)
      const aliveBricks = this.bricks.filter(b => b.alive).length;

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const ball = this.balls[i];

        if (ball.stuck) {
          ball.x = this.paddle.x + this.paddle.w / 2;
          ball.y = this.paddle.y - ball.r - 2;
          continue;
        }

        // Trail (visuel gratifiant)
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 10) ball.trail.shift();

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // Mur gauche/droite
        if (ball.x - ball.r < 0) {
          ball.x = ball.r;
          ball.vx *= -1;
          if (window.AudioKit) window.AudioKit.bounce();
        }
        if (ball.x + ball.r > this.baseW) {
          ball.x = this.baseW - ball.r;
          ball.vx *= -1;
          if (window.AudioKit) window.AudioKit.bounce();
        }

        // Plafond
        if (ball.y - ball.r < 0) {
          ball.y = ball.r;
          ball.vy *= -1;
          if (window.AudioKit) window.AudioKit.bounce();
        }

        // Raquette
        const pr = circleRectResolve(ball.x, ball.y, ball.r, this.paddle.x, this.paddle.y, this.paddle.w, this.paddle.h);
        if (pr && ball.vy > 0) {
          // Angle selon l’endroit touché
          const hit = (ball.x - (this.paddle.x + this.paddle.w / 2)) / (this.paddle.w / 2);
          const ang = clamp(hit, -1, 1) * (Math.PI * 0.36); // ~65°
          const sp = this.ballBaseSpeed * this.ballSpeedMul;
          ball.vx = Math.sin(ang) * sp;
          ball.vy = -Math.cos(ang) * sp;

          // Décaler hors collision
          ball.y = this.paddle.y - ball.r - 0.5;

          if (window.AudioKit) window.AudioKit.paddle();
        }

        // Briques (on teste tout, mais c'est léger)
        for (const brick of this.bricks) {
          if (!brick.alive) continue;

          const res = circleRectResolve(ball.x, ball.y, ball.r, brick.x, brick.y, brick.w, brick.h);
          if (!res) continue;

          // Sortir la balle du brick
          ball.x += res.nx * (res.depth + 0.2);
          ball.y += res.ny * (res.depth + 0.2);

          // Rebond selon la normale dominante
          const dot = ball.vx * res.nx + ball.vy * res.ny;
          ball.vx = ball.vx - 2 * dot * res.nx;
          ball.vy = ball.vy - 2 * dot * res.ny;

          // Hits
          brick.hp -= 1;
          if (window.AudioKit) window.AudioKit.brick();

          // Particules mini (feedback)
          this._spawnPop(brick, res.nx, res.ny);

          if (brick.hp <= 0) {
            brick.alive = false;

            // Score + combo simple
            const gained = 40 * this.combo;
            this.score += gained;
            this.combo = clamp(this.combo + 1, 1, 12);
            this._maybeDropPowerUp(brick);

            // Petit bonus si on termine une zone (gratifiant)
            if (aliveBricks <= 6) this.score += 10;
          } else {
            // Petite récompense aussi sur hit (moins frustrant)
            this.score += 10;
          }

          this._updateHud();
          break; // 1 collision par frame suffit (stable)
        }

        // Chute (perte balle)
        if (ball.y - ball.r > this.baseH + 30) {
          this.balls.splice(i, 1);
        }
      }

      // Powerups qui tombent
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const p = this.powerups[i];
        p.y += p.vy * dt;
        p.rot += dt * 2.4;

        // Ramassé
        const hit = circleRectResolve(p.x, p.y, p.r, this.paddle.x, this.paddle.y - 4, this.paddle.w, this.paddle.h + 8);
        if (hit) {
          this._applyPowerUp(p.type);
          this.powerups.splice(i, 1);
          continue;
        }

        // Raté
        if (p.y - p.r > this.baseH + 40) this.powerups.splice(i, 1);
      }

      // Particules
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const s = this.particles[i];
        s.t += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 620 * dt;
        if (s.t > s.life) this.particles.splice(i, 1);
      }

      // Plus de balle => perdre une vie
      if (this.state === "playing" && this.balls.length === 0) {
        this.lives -= 1;
        this.combo = 1;
        this._updateHud();

        if (window.AudioKit) window.AudioKit.bad();

        if (this.lives <= 0) {
          this.state = "gameOver";
          this.paused = true;
          if (window.AudioKit) window.AudioKit.lose();
          this.onShowOverlay({
            title: "Oh non !",
            text: "Partie terminée",
            tiny: "Appuie sur Rejouer",
            primaryText: "Rejouer",
            secondaryText: "Menu",
            onPrimary: () => {
              this.paused = false;
              this.resetAndStartLevel(1);
              this.onShowOverlay({
                title: "Prêt ?",
                text: "Glisse pour bouger. Appuie sur GO !",
                tiny: "Espace = GO",
                primaryText: "GO !",
                secondaryText: "Menu",
                onPrimary: () => { this.onHideOverlay(); this.launch(); },
                onSecondary: () => { this.pause(true); this.onBackToMenu(); },
              });
            },
            onSecondary: () => {
              this.pause(true);
              this.onBackToMenu();
            },
          });
        } else {
          // Continue (pas punitif)
          this._resetBallsOnPaddle();
          this.state = "ready";
          this.paused = true;
          this.onShowOverlay({
            title: "Oups !",
            text: "Encore une chance",
            tiny: "Appuie sur GO",
            primaryText: "GO !",
            secondaryText: "Menu",
            onPrimary: () => { this.paused = false; this.onHideOverlay(); this.launch(); },
            onSecondary: () => { this.pause(true); this.onBackToMenu(); },
          });
        }
      }

      // Victoire niveau
      const remaining = this.bricks.some(b => b.alive);
      if (this.state === "playing" && !remaining) {
        this.state = "levelComplete";
        this.paused = true;
        if (window.AudioKit) window.AudioKit.win();

        if (this.level < this.maxLevels) {
          this.onShowOverlay({
            title: "Bravo !",
            text: "Niveau terminé",
            tiny: "Tu es trop fort(e) !",
            primaryText: "Suivant",
            secondaryText: "Menu",
            onPrimary: () => {
              this.onHideOverlay();
              this.paused = false;
              this.level += 1;
              this.combo = 1;
              this._loadLevel(this.level);
              this._resetBallsOnPaddle();
              this.state = "ready";
              this._updateHud();

              this.paused = true;
              this.onShowOverlay({
                title: "Niveau " + this.level,
                text: "Prêt ?",
                tiny: "Appuie sur GO",
                primaryText: "GO !",
                secondaryText: "Menu",
                onPrimary: () => { this.paused = false; this.onHideOverlay(); this.launch(); },
                onSecondary: () => { this.pause(true); this.onBackToMenu(); },
              });
            },
            onSecondary: () => { this.pause(true); this.onBackToMenu(); },
          });
        } else {
          this.onShowOverlay({
            title: "Champion !",
            text: "Tu as tout gagné !",
            tiny: "Rejouer ?",
            primaryText: "Rejouer",
            secondaryText: "Menu",
            onPrimary: () => {
              this.onHideOverlay();
              this.paused = false;
              this.resetAndStartLevel(1);
              this.paused = true;
              this.onShowOverlay({
                title: "Prêt ?",
                text: "Glisse pour bouger. Appuie sur GO !",
                tiny: "",
                primaryText: "GO !",
                secondaryText: "Menu",
                onPrimary: () => { this.paused = false; this.onHideOverlay(); this.launch(); },
                onSecondary: () => { this.pause(true); this.onBackToMenu(); },
              });
            },
            onSecondary: () => { this.pause(true); this.onBackToMenu(); },
          });
        }
      }
    }

    _maybeDropPowerUp(brick) {
      const cfg = this.levels[this.level - 1] || this.levels[0];
      if (Math.random() > cfg.powerChance) return;

      const type = pick(["WIDE", "MULTI", "SLOW", "POINTS"]);
      const x = brick.x + brick.w / 2;
      const y = brick.y + brick.h / 2;

      this.powerups.push({
        type,
        x,
        y,
        r: 14,
        vy: 160 + this.level * 18,
        rot: rand(0, Math.PI * 2),
      });
    }

    _applyPowerUp(type) {
      if (window.AudioKit) window.AudioKit.powerUp();

      if (type === "POINTS") {
        this.score += 500;
        this._updateHud();
        return;
      }

      if (type === "WIDE") {
        this.effects.WIDE = 10.5; // secondes
        this._applyPaddleWidth();
        return;
      }

      if (type === "SLOW") {
        this.effects.SLOW = 9.5;
        this._applySlow();
        return;
      }

      if (type === "MULTI") {
        // Ajoute 2 balles, angles doux
        const source = this.balls.find(b => !b.stuck) || this.balls[0];
        const base = source || this._makeBall();
        const addBall = (ang) => {
          const sp = this.ballBaseSpeed * this.ballSpeedMul;
          this.balls.push({
            x: base.x,
            y: base.y,
            vx: Math.sin(ang) * sp,
            vy: -Math.cos(ang) * sp,
            r: this.ballRadius,
            stuck: false,
            trail: [],
          });
        };

        const a = rand(-Math.PI * 0.25, Math.PI * 0.25);
        addBall(a + 0.35);
        addBall(a - 0.35);

        // Si on était "ready", on lance tout
        this.state = "playing";
        for (const b of this.balls) b.stuck = false;
        return;
      }
    }

    _spawnPop(brick, nx, ny) {
      const cx = brick.x + brick.w / 2;
      const cy = brick.y + brick.h / 2;
      const count = 7;
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: cx + rand(-brick.w * 0.25, brick.w * 0.25),
          y: cy + rand(-brick.h * 0.25, brick.h * 0.25),
          vx: rand(-90, 90) + nx * 120,
          vy: rand(-150, -40) + ny * 80,
          t: 0,
          life: rand(0.25, 0.55),
          c: brick.color,
        });
      }
    }

    _render() {
      const ctx = this.ctx;
      const W = this.baseW;
      const H = this.baseH;

      // Fond (bubbles)
      ctx.clearRect(0, 0, W, H);
      ctx.save();

      // Soft vignette
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.45, 30, W * 0.5, H * 0.5, H * 0.8);
      vg.addColorStop(0, "rgba(255,255,255,0.02)");
      vg.addColorStop(1, "rgba(0,0,0,0.20)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Petites bulles
      for (let i = 0; i < 18; i++) {
        const x = (i * 73 + (this.level * 19)) % W;
        const y = (i * 41 + (this.level * 37)) % H;
        const r = 10 + (i % 5) * 4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? this.theme.sky1 : this.theme.sky2;
        ctx.fill();
      }

      // Briques
      for (const b of this.bricks) {
        if (!b.alive) continue;
        const hpT = b.hp / Math.max(1, b.hpMax);
        const glow = 0.25 + (1 - hpT) * 0.25;

        // Ombre
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.25)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 6;

        roundRect(ctx, b.x, b.y, b.w, b.h, 10);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.restore();

        // Highlight
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
        g.addColorStop(0, "rgba(255,255,255," + (0.18 + glow) + ")");
        g.addColorStop(1, "rgba(255,255,255,0.02)");
        roundRect(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 9);
        ctx.fillStyle = g;
        ctx.fill();

        // Petites "barres" HP (simple)
        if (b.hpMax > 1) {
          ctx.fillStyle = "rgba(0,0,0,.25)";
          roundRect(ctx, b.x + 8, b.y + b.h - 8, b.w - 16, 5, 99);
          ctx.fill();

          ctx.fillStyle = "rgba(255,255,255,.65)";
          roundRect(ctx, b.x + 8, b.y + b.h - 8, (b.w - 16) * (b.hp / b.hpMax), 5, 99);
          ctx.fill();
        }
      }

      // Power-ups
      for (const p of this.powerups) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);

        ctx.shadowColor = "rgba(0,0,0,.25)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 6;

        // capsule
        roundRect(ctx, -18, -14, 36, 28, 14);
        ctx.fillStyle = "rgba(255,255,255,.18)";
        ctx.fill();

        roundRect(ctx, -17, -13, 34, 26, 13);
        ctx.fillStyle = "rgba(73,166,255,.22)";
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = "rgba(255,255,255,.90)";
        ctx.font = "900 14px system-ui, Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const icon = (p.type === "WIDE") ? "↔" :
                     (p.type === "MULTI") ? "●●" :
                     (p.type === "SLOW") ? "🐢" : "★";

        ctx.fillText(icon, 0, 1);
        ctx.restore();
      }

      // Particules
      for (const s of this.particles) {
        const a = 1 - s.t / s.life;
        ctx.fillStyle = `rgba(255,255,255,${0.08 * a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = s.c;
        ctx.globalAlpha = 0.75 * a;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Raquette (candy)
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 8;

      const px = this.paddle.x;
      const py = this.paddle.y;
      const pw = this.paddle.w;
      const ph = this.paddle.h;

      const pg = ctx.createLinearGradient(px, py, px, py + ph);
      pg.addColorStop(0, this.theme.paddle1);
      pg.addColorStop(1, this.theme.paddle2);

      roundRect(ctx, px, py, pw, ph, 12);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.restore();

      // Petit "visage" (fun)
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.beginPath(); ctx.arc(px + pw * 0.38, py + ph * 0.55, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + pw * 0.62, py + ph * 0.55, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + pw * 0.5, py + ph * 0.62, 6, 0, Math.PI);
      ctx.stroke();
      ctx.restore();

      // Balle(s)
      for (const ball of this.balls) {
        // Trail
        for (let i = 0; i < ball.trail.length; i++) {
          const t = (i + 1) / (ball.trail.length + 1);
          ctx.globalAlpha = 0.12 * t;
          ctx.beginPath();
          ctx.arc(ball.trail[i].x, ball.trail[i].y, ball.r * (0.75 * t), 0, Math.PI * 2);
          ctx.fillStyle = "rgba(73,166,255,.80)";
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        const bg = ctx.createRadialGradient(ball.x - 4, ball.y - 4, 2, ball.x, ball.y, ball.r + 6);
        bg.addColorStop(0, this.theme.ball1);
        bg.addColorStop(0.65, this.theme.ball2);
        bg.addColorStop(1, "rgba(255,79,216,.60)");

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.25)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 6;

        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.restore();

        // Petit highlight
        ctx.beginPath();
        ctx.arc(ball.x - 3, ball.y - 3, ball.r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,.55)";
        ctx.fill();
      }

      // Badges d'effets (ultra simple)
      const badges = [];
      if (this.effects.WIDE > 0) badges.push({ t: "RAQUETTE +" , c: "rgba(46,230,166,.18)" });
      if (this.effects.SLOW > 0) badges.push({ t: "BALLE LENTE", c: "rgba(73,166,255,.18)" });

      if (badges.length) {
        let x = 16;
        const y = 14;
        for (const b of badges) {
          ctx.save();
          ctx.fillStyle = b.c;
          roundRect(ctx, x, y, 132, 28, 14);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,.20)";
          ctx.stroke();

          ctx.fillStyle = "rgba(255,255,255,.88)";
          ctx.font = "900 12px system-ui, Segoe UI, Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(b.t, x + 66, y + 14);
          ctx.restore();

          x += 142;
        }
      }

      // Affichage des vies dans le canvas (en plus du HUD HTML)
      if (this.state !== "menu") {
        const lives = Math.max(0, this.lives | 0);
        const pad = 10;
        const boxW = 140;
        const boxH = 34;
        const x = W - pad - boxW;
        const y = 14;

        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.18)";
        roundRect(ctx, x, y, boxW, boxH, 16);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.18)";
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,.90)";
        ctx.font = "1000 13px system-ui, Segoe UI, Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("Vies:", x + 12, y + boxH / 2);

        // Petits coeurs (fallback: ♥ si emoji pas dispo)
        const heart = "♥";
        ctx.fillStyle = "rgba(255,79,216,.95)";
        ctx.font = "1000 16px system-ui, Segoe UI, Arial";

        const maxHearts = 5;
        const shown = Math.min(lives, maxHearts);
        for (let i = 0; i < shown; i++) {
          ctx.fillText(heart, x + 58 + i * 14, y + boxH / 2 + 1);
        }

        if (lives > maxHearts) {
          ctx.fillStyle = "rgba(255,255,255,.90)";
          ctx.font = "1000 12px system-ui, Segoe UI, Arial";
          ctx.fillText("+" + (lives - maxHearts), x + 58 + maxHearts * 14 + 4, y + boxH / 2 + 1);
        }

        ctx.restore();
      }

      // Indication GO quand balle collée
      if (this.state === "ready") {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.font = "1000 18px system-ui, Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("GO !", W / 2, H * 0.52);

        ctx.fillStyle = "rgba(255,255,255,.70)";
        ctx.font = "900 12px system-ui, Segoe UI, Arial";
        ctx.fillText("Touche / Clique pour lancer", W / 2, H * 0.58);
        ctx.restore();
      }

      ctx.restore();
    }
  }

  window.BrickBreakerGame = BrickBreakerGame;
})();