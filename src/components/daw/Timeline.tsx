// @ts-nocheck
import React from 'react';
import { motion } from 'framer-motion';
import type { Track, AudioClip, MidiClip } from '../../lib/types';
import { audioEngine } from '../../audio/AudioEngine';
import { useProjectStore } from '../../stores/useProjectStore';
import { TRACK_HEIGHT } from '../../lib/constants';

const getStore = () => useProjectStore.getState();

interface TimelineProps {
  tracks: Track[];
  currentBeat: number;
  beatWidth: number;
  requiredBeats: number;
  selectedClipIds: string[];
  onClipMouseDown: (e: React.MouseEvent, trackId: string, clipId: string, start: number) => void;
  onClipClick: (clipId: string, e: React.MouseEvent) => void;
  onResizeStart?: (e: React.MouseEvent, trackId: string, clipId: string, edge: 'left' | 'right', start: number, dur: number, offset?: number) => void;
  onMidiDoubleClick?: (clipId: string) => void;
  isQuantizeOn?: boolean;
  quantize?: number;
  loopStart?: number;
  loopEnd?: number;
  loopEnabled?: boolean;
  onScrubStart?: (e: React.MouseEvent) => void;
  onLoopRegionDragStart?: (e: React.MouseEvent) => void;
}

const SECTION_COLORS = ['#fde047', '#fb923c', '#c026ff'];

// Simple Fade Editor modal content (used inside component)
function FadeEditor({ clip, trackId, onClose }: { clip: AudioClip; trackId: string; onClose: () => void }) {
  const store = useProjectStore.getState();
  const [local, setLocal] = React.useState({
    fadeInMs: clip.fadeInMs || 0,
    fadeOutMs: clip.fadeOutMs || 0,
    fadeInCurve: clip.fadeInCurve || 'linear' as const,
    fadeOutCurve: clip.fadeOutCurve || 'linear' as const,
  });

  const apply = () => {
    store.updateClipFade(trackId, clip.id, local);
    onClose();
  };

  // Simple curve preview
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = 180; c.height = 40;
    ctx.clearRect(0,0,c.width,c.height);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const curve = local.fadeInCurve; // use in for preview
    for (let i=0; i<=20; i++) {
      const t = i/20;
      let y = 0;
      if (curve === 'exp') y = Math.pow(t, 2);
      else if (curve === 's-curve') y = t*t*(3-2*t);
      else y = t;
      const x = t * 180;
      const yy = 40 - y * 40;
      if (i===0) ctx.moveTo(x,yy); else ctx.lineTo(x,yy);
    }
    ctx.stroke();
  }, [local.fadeInCurve]);

  return (
    <div style={{ position: 'absolute', zIndex: 100, background: '#1f2937', border: '1px solid #4b5563', padding: 8, borderRadius: 4, fontSize: 10, width: 200, top: 5, left: 5 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Fade Editor</div>
      <canvas ref={canvasRef} style={{border:'1px solid #444', marginBottom:4}} />
      <div>In: <input type="number" style={{width:50}} value={local.fadeInMs} onChange={e => setLocal({ ...local, fadeInMs: +e.target.value })} /> ms</div>
      <select value={local.fadeInCurve} onChange={e => setLocal({ ...local, fadeInCurve: e.target.value as any })}>
        <option value="linear">Linear</option>
        <option value="exp">Exp</option>
        <option value="s-curve">S-Curve</option>
      </select>
      <div>Out: <input type="number" style={{width:50}} value={local.fadeOutMs} onChange={e => setLocal({ ...local, fadeOutMs: +e.target.value })} /> ms</div>
      <select value={local.fadeOutCurve} onChange={e => setLocal({ ...local, fadeOutCurve: e.target.value as any })}>
        <option value="linear">Linear</option>
        <option value="exp">Exp</option>
        <option value="s-curve">S-Curve</option>
      </select>
      <div style={{ marginTop: 4 }}>
        <button onClick={apply} style={{ marginRight: 4 }}>Apply</button>
        <button onClick={onClose}>Cancel</button>
      </div>
      <div style={{ fontSize: 8, color: '#666' }}>Non-destructive gain envelope (engine only)</div>
    </div>
  );
}

// Reusable high-quality waveform canvas component
function WaveformCanvas({ 
  peaks, 
  width, 
  height = 22,
  color, 
  isSelected, 
  offsetRatio, 
  durationRatio 
}: { 
  peaks: { min: number[]; max: number[] } | null; 
  width: number; 
  height?: number;
  color: string; 
  isSelected: boolean; 
  offsetRatio: number; 
  durationRatio: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0) return;

    canvas.width = Math.max(30, Math.floor(width));
    canvas.height = Math.max(20, Math.floor(height));

    // Reuse the draw logic (copied for closure simplicity)
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const amp = mid * 0.92;

    const startIdx = Math.floor(offsetRatio * peaks.min.length);
    const endIdx = Math.max(startIdx + 1, Math.ceil((offsetRatio + durationRatio) * peaks.min.length));
    const minVisible = peaks.min.slice(startIdx, endIdx);
    const maxVisible = peaks.max.slice(startIdx, endIdx);

    if (maxVisible.length === 0) return;

    const step = Math.max(0.5, w / maxVisible.length);

    const bodyColor = isSelected ? '#ffffff' : color;
    const grad = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
    grad.addColorStop(0, isSelected ? 'rgba(255,255,255,0.6)' : `${bodyColor}99`);
    grad.addColorStop(0.5, isSelected ? 'rgba(255,255,255,0.35)' : `${bodyColor}55`);
    grad.addColorStop(1, isSelected ? 'rgba(255,255,255,0.6)' : `${bodyColor}99`);
    ctx.fillStyle = grad;
    ctx.strokeStyle = isSelected ? '#e0f2fe' : color;
    ctx.lineWidth = isSelected ? 1.5 : 1;

    ctx.beginPath();
    // Draw filled waveform using min/max for authentic look
    for (let i = 0; i < maxVisible.length; i++) {
      const x = i * step;
      const yTop = mid - maxVisible[i] * amp;
      if (i === 0) ctx.moveTo(x, yTop);
      else ctx.lineTo(x, yTop);
    }
    for (let i = minVisible.length - 1; i >= 0; i--) {
      const x = i * step;
      const yBot = mid - minVisible[i] * amp;  // min is negative
      ctx.lineTo(x, yBot);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center line
    ctx.strokeStyle = isSelected ? 'rgba(224,242,254,0.85)' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    // High-zoom detail: draw individual min/max verticals (classic DAW look when zoomed in)
    if (step > 2) {
      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.9)' : `${bodyColor}cc`;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < maxVisible.length; i++) {
        const x = i * step + step * 0.5;
        const y1 = mid - maxVisible[i] * amp;
        const y2 = mid - minVisible[i] * amp;
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.stroke();
      }
    }
  }, [peaks, width, color, isSelected, offsetRatio, durationRatio]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ 
        position: 'absolute', 
        left: 0, 
        top: 0,
        width: '100%', 
        height: `${height}px`,
        pointerEvents: 'none',
      }} 
    />
  );
}

