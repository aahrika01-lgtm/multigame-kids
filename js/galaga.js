/* js/galaga.js
   Jeu Galaga complet avec vagues d'ennemis, attaques en plongée, système de score et vies
*/
(() => {
  class GalagaGame {
    constructor({ canvas, hud, onShowOverlay, onHideOverlay, onBackToMenu, isActive }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.hud = hud;
      this.onShowOverlay = onShowOverlay;
      this.onHideOverlay = onHideOverlay;
      this.onBackToMenu = onBackToMenu;
      this.isActive = isActive || (() => true);

      // Sprite sheet
      this.spriteSheet = null;
      this.spritesLoaded = false;
      this.loadSprites();

      // Sprite definitions (coordinates from new sprite.png - single column)
      // Visual inspection of debug-sprites.html:
      // Single column layout, centered sprites.
      // X coordinate centered around 160.
      
      this.sprites = {
        // Coordonnées exactes fournies par l'utilisateur via l'outil de sélection
        boss: { x: 137, y: 70, width: 71, height: 67, frames: 1, spacing: 0 },
        butterfly: { x: 143, y: 184, width: 57, height: 45, frames: 1, spacing: 0 },
        bee: { x: 141, y: 312, width: 61, height: 53, frames: 1, spacing: 0 },
        player: { x: 137, y: 420, width: 71, height: 77, frames: 1, spacing: 0 },
        bullet: { x: 0, y: 0, width: 0, height: 0, frames: 1, spacing: 0 },
        enemyBullet: { x: 0, y: 0, width: 0, height: 0, frames: 1, spacing: 0 },
      };

      // Animation frame counter
      this.animationFrame = 0;

      // Game state
      this.paused = true;
      this.gameOver = false;
      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.combo = 1;

      // Player
      this.player = {
        x: canvas.width / 2,
        y: canvas.height - 60,
        width: 32,
        height: 32,
        speed: 5,
        moveDir: 0, // -1 left, 0 stop, 1 right
      };

      // Bullets
      this.playerBullets = [];
      this.enemyBullets = [];
      this.bulletSpeed = 8;
      this.enemyBulletSpeed = 4;
      this.maxPlayerBullets = 3;
      this.shootCooldown = 0;
      this.shootCooldownMax = 15; // frames

      // Enemies
      this.enemies = [];
      this.enemyFormation = [];
      this.formationX = 0;
      this.formationY = 60;
      this.formationSpeed = 1;
      this.formationDir = 1;
      this.formationMoveCounter = 0;
      this.formationMoveInterval = 60;

      // Diving enemies
      this.divingEnemies = [];
      this.diveInterval = 300; // frames between dives (increased for easier gameplay)
      this.diveCounter = 0;

      // Enemy types with different point values
      this.enemyTypes = {
        bee: { color: "#FFD700", points: 50, size: 24 },
        butterfly: { color: "#FF69B4", points: 80, size: 26 },
        boss: { color: "#00CED1", points: 150, size: 30 },
      };

      // Particles for explosions
      this.particles = [];

      // Stars background
      this.stars = [];
      this.initStars();

      // Keyboard state
      this.keys = {
        left: false,
        right: false,
        space: false,
      };

      // Invincibility after hit
      this.invincible = false;
      this.invincibleTimer = 0;

      // Touch controls
      this.touchStartX = null;
      this.touchStartY = null;

      // Animation frame
      this.animFrame = null;

      this.bindControls();
    }

    loadSprites() {
      // Base64 encoded sprite image to bypass CORS and loading issues locally
      const base64Image = "data:image/png;base64,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";
      
      const rawImage = new Image();
      // Important: Allow cross-origin to work with data URIs if needed, though data URIs are usually safe
      rawImage.crossOrigin = "Anonymous"; 
      
      rawImage.onload = () => {
        // Process image to remove white background
        try {
          const canvas = document.createElement('canvas');
          canvas.width = rawImage.width;
          canvas.height = rawImage.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(rawImage, 0, 0);
          
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          
          // Loop through pixels and make white transparent
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // If pixel is white (or very close to white), make it transparent
            if (r > 240 && g > 240 && b > 240) {
              data[i + 3] = 0; // Alpha = 0
            }
          }
          
          ctx.putImageData(imgData, 0, 0);
          
          this.spriteSheet = new Image();
          this.spriteSheet.onload = () => {
            this.spritesLoaded = true;
            console.log("Galaga sprites processed (transparent) and loaded");
          };
          this.spriteSheet.src = canvas.toDataURL();
        } catch (e) {
          console.warn("Could not process sprite transparency", e);
          // Fallback to raw image if processing fails
          this.spriteSheet = rawImage;
          this.spritesLoaded = true;
        }
      };
      
      rawImage.src = base64Image;
    }

    initStars() {
      this.stars = [];
      for (let i = 0; i < 100; i++) {
        this.stars.push({
          x: Math.random() * this.canvas.width,
          y: Math.random() * this.canvas.height,
          size: Math.random() * 2,
          speed: Math.random() * 0.5 + 0.2,
        });
      }
    }

    bindControls() {
      // Keyboard
      const handleKeyDown = (e) => {
        if (!this.isActive()) return;
        if (this.paused || this.gameOver) return;

        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "q") {
          e.preventDefault();
          this.keys.left = true;
        }
        if (e.key === "ArrowRight" || e.key === "d") {
          e.preventDefault();
          this.keys.right = true;
        }
        if (e.key === " " || e.key === "ArrowUp" || e.key === "z" || e.key === "w") {
          e.preventDefault();
          this.keys.space = true;
        }
      };

      const handleKeyUp = (e) => {
        if (!this.isActive()) return;

        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "q") {
          this.keys.left = false;
        }
        if (e.key === "ArrowRight" || e.key === "d") {
          this.keys.right = false;
        }
        if (e.key === " " || e.key === "ArrowUp" || e.key === "z" || e.key === "w") {
          this.keys.space = false;
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      // Touch/swipe controls
      this.canvas.addEventListener("touchstart", (e) => {
        if (!this.isActive() || this.paused || this.gameOver) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
      }, { passive: false });

      this.canvas.addEventListener("touchmove", (e) => {
        if (!this.isActive() || this.paused || this.gameOver) return;
        if (this.touchStartX === null) return;
        e.preventDefault();

        const touch = e.touches[0];
        const deltaX = touch.clientX - this.touchStartX;

        // Move player based on swipe
        if (Math.abs(deltaX) > 5) {
          this.player.x += deltaX * 0.3;
          this.player.x = Math.max(this.player.width / 2, Math.min(this.canvas.width - this.player.width / 2, this.player.x));
          this.touchStartX = touch.clientX;
        }
      }, { passive: false });

      this.canvas.addEventListener("touchend", (e) => {
        if (!this.isActive() || this.paused || this.gameOver) return;
        e.preventDefault();

        // Tap to shoot
        if (this.touchStartX !== null && this.touchStartY !== null) {
          const touch = e.changedTouches[0];
          const deltaX = Math.abs(touch.clientX - this.touchStartX);
          const deltaY = Math.abs(touch.clientY - this.touchStartY);

          // If it's a tap (not a swipe), shoot
          if (deltaX < 10 && deltaY < 10) {
            this.shoot();
          }
        }

        this.touchStartX = null;
        this.touchStartY = null;
      }, { passive: false });
    }

    start() {
      if (this.animFrame) return;
      this.loop();
    }

    loop() {
      this.animFrame = requestAnimationFrame(() => this.loop());

      if (!this.isActive()) return;
      if (this.paused) return;

      this.update();
      this.render();
    }

    update() {
      if (this.gameOver) return;

      // Update animation frame counter
      this.animationFrame++;

      // Update stars
      this.stars.forEach((star) => {
        star.y += star.speed;
        if (star.y > this.canvas.height) {
          star.y = 0;
          star.x = Math.random() * this.canvas.width;
        }
      });

      // Player movement
      if (this.keys.left) {
        this.player.x -= this.player.speed;
      }
      if (this.keys.right) {
        this.player.x += this.player.speed;
      }

      // Clamp player position
      this.player.x = Math.max(this.player.width / 2, Math.min(this.canvas.width - this.player.width / 2, this.player.x));

      // Shooting
      if (this.shootCooldown > 0) {
        this.shootCooldown--;
      }

      if (this.keys.space && this.shootCooldown === 0) {
        this.shoot();
      }

      // Update player bullets
      this.playerBullets = this.playerBullets.filter((bullet) => {
        bullet.y -= this.bulletSpeed;
        return bullet.y > -10;
      });

      // Update enemy bullets
      this.enemyBullets = this.enemyBullets.filter((bullet) => {
        bullet.y += this.enemyBulletSpeed;
        return bullet.y < this.canvas.height + 10;
      });

      // Update formation movement
      this.updateFormation();

      // Update diving enemies
      this.updateDivingEnemies();

      // Enemy shooting (only after some time to give player a chance)
      if (this.formationMoveCounter > 120) {
        this.enemyShooting();
      }

      // Collision detection
      this.checkCollisions();

      // Update invincibility
      if (this.invincible) {
        this.invincibleTimer--;
        if (this.invincibleTimer <= 0) {
          this.invincible = false;
        }
      }

      // Update particles
      this.particles = this.particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        return p.life > 0;
      });

      // Check for wave completion
      if (this.enemies.length === 0 && this.divingEnemies.length === 0) {
        this.nextLevel();
      }

      // Update HUD
      this.updateHUD();
    }

    updateFormation() {
      this.formationMoveCounter++;

      // Continuous smooth movement
      const moveSpeed = 0.5;
      this.formationX += moveSpeed * this.formationDir;

      // Check bounds and reverse direction
      const maxX = this.canvas.width - 200;
      const minX = -100;

      if (this.formationX > maxX || this.formationX < minX) {
        this.formationDir *= -1;
        this.formationY += 8; // Move down when changing direction
      }

      // Update enemy positions in formation with slight wave motion
      const waveOffset = Math.sin(this.formationMoveCounter * 0.02) * 3;
      this.enemies.forEach((enemy) => {
        if (!enemy.diving) {
          enemy.x = this.formationX + enemy.formationOffsetX + waveOffset;
          enemy.y = this.formationY + enemy.formationOffsetY;
        }
      });

      // Trigger dive attacks
      this.diveCounter++;
      if (this.diveCounter >= this.diveInterval && this.enemies.length > 0) {
        this.diveCounter = 0;
        this.triggerDive();
      }
    }

    triggerDive() {
      // Select random enemies to dive
      const availableEnemies = this.enemies.filter((e) => !e.diving);
      if (availableEnemies.length === 0) return;

      const numDivers = Math.min(1 + Math.floor(this.level / 3), availableEnemies.length);
      for (let i = 0; i < numDivers; i++) {
        const enemy = availableEnemies[Math.floor(Math.random() * availableEnemies.length)];
        enemy.diving = true;
        enemy.divePhase = 0;
        enemy.diveSpeed = 1.2 + this.level * 0.15; // Much slower dive speed

        // Create dive path (Bezier-like curve)
        enemy.divePath = this.createDivePath(enemy);

        this.divingEnemies.push(enemy);
        availableEnemies.splice(availableEnemies.indexOf(enemy), 1);
      }
    }

    createDivePath(enemy) {
      const startX = enemy.x;
      const startY = enemy.y;
      const playerX = this.player.x;
      const playerY = this.player.y;

      // Create a curved path toward player
      const controlX1 = startX + (Math.random() - 0.5) * 200;
      const controlY1 = startY + 150;
      const controlX2 = playerX + (Math.random() - 0.5) * 100;
      const controlY2 = playerY - 100;

      return {
        startX,
        startY,
        controlX1,
        controlY1,
        controlX2,
        controlY2,
        endX: playerX,
        endY: playerY + 100,
      };
    }

    updateDivingEnemies() {
      this.divingEnemies = this.divingEnemies.filter((enemy) => {
        if (!enemy.diving) return false;

        enemy.divePhase += 0.02 * enemy.diveSpeed;

        if (enemy.divePhase >= 1) {
          // Dive complete, return to formation or continue off-screen
          if (enemy.divePhase >= 1.5) {
            // Return to formation
            enemy.diving = false;
            enemy.x = this.formationX + enemy.formationOffsetX;
            enemy.y = this.formationY + enemy.formationOffsetY;
            return false;
          } else {
            // Loop back up
            const t = (enemy.divePhase - 1) * 2;
            const path = enemy.divePath;
            enemy.x = this.bezier(t, path.endX, path.controlX2, path.controlX1, path.startX);
            enemy.y = this.bezier(t, path.endY, path.controlY2, path.controlY1, path.startY);
          }
        } else {
          // Follow dive path
          const t = enemy.divePhase;
          const path = enemy.divePath;
          enemy.x = this.bezier(t, path.startX, path.controlX1, path.controlX2, path.endX);
          enemy.y = this.bezier(t, path.startY, path.controlY1, path.controlY2, path.endY);
        }

        return true;
      });
    }

    bezier(t, p0, p1, p2, p3) {
      const u = 1 - t;
      return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    }

    enemyShooting() {
      // Diving enemies shoot during dive
      this.divingEnemies.forEach((enemy) => {
        if (Math.random() < 0.008) { // Occasional shots during dive
          this.enemyBullets.push({
            x: enemy.x,
            y: enemy.y + enemy.size / 2,
            width: 4,
            height: 12,
          });
          if (window.AudioKit) window.AudioKit.bad();
        }
      });

      // Formation enemies shoot occasionally (more frequent)
      if (Math.random() < 0.004 * Math.min(this.level, 3)) {
        const shooters = this.enemies.filter((e) => !e.diving);
        if (shooters.length > 0) {
          const shooter = shooters[Math.floor(Math.random() * shooters.length)];
          this.enemyBullets.push({
            x: shooter.x,
            y: shooter.y + shooter.size / 2,
            width: 4,
            height: 12,
          });
          if (window.AudioKit) window.AudioKit.bad();
        }
      }
    }

    shoot() {
      if (this.playerBullets.length >= this.maxPlayerBullets) return;

      this.playerBullets.push({
        x: this.player.x,
        y: this.player.y - this.player.height / 2,
        width: 4,
        height: 12,
      });

      this.shootCooldown = this.shootCooldownMax;

      if (window.AudioKit) window.AudioKit.bounce();
    }

    checkCollisions() {
      // Player bullets vs enemies
      this.playerBullets = this.playerBullets.filter((bullet) => {
        let hit = false;

        this.enemies = this.enemies.filter((enemy) => {
          if (this.rectCollision(bullet, enemy)) {
            hit = true;
            this.score += enemy.points * this.combo;
            this.createExplosion(enemy.x, enemy.y, enemy.color);

            // Remove from diving list if diving
            if (enemy.diving) {
              const idx = this.divingEnemies.indexOf(enemy);
              if (idx !== -1) this.divingEnemies.splice(idx, 1);
            }

            if (window.AudioKit) window.AudioKit.brick();
            return false;
          }
          return true;
        });

        return !hit;
      });

      // Enemy bullets vs player (only if not invincible)
      if (!this.invincible) {
        this.enemyBullets = this.enemyBullets.filter((bullet) => {
          if (this.rectCollision(bullet, this.player)) {
            this.playerHit();
            return false;
          }
          return true;
        });

        // Diving enemies vs player (collision damage)
        this.divingEnemies.forEach((enemy) => {
          if (this.rectCollision(enemy, this.player)) {
            this.playerHit();
            // Remove enemy
            const idx = this.enemies.indexOf(enemy);
            if (idx !== -1) this.enemies.splice(idx, 1);
            const diveIdx = this.divingEnemies.indexOf(enemy);
            if (diveIdx !== -1) this.divingEnemies.splice(diveIdx, 1);
          }
        });
      } else {
        // Still remove bullets even when invincible
        this.enemyBullets = this.enemyBullets.filter((bullet) => {
          return !this.rectCollision(bullet, this.player);
        });
      }
    }

    rectCollision(a, b) {
      const aLeft = a.x - (a.width || a.size) / 2;
      const aRight = a.x + (a.width || a.size) / 2;
      const aTop = a.y - (a.height || a.size) / 2;
      const aBottom = a.y + (a.height || a.size) / 2;

      const bLeft = b.x - (b.width || b.size) / 2;
      const bRight = b.x + (b.width || b.size) / 2;
      const bTop = b.y - (b.height || b.size) / 2;
      const bBottom = b.y + (b.height || b.size) / 2;

      return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
    }

    playerHit() {
      // Don't hit if already invincible
      if (this.invincible) return;

      this.lives--;
      this.combo = 1;
      this.createExplosion(this.player.x, this.player.y, "#00FF00");

      if (window.AudioKit) window.AudioKit.lose();

      if (this.lives <= 0) {
        this.endGame();
      } else {
        // Reset player position
        this.player.x = this.canvas.width / 2;
        this.player.y = this.canvas.height - 60;

        // Clear bullets
        this.enemyBullets = [];
        this.playerBullets = [];

        // Brief invincibility period
        this.invincible = true;
        this.invincibleTimer = 120; // 2 seconds at 60fps

        // Brief pause for visual feedback
        this.paused = true;
        setTimeout(() => {
          this.paused = false;
        }, 800);
      }
    }

    createExplosion(x, y, color) {
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12;
        const speed = Math.random() * 3 + 2;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 30,
          color,
          size: Math.random() * 3 + 2,
        });
      }
    }

    createEnemyFormation() {
      this.enemies = [];
      this.divingEnemies = [];
      this.formationX = this.canvas.width / 2 - 150;
      this.formationY = 60;
      this.formationDir = 1;

      const cols = 8;
      const rows = 5;
      const spacingX = 50;
      const spacingY = 45;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          let type, typeData;

          if (row === 0) {
            type = "boss";
            typeData = this.enemyTypes.boss;
          } else if (row <= 2) {
            type = "butterfly";
            typeData = this.enemyTypes.butterfly;
          } else {
            type = "bee";
            typeData = this.enemyTypes.bee;
          }

          const offsetX = col * spacingX;
          const offsetY = row * spacingY;

          this.enemies.push({
            type,
            x: this.formationX + offsetX,
            y: this.formationY + offsetY,
            formationOffsetX: offsetX,
            formationOffsetY: offsetY,
            size: typeData.size,
            color: typeData.color,
            points: typeData.points,
            diving: false,
          });
        }
      }

      // Increase difficulty with level (more gradual)
      this.diveInterval = Math.max(180, 300 - this.level * 12);
    }

    nextLevel() {
      this.level++;
      this.combo = Math.min(this.combo + 1, 5);

      if (window.AudioKit) window.AudioKit.win();

      this.paused = true;
      this.onShowOverlay({
        title: `Niveau ${this.level}`,
        text: `Bien joué ! Combo x${this.combo}`,
        tiny: "Prépare-toi pour la prochaine vague !",
        primaryText: "Continuer",
        secondaryText: "Menu",
        onPrimary: () => {
          this.onHideOverlay();
          this.createEnemyFormation();
          this.paused = false;
        },
        onSecondary: () => {
          this.onBackToMenu();
        },
      });
    }

    endGame() {
      this.gameOver = true;
      this.paused = true;

      if (window.AudioKit) window.AudioKit.lose();

      this.onShowOverlay({
        title: "Game Over",
        text: `Score final: ${this.score}`,
        tiny: `Niveau atteint: ${this.level}`,
        primaryText: "Rejouer",
        secondaryText: "Menu",
        onPrimary: () => {
          this.resetGame();
          this.launch();
        },
        onSecondary: () => {
          this.onBackToMenu();
        },
      });
    }

    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Clear
      ctx.fillStyle = "#0a0a1a";
      ctx.fillRect(0, 0, w, h);

      // Stars
      ctx.fillStyle = "#ffffff";
      this.stars.forEach((star) => {
        ctx.globalAlpha = 0.6;
        ctx.fillRect(star.x, star.y, star.size, star.size);
      });
      ctx.globalAlpha = 1;

      // Only render sprites if loaded, otherwise use fallback
      if (!this.spritesLoaded) {
        this.renderFallback(ctx);
        return;
      }

      // Player
      this.drawPlayer(ctx);

      // Player bullets (using simple rects for clarity)
      ctx.fillStyle = "#33ff33"; // Greenish
      this.playerBullets.forEach((bullet) => {
        ctx.fillRect(bullet.x - 2, bullet.y - 6, 4, 12);
      });

      // Enemy bullets
      ctx.fillStyle = "#ff3333"; // Reddish
      this.enemyBullets.forEach((bullet) => {
        ctx.fillRect(bullet.x - 2, bullet.y - 6, 4, 12);
      });

      // Enemies
      this.enemies.forEach((enemy) => {
        this.drawEnemy(ctx, enemy);
      });

      // Particles
      this.particles.forEach((p) => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 30;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      });
      ctx.globalAlpha = 1;
    }

    drawSprite(ctx, spriteName, x, y, frameIndex = 0) {
      if (!this.spritesLoaded || !this.sprites[spriteName]) return;

      const sprite = this.sprites[spriteName];
      const frame = Math.min(frameIndex, sprite.frames - 1);
      const sx = sprite.x + (frame * sprite.spacing);
      const sy = sprite.y;

      // Draw with 20% size reduction (scale 0.8)
      const scale = 0.8;
      const destW = sprite.width * scale;
      const destH = sprite.height * scale;

      ctx.drawImage(
        this.spriteSheet,
        sx, sy, sprite.width, sprite.height,
        x - destW / 2, y - destH / 2, destW, destH
      );
    }

    renderFallback(ctx) {
      // Fallback rendering with geometric shapes if sprites not loaded
      // Player
      this.drawPlayerFallback(ctx);

      // Player bullets
      ctx.fillStyle = "#00FF00";
      this.playerBullets.forEach((bullet) => {
        ctx.fillRect(bullet.x - bullet.width / 2, bullet.y - bullet.height / 2, bullet.width, bullet.height);
      });

      // Enemy bullets
      ctx.fillStyle = "#FF0000";
      this.enemyBullets.forEach((bullet) => {
        ctx.fillRect(bullet.x - bullet.width / 2, bullet.y - bullet.height / 2, bullet.width, bullet.height);
      });

      // Enemies
      this.enemies.forEach((enemy) => {
        this.drawEnemyFallback(ctx, enemy);
      });

      // Particles
      this.particles.forEach((p) => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 30;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      });
      ctx.globalAlpha = 1;
    }

    drawPlayer(ctx) {
      const x = this.player.x;
      const y = this.player.y;

      // Flicker when invincible
      if (this.invincible && Math.floor(this.invincibleTimer / 5) % 2 === 0) {
        ctx.globalAlpha = 0.3;
      }

      // Animate player sprite (2 frames)
      const frame = Math.floor(this.animationFrame / 15) % 2;
      this.drawSprite(ctx, "player", x, y, frame);

      ctx.globalAlpha = 1;
    }

    drawPlayerFallback(ctx) {
      const x = this.player.x;
      const y = this.player.y;
      const w = this.player.width;
      const h = this.player.height;

      // Flicker when invincible
      if (this.invincible && Math.floor(this.invincibleTimer / 5) % 2 === 0) {
        ctx.globalAlpha = 0.3;
      }

      // Simple spaceship shape
      ctx.fillStyle = "#00FF00";
      ctx.beginPath();
      ctx.moveTo(x, y - h / 2); // Top point
      ctx.lineTo(x - w / 2, y + h / 2); // Bottom left
      ctx.lineTo(x, y + h / 4); // Middle bottom
      ctx.lineTo(x + w / 2, y + h / 2); // Bottom right
      ctx.closePath();
      ctx.fill();

      // Cockpit
      ctx.fillStyle = "#00FFFF";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    }

    drawEnemy(ctx, enemy) {
      const x = enemy.x;
      const y = enemy.y;

      // Animate enemy sprite (2 frames, slower animation)
      const frame = Math.floor(this.animationFrame / 20) % 2;
      this.drawSprite(ctx, enemy.type, x, y, frame);
    }

    drawEnemyFallback(ctx, enemy) {
      const x = enemy.x;
      const y = enemy.y;
      const size = enemy.size;

      ctx.fillStyle = enemy.color;

      if (enemy.type === "boss") {
        // Boss - larger, more complex
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x - 6, y - 4, 3, 0, Math.PI * 2);
        ctx.arc(x + 6, y - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (enemy.type === "butterfly") {
        // Butterfly - wing shape
        ctx.beginPath();
        ctx.ellipse(x - 8, y, 8, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 8, y, 8, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Bee - simple insect
        ctx.beginPath();
        ctx.ellipse(x, y, size / 2, size / 2.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - size / 4, y);
        ctx.lineTo(x + size / 4, y);
        ctx.stroke();
      }
    }

    updateHUD() {
      if (!this.hud) return;
      this.hud.level.textContent = this.level;
      this.hud.lives.textContent = this.lives;
      this.hud.score.textContent = this.score;
      this.hud.combo.textContent = `x${this.combo}`;
    }

    resetGame() {
      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.combo = 1;
      this.gameOver = false;
      this.paused = true;

      this.player.x = this.canvas.width / 2;
      this.player.y = this.canvas.height - 60;

      this.playerBullets = [];
      this.enemyBullets = [];
      this.particles = [];

      this.createEnemyFormation();
      this.updateHUD();
    }

    launch() {
      this.paused = false;
    }

    pause(state) {
      this.paused = state;
    }

    isPaused() {
      return this.paused;
    }
  }

  window.GalagaGame = GalagaGame;
})();