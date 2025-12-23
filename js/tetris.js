/* js/tetris.js
   Jeu Tetris classique
*/
(() => {
  class TetrisGame {
    constructor({ canvas, hud, onShowOverlay, onHideOverlay, onBackToMenu, isActive }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.hud = hud;
      this.onShowOverlay = onShowOverlay;
      this.onHideOverlay = onHideOverlay;
      this.onBackToMenu = onBackToMenu;
      this.isActive = isActive || (() => true);

      // Grid settings
      this.cols = 10;
      this.rows = 20;
      this.blockSize = 25; // Adjusted dynamically based on canvas height
      this.grid = []; // 2D array [row][col]

      // Game state
      this.board = null;
      this.activePiece = null;
      this.nextPiece = null;
      this.score = 0;
      this.level = 1;
      this.lines = 0;
      this.gameOver = false;
      this.paused = true;
      this.dropInterval = 1000;
      this.dropCounter = 0;
      this.lastTime = 0;

      // Tetromino definitions (shapes and colors)
      this.shapes = {
        I: { color: "#00FFFF", matrix: [[1, 1, 1, 1]] },
        J: { color: "#0000FF", matrix: [[1, 0, 0], [1, 1, 1]] },
        L: { color: "#FFA500", matrix: [[0, 0, 1], [1, 1, 1]] },
        O: { color: "#FFFF00", matrix: [[1, 1], [1, 1]] },
        S: { color: "#00FF00", matrix: [[0, 1, 1], [1, 1, 0]] },
        T: { color: "#800080", matrix: [[0, 1, 0], [1, 1, 1]] },
        Z: { color: "#FF0000", matrix: [[1, 1, 0], [0, 1, 1]] }
      };

      this.animFrame = null;
      this.bindControls();
    }

    createGrid() {
      // Create empty 20x10 grid (0 = empty, string = color)
      return Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    createPiece(type) {
      if (!type) {
        const types = "IJLOSTZ";
        type = types[Math.floor(Math.random() * types.length)];
      }
      const shape = this.shapes[type];
      // Create a deep copy of the matrix to avoid modifying the original
      const matrixCopy = shape.matrix.map(row => [...row]);
      return {
        type: type,
        matrix: matrixCopy,
        color: shape.color,
        pos: { x: Math.floor(this.cols / 2) - Math.ceil(matrixCopy[0].length / 2), y: 0 }
      };
    }

    resetGame() {
      this.grid = this.createGrid();
      this.score = 0;
      this.level = 1;
      this.lines = 0;
      this.gameOver = false;
      this.paused = true;
      this.dropInterval = 1000;
      this.dropCounter = 0;
      this.activePiece = this.createPiece();
      this.nextPiece = this.createPiece();
      
      this.updateHUD();
      
      // Calculate block size based on canvas height to fit
      this.blockSize = Math.floor((this.canvas.height - 40) / this.rows);
    }

    start() {
      if (this.animFrame) return;
      this.loop();
    }

    launch() {
      this.paused = false;
      this.lastTime = performance.now();
    }

    loop(time = 0) {
      this.animFrame = requestAnimationFrame((t) => this.loop(t));
      
      if (!this.isActive()) return;
      if (this.paused || this.gameOver) {
        this.render(); // Keep rendering even if paused
        return;
      }

      const deltaTime = time - this.lastTime;
      this.lastTime = time;

      this.dropCounter += deltaTime;
      if (this.dropCounter > this.dropInterval) {
        this.drop();
      }

      this.render();
    }

    drop() {
      this.activePiece.pos.y++;
      if (this.collide(this.grid, this.activePiece)) {
        this.activePiece.pos.y--;
        this.merge(this.grid, this.activePiece);
        this.arenaSweep();
        this.resetPiece();
      }
      this.dropCounter = 0;
    }

    collide(arena, player) {
      const [m, o] = [player.matrix, player.pos];
      for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
          if (m[y][x] !== 0) {
            const newY = y + o.y;
            const newX = x + o.x;
            
            // Check horizontal bounds
            if (newX < 0 || newX >= this.cols) {
              return true;
            }
            
            // Check bottom bound
            if (newY >= this.rows) {
              return true;
            }
            
            // Check collision with existing blocks (only if within grid)
            if (newY >= 0 && arena[newY][newX] !== 0) {
              return true;
            }
          }
        }
      }
      return false;
    }

    merge(arena, player) {
      player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            arena[y + player.pos.y][x + player.pos.x] = player.color;
          }
        });
      });
    }

    rotate(matrix, dir) {
      // Create a new rotated matrix (works for non-square matrices)
      const rows = matrix.length;
      const cols = matrix[0].length;
      
      if (dir > 0) {
        // Clockwise rotation: new[x][rows-1-y] = old[y][x]
        const rotated = [];
        for (let x = 0; x < cols; x++) {
          rotated[x] = [];
          for (let y = rows - 1; y >= 0; y--) {
            rotated[x][rows - 1 - y] = matrix[y][x];
          }
        }
        // Copy back to original matrix
        matrix.length = 0;
        rotated.forEach(row => matrix.push(row));
      } else {
        // Counter-clockwise rotation: new[cols-1-x][y] = old[y][x]
        const rotated = [];
        for (let x = cols - 1; x >= 0; x--) {
          rotated[cols - 1 - x] = [];
          for (let y = 0; y < rows; y++) {
            rotated[cols - 1 - x][y] = matrix[y][x];
          }
        }
        // Copy back to original matrix
        matrix.length = 0;
        rotated.forEach(row => matrix.push(row));
      }
    }

    playerRotate(dir) {
      const pos = this.activePiece.pos.x;
      const originalMatrix = this.activePiece.matrix.map(row => [...row]);
      let offset = 1;
      
      this.rotate(this.activePiece.matrix, dir);
      
      while (this.collide(this.grid, this.activePiece)) {
        this.activePiece.pos.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (Math.abs(offset) > this.activePiece.matrix[0].length + 1) {
          // Restore original matrix
          this.activePiece.matrix.length = 0;
          originalMatrix.forEach(row => this.activePiece.matrix.push(row));
          this.activePiece.pos.x = pos;
          return;
        }
      }
    }

    playerMove(dir) {
      this.activePiece.pos.x += dir;
      if (this.collide(this.grid, this.activePiece)) {
        this.activePiece.pos.x -= dir;
      }
    }

    resetPiece() {
      // Create a copy of nextPiece to avoid reference issues
      const nextType = this.nextPiece.type;
      this.activePiece = this.createPiece(nextType);
      this.nextPiece = this.createPiece();
      
      if (this.collide(this.grid, this.activePiece)) {
        this.gameOver = true;
        this.onShowOverlay({
          title: "Game Over",
          text: `Score: ${this.score}`,
          tiny: `Lignes: ${this.lines}`,
          primaryText: "Rejouer",
          secondaryText: "Menu",
          onPrimary: () => {
            this.resetGame();
            this.launch();
            this.onHideOverlay();
          },
          onSecondary: () => {
            this.onBackToMenu();
          }
        });
      }
    }

    arenaSweep() {
      let rowCount = 0;
      outer: for (let y = this.grid.length - 1; y > 0; --y) {
        for (let x = 0; x < this.grid[y].length; ++x) {
          if (this.grid[y][x] === 0) {
            continue outer;
          }
        }
        
        const row = this.grid.splice(y, 1)[0].fill(0);
        this.grid.unshift(row);
        ++y;
        rowCount++;
      }
      
      if (rowCount > 0) {
        // Tetris scoring: 40, 100, 300, 1200 * (level + 1)
        const lineScores = [0, 40, 100, 300, 1200];
        this.score += lineScores[rowCount] * (this.level + 1);
        this.lines += rowCount;
        
        // Level up every 10 lines
        const newLevel = Math.floor(this.lines / 10) + 1;
        if (newLevel > this.level) {
          this.level = newLevel;
          // Speed up (min 100ms)
          this.dropInterval = Math.max(100, 1000 - (this.level - 1) * 100);
        }
        
        this.updateHUD();
      }
    }

    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Clear background
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);

      // Centering grid
      const gridW = this.cols * this.blockSize;
      const gridH = this.rows * this.blockSize;
      const offsetX = (w - gridW) / 2;
      const offsetY = (h - gridH) / 2;

      // Draw grid background
      ctx.fillStyle = "#000";
      ctx.fillRect(offsetX, offsetY, gridW, gridH);
      ctx.strokeStyle = "#333";
      ctx.strokeRect(offsetX, offsetY, gridW, gridH);

      // Draw locked pieces
      this.drawMatrix(this.grid, {x: 0, y: 0}, offsetX, offsetY);

      // Draw active piece
      if (this.activePiece) {
        this.drawMatrix(this.activePiece.matrix, this.activePiece.pos, offsetX, offsetY, this.activePiece.color);
        
        // Ghost piece (optional visual aid)
        /*
        let ghost = { ...this.activePiece, pos: { ...this.activePiece.pos } };
        while (!this.collide(this.grid, ghost)) {
          ghost.pos.y++;
        }
        ghost.pos.y--;
        this.drawMatrix(ghost.matrix, ghost.pos, offsetX, offsetY, "rgba(255, 255, 255, 0.2)");
        */
      }

      // Draw next piece preview
      this.drawPreview(w, h);
    }

    drawMatrix(matrix, offset, ox, oy, overrideColor = null) {
      matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            this.ctx.fillStyle = overrideColor || value;
            this.ctx.fillRect(ox + (x + offset.x) * this.blockSize,
                              oy + (y + offset.y) * this.blockSize,
                              this.blockSize - 1, this.blockSize - 1);
            
            // Bevel effect
            this.ctx.lineWidth = 2;
            this.ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
            this.ctx.strokeRect(ox + (x + offset.x) * this.blockSize,
                                oy + (y + offset.y) * this.blockSize,
                                this.blockSize - 1, this.blockSize - 1);
          }
        });
      });
    }

    drawPreview(w, h) {
      if (!this.nextPiece) return;
      
      const ctx = this.ctx;
      const previewX = w - 150;
      const previewY = 100;
      
      ctx.fillStyle = "#FFF";
      ctx.font = "16px Arial";
      ctx.fillText("Suivant :", previewX, previewY - 10);
      
      const blockSize = 20;
      this.nextPiece.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            ctx.fillStyle = this.nextPiece.color;
            ctx.fillRect(previewX + x * blockSize,
                         previewY + y * blockSize,
                         blockSize - 1, blockSize - 1);
          }
        });
      });
    }

    bindControls() {
      window.addEventListener("keydown", (e) => {
        if (!this.isActive() || this.paused || this.gameOver) return;

        if (e.key === "ArrowLeft" || e.key === "q" || e.key === "a") {
          this.playerMove(-1);
        } else if (e.key === "ArrowRight" || e.key === "d") {
          this.playerMove(1);
        } else if (e.key === "ArrowDown" || e.key === "s") {
          this.drop();
        } else if (e.key === "ArrowUp" || e.key === "z" || e.key === "w") {
          e.preventDefault();
          this.playerRotate(1);
        } else if (e.key === " ") {
          // Hard drop? or just fast drop?
          // Let's implement hard drop for space
          while (!this.collide(this.grid, this.activePiece)) {
            this.activePiece.pos.y++;
          }
          this.activePiece.pos.y--;
          this.merge(this.grid, this.activePiece);
          this.arenaSweep();
          this.resetPiece();
          this.dropCounter = 0;
        }
      });
    }

    updateHUD() {
      if (!this.hud) return;
      this.hud.level.textContent = this.level;
      this.hud.score.textContent = this.score;
      this.hud.lives.textContent = this.lines; // Reuse lives field for lines
      this.hud.combo.textContent = "-";
    }

    pause(state) {
      this.paused = state;
    }

    isPaused() {
      return this.paused;
    }
  }

  window.TetrisGame = TetrisGame;
})();