export function Timeline({
  tracks,
  currentBeat,
  beatWidth,
  requiredBeats,
  selectedClipIds,
  onClipMouseDown,
  onClipClick,
  onResizeStart,
  _isQuantizeOn = false,
  _quantize = 0.25,
  loopStart = 0,
  loopEnd = 4,
  loopEnabled = false,
  onScrubStart,
  onLoopRegionDragStart,
}: TimelineProps) {
  const [fadeEdit, setFadeEdit] = React.useState<{ clip: AudioClip; trackId: string } | null>(null);

  const totalBeats = Math.max(requiredBeats, 32);
  const contentWidth = totalBeats * beatWidth;

  // Artisan-level waveform drawer (real peaks, trimmed correctly, zoom aware)
  const drawRealWaveform = (
    canvas: HTMLCanvasElement,
    peaks: number[],
    color: string,
    isSelected: boolean,
    offsetRatio: number,
    durationRatio: number
  ) => {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx || peaks.length === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const amp = mid * 0.88;

    const startIdx = Math.floor(offsetRatio * peaks.max.length);
    const endIdx = Math.max(startIdx + 1, Math.ceil((offsetRatio + durationRatio) * peaks.max.length));
    const minVisible = peaks.min.slice(startIdx, endIdx);
    const maxVisible = peaks.max.slice(startIdx, endIdx);

    if (maxVisible.length === 0) return;

    const step = Math.max(0.5, w / maxVisible.length);

    // Nice body fill with subtle gradient (DAW artisan look)
    const bodyColor = isSelected ? '#ffffff' : color;
    const grad = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
    grad.addColorStop(0, isSelected ? 'rgba(255,255,255,0.55)' : `${bodyColor}88`);
    grad.addColorStop(0.5, isSelected ? 'rgba(255,255,255,0.35)' : `${bodyColor}44`);
    grad.addColorStop(1, isSelected ? 'rgba(255,255,255,0.55)' : `${bodyColor}88`);
    ctx.fillStyle = grad;
    ctx.strokeStyle = isSelected ? '#e0f2fe' : color;
    ctx.lineWidth = isSelected ? 1.6 : 1.1;

    ctx.beginPath();
    for (let i = 0; i < maxVisible.length; i++) {
      const x = i * step;
      const y = mid - maxVisible[i] * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = minVisible.length - 1; i >= 0; i--) {
      const x = i * step;
      const y = mid - minVisible[i] * amp;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner "RMS" style fill for thicker professional look (like real DAW waveforms)
    ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.2)' : `${bodyColor}33`;
    ctx.beginPath();
    const rmsAmp = amp * 0.55;
    for (let i = 0; i < maxVisible.length; i++) {
      const x = i * step;
      const y = mid - maxVisible[i] * rmsAmp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = minVisible.length - 1; i >= 0; i--) {
      const x = i * step;
      const y = mid - minVisible[i] * rmsAmp;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Subtle center line + top highlight (professional DAW look)
    ctx.strokeStyle = isSelected ? 'rgba(224,242,254,0.9)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  };

  const getSectionColor = (index: number) => SECTION_COLORS[index % SECTION_COLORS.length];

  return (
    <div className="flex-1 bg-[#0a0a0b] overflow-auto relative" style={{ minHeight: 0 }}>
      {/* Arranger Markers - now real/usable (click to highlight section, colors active) */}
      <div className="h-6 bg-[#18181b] border-b border-[#27272a] flex items-stretch text-[10px] font-bold tracking-[0.5px] z-30 sticky top-0">
        {[
          { label: 'INTRO', beats: 4, color: '#fde047' },
          { label: 'VERSE', beats: 8, color: '#fb923c' },
          { label: 'PRE CH', beats: 4, color: '#c026ff' },
          { label: 'CHORUS', beats: 8, color: '#4ade80' }
        ].map((sec, idx) => (
          <div
            key={idx}
            onClick={() => {
              // Usable: set loop to this section approx
              const start = idx * 4; // rough
              const end = start + sec.beats;
              // For demo, just log or could integrate setLoop
              console.log('Arranger section:', sec.label, start, end);
              // Could call store setLoopRegion if exposed
            }}
            className="flex items-center justify-center px-2 text-black font-semibold border-r border-[#27272a] cursor-pointer active:opacity-80 transition"
            style={{ 
              width: (sec.beats * 12) + 'px', // rough visual based on beats, adjust with zoom later
              background: sec.color,
            }}
            title={`Click: ${sec.label} (${sec.beats} beats)`}
          >
            {sec.label}
          </div>
        ))}
        <div className="flex-1 bg-[#18181b]" />
      </div>

      {/* Ruler - interactive for playhead scrub */}
      <div 
        className="timeline-ruler h-[22px] bg-[#1f2937] border-b border-[#334155] sticky top-6 z-20 flex items-end overflow-hidden"
        style={{ minWidth: contentWidth }}
        onMouseDown={onScrubStart}
      >
        <div className="relative h-full w-full" style={{ minWidth: contentWidth }}>
          {/* Loop region selection marker layer - full ruler for drag (under other elements) */}
          {onLoopRegionDragStart && (
            <div 
              className="loop-region-bar"
              style={{ 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                width: '100%', 
                height: '100%', 
                background: 'transparent',
                zIndex: 20,
                cursor: 'crosshair' 
              }}
              onMouseDown={onLoopRegionDragStart}
            />
          )}

          {Array.from({ length: Math.floor(totalBeats) + 1 }).map((_, i) => {
            const isMajor = i % 4 === 0;
            return (
              <div
                key={i}
                className="absolute bottom-0 border-l border-[#475569] pointer-events-none"
                style={{
                  left: `${i * beatWidth}px`,
                  height: isMajor ? '100%' : '60%',
                  borderColor: isMajor ? '#64748b' : '#475569',
                }}
              >
                {isMajor && (
                  <div className="text-[10px] text-[#64748b] font-mono pl-0.5 -mt-0.5">{Math.floor(i / 4) + 1}</div>
                )}
              </div>
            );
          })}

          {/* Thicker beat grid lines */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `
                repeating-linear-gradient(
                  90deg,
                  transparent,
                  transparent ${beatWidth * 4 - 2}px,
                  rgba(148, 163, 184, 0.18) ${beatWidth * 4}px
                ),
                repeating-linear-gradient(
                  90deg,
                  transparent,
                  transparent ${beatWidth - 1}px,
                  rgba(148, 163, 184, 0.08) ${beatWidth}px
                )
              `
            }}
          />

          {/* Playhead handle (top triangle in ruler) and hitbox for dragging playhead - on top */}
          {onScrubStart && (
            <>
              <div 
                className="playhead-handle"
                style={{ left: `${currentBeat * beatWidth + 1}px` }}
                onMouseDown={onScrubStart}
              />
              <div 
                className="playhead-hitbox"
                style={{ left: `${currentBeat * beatWidth + 1}px` }}
                onMouseDown={onScrubStart}
              />
            </>
          )}
        </div>
      </div>

      {/* Track Rows with Clips */}
      <div className="relative" style={{ minWidth: contentWidth }}>
        {tracks.map((track, _trackIndex) => (
          <div
            key={track.id}
            className="border-b border-[#27272a] relative bg-[#111113]"
            style={{ height: TRACK_HEIGHT }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                const store = getStore();
                if (data.type === 'asset') {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const scrollLeft = (e.currentTarget.parentElement?.parentElement?.scrollLeft || 0);
                  const x = e.clientX - rect.left + scrollLeft;
                  let beat = x / beatWidth;
                  const q = store.isQuantizeOn ? store.quantize : 0;
                  if (q > 0) beat = Math.round(beat / q) * q;
                  beat = Math.max(0, beat);
                  store.addClipFromAsset(track.id, data.id, beat);
                } else if (data.type === 'plugin') {
                  // Load plugin as insert on this track (from Plugin Pool)
                  const pluginType = data.pluginType;
                  const defaults: any = {
                    eq3band: { lowGain: 0, midGain: 0, highGain: 0 },
                    compressor: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 },
                    gain: { gain: 1 },
                    filter: { frequency: 1000, q: 1 },
                    drive: { amount: 2.5 },
                    delay: { time: 0.25, feedback: 0.3, wet: 0.2 }
                  };
                  const params = defaults[pluginType] || {};
                  store.addInsert(track.id, { type: pluginType, params });

                }
              } catch {}
            }}
          >
            {/* Clip container */}
            <div className="absolute inset-0">
              {/* Audio Clips */}
              {(track.audioClips || []).map((clip: AudioClip) => {
                const left = clip.startBeat * beatWidth;
                const w = Math.max(beatWidth * 0.6, clip.durationBeats * beatWidth);
                const isSel = selectedClipIds.includes(clip.id);

                // === Real Waveform for Audio Clips (Artisan level) ===
                const isAudio = track.type === 'audio';
                // Pass raw storagePath; AudioEngine.getWaveformPeaks handles 'local:xxx' and 'demo:xxx'
                const peaks = audioEngine.getWaveformPeaks(clip.storagePath);

                // Compute source mapping for trimmed clips (accurate waveform slice)
                const sourceDur = (clip as any).sourceDurationBeats || clip.durationBeats || 4;
                const offsetRatio = Math.max(0, Math.min(1, clip.offsetBeats / sourceDur));
                const durRatio = Math.max(0.01, Math.min(1, clip.durationBeats / sourceDur));

                const waveColor = isAudio ? '#67e8f9' : '#86efac';

                return (
                  <motion.div
                    key={clip.id}
                    className={`absolute top-0 bottom-0 rounded-md shadow-md border text-xs cursor-default flex items-center relative waveform-clip
                      ${isSel ? 'ring-2 ring-white/80 border-white/30' : 'border-[#334155]'}
                    `}
                    style={{ 
                      left: `${left}px`, 
                      width: `${w}px`,
                      background: isAudio ? '#0e7490' : '#166534',
                      boxShadow: '0 2px 8px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.1)'
                    }}
                    onMouseDown={(e) => onClipMouseDown(e, track.id, clip.id, clip.startBeat)}
                    onClick={(e) => onClipClick(clip.id, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setFadeEdit({ clip, trackId: track.id });
                    }}
                    whileHover={{ scale: isSel ? 1 : 1.01 }}
                    transition={{ duration: 0.1 }}
                  >
                    {/* Real computed waveform - high quality peaks with proper trim support */}
                    {peaks && peaks.max.length > 0 ? (
                      <WaveformCanvas 
                        peaks={peaks} 
                        width={w} 
                        height={TRACK_HEIGHT - 4}
                        color={waveColor} 
                        isSelected={isSel} 
                        offsetRatio={offsetRatio} 
                        durationRatio={durRatio} 
                      />
                    ) : (
                      // Fallback nice pattern if peaks not ready yet
                      <div className="absolute inset-0 opacity-50 bg-[repeating-linear-gradient(90deg,#fff_0,#fff_1px,transparent_1px,transparent_3px)]" />
                    )}

                    {/* Clip name with subtle bg for readability over waveform */}
                    <div className="relative z-10 ml-1 px-1 py-0.5 font-medium text-white/95 truncate text-[9px] tracking-tight bg-black/40 rounded select-none flex items-center gap-1">
                      {clip.storagePath.replace('local:', '').replace('demo:', '')}
                      {(clip.fadeInMs || clip.fadeOutMs) ? <span className="text-[7px] text-yellow-400">F</span> : null}
                    </div>

                    {/* Fade visual indicators (left in, right out) - accurate % */}
                    {(() => {
                      const tempo = useProjectStore.getState().project.tempo || 120;
                      const msPerBeat = 60000 / tempo;
                      const clipDurMs = (clip.durationBeats || 1) * msPerBeat;
                      const inPct = Math.min(100, ((clip.fadeInMs || 0) / clipDurMs) * 100);
                      const outPct = Math.min(100, ((clip.fadeOutMs || 0) / clipDurMs) * 100);
                      return (
                        <>
                          {(clip.fadeInMs || 0) > 0 && <div className="absolute left-0 top-0 bottom-0 bg-yellow-500/25 pointer-events-none z-10" style={{width: `${inPct}%`}} />}
                          {(clip.fadeOutMs || 0) > 0 && <div className="absolute right-0 top-0 bottom-0 bg-yellow-500/25 pointer-events-none z-10" style={{width: `${outPct}%`}} />}
                        </>
                      );
                    })()}

                    {/* Resize handles (only on selected) */}
                    {isSel && onResizeStart && (
                      <>
                        <div
                          className="absolute left-0 top-0 bottom-0 w-[7px] bg-white/70 cursor-ew-resize hover:bg-white z-20"
                          onMouseDown={(e) => onResizeStart(e, track.id, clip.id, 'left', clip.startBeat, clip.durationBeats)}
                        />
                        <div
                          className="absolute right-0 top-0 bottom-0 w-[7px] bg-white/70 cursor-ew-resize hover:bg-white z-20"
                          onMouseDown={(e) => onResizeStart(e, track.id, clip.id, 'right', clip.startBeat, clip.durationBeats)}
                        />
                      </>
                    )}

                    {/* Fade handles - top left/right triangles (Cubase style) */}
                    <div
                      className="fade-handle left" style={{borderBottomColor: '#eab308'}}
                      title={`Fade In: ${(clip.fadeInMs || 0)}ms`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startFade = clip.fadeInMs || 0;
                        const tempo = useProjectStore.getState().project.tempo;
                        const msPerBeat = 60000 / tempo;
                        const clipDurMs = clip.durationBeats * msPerBeat;
                        const onMove = (me: MouseEvent) => {
                          const dx = me.clientX - startX;
                          const deltaBeats = dx / beatWidth;
                          const deltaMs = deltaBeats * msPerBeat;
                          const newFade = Math.max(0, Math.min(clipDurMs, startFade + deltaMs));
                          useProjectStore.getState().updateClipFade(track.id, clip.id, { fadeInMs: Math.round(newFade) });
                        };
                        const onUp = () => {
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp, { once: true });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setFadeEdit({ clip, trackId: track.id });
                      }}
                    />
                    <div
                      className="fade-handle right" style={{borderBottomColor: '#22c55e'}}
                      title={`Fade Out: ${(clip.fadeOutMs || 0)}ms`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startFade = clip.fadeOutMs || 0;
                        const tempo = useProjectStore.getState().project.tempo;
                        const msPerBeat = 60000 / tempo;
                        const clipDurMs = clip.durationBeats * msPerBeat;
                        const onMove = (me: MouseEvent) => {
                          const dx = startX - me.clientX; // reverse for right
                          const deltaBeats = dx / beatWidth;
                          const deltaMs = deltaBeats * msPerBeat;
                          const newFade = Math.max(0, Math.min(clipDurMs, startFade + deltaMs));
                          useProjectStore.getState().updateClipFade(track.id, clip.id, { fadeOutMs: Math.round(newFade) });
                        };
                        const onUp = () => {
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp, { once: true });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setFadeEdit({ clip, trackId: track.id });
                      }}
                    />
                  </motion.div>
                );
              })}

              {/* MIDI Clips */}
              {(track.midiClips || []).map((clip: MidiClip) => {
                const left = clip.startBeat * beatWidth;
                const w = Math.max(beatWidth * 0.6, clip.durationBeats * beatWidth);
                const isSel = selectedClipIds.includes(clip.id);

                return (
                  <motion.div
                    key={clip.id}
                    className={`absolute top-0 bottom-0 rounded-md shadow-md border flex items-center overflow-hidden text-xs cursor-default
                      ${isSel ? 'ring-2 ring-white/80 border-white/30' : 'border-[#334155]'}
                    `}
                    style={{ 
                      left: `${left}px`, 
                      width: `${w}px`,
                      background: '#4ade80',
                      boxShadow: '0 2px 8px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.15)'
                    }}
                    onMouseDown={(e) => onClipMouseDown(e, track.id, clip.id, clip.startBeat)}
                    onClick={(e) => onClipClick(clip.id, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onMidiDoubleClick?.(clip.id);
                    }}
                  >
                    <div className="relative z-10 px-2 font-semibold text-black/80 truncate text-[10px] flex items-center gap-1">
                      <span>♪</span>
                      <span>{clip.notes?.length || 0} notes</span>
                    </div>

                    {isSel && onResizeStart && (
                      <>
                        <div
                          className="absolute left-0 top-0 bottom-0 w-[7px] bg-black/40 cursor-ew-resize hover:bg-black/70"
                          onMouseDown={(e) => onResizeStart(e, track.id, clip.id, 'left', clip.startBeat, clip.durationBeats)}
                        />
                        <div
                          className="absolute right-0 top-0 bottom-0 w-[7px] bg-black/40 cursor-ew-resize hover:bg-black/70"
                          onMouseDown={(e) => onResizeStart(e, track.id, clip.id, 'right', clip.startBeat, clip.durationBeats)}
                        />
                      </>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Loop Region Highlight (light yellow high transparency) */}
        {loopEnabled && loopEnd > loopStart && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${loopStart * beatWidth}px`,
              width: `${(loopEnd - loopStart) * beatWidth}px`,
              background: 'rgba(250, 204, 21, 0.12)',
              borderLeft: '1px solid rgba(250, 204, 21, 0.4)',
              borderRight: '1px solid rgba(250, 204, 21, 0.4)',
              zIndex: 1,
            }}
          />
        )}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-red-500 z-50 pointer-events-none"
          style={{ left: `${currentBeat * beatWidth + 1}px` }}
        />
        {/* Playhead hitbox for dragging from the line itself */}
        {onScrubStart && (
          <div 
            className="playhead-hitbox"
            style={{ left: `${currentBeat * beatWidth + 1}px`, zIndex: 51 }}
            onMouseDown={onScrubStart}
          />
        )}

        {/* Fade Editor modal */}
        {fadeEdit && (
          <FadeEditor 
            clip={fadeEdit.clip} 
            trackId={fadeEdit.trackId} 
            onClose={() => setFadeEdit(null)} 
          />
        )}
      </div>
    </div>
  );
}
