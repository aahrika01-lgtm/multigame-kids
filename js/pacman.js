/* js/pacman.js
   Mini clone "Ms. Pac-Man" (canvas) — no external graphics required.
   - Tile maze (walls/corridors), pellets, power pellets, fruit bonus.
   - Player movement: grid-locked with smooth pixel movement + buffered turns.
   - Ghosts: 4 ghosts with scatter/chase schedule, frightened mode, eaten -> return home.
   - Input: keyboard (arrows + ZQSD/WASD) + swipe on mobile.
   - Integrates with app overlays via callbacks.
*/
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const randInt = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);

  const DIRS = {
    NONE: { dx: 0, dy: 0, name: "none" },
    UP: { dx: 0, dy: -1, name: "up" },
    DOWN: { dx: 0, dy: 1, name: "down" },
    LEFT: { dx: -1, dy: 0, name: "left" },
    RIGHT: { dx: 1, dy: 0, name: "right" },
  };

  function oppositeDir(d) {
    if (!d) return DIRS.NONE;
    if (d === DIRS.UP) return DIRS.DOWN;
    if (d === DIRS.DOWN) return DIRS.UP;
    if (d === DIRS.LEFT) return DIRS.RIGHT;
    if (d === DIRS.RIGHT) return DIRS.LEFT;
    return DIRS.NONE;
  }

  function keyToDir(key) {
    const k = String(key || "").toLowerCase();
    if (k === "arrowup" || k === "z" || k === "w") return DIRS.UP;
    if (k === "arrowdown" || k === "s") return DIRS.DOWN;
    if (k === "arrowleft" || k === "q" || k === "a") return DIRS.LEFT;
    if (k === "arrowright" || k === "d") return DIRS.RIGHT;
    return null;
  }

  // Maze encoding:
  // # wall
  // . pellet
  // o power pellet
  // ' ' empty
  // P pac spawn
  // G ghost house center
  // = ghost door (acts like wall for player)
  // T tunnel cell (wrap)
  const MAZE_1 = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.##### ## #####.######",
    "     #.##### ## #####.#     ",
    "     #.##          ##.#     ",
    "     #.## ###==### ##.#     ",
    "######.## #  GG  # ##.######",
    "T      .. #      # ..      T",
    "######.## #      # ##.######",
    "     #.## ######## ##.#     ",
    "     #.##          ##.#     ",
    "     #.## ######## ##.#     ",
    "######.## ######## ##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#.####.#####.##.#####.####.#",
    "#o..##.......P........##..o#",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#..........................#",
    "############################",
  ];

  // Helpers for map parsing
  function parseMaze(lines) {
    const h = lines.length;
    const w = Math.max(...lines.map((l) => l.length));
    const grid = [];
    let pacSpawn = { x: 1, y: 1 };
    let ghostHome = { x: 13, y: 13 };
    let tunnelY = null;

    const doorTiles = []; // '=' positions
    const tunnelTiles = [];

    for (let y = 0; y < h; y++) {
      const row = [];
      const line = lines[y].padEnd(w, " ");
      for (let x = 0; x < w; x++) {
        const ch = line[x];
        if (ch === "P") pacSpawn = { x, y };
        if (ch === "G") ghostHome = { x, y };
        if (ch === "T") {
          tunnelY = y;
          tunnelTiles.push({ x, y });
        }
        if (ch === "=") doorTiles.push({ x, y });
        row.push(ch);
      }
      grid.push(row);
    }

    // Compute a door "exit" tile (the walkable tile directly above the door, near its center)
    let doorExit = null;
    if (doorTiles.length) {
      const avgX = doorTiles.reduce((s, p) => s + p.x, 0) / doorTiles.length;
      const avgY = doorTiles.reduce((s, p) => s + p.y, 0) / doorTiles.length;
      const cx = Math.round(avgX);
      const cy = Math.round(avgY);

      // Try above the door first (classic), then nearby fallbacks
      const candidates = [
        { x: cx, y: cy - 1 },
        { x: cx - 1, y: cy - 1 },
        { x: cx + 1, y: cy - 1 },
        { x: cx, y: cy - 2 },
        { x: cx, y: cy + 1 },
      ];

      for (const c of candidates) {
        if (c.y < 0 || c.y >= h || c.x < 0 || c.x >= w) continue;
        const ch = grid[c.y][c.x];
        if (!tileIsWall(ch) && !tileIsDoor(ch)) {
          doorExit = c;
          break;
        }
      }
    }

    return { grid, w, h, pacSpawn, ghostHome, tunnelY, doorTiles, doorExit, tunnelTiles };
  }

  function tileIsWall(ch) {
    return ch === "#";
  }

  function tileIsDoor(ch) {
    return ch === "=";
  }

  function isWalkableForPac(ch) {
    if (tileIsWall(ch) || tileIsDoor(ch)) return false;
    return true;
  }

  function isWalkableForGhost(ch, phase) {
    // Phase: "normal" | "exiting" | "returning"
    // Normal ghosts can't go through walls; door is allowed only for returning/exiting.
    if (tileIsWall(ch)) return false;
    if (tileIsDoor(ch)) return phase === "exiting" || phase === "returning";
    return true;
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  class PacmanGame {
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

      // Game state
      this.state = "menu"; // menu, ready, playing, levelComplete, dying, gameOver
      this.paused = false;

      this.level = 1;
      this.score = 0;
      this.lives = 3;

      this.comboGhost = 0; // eaten ghosts chain during current power
      this.pelletsEaten = 0;

      // Level parameters (increase with level)
      this.pacSpeed = 140;
      this.ghostSpeed = 130;
      this.frightenedSeconds = 7.0;
      this.fruitSeconds = 9.0;

      // Maze
      this.maze = parseMaze(MAZE_1);
      this.tileSize = 16;
      this.offset = { x: 0, y: 0 };
      this._recalcLayout();

      // Pellets map
      this.pellets = new Set(); // "x,y"
      this.powerPellets = new Set(); // "x,y"
      this._initPellets();

      // Fruit
      this.fruit = { active: false, x: 0, y: 0, t: 0, points: 100 };

      // Player
      this.pac = {
        x: this.maze.pacSpawn.x,
        y: this.maze.pacSpawn.y,
        px: 0,
        py: 0,
        dir: DIRS.NONE,
        want: DIRS.NONE,
        mouth: 0, // anim
        dying: 0,
      };
      this._snapPacToTile();

      // Ghosts (Ms. Pac-Man inspired behaviors)
      this.ghosts = [];
      this._initGhosts();

      // Modes
      this.mode = "scatter"; // scatter | chase
      this.modeTimer = 0;
      this.modeSchedule = []; // filled per level

      this.frightened = { on: false, t: 0 };

      // Timers
      this.playTime = 0; // seconds since "playing" began (used for ghost releases)

      // Input buffer + swipe
      this.touch = { down: false, sx: 0, sy: 0, t0: 0 };

      this.waitingForFirstInput = true;

      this._bindInput();
      this._applyLevelParams();
      this._buildModeSchedule();
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

    _recalcLayout() {
      const w = this.maze.w;
      const h = this.maze.h;

      // Fit maze into canvas with padding
      const pad = 18;
      const maxW = this.baseW - pad * 2;
      const maxH = this.baseH - pad * 2;
      const ts = Math.floor(Math.min(maxW / w, maxH / h));
      this.tileSize = clamp(ts, 12, 22);

      const mazePxW = w * this.tileSize;
      const mazePxH = h * this.tileSize;
      this.offset.x = Math.floor((this.baseW - mazePxW) / 2);
      this.offset.y = Math.floor((this.baseH - mazePxH) / 2);
    }

    _initPellets() {
      this.pellets.clear();
      this.powerPellets.clear();
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          const ch = this.maze.grid[y][x];
          if (ch === ".") this.pellets.add(`${x},${y}`);
          if (ch === "o") this.powerPellets.add(`${x},${y}`);
        }
      }
    }

    _initGhosts() {
      const base = this.maze.ghostHome;

      // Staggered releases (pellets eaten or time fallback).
      // Not 1:1 arcade values, but closer to the intended pacing.
      const mk = (name, color, startDx, releasePellets, releaseSeconds) => ({
        name,
        color,
        x: base.x,
        y: base.y,
        px: 0,
        py: 0,
        dir: startDx > 0 ? DIRS.RIGHT : DIRS.LEFT,
        want: startDx > 0 ? DIRS.RIGHT : DIRS.LEFT,
        state: "house", // house | exiting | normal | frightened | eaten
        speedMul: 1.0,
        target: { x: 0, y: 0 },
        releasePellets: releasePellets | 0,
        releaseSeconds: Number(releaseSeconds) || 0,
      });

      this.ghosts = [
        mk("Blinky", "#ff4d6d", 1, 0, 0.0),
        mk("Pinky", "#ff7bd4", -1, 0, 2.0),
        mk("Inky", "#49a6ff", 1, 20, 6.0),
        mk("Sue", "#2ee6a6", -1, 45, 10.0),
      ];

      // Spread slightly
      this.ghosts[0].x += 0; this.ghosts[0].y += 0;
      this.ghosts[1].x -= 1; this.ghosts[1].y += 0;
      this.ghosts[2].x += 1; this.ghosts[2].y += 0;
      this.ghosts[3].x += 0; this.ghosts[3].y += 1;

      for (const g of this.ghosts) this._snapEntityToTile(g);
    }

    _snapEntityToTile(e) {
      const ts = this.tileSize;
      e.px = this.offset.x + (e.x + 0.5) * ts;
      e.py = this.offset.y + (e.y + 0.5) * ts;
    }

    _snapPacToTile() {
      this._snapEntityToTile(this.pac);
    }

    _applyLevelParams() {
      // Gentle but progressive difficulty
      const L = this.level;
      this.pacSpeed = 80 + (L - 1) * 10;         // px/s - commence à 80, augmente de 10 par niveau
      this.ghostSpeed = 70 + (L - 1) * 10;       // px/s - commence à 70, augmente de 10 par niveau
      this.frightenedSeconds = clamp(7.0 - (L - 1) * 0.5, 2.5, 7.0);
      this.fruitSeconds = clamp(9.0 - (L - 1) * 0.3, 5.0, 9.0);
    }

    _buildModeSchedule() {
      // Scatter/chase alternating (arcade-like feel)
      // times in seconds; later levels reduce scatter
      const L = this.level;
      const s1 = clamp(7 - (L - 1) * 0.5, 3.0, 7.0);
      const c1 = 20;
      const s2 = clamp(7 - (L - 1) * 0.6, 3.0, 7.0);
      const c2 = 20;
      const s3 = clamp(5 - (L - 1) * 0.6, 2.0, 5.0);
      const c3 = 9999;
      this.modeSchedule = [
        { mode: "scatter", t: s1 },
        { mode: "chase", t: c1 },
        { mode: "scatter", t: s2 },
        { mode: "chase", t: c2 },
        { mode: "scatter", t: s3 },
        { mode: "chase", t: c3 },
      ];
      this.mode = "scatter";
      this.modeTimer = 0;
      this.modeIndex = 0;
    }

    start() {
      if (this._running) return;
      this._running = true;
      this.state = "menu";
      this._animationFrameId = null;

      const loop = () => {
        if (!this._running) return;

        const ts = performance.now();
        const dt = clamp((ts - (this._lastTs || ts)) / 1000, 0, 1 / 20);
        this._lastTs = ts;

        this._setupCanvasDpr();
        this._recalcLayout();

        if (!this.paused) this._update(dt);
        this._render(dt);

        // Continue loop
        this._animationFrameId = requestAnimationFrame(loop);
      };
      
      // Start the loop
      this._animationFrameId = requestAnimationFrame(loop);
    }

    stop() {
      this._running = false;
      if (this._animationFrameId) {
        cancelAnimationFrame(this._animationFrameId);
        this._animationFrameId = null;
      }
    }

    isPaused() {
      return !!this.paused;
    }

    pause(on) {
      this.paused = !!on;
    }

    resetAndStartLevel(levelNumber) {
      this.level = Math.max(1, levelNumber | 0);
      this._applyLevelParams();
      this._buildModeSchedule();

      this.state = "ready";
      this.paused = false;

      this.comboGhost = 0;
      this.pelletsEaten = 0;
      this.playTime = 0;

      this.maze = parseMaze(MAZE_1);
      this._recalcLayout();
      this._initPellets();

      this.fruit.active = false;
      this.fruit.t = 0;

      this.pac.x = this.maze.pacSpawn.x;
      this.pac.y = this.maze.pacSpawn.y;
      this.pac.dir = DIRS.NONE;
      this.pac.want = DIRS.NONE;
      this.pac.dying = 0;
      this._snapPacToTile();

      this._initGhosts();

      this.frightened.on = false;
      this.frightened.t = 0;

      this.waitingForFirstInput = true;

      this._updateHud();
    }

    resetGame() {
      this.score = 0;
      this.lives = 3;
      this.resetAndStartLevel(1);
    }

    launch() {
      if (this.state === "ready") {
        this.state = "playing";
        this.playTime = 0;
        this.paused = false;
        this.waitingForFirstInput = false;
        // Donner une direction initiale à Pac-Man pour qu'il commence à bouger
        // Vérifier quelle direction est libre
        if (this.pac.dir === DIRS.NONE && this.pac.want === DIRS.NONE) {
          // Essayer les directions dans l'ordre : UP, LEFT, DOWN, RIGHT
          const directions = [DIRS.UP, DIRS.LEFT, DIRS.DOWN, DIRS.RIGHT];
          for (const dir of directions) {
            if (this._canMovePac(this.pac.x, this.pac.y, dir)) {
              this.pac.dir = dir;
              this.pac.want = dir;
              break;
            }
          }
        }
        this.onHideOverlay();
      }
    }

    setDirection(dir) {
      if (!dir) return;
      if (!this.isActive()) return;
      if (this.state !== "ready" && this.state !== "playing") return;

      this.pac.want = dir;

      // Auto-launch if in ready state
      if (this.state === "ready") {
        this.launch();
      }
    }

    _bindInput() {
      // CLAVIER UNIQUEMENT
      window.addEventListener("keydown", (e) => {
        if (!this.isActive()) return;

        const d = keyToDir(e.key);
        if (d) {
          if (this.state === "ready" || this.state === "playing") e.preventDefault();
          this.setDirection(d);
        }
      });

      window.addEventListener("resize", () => this._setupCanvasDpr());
      // NE PAS mettre en pause automatiquement - laissons l'utilisateur contrôler
    }

    _tileAt(x, y) {
      if (y < 0 || y >= this.maze.h) return "#";
      if (x < 0 || x >= this.maze.w) return "#";
      return this.maze.grid[y][x] || " ";
    }

    _canMovePac(x, y, dir) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      // tunnel wrap row: allow leaving bounds if tile is T
      if (this.maze.tunnelY != null && y === this.maze.tunnelY) {
        if (nx < 0 || nx >= this.maze.w) return true;
      }
      return isWalkableForPac(this._tileAt(nx, ny));
    }

    _wrapIfTunnel(entity) {
      if (this.maze.tunnelY == null) return;
      if (entity.y !== this.maze.tunnelY) return;

      const ts = this.tileSize;

      if (entity.x < 0) {
        entity.x = this.maze.w - 1;
        entity.px = this.offset.x + (entity.x + 0.5) * ts;
      }
      if (entity.x >= this.maze.w) {
        entity.x = 0;
        entity.px = this.offset.x + (entity.x + 0.5) * ts;
      }
    }

    _isNearCenter(px, py) {
      // snapping threshold for turns - more permissive for smoother gameplay
      const ts = this.tileSize;
      const cx = this.offset.x + (this.pac.x + 0.5) * ts;
      const cy = this.offset.y + (this.pac.y + 0.5) * ts;
      return Math.abs(px - cx) <= ts * 0.4 && Math.abs(py - cy) <= ts * 0.4;
    }

    _stepPac(dt) {
      if (this.waitingForFirstInput) {
        return;
      }

      const sp = this.pacSpeed;
      const ts = this.tileSize;

      // Try to turn if we want a different direction
      if (this.pac.want !== this.pac.dir) {
        if (this._canMovePac(this.pac.x, this.pac.y, this.pac.want)) {
          this.pac.dir = this.pac.want;
          // Recentrer fortement quand on change de direction
          const cx = this.offset.x + (this.pac.x + 0.5) * ts;
          const cy = this.offset.y + (this.pac.y + 0.5) * ts;
          // Interpoler fortement vers le centre (80%)
          this.pac.px = this.pac.px * 0.2 + cx * 0.8;
          this.pac.py = this.pac.py * 0.2 + cy * 0.8;
        }
      }

      // Check if current direction is still valid
      if (this.pac.dir !== DIRS.NONE && !this._canMovePac(this.pac.x, this.pac.y, this.pac.dir)) {
        this.pac.dir = DIRS.NONE;
      }

      // Move in pixels
      this.pac.px += this.pac.dir.dx * sp * dt;
      this.pac.py += this.pac.dir.dy * sp * dt;

      // Recentrage progressif pendant le mouvement pour rester aligné
      const cx = this.offset.x + (this.pac.x + 0.5) * ts;
      const cy = this.offset.y + (this.pac.y + 0.5) * ts;
      
      // Recentrer sur l'axe perpendiculaire au mouvement
      if (this.pac.dir.dx !== 0) {
        // Mouvement horizontal -> recentrer verticalement
        this.pac.py = this.pac.py * 0.85 + cy * 0.15;
      } else if (this.pac.dir.dy !== 0) {
        // Mouvement vertical -> recentrer horizontalement
        this.pac.px = this.pac.px * 0.85 + cx * 0.15;
      }

      // Calculate which tile we're in based on pixel position
      const relX = (this.pac.px - this.offset.x) / ts - 0.5;
      const relY = (this.pac.py - this.offset.y) / ts - 0.5;
      const nx = Math.round(relX);
      const ny = Math.round(relY);

      // Update tile position
      this.pac.x = nx;
      this.pac.y = ny;
      this._wrapIfTunnel(this.pac);

      // If we're in a wall, snap back to valid position
      if (!isWalkableForPac(this._tileAt(this.pac.x, this.pac.y))) {
        this.pac.x = clamp(this.pac.x, 0, this.maze.w - 1);
        this.pac.y = clamp(this.pac.y, 0, this.maze.h - 1);
        this._snapPacToTile();
        this.pac.dir = DIRS.NONE;
      }

      // Eat pellets if centered enough
      if (this._isNearCenter(this.pac.px, this.pac.py)) {
        const key = `${this.pac.x},${this.pac.y}`;
        if (this.pellets.has(key)) {
          this.pellets.delete(key);
          this.pelletsEaten++;
          this.score += 10;
          if (window.AudioKit && window.AudioKit.pacPellet) window.AudioKit.pacPellet();
          else if (window.AudioKit && window.AudioKit.bounce) window.AudioKit.bounce();
          this._maybeSpawnFruit();
          this._updateHud();
        } else if (this.powerPellets.has(key)) {
          this.powerPellets.delete(key);
          this.pelletsEaten++;
          this.score += 50;
          this._startFrightened();
          if (window.AudioKit && window.AudioKit.pacPowerPellet) window.AudioKit.pacPowerPellet();
          else if (window.AudioKit && window.AudioKit.powerUp) window.AudioKit.powerUp();
          this._maybeSpawnFruit(true);
          this._updateHud();
        } else if (this.fruit.active && this.fruit.x === this.pac.x && this.fruit.y === this.pac.y) {
          this.score += this.fruit.points;
          this.fruit.active = false;
          if (window.AudioKit && window.AudioKit.pacFruit) window.AudioKit.pacFruit();
          else if (window.AudioKit && window.AudioKit.win) window.AudioKit.win();
          this._updateHud();
        }
      }
    }

    _maybeSpawnFruit(force) {
      // Spawn around mid-level pellet counts
      if (this.fruit.active) return;

      const remaining = this.pellets.size + this.powerPellets.size;
      const totalStart = this._totalPelletsAtStart || null;
      if (!this._totalPelletsAtStart) this._totalPelletsAtStart = remaining + this.pelletsEaten;

      const eaten = this.pelletsEaten;
      const should = force || eaten === 70 || eaten === 170;
      if (!should) return;

      // Place fruit near center corridor
      const fx = this.maze.ghostHome.x;
      const fy = this.maze.ghostHome.y + 5;

      // find nearest walkable
      let best = null;
      for (let r = 0; r < 6; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = fx + dx;
            const y = fy + dy;
            const ch = this._tileAt(x, y);
            if (!isWalkableForPac(ch)) continue;
            best = { x, y };
            break;
          }
          if (best) break;
        }
        if (best) break;
      }
      if (!best) return;

      const fruitPoints = this.level === 1 ? 100 : this.level === 2 ? 200 : this.level === 3 ? 500 : 700;
      this.fruit.active = true;
      this.fruit.x = best.x;
      this.fruit.y = best.y;
      this.fruit.t = this.fruitSeconds;
      this.fruit.points = fruitPoints;
    }

    _startFrightened() {
      this.frightened.on = true;
      this.frightened.t = this.frightenedSeconds;
      this.comboGhost = 0;

      // Classic behavior: ghosts reverse immediately when frightened starts.
      for (const g of this.ghosts) {
        if (g.state === "normal") {
          g.state = "frightened";
          g.dir = oppositeDir(g.dir);
        }
      }
    }

    _endFrightened() {
      this.frightened.on = false;
      this.frightened.t = 0;
      for (const g of this.ghosts) {
        if (g.state === "frightened") g.state = "normal";
      }
    }

    _advanceMode(dt) {
      if (this.modeSchedule.length === 0) return;
      this.modeTimer += dt;

      const cur = this.modeSchedule[this.modeIndex] || this.modeSchedule[this.modeSchedule.length - 1];
      if (this.modeTimer >= cur.t) {
        this.modeTimer = 0;
        this.modeIndex = clamp(this.modeIndex + 1, 0, this.modeSchedule.length - 1);
        const nxt = this.modeSchedule[this.modeIndex];
        if (nxt && (nxt.mode === "scatter" || nxt.mode === "chase")) {
          this.mode = nxt.mode;
          // Arcade: reversals when switching modes (except frightened)
          for (const g of this.ghosts) {
            if (g.state === "normal") g.dir = oppositeDir(g.dir);
          }
        }
      }
    }

    _ghostTarget(ghost) {
      const pacTile = { x: this.pac.x, y: this.pac.y };
      const pacDir = this.pac.dir;

      // Scatter corners
      const corners = {
        Blinky: { x: this.maze.w - 2, y: 1 },
        Pinky: { x: 1, y: 1 },
        Inky: { x: this.maze.w - 2, y: this.maze.h - 2 },
        Sue: { x: 1, y: this.maze.h - 2 },
      };

      if (ghost.state === "eaten") {
        return { x: this.maze.ghostHome.x, y: this.maze.ghostHome.y };
      }

      if (ghost.state === "frightened") {
        // run away / wander: target away from pacman (mirror)
        return { x: clamp(this.maze.w - 1 - pacTile.x, 0, this.maze.w - 1), y: clamp(this.maze.h - 1 - pacTile.y, 0, this.maze.h - 1) };
      }

      if (this.mode === "scatter") {
        return corners[ghost.name] || corners.Blinky;
      }

      // Chase modes (classic-ish targeting)
      if (ghost.name === "Blinky") {
        return pacTile;
      }

      if (ghost.name === "Pinky") {
        // 4 tiles ahead of pacman
        const ahead = 4;
        return { x: pacTile.x + pacDir.dx * ahead, y: pacTile.y + pacDir.dy * ahead };
      }

      if (ghost.name === "Inky") {
        // vector from blinky to 2 tiles ahead of pacman, doubled
        const bl = this.ghosts.find((g) => g.name === "Blinky") || ghost;
        const two = { x: pacTile.x + pacDir.dx * 2, y: pacTile.y + pacDir.dy * 2 };
        const vx = (two.x - bl.x) * 2;
        const vy = (two.y - bl.y) * 2;
        return { x: bl.x + vx, y: bl.y + vy };
      }

      if (ghost.name === "Sue") {
        // Chase if far, scatter if close (approx)
        const d2 = dist2(ghost.x, ghost.y, pacTile.x, pacTile.y);
        if (d2 < 64) return corners.Sue;
        return pacTile;
      }

      return pacTile;
    }

    _ghostPossibleDirs(g, phase) {
      const dirs = [DIRS.UP, DIRS.LEFT, DIRS.DOWN, DIRS.RIGHT];
      const out = [];
      for (const d of dirs) {
        const nx = g.x + d.dx;
        const ny = g.y + d.dy;

        // tunnel wrap row: allow leaving bounds
        if (this.maze.tunnelY != null && g.y === this.maze.tunnelY) {
          if (nx < 0 || nx >= this.maze.w) {
            out.push(d);
            continue;
          }
        }

        const ch = this._tileAt(nx, ny);
        if (isWalkableForGhost(ch, phase)) out.push(d);
      }
      return out;
    }

    _ghostChooseDir(g) {
      // Choose direction at intersections (grid center)
      const phase = g.state === "eaten" ? "returning" : (g.state === "house" || g.state === "exiting") ? "exiting" : "normal";
      const options = this._ghostPossibleDirs(g, phase);

      if (!options.length) return g.dir;

      // Avoid reversing unless forced
      const opp = oppositeDir(g.dir);
      let candidates = options.filter((d) => d !== opp);
      if (candidates.length === 0) candidates = options;

      // Determine target
      const t = this._ghostTarget(g);
      g.target = t;

      if (g.state === "frightened") {
        // random-ish
        return candidates[randInt(0, candidates.length - 1)];
      }

      // Choose minimal distance to target (tie-breaker uses DIR order)
      let best = candidates[0];
      let bestD = Infinity;
      for (const d of candidates) {
        const nx = g.x + d.dx;
        const ny = g.y + d.dy;
        const dd = dist2(nx, ny, t.x, t.y);
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
      return best;
    }

    _ghostChooseDirToTarget(g, target, phase) {
      const options = this._ghostPossibleDirs(g, phase);
      if (!options.length) return g.dir;

      // Avoid reversing unless forced
      const opp = oppositeDir(g.dir);
      let candidates = options.filter((d) => d !== opp);
      if (candidates.length === 0) candidates = options;

      // In frightened during "exiting"/"returning", keep deterministic (no random) so it can navigate
      let best = candidates[0];
      let bestD = Infinity;
      for (const d of candidates) {
        const nx = g.x + d.dx;
        const ny = g.y + d.dy;
        const dd = dist2(nx, ny, target.x, target.y);
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
      return best;
    }

    _stepGhost(g, dt) {
      // Determine ghost speed
      const base = this.ghostSpeed;
      let sp = base;

      if (g.state === "frightened") sp = base * 0.72;
      if (g.state === "eaten") sp = base * 1.25;
      if (this.maze.tunnelY != null && g.y === this.maze.tunnelY) sp *= 0.7;

      const ts = this.tileSize;

      // Check if we should release from house
      if (g.state === "house") {
        const byPellets = this.pelletsEaten >= (g.releasePellets || 0);
        const byTime = this.playTime >= (g.releaseSeconds || 0);
        if (byPellets || byTime) {
          g.state = "exiting";
          g.dir = DIRS.UP; // Start moving up to exit
        } else {
          return; // wait in house
        }
      }

      // Update direction based on state
      if (g.state === "exiting") {
        const exit = this.maze.doorExit || { x: this.maze.ghostHome.x, y: this.maze.ghostHome.y - 3 };
        g.dir = this._ghostChooseDirToTarget(g, exit, "exiting");
        
        // Check if reached exit
        const distToExit = Math.abs(g.x - exit.x) + Math.abs(g.y - exit.y);
        if (distToExit === 0) {
          g.state = this.frightened.on ? "frightened" : "normal";
        }
      } else if (g.state === "eaten") {
        const home = this.maze.ghostHome;
        if (g.x === home.x && g.y === home.y) {
          g.state = "exiting";
          g.dir = DIRS.UP;
        } else {
          g.dir = this._ghostChooseDirToTarget(g, home, "returning");
        }
      } else if (g.state === "normal" || g.state === "frightened") {
        // Only choose new direction when near center of tile
        const cx = this.offset.x + (g.x + 0.5) * ts;
        const cy = this.offset.y + (g.y + 0.5) * ts;
        const nearCenter = Math.abs(g.px - cx) <= ts * 0.3 && Math.abs(g.py - cy) <= ts * 0.3;
        if (nearCenter) {
          g.dir = this._ghostChooseDir(g);
        }
      }

      // MOVE IN PIXELS - happens every frame
      g.px += g.dir.dx * sp * dt;
      g.py += g.dir.dy * sp * dt;

      // Update tile coords based on pixels
      const relX = (g.px - this.offset.x) / ts - 0.5;
      const relY = (g.py - this.offset.y) / ts - 0.5;
      const nx = Math.round(relX);
      const ny = Math.round(relY);

      // Check if we're entering a new tile
      if (nx !== g.x || ny !== g.y) {
        const phase = g.state === "eaten" ? "returning" : (g.state === "exiting" || g.state === "house") ? "exiting" : "normal";
        if (isWalkableForGhost(this._tileAt(nx, ny), phase)) {
          g.x = nx;
          g.y = ny;
          this._wrapIfTunnel(g);
        } else {
          // Hit a wall - snap back and reverse
          this._snapEntityToTile(g);
          g.dir = oppositeDir(g.dir);
        }
      }
    }

    _checkCollisions() {
      // Pac vs ghost collision by pixel radius
      const ts = this.tileSize;
      const rPac = ts * 0.36;
      const rG = ts * 0.36;

      for (const g of this.ghosts) {
        if (g.state === "house" || g.state === "exiting") continue;

        const d2p = dist2(this.pac.px, this.pac.py, g.px, g.py);
        const rr = (rPac + rG) * (rPac + rG);

        if (d2p <= rr) {
          if (g.state === "frightened") {
            // eat ghost
            g.state = "eaten";
            this.comboGhost = clamp(this.comboGhost + 1, 0, 10);
            const pts = 200 * Math.pow(2, this.comboGhost - 1);
            this.score += pts;
            if (window.AudioKit && window.AudioKit.pacEatGhost) window.AudioKit.pacEatGhost();
            else if (window.AudioKit && window.AudioKit.win) window.AudioKit.win();
            this._updateHud();
          } else if (g.state === "normal") {
            // player dies
            this._loseLife();
            return;
          }
        }
      }
    }

    _loseLife() {
      if (this.state !== "playing") return;
      this.state = "dying";
      this.pac.dying = 1.0;
      this.paused = true;

      if (window.AudioKit && window.AudioKit.pacDeath) window.AudioKit.pacDeath();
      else if (window.AudioKit && window.AudioKit.lose) window.AudioKit.lose();

      this.lives -= 1;
      this._updateHud();

      if (this.lives <= 0) {
        this.state = "gameOver";
        this.onShowOverlay({
          title: "Game Over",
          text: "Score : " + this.score,
          tiny: "Appuie sur Rejouer",
          primaryText: "Rejouer",
          secondaryText: "Menu",
          onPrimary: () => {
            this.onHideOverlay();
            this.paused = false;
            this.score = 0;
            this.lives = 3;
            this.resetAndStartLevel(1);
            this.paused = true;
            this.onShowOverlay({
              title: "Prêt ?",
              text: "Mange toutes les pastilles !",
              tiny: "Flèches / ZQSD — Swipe — Espace/Entrée = GO",
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
      } else {
        // continue (keep pellets; only reset positions like the original)
        this.onShowOverlay({
          title: "Oups !",
          text: "Encore une vie",
          tiny: "Appuie sur GO",
          primaryText: "GO !",
          secondaryText: "Menu",
          onPrimary: () => {
            this.onHideOverlay();
            this.paused = false;
            this._resetPositionsOnly();
            this.state = "playing";
            this.waitingForFirstInput = false;
            // Donner une direction initiale à Pac-Man
            if (this.pac.dir === DIRS.NONE && this.pac.want === DIRS.NONE) {
              const directions = [DIRS.UP, DIRS.LEFT, DIRS.DOWN, DIRS.RIGHT];
              for (const dir of directions) {
                if (this._canMovePac(this.pac.x, this.pac.y, dir)) {
                  this.pac.dir = dir;
                  this.pac.want = dir;
                  break;
                }
              }
            }
          },
          onSecondary: () => {
            this.pause(true);
            this.onBackToMenu();
          },
        });
      }
    }

    _resetPositionsOnly() {
      // Preserve pellets/power pellets, but reset actors + transient state (fruit/frightened/modes)
      this._buildModeSchedule();

      this.comboGhost = 0;

      this.frightened.on = false;
      this.frightened.t = 0;

      this.fruit.active = false;
      this.fruit.t = 0;

      this.pac.x = this.maze.pacSpawn.x;
      this.pac.y = this.maze.pacSpawn.y;
      this.pac.dir = DIRS.NONE;
      this.pac.want = DIRS.NONE;
      this.pac.dying = 0;
      this._snapPacToTile();

      this._initGhosts();

      this._updateHud();
    }

    _levelComplete() {
      this.state = "levelComplete";
      this.paused = true;
      if (window.AudioKit && window.AudioKit.win) window.AudioKit.win();

      this.onShowOverlay({
        title: "Niveau terminé !",
        text: "Bravo 🎉",
        tiny: "Niveau " + this.level + " → " + (this.level + 1),
        primaryText: "Suivant",
        secondaryText: "Menu",
        onPrimary: () => {
          this.onHideOverlay();
          this.paused = false;
          this.level += 1;
          this.resetAndStartLevel(this.level);
          this.paused = true;
          this.onShowOverlay({
            title: "Prêt ?",
            text: "Niveau " + this.level,
            tiny: "Flèches / ZQSD — Swipe",
            primaryText: "GO !",
            secondaryText: "Menu",
            onPrimary: () => { this.paused = false; this.onHideOverlay(); this.launch(); },
            onSecondary: () => { this.pause(true); this.onBackToMenu(); },
          });
        },
        onSecondary: () => { this.pause(true); this.onBackToMenu(); },
      });
    }

    _update(dt) {
      if (!this.isActive()) return;

      if (this.state === "menu") return;

      if (this.state === "ready") {
        // idle anim only
        this.pac.mouth = (this.pac.mouth + dt * 2.0) % 1;
        return;
      }

      if (this.state !== "playing") return;

      this.playTime += dt;

      // Mode progression unless frightened
      if (!this.frightened.on) this._advanceMode(dt);

      // Frightened timer
      if (this.frightened.on) {
        this.frightened.t -= dt;
        if (this.frightened.t <= 0) this._endFrightened();
      }

      // Fruit timer
      if (this.fruit.active) {
        this.fruit.t -= dt;
        if (this.fruit.t <= 0) this.fruit.active = false;
      }

      this._stepPac(dt);
      for (const g of this.ghosts) this._stepGhost(g, dt);

      this._checkCollisions();

      // Mouth anim
      this.pac.mouth = (this.pac.mouth + dt * 6.0) % 1;

      // Level complete?
      if (this.pellets.size + this.powerPellets.size === 0) {
        this._levelComplete();
      }
    }

    _render(dt) {
      if (!this.isActive()) return;

      const ctx = this.ctx;
      const W = this.baseW;
      const H = this.baseH;

      ctx.clearRect(0, 0, W, H);

      // Background vignette
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, H * 0.95);
      vg.addColorStop(0, "rgba(255,255,255,0.02)");
      vg.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Maze
      this._renderMaze(ctx);

      // Pellets
      this._renderPellets(ctx);

      // Fruit
      if (this.fruit.active) this._renderFruit(ctx);

      // Entities
      this._renderGhosts(ctx);
      this._renderPac(ctx);
    }

    _renderMaze(ctx) {
      const ts = this.tileSize;
      const { w, h, grid } = this.maze;

      // Maze area
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.22)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 10;

      const x0 = this.offset.x;
      const y0 = this.offset.y;
      const mw = w * ts;
      const mh = h * ts;

      drawRoundRect(ctx, x0 - 10, y0 - 10, mw + 20, mh + 20, 18);
      ctx.fillStyle = "rgba(10,14,34,.72)";
      ctx.fill();
      ctx.restore();

      // Walls
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = grid[y][x];
          if (!tileIsWall(ch)) continue;

          const px = this.offset.x + x * ts;
          const py = this.offset.y + y * ts;

          const g = ctx.createLinearGradient(px, py, px, py + ts);
          g.addColorStop(0, "rgba(73,166,255,.85)");
          g.addColorStop(1, "rgba(255,79,216,.55)");

          ctx.fillStyle = g;
          drawRoundRect(ctx, px + 1, py + 1, ts - 2, ts - 2, ts * 0.25);
          ctx.fill();
        }
      }

      // Door
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = grid[y][x];
          if (!tileIsDoor(ch)) continue;
          const px = this.offset.x + x * ts;
          const py = this.offset.y + y * ts;
          ctx.fillStyle = "rgba(255,255,255,.45)";
          ctx.fillRect(px + 2, py + ts / 2 - 1, ts - 4, 2);
        }
      }
    }

    _renderPellets(ctx) {
      const ts = this.tileSize;
      // Small pellets
      ctx.fillStyle = "rgba(255,255,255,.88)";
      for (const key of this.pellets) {
        const [x, y] = key.split(",").map(Number);
        const cx = this.offset.x + (x + 0.5) * ts;
        const cy = this.offset.y + (y + 0.5) * ts;
        ctx.beginPath();
        ctx.arc(cx, cy, ts * 0.10, 0, Math.PI * 2);
        ctx.fill();
      }

      // Power pellets (bigger, blinking)
      const blink = (Math.sin(nowMs() / 200) + 1) * 0.5;
      ctx.fillStyle = `rgba(255,255,255,${0.5 + blink * 0.45})`;
      for (const key of this.powerPellets) {
        const [x, y] = key.split(",").map(Number);
        const cx = this.offset.x + (x + 0.5) * ts;
        const cy = this.offset.y + (y + 0.5) * ts;
        ctx.beginPath();
        ctx.arc(cx, cy, ts * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _renderFruit(ctx) {
      const ts = this.tileSize;
      const cx = this.offset.x + (this.fruit.x + 0.5) * ts;
      const cy = this.offset.y + (this.fruit.y + 0.5) * ts;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;

      const r = ts * 0.28;
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r + 8);
      g.addColorStop(0, "rgba(255,255,255,.95)");
      g.addColorStop(0.45, "rgba(255,90,90,.95)");
      g.addColorStop(1, "rgba(255,40,90,.95)");

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      // tiny label points
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "900 10px system-ui, Segoe UI, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(this.fruit.points), cx, cy + r + 4);
      ctx.restore();
    }

    _renderGhosts(ctx) {
      const ts = this.tileSize;

      for (const g of this.ghosts) {
        if (g.state === "house") continue;

        const x = g.px;
        const y = g.py;
        const r = ts * 0.36;

        let color = g.color;
        if (g.state === "frightened") {
          const blink = this.frightened.t < 2.2 ? ((Math.sin(nowMs() / 120) + 1) * 0.5) : 0;
          color = blink > 0.5 ? "rgba(255,255,255,.85)" : "rgba(73,166,255,.90)";
        }
        if (g.state === "eaten") {
          color = "rgba(255,255,255,.20)";
        }

        // body
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.25)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 6;

        ctx.beginPath();
        ctx.arc(x, y - r * 0.2, r, Math.PI, 0);
        ctx.lineTo(x + r, y + r);
        ctx.lineTo(x - r, y + r);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();

        // eyes
        if (g.state !== "eaten") {
          const ex = x + r * 0.25;
          const ex2 = x - r * 0.25;
          const ey = y - r * 0.15;
          ctx.fillStyle = "rgba(255,255,255,.92)";
          ctx.beginPath(); ctx.arc(ex, ey, r * 0.22, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex2, ey, r * 0.22, 0, Math.PI * 2); ctx.fill();

          ctx.fillStyle = "rgba(0,0,0,.55)";
          ctx.beginPath(); ctx.arc(ex + g.dir.dx * r * 0.08, ey + g.dir.dy * r * 0.08, r * 0.10, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex2 + g.dir.dx * r * 0.08, ey + g.dir.dy * r * 0.08, r * 0.10, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    _renderPac(ctx) {
      const ts = this.tileSize;
      const x = this.pac.px;
      const y = this.pac.py;
      const r = ts * 0.38;

      const mouth = Math.abs(Math.sin(this.pac.mouth * Math.PI * 2));
      const open = lerp(0.10, 0.50, mouth);

      // direction angle
      let ang = 0;
      if (this.pac.dir === DIRS.RIGHT) ang = 0;
      else if (this.pac.dir === DIRS.LEFT) ang = Math.PI;
      else if (this.pac.dir === DIRS.UP) ang = -Math.PI / 2;
      else if (this.pac.dir === DIRS.DOWN) ang = Math.PI / 2;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, ang + open, ang + Math.PI * 2 - open);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,211,61,.98)";
      ctx.fill();
      ctx.restore();

      // Ms Pac-Man bow (simple)
      ctx.save();
      ctx.fillStyle = "rgba(255,79,216,.95)";
      const bx = x + Math.cos(ang - Math.PI / 2) * r * 0.35;
      const by = y + Math.sin(ang - Math.PI / 2) * r * 0.35;
      ctx.beginPath(); ctx.arc(bx, by, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.22, by, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    _updateHud() {
      if (this.hud.level) this.hud.level.textContent = String(this.level);
      if (this.hud.lives) this.hud.lives.textContent = String(this.lives);
      if (this.hud.score) this.hud.score.textContent = String(this.score);

      // HUD "Combo":
      // - during power mode: ghost chain multiplier x1/x2/x4/...
      // - otherwise: show remaining pellets count (clean numeric, no glyph that might look like a minus)
      if (this.hud.combo) {
        const remaining = this.pellets.size + this.powerPellets.size;
        this.hud.combo.textContent = this.frightened.on
          ? ("x" + String(Math.max(1, this.comboGhost)))
          : String(remaining);
      }
    }
  }

  window.PacmanGame = PacmanGame;
})();