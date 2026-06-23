import React, { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import type { MidiNote } from '../../lib/types';
import { synthEngine } from '../../audio/SynthEngine';

interface PianoRollProps {
  clipId: string;
  onClose: () => void;
}

const PIANO_MIN_PITCH = 48; // C3
const PIANO_MAX_PITCH = 84; // C6
const KEY_HEIGHT = 18;
const BEAT_WIDTH = 56; // slightly wider than timeline for precision
const ROLL_HEIGHT = (PIANO_MAX_PITCH - PIANO_MIN_PITCH + 1) * KEY_HEIGHT; // fixed content size for positioning

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pitchToName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  const name = PITCH_NAMES[pitch % 12];
  return `${name}${octave}`;
}

function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

export function PianoRoll({ clipId, onClose }: PianoRollProps) {
  const {
    project,
    updateNote,
    addNote,
    deleteNote,
    quantize,
    currentBeat,
  } = useProjectStore();

  // Find the clip
  const clip = project.tracks
    .flatMap(t => t.midiClips || [])
    .find(c => c.id === clipId);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<null | {
    noteId: string;
    type: 'move' | 'resize';
    startX: number;
    startY: number;
    origStart: number;
    origPitch: number;
    origDur: number;
  }>(null);
  const dragRef = useRef(dragState);
  dragRef.current = dragState;

  // Resizable panel height (drag top edge)
  const [panelHeight, setPanelHeight] = useState(290);

  // Persist height
  useEffect(() => {
    const saved = localStorage.getItem('jaydeePianoRollHeight');
    if (saved) {
      const h = parseInt(saved, 10);
      if (h > 100) setPanelHeight(h);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('jaydeePianoRollHeight', panelHeight.toString());
  }, [panelHeight]);

  const handleTopResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    const minH = 160;
    const maxH = 620;

    const onMove = (moveEvent: MouseEvent) => {
      // Dragging top edge UP (mouseY smaller) => increase height
      const delta = startY - moveEvent.clientY;
      const newH = Math.max(minH, Math.min(maxH, startH + delta));
      setPanelHeight(newH);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!clip) {
    return <div className="piano-roll">Clip not found</div>;
  }

  const totalBeats = Math.max(8, Math.ceil(clip.durationBeats) + 4);
  const rollWidth = totalBeats * BEAT_WIDTH;

  const getPitchFromY = (y: number) => {
    // y=0 is top = highest pitch
    const idxFromTop = Math.floor(y / KEY_HEIGHT);
    return PIANO_MAX_PITCH - idxFromTop;
  };

  const getBeatFromX = (x: number) => {
    const beat = x / BEAT_WIDTH;
    return Math.max(0, Math.round(beat / quantize) * quantize);
  };

  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft; // account if scrolled
    const y = e.clientY - rect.top + e.currentTarget.scrollTop;

    const pitch = getPitchFromY(y);
    if (pitch < PIANO_MIN_PITCH || pitch > PIANO_MAX_PITCH) return;

    const startBeat = getBeatFromX(x);

    // Default duration = 1 beat or quantize
    const dur = Math.max(quantize, 1);
    addNote(clipId, pitch, startBeat, dur, 95);
  };

  // Drag handlers
  const onNoteMouseDown = (e: React.MouseEvent, note: MidiNote, mode: 'move' | 'resize') => {
    e.stopPropagation();
    setSelectedNoteId(note.id);

    const currentDrag = {
      noteId: note.id,
      type: mode,
      startX: e.clientX,
      startY: e.clientY,
      origStart: note.startBeat,
      origPitch: note.pitch,
      origDur: note.durationBeats,
    };
    setDragState(currentDrag);

    const onMove = (moveEvent: MouseEvent) => {
      const ds = dragRef.current || currentDrag;
      if (!ds) return;

      const dx = moveEvent.clientX - ds.startX;
      const dy = moveEvent.clientY - ds.startY;

      if (ds.type === 'move') {
        const newStart = ds.origStart + dx / BEAT_WIDTH;
        const newPitch = ds.origPitch - Math.round(dy / KEY_HEIGHT);

        const clampedPitch = Math.max(PIANO_MIN_PITCH, Math.min(PIANO_MAX_PITCH, newPitch));
        const snappedStart = Math.max(0, Math.round(newStart / quantize) * quantize);

        updateNote(clipId, ds.noteId, {
          startBeat: snappedStart,
          pitch: clampedPitch,
        });
      } else {
        // resize
        const deltaBeats = dx / BEAT_WIDTH;
        const newDur = Math.max(quantize * 0.5, ds.origDur + deltaBeats);
        const snappedDur = Math.round(newDur / quantize) * quantize;
        updateNote(clipId, ds.noteId, { durationBeats: snappedDur });
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragState(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Keyboard delete inside roll
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId) {
        e.preventDefault();
        deleteNote(clipId, selectedNoteId);
        setSelectedNoteId(null);
      }
      if (e.key === 'Escape') {
        setSelectedNoteId(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedNoteId, clipId, deleteNote]);

  // Simple playhead inside roll (relative to clip start)
  const playheadRelBeat = Math.max(0, currentBeat - clip.startBeat);
  const playheadLeft = playheadRelBeat * BEAT_WIDTH;

  return (
    <div className="piano-roll-container border-t border-[#334155] bg-[#0f172a] flex flex-col" style={{ height: panelHeight }}>
      {/* Top resize handle */}
      <div
        className="h-[5px] bg-[#475569] cursor-ns-resize flex-shrink-0 active:bg-[#64748b] hover:bg-[#64748b] transition-colors"
        onMouseDown={handleTopResizeStart}
        title="Drag to resize Piano Roll"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 text-[11px] bg-[#1e2937] border-b border-[#334155]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-blue-400">Piano Roll</span>
          <span className="text-text-muted">— {clip.notes.length} notes</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-[#334155] rounded">Quantize: 1/{Math.round(1 / quantize)}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              // Add a middle C note at current view
              const midPitch = 60;
              const start = Math.max(0, Math.floor((currentBeat - clip.startBeat) / quantize) * quantize);
              addNote(clipId, midPitch, start, 1, 100);
            }}
            className="button text-[10px] px-2 py-0.5"
          >
            + C4
          </button>
          <button onClick={onClose} className="button text-[10px] px-2 py-0.5">Close</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Piano Keys - clickable to preview sound */}
        <div 
          className="piano-keys w-[54px] flex-shrink-0 bg-[#111827] border-r border-[#334155] overflow-y-auto text-[9px] select-none" 
          style={{ height: '100%' }}
        >
          {Array.from({ length: PIANO_MAX_PITCH - PIANO_MIN_PITCH + 1 }).map((_, i) => {
            const pitch = PIANO_MAX_PITCH - i;
            const black = isBlackKey(pitch);
            const name = pitchToName(pitch);
            return (
              <div
                key={pitch}
                className={`flex items-center px-1 cursor-pointer active:bg-[#34d399] transition-colors ${black ? 'bg-[#1f2937] text-[#64748b]' : 'bg-[#e2e8f0] text-[#0f172a]'} border-b border-[#334155]`}
                style={{ height: KEY_HEIGHT, fontSize: 9 }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  synthEngine.playPreview(pitch, 95, 0.6);
                }}
                onMouseEnter={(e) => {
                  if (e.buttons & 1) {
                    synthEngine.playPreview(pitch, 90, 0.5);
                  }
                }}
                title={`Play ${name}`}
              >
                {name}
              </div>
            );
          })}
        </div>

        {/* Grid + Notes */}
        <div
          className="flex-1 overflow-auto relative piano-grid"
          style={{ height: '100%' }}
          onClick={handleGridClick}
        >
          {/* Content wrapper with fixed roll height for positioning */}
          <div style={{ height: ROLL_HEIGHT, position: 'relative', minWidth: rollWidth }}>
            {/* Vertical beat lines */}
            <div className="absolute inset-0 pointer-events-none" style={{ width: rollWidth }}>
              {Array.from({ length: Math.ceil(totalBeats) + 1 }).map((_, b) => (
                <div
                  key={b}
                  className="absolute top-0 bottom-0 border-l border-[#334155]"
                  style={{ left: b * BEAT_WIDTH, opacity: b % 4 === 0 ? 0.6 : 0.2 }}
                />
              ))}
            </div>

            {/* Horizontal pitch lines */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: PIANO_MAX_PITCH - PIANO_MIN_PITCH + 1 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-b border-[#1e2937]"
                  style={{ top: i * KEY_HEIGHT }}
                />
              ))}
            </div>

          {/* Notes */}
          {clip.notes.map((note) => {
            if (note.pitch < PIANO_MIN_PITCH || note.pitch > PIANO_MAX_PITCH) return null;

            const relStart = note.startBeat;
            const left = relStart * BEAT_WIDTH;
            const w = Math.max(18, note.durationBeats * BEAT_WIDTH);
            const top = (PIANO_MAX_PITCH - note.pitch) * KEY_HEIGHT;

            const isSel = selectedNoteId === note.id;

            return (
              <div
                key={note.id}
                className={`absolute rounded-sm cursor-move flex items-center px-1 text-[9px] select-none ${isSel ? 'ring-2 ring-pink-400 z-20' : ''}`}
                style={{
                  left,
                  top,
                  width: w,
                  height: KEY_HEIGHT - 2,
                  background: isSel ? '#c026ff' : '#3b82f6',
                  border: '1px solid #1e40af',
                  color: '#fff',
                  boxShadow: 'inset 0 0 4px rgba(0,0,0,0.3)',
                }}
                onMouseDown={(e) => onNoteMouseDown(e, note, 'move')}
                onClick={(e) => { e.stopPropagation(); setSelectedNoteId(note.id); }}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/30 hover:bg-white/50"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onNoteMouseDown(e, note, 'resize');
                  }}
                />
                <span className="truncate pl-0.5 text-[8px] opacity-80">{pitchToName(note.pitch)}</span>
              </div>
            );
          })}

          {/* Playhead inside roll */}
          {playheadLeft >= 0 && playheadLeft < rollWidth + 60 && (
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-[#f87171] z-30 pointer-events-none"
              style={{ left: playheadLeft }}
            />
          )}
          </div> {/* end content wrapper */}
        </div>
      </div>

      <div className="px-3 py-0.5 text-[9px] text-text-muted border-t border-[#334155]">
        Click grid to add • Drag notes to move (time + pitch) • Drag right edge to resize • Drag top edge of panel to resize • Click left piano keys to preview sound • Del to delete selected note
      </div>
    </div>
  );
}
