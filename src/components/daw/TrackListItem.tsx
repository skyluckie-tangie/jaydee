// @ts-nocheck
import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useProjectStore } from '../../stores/useProjectStore';
import { TRACK_HEIGHT } from '../../lib/constants'; // single source of truth for track height

interface TrackListItemProps {
  track: Track;
  index: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onGainChange: (gain: number) => void;
  onPanChange: (pan: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleWrite?: () => void;  // W
  onRemove?: () => void;
  onOpenMixer?: () => void;
  onOpenPianoRoll?: (clipId?: string) => void;
  height?: number; // defaults to TRACK_HEIGHT
}

const colorMap: Record<string, string> = {
  midi: 'bg-lime-500',
  instrument: 'bg-lime-500',
  audio: 'bg-cyan-500',
  fx: 'bg-rose-600',
  group: 'bg-violet-600',
};

export function TrackListItem({
  track,
  index,
  isSelected,
  onSelect,
  onGainChange,
  onPanChange,
  onToggleMute,
  onToggleSolo,
  onToggleWrite,
  onRemove,
  onOpenMixer,
  onOpenPianoRoll,
  height = TRACK_HEIGHT,
}: TrackListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: track.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const colorClass = colorMap[track.type] || 'bg-gray-500';

  // Vertical fader (0 bottom to 1 top)
  const [isFaderDragging, setIsFaderDragging] = useState(false);
  const faderValue = track.gain; // 0-1

  // Quick engine actions for convenience
  const store = useProjectStore.getState();
  const quickDemoInserts = () => {
    if (track.type === 'audio') {
      store.addInsert(track.id, { type: 'eq3band', params: { lowGain: 3, midGain: -2, highGain: 1.5 } });
      store.addInsert(track.id, { type: 'drive', params: { amount: 2.5 } });
    } else if (track.type === 'instrument') {
      store.addInsert(track.id, { type: 'eq3band', params: { lowGain: 1, midGain: 2, highGain: -1 } });
      store.addInsert(track.id, { type: 'drive', params: { amount: 1.8 } });
      store.addInsert(track.id, { type: 'delay', params: { time: 0.2, feedback: 0.25, wet: 0.15 } });
    }

    onOpenMixer?.();
  };

  const handleFaderMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFaderDragging(true);

    const updateFader = (clientY: number, rect: DOMRect) => {
      const pct = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      onGainChange(Math.round(pct * 100) / 100);
    };

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    const onMove = (moveEvent: MouseEvent) => {
      updateFader(moveEvent.clientY, rect);
    };

    const onUp = () => {
      setIsFaderDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Pan knob (-1 to 1)
  const pan = track.pan;
  const panDeg = pan * 135; // -135 to +135

  const handlePanMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const centerX = (e.currentTarget as HTMLElement).getBoundingClientRect().left + 14;
    const centerY = (e.currentTarget as HTMLElement).getBoundingClientRect().top + 14;

    const updatePan = (clientX: number, clientY: number) => {
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let newDeg = angle + 90;
      if (newDeg > 180) newDeg -= 360;
      if (newDeg < -180) newDeg += 360;

      const clamped = Math.max(-135, Math.min(135, newDeg));
      const newPan = clamped / 135;
      onPanChange(Math.round(newPan * 100) / 100);
    };

    updatePan(e.clientX, e.clientY);

    const onMove = (moveEvent: MouseEvent) => updatePan(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ height, ...style }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          const s = useProjectStore.getState();
          if (data.type === 'plugin') {
            const t = data.pluginType;
            const defs: any = {
              eq3band: { lowGain: 0, midGain: 0, highGain: 0 },
              compressor: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 },
              gain: { gain: 1 },
              filter: { frequency: 1000, q: 1 },
              drive: { amount: 2.5 },
              delay: { time: 0.25, feedback: 0.3, wet: 0.2 }
            };
            s.addInsert(track.id, { type: t, params: defs[t] || {} });

          } else if (data.type === 'asset') {
            s.addClipFromAsset(track.id, data.id, 0);

          }
        } catch {}
      }}
      className={`group flex items-center w-full border-b border-[#27272a] bg-[#18181b] text-sm cursor-grab active:cursor-grabbing transition-colors ${isSelected ? 'ring-1 ring-white/60' : 'hover:bg-[#27272a]'}`}
    >
      {/* Left color bar */}
      <div className={`w-1.5 h-full ${colorClass} flex-shrink-0`} />

      {/* Track number + name */}
      <div className="flex-1 min-w-0 pl-2 pr-1 flex flex-col justify-center">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-zinc-500 tabular-nums">#{index + 1}</span>
          <span className="font-semibold text-white truncate text-[13px] tracking-[-0.2px]">
            {track.name}
          </span>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono leading-none mt-px">
          {track.type.toUpperCase()}
        </div>
      </div>

      {/* Buttons: M S R W + Arm */}
      <div className="flex items-center gap-px pr-2">
        {/* Mute */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          className={`w-5 h-5 text-[9px] font-bold rounded-full flex items-center justify-center transition-all active:scale-95
            ${track.muted ? 'bg-orange-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
          title="Mute (M)"
        >
          M
        </button>

        {/* Solo */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
          className={`w-5 h-5 text-[9px] font-bold rounded-full flex items-center justify-center transition-all active:scale-95
            ${track.soloed ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
          title="Solo (S)"
        >
          S
        </button>

        {/* Write (automation) */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleWrite?.(); }}
          className={`w-5 h-5 text-[9px] font-bold rounded-full flex items-center justify-center transition-all active:scale-95
            ${track.automationWrite ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
          title="Write Automation"
        >
          W
        </button>

        {/* Quick Demo Inserts for this track (engine power) */}
        <button
          onClick={(e) => { e.stopPropagation(); quickDemoInserts(); }}
          className="w-6 h-5 text-[8px] font-bold rounded bg-emerald-900/70 text-emerald-400 hover:bg-emerald-800 flex items-center justify-center transition-all active:scale-95"
          title="Load demo inserts chain on this track (test Mix/Signal)"
        >
          FX
        </button>

        {/* Sidechain ducking toggle (EDM ducking on beats) */}
        <button
          onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleSidechain(track.id); onOpenMixer?.(); }}
          className={`w-6 h-5 text-[8px] font-bold rounded flex items-center justify-center transition-all active:scale-95 ${track.sidechain?.enabled ? 'bg-purple-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-purple-900'}`}
          title="Toggle Sidechain Ducking (beat synced volume duck) — opens Mixer"
        >
          SC
        </button>

        {/* Piano Roll for MIDI/Instrument tracks */}
        {(track.type === 'instrument' || track.type === 'midi' || (track.midiClips && track.midiClips.length > 0)) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const store = useProjectStore.getState();
              if (!track.midiClips || track.midiClips.length === 0) {
                store.addMidiClip(track.id, 0, 4);
              }
              const clips = (store.project.tracks.find(t => t.id === track.id)?.midiClips) || [];
              if (clips.length > 0) {
                onOpenPianoRoll?.(clips[0].id);
              }
            }}
            className="w-6 h-5 text-[8px] font-bold rounded bg-blue-900/70 text-blue-400 hover:bg-blue-800 flex items-center justify-center transition-all active:scale-95"
            title="Open Piano Roll"
          >
            ♪
          </button>
        )}

        {/* Remove track */}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-5 h-5 text-[9px] font-bold rounded-full bg-zinc-800 text-red-400 hover:bg-red-600 hover:text-white flex items-center justify-center transition-all active:scale-95 ml-1"
            title="Remove Track"
          >
            ×
          </button>
        )}
      </div>

      {/* Pan Knob */}
      <div
        className="w-7 h-7 mr-1.5 flex-shrink-0 cursor-pointer"
        onMouseDown={handlePanMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative w-7 h-7">
          {/* Knob background */}
          <div className="absolute inset-0 rounded-full bg-[#27272a] border border-[#3f3f46]" />
          {/* Knob top highlight */}
          <div className="absolute inset-[1px] rounded-full bg-gradient-to-b from-white/10 to-transparent" />
          {/* Indicator line */}
          <div
            className="absolute left-1/2 top-1/2 w-[1.5px] h-2.5 bg-white origin-bottom"
            style={{ transform: `translate(-50%, -100%) rotate(${panDeg}deg)` }}
          />
          <div className="absolute left-1/2 top-1/2 w-1.5 h-1.5 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Vertical Slim Fader */}
      <div
        className="relative w-[9px] h-8 mr-2 flex-shrink-0 bg-[#27272a] rounded-sm border border-[#3f3f46] overflow-hidden cursor-pointer"
        onMouseDown={handleFaderMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Track */}
        <div className="absolute inset-0 bg-[#3f3f46]" />
        {/* Filled area from bottom */}
        <div
          className="absolute bottom-0 left-0 right-0 bg-white transition-all"
          style={{ height: `${faderValue * 100}%` }}
        />
        {/* Thumb */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-3 h-[3px] bg-white shadow rounded-full border border-black/30 ${isFaderDragging ? 'scale-125' : ''}`}
          style={{ bottom: `calc(${faderValue * 100}% - 1.5px)` }}
        />
      </div>
    </div>
  );
}
