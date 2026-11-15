/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { sound } from './audio';
import { COUNTRIES, CountryData, createFlagBadge } from './flags';

// Exact numerical constants from Technical Specification (Section 2)
export const SW = 384;
export const SH = 700;
export const CX = 192;
export const CY = 314;
export const R = 175;
export const rr = 0.078; // flag radius fraction of R -> 2*rr*R = 27.3px
export const HR = 0.27; // hole radius fraction of R -> 47.25px
export const NB = 6; // number of spinning paddles
export const FLAGS_PER_ROUND = 40;

export interface FlagEntity {
  id: number;
  country: CountryData;
  x: number; // normalized coordinate (-1..1)
  y: number; // normalized coordinate (-1..1)
  vx: number; // normalized arena radii / sec
  vy: number; // normalized arena radii / sec
  sp: number; // constant speed (0.3 + rand * 0.2)
  on: number; // 1 = alive, 0 = eliminated
  h: number; // 1 = in hole zone (d < HR), 0 = outside
  sh: number; // shield timer in seconds
  isWinner: boolean; // predetermined winner (never eliminated)
  sprite: HTMLCanvasElement;
}

export interface CaptureState {
  f: FlagEntity;
  t: number;
  a0: number;
  r0: number;
}

export interface EliminationToast {
  country: CountryData;
  sprite: HTMLCanvasElement;
  t: number;
}

export interface ShieldBannerState {
  country: CountryData;
  sprite: HTMLCanvasElement;
  t: number;
}

export interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  color: string;
}

export class WinnerPool {
  private pool: number[] = [];

  getNextWinner(): number {
    if (this.pool.length === 0) {
      this.pool = COUNTRIES.map((_, i) => i);
      for (let i = this.pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = this.pool[i];
        this.pool[i] = this.pool[j];
        this.pool[j] = temp;
      }
    }
    return this.pool.pop()!;
  }
}

