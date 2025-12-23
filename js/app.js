/* js/app.js
   Navigation UI "caméra enfant" + glue code avec le jeu.
*/
(() => {
  const $ = (sel) => document.querySelector(sel);

  const elMenu = $("#menuPanel");
  const elGame = $("#gamePanel");
  const elOverlay = $("#overlay");

  const elTitle = $("#screenTitle");
  const elBottom = $("#bottomText");

  const btnBack = $("#btnBack");
  const btnSound = $("#btnSound");
  const btnPause = $("#btnPause");

  const btnGameBrick = $("#btnGameBrick");
  const btnGameSnake = $("#btnGameSnake");
  const btnGamePacman = $("#btnGamePacman");
  const btnGameGalaga = $("#btnGameGalaga");
  const btnGamePiano = $("#btnGamePiano");
  const btnGameTetris = $("#btnGameTetris");

  const hud = {
    level: $("#hudLevel"),
    lives: $("#hudLives"),
    score: $("#hudScore"),
    combo: $("#hudCombo"),
  };

  const canvas = $("#gameCanvas");

  const btnLeft = $("#btnLeft");
  const btnRight = $("#btnRight");
  const btnLaunch = $("#btnLaunch");
  const elMobileControls = $(".mobileControls");

  const overlayEls = {
    title: $("#overlayTitle"),
    text: $("#overlayText"),
    tiny: $("#overlayTiny"),
    primary: $("#btnOverlayPrimary"),
    secondary: $("#btnOverlaySecondary"),
  };

  let game = null;       // BrickBreakerGame
  let snakeGame = null;  // SnakeGame
  let pacmanGame = null; // PacmanGame
  let galagaGame = null; // GalagaGame
  let pianoGame = null; // PianoGame
  let tetrisGame = null; // TetrisGame
  let activeGame = "menu"; // menu | brick | snake | pacman | galaga | piano | tetris
  let overlayHandlers = { primary: null, secondary: null };

  function setScreen({ title, bottom }) {
    if (title != null) elTitle.textContent = title;
    if (bottom != null) elBottom.textContent = bottom;
  }

  function showMenu() {
    // Stop any movement when returning to menu (prevents "drifting" if a key was stuck)
    if (game) {
      game.setMoveDir(0);
      game.pause(true);
    }
    if (snakeGame) snakeGame.pause(true);
    if (pacmanGame) pacmanGame.pause(true);
    if (galagaGame) galagaGame.pause(true);
    if (pianoGame) pianoGame.pause(true);
    if (tetrisGame) tetrisGame.pause(true);

    // Stop background music when leaving a game
    if (window.MusicKit) window.MusicKit.pause();

    activeGame = "menu";

    if (elMobileControls) elMobileControls.style.display = "";
    elGame.classList.add("isHidden");
    elMenu.classList.remove("isHidden");
    hideOverlay();
    setScreen({ title: "Jeux classiques", bottom: "Sélectionne un jeu" });
    btnBack.disabled = true;
    btnPause.disabled = true;
  }

  function showGame({ title, bottom, showMobileControls }) {
    elMenu.classList.add("isHidden");
    elGame.classList.remove("isHidden");
    setScreen({ title, bottom });
    btnBack.disabled = false;
    btnPause.disabled = false;

    // Brick Breaker has dedicated buttons; Snake uses swipe/keyboard.
    if (elMobileControls) elMobileControls.style.display = showMobileControls ? "" : "none";
  }

  function showOverlay({ title, text, tiny, primaryText, secondaryText, onPrimary, onSecondary, customContent }) {
    // When an overlay is shown, gameplay is effectively paused: stop movement.
    if (game) game.setMoveDir(0);

    overlayEls.title.textContent = title || "";
    overlayEls.tiny.textContent = tiny || "";
    
    // Handle custom content (for touch-friendly buttons like song selection)
    if (customContent) {
      overlayEls.text.textContent = "";
      overlayEls.text.appendChild(customContent);
      // Hide default buttons when using custom content
      overlayEls.primary.style.display = "none";
      overlayEls.secondary.style.display = "none";
    } else {
      overlayEls.text.textContent = text || "";
      overlayEls.primary.textContent = primaryText || "OK";
      overlayEls.secondary.textContent = secondaryText || "Menu";
      // Show/hide buttons based on handlers
      overlayEls.primary.style.display = onPrimary ? "" : "none";
      overlayEls.secondary.style.display = onSecondary ? "" : "none";
    }
    
    overlayHandlers.primary = onPrimary || null;
    overlayHandlers.secondary = onSecondary || null;
    elOverlay.classList.remove("isHidden");
  }

  function hideOverlay() {
    elOverlay.classList.add("isHidden");
    overlayHandlers.primary = null;
    overlayHandlers.secondary = null;
    
    // Clean up any custom content and restore button visibility
    overlayEls.text.textContent = "";
    overlayEls.primary.style.display = "";
    overlayEls.secondary.style.display = "";
  }

  function lockAudioOnce() {
    // Les navigateurs exigent un geste utilisateur pour démarrer l’audio.
    // On "unlock" dès le premier clic/tap/clavier.
    if (!window.AudioKit) return;
    window.AudioKit.unlock();
  }

  function setSoundButton(enabled) {
    btnSound.textContent = enabled ? "🔊" : "🔇";
    btnSound.setAttribute("aria-label", enabled ? "Son activé" : "Son coupé");
  }

  function bindGlobalUnlock() {
    const unlock = () => lockAudioOnce();
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  function initGameIfNeeded() {
    if (game) return;

    if (!window.BrickBreakerGame) {
      console.error("BrickBreakerGame manquant. Vérifie js/brickbreaker.js");
      return;
    }

    game = new window.BrickBreakerGame({
      canvas,
      hud,
      onShowOverlay: showOverlay,
      onHideOverlay: hideOverlay,
      onBackToMenu: () => {
        showMenu();
      },
    });

    game.start(); // boucle de rendu (jeu en attente tant que pas lancé)
  }

  function initSnakeIfNeeded() {
    if (snakeGame) return;

    if (!window.SnakeGame) {
      console.error("SnakeGame manquant. Vérifie js/snake.js");
      return;
    }

    snakeGame = new window.SnakeGame({
      canvas,
      hud,
      onShowOverlay: showOverlay,
      onHideOverlay: hideOverlay,
      onBackToMenu: () => showMenu(),
      isActive: () => activeGame === "snake",
    });

    snakeGame.start();
  }

  function initPacmanIfNeeded() {
    if (pacmanGame) return;

    if (!window.PacmanGame) {
      console.error("PacmanGame manquant. Vérifie js/pacman.js");
      return;
    }

    pacmanGame = new window.PacmanGame({
      canvas,
      hud,
      onShowOverlay: showOverlay,
      onHideOverlay: hideOverlay,
      onBackToMenu: () => showMenu(),
      isActive: () => activeGame === "pacman",
    });

    pacmanGame.start();
  }

  function initGalagaIfNeeded() {
    if (galagaGame) return;

    if (!window.GalagaGame) {
      console.error("GalagaGame manquant. Vérifie js/galaga.js");
      return;
    }

    galagaGame = new window.GalagaGame({
      canvas,
      hud,
      onShowOverlay: showOverlay,
      onHideOverlay: hideOverlay,
      onBackToMenu: () => showMenu(),
      isActive: () => activeGame === "galaga",
    });

    galagaGame.start();
  }

  function initPianoIfNeeded() {
    if (pianoGame) return;

    if (!window.PianoGame) {
      console.error("PianoGame manquant. Vérifie js/piano.js");
      return;
    }

    pianoGame = new window.PianoGame({
      canvas,
      hud,
      onShowOverlay: showOverlay,
      onHideOverlay: hideOverlay,
      onBackToMenu: () => showMenu(),
      isActive: () => activeGame === "piano",
    });

    pianoGame.start();
  }

  function initTetrisIfNeeded() {
    if (tetrisGame) return;

    if (!window.TetrisGame) {
      console.error("TetrisGame manquant. Vérifie js/tetris.js");
      return;
    }

    tetrisGame = new window.TetrisGame({
      canvas,
      hud,
      onShowOverlay: showOverlay,
      onHideOverlay: hideOverlay,
      onBackToMenu: () => showMenu(),
      isActive: () => activeGame === "tetris",
    });

    tetrisGame.start();
  }

  function startBrickBreaker() {
    activeGame = "brick";
    initGameIfNeeded();

    if (snakeGame) snakeGame.pause(true);
    if (window.MusicKit) window.MusicKit.pause();

    showGame({ title: "Casse-briques", bottom: "Casse les briques !", showMobileControls: true });

    game.resetAndStartLevel(1);
    showOverlay({
      title: "Prêt ?",
      text: "Glisse pour bouger. Appuie sur GO !",
      tiny: "Clavier: ◀ ▶ — Espace = GO — P = pause",
      primaryText: "GO !",
      secondaryText: "Menu",
      onPrimary: async () => {
        // Start background music for Brick Breaker (requires user gesture)
        if (window.AudioKit) await window.AudioKit.unlock();
        if (window.MusicKit) await window.MusicKit.play("./forest.mp3");

        hideOverlay();
        game.launch();
      },
      onSecondary: () => {
        if (window.MusicKit) window.MusicKit.pause();
        game.pause(true);
        showMenu();
      },
    });
  }

  function startSnake() {
    activeGame = "snake";
    initSnakeIfNeeded();

    if (game) {
      game.setMoveDir(0);
      game.pause(true);
    }
    if (pacmanGame) pacmanGame.pause(true);
    if (galagaGame) galagaGame.pause(true);
    if (pianoGame) pianoGame.pause(true);
    if (tetrisGame) tetrisGame.pause(true);

    showGame({ title: "Snake", bottom: "Mange les boules rouges !", showMobileControls: false });

    snakeGame.resetAndStart();
    showOverlay({
      title: "Prêt ?",
      text: "Attrape les boules rouges 🍎",
      tiny: "Flèches / ZQSD — Swipe — M = mode mur",
      primaryText: "GO !",
      secondaryText: "Menu",
      onPrimary: async () => {
        // Start background music for Snake (requires user gesture)
        if (window.AudioKit) await window.AudioKit.unlock();
        if (window.MusicKit) await window.MusicKit.play("./zelda.mp3");

        hideOverlay();
        snakeGame.launch();
      },
      onSecondary: () => {
        if (window.MusicKit) window.MusicKit.pause();
        snakeGame.pause(true);
        showMenu();
      },
    });
  }

  function startPacman() {
    activeGame = "pacman";
    initPacmanIfNeeded();

    if (game) {
      game.setMoveDir(0);
      game.pause(true);
    }
    if (snakeGame) snakeGame.pause(true);
    if (galagaGame) galagaGame.pause(true);
    if (pianoGame) pianoGame.pause(true);
    if (tetrisGame) tetrisGame.pause(true);

    showGame({ title: "Ms. Pac‑Man", bottom: "Mange toutes les pastilles !", showMobileControls: false });

    pacmanGame.resetGame();
    showOverlay({
      title: "Prêt ?",
      text: "Mange toutes les pastilles !",
      tiny: "Flèches / ZQSD — Swipe — Espace/Entrée = GO",
      primaryText: "GO !",
      secondaryText: "Menu",
      onPrimary: async () => {
        // Start Pac‑Man music (file-based)
        if (window.AudioKit) await window.AudioKit.unlock();
        if (window.MusicKit) await window.MusicKit.play("./pacman.mp3");

        hideOverlay();
        pacmanGame.launch();
      },
      onSecondary: () => {
        if (window.MusicKit) window.MusicKit.pause();
        pacmanGame.pause(true);
        showMenu();
      },
    });
  }

  function startGalaga() {
    activeGame = "galaga";
    initGalagaIfNeeded();

    if (game) {
      game.setMoveDir(0);
      game.pause(true);
    }
    if (snakeGame) snakeGame.pause(true);
    if (pacmanGame) pacmanGame.pause(true);

    showGame({ title: "Galaga", bottom: "Détruis les aliens !", showMobileControls: false });

    galagaGame.resetGame();
    showOverlay({
      title: "Prêt ?",
      text: "Détruis tous les aliens !",
      tiny: "Flèches / ZQSD — Espace = tirer — P = pause",
      primaryText: "GO !",
      secondaryText: "Menu",
      onPrimary: async () => {
        // Start Galaga music (procedural)
        if (window.AudioKit) await window.AudioKit.unlock();
        if (window.MusicKit) await window.MusicKit.play("procedural:galaga");

        hideOverlay();
        galagaGame.launch();
      },
      onSecondary: () => {
        if (window.MusicKit) window.MusicKit.pause();
        galagaGame.pause(true);
        showMenu();
      },
    });
  }

  function startPiano() {
    activeGame = "piano";
    initPianoIfNeeded();

    if (game) {
      game.setMoveDir(0);
      game.pause(true);
    }
    if (snakeGame) snakeGame.pause(true);
    if (pacmanGame) pacmanGame.pause(true);
    if (galagaGame) galagaGame.pause(true);
    if (tetrisGame) tetrisGame.pause(true);

    // Stop background music for Piano (it makes its own sound)
    if (window.MusicKit) window.MusicKit.pause();

    showGame({ title: "Piano", bottom: "Joue de la musique !", showMobileControls: false });

    pianoGame.resetGame();
    // No initial overlay needed, resetGame handles it
  }

  function startTetris() {
    activeGame = "tetris";
    initTetrisIfNeeded();

    if (game) {
      game.setMoveDir(0);
      game.pause(true);
    }
    if (snakeGame) snakeGame.pause(true);
    if (pacmanGame) pacmanGame.pause(true);
    if (galagaGame) galagaGame.pause(true);
    if (pianoGame) pianoGame.pause(true);

    showGame({ title: "Tetris", bottom: "Complète les lignes !", showMobileControls: false });

    tetrisGame.resetGame();
    showOverlay({
      title: "Prêt ?",
      text: "Complète les lignes !",
      tiny: "Flèches / ZQSD — Espace = chute — P = pause",
      primaryText: "GO !",
      secondaryText: "Menu",
      onPrimary: async () => {
        // Start background music for Tetris (requires user gesture)
        if (window.AudioKit) await window.AudioKit.unlock();
        if (window.MusicKit) await window.MusicKit.play("./tetris.mp3");

        hideOverlay();
        tetrisGame.launch();
      },
      onSecondary: () => {
        if (window.MusicKit) window.MusicKit.pause();
        tetrisGame.pause(true);
        showMenu();
      },
    });
  }

  // Menu controls (simple)
  btnGameBrick.addEventListener("click", () => startBrickBreaker());
  btnGameSnake.addEventListener("click", () => startSnake());
  if (btnGamePacman) btnGamePacman.addEventListener("click", () => startPacman());
  if (btnGameGalaga) btnGameGalaga.addEventListener("click", () => startGalaga());
  if (btnGamePiano) btnGamePiano.addEventListener("click", () => startPiano());
  if (btnGameTetris) btnGameTetris.addEventListener("click", () => startTetris());

  // Back button
  btnBack.addEventListener("click", () => {
    if (activeGame === "brick") {
      if (!game) return showMenu();
      game.setMoveDir(0);
      game.pause(true);
    } else if (activeGame === "snake") {
      if (!snakeGame) return showMenu();
      snakeGame.pause(true);
    } else if (activeGame === "pacman") {
      if (!pacmanGame) return showMenu();
      pacmanGame.pause(true);
    } else if (activeGame === "galaga") {
      if (!galagaGame) return showMenu();
      galagaGame.pause(true);
    } else if (activeGame === "piano") {
      if (!pianoGame) return showMenu();
      pianoGame.pause(true);
    } else if (activeGame === "tetris") {
      if (!tetrisGame) return showMenu();
      tetrisGame.pause(true);
    } else {
      return showMenu();
    }

    showOverlay({
      title: "Retour",
      text: "Quitter la partie ?",
      tiny: "",
      primaryText: "Oui",
      secondaryText: "Non",
      onPrimary: () => {
        hideOverlay();
        showMenu();
      },
      onSecondary: () => {
        hideOverlay();
        if (activeGame === "brick" && game) game.pause(false);
        if (activeGame === "snake" && snakeGame) snakeGame.pause(false);
        if (activeGame === "pacman" && pacmanGame) pacmanGame.pause(false);
        if (activeGame === "galaga" && galagaGame) galagaGame.pause(false);
        if (activeGame === "piano" && pianoGame) pianoGame.pause(false);
        if (activeGame === "tetris" && tetrisGame) tetrisGame.pause(false);
      },
    });
  });

  // Sound toggle (SFX + background music)
  btnSound.addEventListener("click", async () => {
    if (window.AudioKit) await window.AudioKit.unlock();

    // Toggle SFX
    const enabled = window.AudioKit ? window.AudioKit.toggle() : true;
    setSoundButton(enabled);

    // Keep background music in sync with SFX toggle
    if (window.MusicKit) window.MusicKit.setEnabled(enabled);

    if (!window.MusicKit) return;

    if (!enabled) {
      window.MusicKit.pause();
      return;
    }

    // If sound is re-enabled while already in a game, resume the right track
    if (activeGame === "brick") {
      await window.MusicKit.play("./forest.mp3");
    } else if (activeGame === "snake") {
      await window.MusicKit.play("./zelda.mp3");
    } else if (activeGame === "pacman") {
      await window.MusicKit.play("./pacman.mp3");
    } else if (activeGame === "galaga") {
      await window.MusicKit.play("procedural:galaga");
    } else if (activeGame === "piano") {
      // No background music for piano
      window.MusicKit.pause();
    } else if (activeGame === "tetris") {
      await window.MusicKit.play("./tetris.mp3");
    } else {
      window.MusicKit.pause();
    }
  });

  // Pause button
  btnPause.addEventListener("click", () => {
    if (activeGame === "snake") {
      if (!snakeGame) return;

      if (snakeGame.isPaused()) {
        hideOverlay();
        snakeGame.pause(false);
        return;
      }

      snakeGame.pause(true);
      showOverlay({
        title: "Pause",
        text: "On fait une pause 🙂",
        tiny: "Appuie sur Continuer",
        primaryText: "Continuer",
        secondaryText: "Menu",
        onPrimary: () => {
          hideOverlay();
          snakeGame.pause(false);
        },
        onSecondary: () => {
          hideOverlay();
          showMenu();
        },
      });
      return;
    }

    if (activeGame === "pacman") {
      if (!pacmanGame) return;

      if (pacmanGame.isPaused()) {
        hideOverlay();
        pacmanGame.pause(false);
        return;
      }

      pacmanGame.pause(true);
      showOverlay({
        title: "Pause",
        text: "On fait une pause 🙂",
        tiny: "Appuie sur Continuer",
        primaryText: "Continuer",
        secondaryText: "Menu",
        onPrimary: () => {
          hideOverlay();
          pacmanGame.pause(false);
        },
        onSecondary: () => {
          hideOverlay();
          showMenu();
        },
      });
      return;
    }

    if (activeGame === "galaga") {
      if (!galagaGame) return;

      if (galagaGame.isPaused()) {
        hideOverlay();
        galagaGame.pause(false);
        return;
      }

      galagaGame.pause(true);
      showOverlay({
        title: "Pause",
        text: "On fait une pause 🙂",
        tiny: "Appuie sur Continuer",
        primaryText: "Continuer",
        secondaryText: "Menu",
        onPrimary: () => {
          hideOverlay();
          galagaGame.pause(false);
        },
        onSecondary: () => {
          hideOverlay();
          showMenu();
        },
      });
      return;
    }

    if (activeGame === "piano") {
      if (!pianoGame) return;
      // Piano handles its own pause logic or just doesn't need it
      showOverlay({
        title: "Menu",
        text: "Quitter le piano ?",
        tiny: "",
        primaryText: "Continuer",
        secondaryText: "Menu",
        onPrimary: () => {
          hideOverlay();
        },
        onSecondary: () => {
          hideOverlay();
          showMenu();
        }
      });
      return;
    }

    if (activeGame === "tetris") {
      if (!tetrisGame) return;

      if (tetrisGame.isPaused()) {
        hideOverlay();
        tetrisGame.pause(false);
        return;
      }

      tetrisGame.pause(true);
      showOverlay({
        title: "Pause",
        text: "On fait une pause 🙂",
        tiny: "Appuie sur Continuer",
        primaryText: "Continuer",
        secondaryText: "Menu",
        onPrimary: () => {
          hideOverlay();
          tetrisGame.pause(false);
        },
        onSecondary: () => {
          hideOverlay();
          showMenu();
        },
      });
      return;
    }

    // Default: Brick Breaker
    if (!game) return;
    if (game.isPaused()) {
      hideOverlay();
      game.pause(false);
      return;
    }
    game.setMoveDir(0);
    game.pause(true);
    showOverlay({
      title: "Pause",
      text: "On fait une pause 🙂",
      tiny: "Appuie sur Continuer",
      primaryText: "Continuer",
      secondaryText: "Menu",
      onPrimary: () => {
        hideOverlay();
        game.pause(false);
      },
      onSecondary: () => {
        hideOverlay();
        showMenu();
      },
    });
  });

  // Overlay buttons
  overlayEls.primary.addEventListener("click", () => overlayHandlers.primary && overlayHandlers.primary());
  overlayEls.secondary.addEventListener("click", () => overlayHandlers.secondary && overlayHandlers.secondary());

  // Mobile big buttons (hold)
  const hold = (btn, dir) => {
    let holding = false;
    const start = (e) => {
      e.preventDefault();
      if (!game) return;
      holding = true;
      game.setMoveDir(dir);
    };
    const end = (e) => {
      e.preventDefault();
      if (!game) return;
      holding = false;
      game.setMoveDir(0);
    };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("pointerleave", () => holding && end(new Event("pointerleave")));
  };

  hold(btnLeft, -1);
  hold(btnRight, 1);

  btnLaunch.addEventListener("click", () => {
    if (!game) return;
    hideOverlay();
    game.launch();
  });

  // Keyboard shortcuts
  // Track key state to avoid "stuck" / "cancels other key" issues.
  // (Only relevant for Brick Breaker; Snake listens to keyboard inside js/snake.js)
  const keyState = { left: false, right: false };

  const resetMoveDir = () => {
    keyState.left = false;
    keyState.right = false;
    if (game) game.setMoveDir(0);
  };

  // If the tab/app loses focus, keyup may never fire -> prevent "moves by itself"
  window.addEventListener("blur", resetMoveDir);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetMoveDir();
  });

  const syncMoveDir = () => {
    if (!game) return;
    if (activeGame !== "brick") {
      game.setMoveDir(0);
      return;
    }

    // Only apply movement when the game panel is visible
    if (elGame && elGame.classList.contains("isHidden")) {
      game.setMoveDir(0);
      return;
    }

    // If an overlay is visible, don't allow movement
    if (elOverlay && !elOverlay.classList.contains("isHidden")) {
      game.setMoveDir(0);
      return;
    }

    // If the game is paused, force stop
    if (game.isPaused && game.isPaused()) {
      game.setMoveDir(0);
      return;
    }

    const dir = (keyState.right ? 1 : 0) + (keyState.left ? -1 : 0);
    game.setMoveDir(dir);
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (elMenu && !elMenu.classList.contains("isHidden")) return;
      btnPause.click();
      return;
    }
    if (e.key.toLowerCase() === "p") {
      if (activeGame === "brick" && game) {
        btnPause.click();
      } else if (activeGame === "snake" && snakeGame) {
        btnPause.click();
      } else if (activeGame === "pacman" && pacmanGame) {
        btnPause.click();
      } else if (activeGame === "galaga" && galagaGame) {
        btnPause.click();
      } else if (activeGame === "piano") {
        btnPause.click();
      } else if (activeGame === "tetris" && tetrisGame) {
        btnPause.click();
      }
      return;
    }

    // Sur le menu: Entrée/Espace = jouer (on lance le premier jeu)
    if ((e.key === "Enter" || e.key === " ") && elMenu && !elMenu.classList.contains("isHidden")) {
      e.preventDefault();
      startBrickBreaker();
      return;
    }

    // Brick movement only when Brick is active
    if (activeGame === "brick" && game) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        keyState.left = true;
        syncMoveDir();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        keyState.right = true;
        syncMoveDir();
      }
    }

    if (e.key === " " || e.key === "Enter") {
      // Space/Enter = GO si overlay visible, sinon GO du jeu actif
      if (!elOverlay.classList.contains("isHidden")) {
        e.preventDefault();
        overlayHandlers.primary && overlayHandlers.primary();
        return;
      }

      if (activeGame === "brick" && game) {
        game.launch();
        return;
      }
      if (activeGame === "snake" && snakeGame) {
        snakeGame.launch();
        return;
      }
      if (activeGame === "pacman" && pacmanGame) {
        pacmanGame.launch();
        return;
      }
      if (activeGame === "galaga" && galagaGame) {
        galagaGame.launch();
        return;
      }
      if (activeGame === "piano" && pianoGame) {
        // Piano space action handled internally or not needed
        return;
      }
      if (activeGame === "tetris" && tetrisGame) {
        // Tetris space action handled internally (hard drop)
        return;
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    // Only for Brick Breaker
    if (!game) return;
    if (activeGame !== "brick") return;

    if (e.key === "ArrowLeft") {
      keyState.left = false;
      syncMoveDir();
    }
    if (e.key === "ArrowRight") {
      keyState.right = false;
      syncMoveDir();
    }
  });

  // Initial state
  bindGlobalUnlock();
  setSoundButton(true);
  showMenu();
})();