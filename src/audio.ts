/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// BASS and LEAD MIDI note arrays from Section 8
const BASS = [45, 45, 48, 45, 43, 43, 47, 43];
const LEAD = [69, 72, 76, 72, 67, 71, 74, 71];

function mf(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private schedulerTimer: number | null = null;
  private step = 0;
  private nextStepTime = 0;
  private voice: SpeechSynthesisVoice | null = null;
  public isRunning = false;

  constructor() {
    this.updateVoice();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.updateVoice();
      };
    }
  }

  private updateVoice() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    const maleRegex =
      /(?<!fe)male|david|mark|ravi|prabhat|rishi|daniel|alex|george|guy|christopher|james|fred/i;

    // 1. prefer an en-IN voice whose name matches male-sounding
    const enInMale = voices.find(
      (v) => (v.lang === 'en-IN' || v.lang.startsWith('en_IN')) && maleRegex.test(v.name)
    );
    if (enInMale) {
      this.voice = enInMale;
      return;
    }

    // 2. else any English voice matching that
    const enMale = voices.find((v) => v.lang.startsWith('en') && maleRegex.test(v.name));
    if (enMale) {
      this.voice = enMale;
      return;
    }

    // 3. else any en-IN
    const anyEnIn = voices.find((v) => v.lang === 'en-IN' || v.lang.startsWith('en_IN'));
    if (anyEnIn) {
      this.voice = anyEnIn;
      return;
    }

    // 4. else any English
    const anyEn = voices.find((v) => v.lang.startsWith('en'));
    if (anyEn) {
      this.voice = anyEn;
      return;
    }

    this.voice = voices[0] || null;
  }

  public init() {
    if (this.ctx && this.ctx.state === 'running') {
      this.isRunning = true;
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
        // Master gain node = 0.5 -> destination
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.isRunning = true;
          this.startMusicScheduler();
        });
      } else if (this.ctx.state === 'running') {
        this.isRunning = true;
        this.startMusicScheduler();
      }
    } catch {
      // Audio autoplay restrictions or unsupported
    }
  }

  private startMusicScheduler() {
    if (this.schedulerTimer !== null || !this.ctx) return;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.step = 0;

    // Scheduler runs via setInterval every 100ms, scheduling notes up to 0.3s ahead
    this.schedulerTimer = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;

      // If tab was backgrounded, resync to current time to prevent catchup loop
      if (this.nextStepTime < this.ctx.currentTime - 0.5) {
        this.nextStepTime = this.ctx.currentTime;
      }

      while (this.nextStepTime < this.ctx.currentTime + 0.3) {
        this.scheduleStep(this.step, this.nextStepTime);
        this.step++;
        this.nextStepTime += 0.25; // one step every 0.25s
      }
    }, 100);
  }

  private scheduleStep(stp: number, t: number) {
    const k = stp % 16;

    // Bass: every step, tone(mf(BASS[(k>>1)%8]), t, 0.22, "sawtooth", 0.1)
    const bassNote = BASS[(k >> 1) % 8];
    this.tone(mf(bassNote), t, 0.22, 'sawtooth', 0.1);

    // Lead: on even k, tone(mf(LEAD[(stp>>1)%8]), t, 0.12, "square", 0.04)
    if (k % 2 === 0) {
      const leadNote = LEAD[(stp >> 1) % 8];
      this.tone(mf(leadNote), t, 0.12, 'square', 0.04);
    }

    // Kick: when k % 4 == 0, tone(120, t, 0.15, "sine", 0.5)
    if (k % 4 === 0) {
      this.tone(120, t, 0.15, 'sine', 0.5);
    }
  }

  /**
   * Helper tone(freq, startTime, duration, oscType, volume)
   * Oscillator at freq; gain starts at volume and exponentially ramps to 0.001 over duration;
   * stop at start + duration + 0.02.
   */
  public tone(
    freq: number,
    startTime: number,
    duration: number,
    oscType: OscillatorType,
    volume: number
  ) {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = oscType;
      osc.frequency.setValueAtTime(Math.max(10, freq), startTime);

      const safeVol = Math.max(0.0001, volume);
      gain.gain.setValueAtTime(safeVol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // already disconnected
        }
      };
    } catch {
      // Ignore timing errors if browser is throttling
    }
  }

  /**
   * Helper noise(start, dur, f0, f1, vol, filterType="bandpass")
   * White-noise buffer of dur seconds -> BiquadFilter whose frequency exponentially sweeps f0 -> f1 over dur;
   * gain: 0.001 at start, linear up to vol at 80% of dur, linear down to 0.001 at end.
   */
  public noise(
    start: number,
    dur: number,
    f0: number,
    f1: number,
    vol: number,
    filterType: BiquadFilterType = 'bandpass'
  ) {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;

    try {
      const sampleRate = this.ctx.sampleRate;
      const bufferSize = Math.max(1, Math.floor(sampleRate * dur));
      const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(Math.max(10, f0), start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(10, f1), start + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), start + dur * 0.8);
      gain.gain.linearRampToValueAtTime(0.001, start + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      src.start(start);
      src.stop(start + dur + 0.02);

      src.onended = () => {
        try {
          src.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {
          // already disconnected
        }
      };
    } catch {
      // Ignore audio glitch if tab is inactive
    }
  }

  // Sound Effect 1: whoosh (capture starts)
  // noise(now, 1.2, 300, 3500, 0.5) bandpass, rising sweep
  public playWhoosh() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.noise(this.ctx.currentTime, 1.2, 300, 3500, 0.5, 'bandpass');
  }

  // Sound Effect 2: hit (elimination complete)
  // noise(now, 0.15, 4000, 800, 0.6, "highpass") + tone(90, now, 0.3, "sine", 0.9)
  public playHit() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.noise(now, 0.15, 4000, 800, 0.6, 'highpass');
    this.tone(90, now, 0.3, 'sine', 0.9);
  }

  // Sound Effect 3: chime (shield given)
  // tone(880, now, 0.5, "triangle", 0.3) + tone(1320, now+0.12, 0.6, "triangle", 0.3)
  public playChime() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.tone(880, now, 0.5, 'triangle', 0.3);
    this.tone(1320, now + 0.12, 0.6, 'triangle', 0.3);
  }

  // Sound Effect 4: win (fanfare)
  // square-wave notes [523, 659, 784, 1047, 784, 1047, 1319] Hz, one every 0.15s,
  // each tone(f, now+i*0.15, 0.4, "square", 0.15)
  public playWinFanfare() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => {
      this.tone(f, now + i * 0.15, 0.4, 'square', 0.15);
    });
  }

  // Voice announcements via speechSynthesis
  public speak(text: string) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    try {
      // Call speechSynthesis.cancel() before each utterance
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      if (this.voice) {
        utterance.voice = this.voice;
      }
      utterance.pitch = 0.5; // deep
      utterance.rate = 0.88; // slow
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synth error if browser speech disabled
    }
  }
}

export const sound = new AudioEngine();
