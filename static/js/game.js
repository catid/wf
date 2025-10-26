(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const hudScore = document.getElementById("score");
  const hudMessage = document.getElementById("message");

  const DPR = window.devicePixelRatio || 1;
  const DEFAULT_TIMINGS = {
    laser: { warmup: 2.4, duration: 0.05 },
    coreLaser: { warmup: 0.35, duration: 0.08 },
  };
  // Expose a mutable config so overall game and weapon pacing are easy to tune.
  const GAME_CONFIG = {
    timeScale: 0.5,
    timings: {
      laser: { ...DEFAULT_TIMINGS.laser },
      coreLaser: { ...DEFAULT_TIMINGS.coreLaser },
    },
  };
  window.__WF_GAME_CONFIG__ = GAME_CONFIG;

  function resolveTiming(key) {
    const defaults = DEFAULT_TIMINGS[key];
    const overrides = (GAME_CONFIG.timings && GAME_CONFIG.timings[key]) || {};
    return {
      warmup: typeof overrides.warmup === "number" ? overrides.warmup : defaults.warmup,
      duration: typeof overrides.duration === "number" ? overrides.duration : defaults.duration,
    };
  }

  const FRAME_TIME = 1 / 60;

  function resizeCanvas() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * DPR);
    canvas.height = Math.floor(height * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    clone() {
      return new Vec2(this.x, this.y);
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
    add(v) {
      this.x += v.x;
      this.y += v.y;
      return this;
    }
    sub(v) {
      this.x -= v.x;
      this.y -= v.y;
      return this;
    }
    scale(s) {
      this.x *= s;
      this.y *= s;
      return this;
    }
    length() {
      return Math.hypot(this.x, this.y);
    }
    normalize() {
      const len = this.length();
      if (len > 1e-6) {
        this.scale(1 / len);
      }
      return this;
    }
    setLength(len) {
      return this.normalize().scale(len);
    }
    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = this.x * cos - this.y * sin;
      const y = this.x * sin + this.y * cos;
      this.x = x;
      this.y = y;
      return this;
    }
    static fromAngle(angle, length = 1) {
      return new Vec2(Math.cos(angle) * length, Math.sin(angle) * length);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getTimeScale() {
    const value = typeof GAME_CONFIG.timeScale === "number" ? GAME_CONFIG.timeScale : 1;
    return clamp(value, 0.05, 10);
  }

  function scaleDelta(rawDt) {
    return rawDt * getTimeScale();
  }

  function frameDecay(baseFactor, dt) {
    if (dt <= 0) return 1;
    const factor = clamp(baseFactor, 0, 1);
    return Math.pow(factor, dt / FRAME_TIME);
  }

  class SFXEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
      this.enabled = false;
    }
    unlock() {
      if (this.enabled) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.buildNoiseBuffer();
        this.enabled = true;
      } catch (error) {
        console.warn("Audio init failed:", error);
      }
    }
    buildNoiseBuffer() {
      if (!this.ctx) return null;
      const duration = 1.5;
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i += 1) {
        channel[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }
    withContext(callback) {
      if (!this.enabled || !this.ctx || !this.master) return false;
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      callback(this.ctx, this.ctx.currentTime);
      return true;
    }
    oscBurst(layers, opts = {}) {
      this.withContext((ctx, baseTime) => {
        const startTime = baseTime + (opts.offset || 0);
        const duration = opts.duration ?? 0.2;
        const attack = opts.attack ?? 0.005;
        layers.forEach((layer) => {
          const osc = ctx.createOscillator();
          osc.type = layer.type || "sine";
          const startFreq = layer.frequency || 440;
          osc.frequency.setValueAtTime(startFreq, startTime);
          const slideTarget =
            layer.pitchEnd ??
            (layer.pitchSlide !== undefined
              ? startFreq + layer.pitchSlide
              : opts.pitchSlide
              ? startFreq + opts.pitchSlide
              : null);
          if (slideTarget !== null && slideTarget !== undefined) {
            osc.frequency.linearRampToValueAtTime(Math.max(20, slideTarget), startTime + duration);
          }
          const gain = ctx.createGain();
          const level = Math.max(0.001, (layer.level ?? 0.3) * (opts.intensity ?? 1));
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(level, startTime + attack);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
          osc.connect(gain).connect(this.master);
          osc.start(startTime);
          osc.stop(startTime + duration + 0.05);
        });
      });
    }
    noiseBurst(opts = {}) {
      this.withContext((ctx, baseTime) => {
        const startTime = baseTime + (opts.offset || 0);
        const duration = opts.duration ?? 0.35;
        if (!this.noiseBuffer) {
          this.noiseBuffer = this.buildNoiseBuffer();
        }
        if (!this.noiseBuffer) return;
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.playbackRate.value = opts.rate ?? (0.85 + Math.random() * 0.3);
        const filter = ctx.createBiquadFilter();
        filter.type = opts.filter || "lowpass";
        const startFreq = opts.startFreq ?? 1600;
        const endFreq = opts.endFreq ?? 220;
        filter.frequency.setValueAtTime(startFreq, startTime);
        filter.frequency.exponentialRampToValueAtTime(Math.max(50, endFreq), startTime + duration);
        const gain = ctx.createGain();
        const level = (opts.level ?? 0.4) * (opts.intensity ?? 1);
        gain.gain.setValueAtTime(level, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        source.connect(filter).connect(gain).connect(this.master);
        source.start(startTime);
        source.stop(startTime + duration + 0.05);
      });
    }
    playBulletFire(strength = 1) {
      const detune = (Math.random() - 0.5) * 110;
      this.oscBurst(
        [
          { type: "square", frequency: 840 + detune, level: 0.28 * strength, pitchEnd: 520 + detune * 0.2 },
          { type: "triangle", frequency: 620 + detune * 0.5, level: 0.2 * strength, pitchEnd: 360 },
        ],
        { duration: 0.16, attack: 0.004 }
      );
    }
    playBulletImpact() {
      this.noiseBurst({ duration: 0.24, startFreq: 3200, endFreq: 400, level: 0.5 });
    }
    playMissileLaunch(count = 1) {
      const intensity = clamp(0.6 + count * 0.15, 0.6, 1.2);
      const base = 220 + Math.random() * 90;
      this.oscBurst(
        [
          { type: "sawtooth", frequency: base, level: 0.25 * intensity, pitchEnd: base * 2.4 },
          { type: "triangle", frequency: base * 0.6, level: 0.18 * intensity, pitchEnd: base * 1.8 },
        ],
        { duration: 0.5, attack: 0.01 }
      );
      this.noiseBurst({ duration: 0.38, startFreq: 1400, endFreq: 500, level: 0.25 * intensity });
    }
    playLaserFire() {
      this.oscBurst(
        [
          { type: "square", frequency: 1600, level: 0.25, pitchEnd: 4000 },
          { type: "triangle", frequency: 900, level: 0.16, pitchEnd: 1800 },
        ],
        { duration: 0.18, attack: 0.002 }
      );
      this.noiseBurst({ duration: 0.12, filter: "bandpass", startFreq: 6000, endFreq: 1400, level: 0.22 });
    }
    playWarning() {
      // Relay clack + capacitor sizzle before the siren spins up.
      this.oscBurst(
        [
          { type: "triangle", frequency: 1450, level: 0.22, pitchEnd: 520 },
          { type: "square", frequency: 980, level: 0.18, pitchEnd: 420 },
        ],
        { duration: 0.18, attack: 0.0015 }
      );
      this.noiseBurst({
        duration: 0.2,
        filter: "highpass",
        startFreq: 5200,
        endFreq: 1800,
        level: 0.32,
        offset: 0.02,
      });

      const cycles = 3;
      const spacing = 0.52;
      for (let i = 0; i < cycles; i += 1) {
        const offset = 0.15 + i * spacing;
        const intensity = 0.85 + i * 0.08;
        // Downward bark.
        this.oscBurst(
          [
            { type: "square", frequency: 920, level: 0.48 * intensity, pitchEnd: 360 },
            { type: "sawtooth", frequency: 620, level: 0.34 * intensity, pitchEnd: 280 },
          ],
          { duration: 0.42, attack: 0.008, offset }
        );
        // Rising reply for a classic two-tone klaxon feel.
        this.oscBurst(
          [
            { type: "square", frequency: 420, level: 0.4 * intensity, pitchEnd: 780 },
            { type: "triangle", frequency: 300, level: 0.27 * intensity, pitchEnd: 620 },
          ],
          { duration: 0.38, attack: 0.007, offset: offset + 0.22 }
        );
        this.noiseBurst({
          duration: 0.34,
          filter: "bandpass",
          startFreq: 3400,
          endFreq: 420,
          level: 0.45 * intensity,
          offset: offset + 0.05,
        });
      }

      const tailOffset = 0.15 + cycles * spacing;
      // Air bleeding from vents between cycles.
      this.noiseBurst({
        duration: 0.9,
        filter: "bandpass",
        startFreq: 1800,
        endFreq: 210,
        level: 0.5,
        offset: tailOffset - 0.2,
      });
      // Sub-bass rumble to make the warning feel weighty.
      this.oscBurst(
        [
          { type: "triangle", frequency: 260, level: 0.32, pitchEnd: 110 },
          { type: "square", frequency: 210, level: 0.24, pitchEnd: 90 },
        ],
        { duration: 1.2, attack: 0.02, offset: tailOffset - 0.05 }
      );
    }
    playBossExplosion() {
      // Initial crack + debris spray
      this.noiseBurst({
        duration: 0.9,
        startFreq: 6800,
        endFreq: 420,
        level: 0.85,
        filter: "bandpass",
      });
      // Expanding fireball roar
      this.noiseBurst({
        duration: 2.3,
        startFreq: 2400,
        endFreq: 70,
        level: 0.75,
        filter: "lowpass",
        offset: 0.15,
      });
      // Rolling sub-bass shockwaves
      this.oscBurst(
        [
          { type: "triangle", frequency: 220, level: 0.38, pitchEnd: 80 },
          { type: "sawtooth", frequency: 140, level: 0.32, pitchEnd: 50 },
        ],
        { duration: 2.8, attack: 0.02 }
      );
      // Metallic shrapnel shimmers
      this.oscBurst(
        [
          { type: "square", frequency: 620, level: 0.22, pitchEnd: 280 },
          { type: "triangle", frequency: 880, level: 0.16, pitchEnd: 360 },
        ],
        { duration: 1.2, attack: 0.005, offset: 0.35 }
      );
      // Secondary blast to match lingering animation glow
      this.noiseBurst({
        duration: 1.4,
        startFreq: 1800,
        endFreq: 110,
        level: 0.52,
        filter: "bandpass",
        offset: 0.8,
      });
    }
    playPlayerDamage() {
      this.oscBurst(
        [
          { type: "triangle", frequency: 420, level: 0.3, pitchEnd: 180 },
          { type: "square", frequency: 560, level: 0.18, pitchEnd: 260 },
        ],
        { duration: 0.4, attack: 0.005 }
      );
    }
  }

  const MUSIC_TRACKS = [
    "static/audio/Endless Inferno.mp3",
    "static/audio/Galactic Inferno.mp3",
    "static/audio/Starfire Collision.mp3",
    "static/audio/Void Barrage.mp3",
  ];

  class MusicPlayer {
    constructor(tracks) {
      this.tracks = tracks.slice();
      this.audio = null;
      this.index = this.tracks.length > 0 ? Math.floor(Math.random() * this.tracks.length) : 0;
      this.started = false;
      this.volume = 0.4;
      this.resumeTimer = null;
    }
    start() {
      if (this.started || this.tracks.length === 0) return;
      this.started = true;
      this.playCurrent();
    }
    playCurrent() {
      if (!this.started || this.tracks.length === 0) return;
      if (this.audio) {
        this.audio.pause();
        this.audio = null;
      }
      const src = this.tracks[this.index % this.tracks.length];
      const audio = new Audio(src);
      audio.loop = false;
      audio.preload = "auto";
      audio.volume = this.volume;
      audio.addEventListener("ended", () => {
        this.advance();
      });
      audio.addEventListener("error", () => {
        this.advance();
      });
      audio
        .play()
        .then(() => {
          this.audio = audio;
        })
        .catch(() => {
          this.started = false;
        });
      this.audio = audio;
    }
    advance() {
      this.index = (this.index + 1) % this.tracks.length;
      this.playCurrent();
    }
    stop() {
      if (this.resumeTimer) {
        clearTimeout(this.resumeTimer);
        this.resumeTimer = null;
      }
      if (this.audio) {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.audio = null;
      }
      this.started = false;
    }
    scheduleStart(delay = 0) {
      if (this.resumeTimer) {
        clearTimeout(this.resumeTimer);
        this.resumeTimer = null;
      }
      const wait = Math.max(0, delay);
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null;
        this.start();
      }, wait);
    }
    queueNext(delay = 0) {
      if (this.tracks.length === 0) return;
      this.index = (this.index + 1) % this.tracks.length;
      this.stop();
      this.scheduleStart(delay);
    }
  }

  const AUDIO = new SFXEngine();
  window.__WF_AUDIO__ = AUDIO;
  const MUSIC = new MusicPlayer(MUSIC_TRACKS);
  const engageAudioSystems = () => {
    AUDIO.unlock();
    MUSIC.start();
  };
  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, engageAudioSystems, { once: true });
  });

  function lerpAngle(current, target, maxStep) {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    diff = clamp(diff, -maxStep, maxStep);
    return current + diff;
  }

  function wrapAngle(angle) {
    while (angle <= -Math.PI) angle += Math.PI * 2;
    while (angle > Math.PI) angle -= Math.PI * 2;
    return angle;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function closestPointOnSegment(point, a, b) {
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const abLenSq = abX * abX + abY * abY;
    if (abLenSq <= 1e-6) return a.clone();
    const apX = point.x - a.x;
    const apY = point.y - a.y;
    const t = clamp((apX * abX + apY * abY) / abLenSq, 0, 1);
    return new Vec2(a.x + abX * t, a.y + abY * t);
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(Math.abs(radius), Math.abs(width) / 2, Math.abs(height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function circlePolygonCollision(circlePos, radius, polygon) {
    if (polygon.length === 0) return false;
    if (pointInPolygon(circlePos, polygon)) {
      return true;
    }
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const closest = closestPointOnSegment(circlePos, a, b);
      const dist = closest.clone().sub(circlePos).length();
      if (dist <= radius) {
        return true;
      }
    }
    return false;
  }

  class Input {
    constructor(canvas) {
      this.keys = new Set();
      this.pointerActive = false;
      this.pointerId = null;
      this.pointerOrigin = new Vec2();
      this.pointerDir = new Vec2();
      this.interactionQueued = false;
      this.canvas = canvas;

      window.addEventListener(
        "keydown",
        (e) => {
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
            e.preventDefault();
          }
          const wasDown = this.keys.has(e.code);
          this.keys.add(e.code);
          if (!wasDown) {
            this.queueInteraction();
          }
        },
        { passive: false }
      );
      window.addEventListener("keyup", (e) => {
        this.keys.delete(e.code);
      });
      window.addEventListener("blur", () => {
        this.keys.clear();
        this.resetPointer();
      });

      if (canvas) {
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        if (window.PointerEvent) {
          canvas.addEventListener("pointerdown", (e) => this.handlePointerDown(e), { passive: false });
          canvas.addEventListener("pointermove", (e) => this.handlePointerMove(e), { passive: false });
          canvas.addEventListener("pointerup", (e) => this.handlePointerUp(e));
          canvas.addEventListener("pointercancel", (e) => this.handlePointerUp(e));
        } else {
          canvas.addEventListener(
            "touchstart",
            (e) => {
              if (e.changedTouches.length === 0) return;
              const touch = e.changedTouches[0];
              if (!this.startPointer(touch.identifier, touch.clientX, touch.clientY)) return;
              this.queueInteraction();
              this.updatePointerVector(touch.clientX, touch.clientY);
              e.preventDefault();
            },
            { passive: false }
          );
          canvas.addEventListener(
            "touchmove",
            (e) => {
              if (!this.pointerActive || e.changedTouches.length === 0) return;
              for (let i = 0; i < e.changedTouches.length; i += 1) {
                const touch = e.changedTouches[i];
                if (touch.identifier === this.pointerId) {
                  this.updatePointerVector(touch.clientX, touch.clientY);
                  e.preventDefault();
                  break;
                }
              }
            },
            { passive: false }
          );
          const endTouch = (e) => {
            if (!this.pointerActive || e.changedTouches.length === 0) return;
            for (let i = 0; i < e.changedTouches.length; i += 1) {
              const touch = e.changedTouches[i];
              if (touch.identifier === this.pointerId) {
                this.resetPointer();
                e.preventDefault();
                break;
              }
            }
          };
          canvas.addEventListener("touchend", endTouch, { passive: false });
          canvas.addEventListener("touchcancel", endTouch, { passive: false });
        }
      }
    }
    queueInteraction() {
      this.interactionQueued = true;
    }
    consumeInteraction() {
      if (this.interactionQueued) {
        this.interactionQueued = false;
        return true;
      }
      return false;
    }
    isDown(code) {
      return this.keys.has(code);
    }
    startPointer(id, x, y) {
      if (this.pointerActive) return false;
      this.pointerActive = true;
      this.pointerId = id;
      this.pointerOrigin.set(x, y);
      this.pointerDir.set(0, 0);
      return true;
    }
    updatePointerVector(x, y) {
      if (!this.pointerActive) return;
      const delta = new Vec2(x, y).sub(this.pointerOrigin);
      const deadZone = 8;
      if (delta.length() < deadZone) {
        this.pointerDir.set(0, 0);
      } else {
        delta.setLength(1);
        this.pointerDir.set(delta.x, delta.y);
      }
    }
    resetPointer() {
      this.pointerActive = false;
      this.pointerId = null;
      this.pointerDir.set(0, 0);
    }
    handlePointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!this.startPointer(e.pointerId, e.clientX, e.clientY)) return;
      this.queueInteraction();
      try {
        if (this.canvas && this.canvas.setPointerCapture) {
          this.canvas.setPointerCapture(e.pointerId);
        }
      } catch (err) {
        // Older mobile Safari does not support setPointerCapture.
      }
      this.updatePointerVector(e.clientX, e.clientY);
      e.preventDefault();
    }
    handlePointerMove(e) {
      if (!this.pointerActive || e.pointerId !== this.pointerId) return;
      this.updatePointerVector(e.clientX, e.clientY);
      e.preventDefault();
    }
    handlePointerUp(e) {
      if (this.pointerActive && e.pointerId === this.pointerId) {
        this.resetPointer();
        if (this.canvas && this.canvas.releasePointerCapture) {
          try {
            this.canvas.releasePointerCapture(e.pointerId);
          } catch (err) {
            // Safe to ignore release failures.
          }
        }
      }
    }
    getMovementVector() {
      const dir = new Vec2();
      if (this.isDown("KeyW") || this.isDown("ArrowUp")) dir.y -= 1;
      if (this.isDown("KeyS") || this.isDown("ArrowDown")) dir.y += 1;
      if (this.isDown("KeyA") || this.isDown("ArrowLeft")) dir.x -= 1;
      if (this.isDown("KeyD") || this.isDown("ArrowRight")) dir.x += 1;
      if (this.pointerDir.length() > 0) {
        dir.add(this.pointerDir);
      }
      if (dir.length() > 1) {
        dir.normalize();
      }
      return dir;
    }
  }

  class Star {
    constructor(width, height) {
      this.reset(width, height, true);
    }
    reset(width, height, initial = false) {
      this.x = initial ? Math.random() * width : width + 20;
      this.y = Math.random() * height;
      this.speed = 80 + Math.random() * 160;
      this.size = Math.random() * 1.6 + 0.4;
      this.alpha = 0.35 + Math.random() * 0.5;
    }
    update(dt, width, height) {
      this.x -= this.speed * dt;
      if (this.x < -20) {
        this.reset(width, height);
      }
    }
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = "#4fd8ff";
      ctx.fillRect(this.x, this.y, this.size * 3, this.size);
      ctx.restore();
    }
  }

  class Particle {
    constructor(position, direction, life, color, size) {
      this.pos = position.clone();
      this.vel = direction.clone();
      this.life = life;
      this.remaining = life;
      this.color = color;
      this.size = size;
    }
    update(dt) {
      this.pos.add(this.vel.clone().scale(dt));
      this.remaining -= dt;
      return this.remaining <= 0;
    }
    draw(ctx) {
      const alpha = Math.max(this.remaining / this.life, 0);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.size * alpha;
      ctx.beginPath();
      ctx.moveTo(this.pos.x, this.pos.y);
      ctx.lineTo(this.pos.x + this.vel.x * 0.04, this.pos.y + this.vel.y * 0.04);
      ctx.stroke();
      ctx.restore();
    }
  }

  class PlayerShard {
    constructor(origin, color) {
      this.pos = origin.clone();
      this.vel = Vec2.fromAngle(Math.random() * Math.PI * 2, 140 + Math.random() * 220);
      this.life = 2.4 + Math.random() * 1.2;
      this.maxLife = this.life;
      this.rotation = Math.random() * Math.PI * 2;
      this.spin = (Math.random() - 0.5) * 8;
      this.length = 10 + Math.random() * 16;
      this.width = 3 + Math.random() * 4;
      this.color = color;
    }
    update(dt) {
      this.pos.add(this.vel.clone().scale(dt));
      this.vel.scale(0.94);
      this.rotation += this.spin * dt;
      this.life -= dt;
      return this.life <= 0;
    }
    draw(ctx) {
      const alpha = clamp(this.life / this.maxLife, 0, 1);
      ctx.save();
      ctx.translate(this.pos.x, this.pos.y);
      ctx.rotate(this.rotation);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.length * 0.5, -this.width / 2, this.length, this.width);
      ctx.restore();
    }
  }

  class Bullet {
    constructor(position, velocity, radius, color, owner) {
      this.pos = position.clone();
      this.vel = velocity.clone();
      this.radius = radius;
      this.color = color;
      this.owner = owner;
      this.life = 6;
    }
    update(dt) {
      this.pos.add(this.vel.clone().scale(dt));
      this.life -= dt;
      return this.life <= 0;
    }
    draw(ctx) {
      ctx.save();
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(this.radius * 0.3, 1);
      ctx.stroke();
      ctx.restore();
    }
  }

  class Missile {
    constructor(position, target, speed, turnRate, color, options = {}) {
      this.pos = position.clone();
      const fallbackAngle = Math.atan2(target.y - position.y, target.x - position.x);
      const initialDir =
        options.initialDirection && options.initialDirection.length() > 0
          ? options.initialDirection.clone().normalize()
          : Vec2.fromAngle(fallbackAngle, 1);
      this.vel = initialDir.scale(speed);
      this.speed = speed;
      this.turnRate = turnRate;
      this.color = color;
      this.radius = 8;
      this.life = 4.2;
      this.trailTimer = 0;
      this.turnDelay = Math.max(0, options.turnDelay || 0);
      this.turnTimer = 0;
    }
    update(dt, target, particles) {
      this.turnTimer += dt;
      let headingAngle = Math.atan2(this.vel.y, this.vel.x);
      if (this.turnTimer >= this.turnDelay && target) {
        const desired = target.clone().sub(this.pos);
        if (desired.length() > 1e-6) {
          const desiredAngle = Math.atan2(desired.y, desired.x);
          headingAngle = lerpAngle(headingAngle, desiredAngle, this.turnRate * dt);
          this.vel = Vec2.fromAngle(headingAngle, this.speed);
        }
      }
      this.pos.add(this.vel.clone().scale(dt));
      this.life -= dt;
      this.trailTimer += dt;
      if (particles && this.trailTimer >= 0.05) {
        this.trailTimer = 0;
        const back = Vec2.fromAngle(headingAngle + Math.PI, 80 + Math.random() * 120);
        const color = Math.random() < 0.5 ? "#ffd9a8" : "#ffac63";
        particles.push(new Particle(this.pos.clone(), back, 0.4 + Math.random() * 0.25, color, 2.4));
      }
      return this.life <= 0;
    }
    draw(ctx) {
      ctx.save();
      const angle = Math.atan2(this.vel.y, this.vel.x);
      ctx.translate(this.pos.x, this.pos.y);
      ctx.rotate(angle);
      ctx.fillStyle = this.color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-10, -6);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-10, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  class LaserBeam {
    constructor(origin, direction, length, width, warmup, duration, color) {
      this.origin = origin.clone();
      this.direction = direction.clone().normalize();
      this.length = length;
      this.activeLength = length;
      this.width = width;
      this.warmup = warmup;
      this.activeDuration = duration;
      this.timer = 0;
      this.color = color;
      this.helixPhase = Math.random() * Math.PI * 2;
      this.terminated = false;
      this.terminationTimer = 0;
      this.terminationDuration = 0.45;
      this.terminationPoint = null;
    }
    update(dt) {
      this.timer += dt;
      if (this.terminated) {
        this.terminationTimer += dt;
        return this.terminationTimer >= this.terminationDuration;
      }
      return this.timer >= this.warmup + this.activeDuration;
    }
    isActive() {
      return !this.terminated && this.timer >= this.warmup;
    }
    head() {
      return this.origin.clone().add(this.direction.clone().scale(this.activeLength));
    }
    closestPoint(point) {
      const start = this.origin;
      const end = this.head();
      return closestPointOnSegment(point, start, end);
    }
    checkCollision(point, radius) {
      if (!this.isActive()) return false;
      const closest = this.closestPoint(point);
      const dist = closest.clone().sub(point).length();
      return dist <= radius + this.width * 0.25;
    }
    terminate(point, particleSink) {
      if (this.terminated) return;
      this.terminated = true;
      const impactPoint = point ? point.clone() : this.head();
      this.terminationPoint = impactPoint;
      const cutoff = impactPoint.clone().sub(this.origin).length();
      this.activeLength = clamp(cutoff, 0, this.length);
      this.terminationTimer = 0;
      if (particleSink) {
        for (let i = 0; i < 26; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 220 + Math.random() * 220;
          const vel = Vec2.fromAngle(angle, speed);
          const color = i % 2 === 0 ? "#ffe1ba" : "#ff8a4f";
          particleSink.push(
            new Particle(impactPoint.clone(), vel, 0.45 + Math.random() * 0.35, color, 2.4)
          );
        }
      }
    }
    draw(ctx) {
      const head = this.head();
      const angle = Math.atan2(this.direction.y, this.direction.x);
      const perp = Vec2.fromAngle(angle + Math.PI / 2, this.width * 0.5);
      const startLeft = this.origin.clone().add(perp);
      const startRight = this.origin.clone().sub(perp);
      const endLeft = head.clone().add(perp);
      const endRight = head.clone().sub(perp);
      const state = this.terminated ? "terminated" : this.isActive() ? "active" : "warmup";
      const warmupProgress = this.warmup > 0 ? clamp(this.timer / this.warmup, 0, 1) : 1;
      const terminationProgress = this.terminated
        ? clamp(this.terminationTimer / this.terminationDuration, 0, 1)
        : 0;
      const normal = Vec2.fromAngle(angle + Math.PI / 2, 1);
      const axis = this.direction.clone();

      let alpha = 0.85;
      if (state === "active") {
        alpha = 0.95;
      } else if (state === "terminated") {
        alpha = 0.55 + 0.3 * (1 - terminationProgress);
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      const fillGradient = ctx.createLinearGradient(this.origin.x, this.origin.y, head.x, head.y);
      if (state === "warmup") {
        fillGradient.addColorStop(0, "rgba(150, 240, 255, 0.15)");
        fillGradient.addColorStop(0.5, "rgba(110, 210, 255, 0.75)");
        fillGradient.addColorStop(1, "rgba(70, 170, 255, 0.95)");
      } else {
        fillGradient.addColorStop(0, "rgba(255, 230, 190, 0.35)");
        fillGradient.addColorStop(0.4, "rgba(255, 150, 70, 0.92)");
        fillGradient.addColorStop(1, "rgba(255, 40, 20, 0.98)");
      }
      ctx.fillStyle = fillGradient;
      ctx.shadowColor =
        state === "warmup"
          ? "rgba(110, 220, 255, 0.8)"
          : state === "terminated"
          ? "rgba(255, 140, 80, 0.7)"
          : "rgba(255, 90, 30, 0.9)";
      ctx.shadowBlur = state === "warmup" ? 14 : state === "terminated" ? 18 : 24;
      ctx.beginPath();
      ctx.moveTo(startLeft.x, startLeft.y);
      ctx.lineTo(endLeft.x, endLeft.y);
      ctx.lineTo(endRight.x, endRight.y);
      ctx.lineTo(startRight.x, startRight.y);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.globalAlpha = 1;
      ctx.strokeStyle =
        state === "warmup"
          ? "rgba(210, 250, 255, 0.95)"
          : state === "terminated"
          ? "rgba(255, 210, 190, 0.9)"
          : "rgba(255, 230, 200, 0.95)";
      ctx.lineWidth = this.width * (state === "active" ? 0.45 : 0.35);
      ctx.beginPath();
      ctx.moveTo(this.origin.x, this.origin.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      const glowWidth =
        this.width *
        (state === "active"
          ? 2 + Math.sin(this.timer * 30) * 0.2
          : state === "warmup"
          ? 1.6 + Math.sin(this.timer * 14) * 0.1
          : 1.8 - terminationProgress * 0.7);
      ctx.globalAlpha =
        state === "active" ? 0.7 : state === "warmup" ? 0.85 : 0.5 * (1 - terminationProgress * 0.5);
      ctx.strokeStyle =
        state === "warmup"
          ? "rgba(110, 220, 255, 0.85)"
          : state === "terminated"
          ? "rgba(255, 170, 90, 0.85)"
          : "rgba(255, 110, 50, 0.95)";
      ctx.lineWidth = glowWidth;
      ctx.beginPath();
      ctx.moveTo(this.origin.x, this.origin.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (state === "warmup") {
        const flare = clamp(1 - warmupProgress, 0, 1);
        const flareRadius = this.width * (3 + flare * 4);
        const flareGradient = ctx.createRadialGradient(
          this.origin.x,
          this.origin.y,
          0,
          this.origin.x,
          this.origin.y,
          flareRadius
        );
        flareGradient.addColorStop(0, "rgba(210, 250, 255, 0.95)");
        flareGradient.addColorStop(0.5, "rgba(120, 210, 255, 0.5)");
        flareGradient.addColorStop(1, "rgba(70, 160, 255, 0)");
        ctx.fillStyle = flareGradient;
        ctx.beginPath();
        ctx.arc(this.origin.x, this.origin.y, flareRadius, 0, Math.PI * 2);
        ctx.fill();

        const helixCount = 34;
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i <= helixCount; i += 1) {
          const t = i / helixCount;
          const progress = t * 0.9;
          const basePos = this.origin.clone().add(axis.clone().scale(this.length * progress));
          const orbit = this.width * 0.55 * (1 - progress * 0.7);
          const swirl = this.timer * 6 + this.helixPhase + t * Math.PI * 4;
          const alongJitter = axis.clone().scale(Math.cos(swirl) * this.width * 0.05 * (1 - progress));
          const offset = normal.clone().scale(Math.sin(swirl) * orbit);
          const offsetOpp = normal.clone().scale(Math.sin(swirl + Math.PI) * orbit);
          const radius = this.width * (0.12 + 0.25 * (1 - progress));
          ctx.globalAlpha = 0.2 + 0.5 * (1 - progress);
          ctx.fillStyle = `rgba(140, 230, 255, ${0.8 - progress * 0.6})`;
          ctx.beginPath();
          ctx.arc(
            basePos.x + offset.x + alongJitter.x,
            basePos.y + offset.y + alongJitter.y,
            radius,
            0,
            Math.PI * 2
          );
          ctx.fill();
          ctx.beginPath();
          ctx.arc(
            basePos.x + offsetOpp.x - alongJitter.x,
            basePos.y + offsetOpp.y - alongJitter.y,
            radius * 0.85,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      } else if (state === "active") {
        const burstRadius = this.width * (3.2 + Math.sin(this.timer * 16) * 0.5);
        const burstGradient = ctx.createRadialGradient(
          this.origin.x,
          this.origin.y,
          0,
          this.origin.x,
          this.origin.y,
          burstRadius
        );
        burstGradient.addColorStop(0, "rgba(255, 240, 190, 0.95)");
        burstGradient.addColorStop(0.5, "rgba(255, 150, 70, 0.5)");
        burstGradient.addColorStop(1, "rgba(255, 70, 20, 0)");
        ctx.fillStyle = burstGradient;
        ctx.beginPath();
        ctx.arc(this.origin.x, this.origin.y, burstRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = "screen";
        const shaderPasses = 5;
        for (let i = 0; i < shaderPasses; i += 1) {
          const t = (i + 0.5) / shaderPasses;
          const pos = this.origin.clone().add(this.direction.clone().scale(this.length * t));
          const radius = this.width * (1.4 + t * 2.4);
          const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius * 1.8);
          gradient.addColorStop(0, "rgba(255, 230, 190, 0.85)");
          gradient.addColorStop(0.45, "rgba(255, 140, 60, 0.4)");
          gradient.addColorStop(1, "rgba(255, 60, 20, 0)");
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      } else {
        const blastPoint = this.terminationPoint || head;
        const blastBase = this.width * (3.5 + terminationProgress * 5.2);
        const blastGradient = ctx.createRadialGradient(
          blastPoint.x,
          blastPoint.y,
          0,
          blastPoint.x,
          blastPoint.y,
          blastBase
        );
        blastGradient.addColorStop(0, "rgba(255, 250, 220, 0.95)");
        blastGradient.addColorStop(0.4, "rgba(255, 180, 100, 0.6)");
        blastGradient.addColorStop(1, "rgba(255, 80, 30, 0)");
        ctx.globalAlpha = 0.9 * (1 - terminationProgress * 0.4);
        ctx.fillStyle = blastGradient;
        ctx.beginPath();
        ctx.arc(blastPoint.x, blastPoint.y, blastBase, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.6 * (1 - terminationProgress);
        ctx.strokeStyle = "rgba(255, 160, 90, 0.9)";
        ctx.lineWidth = this.width * (1.4 + terminationProgress * 3);
        ctx.beginPath();
        ctx.arc(blastPoint.x, blastPoint.y, blastBase * (1 + terminationProgress * 0.6), 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 4; i += 1) {
          const t = (i + 0.5) / 4;
          const pos = this.origin.clone().add(axis.clone().scale(this.activeLength * (0.4 + 0.15 * i)));
          const radius = this.width * (0.9 + t * 1.6);
          ctx.globalAlpha = 0.4 * (1 - terminationProgress);
          ctx.fillStyle = "rgba(255, 160, 90, 0.8)";
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  const WEAPON_LAUNCHER_STYLES = {
    cannon: {
      key: "cannon",
      pulseSpeed: 1.6,
      recoil: 10,
      body: "#3a1210",
      accent: "#ff9442",
      barrel: "#ffd2a0",
      glow: "#ffb36b",
    },
    spread: {
      key: "spread",
      pulseSpeed: 1.9,
      recoil: 8,
      body: "#3f1410",
      accent: "#ff7a3c",
      barrel: "#ffd4b4",
      glow: "#ff9955",
    },
    shatter: {
      key: "shatter",
      pulseSpeed: 1.3,
      recoil: 6,
      body: "#461914",
      accent: "#ffb273",
      barrel: "#ffe3c4",
      glow: "#ff9350",
    },
    missile: {
      key: "missile",
      pulseSpeed: 1.7,
      recoil: 9,
      body: "#36110d",
      accent: "#ff8f56",
      barrel: "#ffd7b6",
      glow: "#ff9558",
    },
    laser: {
      key: "laser",
      pulseSpeed: 2.3,
      recoil: 7,
      body: "#2f0f0d",
      accent: "#ffae68",
      barrel: "#ffe8ca",
      glow: "#ff8c40",
    },
    storm: {
      key: "storm",
      pulseSpeed: 2.6,
      recoil: 7,
      body: "#41140f",
      accent: "#ff8d4f",
      barrel: "#ffdcb1",
      glow: "#ffb06d",
    },
    "core-storm": {
      key: "core-storm",
      pulseSpeed: 2.8,
      recoil: 12,
      body: "#481e12",
      accent: "#ffae60",
      barrel: "#ffe5bf",
      glow: "#ff8a43",
    },
  };

  const WEAPON_LIBRARY = [
    {
      key: "cannon",
      difficulty: 1,
      cooldownRange: [0.65, 1.1],
      fire(segment, boss, playerPos, level) {
        const muzzle = segment.worldEnd.clone();
        const angle = Math.atan2(playerPos.y - muzzle.y, playerPos.x - muzzle.x);
        const speed = 220 + level * 24;
        const bullet = new Bullet(muzzle, Vec2.fromAngle(angle, speed), 5, "#ffffff", "boss");
        return { bullets: [bullet] };
      },
    },
    {
      key: "spread",
      difficulty: 2,
      cooldownRange: [0.8, 1.35],
      fire(segment, boss, playerPos, level) {
        const muzzle = segment.worldEnd.clone();
        const baseAngle = Math.atan2(playerPos.y - muzzle.y, playerPos.x - muzzle.x);
        const spread = 0.18;
        const speed = 230 + level * 20;
        const bullets = [];
        for (let i = -1; i <= 1; i += 1) {
          const angle = baseAngle + spread * i;
          bullets.push(new Bullet(muzzle.clone(), Vec2.fromAngle(angle, speed), 4.5, "#ffffff", "boss"));
        }
        return { bullets };
      },
    },
    {
      key: "shatter",
      difficulty: 3,
      cooldownRange: [1.1, 1.8],
      fire(segment, boss, playerPos, level) {
        const muzzle = segment.worldEnd.clone();
        const baseAngle = Math.atan2(playerPos.y - muzzle.y, playerPos.x - muzzle.x);
        const bullets = [];
        const count = 5;
        const speed = 240 + level * 24;
        for (let i = 0; i < count; i += 1) {
          const offset = (i - (count - 1) / 2) * 0.12 + (Math.random() - 0.5) * 0.04;
          bullets.push(new Bullet(muzzle.clone(), Vec2.fromAngle(baseAngle + offset, speed), 4.5, "#ffffff", "boss"));
        }
        return { bullets };
      },
    },
    {
      key: "missile",
      difficulty: 4,
      cooldownRange: [1.6, 2.4],
      fire(segment, boss, playerPos, level) {
        const muzzle = segment.worldEnd.clone();
        const missiles = [];
        const volleySize = 4;
        const vertical = Math.random() < 0.5 ? 1 : -1;
        const baseAngle = vertical > 0 ? Math.PI / 2 : -Math.PI / 2;
        const fanSpread = 0.4;
        const spacing = 26;
        for (let i = 0; i < volleySize; i += 1) {
          const lerp = volleySize > 1 ? i / (volleySize - 1) : 0.5;
          const offsetFactor = lerp - 0.5;
          const lateral = Vec2.fromAngle(segment.absoluteAngle + Math.PI / 2, offsetFactor * spacing);
          const spawnPos = muzzle.clone().add(lateral);
          const initialDir = Vec2.fromAngle(baseAngle + offsetFactor * fanSpread, 1);
          const turnDelay = 0.22 + Math.random() * 0.12;
          missiles.push(
            new Missile(spawnPos, playerPos, 240 + level * 16, 0.99, "#ffffff", {
              initialDirection: initialDir,
              turnDelay,
            })
          );
        }
        AUDIO.playMissileLaunch(volleySize);
        return { missiles };
      },
    },
    {
      key: "laser",
      difficulty: 4,
      cooldownRange: [4.4, 6.2],
      fire(segment, boss, playerPos, level, particles) {
        const origin = segment.midpoint.clone();
        const angle = Math.atan2(playerPos.y - origin.y, playerPos.x - origin.x);
        const direction = Vec2.fromAngle(angle, 1);
        const length = (1400 + level * 40) * 4;
        const width = 16;
        const { warmup, duration } = resolveTiming("laser");
        const beam = new LaserBeam(origin, direction, length, width, warmup, duration, "rgba(255, 255, 255, 0.55)");
        AUDIO.playLaserFire();

        const prefireBursts = 16;
        for (let i = 0; i < prefireBursts; i += 1) {
          const offset = Vec2.fromAngle(angle + (Math.random() - 0.5) * 0.5, Math.random() * 80);
          const pos = origin.clone().add(offset);
          const vel = Vec2.fromAngle(angle + Math.PI + (Math.random() - 0.5) * 0.6, 120 + Math.random() * 160);
          const color = i % 2 === 0 ? "#ffe6a3" : "#ffffff";
          particles.push(new Particle(pos, vel, 0.35 + Math.random() * 0.2, color, 2.2));
        }

        return { lasers: [beam] };
      },
    },
    {
      key: "storm",
      difficulty: 5,
      cooldownRange: [1.8, 2.6],
      fire(segment, boss, playerPos, level) {
        const muzzle = segment.worldEnd.clone();
        const baseAngle = Math.atan2(playerPos.y - muzzle.y, playerPos.x - muzzle.x);
        const bullets = [];
        const count = 7;
        const spread = 0.32;
        const baseSpeed = 220 + level * 18;
        for (let i = 0; i < count; i += 1) {
          const offset = (i - (count - 1) / 2) * (spread / count) * 3;
          const angle = baseAngle + offset;
          const speed = baseSpeed + Math.random() * 40;
          bullets.push(new Bullet(muzzle.clone(), Vec2.fromAngle(angle, speed), 4.5, "#ffffff", "boss"));
        }
        return { bullets };
      },
    },
  ];

  const CORE_STORM_WEAPON = {
    key: "core-storm",
    difficulty: 6,
    cooldownRange: [1.2, 1.6],
    fire(segment, boss, playerPos, level) {
      const outputs = { bullets: [], missiles: [], lasers: [] };
      const center = segment.worldCenter.clone();
      const baseAngle = Math.atan2(playerPos.y - center.y, playerPos.x - center.x);
      const bulletSpeed = 260 + level * 22;
      const bulletCount = 8;
      for (let i = 0; i < bulletCount; i += 1) {
        const angle = baseAngle + (i / bulletCount) * Math.PI * 2;
        outputs.bullets.push(new Bullet(center.clone(), Vec2.fromAngle(angle, bulletSpeed), 5, "#ffffff", "boss"));
      }
      const missileVolley = 4;
      const vertical = Math.random() < 0.5 ? 1 : -1;
      const baseVertical = vertical > 0 ? Math.PI / 2 : -Math.PI / 2;
      const fanSpread = 0.35;
      const spacing = 32;
      for (let i = 0; i < missileVolley; i += 1) {
        const lerp = missileVolley > 1 ? i / (missileVolley - 1) : 0.5;
        const offsetFactor = lerp - 0.5;
        const initialDir = Vec2.fromAngle(baseVertical + offsetFactor * fanSpread, 1);
        const lateral = Vec2.fromAngle(baseVertical + Math.PI / 2, offsetFactor * spacing);
        const forward = Vec2.fromAngle(baseVertical, 12);
        const spawnPos = center.clone().add(forward).add(lateral);
        const turnDelay = 0.2 + Math.random() * 0.15;
        outputs.missiles.push(
          new Missile(spawnPos, playerPos, 260 + level * 18, 1.21, "#ffffff", {
            initialDirection: initialDir,
            turnDelay,
          })
        );
      }
      AUDIO.playMissileLaunch(missileVolley);
      const laserDirection = Vec2.fromAngle(baseAngle, 1);
      const { warmup, duration } = resolveTiming("coreLaser");
      const laser = new LaserBeam(center.clone(), laserDirection, 1800, 18, warmup, duration, "rgba(255, 255, 255, 0.92)");
      AUDIO.playLaserFire();
      outputs.lasers.push(laser);
      return outputs;
    },
  };

  let segmentIdCounter = 0;

  class BossSegment {
    constructor({
      type,
      length,
      thickness,
      localAngle,
      health,
      colors,
      radius = 0,
    }) {
      this.id = segmentIdCounter += 1;
      this.type = type;
      this.length = length;
      this.thickness = thickness;
      this.localAngle = localAngle;
      this.health = health;
      this.maxHealth = health;
      this.colors = colors;
      this.radius = radius;
      this.parent = null;
      this.children = [];
      this.weapon = null;
      this.thruster = null;
      this.absoluteAngle = 0;
      this.worldStart = new Vec2();
      this.worldEnd = new Vec2();
      this.worldCenter = new Vec2();
      this.midpoint = new Vec2();
      this.polygon = [];
      this.destroyed = false;
      this.scoreValue = 100;
      this.weaponKey = null;
      this.launcherStyle = null;
      this.visualPhase = Math.random() * Math.PI * 2;
      this.flashTimer = 0;
      this.recoil = 0;
    }
    attach(child) {
      child.parent = this;
      this.children.push(child);
    }
    setWeapon(entry, level) {
      this.weapon = {
        entry,
        timer: this.nextCooldown(entry, level),
      };
      this.weaponKey = entry.key;
      this.launcherStyle = WEAPON_LAUNCHER_STYLES[entry.key] || null;
      this.flashTimer = 0;
      this.recoil = 0;
      this.visualPhase = Math.random() * Math.PI * 2;
      const base = 120 + this.maxHealth * 0.5;
      this.scoreValue = base + entry.difficulty * 120;
    }
    setThruster(force) {
      this.thruster = {
        force,
        power: 0,
      };
      this.weaponKey = null;
      this.launcherStyle = null;
      this.flashTimer = 0;
      this.recoil = 0;
      this.visualPhase = Math.random() * Math.PI * 2;
      this.colors = {
        fill: "rgba(170, 45, 20, 0.88)",
        stroke: "#ff9f5c",
        glow: "#ffb96d",
      };
      const base = 140 + this.maxHealth * 0.4;
      this.scoreValue = base;
    }
    setBranchScore() {
      this.scoreValue = 160 + this.maxHealth * 0.45;
    }
    setCoreScore(level) {
      this.scoreValue = 800 + level * 220;
    }
    nextCooldown(entry, level) {
      const [min, max] = entry.cooldownRange;
      const reduction = clamp(1 - level * 0.03, 0.5, 1);
      return (min + Math.random() * (max - min)) * reduction;
    }
    updateGeometry(basePoint, baseAngle) {
      if (this.type === "core") {
        this.absoluteAngle = baseAngle;
        this.worldCenter = basePoint.clone();
        this.worldStart = basePoint.clone();
        this.worldEnd = basePoint.clone();
        this.midpoint = basePoint.clone();
        this.polygon = [];
        return;
      }
      this.absoluteAngle = baseAngle + this.localAngle;
      const direction = Vec2.fromAngle(this.absoluteAngle, this.length);
      this.worldStart = basePoint.clone();
      this.worldEnd = basePoint.clone().add(direction);
      this.worldCenter = this.worldStart.clone().add(this.worldEnd.clone()).scale(0.5);
      this.midpoint = this.worldCenter.clone();
      const normal = Vec2.fromAngle(this.absoluteAngle + Math.PI / 2, this.thickness / 2);
      this.polygon = [
        this.worldStart.clone().add(normal),
        this.worldEnd.clone().add(normal),
        this.worldEnd.clone().sub(normal),
        this.worldStart.clone().sub(normal),
      ];
    }
  }

  class Boss {
    constructor(level, canvasWidth, canvasHeight) {
      this.level = level;
      this.canvasWidth = canvasWidth;
      this.canvasHeight = canvasHeight;
      this.pos = new Vec2(canvasWidth * 0.72, canvasHeight * 0.25);
      this.vel = new Vec2((Math.random() * 0.5 + 0.4) * 60, 0);
      this.heading = -Math.PI / 2;
      this.angularVel = 0;
      this.timeAlive = 0;
      this.segments = [];
      this.weaponSegments = [];
      this.thrusterSegments = [];
      this.debris = [];
      this.coreSolo = false;
      this.core = null;
      this.totalHealth = 0;
      this.remainingHealth = 0;
      this.events = [];
      this.initialThrusterCount = 1;
      this.initialArmCount = 1;
      this.coreCritical = false;
      this.coreCriticalTimer = 0;
      this.coreCriticalWaveTimer = 0;
      this.coreExplosionTriggered = false;
      this.coreCriticalOrigin = this.pos.clone();
      this.coreCriticalRadius = 60;
      this.coreShockwaves = [];
      this.corePlumes = [];
      this.coreSparkTimer = 0;
      this.coreGlowIntensity = 0;
      this.wanderPhase = Math.random() * Math.PI * 2;
      this.wanderSpeed = 0.45 + Math.random() * 0.45;
      this.wanderStrength = 0.7 + Math.random() * 0.4;
      this.wanderRadius = 110 + Math.random() * 70;
      this.generate();
    }
    generate() {
      const core = new BossSegment({
        type: "core",
        length: 0,
        thickness: 0,
        localAngle: 0,
        health: 380 + this.level * 90,
        colors: {
          fill: "rgba(150, 28, 18, 0.95)",
          stroke: "#ff9452",
          glow: "#ffc878",
        },
        radius: 46 + this.level * 2,
      });
      core.setCoreScore(this.level);
      this.core = core;
      this.segments.push(core);

      const armCount = this.level <= 1 ? 0 : this.level + 1;
      const maxDepth = Math.max(1, 2 + Math.floor(this.level / 3));
      let currentLayer = [];

      if (armCount > 0) {
        for (let i = 0; i < armCount; i += 1) {
          const angle = (i / armCount) * Math.PI * 2;
          const segment = this.createArmSegment(this.core, angle, 1, "base");
          currentLayer.push(segment);
        }
        this.updateGeometry();
      }

      for (let depth = 2; depth <= maxDepth && currentLayer.length > 0; depth += 1) {
        this.updateGeometry();
        const nextLayer = [];
        const splitCount = Math.min(currentLayer.length, Math.floor(currentLayer.length / 2) + 1);
        currentLayer.forEach((segment, index) => {
          const baseAngle = segment.targetAngle ?? segment.absoluteAngle ?? 0;
          if (index < splitCount) {
            const spread = 0.28 + Math.random() * 0.25;
            nextLayer.push(this.createArmSegment(segment, baseAngle + spread, depth, "split"));
            nextLayer.push(this.createArmSegment(segment, baseAngle - spread, depth, "split"));
          } else {
            nextLayer.push(this.createArmSegment(segment, baseAngle, depth, "extend"));
          }
        });
        currentLayer = nextLayer;
      }

      this.updateGeometry();

      const leafSegments = currentLayer;
      let thrusterQuota = Math.max(1, Math.floor((leafSegments.length || armCount || 1) / 3));
      const reserveThruster = () => {
        if (thrusterQuota > 0) {
          thrusterQuota -= 1;
          return true;
        }
        return false;
      };

      leafSegments.forEach((segment, index) => {
        const wantsThruster = reserveThruster() || Math.random() < 0.15;
        if (wantsThruster) {
          segment.type = "thruster";
          segment.setThruster(220 + this.level * 28);
          this.thrusterSegments.push(segment);
        } else {
          segment.type = "weapon";
          const weapon = this.pickWeaponConfig(segment.layerDepth || 1);
          segment.setWeapon(weapon, this.level);
          this.weaponSegments.push(segment);
          segment.colors = {
            fill: "rgba(215, 82, 30, 0.92)",
            stroke: "#ffc87a",
            glow: "#ff9852",
          };
        }
      });

      if (leafSegments.length === 1) {
        const onlySegment = leafSegments[0];
        if (onlySegment.type !== "weapon") {
          const index = this.thrusterSegments.indexOf(onlySegment);
          if (index !== -1) this.thrusterSegments.splice(index, 1);
          onlySegment.type = "weapon";
          const weapon = this.pickWeaponConfig(onlySegment.layerDepth || 1);
          onlySegment.setWeapon(weapon, this.level);
          this.weaponSegments.push(onlySegment);
          onlySegment.colors = {
            fill: "rgba(215, 82, 30, 0.92)",
            stroke: "#ffc87a",
            glow: "#ff9852",
          };
        }
      } else {
        if (this.weaponSegments.length === 0 && this.thrusterSegments.length > 0) {
          const fallbackWeapon = this.thrusterSegments.pop();
          if (fallbackWeapon) {
            fallbackWeapon.type = "weapon";
            const weapon = this.pickWeaponConfig(fallbackWeapon.layerDepth || 1);
            fallbackWeapon.setWeapon(weapon, this.level);
            this.weaponSegments.push(fallbackWeapon);
            fallbackWeapon.colors = {
              fill: "rgba(215, 82, 30, 0.92)",
              stroke: "#ffc87a",
              glow: "#ff9852",
            };
          }
        }

      if (this.thrusterSegments.length === 0 && this.weaponSegments.length > 0) {
        const fallback = this.weaponSegments.pop();
        if (fallback) {
          fallback.weapon = null;
          fallback.type = "thruster";
            fallback.setThruster(220 + this.level * 24);
            fallback.colors = {
              fill: "rgba(170, 45, 20, 0.88)",
              stroke: "#ff9f5c",
              glow: "#ffb96d",
            };
            this.thrusterSegments.push(fallback);
          }
        }
      }
      this.initialThrusterCount = Math.max(1, this.thrusterSegments.length || 1);
      this.initialArmCount = Math.max(
        1,
        this.segments.filter((seg) => seg.type !== "core").length
      );

      this.totalHealth = this.segments.reduce((acc, seg) => acc + seg.maxHealth, 0);
      this.remainingHealth = this.totalHealth;
      this.updateGeometry();
    }
    createArmSegment(parent, targetAngle, depth, mode) {
      const parentAngle = parent === this.core ? this.heading : parent.absoluteAngle || 0;
      const offset = wrapAngle(targetAngle - parentAngle);
      const jitter = (Math.random() - 0.5) * (mode === "split" ? 0.42 : 0.18);
      const localAngle = offset + jitter;
      const lengthBase = (80 + depth * 24) * 0.25;
      const rawLength =
        lengthBase + (mode === "extend" ? 20 : 12.5) + Math.random() * (mode === "extend" ? 15 : 8.75);
      const length = rawLength * 1.5;
      const thickness = 20 + Math.random() * 5 + depth * 2;
      const health = 110 + this.level * 28 - depth * 9 + (mode === "extend" ? 14 : 0);
      const colors = this.branchColors(depth);
      const segment = new BossSegment({
        type: "branch",
        length,
        thickness,
        localAngle,
        health,
        colors,
      });
      segment.layerDepth = depth;
      segment.targetAngle = targetAngle;
      segment.setBranchScore();
      parent.attach(segment);
      this.segments.push(segment);
      return segment;
    }
    branchColors(depth) {
      const palettes = [
        { fill: "rgba(190, 55, 24, 0.92)", stroke: "#ffb36b", glow: "#ff7536" },
        { fill: "rgba(205, 70, 28, 0.9)", stroke: "#ffc27a", glow: "#ff8642" },
        { fill: "rgba(220, 90, 32, 0.88)", stroke: "#ffd49a", glow: "#ff9b58" },
        { fill: "rgba(235, 110, 40, 0.86)", stroke: "#ffe0b2", glow: "#ffb472" },
      ];
      return palettes[Math.min(palettes.length - 1, Math.max(0, depth - 1))];
    }
    pickWeaponConfig(depth) {
      const maxDifficulty = clamp(1 + Math.floor(this.level / 2), 1, 5);
      const candidates = WEAPON_LIBRARY.filter((entry) => entry.difficulty <= maxDifficulty);
      if (candidates.length === 0) {
        return WEAPON_LIBRARY[0];
      }
      const missileWeightBase = 2;
      const depthFactor = 1 + Math.min(depth, 4) * 0.15;
      const weights = candidates.map((entry) => {
        if (entry.key === "missile") {
          return missileWeightBase * depthFactor;
        }
        return 1;
      });
      const total = weights.reduce((sum, value) => sum + value, 0);
      let roll = Math.random() * total;
      for (let i = 0; i < candidates.length; i += 1) {
        roll -= weights[i];
        if (roll <= 0) {
          return candidates[i];
        }
      }
      return candidates[candidates.length - 1];
    }
    updateGeometry() {
      this.core.updateGeometry(this.pos, this.heading);
      const traverse = (segment, basePoint, baseAngle) => {
        if (segment.type !== "core") {
          segment.updateGeometry(basePoint, baseAngle);
          basePoint = segment.worldEnd.clone();
          baseAngle = segment.absoluteAngle;
        } else {
          segment.updateGeometry(this.pos, this.heading);
          basePoint = this.pos.clone();
          baseAngle = this.heading;
        }
        segment.children.forEach((child) => traverse(child, basePoint, baseAngle));
      };
      traverse(this.core, this.pos.clone(), this.heading);
    }
    startCoreCritical(segment, particles) {
      if (this.coreCritical) return;
      this.coreCritical = true;
      this.coreCriticalTimer = 0;
      this.coreCriticalWaveTimer = 0;
      this.coreExplosionTriggered = false;
      this.coreSparkTimer = 0;
      this.coreGlowIntensity = 0;
      this.coreCriticalOrigin = segment.worldCenter ? segment.worldCenter.clone() : this.pos.clone();
      this.coreCriticalRadius = Math.max(segment.radius, 60);
      this.coreShockwaves = [];
      this.corePlumes = [];
      const origin = this.coreCriticalOrigin.clone();
      for (let i = 0; i < 140; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 120 + Math.random() * 180;
        const vel = Vec2.fromAngle(angle, speed);
        const color = Math.random() < 0.5 ? "#ffe6a3" : "#ff9b56";
        particles.push(new Particle(origin.clone(), vel, 1.4 + Math.random(), color, 3.2));
      }
      this.coreShockwaves.push({
        radius: this.coreCriticalRadius * 0.6,
        width: this.coreCriticalRadius * 0.45,
        growth: 220,
        life: 0,
        maxLife: 1.6,
        alpha: 1,
      });
      this.segments.forEach((seg) => {
        if (seg !== this.core && !seg.destroyed) {
          seg.flashTimer = 1.5;
        }
      });
    }
    triggerCoreSupernova(particles) {
      if (this.coreExplosionTriggered) return;
      this.coreExplosionTriggered = true;
      const origin = this.coreCriticalOrigin.clone();
      for (let i = 0; i < 260; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 220 + Math.random() * 260;
        const vel = Vec2.fromAngle(angle, speed);
        const color =
          i % 4 === 0 ? "#fff7d8" : i % 4 === 1 ? "#ffd2a3" : i % 4 === 2 ? "#ff9f65" : "#ff7544";
        particles.push(new Particle(origin.clone(), vel, 2 + Math.random() * 1.6, color, 3.6));
      }
      const plumeCount = 26;
      for (let i = 0; i < plumeCount; i += 1) {
        const baseAngle = (i / plumeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
        this.corePlumes.push({
          angle: baseAngle,
          radius: this.coreCriticalRadius * 0.5,
          speed: 90 + Math.random() * 120,
          width: this.coreCriticalRadius * (0.12 + Math.random() * 0.08),
          life: 0,
          maxLife: 5,
          color: i % 2 === 0 ? "#ffeaba" : "#ffb27b",
          spin: (Math.random() - 0.5) * 0.5,
        });
      }
      this.coreShockwaves.push({
        radius: this.coreCriticalRadius * 0.8,
        width: this.coreCriticalRadius * 0.9,
        growth: 320,
        life: 0,
        maxLife: 3.25,
        alpha: 1,
      });
    }
    updateCoreCritical(dt, particles) {
      this.coreCriticalTimer += dt;
      this.coreCriticalWaveTimer += dt;
      this.coreGlowIntensity = Math.min(1, this.coreGlowIntensity + dt * 0.6);
      if (this.coreCriticalWaveTimer >= 0.38) {
        this.coreCriticalWaveTimer = 0;
        this.coreShockwaves.push({
          radius: this.coreCriticalRadius * (0.45 + Math.random() * 0.1),
          width: this.coreCriticalRadius * (0.32 + Math.random() * 0.08),
          growth: 200 + Math.random() * 80,
          life: 0,
          maxLife: 1.3 + Math.random() * 0.7,
          alpha: 0.85,
        });
      }
      if (!this.coreExplosionTriggered && this.coreCriticalTimer >= 0.9) {
        this.triggerCoreSupernova(particles);
      }
      if (this.coreExplosionTriggered) {
        this.coreSparkTimer += dt;
        while (this.coreSparkTimer >= 0.08) {
          this.coreSparkTimer -= 0.08;
          const angle = Math.random() * Math.PI * 2;
          const speed = 160 + Math.random() * 200;
          const vel = Vec2.fromAngle(angle, speed);
          const color = Math.random() < 0.5 ? "#fff3c0" : "#ffb679";
          particles.push(new Particle(this.coreCriticalOrigin.clone(), vel, 1.4 + Math.random(), color, 3.4));
        }
      }
      this.coreShockwaves = this.coreShockwaves.filter((wave) => {
        wave.life += dt;
        wave.radius += (wave.growth || 240) * dt;
        wave.alpha = Math.max(0, 1 - wave.life / wave.maxLife);
        return wave.life < wave.maxLife;
      });
      this.corePlumes = this.corePlumes.filter((plume) => {
        plume.life += dt;
        plume.radius += plume.speed * dt;
        plume.angle += plume.spin * dt;
        return plume.life < plume.maxLife;
      });
      this.vel.scale(frameDecay(0.94, dt));
      this.segments.forEach((segment) => {
        if (segment.destroyed) return;
        const basePulse = segment.type === "weapon" ? 1.6 : segment.type === "thruster" ? 1.2 : 0.8;
        segment.visualPhase += dt * basePulse;
        segment.flashTimer = Math.max(segment.flashTimer - dt * 1.8, 0);
      });
    }
    calculateDefenseVector() {
      const vector = new Vec2();
      this.segments.forEach((segment) => {
        if (segment.destroyed || segment.type === "core") return;
        const center = (segment.worldCenter || segment.worldEnd || this.pos).clone().sub(this.pos);
        const length = center.length();
        if (length < 1e-3) return;
        const healthWeight = Math.max(segment.health, 0) + segment.maxHealth * 0.25;
        const roleBonus =
          segment.type === "weapon" ? 60 : segment.type === "thruster" ? 40 : segment.type === "branch" ? 28 : 18;
        center.scale((healthWeight + roleBonus) / length);
        vector.add(center);
      });
      return vector;
    }
    currentArmCount() {
      return this.segments.reduce((count, segment) => {
        if (segment.type === "core" || segment.destroyed) return count;
        return count + 1;
      }, 0);
    }
    movementSpeedMultiplier() {
      if (this.coreCritical) return 2;
      const initial = Math.max(this.initialArmCount || 0, 1);
      const alive = this.currentArmCount();
      const lossRatio = clamp(1 - alive / initial, 0, 1);
      return 1 + lossRatio;
    }
    desiredAcceleration(playerPos, mobility = 1) {
      const marginX = Math.max(160, this.canvasWidth * 0.18);
      const marginTop = Math.max(90, this.canvasHeight * 0.12);
      const marginBottom = this.canvasHeight * 0.5;
      const desired = playerPos.clone().sub(this.pos);
      const distance = desired.length();
      if (distance > 1e-3) desired.scale(1 / distance);
      const pursuitCap = (200 + this.level * 16) * (0.8 + mobility * 0.4);
      const pursuit = desired.clone().scale(Math.min(distance * 0.55, pursuitCap));
      const orbitMagnitude = (80 + this.level * 8) * (0.7 + mobility * 0.3);
      const orbit = Vec2.fromAngle(Math.atan2(desired.y, desired.x) + Math.PI / 2, orbitMagnitude);
      const accel = pursuit.add(orbit);
      const sway = Math.sin(this.timeAlive * (0.8 + this.wanderSpeed)) * (90 + this.level * 6) * mobility;
      accel.y += sway;
      const wanderAngle = this.timeAlive * (0.9 + this.wanderSpeed * 0.5) + this.wanderPhase;
      const wanderStrength = this.wanderRadius * (0.5 + mobility * 0.5);
      accel.add(Vec2.fromAngle(wanderAngle, wanderStrength));
      const strafe = Vec2.fromAngle(
        Math.atan2(desired.y, desired.x) + Math.PI / 2,
        60 * mobility * this.wanderStrength
      );
      accel.add(strafe);
      const rightAnchor = this.canvasWidth * 0.72;
      if (this.pos.x < this.canvasWidth * 0.58)
        accel.x += (this.canvasWidth * 0.58 - this.pos.x) * 4.2 * mobility;
      if (this.pos.x > this.canvasWidth - marginX)
        accel.x -= (this.pos.x - (this.canvasWidth - marginX)) * 3.4 * mobility;
      accel.x += (rightAnchor - this.pos.x) * 1.8 * mobility;
      if (this.pos.y < marginTop) accel.y += (marginTop - this.pos.y) * 3.2 * mobility;
      if (this.pos.y > marginBottom) accel.y -= (this.pos.y - marginBottom) * 3.2 * mobility;
      return accel;
    }
    update(dt, playerPos, particles) {
      this.events = [];
      const spawn = { bullets: [], missiles: [], lasers: [], events: this.events };
      this.timeAlive += dt;

      if (this.coreCritical) {
        this.updateCoreCritical(dt, particles);
        this.updateGeometry();
        this.updateDebris(dt, particles);
        this.remainingHealth = 0;
        return spawn;
      }
      const mobility = this.movementSpeedMultiplier();

      if (!this.core.destroyed) {
        const desiredAccel = this.desiredAcceleration(playerPos, mobility);
        const acceleration = new Vec2();
        const activeThrusters = this.thrusterSegments.filter((thruster) => !thruster.destroyed);
        const initialThrusters = this.initialThrusterCount || activeThrusters.length || 1;
        const thrusterShare = 1 / initialThrusters;
        const thrusterAvailability = activeThrusters.length * thrusterShare;
        let angularForce = 0;

        if (!this.coreSolo && activeThrusters.length > 0) {
          activeThrusters.forEach((thruster) => {
            const dir = Vec2.fromAngle(thruster.absoluteAngle + Math.PI, 1);
            const availableForce = thruster.thruster.force * thrusterShare * mobility;
            const projection =
              availableForce > 1e-6 ? (desiredAccel.x * dir.x + desiredAccel.y * dir.y) / availableForce : 0;
            const power = clamp(projection, 0, 1);
            thruster.thruster.power = power;
            const thrustAccel = dir.clone().scale(availableForce * power);
            acceleration.add(thrustAccel);
            const relative = thruster.worldEnd.clone().sub(this.pos);
            angularForce += relative.x * thrustAccel.y - relative.y * thrustAccel.x;
            if (power > 0.05) {
              const exhaust = thruster.worldEnd.clone();
              const color = Math.random() < 0.5 ? "#ffb066" : "#ff7a3c";
              const plumeBoost = 0.6 + power * 0.8 + thrusterAvailability * 0.4 + (mobility - 1) * 0.3;
              const vel = Vec2.fromAngle(
                thruster.absoluteAngle + Math.PI,
                180 + Math.random() * 140 * plumeBoost
              );
              particles.push(new Particle(exhaust, vel, 0.35 + Math.random() * 0.2 * plumeBoost, color, 2));
            }
          });
        } else {
          this.coreSolo = true;
          const maxAccel = (320 + this.level * 26) * mobility;
          if (desiredAccel.length() > maxAccel) desiredAccel.setLength(maxAccel);
          acceleration.add(desiredAccel);
        }

        const defenseVector = this.calculateDefenseVector();
        const playerVector = playerPos.clone().sub(this.pos);
        let angleError = 0;
        if (playerVector.length() > 1e-3) {
          const playerAngle = Math.atan2(playerVector.y, playerVector.x);
          const defenseMagnitude = defenseVector.length();
          const defenseAngle =
            defenseMagnitude > 1e-3 ? Math.atan2(defenseVector.y, defenseVector.x) : this.heading;
          angleError = wrapAngle(playerAngle - defenseAngle);
        }
        const rotationAvailability = thrusterAvailability;
        const controlTorque = angleError * 2200 - this.angularVel * 750;
        angularForce += controlTorque * rotationAvailability;
        if (rotationAvailability < 1e-3) {
          angularForce += (angleError * 600 - this.angularVel * 120) * 0.12;
        }

        this.angularVel += angularForce * dt * 0.0003;
        this.angularVel = clamp(this.angularVel, -1.2, 1.2);
        this.angularVel *= frameDecay(0.97, dt);
        this.heading = wrapAngle(this.heading + this.angularVel * dt);

        this.vel.add(acceleration.scale(dt * 0.4));
        const baseSpeed = 200 + this.level * 12;
        const maxSpeed = baseSpeed * mobility;
        if (this.vel.length() > maxSpeed) {
          this.vel.setLength(maxSpeed);
        }
        this.pos.add(this.vel.clone().scale(dt));

        const hardMarginX = Math.max(140, this.canvasWidth * 0.12);
        const hardTop = Math.max(100, this.canvasHeight * 0.14);
        const hardBottom = this.canvasHeight * 0.52;
        const leftBound = this.canvasWidth * 0.55;
        const rightBound = this.canvasWidth - hardMarginX;
        if (this.pos.x < leftBound) {
          this.pos.x = leftBound;
          if (this.vel.x < 0) this.vel.x *= -0.4;
        } else if (this.pos.x > rightBound) {
          this.pos.x = rightBound;
          if (this.vel.x > 0) this.vel.x *= -0.35;
        }
        if (this.pos.y < hardTop) {
          this.pos.y = hardTop;
          if (this.vel.y < 0) this.vel.y *= -0.35;
        } else if (this.pos.y > hardBottom) {
          this.pos.y = hardBottom;
          if (this.vel.y > 0) this.vel.y *= -0.35;
        }
      }

      this.updateGeometry();
      this.updateWeapons(dt, playerPos, spawn);
      this.segments.forEach((segment) => {
        if (segment.destroyed) return;
        if (segment.type === "weapon") {
          segment.flashTimer = Math.max(segment.flashTimer - dt * 2.4, 0);
          segment.recoil = Math.max(segment.recoil - dt * 3, 0);
          const pulse = segment.launcherStyle ? segment.launcherStyle.pulseSpeed : 1.2;
          segment.visualPhase += dt * pulse;
        } else if (segment.type === "thruster") {
          const power = segment.thruster ? segment.thruster.power : 0;
          segment.visualPhase += dt * (1.4 + power * 3.4);
          segment.flashTimer = Math.max(segment.flashTimer - dt * 3, 0);
        } else if (segment.type === "core") {
          segment.visualPhase += dt * (segment.weapon ? 1.8 : 0.8);
          segment.flashTimer = Math.max(segment.flashTimer - dt * 1.6, 0);
        } else {
          segment.visualPhase += dt * 0.6;
          segment.flashTimer = Math.max(segment.flashTimer - dt * 1.2, 0);
        }
      });
      this.updateDebris(dt, particles);
      this.remainingHealth = this.segments.reduce((acc, seg) => acc + Math.max(seg.health, 0), 0);
      return spawn;
    }
    updateWeapons(dt, playerPos, spawn) {
      if (this.coreCritical) return;
      const activeWeapons = this.coreSolo ? [this.core] : this.weaponSegments;
      activeWeapons.forEach((segment) => {
        if (!segment.weapon || segment.destroyed) return;
        segment.weapon.timer -= dt;
        if (segment.weapon.timer <= 0) {
          const result = segment.weapon.entry.fire(segment, this, playerPos, this.level, this.particles);
          if (result.bullets) spawn.bullets.push(...result.bullets);
          if (result.missiles) spawn.missiles.push(...result.missiles);
          if (result.lasers) spawn.lasers.push(...result.lasers);
          segment.weapon.timer = segment.nextCooldown(segment.weapon.entry, this.level);
          segment.flashTimer = 0.45;
          segment.recoil = 1;
        }
      });
      if (this.coreSolo && !this.core.weapon) {
        this.core.setWeapon(CORE_STORM_WEAPON, this.level);
      }
    }
    updateDebris(dt, particles) {
      this.debris = this.debris.filter((chunk) => {
        chunk.life -= dt;
        chunk.rotation += chunk.angularVelocity * dt;
        chunk.position.add(chunk.velocity.clone().scale(dt));
        chunk.velocity.y += 60 * dt;
        if (chunk.life <= 0) return false;
        if (Math.random() < 0.3) {
          const color = Math.random() < 0.5 ? "#ffab4f" : "#ffe9a8";
          const vel = Vec2.fromAngle(chunk.rotation + Math.random() * 0.8, 120 + Math.random() * 120);
          particles.push(new Particle(chunk.position.clone(), vel, 0.4, color, 2.8));
        }
        return true;
      });
    }
    hitTest(bullet) {
      if (this.coreCritical) return null;
      const hits = [];
      this.segments.forEach((segment) => {
        if (segment.destroyed) return;
        if (segment.type === "core") {
          const dist = bullet.pos.clone().sub(segment.worldCenter).length();
          if (dist <= bullet.radius + segment.radius) {
            const dir = bullet.vel.clone().normalize();
            const impact = segment.worldCenter.clone().add(dir.scale(segment.radius));
            hits.push({ segment, point: impact });
          }
        } else if (circlePolygonCollision(bullet.pos, bullet.radius, segment.polygon)) {
          let closest = bullet.pos.clone();
          if (!pointInPolygon(bullet.pos, segment.polygon)) {
            let minDist = Infinity;
            for (let i = 0; i < segment.polygon.length; i += 1) {
              const a = segment.polygon[i];
              const b = segment.polygon[(i + 1) % segment.polygon.length];
              const candidate = closestPointOnSegment(bullet.pos, a, b);
              const dist = candidate.clone().sub(bullet.pos).length();
              if (dist < minDist) {
                minDist = dist;
                closest = candidate;
              }
            }
          }
          hits.push({ segment, point: closest });
        }
      });
      if (hits.length === 0) return null;
      hits.sort((a, b) => {
        const da = a.segment.type === "core" ? 0 : a.point.clone().sub(this.pos).length();
        const db = b.segment.type === "core" ? 0 : b.point.clone().sub(this.pos).length();
        return da - db;
      });
      return hits[0];
    }
    applyDamage(segment, amount, particles) {
      const events = [];
      if (segment.destroyed) return events;

      segment.health -= amount;
      if (segment.type === "branch" && segment.children.length > 0) {
        const spread = amount * 0.5;
        const share = spread / segment.children.length;
        segment.children.forEach((child) => {
          child.health -= share;
          if (child.health <= 0 && !child.destroyed) {
            const childEvents = this.detachSegment(child, particles);
            events.push(...childEvents);
          }
        });
      }
      if (segment.type === "core") {
        this.segments.forEach((other) => {
          if (other === segment || other.destroyed) return;
          other.health -= amount * 0.35;
          if (other.health <= 0 && !other.destroyed) {
            const detachEvents = this.detachSegment(other, particles);
            events.push(...detachEvents);
          }
        });
      }
      if (segment.health <= 0 && !segment.destroyed) {
        segment.health = 0;
        if (segment.type === "core") {
          segment.destroyed = true;
          events.push({
            type: "score",
            score: Math.floor(segment.scoreValue),
            comboBoost: 0.6,
            message: "Core obliterated!",
            position: segment.worldCenter.clone(),
          });
          this.startCoreCritical(segment, particles);
          events.push({
            type: "info",
            message: "Warning: Core critical!",
          });
        } else {
          const detachEvents = this.detachSegment(segment, particles);
          events.push(...detachEvents);
        }
      }
      this.checkCoreSolo();
      return events;
    }
    detachSegment(segment, particles) {
      const events = [];
      const nodes = [];
      const collect = (node) => {
        node.destroyed = true;
        node.health = 0;
        nodes.push(node);
        node.children.slice().forEach((child) => collect(child));
        node.children = [];
      };
      collect(segment);

      if (segment.parent) {
        segment.parent.children = segment.parent.children.filter((child) => child !== segment);
      }

      nodes.forEach((node) => {
        this.segments = this.segments.filter((seg) => seg !== node);
        this.weaponSegments = this.weaponSegments.filter((seg) => seg !== node);
        this.thrusterSegments = this.thrusterSegments.filter((seg) => seg !== node);
      });

      const debrisPolygons = nodes
        .filter((node) => node.polygon.length > 0)
        .map((node) => ({
          polygon: node.polygon.map((point) => point.clone()),
          rotation: node.absoluteAngle,
        }));

      if (debrisPolygons.length > 0) {
        const center = debrisPolygons
          .map((poly) => poly.polygon.reduce((acc, p) => acc.add(p), new Vec2()).scale(1 / poly.polygon.length))
          .reduce((acc, p) => acc.add(p), new Vec2())
          .scale(1 / debrisPolygons.length);
        const chunk = {
          shapes: debrisPolygons,
          position: center.clone(),
          velocity: new Vec2((Math.random() - 0.5) * 220, -40 + Math.random() * 120),
          angularVelocity: (Math.random() - 0.5) * 2.4,
          rotation: 0,
          life: 3.4,
        };
        this.debris.push(chunk);
        for (let i = 0; i < 22; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 180 + Math.random() * 220;
          const vel = Vec2.fromAngle(angle, speed);
          const color = i % 3 === 0 ? "#f7e27a" : i % 3 === 1 ? "#ff9b5c" : "#ffffff";
          particles.push(new Particle(center.clone(), vel, 0.6 + Math.random() * 0.5, color, 3));
        }
      }

      const totalScore = nodes.reduce((acc, node) => acc + Math.max(node.scoreValue, 0), 0);
      events.push({
        type: "score",
        score: Math.floor(totalScore),
        comboBoost: 0.3,
        message: segment.type === "weapon" ? "Weapon offline!" : "Arm severed!",
        position: segment.worldCenter ? segment.worldCenter.clone() : this.pos.clone(),
      });
      return events;
    }
    checkCoreSolo() {
      if (!this.coreSolo && this.core.children.length === 0) {
        this.coreSolo = true;
        this.events.push({
          type: "info",
          message: "Core exposed! It goes berserk.",
        });
      }
    }
    isDefeated() {
      if (this.coreCritical) {
        return this.coreCriticalTimer >= 5;
      }
      return false;
    }
    draw(ctx, targetPos) {
      this.debris.forEach((chunk) => {
        ctx.save();
        ctx.translate(chunk.position.x, chunk.position.y);
        ctx.rotate(chunk.rotation);
        chunk.shapes.forEach((shape) => {
          ctx.beginPath();
          ctx.moveTo(shape.polygon[0].x - chunk.position.x, shape.polygon[0].y - chunk.position.y);
          for (let i = 1; i < shape.polygon.length; i += 1) {
            const point = shape.polygon[i];
            ctx.lineTo(point.x - chunk.position.x, point.y - chunk.position.y);
          }
          ctx.closePath();
          ctx.fillStyle = "rgba(100, 25, 18, 0.9)";
          ctx.fill();
          ctx.strokeStyle = "#d8d8d8";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        });
        ctx.restore();
      });

      const drawSegment = (segment) => {
        if (segment.destroyed) return;
        if (segment.type === "core") {
          ctx.save();
          ctx.translate(segment.worldCenter.x, segment.worldCenter.y);
          const pulse = 0.08 + 0.06 * Math.sin(segment.visualPhase);
          const outerRadius = segment.radius * (1.1 + pulse);
          const healthRatio =
            segment.maxHealth > 0 ? clamp(segment.health / segment.maxHealth, 0, 1) : 0;
          const heat = 1 - healthRatio;
          const mix = (from, to) => Math.round(lerp(from, to, heat));
          const emberGlow = `rgba(${mix(120, 255)}, ${mix(220, 90)}, ${mix(255, 70)}, ${
            0.65 + heat * 0.3
          })`;
          const rimColor = `rgba(${mix(200, 255)}, ${mix(180, 80)}, ${mix(140, 40)}, ${
            0.6 + heat * 0.35
          })`;
          const gradient = ctx.createRadialGradient(0, 0, segment.radius * 0.2, 0, 0, outerRadius);
          gradient.addColorStop(0, emberGlow);
          gradient.addColorStop(0.45, segment.colors.fill);
          gradient.addColorStop(1, `rgba(40,10,6, ${0.55 + heat * 0.35})`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = rimColor;
          ctx.shadowColor = emberGlow;
          ctx.shadowBlur = 18 + heat * 12;
          ctx.beginPath();
          ctx.arc(0, 0, segment.radius * (0.96 + pulse * 0.6), 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Subtle health ring that shortens as the core nears detonation.
          const ringRadius = segment.radius * (1.3 + pulse * 0.2);
          ctx.globalAlpha = 0.18;
          ctx.lineWidth = segment.radius * 0.16;
          ctx.strokeStyle = "rgba(60, 110, 150, 0.6)";
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.globalAlpha = 0.9;
          ctx.lineWidth = segment.radius * 0.18;
          const remainingColor = `rgba(${mix(140, 255)}, ${mix(200, 110)}, ${mix(255, 80)}, ${
            0.4 + heat * 0.45
          })`;
          ctx.strokeStyle = remainingColor;
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * healthRatio);
          ctx.stroke();
          ctx.globalAlpha = 1;

          if (segment.weapon && segment.weaponKey) {
            drawCoreArmature(ctx, segment);
          }
          ctx.restore();
        } else if (segment.polygon.length > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(segment.polygon[0].x, segment.polygon[0].y);
          for (let i = 1; i < segment.polygon.length; i += 1) {
            ctx.lineTo(segment.polygon[i].x, segment.polygon[i].y);
          }
          ctx.closePath();
          const gradient = ctx.createLinearGradient(
            segment.worldStart.x,
            segment.worldStart.y,
            segment.worldEnd.x,
            segment.worldEnd.y
          );
          gradient.addColorStop(0, segment.colors.fill);
          gradient.addColorStop(1, segment.colors.glow);
          ctx.fillStyle = gradient;
          ctx.globalAlpha = 0.92;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = segment.colors.stroke;
          ctx.shadowColor = segment.colors.glow;
          ctx.shadowBlur = segment.type === "weapon" ? 14 : segment.type === "thruster" ? 10 : 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
          if (segment.type === "weapon") {
            drawWeaponAttachment(ctx, segment, targetPos);
          } else if (segment.type === "thruster") {
            drawThrusterAttachment(ctx, segment);
          }
          ctx.restore();
        } else if (segment.type === "weapon") {
          drawWeaponAttachment(ctx, segment, targetPos);
        }
        segment.children.forEach((child) => drawSegment(child));
      };
      drawSegment(this.core);
      this.drawCoreCritical(ctx);
    }
    drawCoreCritical(ctx) {
      if (!this.coreCritical) return;
      const origin = this.coreCriticalOrigin;
      ctx.save();
      ctx.lineCap = "round";

      const fade = this.coreCriticalTimer <= 2.5 ? 1 : Math.max(0, 1 - (this.coreCriticalTimer - 2.5) / 2.5);

      this.coreShockwaves.forEach((wave) => {
        ctx.globalAlpha = wave.alpha * 0.5 * fade;
        ctx.strokeStyle = "rgba(255, 198, 120, 1)";
        ctx.lineWidth = wave.width;
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, wave.radius, 0, Math.PI * 2);
        ctx.stroke();
      });

      ctx.globalCompositeOperation = "lighter";
      this.corePlumes.forEach((plume) => {
        const lifeRatio = 1 - plume.life / plume.maxLife;
        const head = Vec2.fromAngle(plume.angle, plume.radius + this.coreCriticalRadius * 0.4);
        const tail = Vec2.fromAngle(plume.angle, plume.radius * 0.35);
        const normal = Vec2.fromAngle(plume.angle + Math.PI / 2, plume.width);
        ctx.globalAlpha = Math.max(0, lifeRatio) * 0.6 * fade;
        ctx.fillStyle = plume.color;
        ctx.beginPath();
        ctx.moveTo(origin.x + tail.x + normal.x, origin.y + tail.y + normal.y);
        ctx.lineTo(origin.x + head.x, origin.y + head.y);
        ctx.lineTo(origin.x + tail.x - normal.x, origin.y + tail.y - normal.y);
        ctx.closePath();
        ctx.fill();
      });

      const glowStrength = (0.45 + this.coreGlowIntensity * 0.45 + (this.coreExplosionTriggered ? 0.25 : 0)) * fade;
      const pulse = 1 + Math.sin(this.coreCriticalTimer * (4 + this.coreGlowIntensity * 12)) * 0.18;
      const outerRadius = this.coreCriticalRadius * (1.4 + glowStrength * 1.1);
      const gradient = ctx.createRadialGradient(
        origin.x,
        origin.y,
        this.coreCriticalRadius * 0.2,
        origin.x,
        origin.y,
        outerRadius
      );
      gradient.addColorStop(0, `rgba(255, 254, 240, ${0.6 + glowStrength * 0.35})`);
      gradient.addColorStop(0.4, `rgba(255, 220, 170, ${0.4 + glowStrength * 0.3})`);
      gradient.addColorStop(1, "rgba(60, 10, 6, 0)");
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, outerRadius * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#fff7d6";
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, this.coreCriticalRadius * (0.55 + glowStrength * 0.4), 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.6 * fade;
      ctx.strokeStyle = "#ffd4a4";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, this.coreCriticalRadius * (0.75 + glowStrength * 0.3), 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawWeaponAttachment(ctx, segment, targetPos) {
    const style =
      segment.launcherStyle ||
      (segment.weaponKey ? WEAPON_LAUNCHER_STYLES[segment.weaponKey] : null) ||
      WEAPON_LAUNCHER_STYLES.cannon;
    if (!style) return;
    const phase = segment.visualPhase || 0;
    const flash = segment.flashTimer || 0;
    const recoil = segment.recoil || 0;
    const targetAngle = targetPos
      ? Math.atan2(targetPos.y - segment.worldEnd.y, targetPos.x - segment.worldEnd.x)
      : segment.absoluteAngle;
    const aimOffset = wrapAngle(targetAngle - segment.absoluteAngle);
    ctx.save();
    ctx.translate(segment.worldEnd.x, segment.worldEnd.y);
    ctx.rotate(segment.absoluteAngle);
    const housingWidth = segment.thickness * 1.25;
    const housingBack = segment.thickness * 1.25;
    const housingForward = segment.thickness * 0.45;
    const recoilOffset = (style.recoil || 8) * recoil;
    ctx.translate(-recoilOffset, 0);

    drawRoundedRect(ctx, -housingBack, -housingWidth / 2, housingBack + housingForward, housingWidth, housingWidth * 0.32);
    ctx.fillStyle = style.body;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = style.accent;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const energyPulse = 0.35 + 0.25 * Math.sin(phase * (style.pulseSpeed + 0.6) + flash * 6);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.25 + energyPulse * 0.35;
    ctx.fillStyle = style.glow;
    ctx.beginPath();
    ctx.moveTo(-housingBack * 0.95, -housingWidth * 0.68);
    ctx.lineTo(-housingBack * 0.25, -housingWidth * 0.92);
    ctx.lineTo(-housingBack * 0.1, -housingWidth * 0.55);
    ctx.lineTo(-housingBack * 0.95, -housingWidth * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-housingBack * 0.95, housingWidth * 0.68);
    ctx.lineTo(-housingBack * 0.25, housingWidth * 0.92);
    ctx.lineTo(-housingBack * 0.1, housingWidth * 0.55);
    ctx.lineTo(-housingBack * 0.95, housingWidth * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const stripeCount = 3;
    const stripeSpan = housingBack + housingForward;
    const stripeHeight = housingWidth * 0.78;
    for (let i = 0; i < stripeCount; i += 1) {
      const stripeX = -housingBack + (i + 1) * (stripeSpan / (stripeCount + 1));
      const dynamic = Math.sin(phase * 2.6 + i * 1.7 + flash * 4);
      const stripeThickness = Math.max(housingWidth * 0.08, housingWidth * (0.1 + 0.04 * dynamic));
      ctx.save();
      ctx.globalAlpha = 0.4 + energyPulse * 0.25;
      ctx.fillStyle = style.accent;
      ctx.translate(stripeX, 0);
      ctx.rotate((i - 1) * 0.18);
      drawRoundedRect(ctx, -stripeThickness * 0.5, -stripeHeight * 0.5, stripeThickness, stripeHeight, stripeThickness * 0.45);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.25 + energyPulse * 0.2;
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-housingBack * 0.95, -housingWidth * 0.5);
    ctx.lineTo(-housingBack * 0.35, -housingWidth * 0.72);
    ctx.lineTo(-housingBack * 0.2, -housingWidth * 0.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-housingBack * 0.95, housingWidth * 0.5);
    ctx.lineTo(-housingBack * 0.35, housingWidth * 0.72);
    ctx.lineTo(-housingBack * 0.2, housingWidth * 0.28);
    ctx.stroke();
    ctx.restore();

    let muzzleDistance = segment.thickness;

    const drawHighlight = () => {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-housingBack * 0.6, -housingWidth * 0.35);
      ctx.lineTo(-housingBack * 0.15, -housingWidth * 0.18);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    ctx.save();
    ctx.rotate(aimOffset);

    switch (style.key) {
      case "spread": {
        const barrelLength = segment.thickness * 1.9;
        const barrelWidth = segment.thickness * 0.28;
        const fanAngle = 0.26;
        muzzleDistance = barrelLength + segment.thickness * 0.3;
        for (let i = 0; i < 3; i += 1) {
          const offset = (i - 1) * fanAngle;
          ctx.save();
          ctx.rotate(offset);
          drawRoundedRect(ctx, 0, -barrelWidth / 2, barrelLength, barrelWidth, barrelWidth * 0.45);
          ctx.fillStyle = style.barrel;
          ctx.globalAlpha = 0.9 - Math.abs(i - 1) * 0.2;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.accent;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const ringRadius = segment.thickness * (0.32 + 0.12 * Math.sin(phase * 2.1));
        ctx.arc(-housingBack * 0.35, 0, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = style.glow;
        ctx.beginPath();
        ctx.ellipse(-housingBack * 0.1, 0, segment.thickness * 0.5, segment.thickness * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "shatter": {
        muzzleDistance = segment.thickness * (1.8 + 0.3 * Math.sin(phase));
        for (let i = 0; i < 4; i += 1) {
          const angle = (i - 1.5) * 0.32 + Math.sin(phase + i) * 0.12;
          const length = segment.thickness * (1.4 + 0.25 * Math.sin(phase * 1.3 + i));
          ctx.save();
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(-segment.thickness * 0.2, -segment.thickness * 0.16);
          ctx.lineTo(length, 0);
          ctx.lineTo(-segment.thickness * 0.2, segment.thickness * 0.16);
          ctx.closePath();
          ctx.fillStyle = style.barrel;
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.accent;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = style.glow;
        ctx.beginPath();
        ctx.moveTo(-segment.thickness * 0.3, 0);
        ctx.lineTo(segment.thickness * 0.6, -segment.thickness * 0.4);
        ctx.lineTo(segment.thickness * 1.1, 0);
        ctx.lineTo(segment.thickness * 0.6, segment.thickness * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "missile": {
        const podSpacing = segment.thickness * 0.48;
        const podRadius = segment.thickness * 0.23;
        muzzleDistance = podSpacing * 2.3;
        for (let r = 0; r < 2; r += 1) {
          for (let c = 0; c < 2; c += 1) {
            const y = (r - 0.5) * podSpacing;
            const x = (c + 0.5) * podSpacing;
            ctx.beginPath();
            ctx.arc(x, y, podRadius * (1 + 0.08 * Math.sin(phase * 2 + c + r)), 0, Math.PI * 2);
            ctx.fillStyle = style.barrel;
            ctx.fill();
            ctx.strokeStyle = style.accent;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-housingBack * 0.5, -housingWidth * 0.45);
        ctx.lineTo(-housingBack * 0.2, -housingWidth * 0.2);
        ctx.lineTo(-housingBack * 0.2, housingWidth * 0.2);
        ctx.lineTo(-housingBack * 0.5, housingWidth * 0.45);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = style.glow;
        ctx.beginPath();
        ctx.moveTo(podSpacing * 1.7, -podSpacing * 0.7);
        ctx.lineTo(podSpacing * 2.4, 0);
        ctx.lineTo(podSpacing * 1.7, podSpacing * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "laser": {
        const ringRadius = segment.thickness * (0.6 + 0.18 * Math.sin(phase * 2));
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(-housingBack * 0.3, 0, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        const funnelLength = segment.thickness * 2.8;
        const funnelWidth = segment.thickness * 0.9;
        muzzleDistance = funnelLength + segment.thickness * 0.3;
        ctx.beginPath();
        ctx.moveTo(0, -funnelWidth / 2);
        ctx.lineTo(funnelLength, -funnelWidth * 0.15);
        ctx.lineTo(funnelLength, funnelWidth * 0.15);
        ctx.lineTo(0, funnelWidth / 2);
        ctx.closePath();
        ctx.fillStyle = style.barrel;
        ctx.globalAlpha = 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = style.glow;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(funnelLength * 0.4, -funnelWidth * 0.7);
        ctx.lineTo(funnelLength * 0.7, -funnelWidth * 0.05);
        ctx.lineTo(funnelLength * 0.4, funnelWidth * 0.7);
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }
      case "storm": {
        const coilLength = segment.thickness * 2.3;
        const coilRadius = segment.thickness * 0.55;
        muzzleDistance = coilLength + segment.thickness * 0.4;
        const loops = 4;
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 1.6;
        for (let i = 0; i < loops; i += 1) {
          const start = (coilLength / loops) * i;
          const end = start + coilLength / loops;
          ctx.beginPath();
          ctx.moveTo(start, -coilRadius * 0.8);
          ctx.bezierCurveTo(
            start + (end - start) * 0.25,
            -coilRadius * (1.2 + 0.2 * Math.sin(phase + i)),
            start + (end - start) * 0.75,
            coilRadius * (1.2 + 0.2 * Math.sin(phase + i + 0.5)),
            end,
            coilRadius * 0.8
          );
          ctx.stroke();
        }
        ctx.strokeStyle = style.glow;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(coilLength, -coilRadius);
        ctx.lineTo(coilLength + segment.thickness * 0.5, 0);
        ctx.lineTo(coilLength, coilRadius);
        ctx.stroke();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = style.glow;
        ctx.beginPath();
        ctx.arc(-housingBack * 0.25, 0, segment.thickness * (0.35 + 0.1 * Math.sin(phase * 3)), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "cannon":
      default: {
        const barrelWidth = segment.thickness * 0.46;
        const barrelLength = segment.thickness * 2.3;
        drawRoundedRect(ctx, 0, -barrelWidth / 2, barrelLength, barrelWidth, barrelWidth * 0.45);
        ctx.fillStyle = style.barrel;
        ctx.fill();
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        muzzleDistance = barrelLength + segment.thickness * 0.3;
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const collarRadius = segment.thickness * (0.34 + 0.08 * Math.sin(phase * 1.4));
        ctx.arc(-housingBack * 0.4, 0, collarRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(phase * 1.8);
        ctx.fillStyle = style.glow;
        drawRoundedRect(ctx, -housingBack * 0.6, -barrelWidth * 0.6, housingBack * 0.6, barrelWidth * 1.2, barrelWidth * 0.5);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
    }

    ctx.restore();

    drawHighlight();

    if (flash > 0) {
      ctx.save();
      ctx.rotate(aimOffset);
      const flashRadius = segment.thickness * (1.1 + flash * 2.6);
      const flashCenter = muzzleDistance;
      const gradient = ctx.createRadialGradient(flashCenter, 0, flashRadius * 0.25, flashCenter, 0, flashRadius);
      gradient.addColorStop(0, style.glow);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 0.7 + flash * 0.3;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(flashCenter, 0, flashRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.save();
    ctx.rotate(aimOffset);
    const reticleRadius = segment.thickness * (0.32 + energyPulse * 0.2);
    ctx.globalAlpha = 0.3 + energyPulse * 0.3 + flash * 0.3;
    ctx.strokeStyle = style.glow;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(muzzleDistance + segment.thickness * 0.25, 0, reticleRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(muzzleDistance + segment.thickness * 0.25 + reticleRadius, 0);
    ctx.lineTo(muzzleDistance + segment.thickness * 0.55 + reticleRadius, 0);
    ctx.moveTo(muzzleDistance + segment.thickness * 0.25, -reticleRadius);
    ctx.lineTo(muzzleDistance + segment.thickness * 0.25, -reticleRadius - segment.thickness * 0.2);
    ctx.moveTo(muzzleDistance + segment.thickness * 0.25, reticleRadius);
    ctx.lineTo(muzzleDistance + segment.thickness * 0.25, reticleRadius + segment.thickness * 0.2);
    ctx.stroke();
    ctx.restore();

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = style.glow;
    ctx.beginPath();
    ctx.arc(-housingBack * 0.55, 0, housingWidth * (0.55 + 0.2 * Math.sin(phase * 2)), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawThrusterAttachment(ctx, segment) {
    const power = segment.thruster ? segment.thruster.power : 0;
    const phase = segment.visualPhase || 0;
    ctx.save();
    ctx.translate(segment.worldEnd.x, segment.worldEnd.y);
    ctx.rotate(segment.absoluteAngle + Math.PI);

    const nozzleWidth = segment.thickness * (0.9 + power * 0.5);
    const nozzleLength = segment.thickness * 1.15;
    drawRoundedRect(ctx, -nozzleLength, -nozzleWidth / 2, nozzleLength, nozzleWidth, nozzleWidth * 0.35);
    ctx.fillStyle = "rgba(160, 42, 18, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "#ff9a54";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const innerWidth = nozzleWidth * 0.58;
    drawRoundedRect(ctx, -nozzleLength * 0.55, -innerWidth / 2, nozzleLength * 0.55, innerWidth, innerWidth * 0.28);
    ctx.fillStyle = "rgba(200, 68, 28, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "#ffb26a";
    ctx.lineWidth = 1.1;
    ctx.stroke();

    const plumeLength = segment.thickness * (1.6 + power * 3.2);
    const plumeDir = -1; // Flames should trail opposite the ship's heading.
    const plumeTip = plumeLength * plumeDir;
    const plumeControl = plumeLength * 0.45 * plumeDir;
    const plumeWidth = nozzleWidth * (0.8 + power * 1.4);
    const gradient = ctx.createLinearGradient(0, 0, plumeTip, 0);
    gradient.addColorStop(0, `rgba(255, 190, 120, ${0.5 + power * 0.35})`);
    gradient.addColorStop(0.6, `rgba(255, 140, 70, ${0.3 + power * 0.25})`);
    gradient.addColorStop(1, "rgba(120, 40, 10, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -plumeWidth / 2);
    ctx.quadraticCurveTo(
      plumeControl,
      -plumeWidth * (0.6 + 0.28 * Math.sin(phase * 3)),
      plumeTip,
      0
    );
    ctx.quadraticCurveTo(
      plumeControl,
      plumeWidth * (0.6 + 0.28 * Math.sin(phase * 3 + 1.4)),
      0,
      plumeWidth / 2
    );
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(255, 200, 150, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plumeLength * 0.32 * plumeDir, -plumeWidth * 0.25);
    ctx.lineTo(plumeLength * 0.78 * plumeDir, -plumeWidth * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(plumeLength * 0.32 * plumeDir, plumeWidth * 0.25);
    ctx.lineTo(plumeLength * 0.78 * plumeDir, plumeWidth * 0.05);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawCoreArmature(ctx, segment) {
    const style =
      (segment.weaponKey && WEAPON_LAUNCHER_STYLES[segment.weaponKey]) || WEAPON_LAUNCHER_STYLES["core-storm"];
    const phase = segment.visualPhase || 0;
    const flash = segment.flashTimer || 0;
    const radius = segment.radius;
    const innerRing = radius * (1.15 + 0.08 * Math.sin(phase * 1.5));
    const outerRing = innerRing + radius * 0.25;

    ctx.save();

    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, innerRing, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 8;
    ctx.strokeStyle = style.glow;
    ctx.beginPath();
    ctx.arc(0, 0, outerRing, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    const spokeCount = 5;
    for (let i = 0; i < spokeCount; i += 1) {
      const angle = phase * 0.7 + (i / spokeCount) * Math.PI * 2;
      ctx.save();
      ctx.rotate(angle);
      const inner = radius * 0.5;
      const outer = outerRing + radius * 0.12 * Math.sin(phase * 2 + i);
      ctx.beginPath();
      ctx.moveTo(inner, 0);
      ctx.quadraticCurveTo((inner + outer) / 2, radius * 0.18, outer, 0);
      ctx.quadraticCurveTo((inner + outer) / 2, -radius * 0.18, inner, 0);
      ctx.closePath();
      ctx.fillStyle = style.barrel;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = style.glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * (0.82 + 0.1 * Math.sin(phase * 2.4)), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (flash > 0) {
      const flareRadius = outerRing + radius * (0.25 + flash * 0.6);
      ctx.globalAlpha = 0.5 + flash * 0.4;
      ctx.fillStyle = style.glow;
      ctx.beginPath();
      ctx.arc(0, 0, flareRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  class Player {
    constructor(canvasWidth, canvasHeight) {
      this.pos = new Vec2(canvasWidth * 0.28, canvasHeight * 0.7);
      this.vel = new Vec2();
      this.radius = 14;
      this.maxSpeed = 640;
      this.thrust = 1250;
      this.frictionBase = 0.96; // per-frame damping tuned for 60 FPS
      this.reload = 0;
      this.reloadTime = 0.12;
      this.maxArmor = 5;
      this.armor = this.maxArmor;
      this.invulnerable = 0;
      this.fireDirection = new Vec2(1, 0);
      this.hitFlash = 0;
    }
    update(dt, input, canvasWidth, canvasHeight) {
      const dir = input.getMovementVector();
      if (dir.length() > 0) {
        this.vel.add(dir.clone().scale(this.thrust * dt));
      }
      const drag = frameDecay(this.frictionBase, dt);
      this.vel.scale(drag);
      if (this.vel.length() > this.maxSpeed) {
        this.vel.setLength(this.maxSpeed);
      }
      this.pos.add(this.vel.clone().scale(dt));
      this.pos.x = clamp(this.pos.x, this.radius, canvasWidth - this.radius);
      this.pos.y = clamp(this.pos.y, this.radius, canvasHeight - this.radius);
      this.reload -= dt;
      this.invulnerable = Math.max(this.invulnerable - dt, 0);
      this.hitFlash = Math.max(this.hitFlash - dt, 0);
    }
    fire() {
      if (this.reload > 0) return null;
      this.reload = this.reloadTime;
      const dir = this.fireDirection.clone();
      const velocity = dir.clone().scale(750);
      const bulletPos = this.pos.clone().add(dir.clone().scale(this.radius + 6));
      AUDIO.playBulletFire(1);
      return new Bullet(bulletPos, velocity, 4, "#7cf4ff", "player");
    }
    takeHit() {
      if (this.invulnerable > 0) return false;
      this.armor -= 1;
      if (this.armor < 0) this.armor = 0;
      this.invulnerable = 2;
      this.hitFlash = 0.5;
      AUDIO.playPlayerDamage();
      return this.armor <= 0;
    }
    draw(ctx) {
      const angle = this.vel.length() > 20 ? Math.atan2(this.vel.y, this.vel.x) : 0;
      ctx.save();
      ctx.translate(this.pos.x, this.pos.y);
      if (this.hitFlash > 0) {
        const t = clamp(this.hitFlash / 0.5, 0, 1);
        const radius = this.radius * (1.6 + (1 - t) * 0.8);
        const inner = this.radius * 0.4;
        const gradient = ctx.createRadialGradient(0, 0, inner, 0, 0, radius);
        gradient.addColorStop(0, `rgba(255, 240, 210, ${0.6 * t + 0.2})`);
        gradient.addColorStop(0.6, `rgba(255, 160, 80, ${0.35 * t})`);
        gradient.addColorStop(1, "rgba(255, 120, 60, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = t * 0.8;
        ctx.strokeStyle = "rgba(255, 220, 180, 0.9)";
        ctx.lineWidth = 2 + 4 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * (1.1 + (1 - t) * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.rotate(angle);
      if (this.invulnerable > 0 && Math.floor(this.invulnerable * 12) % 2 === 0) {
        ctx.globalAlpha = 0.35;
      }
      ctx.strokeStyle = this.invulnerable > 0 ? "#57c9ff" : "#9ff7ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-16, -11);
      ctx.lineTo(-10, -4);
      ctx.lineTo(-16, 0);
      ctx.lineTo(-10, 4);
      ctx.lineTo(-16, 11);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  class Game {
    constructor(input) {
      this.input = input;
      this.stars = [];
      this.particles = [];
      this.playerBullets = [];
      this.enemyBullets = [];
      this.enemyMissiles = [];
      this.enemyLasers = [];
      this.playerDeath = null;
      this.pendingMusicRestart = false;
      this.reset();
    }
    reset() {
      this.player = new Player(canvas.width / DPR, canvas.height / DPR);
      this.level = 1;
      this.score = 0;
      this.boss = new Boss(this.level, canvas.width / DPR, canvas.height / DPR);
      this.playerBullets = [];
      this.enemyBullets = [];
      this.enemyMissiles = [];
      this.enemyLasers = [];
      this.playerDeath = null;
      this.particles = [];
      this.stars = [];
      for (let i = 0; i < 140; i += 1) {
        this.stars.push(new Star(canvas.width / DPR, canvas.height / DPR));
      }
      this.levelTimer = 0;
      this.comboTimer = 0;
      this.comboMultiplier = 1;
      this.gameOver = false;
      this.messageTimer = 0;
      hudMessage.textContent = "";
      this.updateHUD();
      AUDIO.playWarning();
      if (this.pendingMusicRestart) {
        MUSIC.scheduleStart(1500);
        this.pendingMusicRestart = false;
      }
    }
    updateHUD() {
      hudScore.textContent = `Score: ${this.score}`;
    }
    update(dt) {
      const width = canvas.width / DPR;
      const height = canvas.height / DPR;
      this.updatePlayerDeath(dt);
      if (this.gameOver) {
        if (this.input.consumeInteraction()) {
          this.reset();
        }
        return;
      }

      this.levelTimer += dt;
      this.comboTimer = Math.max(this.comboTimer - dt, 0);
      if (this.comboTimer <= 0) {
        this.comboMultiplier = 1;
      }

      for (const star of this.stars) {
        star.update(dt, width, height);
      }

      if (!this.playerDeath) {
        this.player.update(dt, this.input, width, height);
        const bullet = this.player.fire();
        if (bullet) {
          this.playerBullets.push(bullet);
        }
      }

      const bossSpawn = this.boss.update(dt, this.player.pos, this.particles);
      this.enemyBullets.push(...bossSpawn.bullets);
      if (bossSpawn.bullets.length > 0) {
        AUDIO.playBulletFire(0.8);
      }
      this.enemyMissiles.push(...bossSpawn.missiles);
      this.enemyLasers.push(...bossSpawn.lasers);
      bossSpawn.events.forEach((event) => this.processEvent(event));
      if (this.boss.coreCritical) {
        this.enemyBullets = [];
        this.enemyMissiles = [];
        this.enemyLasers = [];
      }

      this.updateProjectiles(dt, width, height);
      this.handleCollisions();
      this.cleanupParticles(dt);

      if (this.boss.isDefeated()) {
        this.handleBossDefeated();
      }

      this.updateHUD();
      this.messageTimer = Math.max(this.messageTimer - dt, 0);
      if (this.messageTimer <= 0) {
        hudMessage.textContent = "";
      }
    }
    processEvent(event) {
      if (!event) return;
      if (event.type === "score") {
        const bonus = Math.floor(event.score * this.comboMultiplier);
        this.score += bonus;
        this.comboMultiplier = Math.min(this.comboMultiplier + (event.comboBoost || 0.2), 8);
        this.comboTimer = 2.6;
        if (event.message) {
          hudMessage.textContent = `${event.message} +${bonus}`;
          this.messageTimer = 1.6;
        }
        if (event.position) {
          this.spawnImpact(event.position, "#ff9354");
        }
      } else if (event.type === "info") {
        hudMessage.textContent = event.message;
        this.messageTimer = 2.4;
      }
    }
    updateProjectiles(dt, width, height) {
      this.playerBullets = this.playerBullets.filter((bullet) => {
        if (bullet.update(dt)) return false;
        if (bullet.pos.x < -10 || bullet.pos.x > width + 10 || bullet.pos.y < -10 || bullet.pos.y > height + 10) {
          return false;
        }
        return true;
      });
      this.enemyBullets = this.enemyBullets.filter((bullet) => {
        if (bullet.update(dt)) return false;
        if (bullet.pos.x < -30 || bullet.pos.x > width + 30 || bullet.pos.y < -30 || bullet.pos.y > height + 30) {
          return false;
        }
        return true;
      });
      this.enemyMissiles = this.enemyMissiles.filter((missile) => {
        if (missile.update(dt, this.player.pos, this.particles)) {
          this.spawnImpact(missile.pos, "#ffffff");
          for (let i = 0; i < 10; i += 1) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 160;
            const vel = Vec2.fromAngle(angle, speed);
            const color = i % 2 === 0 ? "#ffffff" : "#ffe9cc";
            this.particles.push(new Particle(missile.pos.clone(), vel, 0.8 + Math.random() * 0.6, color, 2.4));
          }
          return false;
        }
        if (missile.pos.x < -60 || missile.pos.x > width + 60 || missile.pos.y < -60 || missile.pos.y > height + 60) {
          return false;
        }
        return true;
      });
      this.enemyLasers = this.enemyLasers.filter((laser) => !laser.update(dt));
    }
    handleCollisions() {
      if (this.playerDeath) return;
      const applyPlayerDamage = (message, duration) => {
        const dead = this.player.takeHit();
        if (dead) {
          this.startPlayerDeath();
        } else {
          hudMessage.textContent = message;
          this.messageTimer = duration;
        }
      };
      for (let i = this.playerBullets.length - 1; i >= 0; i -= 1) {
        const bullet = this.playerBullets[i];
        const hit = this.boss.hitTest(bullet);
        if (hit) {
          const events = this.boss.applyDamage(hit.segment, 18, this.particles);
          events.forEach((event) => this.processEvent(event));
          this.spawnImpact(hit.point, hit.segment.type === "core" ? "#ffc66a" : "#ff8f46");
          this.playerBullets.splice(i, 1);
          continue;
        }
        let destroyed = false;
        for (let j = this.enemyMissiles.length - 1; j >= 0; j -= 1) {
          const missile = this.enemyMissiles[j];
          const dx = missile.pos.x - bullet.pos.x;
          const dy = missile.pos.y - bullet.pos.y;
          const radii = missile.radius + bullet.radius;
          if (dx * dx + dy * dy <= radii * radii) {
            this.enemyMissiles.splice(j, 1);
            this.playerBullets.splice(i, 1);
            this.spawnImpact(missile.pos, "#ffffff");
            destroyed = true;
            break;
          }
        }
        if (destroyed) continue;
      }

      for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
        const bullet = this.enemyBullets[i];
        const dist = bullet.pos.clone().sub(this.player.pos).length();
        if (dist < bullet.radius + this.player.radius) {
          this.enemyBullets.splice(i, 1);
          this.spawnImpact(this.player.pos, "#6ecaff");
          if (this.player.invulnerable <= 0) {
            applyPlayerDamage("Armor hit!", 1.2);
          }
          break;
        }
      }

      for (let i = this.enemyMissiles.length - 1; i >= 0; i -= 1) {
        const missile = this.enemyMissiles[i];
        const dist = missile.pos.clone().sub(this.player.pos).length();
        if (dist < missile.radius + this.player.radius) {
          this.enemyMissiles.splice(i, 1);
          this.spawnImpact(this.player.pos, "#6ecaff");
          if (this.player.invulnerable <= 0) {
            applyPlayerDamage("Armor hit!", 1.2);
          }
          break;
        }
      }

      if (this.player.invulnerable <= 0) {
        const coreDist = this.boss.core.worldCenter.clone().sub(this.player.pos).length();
        if (coreDist < this.player.radius + this.boss.core.radius) {
          this.spawnImpact(this.player.pos, "#6ecaff");
          applyPlayerDamage("Hull collision!", 1.2);
          return;
        }
        for (const segment of this.boss.segments) {
          if (segment.destroyed || segment.type === "core") continue;
          const polygon = segment.polygon;
          if (polygon.length === 0) return;
          const nearest = polygon.reduce(
            (nearest, point) => {
              const dist = point.clone().sub(this.player.pos).length();
              if (dist < nearest.dist) return { dist, point };
              return nearest;
            },
            { dist: Infinity, point: null }
          );
          if (nearest.point && nearest.dist < this.player.radius + Math.max(10, segment.thickness * 0.5)) {
            this.spawnImpact(this.player.pos, "#6ecaff");
            applyPlayerDamage("Hull collision!", 1.2);
            break;
          }
        }
      }

      for (const laser of this.enemyLasers) {
        if (laser.checkCollision(this.player.pos, this.player.radius)) {
          const impactPoint = laser.closestPoint(this.player.pos);
          laser.terminate(impactPoint, this.particles);
          this.spawnImpact(this.player.pos, "#6ecaff");
          if (this.player.invulnerable <= 0) {
            applyPlayerDamage("Laser burn!", 1.4);
          }
          break;
        }
      }
    }

    spawnImpact(pos, color) {
      for (let i = 0; i < 14; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 160 + Math.random() * 220;
        const velocity = Vec2.fromAngle(angle, speed);
        const particle = new Particle(pos.clone(), velocity, 0.6 + Math.random() * 0.4, color, 2.6);
        this.particles.push(particle);
      }
      AUDIO.playBulletImpact();
    }
    cleanupParticles(dt) {
      this.particles = this.particles.filter((p) => !p.update(dt));
    }
    startPlayerDeath() {
      if (this.playerDeath) return;
      const origin = this.player.pos.clone();
      const colors = ["#9ff7ff", "#ffe7c0", "#ff9f6d"];
      const shards = [];
      for (let i = 0; i < 40; i += 1) {
        shards.push(new PlayerShard(origin, colors[i % colors.length]));
      }
      for (let i = 0; i < 28; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 140 + Math.random() * 240;
        const vel = Vec2.fromAngle(angle, speed);
        const color = i % 2 === 0 ? "#fff5ce" : "#ffb38a";
        this.particles.push(new Particle(origin.clone(), vel, 1 + Math.random() * 1.2, color, 3.2));
      }
      this.playerDeath = {
        timer: 0,
        duration: 2.8,
        shards,
        origin,
      };
      this.player.invulnerable = 999;
      this.player.vel.set(0, 0);
      this.pendingMusicRestart = true;
      MUSIC.stop();
      AUDIO.playBossExplosion();
    }
    updatePlayerDeath(dt) {
      if (!this.playerDeath) return;
      this.playerDeath.timer += dt;
      this.playerDeath.shards = this.playerDeath.shards.filter((shard) => !shard.update(dt));
      if (this.playerDeath.timer >= this.playerDeath.duration && !this.gameOver) {
        this.triggerGameOver();
      }
    }
    drawPlayerDeath() {
      if (!this.playerDeath) return;
      const { origin, timer, duration, shards } = this.playerDeath;
      const progress = clamp(timer / duration, 0, 1);
      const radius = 30 + progress * 140;
      ctx.save();
      ctx.globalAlpha = 0.35 * (1 - progress * 0.6);
      ctx.strokeStyle = "rgba(255, 190, 150, 0.7)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      shards.forEach((shard) => shard.draw(ctx));
    }
    handleBossDefeated() {
      const clearTime = Math.max(this.levelTimer, 0.1);
      const timeBonus = Math.max(0, Math.floor(3000 / clearTime));
      const levelBonus = 800 + this.level * 220;
      const bonus = Math.floor((timeBonus + levelBonus) * this.comboMultiplier);
      this.score += bonus;
      hudMessage.textContent = `Boss defeated! +${bonus} pts`;
      this.messageTimer = 3;
      MUSIC.queueNext(2000);
      AUDIO.playBossExplosion();
      this.level += 1;
      this.levelTimer = 0;
      this.comboMultiplier = Math.min(this.comboMultiplier + 0.4, 8);
      this.boss = new Boss(this.level, canvas.width / DPR, canvas.height / DPR);
      AUDIO.playWarning();
      this.enemyBullets = [];
      this.enemyMissiles = [];
      this.enemyLasers = [];
      this.playerBullets = [];
      this.spawnImpact(this.boss.pos, "#ff8b43");
      this.updateHUD();
    }
    triggerGameOver() {
      if (this.gameOver) return;
      this.gameOver = true;
      if (this.input) {
        this.input.consumeInteraction();
      }
      hudMessage.textContent = "Ship lost. Tap or press any key to continue.";
      this.messageTimer = Infinity;
    }
    draw() {
      const width = canvas.width / DPR;
      const height = canvas.height / DPR;
      ctx.clearRect(0, 0, width, height);

      for (const star of this.stars) {
        star.draw(ctx);
      }

      this.boss.draw(ctx, this.player.pos);

      ctx.strokeStyle = "#ffffff";
      for (const bullet of this.enemyBullets) {
        bullet.draw(ctx);
      }

      for (const missile of this.enemyMissiles) {
        missile.draw(ctx);
      }

      for (const laser of this.enemyLasers) {
        laser.draw(ctx);
      }

      ctx.strokeStyle = "#9ff7ff";
      for (const bullet of this.playerBullets) {
        bullet.draw(ctx);
      }

      for (const particle of this.particles) {
        particle.draw(ctx);
      }

      if (this.playerDeath) {
        this.drawPlayerDeath();
      } else {
        this.player.draw(ctx);
      }

      this.drawPlayerHealth(width);
      if (this.gameOver) {
        this.drawGameOver(width, height);
      }
    }
    drawPlayerHealth(width) {
      const segments = this.player.maxArmor || 1;
      const remaining = Math.max(0, Math.round(this.player.armor));
      const barWidth = Math.min(width - 120, 460);
      const barHeight = 18;
      const gap = 6;
      ctx.save();
      ctx.translate((width - barWidth) / 2, 32);
      ctx.lineWidth = 2;
      for (let i = 0; i < segments; i += 1) {
        const x = i * ((barWidth - (segments - 1) * gap) / segments + gap);
        const segmentWidth = (barWidth - (segments - 1) * gap) / segments;
        ctx.strokeStyle = "rgba(30, 80, 50, 0.9)";
        ctx.fillStyle = i < remaining ? "rgba(88, 215, 120, 0.85)" : "rgba(40, 80, 50, 0.35)";
        drawRoundedRect(ctx, x, -barHeight / 2, segmentWidth, barHeight, 4);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    drawGameOver(width, height) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#01040a";
      ctx.fillRect(0, height / 2 - 60, width, 120);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#f27e8c";
      ctx.font = "28px 'Segoe UI'";
      ctx.textAlign = "center";
      ctx.fillText("You are defeated.", width / 2, height / 2 - 10);
      ctx.fillStyle = "#9ff7ff";
      ctx.font = "18px 'Segoe UI'";
      ctx.fillText(`Final score: ${this.score}`, width / 2, height / 2 + 20);
      ctx.fillText("Tap or press any key to continue.", width / 2, height / 2 + 50);
      ctx.restore();
    }
  }

  const input = new Input(canvas);
  const game = new Game(input);
  let lastTime = performance.now();

  function loop(now) {
    const rawDt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    const scaledDt = scaleDelta(rawDt);
    game.update(scaledDt);
    game.draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
