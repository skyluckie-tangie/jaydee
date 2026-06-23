// @ts-nocheck
// Reusable MixerChannel - well-made but was somewhat orphaned.
// Now exposed via Mixer for convenience. High quality vertical strip.
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Track } from '../../lib/types';

interface MixerChannelProps {
  track: Track;
  index: number;
  onGainChange: (gain: number) => void;
  onPanChange: (pan: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  meterPeak?: number; // 0-1
  meterRMS?: number;  // 0-1
}

export function MixerChannel({
  track,
  index,
  onGainChange,
  onPanChange,
  onToggleMute,
  onToggleSolo,
  meterPeak = 0,
  meterRMS = 0,
}: MixerChannelProps) {
  const [isDraggingFader, setIsDraggingFader] = useState(false);

  const db = Math.round(20 * Math.log10(Math.max(0.0001, track.gain)));

  // Vertical fader
  const handleFaderDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingFader(true);
    const rect = e.currentTarget.getBoundingClientRect();

    const update = (y: number) => {
      const pct = Math.max(0, Math.min(1, 1 - (y - rect.top) / rect.height));
      onGainChange(Math.round(pct * 100) / 100);
    };

    update(e.clientY);

    const onMove = (ev: MouseEvent) => update(ev.clientY);
    const onUp = () => {
      setIsDraggingFader(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Pan knob
  const panDeg = track.pan * 135;
  const handlePanDown = (e: React.MouseEvent) => {
    const knobRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = knobRect.left + knobRect.width / 2;
    const cy = knobRect.top + knobRect.height / 2;

    const updatePan = (clientX: number, clientY: number) => {
      const angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
      let deg = angle + 90;
      if (deg > 180) deg -= 360;
      const clamped = Math.max(-135, Math.min(135, deg));
      onPanChange(clamped / 135);
    };

    updatePan(e.clientX, e.clientY);

    const onMove = (me: MouseEvent) => updatePan(me.clientX, me.clientY);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <motion.div 
      whileHover={{ scale: 1.01 }} 
      className="w-[52px] h-full flex flex-col bg-[#18181b] border border-[#27272a] text-[10px] select-none overflow-hidden rounded"
    >
      {/* Track header */}
      <div className="h-[26px] bg-[#111113] border-b border-[#27272a] flex items-center justify-center px-1">
        <div className="text-center leading-none">
          <div className="text-[9px] font-mono text-zinc-500">#{index + 1}</div>
          <div className="text-[10px] font-semibold text-white truncate max-w-[44px]">{track.name}</div>
        </div>
      </div>

      {/* Inserts (4 small pills) */}
      <div className="px-1.5 py-1 space-y-0.5 border-b border-[#27272a]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[13px] rounded-full bg-[#27272a] border border-[#3f3f46] text-[8px] flex items-center px-1.5 text-zinc-400 hover:bg-[#3f3f46] cursor-pointer"
          >
            {i < (track.inserts?.length || 0) ? track.inserts?.[i]?.type?.slice(0, 6) : '—'}
          </div>
        ))}
      </div>

      {/* Pan Knob */}
      <div className="flex justify-center pt-1 pb-0.5">
        <div
          onMouseDown={handlePanDown}
          className="relative w-7 h-7 cursor-pointer"
        >
          <div className="absolute inset-0 rounded-full bg-[#27272a] border border-[#3f3f46]" />
          <div className="absolute inset-[2px] rounded-full bg-gradient-to-br from-white/5 to-transparent" />
          <motion.div
            className="absolute left-1/2 top-1/2 h-[9px] w-[1.5px] bg-white origin-bottom shadow"
            style={{ transform: `translate(-50%, -100%) rotate(${panDeg}deg)` }}
            animate={{ rotate: panDeg }}
            transition={{ type: 'spring', stiffness: 180, damping: 18 }}
          />
          <div className="absolute left-1/2 top-1/2 w-[3px] h-[3px] -translate-x-1/2 -translate-y-1/2 bg-white rounded-full" />
        </div>
      </div>

      {/* Main Fader Area */}
      <div className="flex-1 flex flex-col items-center px-1 pt-1 relative">
        {/* dB label */}
        <div className="text-[10px] font-mono tabular-nums text-white mb-0.5">
          {db > 0 ? `+${db}` : db}
        </div>

        {/* Fader */}
        <div
          className="relative w-4 flex-1 bg-[#27272a] rounded-sm border border-[#3f3f46] cursor-pointer"
          onMouseDown={handleFaderDown}
        >
          {/* Background scale marks */}
          <div className="absolute inset-x-0 top-0 bottom-0 flex flex-col justify-between py-1 px-px pointer-events-none">
            {[12, 6, 0, -6, -12, -24].map((dbVal, idx) => (
              <div key={idx} className="h-px w-full bg-white/10" />
            ))}
          </div>

          {/* Filled from bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-sm"
            style={{ height: `${track.gain * 100}%` }}
          />

          {/* Fader thumb */}
          <motion.div
            className="absolute left-1/2 -translate-x-1/2 w-5 h-[5px] bg-zinc-200 shadow border border-black/70 rounded-sm"
            style={{ bottom: `calc(${track.gain * 100}% - 2.5px)` }}
            animate={{ 
              scaleX: isDraggingFader ? 1.35 : 1, 
              scaleY: isDraggingFader ? 0.9 : 1 
            }}
            transition={{ type: 'spring', stiffness: 300 }}
          />
        </div>

        {/* Meter - Dual */}
        <div className="mt-1 w-[22px] h-20 relative border border-[#3f3f46] bg-black/40 rounded overflow-hidden flex">
          {/* Peak (left) */}
          <div className="flex-1 relative">
            <div 
              className="absolute bottom-0 left-0 right-0 bg-emerald-400 transition-all"
              style={{ height: `${Math.min(1, meterPeak * 1.1) * 100}%` }}
            />
            {/* Clip indicator */}
            {meterPeak > 0.98 && (
              <div className="absolute top-0 inset-x-0 h-1 bg-red-500" />
            )}
          </div>

          {/* RMS (right) */}
          <div className="flex-1 relative border-l border-white/10">
            <div 
              className="absolute bottom-0 left-0 right-0 bg-emerald-300/70 transition-all"
              style={{ height: `${meterRMS * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Controls — crazy spring buttons */}
      <div className="flex justify-between px-1 py-1 border-t border-[#27272a]">
        <motion.button
          whileTap={{ scale: 0.8, rotate: track.muted ? 0 : -8 }}
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          className={`flex-1 text-[9px] font-bold py-[1px] rounded-sm transition-colors ${track.muted ? 'bg-orange-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
        >
          M
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.75, rotate: track.soloed ? 0 : 8 }}
          onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
          className={`flex-1 text-[9px] font-bold py-[1px] ml-px rounded-sm transition-colors ${track.soloed ? 'bg-yellow-400 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
        >
          S
        </motion.button>
      </div>
    </motion.div>
  );
}
