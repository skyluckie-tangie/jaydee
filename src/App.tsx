// @ts-nocheck
import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { Upload, Plus } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useProjectStore } from './stores/useProjectStore'
import { Transport } from './components/daw/Transport'
import { TrackListItem } from './components/daw/TrackListItem'
import { Timeline } from './components/daw/Timeline'
import { Mixer } from './components/daw/Mixer'
import { PianoRoll } from './components/daw/PianoRoll'
import { audioEngine } from './audio/AudioEngine'

import { TRACK_HEIGHT } from './lib/constants'
import { useAuthStore } from './stores/useAuthStore'
import { isSupabaseConfigured } from './lib/supabase'

function App() {
  const [beatWidth, setBeatWidth] = useState(48); // pixels per beat, zoomable. Default was 48
  const [showMixer, setShowMixer] = useState(false)
  const [openPianoRollClipId, setOpenPianoRollClipId] = useState<string | null>(() => {
    // Default open a piano roll on launch if possible
    const store = useProjectStore.getState();
    let clipId: string | null = null;
    for (const t of store.project.tracks) {
      if (t.midiClips && t.midiClips.length > 0) {
        clipId = t.midiClips[0].id;
        break;
      }
    }
    if (!clipId) {
      let track = store.project.tracks.find((t: any) => t.type === 'instrument' || t.type === 'midi');
      if (!track) {
        store.addTrackOfType('instrument');
        track = store.project.tracks[store.project.tracks.length - 1];
      }
      store.addMidiClip(track.id, 0, 8);
      const clips = store.project.tracks.find((t: any) => t.id === track.id)?.midiClips || [];
      if (clips.length > 0) clipId = clips[0].id;
    }
    return clipId;
  })

  // Auto seed some drum samples into Asset Pool on first load
  useEffect(() => {
    const t = setTimeout(() => {
      const st = useProjectStore.getState();
      if ((st.assets || []).length < 3) st.seedDemoAssets();
    }, 650);
    return () => clearTimeout(t);
  }, []);

  // Resume AudioContext on first user gesture (fixes "not allowed to start" autoplay policy)
  useEffect(() => {
    const resume = () => {
      (audioEngine as any).resumeContext?.();
      // also unlock on transport etc.
    };
    const opts = { once: true } as any;
    window.addEventListener('click', resume, opts);
    window.addEventListener('keydown', resume, opts);
    return () => {
      window.removeEventListener('click', resume as any);
      window.removeEventListener('keydown', resume as any);
    };
  }, []);

  // Sidebar toggles: allow completely hiding left (tracks) and right (pools) sidebars via top menu buttons
  const [showTrackList, setShowTrackList] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)

  const { user, isCloudEnabled, signInAnonymously, signOut, signInWithEmail, signUpWithEmail, loading: authLoading } = useAuthStore()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    if (user?.id) {
      useProjectStore.getState().initRealtime(user.id);

      // Polish: try to load latest from cloud on sign-in
      useProjectStore.getState().loadSavedProject(user.id).then((ok) => {
        if (ok) {}
      });
    }
  }, [user?.id])

  const handleDragEnd = (event: any) => {
    const { active, over } = event
    if (active.id !== over?.id) {
      const oldIndex = project.tracks.findIndex(t => t.id === active.id)
      const newIndex = project.tracks.findIndex(t => t.id === over.id)
      useProjectStore.getState().reorderTracks(oldIndex, newIndex)
    }
  }

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
    toggleLoop,
    assets,
    removeAsset,
    addClipFromAsset
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
      (track.midiClips || []).forEach((clip: any) => {
        max = Math.max(max, clip.startBeat + (clip.durationBeats || 1) + 8);
      });
    });
    return max;
  }, [project]);

  // Musical structure for ruler and bar lines (from project, default 4/4)
  const beatsPerBar = project.timeSignature?.[0] || 4;

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
    if (!file) return
    // Upload goes to Asset Pool (virtual folder), then drag-drop to tracks
    await useProjectStore.getState().addAsset(file)
    e.target.value = ''
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const toggleMixer = () => {
    const next = !showMixer
    setShowMixer(next)

  }

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
        // (toasts removed)
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        useProjectStore.getState().saveProjectNow(user?.id);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        useProjectStore.getState().newProject();

      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        useProjectStore.getState().exportProject();
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

        } else if (!inInput && key === 'm') {
          e.preventDefault();
          toggleMixer();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true); // capture so it can override input handling
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedClipIds, deleteSelectedClips, clearSelection, user?.id, zoomTimeline, toggleLoop, toggleMixer])

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
        const trackTop = trackIdx * TRACK_HEIGHT;
        const trackBottom = trackTop + TRACK_HEIGHT;

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

  // Timeline drives the arranger. All engine features (mix, fades, inserts) wired for easy use.

  return (
    <div className="daw-app text-text">
      {/* Top Menu Bar - clean horizontal like Windows app, sharing line with transport controls */}
      <div className="flex items-center gap-2 px-2 py-1 bg-[#0f172a] border-b border-[#334155] text-[11px]">
        <div className="flex items-center gap-1.5">
          <button onClick={toggleMixer} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            {showMixer ? '✕ Mixer' : 'Mixer'}
          </button>
          <button 
            onClick={() => {
              const store = useProjectStore.getState();
              let track = project.tracks.find(t => t.midiClips && t.midiClips.length > 0);
              if (!track) {
                track = project.tracks.find(t => t.type === 'instrument' || t.type === 'midi');
              }
              if (!track) {
                store.addTrackOfType('instrument');
                track = store.project.tracks.find(t => t.type === 'instrument');
              }
              if (track) {
                if (!track.midiClips || track.midiClips.length === 0) {
                  store.addMidiClip(track.id, currentBeat, 4);
                }
                const clips = (store.project.tracks.find(t => t.id === track.id)?.midiClips) || [];
                if (clips.length > 0) {
                  setOpenPianoRollClipId(clips[0].id);
      
                }
              }
            }}
            className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]"
            title="Open Piano Roll for MIDI editing (or double-click MIDI clips)"
          >
            🎹 Piano Roll
          </button>
          <button onClick={() => setShowRightSidebar(!showRightSidebar)} className="px-2 py-1 rounded text-xs border border-[#475569] hover:bg-[#334155]">
            {showRightSidebar ? 'HIDE POOLS' : 'POOLS'}
          </button>
          <button 
            onClick={() => setShowTrackList(v => !v)} 
            className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569] text-[10px]"
            title="Toggle left track column (completely hide)"
          >
            {showTrackList ? '◀ Tracks' : 'Tracks ▶'}
          </button>
          <button 
            onClick={() => setShowRightSidebar(v => !v)} 
            className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569] text-[10px]"
            title="Toggle right pools sidebar (completely hide)"
          >
            {showRightSidebar ? 'Pools ▶' : '◀ Pools'}
          </button>
          <button onClick={handleUploadClick} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            ⬆ Upload
          </button>
          <button onClick={() => {
            const firstAudio = project.tracks.find(t => t.type === 'audio');
            if (firstAudio) { addTestTone(firstAudio.id); }
          }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Test Tone
          </button>
          <button onClick={() => { useProjectStore.getState().newProject() }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            New
          </button>
          <button onClick={() => {
            useProjectStore.getState().saveProjectNow(user?.id).then((mode) => {

            });
          }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Save
          </button>
          <button onClick={async () => {
            const ok = await useProjectStore.getState().loadSavedProject(user?.id);

          }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Load
          </button>
          <button onClick={() => { useProjectStore.getState().loadDemoProject() }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569] text-amber-400">
            Load Demo
          </button>
          <button onClick={() => useProjectStore.getState().seedDemoAssets()} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Drum Samples
          </button>
          <button onClick={() => useProjectStore.getState().loadSimpleDrumBeat()} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569] text-amber-400">
            Make Beat
          </button>
          <button onClick={() => useProjectStore.getState().exportProject()} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569] text-emerald-400">
            ⬇ Export Mix
          </button>
          <button onClick={() => {
            project.tracks.forEach(t => {
              if (t.audioClips && t.audioClips.length > 0) {
                t.audioClips.forEach(c => {
                  useProjectStore.getState().updateClipFade(t.id, c.id, {
                    fadeInMs: 60 + Math.random()*40, 
                    fadeOutMs: 80 + Math.random()*60,
                    fadeInCurve: 's-curve',
                    fadeOutCurve: 's-curve'
                  });
                });
              }
            });

          }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Demo Fades
          </button>
          <button onClick={() => {
            selectedClipIds.forEach(cid => {
              project.tracks.forEach(t => {
                if (t.audioClips?.some(c => c.id === cid)) {
                  useProjectStore.getState().updateClipFade(t.id, cid, {fadeInMs: 80, fadeOutMs: 120, fadeInCurve: 's-curve', fadeOutCurve: 's-curve'});
                }
              });
            });

          }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Quick Fade Sel
          </button>
          <button onClick={() => {
            project.tracks.forEach(t => useProjectStore.getState().autoCrossfade(t.id));

          }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            Auto X-Fade All
          </button>
          <button onClick={() => { addTrackOfType('audio') }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            + Audio
          </button>
          <button onClick={() => { addTrackOfType('midi') }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            + MIDI
          </button>
          <button onClick={() => { addTrackOfType('instrument') }} className="px-2 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">
            + Inst
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[10px]">
          {isCloudEnabled ? (
            user ? (
              <>
                <span className="text-emerald-400">☁ {user.email || 'Guest'}</span>
                <button onClick={() => signOut()} className="px-1.5 py-0.5 rounded hover:bg-[#334155] border border-[#475569]">Sign out</button>
              </>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  type="email"
                  placeholder="email"
                  className="w-28 text-[10px] bg-[#1f2937] border border-[#475569] rounded px-1 py-0.5"
                  id="auth-email"
                  defaultValue=""
                />
                <input
                  type="password"
                  placeholder="pass"
                  className="w-20 text-[10px] bg-[#1f2937] border border-[#475569] rounded px-1 py-0.5"
                  id="auth-pass"
                  defaultValue=""
                />
                <button
                  disabled={authLoading}
                  onClick={async () => {
                    const emailEl = document.getElementById('auth-email') as HTMLInputElement;
                    const passEl = document.getElementById('auth-pass') as HTMLInputElement;
                    const email = emailEl?.value?.trim();
                    const pass = passEl?.value;
                    if (!email || !pass) { return; }
                    try {
                      await signInWithEmail(email, pass);
                    } catch (e: any) { }
                  }}
                  className="text-[9px] px-1.5 py-0.5 border border-[#475569] hover:bg-[#334155]"
                >Sign in</button>
                <button
                  disabled={authLoading}
                  onClick={async () => {
                    const emailEl = document.getElementById('auth-email') as HTMLInputElement;
                    const passEl = document.getElementById('auth-pass') as HTMLInputElement;
                    const email = emailEl?.value?.trim();
                    const pass = passEl?.value;
                    if (!email || !pass) { return; }
                    try {
                      await signUpWithEmail(email, pass);
                    } catch (e: any) { }
                  }}
                  className="text-[9px] px-1.5 py-0.5 border border-[#475569] hover:bg-[#334155]"
                >Sign up</button>
                <button
                  disabled={authLoading}
                  onClick={() => signInAnonymously()}
                  className="text-[9px] px-1 py-0.5 text-cyan-400"
                >or guest</button>
              </div>
            )
          ) : (
            <span className="text-zinc-500" title="Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env">Local mode</span>
          )}
          <span className="text-muted">Jaydee</span>
        </div>
      </div>

      {/* Transport (now cleaner, balanced) */}
      <Transport 
        onZoomOut={() => zoomTimeline(1 / 1.2)}
        onZoomIn={() => zoomTimeline(1.2)}
        onGoToZero={() => useProjectStore.getState().seek(0)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Main Layout - clean row: tracks + timeline (always visible core) + optional pools */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Track list (toggleable but default on) */}
        {showTrackList && (
          <div style={{ width: 300, flexShrink: 0 }} className="flex flex-col h-full bg-[#1f2937] border-r border-[#334155]">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={project.tracks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div 
                  ref={trackListRef}
                  className="track-list"
                  onScroll={() => syncScroll(trackListRef, timelineRef)}
                  style={{ flex: 1, overflowY: 'auto', width: '100%' }}
                >
                  <div className="top-spacer" />
                  {project.tracks.map((track, idx) => (
                    <TrackListItem
                      key={track.id}
                      track={track}
                      index={idx}
                      isSelected={selectedClipIds.includes(track.id)}
                      onSelect={() => selectClip(track.id)}
                      onGainChange={(g) => useProjectStore.getState().setTrackGain(track.id, g)}
                      onPanChange={(p) => useProjectStore.getState().setTrackPan(track.id, p)}
                      onToggleMute={() => useProjectStore.getState().toggleMute(track.id)}
                      onToggleSolo={() => useProjectStore.getState().toggleSolo(track.id)}
                      onToggleWrite={() => {
                        useProjectStore.getState().toggleAutomationWrite(track.id);
                        const writing = useProjectStore.getState().project.tracks.find(t => t.id === track.id)?.automationWrite;

                      }}
                      onRemove={() => { useProjectStore.getState().removeTrack(track.id) }}
                      onOpenMixer={() => setShowMixer(true)}
                      onOpenPianoRoll={(clipId) => {
                        if (clipId) setOpenPianoRollClipId(clipId);
                        else {
                          const t = project.tracks.find(tt => tt.midiClips && tt.midiClips.length > 0);
                          if (t?.midiClips?.[0]) setOpenPianoRollClipId(t.midiClips[0].id);
                        }
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Timeline - the core arranger, should always be visible */}
        <div 
          ref={timelineRef}
          className="timeline"
          style={{ flex: 1, minWidth: 0, background: '#0f172a' }}
          onScroll={() => syncScroll(timelineRef, trackListRef)}
        >
          <Timeline
            tracks={project.tracks}
            currentBeat={currentBeat}
            beatWidth={beatWidth}
            requiredBeats={requiredBeats}
            selectedClipIds={selectedClipIds}
            onClipMouseDown={handleClipMouseDown}
            onClipClick={(clipId) => selectClip(clipId)}
            onResizeStart={handleResizeMouseDown}
            onMidiDoubleClick={(clipId) => setOpenPianoRollClipId(clipId)}
            onFadeEdit={(clipId) => {}}
            isQuantizeOn={isQuantizeOn}
            quantize={quantize}
            loopEnabled={loopEnabled}
            loopStart={loopStart}
            loopEnd={loopEnd}
            onScrubStart={handleScrubStart}
            onLoopRegionDragStart={handleLoopRegionDragStart}
          />
        </div>

        {/* Right pools (toggleable) */}
        {showRightSidebar && (
          <div style={{ width: 200, flexShrink: 0 }} className="flex flex-col h-full bg-[#1f2937] border-l border-[#334155] overflow-hidden text-[10px]">
            <div className="p-1 border-b border-[#334155] bg-[#111827]">Asset Pool (drag to tracks/timeline)</div>
            <div className="flex-1 overflow-auto p-1">
              {assets.length === 0 && <div className="text-muted text-[9px]">Upload or Demo</div>}
              {assets.map(asset => (
                <div
                  key={asset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'asset', id: asset.id }));
                  }}
                  className="text-[9px] truncate mb-0.5 bg-[#1f2937] rounded px-1 py-0.5 cursor-grab active:cursor-grabbing hover:bg-[#374151] flex justify-between items-center"
                  title={`Drag to timeline or track to add clip`}
                >
                  <span className="truncate">{asset.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const target = project.tracks.find(t => t.type === 'audio') || project.tracks[0];
                      if (target) useProjectStore.getState().addClipFromAsset(target.id, asset.id, currentBeat);
                    }}
                    className="text-[8px] px-1 text-cyan-400 hover:text-cyan-300"
                    title="Add to first audio track at playhead"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
            <div className="p-1 border-t border-[#334155] bg-[#111827]">Plugin Pool (drag to tracks)</div>
            <div className="flex-1 overflow-auto p-1">
              {['eq3band','compressor','drive','delay'].map(t => (
                <div
                  key={t}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'plugin', pluginType: t }));
                  }}
                  className="text-[9px] mb-0.5 bg-[#1f2937] rounded px-1 py-0.5 cursor-grab active:cursor-grabbing hover:bg-[#374151] flex justify-between items-center"
                  title={`Drag to track to add as insert`}
                >
                  <span>{t}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const first = project.tracks[0];
                      if (first) {
                        const params = t === 'eq3band' ? {lowGain:0,midGain:0,highGain:0} :
                          t === 'compressor' ? {threshold:-24,ratio:4,attack:0.003,release:0.25} :
                          t === 'drive' ? {amount:2.5} : {time:0.25,feedback:0.3,wet:0.2};
                        useProjectStore.getState().addInsert(first.id, {type: t as any, params});
    
                      }
                    }}
                    className="text-[8px] px-1 text-cyan-400 hover:text-cyan-300"
                    title="Add to first track"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Mixer open={showMixer} onClose={() => setShowMixer(false)} />

      {openPianoRollClipId && (
        <PianoRoll 
          clipId={openPianoRollClipId} 
          onClose={() => setOpenPianoRollClipId(null)} 
        />
      )}

      {/* Minimal bottom status (toggle lives in left track-list area for minimal diff) */}
      <div className="h-5 bg-[#0f172a] border-t border-[#334155] text-[9px] px-3 flex items-center text-text-muted">
        Jaydee • {project.tempo} BPM • Local • SignalChain v2 (Inserts + Master Bus)
        <button onClick={toggleMixer} className="ml-3 px-1.5 py-px text-[9px] border border-[#475569] hover:bg-[#334155] rounded">{showMixer ? '✕ Mixer' : 'Mixer'}</button>
      </div>

    </div>
  )
}

export default App
