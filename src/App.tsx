import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { Upload, Plus } from 'lucide-react'
import { useProjectStore } from './stores/useProjectStore'
import { Transport } from './components/daw/Transport'
// PianoRoll import removed (Phase 3 MIDI/Piano handled in parallel session to avoid duplication)
import { Mixer } from './components/daw/Mixer'

const TRACK_HEIGHT = 40 // MUST match --track-height in CSS. Do NOT change independently! Use in all height calcs and comments.

function App() {
  const [beatWidth, setBeatWidth] = useState(48); // pixels per beat, zoomable. Default was 48
  const [showMixer, setShowMixer] = useState(false)

  const { 
    project, 
    addAudioClip,
    addTestTone,
    addTrackOfType,
    currentBeat,
    selectedClipIds,
    setSelectedClipIds,
    deleteSelectedClips,
    selectClip,
    toggleClipSelection,
    clearSelection,
    quantize,
    isQuantizeOn,
    loopEnabled,
    loopStart,
    loopEnd,
    setLoopRegion,
    toggleLoop
  } = useProjectStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const trackListRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  // Compute how wide the timeline content needs to be (in beats)
  const requiredBeats = useMemo(() => {
    let max = 30; // at least 30 beats visible base
    project.tracks.forEach(track => {
      (track.audioClips || []).forEach(clip => {
        max = Math.max(max, clip.startBeat + (clip.durationBeats || 1) + 8);
      });
      // midiClips skipped here (parallel session)
    });
    return max;
  }, [project]);

  // Ref for current beatWidth (used in key handlers to avoid stale closure)
  const beatWidthRef = useRef<number>(beatWidth);
  useEffect(() => {
    beatWidthRef.current = beatWidth;
  }, [beatWidth]);

  // Zoom centered on playhead position
  const zoomTimeline = useCallback((factor: number) => {
    const tl = timelineRef.current;
    if (!tl) return;

    const store = useProjectStore.getState();
    const playhead = store.currentBeat;

    const scrollLeft = tl.scrollLeft;
    const playheadPx = playhead * beatWidthRef.current;
    const playheadInView = playheadPx - scrollLeft;

    const newBeatWidth = Math.max(4, Math.min(256, beatWidthRef.current * factor));

    const newPlayheadPx = playhead * newBeatWidth;
    const newScrollLeft = Math.max(0, newPlayheadPx - playheadInView);

    setBeatWidth(newBeatWidth);

    requestAnimationFrame(() => {
      if (timelineRef.current) {
        timelineRef.current.scrollLeft = newScrollLeft;
      }
    });
  }, []);  // stable, uses refs + getState inside

  // Optional: also support Ctrl + wheel for zoom later, but keys first as requested.

  // Guarantee perfect vertical alignment by syncing scroll (loop-safe)
  let syncing = false
  const syncScroll = (from: React.RefObject<HTMLDivElement | null>, to: React.RefObject<HTMLDivElement | null>) => {
    if (syncing || !from.current || !to.current) return
    syncing = true
    to.current.scrollTop = from.current.scrollTop
    // reset after paint
    requestAnimationFrame(() => { syncing = false })
  }

  // Box selection state for multi-select
  const [boxSelect, setBoxSelect] = useState<null | { startX: number; startY: number; endX: number; endY: number }>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Pick first audio track as target (simple fallback)
    const targetTrack = project.tracks.find(t => t.type === 'audio')
    if (!file || !targetTrack) return

    await addAudioClip(targetTrack.id, file)
    // input 리셋
    e.target.value = ''
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const toggleMixer = () => setShowMixer(!showMixer)

  // Keyboard shortcuts
  // - Space: toggle play
  // - Delete / Backspace: delete currently selected clip (if any), even if focus is elsewhere (e.g. BPM input)
  // - Escape: deselect
  // - H: zoom in (centered on playhead)
  // - G: zoom out (centered on playhead)
  // - L: toggle loop on/off (loop region)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        useProjectStore.getState().togglePlay();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.length > 0) {
        e.preventDefault();
        deleteSelectedClips();
        return;
      }

      if (e.key === 'Escape' && selectedClipIds.length > 0) {
        clearSelection();
      }

      // Undo / Redo
      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
      const isRedo = ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
                     ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey);

      if (isUndo) {
        e.preventDefault();
        useProjectStore.getState().undo();
      }
      if (isRedo) {
        e.preventDefault();
        useProjectStore.getState().redo();
      }

      // Q key: toggle quantize on/off (free movement)
      if (e.key.toLowerCase() === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
          return; // let the input handle 'q'
        }
        e.preventDefault();
        useProjectStore.getState().toggleQuantize();
      }

      // Copy / Paste for clips
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedClipIds.length > 0) {
        e.preventDefault();
        useProjectStore.getState().copySelectedClips();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const ph = useProjectStore.getState().currentBeat;
        useProjectStore.getState().pasteClips(ph);
      }

      // Zoom timeline: H = zoom in, G = zoom out, centered on playhead
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
        const key = e.key.toLowerCase();
        if (!inInput && key === 'h') {
          e.preventDefault();
          zoomTimeline(1.2);
        } else if (!inInput && key === 'g') {
          e.preventDefault();
          zoomTimeline(1 / 1.2);
        } else if (!inInput && key === 'l') {
          e.preventDefault();
          toggleLoop();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true); // capture so it can override input handling
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedClipIds, deleteSelectedClips, clearSelection])

  // Real data-driven timeline
  const handleClipMouseDown = (e: React.MouseEvent, trackId: string, clipId: string, currentStart: number) => {
    e.stopPropagation();

    const storeBefore = useProjectStore.getState();
    const wasAlt = e.altKey;
    const wasShift = e.shiftKey;
    const selectionBeforeClick = [...storeBefore.selectedClipIds];
    const willAltDuplicate = wasAlt && selectionBeforeClick.length > 0 && selectionBeforeClick.includes(clipId);

    // Handle Shift+Click for add/remove to existing selection (toggle)
    if (wasShift) {
      toggleClipSelection(clipId);
    } else if (!willAltDuplicate) {
      // Normal click: replace selection with this one
      selectClip(clipId);
    } else {
      // For alt-duplicate, keep the previous group selection
      if (JSON.stringify(storeBefore.selectedClipIds) !== JSON.stringify(selectionBeforeClick)) {
        setSelectedClipIds(selectionBeforeClick);
      }
    }

    const store = useProjectStore.getState();

    // For move operations, record history once at the start of drag
    if (e.button === 0) {
      store.pushHistory();
    }

    const startX = e.clientX;
    const startBeat = currentStart;

    // Snapshot current selection (after possible shift toggle or alt keep) for group drag
    let initialPositions: Record<string, {trackId: string, startBeat: number}> = {};
    store.selectedClipIds.forEach(sid => {
      store.project.tracks.forEach(tr => {
        let cl = (tr.audioClips || []).find(c => c.id === sid);
        if (cl) {
          initialPositions[sid] = { trackId: tr.id, startBeat: cl.startBeat };
          return;
        }
        cl = (tr.audioClips || []).find(c => c.id === sid);
        if (cl) {
          initialPositions[sid] = { trackId: tr.id, startBeat: cl.startBeat };
        }
      });
    });

    let didDuplicate = false;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaBeats = deltaX / beatWidth;
      const currentStore = useProjectStore.getState();
      const quant = currentStore.isQuantizeOn ? currentStore.quantize : 0;

      // Alt + drag on selected clips => duplicate on first movement, then drag the copies
      if (willAltDuplicate && !didDuplicate && Math.abs(deltaX) > 1 && Object.keys(initialPositions).length > 0) {
        didDuplicate = true;
        // Call duplicate but skip its internal history push (we already pushed on mousedown for this gesture)
        currentStore.duplicateSelectedClips(true);

        // Get fresh store after duplication
        const afterDupe = useProjectStore.getState();

        // Now selection is the new duplicated clips.
        // Rebuild initialPositions for the new selection (they are at same original positions)
        initialPositions = {};
        const newSel = afterDupe.selectedClipIds;
        newSel.forEach(sid => {
          afterDupe.project.tracks.forEach(tr => {
            let cl = (tr.audioClips || []).find(c => c.id === sid);
            if (cl) {
              initialPositions[sid] = { trackId: tr.id, startBeat: cl.startBeat };
              return;
            }
            cl = (tr.audioClips || []).find(c => c.id === sid);
            if (cl) {
              initialPositions[sid] = { trackId: tr.id, startBeat: cl.startBeat };
            }
          });
        });
      }

      if (Object.keys(initialPositions).length > 0) {
        // Move the (duplicated or grouped) clips
        Object.keys(initialPositions).forEach(sid => {
          const init = initialPositions[sid];
          const newStart = init.startBeat + deltaBeats;
          const snapped = quant > 0 ? Math.max(0, Math.round(newStart / quant) * quant) : newStart;
          currentStore.moveClip(init.trackId, sid, snapped);
        });
      } else {
        // Normal single clip drag
        const newStart = startBeat + deltaBeats;
        const snapped = quant > 0 ? Math.max(0, Math.round(newStart / quant) * quant) : newStart;
        currentStore.moveClip(trackId, clipId, snapped);
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Resize clip (trim)
  const handleResizeMouseDown = (e: React.MouseEvent, trackId: string, clipId: string, edge: 'left' | 'right', origStart: number, origDur: number, origOffset: number) => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const quant = useProjectStore.getState().isQuantizeOn ? useProjectStore.getState().quantize : 0;

    useProjectStore.getState().pushHistory();

    const onMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaBeats = deltaX / beatWidth;

      let newStart = origStart;
      let newDur = origDur;
      let newOffset = origOffset;

      if (edge === 'left') {
        newStart = origStart + deltaBeats;
        newOffset = origOffset + deltaBeats;
        newDur = origDur - deltaBeats;
      } else {
        newDur = origDur + deltaBeats;
      }

      newStart = Math.max(0, newStart);
      newDur = Math.max(0.25, newDur);
      newOffset = Math.max(0, newOffset);

      if (quant > 0) {
        newStart = Math.round(newStart / quant) * quant;
        newDur = Math.max(0.25, Math.round(newDur / quant) * quant);
      }

      useProjectStore.getState().resizeClip(trackId, clipId, newDur, newStart, newOffset);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Loop region drag in the thin top bar (like Cubase marker/loop bar)
  // Drag defines start -> end. Always uses current quantize.
  const handleLoopRegionDragStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();

    const getSnappedBeat = (clientX: number) => {
      const x = clientX - rect.left;
      const beat = Math.max(0, x / beatWidth);
      const q = (quantize && quantize > 0) ? quantize : 0.25;
      return Math.round(beat / q) * q;
    };

    let startBeat = getSnappedBeat(e.clientX);
    let endBeat = startBeat;

    setLoopRegion(startBeat, endBeat);
    if (!loopEnabled) {
      toggleLoop();
    }

    const onMove = (moveEvent: MouseEvent) => {
      const current = getSnappedBeat(moveEvent.clientX);
      const newStart = Math.min(startBeat, current);
      const newEnd = Math.max(startBeat, current);
      setLoopRegion(newStart, newEnd);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  };

  // Playhead scrubbing - always uses the ruler for coordinate reference
  const handleScrubStart = (e: React.MouseEvent) => {
    const ruler = document.querySelector('.timeline-ruler') as HTMLElement;
    if (!ruler) return;
    const rect = ruler.getBoundingClientRect();

    const doSeek = (clientX: number) => {
      const x = Math.max(0, clientX - rect.left);
      const beat = x / beatWidth;
      useProjectStore.getState().seek(beat);
    };

    doSeek(e.clientX);

    const wasPlaying = useProjectStore.getState().isPlaying;
    if (wasPlaying) {
      useProjectStore.getState().stop();
    }

    const onMove = (moveEvent: MouseEvent) => {
      doSeek(moveEvent.clientX);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (wasPlaying) {
        setTimeout(() => {
          useProjectStore.getState().togglePlay();
        }, 0);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  };

  // Box selection (drag on background to select multiple clips)
  const handleBoxSelectStart = (e: React.MouseEvent) => {
    // Only start box select if not clicking on a clip
    const target = e.target as HTMLElement;
    if (target.closest('.waveform-clip')) return;

    e.stopPropagation();
    const content = e.currentTarget as HTMLDivElement;
    const rect = content.getBoundingClientRect();

    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    setBoxSelect({ startX, startY, endX: startX, endY: startY });

    const onMove = (moveEvent: MouseEvent) => {
      const x = moveEvent.clientX - rect.left;
      const y = moveEvent.clientY - rect.top;
      setBoxSelect({ startX, startY, endX: x, endY: y });
    };

    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      const finalBox = { startX, startY, endX: upEvent.clientX - rect.left, endY: upEvent.clientY - rect.top };
      setBoxSelect(null);

      // Find all clips inside the box
      const minX = Math.min(finalBox.startX, finalBox.endX);
      const maxX = Math.max(finalBox.startX, finalBox.endX);
      const minY = Math.min(finalBox.startY, finalBox.endY);
      const maxY = Math.max(finalBox.startY, finalBox.endY);

      const newlySelected: string[] = [];

      project.tracks.forEach((track, trackIdx) => {
        const trackTop = trackIdx * 40;
        const trackBottom = trackTop + 40;

        (track.audioClips || []).forEach((clip) => {
          const clipLeft = clip.startBeat * beatWidth;
          const clipRight = clipLeft + clip.durationBeats * beatWidth;
          const clipTop = trackTop;
          const clipBottom = trackBottom;

          const intersects = !(clipRight < minX || clipLeft > maxX || clipBottom < minY || clipTop > maxY);
          if (intersects) {
            newlySelected.push(clip.id);
          }
        });

        // Only audio clips (MIDI/piano handled in parallel session to avoid duplication)
      });

      if (newlySelected.length > 0) {
        setSelectedClipIds(newlySelected);
      } else {
        clearSelection();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  };

  const renderTimeline = () => {
    return (
      <>
        {/* Colored Section Header (Arranger style) */}
        <div className="arranger-bar">
          <div className="arranger-section intro" style={{ width: '120px' }}>INTRO</div>
          <div className="arranger-section verse" style={{ width: '180px' }}>VERSE</div>
          <div className="arranger-section prech" style={{ width: '100px' }}>PRE CH</div>
          <div className="flex-1 bg-[#1f2937]" />
        </div>

        {/* Loop Region Bar (top thin bar like marker track)
            Drag here to define loop region. Highlights arrange area below. */}
        <div
          className="loop-region-bar"
          onMouseDown={handleLoopRegionDragStart}
          title="Drag to set Loop Region (L to toggle loop)"
        >
          {/* Visual representation of current loop in the bar */}
          {loopEnabled && loopEnd > loopStart && (
            <div
              style={{
                position: 'absolute',
                left: `${loopStart * beatWidth}px`,
                width: `${(loopEnd - loopStart) * beatWidth}px`,
                top: '2px',
                height: '14px',
                background: 'rgba(250, 204, 21, 0.35)',
                border: '1px solid rgba(250, 204, 21, 0.7)',
                borderRadius: '1px',
                pointerEvents: 'none'
              }}
            />
          )}
          {/* Playhead indicator in the loop bar (extends the arrow concept) */}
          <div
            className="playhead-handle"
            style={{
              left: `${currentBeat * beatWidth + 4}px`,
              top: '-1px',
              height: '20px',
              width: '6px',
              background: '#f87171',
              borderRadius: '0 0 3px 3px',
              pointerEvents: 'none',
              zIndex: 50
            }}
          />
          {/* Small label */}
          <div className="absolute left-1 top-0 text-[9px] text-yellow-400/70 pointer-events-none">LOOP</div>
        </div>

        {/* Ruler - supports click and drag to scrub playhead.
            The small triangle at the exact playhead x is the "marker" you can click to move. */}
        <div 
          className="timeline-ruler cursor-pointer select-none relative" 
          onMouseDown={handleScrubStart}
        >
          {Array.from({ length: Math.ceil(requiredBeats) }).map((_, i) => (
            <div key={i} className="beat-col">
              {i % 4 === 0 ? `${Math.floor(i / 4) + 1}` : ''}
            </div>
          ))}

          {/* Quantize tick marks in ruler */}
          {isQuantizeOn && quantize > 0 && quantize < 1 && (
            <div 
              className="quantize-ticks"
              style={{
                position: 'absolute',
                inset: 0,
                background: `repeating-linear-gradient(90deg, transparent, transparent ${Math.max(2, beatWidth * quantize - 1)}px, rgba(255,255,255,0.4) ${Math.max(3, beatWidth * quantize)}px)`,
                pointerEvents: 'none',
                zIndex: 5
              }}
            />
          )}

          {/* Playhead marker (triangle) in the ruler for easy click-to-move */}
          <div 
            className="playhead-handle"
            style={{ left: `${currentBeat * beatWidth + 4}px` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              handleScrubStart(e);
            }}
          />
        </div>

        <div 
          className="timeline-content" 
          style={{ minWidth: `${requiredBeats * beatWidth}px`, position: 'relative' }}
          onClick={() => clearSelection()}
          onMouseDown={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.waveform-clip')) {
              // Let the clip handle it (select or drag)
              return;
            }
            // Start box selection (for multi-select)
            handleBoxSelectStart(e);
          }}
        >
          <div className="timeline-grid" />

          {/* Loop region highlight overlay (yellow, high transparency) in arrange area.
              This is the visual "loop region" highlight across the track backgrounds. */}
          {loopEnabled && loopEnd > loopStart && (
            <div
              className="loop-highlight"
              style={{
                left: `${loopStart * beatWidth}px`,
                width: `${(loopEnd - loopStart) * beatWidth}px`,
              }}
            />
          )}

          {/* Quantize subdivision lines (visible when Q on) - denser for smaller quantize */}
          {isQuantizeOn && quantize > 0 && (
            <div 
              className="quantize-grid"
              style={{
                background: `repeating-linear-gradient(90deg, transparent, transparent ${Math.max(2, beatWidth * quantize - 1)}px, rgba(147, 197, 253, 0.35) ${Math.max(3, beatWidth * quantize)}px)`,
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 2
              }}
            />
          )}

          {project.tracks.map((track) => (
            <div key={track.id} className="timeline-track-row" style={{ height: TRACK_HEIGHT }}>
              {/* Each row height locked to TRACK_HEIGHT + border-box to guarantee pixel-perfect vertical alignment with left track-row.
                  The .top-spacer above matches ruler+arranger.
                  scrollTop is synced between trackListRef and timelineRef. */}
              {/* Audio clips */}
              {(track.audioClips || []).map((clip) => {
                const left = clip.startBeat * beatWidth;
                const width = Math.max(beatWidth, clip.durationBeats * beatWidth);
                const isSelected = selectedClipIds.includes(clip.id);

                return (
                  <div
                    key={clip.id}
                    className={`waveform-clip ${isSelected ? 'selected' : ''}`}
                    style={{ left: `${left}px`, width: `${width}px` }}
                    onMouseDown={(e) => handleClipMouseDown(e, track.id, clip.id, clip.startBeat)}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Selection logic is handled in onMouseDown to support modifiers (Shift) properly
                      // and to coordinate with drag start.
                    }}
                  >
                    <div className="wave" />
                    <span className="relative z-10 text-[9px] px-1 truncate">
                      {clip.storagePath.replace('local:', '').replace('demo:', '')}
                    </span>
                    {isSelected && (
                      <>
                        <div
                          className="resize-handle left"
                          onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip.id, 'left', clip.startBeat, clip.durationBeats, clip.offsetBeats)}
                        />
                        <div
                          className="resize-handle right"
                          onMouseDown={(e) => handleResizeMouseDown(e, track.id, clip.id, 'right', clip.startBeat, clip.durationBeats, clip.offsetBeats)}
                        />
                      </>
                    )}
                  </div>
                );
              })}

            </div>
          ))}

          {/* Playhead visual line (no pointer events, so clips underneath are clickable) */}
          <div 
            className="playhead" 
            style={{ 
              left: `${currentBeat * beatWidth + 4}px`,
              height: `${project.tracks.length * TRACK_HEIGHT}px` 
            }}
          />

          {/* Thin hitbox exactly over the playhead line for precise drag over tracks */}
          <div 
            className="playhead-hitbox"
            style={{ 
              left: `${currentBeat * beatWidth + 4}px`,
              height: `${project.tracks.length * TRACK_HEIGHT}px` 
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              handleScrubStart(e);
            }}
          />

          {/* Visual selection box during multi-select drag */}
          {boxSelect && (() => {
            const left = Math.min(boxSelect.startX, boxSelect.endX);
            const top = Math.min(boxSelect.startY, boxSelect.endY);
            const w = Math.abs(boxSelect.endX - boxSelect.startX);
            const h = Math.abs(boxSelect.endY - boxSelect.startY);
            return (
              <div
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: w,
                  height: h,
                  background: 'rgba(163, 163, 172, 0.18)',
                  border: '1px dashed #a3a3ac',
                  pointerEvents: 'none',
                  zIndex: 25,
                }}
              />
            );
          })()}
        </div>
      </>
    );
  };

  return (
    <div className="daw-app text-text">
      {/* Transport */}
      <Transport />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Main Layout: Left Track List + Right Timeline */}
      <div className="main-area">
        {/* === Track List (Left) - driven by store === */}
        <div 
          ref={trackListRef}
          className="track-list"
          onScroll={() => syncScroll(trackListRef, timelineRef)}
        >
          {/* Spacer to align first track-row exactly under the ruler (prevents misalignment) */}
          {/* Spacer height == --top-offset (arranger + ruler) so that first .track-row top aligns exactly with first .timeline-track-row top.
              This + shared --track-height var + TRACK_HEIGHT const + scroll sync = unbreakable alignment guarantee. */}
          <div className="top-spacer" />
          {project.tracks.map((track) => {
            const colorClass = 
              track.type === 'audio' ? 'audio' : 
              track.type === 'instrument' ? 'instrument' : 'fx';

            return (
              <div key={track.id} className={`track-row ${colorClass}`}>
                <div className="color-strip" />
                <div className="track-content">
                  <div className="track-header">
                    <div className="track-icon">
                      {track.type === 'audio' ? '〰' : track.type === 'instrument' ? '♪' : 'FX'}
                    </div>
                    <div className="track-name flex items-center gap-1">
                      {track.name} 
                      {track.inserts.length > 0 && (
                        <span className="text-[8px] px-1 bg-[#374151] rounded text-[#34d399]">{track.inserts.length}FX</span>
                      )}
                    </div>

                    {/* Quick insert add from arrange view for fast signal chain testing */}
                    <div className="flex gap-px ml-auto text-[7px]">
                      <span 
                        className="cursor-pointer px-0.5 hover:text-[#34d399]" 
                        onClick={() => useProjectStore.getState().addInsert(track.id, { type: 'eq3band', params: { lowGain: 0, midGain: 0, highGain: 0 } })}
                        title="Add EQ"
                      >EQ</span>
                      <span 
                        className="cursor-pointer px-0.5 hover:text-[#f59e0b]" 
                        onClick={() => useProjectStore.getState().addInsert(track.id, { type: 'compressor', params: { threshold: -20, ratio: 4 } })}
                        title="Add Comp"
                      >C</span>
                    </div>

                    <div className="ms-group">
                      <div 
                        className={`ms-btn m ${track.muted ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleMute(track.id); }}
                        title="Mute"
                      >
                        M
                      </div>
                      <div 
                        className={`ms-btn s ${track.soloed ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleSolo(track.id); }}
                        title="Solo"
                      >
                        S
                      </div>
                    </div>
                  </div>

                  <div 
                    className="track-vol" 
                    onMouseDown={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const update = (clientX: number) => {
                        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                        useProjectStore.getState().setTrackGain(track.id, pct);
                      };
                      update(e.clientX);
                      const onMove = (me: MouseEvent) => update(me.clientX);
                      const onUp = () => {
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                      };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp, { once: true });
                    }}
                    title="Drag to set volume (live)"
                  >
                    <div className="fill" style={{ width: `${Math.round(track.gain * 100)}%` }} />
                  </div>
                  {/* Simple pan control */}
                  <div 
                    className="track-pan" 
                    onMouseDown={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const update = (clientX: number) => {
                        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                        const pan = (pct - 0.5) * 2;
                        useProjectStore.getState().setTrackPan(track.id, pan);
                      };
                      update(e.clientX);
                      const onMove = (me: MouseEvent) => update(me.clientX);
                      const onUp = () => {
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                      };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp, { once: true });
                    }}
                    title="Drag to set pan (live via engine nodes)"
                  >
                    <div className="pan-fill" style={{ left: `${(track.pan + 1) * 50}%` }} />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="p-1 border-t border-[#334155] mt-1 pt-2 space-y-1">
            <button 
              onClick={toggleMixer} 
              className="button w-full text-[10px] font-medium"
              style={{ background: showMixer ? '#34d399' : undefined, color: showMixer ? '#111' : undefined }}
            >
              {showMixer ? '✕ CLOSE MIXER' : '🎚️ OPEN MIXER (Inserts + Master Bus)'}
            </button>
            <button 
              onClick={() => useProjectStore.getState().loadDemoMixChain()}
              className="button w-full text-[9px] mt-0.5 bg-[#4b5563] hover:bg-[#6b7280]"
              title="Load varied insert chains (EQ + Comp) across tracks to demo the full signal chain"
            >
              📦 LOAD DEMO MIX (Inserts)
            </button>
            <button 
              onClick={() => useProjectStore.getState().loadDemoMixChain()}
              className="button w-full text-[9px] mt-0.5"
              title="Load a full demo insert chain (EQ + Comp) on tracks to test signal flow"
            >
              📦 LOAD DEMO MIX CHAIN
            </button>
            <div className="flex gap-1">
              <button 
                onClick={() => addTrackOfType('audio')}
                className="button flex-1 flex items-center justify-center gap-1 text-[10px]"
                title="Add Audio Track (Cubase style)"
              >
                <Plus size={10} /> Audio
              </button>
            </div>
            <button 
              onClick={handleUploadClick}
              className="button w-full flex items-center justify-center gap-1 text-[10px]"
            >
              <Upload size={11} /> Upload Audio
            </button>
            <button 
              onClick={() => {
                const firstAudio = project.tracks.find(t => t.type === 'audio');
                if (firstAudio) addTestTone(firstAudio.id);
              }}
              className="button w-full flex items-center justify-center gap-1 text-[10px]"
            >
              Add Test Tone
            </button>
          </div>
        </div>

        {/* === Main Timeline (Right) === */}
        <div 
          ref={timelineRef}
          className="timeline"
          onScroll={() => syncScroll(timelineRef, trackListRef)}
        >
          {renderTimeline()}
        </div>
      </div>

      {/* Mixer Panel - Cubase-style horizontal channel strips (vertical faders, inserts, meters, master) */}
      <Mixer open={showMixer} onClose={() => setShowMixer(false)} />

      {/* Minimal bottom status (toggle lives in left track-list area for minimal diff) */}
      <div className="h-5 bg-[#0f172a] border-t border-[#334155] text-[9px] px-3 flex items-center text-text-muted">
        Jaydee • {project.tempo} BPM • Local • SignalChain v2 (Inserts + Master Bus)
      </div>
    </div>
  )
}

export default App
