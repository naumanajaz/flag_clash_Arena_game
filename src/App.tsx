/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { sound } from './audio';
import { COUNTRIES, CountryData, createFlagBadge } from './flags';
import { GameEngine, SW, SH } from './gameEngine';

export default function App() {
  const [activeTab, setActiveTab] = useState<'arena' | 'flags'>('arena');
  const [searchQuery, setSearchQuery] = useState('');
  const [patternFilter, setPatternFilter] = useState<string>('all');
  const [allowEliminations, setAllowEliminations] = useState(true);
  const [showWinnerTag, setShowWinnerTag] = useState(false);
  const [aliveCount, setAliveCount] = useState(40);
  const [winnerName, setWinnerName] = useState('');
  const [roundNumber, setRoundNumber] = useState(1);
  const [isAudioRunning, setIsAudioRunning] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  // Initialize engine once
  if (!engineRef.current) {
    engineRef.current = new GameEngine();
  }

  const engine = engineRef.current;

  // Audio unlock on user interaction
  useEffect(() => {
    const unlockAudio = () => {
      sound.init();
      if (sound.isRunning) {
        setIsAudioRunning(true);
      }
    };

    // Attempt on mount
    unlockAudio();

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    const checkInterval = setInterval(() => {
      if (sound.isRunning !== isAudioRunning) {
        setIsAudioRunning(sound.isRunning);
      }
    }, 500);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      clearInterval(checkInterval);
    };
  }, [isAudioRunning]);

  // Sync state with engine
  useEffect(() => {
    if (!engine) return;
    engine.allowEliminations = allowEliminations;
  }, [allowEliminations, engine]);

  // Handle new round restart
  const handleRestartRound = () => {
    if (!engine) return;
    engine.startRound();
    setRoundNumber(engine.round);
    setWinnerName(engine.winnerFlag?.country.name || '');
    setAliveCount(engine.flags.filter((f) => f.on === 1).length);
  };

  // Arena Game Loop
  useEffect(() => {
    if (activeTab !== 'arena') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (engine.winnerFlag) {
      setWinnerName(engine.winnerFlag.country.name);
      setRoundNumber(engine.round);
    }

    let animId: number;
    let lastTime = performance.now();
    let statsThrottle = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const pixelW = Math.round(W * dpr);
      const pixelH = Math.round(H * dpr);

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
    };

    window.addEventListener('resize', resize);
    resize();

    const frame = (now: number) => {
      const frameDelta = (now - lastTime) / 1000;
      lastTime = now;

      // dt = min(frameDelta, 0.04) seconds
      const dt = Math.min(frameDelta, 0.04);

      // Run physics step(dt/2) TWICE (2 sub-steps)
      engine.physicsSubStep(dt / 2);
      engine.physicsSubStep(dt / 2);

      // Update UI counts throttled to 5 times/second
      statsThrottle += dt;
      if (statsThrottle > 0.2) {
        statsThrottle = 0;
        const currentAlive = engine.flags.filter((f) => f.on === 1).length;
        setAliveCount(currentAlive);
        if (engine.round !== roundNumber) {
          setRoundNumber(engine.round);
        }
      }

      // DPR and sizing
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const pixelW = Math.round(W * dpr);
      const pixelH = Math.round(H * dpr);

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      const sc = Math.min(W / SW, H / SH);
      const ox = (W - SW * sc) / 2;
      const oy = (H - SH * sc) / 2;

      engine.render(ctx, canvas, sc, ox, oy, dpr, showWinnerTag);

      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [activeTab, engine, roundNumber, showWinnerTag]);

  const filteredCountries = COUNTRIES.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPattern = patternFilter === 'all' || c.pattern === patternFilter;
    return matchesSearch && matchesPattern;
  });

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex flex-col select-none text-white font-sans">
      {/* Top Navigation & Test Bar */}
      <header className="z-20 shrink-0 bg-[#070b1a]/95 border-b border-cyan-500/20 backdrop-blur px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-['Anton'] text-lg sm:text-xl tracking-wider text-white">
            FLAG CLASH <span className="text-[#ffd23f]">ARENA</span>
          </span>
          <span className="text-[11px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 px-2 py-0.5 rounded font-mono">
            ROUND {roundNumber} • {aliveCount}/40 REMAINING
          </span>
        </div>

        {/* Action Controls & Tab Switcher */}
        <div className="flex items-center gap-2">
          {/* Audio Status Pill */}
          <button
            type="button"
            onClick={() => {
              sound.init();
              setIsAudioRunning(sound.isRunning);
            }}
            className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 border transition-colors ${
              isAudioRunning
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                : 'bg-amber-950/70 text-amber-300 border-amber-500/40 animate-pulse'
            }`}
            title="Click to enable sound"
          >
            {isAudioRunning ? '🔊 Sound: ON' : '🔈 Tap for Sound'}
          </button>

          {activeTab === 'arena' && (
            <>
              <button
                type="button"
                onClick={handleRestartRound}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-white/10 hover:bg-white/20 text-cyan-300 border border-cyan-500/30 transition-colors"
                title="Start a new round with the next country from the fair winner pool"
              >
                ↻ New Round
              </button>
              <button
                type="button"
                onClick={() => {
                  sound.init();
                  engine.triggerWin();
                }}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-950/60 hover:bg-amber-900/60 text-[#ffd23f] border border-[#ffd23f]/40 transition-colors"
                title="Test winner fanfare, screen, confetti and 8s auto-restart"
              >
                🏆 Test Win
              </button>
            </>
          )}

          <div className="flex items-center bg-black/60 p-0.5 rounded border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('arena')}
              className={`px-3 py-1 font-semibold rounded transition-all ${
                activeTab === 'arena'
                  ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/30 font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Game Arena
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('flags')}
              className={`px-3 py-1 font-semibold rounded transition-all ${
                activeTab === 'flags'
                  ? 'bg-[#ffd23f] text-black shadow-md shadow-[#ffd23f]/30 font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              55 Flags Grid
            </button>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      {activeTab === 'arena' ? (
        <div className="flex-1 relative flex flex-col items-center justify-center bg-black overflow-hidden">
          {/* Full Screen Logical Canvas with Exact 384x700 Rendering & Letterboxing */}
          <canvas
            ref={canvasRef}
            className="block w-full h-full"
            style={{ touchAction: 'none' }}
          />
        </div>
      ) : (
        /* 55 Flags Grid View */
        <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col max-w-7xl mx-auto w-full">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 bg-[#0d1430]/70 p-3 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search country (e.g. India, USA, Japan)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full max-w-sm px-3 py-1.5 text-xs bg-black/50 border border-white/20 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gray-400 mr-1 text-[11px]">Pattern:</span>
              {[
                { id: 'all', label: 'All (55)' },
                { id: 'h', label: 'h: Horiz (25)' },
                { id: 'v', label: 'v: Vert (15)' },
                { id: 'c', label: 'c: Nordic (5)' },
                { id: 'd', label: 'd: Disc (3)' },
                { id: 's', label: 's: Swiss (1)' },
                { id: 'u', label: 'u: USA (1)' },
                { id: 'b', label: 'b: Brazil (1)' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPatternFilter(p.id)}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                    patternFilter === p.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50'
                      : 'bg-black/40 text-gray-400 border border-white/5 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pb-8">
            {filteredCountries.map((country) => (
              <FlagCard key={country.id} country={country} />
            ))}
          </div>

          {filteredCountries.length === 0 && (
            <div className="py-20 text-center text-gray-400 text-sm">
              No country found matching &quot;{searchQuery}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FlagCard({ country }: { country: CountryData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = 64;
    const badge = createFlagBadge(country, size);

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(badge, 0, 0);
    }
  }, [country]);

  const patternDescriptions: Record<CountryData['pattern'], string> = {
    h: 'Horizontal stripes',
    v: 'Vertical stripes',
    d: 'Centre disc',
    c: 'Nordic cross',
    s: 'Swiss cross',
    u: 'USA stars/stripes',
    b: 'Brazil diamond/disc',
  };

  return (
    <div className="bg-[#0c1330]/90 border border-white/10 hover:border-cyan-400/50 transition-all rounded-xl p-3 flex flex-col items-center text-center shadow-lg hover:shadow-cyan-500/10 group">
      <div className="relative mb-2.5 p-1">
        <canvas
          ref={canvasRef}
          width={64}
          height={64}
          className="w-14 h-14 drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)] group-hover:scale-105 transition-transform"
        />
        {country.emblemColor && (
          <div
            className="absolute top-0 right-0 w-3 h-3 rounded-full border border-white/40 shadow"
            style={{ backgroundColor: country.emblemColor }}
            title={`Emblem Color: ${country.emblemColor}`}
          />
        )}
      </div>

      <h3 className="font-['Anton'] text-base tracking-wide text-white group-hover:text-cyan-300 transition-colors truncate w-full">
        {country.name}
      </h3>

      <div className="mt-1 flex flex-col items-center gap-1 w-full">
        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-700/40 px-1.5 py-0.5 rounded">
          {country.pattern}: {patternDescriptions[country.pattern]}
        </span>

        <div className="flex items-center gap-1 mt-1">
          {country.stripes.map((s, idx) => (
            <span
              key={idx}
              className="inline-block w-2.5 h-2.5 rounded-full border border-white/30"
              style={{ backgroundColor: s.color }}
              title={`Color: ${s.color}${s.weight > 1 ? ` (weight ${s.weight})` : ''}`}
            />
          ))}
          {country.emblemColor && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border-2 border-amber-300"
              style={{ backgroundColor: country.emblemColor }}
              title={`Emblem: ${country.emblemColor}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