// Rounded rectangle helper
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export class GameEngine {
  winnerPool = new WinnerPool();
  flags: FlagEntity[] = [];
  winnerFlag: FlagEntity | null = null;
  outs: FlagEntity[] = [];

  t = 0; // global timer
  a = 0; // paddle angle (rad)
  flash = 0;
  lastE = 0; // time of last elimination
  nextShield = 12; // first shield at 12s
  cap: CaptureState | null = null;
  toast: EliminationToast | null = null;
  shieldBanner: ShieldBannerState | null = null;

  // Winner & Confetti (Phase 1)
  phase = 0; // 0 = playing, 1 = winner screen
  wt = 0; // winner phase timer
  confetti: ConfettiParticle[] = [];
  bigWinnerSprite: HTMLCanvasElement | null = null;
  round = 0;

  allowEliminations = true;

  constructor() {
    this.startRound();
  }

  startRound() {
    this.round++;
    this.t = 0;
    this.a = 0;
    this.flash = 0;
    this.lastE = 0;
    this.nextShield = 12;
    this.cap = null;
    this.toast = null;
    this.shieldBanner = null;
    this.phase = 0;
    this.wt = 0;
    this.confetti = [];
    this.outs = [];

    // 1. Predetermined winner selection from shuffled pool
    const winnerIdx = this.winnerPool.getNextWinner();

    // 2. Select 39 other random countries
    const candidateIndices = COUNTRIES.map((_, i) => i).filter((i) => i !== winnerIdx);
    for (let i = candidateIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = candidateIndices[i];
      candidateIndices[i] = candidateIndices[j];
      candidateIndices[j] = temp;
    }
    const selected39 = candidateIndices.slice(0, FLAGS_PER_ROUND - 1);
    const roundCountryIndices = [winnerIdx, ...selected39];

    // 3. Spawn 40 flags with random polar coordinates & random heading
    this.flags = roundCountryIndices.map((cIdx, i) => {
      const country = COUNTRIES[cIdx];
      const isWinner = i === 0;

      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * 0.8;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;

      const heading = Math.random() * Math.PI * 2;
      const sp = 0.3 + Math.random() * 0.2;
      const vx = Math.cos(heading) * sp;
      const vy = Math.sin(heading) * sp;

      const sprite = createFlagBadge(country, 64);

      return {
        id: i,
        country,
        x,
        y,
        vx,
        vy,
        sp,
        on: 1,
        h: 0,
        sh: 0,
        isWinner,
        sprite,
      };
    });

    this.winnerFlag = this.flags[0];

    // Build big winner sprite of size 360 (crisp for 180x180 retina display)
    this.bigWinnerSprite = createFlagBadge(this.winnerFlag.country, 360);

    this.resolveSpawnOverlaps();
  }

  private resolveSpawnOverlaps() {
    const minDist = 2 * rr;
    for (let iter = 0; iter < 10; iter++) {
      for (let i = 0; i < this.flags.length; i++) {
        for (let j = i + 1; j < this.flags.length; j++) {
          const f1 = this.flags[i];
          const f2 = this.flags[j];
          const dx = f2.x - f1.x;
          const dy = f2.y - f1.y;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist && dist > 1e-5) {
            const overlap = minDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            f1.x -= nx * (overlap * 0.5);
            f1.y -= ny * (overlap * 0.5);
            f2.x += nx * (overlap * 0.5);
            f2.y += ny * (overlap * 0.5);
          }
        }
      }
    }
  }

  public triggerWin() {
    if (this.phase === 1) return;
    this.phase = 1;
    this.wt = 0;

    // Identify remaining winner flag
    const alive = this.flags.filter((f) => f.on === 1);
    if (alive.length > 0) {
      this.winnerFlag = alive[0];
    }

    if (this.winnerFlag) {
      this.bigWinnerSprite = createFlagBadge(this.winnerFlag.country, 360);
    }

    // Play win fanfare & announce winner
    sound.playWinFanfare();
    if (this.winnerFlag) {
      sound.speak(`${this.winnerFlag.country.name} wins!`);
    }

    // Spawn 160 confetti particles at (192, 314)
    // vx = (rand-0.5)*500, vy = -(rand*450 + 80), rotation 0, spin (rand-0.5)*12,
    // colours random from #ffd23f #ff4d6d #4cc9f0 #80ed99 #fff
    const confettiColors = ['#ffd23f', '#ff4d6d', '#4cc9f0', '#80ed99', '#ffffff'];
    this.confetti = [];
    for (let i = 0; i < 160; i++) {
      this.confetti.push({
        x: 192,
        y: 314,
        vx: (Math.random() - 0.5) * 500,
        vy: -(Math.random() * 450 + 80),
        rot: 0,
        spin: (Math.random() - 0.5) * 12,
        color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      });
    }
  }

  /**
   * Physics sub-step dt (run twice per frame with dt = min(frameDelta, 0.04) / 2)
   */
  physicsSubStep(dt: number) {
    if (this.phase === 1) {
      // During phase 1 only confetti is simulated (gravity +500 px/s² on vy, positions in logical px)
      this.wt += dt;
      for (const p of this.confetti) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 500 * dt; // gravity
        p.rot += p.spin * dt;
      }

      // After wt > 8 seconds call start() again -> infinite auto-restart
      if (this.wt > 8) {
        this.startRound();
      }
      return;
    }

    this.t += dt;
    this.a += 0.5 * dt; // 0.5 rad/s clockwise
    this.flash = Math.max(0, this.flash - dt * 2.5);

    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t >= 2.4) {
        this.toast = null;
      }
    }

    if (this.shieldBanner) {
      this.shieldBanner.t += dt;
      if (this.shieldBanner.t >= 3.2) {
        this.shieldBanner = null;
      }
    }

    const aliveCount = this.flags.filter((f) => f.on === 1).length;

    // Check Win Condition: when exactly 1 flag is alive
    if (aliveCount === 1) {
      this.triggerWin();
      return;
    }

    // Derived values
    const gap = 1.8 + 2 * Math.min(1, aliveCount / 40);
    const pull = Math.min(0.2 + this.t * 0.01, 1.5);

    // Shield power-up: when t > nextShield
    if (this.t > this.nextShield) {
      this.nextShield = this.t + 22;
      const candidates = this.flags.filter(
        (f) => f.on === 1 && !f.isWinner && f.sh <= 0 && (!this.cap || this.cap.f !== f)
      );
      if (candidates.length > 3) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        picked.sh = 9;
        this.shieldBanner = {
          country: picked.country,
          sprite: picked.sprite,
          t: 0,
        };
        sound.playChime();
      }
    }

    const aliveFlags = this.flags.filter((f) => f.on === 1);

    for (const flag of aliveFlags) {
      // 1. Decrement sh if > 0
      if (flag.sh > 0) {
        flag.sh = Math.max(0, flag.sh - dt);
      }

      // 2. If this flag is being captured
      if (this.cap && this.cap.f === flag) {
        this.cap.t += dt;
        const k = Math.min(1, this.cap.t / 1.2);
        const spiralAngle = this.cap.a0 + k * 9;
        const radius = this.cap.r0 * (1 - k);
        flag.x = Math.cos(spiralAngle) * radius;
        flag.y = Math.sin(spiralAngle) * radius;
        flag.vx = 0;
        flag.vy = 0;

        if (k >= 1) {
          flag.on = 0;
          this.outs.push(flag);
          this.lastE = this.t;
          this.flash = 0.35;
          this.toast = {
            country: flag.country,
            sprite: flag.sprite,
            t: 0,
          };
          this.cap = null;

          sound.playHit();
          sound.speak(`${flag.country.name} is out`);

          // Check if win condition reached immediately after elimination
          const remaining = this.flags.filter((f) => f.on === 1).length;
          if (remaining === 1) {
            this.triggerWin();
            return;
          }
        }
        continue;
      }

      // 3. Move: x += vx*dt; y += vy*dt
      flag.x += flag.vx * dt;
      flag.y += flag.vy * dt;

      // 4. Wall bounce
      const d = Math.hypot(flag.x, flag.y);
      const wallLimit = 1 - rr;
      if (d > wallLimit && d > 1e-6) {
        const nx = flag.x / d;
        const ny = flag.y / d;
        const dot = flag.vx * nx + flag.vy * ny;
        if (dot > 0) {
          flag.vx -= 2 * dot * nx;
          flag.vy -= 2 * dot * ny;
        }
        flag.x = nx * wallLimit;
        flag.y = ny * wallLimit;
      }

      // 5. Paddles (6 of them, angle th = a + k*2π/6)
      const paddleHalfThick = 0.024;
      const requiredDist = rr + paddleHalfThick; // 0.102

      for (let k = 0; k < NB; k++) {
        const th = this.a + (k * Math.PI * 2) / NB;
        const ux = Math.cos(th);
        const uy = Math.sin(th);

        const dotVal = flag.x * ux + flag.y * uy;
        const s = Math.max(0.66, Math.min(1.0, dotVal));
        const px = ux * s;
        const py = uy * s;

        const dx = flag.x - px;
        const dy = flag.y - py;
        const distToPaddle = Math.hypot(dx, dy);

        if (distToPaddle < requiredDist) {
          let normX = 0;
          let normY = 0;
          if (distToPaddle > 1e-6) {
            normX = dx / distToPaddle;
            normY = dy / distToPaddle;
          } else {
            normX = -uy;
            normY = ux;
          }

          flag.x = px + normX * requiredDist;
          flag.y = py + normY * requiredDist;

          const vDotN = flag.vx * normX + flag.vy * normY;
          if (vDotN < 0) {
            flag.vx -= 2 * vDotN * normX;
            flag.vy -= 2 * vDotN * normY;
          }
        }
      }

      // 6. Recompute d; flag.h = (d < HR) (inside hole zone)
      const curD = Math.hypot(flag.x, flag.y);
      flag.h = curD < HR ? 1 : 0;

      // 7. Behaviour by type
      if (flag.isWinner || flag.sh > 0) {
        // Winner or shielded: if d < HR + rr, accelerate outward
        if (curD < HR + rr && curD > 1e-6) {
          flag.vx += (flag.x / curD) * 8 * dt;
          flag.vy += (flag.y / curD) * 8 * dt;
        }
      } else if (flag.h === 1) {
        // Normal flag inside hole zone (h): sucked to center and damped
        flag.vx -= flag.x * 2.5 * dt;
        flag.vy -= flag.y * 2.5 * dt;
        flag.vx *= 1 - 0.6 * dt;
        flag.vy *= 1 - 0.6 * dt;

        if (this.allowEliminations && curD < 0.14 && !this.cap && this.t - this.lastE > gap) {
          this.cap = {
            f: flag,
            t: 0,
            a0: Math.atan2(flag.y, flag.x),
            r0: curD,
          };
          sound.playWhoosh();
        }
      } else {
        // Normal flag outside hole: mild center pull
        flag.vx -= flag.x * pull * dt;
        flag.vy -= flag.y * pull * dt;
      }
    }

    // 8. Anti-stall
    if (this.allowEliminations && !this.cap && this.t - this.lastE > gap + 14) {
      const candidates = aliveFlags.filter((f) => !f.isWinner && f.sh <= 0);
      if (candidates.length > 0) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        const curD = Math.hypot(picked.x, picked.y);
        this.cap = {
          f: picked,
          t: 0,
          a0: Math.atan2(picked.y, picked.x),
          r0: curD,
        };
        sound.playWhoosh();
      }
    }

    // 9. Flag-vs-flag collisions
    const activeAlive = this.flags.filter((f) => f.on === 1 && (!this.cap || this.cap.f !== f));
    const minDist = 2 * rr;

    for (let i = 0; i < activeAlive.length; i++) {
      const f1 = activeAlive[i];
      for (let j = i + 1; j < activeAlive.length; j++) {
        const f2 = activeAlive[j];
        const dx = f2.x - f1.x;
        const dy = f2.y - f1.y;
        const dist = Math.hypot(dx, dy);

        if (dist < minDist && dist > 1e-6) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          f1.x -= nx * (overlap * 0.5);
          f1.y -= ny * (overlap * 0.5);
          f2.x += nx * (overlap * 0.5);
          f2.y += ny * (overlap * 0.5);

          const v1n = f1.vx * nx + f1.vy * ny;
          const v2n = f2.vx * nx + f2.vy * ny;
          if (v1n - v2n > 0) {
            const diff = v1n - v2n;
            f1.vx -= diff * nx;
            f1.vy -= diff * ny;
            f2.vx += diff * nx;
            f2.vy += diff * ny;
          }
        }
      }
    }

    // 10. Speed normalization & absolute arena boundary containment
    const wallLimit = 1 - rr;
    for (const flag of aliveFlags) {
      if (this.cap && this.cap.f === flag) continue;

      if (!flag.h || flag.isWinner || flag.sh > 0) {
        const curSp = Math.hypot(flag.vx, flag.vy);
        if (curSp > 1e-6) {
          const factor = flag.sp / curSp;
          flag.vx *= factor;
          flag.vy *= factor;
        }
      }

      // Safeguard against boundary clipping from cumulative collision pushes
      const finalD = Math.hypot(flag.x, flag.y);
      if (finalD > wallLimit && finalD > 1e-6) {
        flag.x = (flag.x / finalD) * wallLimit;
        flag.y = (flag.y / finalD) * wallLimit;
      }
    }
  }

  /**
   * Main render pass into canvas (all coordinates are logical 384x700)
   */
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    sc: number,
    ox: number,
    oy: number,
    dpr: number,
    showWinnerHighlight = true
  ) {
    const aliveCount = this.flags.filter((f) => f.on === 1).length;
    const eliminatedCount = this.outs.length;
    const N = FLAGS_PER_ROUND;

    // 1. Clear outer letterbox bars in black
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Set logical 384x700 transform and clip
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, ox * dpr, oy * dpr);
    ctx.beginPath();
    ctx.rect(0, 0, SW, SH);
    ctx.clip();

    // 3. Background: solid #070b1a
    ctx.fillStyle = '#070b1a';
    ctx.fillRect(0, 0, SW, SH);

    // Radial gradient #1: centre (0,300), radius 260, #2d5fd066 -> transparent
    const g1 = ctx.createRadialGradient(0, 300, 0, 0, 300, 260);
    g1.addColorStop(0, '#2d5fd066');
    g1.addColorStop(1, 'rgba(45, 95, 208, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, SW, SH);

    // Radial gradient #2: centre (384,430), radius 260, #d6303066 -> transparent
    const g2 = ctx.createRadialGradient(384, 430, 0, 384, 430, 260);
    g2.addColorStop(0, '#d6303066');
    g2.addColorStop(1, 'rgba(214, 48, 48, 0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, SW, SH);

    // Section 7.2: Header
    // "FLAG CLASH " Anton 17px white, left aligned at (10,36); "ARENA" in gold #ffd23f directly after it
    ctx.font = '17px "Anton", Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('FLAG CLASH ', 10, 36);
    const textWidth = ctx.measureText('FLAG CLASH ').width;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('ARENA', 10 + textWidth, 36);

    // Pill 1: rounded rect (168,16,66x38, radius 6), fill #0d1430cc, 1px stroke #ffffff33.
    // Label "COUNTRIES" 7px system-ui #9aa4c7 at (201,28) centred; value N (40) Anton 18px white at (201,47).
    ctx.save();
    drawRoundedRect(ctx, 168, 16, 66, 38, 6);
    ctx.fillStyle = '#0d1430cc';
    ctx.fill();
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '7px system-ui, sans-serif';
    ctx.fillStyle = '#9aa4c7';
    ctx.fillText('COUNTRIES', 201, 28);
    ctx.font = '18px "Anton", Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(N), 201, 47);
    ctx.restore();

    // Pill 2: same at (242,16): label "REMAINING", value N - eliminated in gold
    ctx.save();
    drawRoundedRect(ctx, 242, 16, 66, 38, 6);
    ctx.fillStyle = '#0d1430cc';
    ctx.fill();
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '7px system-ui, sans-serif';
    ctx.fillStyle = '#9aa4c7';
    ctx.fillText('REMAINING', 275, 28);
    ctx.font = '18px "Anton", Impact, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(String(aliveCount), 275, 47);
    ctx.restore();

    // Progress ring at (346,35), radius 14, lineWidth 3: track #ffffff33 full circle;
    // gold #ffd23f arc starting at -π/2 sweeping 2π*eliminated/N; round number in the middle Anton 15px white at (346,41).
    ctx.save();
    ctx.beginPath();
    ctx.arc(346, 35, 14, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (eliminatedCount > 0) {
      ctx.beginPath();
      const sweep = (Math.PI * 2 * eliminatedCount) / N;
      ctx.arc(346, 35, 14, -Math.PI / 2, -Math.PI / 2 + sweep);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = '15px "Anton", Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(this.round), 346, 41);
    ctx.restore();

    // Section 7.3: Title block (y 62-130)
    if (this.shieldBanner && this.shieldBanner.t < 3.2) {
      // While a shield banner is active (first 3.2s after shield, fades with alpha min(1,(3.2-t)*2)):
      // replaces the title with a pill (76,62,232x58, radius 8, fill #0d1430ee, stroke #22d3ee),
      // small flag 28x28 at (88,77), text " SHIELDED" Anton 15px white left at (126,88), subtext "Shield power" 9px #67e8f9 at (126,106).
      const bannerAlpha = Math.max(0, Math.min(1, (3.2 - this.shieldBanner.t) * 2));
      ctx.save();
      ctx.globalAlpha = bannerAlpha;

      drawRoundedRect(ctx, 76, 62, 232, 58, 8);
      ctx.fillStyle = '#0d1430ee';
      ctx.fill();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.drawImage(this.shieldBanner.sprite, 88, 77, 28, 28);

      ctx.textAlign = 'left';
      ctx.font = '15px "Anton", Impact, sans-serif';
      ctx.fillStyle = '#ffffff';
      const shieldTitle = `${this.shieldBanner.country.name.toUpperCase()} SHIELDED`;
      ctx.fillText(shieldTitle, 126, 88);

      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('Shield power (immune for 9s)', 126, 106);
      ctx.restore();
    } else {
      // Normally: "ROUND n" 9px #9aa4c7 at (192,76); "WHICH FLAG" Anton 26px white at (192,100); "SURVIVES?" Anton 26px gold at (192,130).
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = '#9aa4c7';
      ctx.fillText(`ROUND ${this.round}`, 192, 76);

      ctx.font = '26px "Anton", Impact, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('WHICH FLAG', 192, 100);

      ctx.fillStyle = '#ffd23f';
      ctx.fillText('SURVIVES?', 192, 130);
      ctx.restore();
    }

    // 4. Arena disc: circle (192,314) radius 175, fill #0c1330
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.fillStyle = '#0c1330';
    ctx.fill();

    // 5. Central spinning hole (radius HR * R = 47.25px)
    const holeRadius = HR * R;
    const isCapturing = this.cap !== null;

    if (isCapturing) {
      // While a capture is running: solid #0a0418 fill + magenta neon rim #ff2bd6, lineWidth 3, shadowBlur 18 (glow)
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, holeRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0418';
      ctx.fill();

      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ff2bd6';
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.restore();
    } else {
      // Normal: 8 pie wedges (45° each) alternating #3a3f86 / #2a2f6a, rotating counter-clockwise at 1.5x paddle speed
      const wedgeAngle = (Math.PI * 2) / 8;
      for (let k = 0; k < 8; k++) {
        const startWedge = -this.a * 1.5 + k * wedgeAngle;
        const endWedge = startWedge + wedgeAngle;
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, holeRadius, startWedge, endWedge);
        ctx.closePath();
        ctx.fillStyle = k % 2 === 0 ? '#3a3f86' : '#2a2f6a';
        ctx.fill();
      }

      // Hole gold rim #e0a800, lineWidth 2.5
      ctx.beginPath();
      ctx.arc(CX, CY, holeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#e0a800';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 6. Paddles: 6 lines, round caps, lineWidth 0.048*R (8.4px), colour #7c6fd6, from radius 0.98R to 0.66R
    const paddleLineWidth = 0.048 * R;
    ctx.lineWidth = paddleLineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7c6fd6';

    for (let k = 0; k < NB; k++) {
      const theta = this.a + (k * Math.PI * 2) / NB;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const x1 = CX + cos * (0.66 * R);
      const y1 = CY + sin * (0.66 * R);
      const x2 = CX + cos * (0.98 * R);
      const y2 = CY + sin * (0.98 * R);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 7. Arena rim: cyan #22d3ee, lineWidth 3, radius R+1.5, shadowBlur 14 glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    // 8. Flags (alive): draw sprite centred at screen pos with size s = 2*rr*R*k
    const baseDiameter = 2 * rr * R; // ~27.3px
    const aliveFlags = this.flags.filter((f) => f.on === 1);

    for (const flag of aliveFlags) {
      const curD = Math.hypot(flag.x, flag.y);
      let k = 1;

      if (this.cap && this.cap.f === flag) {
        k = 1 - Math.min(1, this.cap.t / 1.2) * 0.7; // shrinks to 30%
      } else if (!flag.isWinner && flag.sh <= 0 && flag.h === 1) {
        k = Math.max(0.45, Math.min(1.0, curD / HR + 0.3));
      }

      const s = baseDiameter * k;
      const screenX = CX + flag.x * R;
      const screenY = CY + flag.y * R;

      ctx.drawImage(flag.sprite, screenX - s / 2, screenY - s / 2, s, s);

      // Shield power-up active: cyan ring #67e8f9, lineWidth 2.5, radius s/2+3, shadowBlur 8
      if (flag.sh > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenX, screenY, s / 2 + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#67e8f9';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();
      }

      // Predetermined Winner Highlight indicator
      if (flag.isWinner && showWinnerHighlight) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenX, screenY, s / 2 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = 6;
        ctx.stroke();

        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(screenX, screenY - s / 2 - 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Section 7.9: Under the arena
    // "ALL ELIMINATED" system-ui 13px white centred at (192,513)
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('ALL ELIMINATED', 192, 513);

    // Eliminated flag grid: 14x14 sprites, in elimination order,
    // position x = 7 + (j%19)*19, y = 545 + floor(j/19)*19 (19 per row).
    for (let j = 0; j < this.outs.length; j++) {
      const col = j % 19;
      const row = Math.floor(j / 19);
      const ex = 7 + col * 19;
      const ey = 545 + row * 19;
      ctx.drawImage(this.outs[j].sprite, ex, ey, 14, 14);
    }

    // Progress bar: track pill (12,610,360x4,radius 2) #ffffff22;
    // fill pill cyan #22d3ee, width max(4, 360*eliminated/N).
    drawRoundedRect(ctx, 12, 610, 360, 4, 2);
    ctx.fillStyle = '#ffffff22';
    ctx.fill();

    const progressW = Math.max(4, (360 * eliminatedCount) / N);
    drawRoundedRect(ctx, 12, 610, progressW, 4, 2);
    ctx.fillStyle = '#22d3ee';
    ctx.fill();

    // Text " / 40 ELIMINATED" 9px #9aa4c7 centred at (192,632)
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#9aa4c7';
    ctx.fillText(`${eliminatedCount} / ${N} ELIMINATED`, 192, 632);

    // Call-to-action pill (12,642,360x26, radius 6, #0d1430cc, stroke #ffffff22)
    // with text "LIKE IF YOU SEE YOUR COUNTRY FLAG" bold 10px system-ui white centred at (192,659)
    drawRoundedRect(ctx, 12, 642, 360, 26, 6);
    ctx.fillStyle = '#0d1430cc';
    ctx.fill();
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('LIKE IF YOU SEE YOUR COUNTRY FLAG', 192, 659);
    ctx.restore();

    // Section 7.11: Sound hint: if AudioContext is not running:
    // "Tap the screen once to start the sound" 9px #9aa4c7 centred at (192,690).
    if (!sound.isRunning && this.phase === 0) {
      ctx.save();
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = '#9aa4c7';
      ctx.textAlign = 'center';
      ctx.fillText('Tap the screen once to start the sound', 192, 690);
      ctx.restore();
    }

    // Section 7.10: Elimination toast (for 2.4s after each elimination)
    // pop-in scale 0.8->1 over the first 0.15s (scale anchored at (114,480)),
    // alpha = min(1,(2.4-t)*2) (fades in last 0.5s).
    // Pill (14,462,200x36, radius 6, fill #1a0d22ee, stroke #ff4d6d);
    // flag 24x24 at (22,468); "ELIMINATED" 7px #ff6b81 at (54,476); country name UPPERCASE Anton 14px white at (54,492).
    if (this.toast && this.toast.t < 2.4 && this.phase === 0) {
      ctx.save();
      const toastScale =
        this.toast.t < 0.15 ? 0.8 + 0.2 * (this.toast.t / 0.15) : 1.0;
      const toastAlpha = Math.max(0, Math.min(1, (2.4 - this.toast.t) * 2));

      ctx.globalAlpha = toastAlpha;
      ctx.translate(114, 480);
      ctx.scale(toastScale, toastScale);
      ctx.translate(-114, -480);

      drawRoundedRect(ctx, 14, 462, 200, 36, 6);
      ctx.fillStyle = '#1a0d22ee';
      ctx.fill();
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.drawImage(this.toast.sprite, 22, 468, 24, 24);

      ctx.textAlign = 'left';
      ctx.font = '7px system-ui, sans-serif';
      ctx.fillStyle = '#ff6b81';
      ctx.fillText('ELIMINATED', 54, 476);

      ctx.font = '14px "Anton", Impact, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.toast.country.name.toUpperCase(), 54, 492);

      ctx.restore();
    }

    // Section 7.12: Elimination flash: full-screen white overlay with alpha flash*0.5
    if (this.flash > 0 && this.phase === 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.flash * 0.5})`;
      ctx.fillRect(0, 0, SW, SH);
    }

    // Section 7.13: Winner screen (phase 1)
    // full overlay #070b1ad9; winner flag 180x180 at (102,210); country name Anton 42px gold centred at (192,450);
    // "WINS!" Anton 42px white at (192,495); "Next game starting soon" 13px white at (192,525); confetti as 8x4 rects, rotated, drawn on top.
    if (this.phase === 1 && this.winnerFlag) {
      ctx.save();
      // Full overlay #070b1ad9
      ctx.fillStyle = '#070b1ad9';
      ctx.fillRect(0, 0, SW, SH);

      // Winner flag 180x180 at (102,210)
      if (this.bigWinnerSprite) {
        ctx.drawImage(this.bigWinnerSprite, 102, 210, 180, 180);
      } else {
        ctx.drawImage(this.winnerFlag.sprite, 102, 210, 180, 180);
      }

      // Country name Anton 42px gold centred at (192,450)
      ctx.textAlign = 'center';
      ctx.font = '42px "Anton", Impact, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(this.winnerFlag.country.name.toUpperCase(), 192, 450);

      // "WINS!" Anton 42px white at (192,495)
      ctx.fillStyle = '#ffffff';
      ctx.fillText('WINS!', 192, 495);

      // "Next game starting soon" 13px white at (192,525)
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('Next game starting soon', 192, 525);

      // Confetti as 8x4 rects, rotated, drawn on top
      for (const p of this.confetti) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-4, -2, 8, 4);
        ctx.restore();
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
