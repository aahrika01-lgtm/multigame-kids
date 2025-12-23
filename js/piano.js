/* js/piano.js
   Simulateur de piano avec mode apprentissage et support MIDI
*/
(() => {
  // Robust MIDI Parser (Based on Jasmid/standard MIDI spec)
  class MidiParser {
    constructor(arrayBuffer) {
      this.data = new Uint8Array(arrayBuffer);
      this.position = 0;
    }

    readString(length) {
      let str = '';
      for (let i = 0; i < length; i++) str += String.fromCharCode(this.data[this.position++]);
      return str;
    }

    readInt32() {
      return (this.data[this.position++] << 24) | (this.data[this.position++] << 16) |
             (this.data[this.position++] << 8) | this.data[this.position++];
    }

    readInt16() {
      return (this.data[this.position++] << 8) | this.data[this.position++];
    }

    readVarInt() {
      let result = 0;
      while (true) {
        const b = this.data[this.position++];
        if (b & 0x80) {
          result += (b & 0x7F);
          result <<= 7;
        } else {
          result += b;
          return result;
        }
      }
    }

    parse() {
      // Check for valid MIDI header
      if (this.data.length < 14) throw new Error('File too short');
      
      const headerChunk = this.readString(4);
      if (headerChunk !== 'MThd') throw new Error('Invalid MIDI header');
      
      this.readInt32(); // header length (6)
      const format = this.readInt16();
      const trackCount = this.readInt16();
      const timeDivision = this.readInt16();

      const notes = [];
      
      for (let i = 0; i < trackCount; i++) {
        if (this.position >= this.data.length) break;
        
        const trackChunk = this.readString(4);
        if (trackChunk !== 'MTrk') throw new Error('Invalid Track header');
        
        const trackLength = this.readInt32();
        const end = this.position + trackLength;
        
        let ticks = 0; // Absolute tick position within this track
        let runningStatus = null;
        
        while (this.position < end && this.position < this.data.length) {
          ticks += this.readVarInt(); // Delta time added to get absolute time
          
          if (this.position >= this.data.length) break;
          
          let eventType = this.data[this.position];
          
          if ((eventType & 0x80) === 0) {
            if (!runningStatus) {
              // Skip byte if invalid running status (robustness)
              this.position++;
              continue;
            }
            eventType = runningStatus;
          } else {
            this.position++;
            // Only cache channel voice messages for running status
            if (eventType < 0xF0) runningStatus = eventType;
          }
          
          const type = eventType >> 4;
          const channel = eventType & 0x0F;
          
          switch (type) {
            case 0x8: // Note Off
            case 0x9: // Note On
              const note = this.data[this.position++];
              const velocity = this.data[this.position++];
              
              // Note On with velocity > 0 is a real Note On
              // Note On with velocity 0 is treated as Note Off
              const isNoteOn = (type === 0x9) && (velocity > 0);
              
              if (isNoteOn) {
                notes.push({
                  note: this.midiToNoteName(note),
                  midi: note,
                  ticks: ticks, // Store absolute tick time for sorting
                  track: i,
                  channel: channel,
                  type: 'on'
                });
              }
              break;
              
            case 0xA: // Polyphonic Key Pressure
            case 0xB: // Control Change
            case 0xE: // Pitch Bend
              this.position += 2;
              break;
              
            case 0xC: // Program Change
            case 0xD: // Channel Pressure
              this.position += 1;
              break;
              
            case 0xF: // System Common / Real-Time
              if (eventType === 0xFF) { // Meta Event
                const metaType = this.data[this.position++];
                const len = this.readVarInt();
                this.position += len; // Skip meta data
              } else if (eventType === 0xF0 || eventType === 0xF7) { // Sysex
                const len = this.readVarInt();
                this.position += len;
              }
              break;
          }
        }
      }
      
      // Sort all notes by absolute tick time to properly interleave
      // notes from multiple tracks (treble clef + bass clef)
      notes.sort((a, b) => {
        // Primary sort by tick time
        if (a.ticks !== b.ticks) return a.ticks - b.ticks;
        // Secondary sort by MIDI note number (lower notes first for bass clef)
        return a.midi - b.midi;
      });
      
      // Group notes that occur at the same time into chords
      // This handles both hands playing simultaneously
      const groupedNotes = [];
      let currentGroup = null;
      
      for (const n of notes) {
        if (currentGroup === null || n.ticks !== currentGroup.ticks) {
          // Start a new group
          currentGroup = { ticks: n.ticks, notes: [n.note] };
          groupedNotes.push(currentGroup);
        } else {
          // Add to existing group (same tick time = chord)
          currentGroup.notes.push(n.note);
        }
      }
      
      // Return sequence of note arrays for learning (each element can be a chord)
      // Single notes are still arrays with one element for consistency
      return groupedNotes.map(g => ({ notes: g.notes }));
    }

    midiToNoteName(midi) {
      const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const octave = Math.floor(midi / 12) - 1;
      const noteIndex = midi % 12;
      return notes[noteIndex] + octave;
    }
  }

  class PianoGame {
    constructor({ canvas, hud, onShowOverlay, onHideOverlay, onBackToMenu, isActive }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.hud = hud;
      this.onShowOverlay = onShowOverlay;
      this.onHideOverlay = onHideOverlay;
      this.onBackToMenu = onBackToMenu;
      this.isActive = isActive || (() => true);

      // Audio context
      this.audioCtx = null;
      
      // Game state
      this.mode = "free"; // "free", "learn"
      this.currentSong = null;
      this.currentNoteIndex = 0;
      this.score = 0;
      this.waitingForNote = false;
      this.feedback = null;
      this.feedbackTimer = 0;
      this.isDemoPlaying = false; // Flag to block user input during demo
      this.isStepMode = false; // Step-by-step demo mode
      this.demoNoteIndex = 0; // Current note index in demo
      this.demoPaused = false; // Pause state for auto demo

      // Piano keys configuration (Extended range C2 - B6 = 5 octaves = 35 white keys)
      // Width of white key reduced to fit screen (approx 875px width for 35 keys -> 25px)
      const kw = 25; // Key Width (reduced for more keys)
      const kh = 180; // Key Height
      const bkw = 16; // Black Key Width
      const bkh = 110; // Black Key Height
      
      this.keys = [];
      const notes = ["C", "D", "E", "F", "G", "A", "B"];
      const blacks = ["C#", "D#", null, "F#", "G#", "A#", null]; // null for no black key
      
      let xPos = 0;
      
      // Generate keys for Octaves 2, 3, 4, 5, 6 (5 octaves total)
      [2, 3, 4, 5, 6].forEach(octave => {
        notes.forEach((n, i) => {
          const noteName = n + octave;
          // White key
          this.keys.push({
            note: noteName,
            type: "white",
            x: xPos,
            w: kw,
            h: kh,
            key: this.getKeyMap(noteName)
          });
          
          // Black key (if exists)
          const blackNote = blacks[i];
          if (blackNote) {
            const blackName = blackNote + octave;
            this.keys.push({
              note: blackName,
              type: "black",
              x: xPos + kw - (bkw/2),
              w: bkw,
              h: bkh,
              key: this.getKeyMap(blackName)
            });
          }
          
          xPos += kw;
        });
      });

      // Frequencies
      this.frequencies = {};
      const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      for (let i = 0; i < 128; i++) {
        const note = noteNames[i % 12];
        const oct = Math.floor(i / 12) - 1;
        const name = note + oct;
        // A4 is 440Hz (MIDI note 69)
        const freq = 440 * Math.pow(2, (i - 69) / 12);
        this.frequencies[name] = freq;
      }

      // Songs for learning mode (Long versions)
      this.songs = {
        "frere_jacques": {
          name: "Frère Jacques",
          notes: [
            "C4", "D4", "E4", "C4",
            "C4", "D4", "E4", "C4",
            "E4", "F4", "G4",
            "E4", "F4", "G4",
            "G4", "A4", "G4", "F4", "E4", "C4",
            "G4", "A4", "G4", "F4", "E4", "C4",
            "C4", "G4", "C4",
            "C4", "G4", "C4"
          ]
        },
        "au_clair_de_la_lune": {
          name: "Au Clair de la Lune",
          notes: [
            "C4", "C4", "C4", "D4", "E4", "D4",
            "C4", "E4", "D4", "D4", "C4",
            "C4", "C4", "C4", "D4", "E4", "D4",
            "C4", "E4", "D4", "D4", "C4",
            "D4", "D4", "D4", "D4", "A4", "A4",
            "D4", "C4", "B4", "A4", "G4",
            "C4", "C4", "C4", "D4", "E4", "D4",
            "C4", "E4", "D4", "D4", "C4"
          ]
        },
        "fais_dodo": {
          name: "Fais Dodo",
          notes: [
            "E4", "E4", "E4", "C4", "E4", "D4", "E4", "F4", "D4", "C4",
            "E4", "E4", "E4", "C4", "E4", "D4", "E4", "F4", "D4", "C4",
            "F4", "G4", "A4", "G4", "F4", "E4", "F4", "G4", "F4", "E4", "D4",
            "F4", "G4", "A4", "G4", "F4", "E4", "F4", "G4", "F4", "E4", "D4",
            "E4", "E4", "E4", "C4", "E4", "D4", "E4", "F4", "D4", "C4",
            "E4", "E4", "E4", "C4", "E4", "D4", "E4", "F4", "D4", "C4"
          ]
        }
      };

      // Active keys (pressed)
      this.activeKeys = new Set();

      this.animFrame = null;
      this.bindControls();
    }

    initAudio() {
      if (!this.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.audioCtx = new Ctx();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }
    }

    playNote(note, isDemo = false) {
      this.initAudio();
      if (!this.audioCtx) return;

      const freq = this.frequencies[note];
      if (!freq) return;

      const now = this.audioCtx.currentTime;
      
      // Create a more realistic piano sound using multiple harmonics
      // Piano sound is characterized by:
      // 1. Quick attack, longer decay
      // 2. Multiple harmonics that decay at different rates
      // 3. Slight detuning for richness
      // 4. Higher notes decay faster than lower notes
      
      // Calculate decay time based on pitch (higher = shorter decay)
      const midiNote = 12 * Math.log2(freq / 440) + 69;
      const decayTime = Math.max(0.5, 3.0 - (midiNote - 40) * 0.03);
      
      // Master gain for this note
      const masterGain = this.audioCtx.createGain();
      masterGain.connect(this.audioCtx.destination);
      
      // Harmonics configuration: [frequency multiplier, relative amplitude, decay multiplier]
      const harmonics = [
        [1, 1.0, 1.0],      // Fundamental
        [2, 0.5, 0.8],      // 2nd harmonic
        [3, 0.25, 0.6],     // 3rd harmonic
        [4, 0.125, 0.5],    // 4th harmonic
        [5, 0.0625, 0.4],   // 5th harmonic
        [6, 0.03, 0.3],     // 6th harmonic
      ];
      
      const oscillators = [];
      const gains = [];
      
      harmonics.forEach(([mult, amp, decayMult], i) => {
        const harmFreq = freq * mult;
        
        // Skip harmonics above Nyquist frequency
        if (harmFreq > this.audioCtx.sampleRate / 2) return;
        
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        
        // Use sine waves for cleaner piano-like tone
        osc.type = "sine";
        
        // Slight detuning for richness (more for higher harmonics)
        const detune = (Math.random() - 0.5) * 4 * (i + 1);
        osc.frequency.setValueAtTime(harmFreq, now);
        osc.detune.setValueAtTime(detune, now);
        
        // ADSR envelope for each harmonic
        const harmDecay = decayTime * decayMult;
        const peakGain = amp * 0.15; // Overall volume control
        
        gain.gain.setValueAtTime(0, now);
        // Quick attack (piano hammer strike)
        gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
        // Initial fast decay (hammer release)
        gain.gain.exponentialRampToValueAtTime(peakGain * 0.7, now + 0.05);
        // Slower sustain decay
        gain.gain.exponentialRampToValueAtTime(peakGain * 0.3, now + harmDecay * 0.3);
        // Final release
        gain.gain.exponentialRampToValueAtTime(0.0001, now + harmDecay);
        
        osc.connect(gain);
        gain.connect(masterGain);
        
        osc.start(now);
        osc.stop(now + harmDecay + 0.1);
        
        oscillators.push(osc);
        gains.push(gain);
      });
      
      // Add a subtle "thump" for the hammer strike (low frequency transient)
      const thump = this.audioCtx.createOscillator();
      const thumpGain = this.audioCtx.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(freq * 0.5, now);
      thump.frequency.exponentialRampToValueAtTime(freq * 0.25, now + 0.02);
      thumpGain.gain.setValueAtTime(0.1, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      thump.connect(thumpGain);
      thumpGain.connect(masterGain);
      thump.start(now);
      thump.stop(now + 0.1);
      
      // Add subtle noise for attack realism
      const noiseBuffer = this.audioCtx.createBuffer(1, this.audioCtx.sampleRate * 0.05, this.audioCtx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * 0.02;
      }
      const noise = this.audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseGain = this.audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.3, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      noise.connect(noiseGain);
      noiseGain.connect(masterGain);
      noise.start(now);

      // Check song progress (only if not demo mode)
      if (this.mode === "learn" && this.currentSong && !isDemo) {
        const currentStep = this.currentSong.notes[this.currentNoteIndex];
        
        // Handle both old format (string) and new format (array of notes)
        const expectedNotes = Array.isArray(currentStep) ? currentStep : [currentStep];
        
        if (expectedNotes.includes(note)) {
          // Mark this note as played in the current chord
          if (!this.playedNotesInChord) {
            this.playedNotesInChord = new Set();
          }
          this.playedNotesInChord.add(note);
          
          // Check if all notes in the chord have been played
          const allPlayed = expectedNotes.every(n => this.playedNotesInChord.has(n));
          
          if (allPlayed) {
            this.currentNoteIndex++;
            this.score += 10 * expectedNotes.length; // More points for chords
            this.feedback = { text: expectedNotes.length > 1 ? "Accord !" : "Bien !", color: "#00FF00" };
            this.feedbackTimer = 30;
            this.playedNotesInChord = null; // Reset for next chord
            
            if (this.currentNoteIndex >= this.currentSong.notes.length) {
              this.winGame();
            }
          } else {
            // Partial chord - show encouraging feedback
            this.feedback = { text: `${this.playedNotesInChord.size}/${expectedNotes.length}`, color: "#FFFF00" };
            this.feedbackTimer = 30;
          }
        } else {
          this.score = Math.max(0, this.score - 5);
          this.feedback = { text: "Oups !", color: "#FF0000" };
          this.feedbackTimer = 30;
          this.playedNotesInChord = null; // Reset on wrong note
        }
        this.updateHUD();
      }
    }

    winGame() {
      this.onShowOverlay({
        title: "Bravo !",
        text: `Tu as joué ${this.currentSong.name} !`,
        tiny: `Score: ${this.score}`,
        primaryText: "Rejouer",
        secondaryText: "Menu",
        onPrimary: () => {
          this.onHideOverlay();
          this.startSong(this.currentSongKey);
        },
        onSecondary: () => {
          this.onBackToMenu();
        },
      });
    }

    startSong(songKey) {
      this.mode = "learn";
      this.currentSongKey = songKey;
      this.currentSong = this.songs[songKey];
      this.currentNoteIndex = 0;
      this.score = 0;
      this.updateHUD();
      
      // Add a Play button to the overlay interface or HUD if possible,
      // but simpler to show an overlay with options before starting
      this.onShowOverlay({
        title: this.currentSong.name,
        text: "Prêt à apprendre ?",
        tiny: "",
        primaryText: "Jouer moi-même",
        secondaryText: "Écouter démo",
        onPrimary: () => {
          this.onHideOverlay();
        },
        onSecondary: () => {
          this.onHideOverlay();
          this.showDemoOptions();
        }
      });
    }

    showDemoOptions() {
      this.onShowOverlay({
        title: "Mode Démo",
        text: "Choisissez le mode de lecture",
        tiny: "",
        primaryText: "Lecture auto",
        secondaryText: "Pas à pas",
        onPrimary: () => {
          this.onHideOverlay();
          this.playDemo();
        },
        onSecondary: () => {
          this.onHideOverlay();
          this.startStepDemo();
        }
      });
    }

    startStepDemo() {
      if (!this.currentSong) return;
      
      this.isDemoPlaying = true;
      this.isStepMode = true;
      this.demoNoteIndex = 0;
      this.activeKeys.clear();
      
      // Show the first note
      this.showCurrentDemoNote();
    }

    showCurrentDemoNote() {
      if (!this.currentSong || !this.isStepMode) return;
      
      const notes = this.currentSong.notes;
      
      // Clear previous highlights
      this.activeKeys.clear();
      
      if (this.demoNoteIndex >= 0 && this.demoNoteIndex < notes.length) {
        const currentStep = notes[this.demoNoteIndex];
        const notesToShow = Array.isArray(currentStep) ? currentStep : [currentStep];
        
        // Highlight current notes
        notesToShow.forEach(note => {
          this.activeKeys.add(note);
        });
      }
    }

    playCurrentDemoNote() {
      if (!this.currentSong || !this.isStepMode) return;
      
      const notes = this.currentSong.notes;
      
      if (this.demoNoteIndex >= 0 && this.demoNoteIndex < notes.length) {
        const currentStep = notes[this.demoNoteIndex];
        const notesToPlay = Array.isArray(currentStep) ? currentStep : [currentStep];
        
        // Play all notes in the chord
        notesToPlay.forEach(note => {
          this.playNote(note, true);
        });
      }
    }

    stepDemoForward() {
      if (!this.currentSong || !this.isStepMode) return;
      
      const notes = this.currentSong.notes;
      
      if (this.demoNoteIndex < notes.length - 1) {
        this.demoNoteIndex++;
        this.showCurrentDemoNote();
        this.playCurrentDemoNote();
      }
    }

    stepDemoBackward() {
      if (!this.currentSong || !this.isStepMode) return;
      
      if (this.demoNoteIndex > 0) {
        this.demoNoteIndex--;
        this.showCurrentDemoNote();
        this.playCurrentDemoNote();
      }
    }

    exitStepDemo() {
      this.isStepMode = false;
      this.isDemoPlaying = false;
      this.activeKeys.clear();
      this.startSong(this.currentSongKey);
    }

    playDemo() {
      if (!this.currentSong) return;
      
      this.isDemoPlaying = true; // Block user input during demo
      this.isStepMode = false;
      this.demoPaused = false;
      this.activeKeys.clear(); // Clear any user-pressed keys
      this.demoNoteIndex = 0;
      
      const notes = this.currentSong.notes;
      const speed = 500; // ms per note/chord
      
      const playNext = () => {
        // Check if user exited mode or reset
        if (this.mode !== "learn" || !this.currentSong || !this.isDemoPlaying || this.isStepMode) {
          this.isDemoPlaying = false;
          return;
        }
        
        // Check if paused
        if (this.demoPaused) {
          setTimeout(playNext, 100);
          return;
        }
        
        if (this.demoNoteIndex >= notes.length) {
          // End of demo
          this.isDemoPlaying = false;
          setTimeout(() => {
             this.startSong(this.currentSongKey); // Go back to start menu
          }, 1000);
          return;
        }
        
        const currentStep = notes[this.demoNoteIndex];
        // Handle both old format (string) and new format (array of notes)
        const notesToPlay = Array.isArray(currentStep) ? currentStep : [currentStep];
        
        // Play all notes in the chord simultaneously
        notesToPlay.forEach(note => {
          this.playNote(note, true); // true = automated play (don't advance score)
          // Highlight key visually
          this.activeKeys.add(note);
        });
        
        // Remove highlights after delay
        setTimeout(() => {
          notesToPlay.forEach(note => this.activeKeys.delete(note));
        }, speed * 0.8);
        
        this.demoNoteIndex++;
        setTimeout(playNext, speed);
      };
      
      playNext();
    }

    toggleDemoPause() {
      this.demoPaused = !this.demoPaused;
    }

    resetGame() {
      this.mode = "free";
      this.currentSong = null;
      this.currentNoteIndex = 0;
      this.score = 0;
      this.activeKeys.clear();
      
      // Show menu to pick song
      this.onShowOverlay({
        title: "Piano",
        text: "Choisis une chanson à apprendre",
        tiny: "Ou joue librement",
        primaryText: "Mode Libre",
        secondaryText: "Apprendre",
        onPrimary: () => {
          this.onHideOverlay();
          this.mode = "free";
        },
        onSecondary: () => {
          this.showSongSelection();
        }
      });
    }

    showSongSelection() {
      // Create a hidden file input for MIDI upload if it doesn't exist
      if (!document.getElementById('midiInput')) {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'midiInput';
        input.accept = '.mid,.midi';
        input.style.display = 'none';
        input.addEventListener('change', (e) => this.handleMidiUpload(e));
        document.body.appendChild(input);
      }

      this.onShowOverlay({
        title: "Chansons",
        text: "1. Frère Jacques\n2. Au Clair de la Lune\n3. Fais Dodo\n4. Importer MIDI",
        tiny: "Appuie sur 1-4",
        primaryText: "Retour",
        secondaryText: "",
        onPrimary: () => {
          this.resetGame();
        },
        onSecondary: null
      });
      
      // Temporary key listener for selection
      const handler = (e) => {
        if (e.key === "1") {
          document.removeEventListener("keydown", handler);
          this.onHideOverlay();
          this.startSong("frere_jacques");
        } else if (e.key === "2") {
          document.removeEventListener("keydown", handler);
          this.onHideOverlay();
          this.startSong("au_clair_de_la_lune");
        } else if (e.key === "3") {
          document.removeEventListener("keydown", handler);
          this.onHideOverlay();
          this.startSong("fais_dodo");
        } else if (e.key === "4") {
          document.removeEventListener("keydown", handler);
          document.getElementById('midiInput').click();
        }
      };
      document.addEventListener("keydown", handler);
    }

    handleMidiUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          // Parse MIDI file using the new Robust MidiParser
          const parser = new MidiParser(e.target.result);
          const notes = parser.parse();
          
          if (!notes || notes.length === 0) throw new Error("No notes found");

          // Extract note arrays (chords) - new format from parser
          const noteArrays = notes.map(n => n.notes);
          
          this.songs["custom_midi"] = {
            name: file.name.replace(/\.mid(i)?$/i, ""),
            notes: noteArrays
          };
          
          this.onHideOverlay();
          this.startSong("custom_midi");
          
        } catch (err) {
          console.error("Error parsing MIDI", err);
          this.onShowOverlay({
            title: "Erreur",
            text: "Fichier MIDI invalide ou corrompu.",
            tiny: "Format standard requis",
            primaryText: "OK",
            onPrimary: () => this.showSongSelection(),
            onSecondary: null
          });
        }
      };
      reader.readAsArrayBuffer(file);
    }

    start() {
      if (this.animFrame) return;
      this.loop();
    }

    loop() {
      this.animFrame = requestAnimationFrame(() => this.loop());
      if (!this.isActive()) return;
      
      this.render();
    }

    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Background
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, w, h);

      // Centering offset (Keyboard width is 35 white keys * 25px = 875px)
      const keyboardWidth = 35 * 25;
      const offsetX = (w - keyboardWidth) / 2;
      const offsetY = 100;

      // Draw Keys
      // First draw all white keys
      this.keys.forEach(key => {
        if (key.type === "white") {
          this.drawKey(ctx, key, offsetX, offsetY);
        }
      });
      // Then black keys on top
      this.keys.forEach(key => {
        if (key.type === "black") {
          this.drawKey(ctx, key, offsetX, offsetY);
        }
      });

      // Draw feedback
      if (this.feedback && this.feedbackTimer > 0) {
        ctx.fillStyle = this.feedback.color;
        ctx.font = "bold 40px Arial";
        ctx.textAlign = "center";
        ctx.fillText(this.feedback.text, w / 2, 80);
        this.feedbackTimer--;
      }

      // Draw Song Info
      if (this.mode === "learn" && this.currentSong) {
        ctx.fillStyle = "#FFF";
        ctx.font = "24px Arial";
        ctx.textAlign = "left";
        ctx.fillText(`Chanson: ${this.currentSong.name}`, 20, 40);
        
        // Draw progress bar and controls for demo mode
        if (this.isDemoPlaying) {
          const notes = this.currentSong.notes;
          const totalNotes = notes.length;
          const currentNote = this.demoNoteIndex;
          
          // Progress bar background
          const barX = 20;
          const barY = h - 60;
          const barWidth = w - 40;
          const barHeight = 20;
          
          ctx.fillStyle = "#444";
          ctx.fillRect(barX, barY, barWidth, barHeight);
          
          // Progress bar fill
          const progress = currentNote / totalNotes;
          ctx.fillStyle = "#4169E1";
          ctx.fillRect(barX, barY, barWidth * progress, barHeight);
          
          // Progress bar border
          ctx.strokeStyle = "#FFF";
          ctx.lineWidth = 2;
          ctx.strokeRect(barX, barY, barWidth, barHeight);
          
          // Progress text
          ctx.fillStyle = "#FFF";
          ctx.font = "16px Arial";
          ctx.textAlign = "center";
          ctx.fillText(`${currentNote} / ${totalNotes}`, w / 2, barY + 15);
          
          // Controls info
          ctx.font = "14px Arial";
          ctx.textAlign = "center";
          
          if (this.isStepMode) {
            ctx.fillText("← Précédent | → Suivant | Espace: Jouer | Échap: Quitter", w / 2, barY - 15);
          } else {
            ctx.fillText("Espace: Pause/Reprendre | Échap: Quitter", w / 2, barY - 15);
            
            // Show pause indicator
            if (this.demoPaused) {
              ctx.fillStyle = "#FFD700";
              ctx.font = "bold 20px Arial";
              ctx.fillText("⏸ PAUSE", w / 2, barY - 40);
            }
          }
        }
      }
    }

    // Helper to determine if a note is left hand (bass clef) or right hand (treble clef)
    // Notes below C4 (MIDI 60) are typically left hand
    isLeftHand(noteName) {
      const match = noteName.match(/([A-G]#?)(\d+)/);
      if (!match) return false;
      const octave = parseInt(match[2]);
      const note = match[1];
      // C4 and above = right hand, below C4 = left hand
      if (octave < 4) return true;
      if (octave > 4) return false;
      // Octave 4: only notes below C4 are left hand (but C4 itself is right hand)
      return false; // C4 and above in octave 4 are right hand
    }

    drawKey(ctx, keyObj, ox, oy) {
      const isPressed = this.activeKeys.has(keyObj.note);
      
      // Check if this key is a target (handle both string and array formats)
      // Only show targets when NOT in demo mode (user needs to play)
      let isTarget = false;
      if (this.mode === "learn" && this.currentSong && this.currentNoteIndex < this.currentSong.notes.length && !this.isDemoPlaying) {
        const currentStep = this.currentSong.notes[this.currentNoteIndex];
        const expectedNotes = Array.isArray(currentStep) ? currentStep : [currentStep];
        isTarget = expectedNotes.includes(keyObj.note);
      }

      let color = keyObj.type === "white" ? "#FFF" : "#000";
      
      if (isPressed) {
        // In demo mode: use different colors for left/right hand
        // In user play mode: use neutral gray
        if (this.isDemoPlaying) {
          if (this.isLeftHand(keyObj.note)) {
            color = "#4169E1"; // Royal Blue for left hand
          } else {
            color = "#FF69B4"; // Hot Pink for right hand
          }
        } else {
          color = "#AAA"; // Neutral gray for user input
        }
      } else if (isTarget) {
        // Blink target key with different colors for left/right hand (only when user plays)
        const blink = Math.floor(Date.now() / 300) % 2 === 0;
        if (blink) {
          // Left hand (bass clef) = Blue, Right hand (treble clef) = Pink/Magenta
          if (this.isLeftHand(keyObj.note)) {
            color = "#4169E1"; // Royal Blue for left hand
          } else {
            color = "#FF69B4"; // Hot Pink for right hand
          }
        }
      }

      ctx.fillStyle = color;
      ctx.fillRect(ox + keyObj.x, oy, keyObj.w, keyObj.h);
      
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + keyObj.x, oy, keyObj.w, keyObj.h);

      // Key label (keyboard shortcut)
      if (keyObj.type === "white") {
        ctx.fillStyle = "#888";
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText(keyObj.key.toUpperCase(), ox + keyObj.x + keyObj.w/2, oy + keyObj.h - 20);
      }
    }

    getKeyMap(note) {
      // Mapping AZERTY/QWERTY keys to piano range (approximate middle range)
      const map = {
        "C3": "w", "C#3": "s", "D3": "x", "D#3": "d", "E3": "c", "F3": "v", "F#3": "g", "G3": "b", "G#3": "h", "A3": "n", "A#3": "j", "B3": ",",
        "C4": "a", "C#4": "z", "D4": "z", "D#4": "e", "E4": "e", "F4": "r", "F#4": "t", "G4": "t", "G#4": "y", "A4": "y", "A#4": "u", "B4": "u", // Overlap/Simplified
        // Extended range not fully mapped to keyboard to avoid conflicts, focus on C4-C5 for typing
      };
      // Better mapping for C4 octave (main playable area)
      if (note === "C4") return "q";
      if (note === "D4") return "s";
      if (note === "E4") return "d";
      if (note === "F4") return "f";
      if (note === "G4") return "g";
      if (note === "A4") return "h";
      if (note === "B4") return "j";
      if (note === "C5") return "k";
      if (note === "D5") return "l";
      if (note === "E5") return "m";
      
      if (note === "C#4") return "z";
      if (note === "D#4") return "e";
      if (note === "F#4") return "t";
      if (note === "G#4") return "y";
      if (note === "A#4") return "u";
      
      return "";
    }

    bindControls() {
      const getNoteFromKey = (k) => {
        const found = this.keys.find(obj => obj.key === k.toLowerCase());
        return found ? found.note : null;
      };

      const getNoteFromPoint = (x, y) => {
        const w = this.canvas.width;
        // Same calculation as in render()
        const keyboardWidth = 35 * 25; // 35 white keys * 25px width
        const ox = (w - keyboardWidth) / 2;
        const oy = 100;
        
        // Check black keys first (on top)
        for (const k of this.keys) {
          if (k.type === "black") {
            if (x >= ox + k.x && x <= ox + k.x + k.w &&
                y >= oy && y <= oy + k.h) {
              return k.note;
            }
          }
        }
        // Then white keys
        for (const k of this.keys) {
          if (k.type === "white") {
            if (x >= ox + k.x && x <= ox + k.x + k.w &&
                y >= oy && y <= oy + k.h) {
              return k.note;
            }
          }
        }
        return null;
      };

      window.addEventListener("keydown", (e) => {
        if (!this.isActive()) return;
        
        // Handle demo controls
        if (this.isDemoPlaying) {
          if (e.key === "Escape") {
            e.preventDefault();
            if (this.isStepMode) {
              this.exitStepDemo();
            } else {
              this.isDemoPlaying = false;
              this.startSong(this.currentSongKey);
            }
            return;
          }
          
          if (this.isStepMode) {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              this.stepDemoForward();
              return;
            }
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              this.stepDemoBackward();
              return;
            }
            if (e.key === " ") {
              e.preventDefault();
              this.playCurrentDemoNote();
              return;
            }
          } else {
            if (e.key === " ") {
              e.preventDefault();
              this.toggleDemoPause();
              return;
            }
          }
          return; // Block other user input during demo
        }
        
        const note = getNoteFromKey(e.key);
        if (note && !this.activeKeys.has(note)) {
          this.activeKeys.add(note);
          this.playNote(note);
        }
      });

      window.addEventListener("keyup", (e) => {
        if (!this.isActive()) return;
        if (this.isDemoPlaying) return; // Block user input during demo
        const note = getNoteFromKey(e.key);
        if (note) {
          this.activeKeys.delete(note);
        }
      });

      // Mouse/Touch
      const handleStart = (e) => {
        if (!this.isActive()) return;
        e.preventDefault();
        if (this.isDemoPlaying) return; // Block user input during demo - after preventDefault
        const rect = this.canvas.getBoundingClientRect();
        // Handle multi-touch or single mouse
        const touches = e.touches || [{ clientX: e.clientX, clientY: e.clientY }];
        
        for (let i = 0; i < touches.length; i++) {
            const x = (touches[i].clientX - rect.left) * (this.canvas.width / rect.width);
            const y = (touches[i].clientY - rect.top) * (this.canvas.height / rect.height);
            const note = getNoteFromPoint(x, y);
            if (note) {
                this.activeKeys.add(note);
                this.playNote(note);
            }
        }
      };

      const handleEnd = (e) => {
        if (!this.isActive()) return;
        e.preventDefault();
        if (this.isDemoPlaying) return; // Block user input during demo - after preventDefault
        this.activeKeys.clear(); // Simple release all for now to avoid stuck keys
      };

      this.canvas.addEventListener("mousedown", handleStart);
      this.canvas.addEventListener("mouseup", handleEnd);
      this.canvas.addEventListener("touchstart", handleStart, {passive: false});
      this.canvas.addEventListener("touchend", handleEnd, {passive: false});
    }

    updateHUD() {
      if (!this.hud) return;
      this.hud.level.textContent = this.mode === "learn" ? "Appr." : "Libre";
      this.hud.score.textContent = this.score;
      this.hud.lives.textContent = "-";
      this.hud.combo.textContent = "-";
    }

    launch() {
      this.resetGame();
    }

    pause(state) {
      this.paused = state;
    }

    isPaused() {
      return this.paused;
    }
  }

  window.PianoGame = PianoGame;
})();