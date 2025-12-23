/* js/audio.js
   Petits sons "jouet" via WebAudio (pas de fichiers).
   Démarre seulement après un geste utilisateur (règles navigateurs).
*/
(() => {
  class AudioManager {
    constructor() {
      this.enabled = true;
      this.ctx = null;
      this.master = null;
      this._unlocked = false;
      this.volume = 0.65;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
    }

    toggle() {
      this.setEnabled(!this.enabled);
      return this.enabled;
    }

    async unlock() {
      if (this._unlocked) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);

      // "Warm up" (silence) to unlock on iOS-like browsers
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.01);

      this._unlocked = true;
      if (this.ctx.state === "suspended") {
        try { await this.ctx.resume(); } catch { /* ignore */ }
      }
    }

    _tone({ freq = 440, dur = 0.08, type = "sine", gain = 0.35, slideTo = null }) {
      if (!this.enabled || !this.ctx || !this.master) return;

      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + dur);

      // Envelope simple (attack/release)
      const a = Math.min(0.02, dur * 0.25);
      const r = Math.min(0.06, dur * 0.6);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + r, dur));

      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    // Sons très courts et lisibles
    bounce() { this._tone({ freq: 520, dur: 0.05, type: "triangle", gain: 0.20, slideTo: 420 }); }
    paddle() { this._tone({ freq: 320, dur: 0.06, type: "square", gain: 0.12, slideTo: 260 }); }
    brick() { this._tone({ freq: 780, dur: 0.045, type: "sine", gain: 0.18, slideTo: 980 }); }
    powerUp() { this._tone({ freq: 740, dur: 0.10, type: "triangle", gain: 0.22, slideTo: 1040 }); }
    bad() { this._tone({ freq: 240, dur: 0.12, type: "sawtooth", gain: 0.14, slideTo: 140 }); }
    win() { this._tone({ freq: 660, dur: 0.12, type: "triangle", gain: 0.22, slideTo: 990 }); setTimeout(() => this._tone({ freq: 990, dur: 0.12, type: "triangle", gain: 0.20, slideTo: 1320 }), 120); }
    lose() { this._tone({ freq: 220, dur: 0.16, type: "sine", gain: 0.18, slideTo: 140 }); setTimeout(() => this._tone({ freq: 160, dur: 0.16, type: "sine", gain: 0.16, slideTo: 110 }), 140); }

    // --- Pac‑Man oriented SFX (still "toy" synth; no files) ---
    pacPellet() { this._tone({ freq: 940, dur: 0.030, type: "square", gain: 0.10, slideTo: 760 }); }
    pacPowerPellet() { this._tone({ freq: 520, dur: 0.12, type: "triangle", gain: 0.20, slideTo: 920 }); }
    pacEatGhost() { this._tone({ freq: 720, dur: 0.08, type: "sawtooth", gain: 0.16, slideTo: 1120 }); }
    pacFruit() { this._tone({ freq: 880, dur: 0.09, type: "triangle", gain: 0.16, slideTo: 1320 }); }
    pacDeath() { this._tone({ freq: 300, dur: 0.20, type: "sine", gain: 0.18, slideTo: 120 }); setTimeout(() => this._tone({ freq: 180, dur: 0.18, type: "sine", gain: 0.14, slideTo: 90 }), 120); }

    // --- Galaga oriented SFX ---
    galagaShoot() { this._tone({ freq: 880, dur: 0.06, type: "square", gain: 0.15, slideTo: 1320 }); }
    galagaExplosion() { this._tone({ freq: 440, dur: 0.10, type: "sawtooth", gain: 0.18, slideTo: 220 }); setTimeout(() => this._tone({ freq: 220, dur: 0.08, type: "sawtooth", gain: 0.14, slideTo: 110 }), 80); }
    galagaDive() { this._tone({ freq: 660, dur: 0.08, type: "triangle", gain: 0.12, slideTo: 440 }); }
    galagaHit() { this._tone({ freq: 320, dur: 0.14, type: "sine", gain: 0.16, slideTo: 160 }); }
  }

  // Background music:
  // - file based (mp3) for Snake/BrickBreaker
  // - procedural (WebAudio) for Pac‑Man: "procedural:pacman"
  class MusicManager {
    constructor() {
      this.enabled = true;
      this.audio = null;        // HTMLAudioElement (file music)
      this.currentSrc = null;   // string
      this.volume = 0.35;

      // procedural engine
      this._proc = {
        id: null,
        gain: null,
        timer: null,
        nextTime: 0,
        lookAhead: 0.18,
        intervalMs: 60,
      };
    }

    _isProcedural(src) {
      return typeof src === "string" && src.startsWith("procedural:");
    }

    _getAudioCtx() {
      // Reuse AudioKit context so user gesture unlock applies
      return window.AudioKit && window.AudioKit.ctx ? window.AudioKit.ctx : null;
    }

    _ensureProcGain(ctx) {
      if (this._proc.gain && this._proc.gain.context === ctx) return this._proc.gain;

      const g = ctx.createGain();
      g.gain.value = this.enabled ? 0.26 : 0;
      g.connect(ctx.destination);

      this._proc.gain = g;
      return g;
    }

    _stopProcedural() {
      if (this._proc.timer) {
        clearInterval(this._proc.timer);
        this._proc.timer = null;
      }
      this._proc.id = null;
      this._proc.nextTime = 0;
      if (this._proc.gain) this._proc.gain.gain.value = 0;
    }

    _scheduleTone(ctx, outGain, t0, { freq, dur = 0.12, type = "square", gain = 0.22 }) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);

      // simple envelope
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g);
      g.connect(outGain);

      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    _startProcedural(id) {
      const ctx = this._getAudioCtx();
      if (!ctx) return;

      // stop file-based music if any
      if (this.audio) {
        try { this.audio.pause(); } catch { /* ignore */ }
      }

      // restart if different id
      this._stopProcedural();
      this.currentSrc = id;

      const outGain = this._ensureProcGain(ctx);
      outGain.gain.value = this.enabled ? 0.26 : 0;

      // Different patterns for different games
      let stepDur, pattern;

      if (id === "procedural:galaga") {
        // Galaga-style arcade loop
        stepDur = 0.16;
        pattern = [523, 659, 784, 659, 523, 659, 784, 880]; // C5-E5-G5-E5 ascending feel
      } else {
        // Default arcade siren pattern
        stepDur = 0.14;
        pattern = [659, 784, 659, 784, 622, 740, 622, 740]; // E5/G5 -> D#5/F#5 feel
      }

      this._proc.id = id;
      this._proc.nextTime = Math.max(ctx.currentTime + 0.04, this._proc.nextTime || 0);

      let step = 0;

      const tick = () => {
        if (!this.enabled) return;

        const tNow = ctx.currentTime;
        while (this._proc.nextTime < tNow + this._proc.lookAhead) {
          const freq = pattern[step % pattern.length];
          this._scheduleTone(ctx, outGain, this._proc.nextTime, {
            freq,
            dur: stepDur * 0.92,
            type: "square",
            gain: 0.14,
          });

          this._proc.nextTime += stepDur;
          step += 1;
        }
      };

      this._proc.timer = setInterval(tick, this._proc.intervalMs);
      tick();
    }

    _ensureAudio(src) {
      const targetSrc = src || this.currentSrc || "./zelda.mp3";

      // If we already have this track loaded, reuse it
      if (this.audio && this.currentSrc === targetSrc) return this.audio;

      // Otherwise, stop old and load new
      if (this.audio) {
        try { this.audio.pause(); } catch { /* ignore */ }
      }

      const a = new Audio(targetSrc);
      a.preload = "auto";
      a.loop = true;
      a.volume = this.enabled ? this.volume : 0;

      this.audio = a;
      this.currentSrc = targetSrc;
      return a;
    }

    setEnabled(on) {
      this.enabled = !!on;

      if (!this.enabled) {
        // pause everything
        if (this.audio) this.audio.pause();
        this._stopProcedural();
        return;
      }

      // re-enable volumes (resume is driven by app.js calling play())
      if (this.audio) this.audio.volume = this.volume;
      if (this._proc.gain) this._proc.gain.gain.value = 0.26;
    }

    toggle() {
      this.setEnabled(!this.enabled);
      return this.enabled;
    }

    async play(src) {
      if (!this.enabled) return;

      if (this._isProcedural(src)) {
        this._startProcedural(src);
        return;
      }

      // stop procedural when switching to file
      if (this._proc.timer || this._isProcedural(this.currentSrc)) this._stopProcedural();

      const a = this._ensureAudio(src);
      try {
        await a.play(); // may be blocked without user gesture; ignore
      } catch {
        /* ignore autoplay rejection */
      }
    }

    pause() {
      if (this._isProcedural(this.currentSrc)) {
        this._stopProcedural();
        return;
      }
      if (!this.audio) return;
      this.audio.pause();
    }

    stop() {
      if (this._isProcedural(this.currentSrc)) {
        this._stopProcedural();
        this.currentSrc = null;
        return;
      }
      if (!this.audio) return;
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }

  window.AudioKit = new AudioManager();
  window.MusicKit = new MusicManager();
})();