import { create } from 'zustand';
import type { Project, Track, AudioClip, MidiClip, MidiNote, PluginInstance } from '../lib/types';
import { audioEngine } from '../audio/AudioEngine';
import { synthEngine } from '../audio/SynthEngine';

// Default project with multiple tracks for realistic demo
const defaultProject: Project = {
  id: 'local-demo',
  name: 'My First Song',
  tempo: 120,
  timeSignature: [4, 4],
  tracks: [
    {
      id: 't1',
      type: 'audio',
      name: '808 Hats',
      gain: 0.85,
      pan: 0,
      muted: false,
      soloed: false,
      inserts: [
        // Demo insert to show the new signal chain immediately
        { id: 'demo-eq', type: 'eq3band', params: { lowGain: 2, midGain: -1.5, highGain: 1 }, bypass: false }
      ],
      audioClips: [
        { id: 'c1', storagePath: 'demo:808hats', startBeat: 0, durationBeats: 4, offsetBeats: 0 },
        { id: 'c2', storagePath: 'demo:808hats', startBeat: 4, durationBeats: 4, offsetBeats: 0 },
      ],
    },
    {
      id: 't2',
      type: 'audio',
      name: 'Kick',
      gain: 0.92,
      pan: 0,
      muted: false,
      soloed: false,
      inserts: [],
      audioClips: [
        { id: 'c3', storagePath: 'demo:kick', startBeat: 0, durationBeats: 1, offsetBeats: 0 },
        { id: 'c4', storagePath: 'demo:kick', startBeat: 4, durationBeats: 1, offsetBeats: 0 },
      ],
    },
    {
      id: 't3',
      type: 'audio',
      name: 'Big Compressed Drums',
      gain: 0.78,
      pan: 0,
      muted: false,
      soloed: false,
      inserts: [],
      audioClips: [
        { id: 'c5', storagePath: 'demo:drums', startBeat: 0, durationBeats: 8, offsetBeats: 0 },
      ],
    },
    {
      id: 't4',
      type: 'instrument',
      name: 'Moog Bass',
      gain: 0.82,
      pan: -0.08,
      muted: false,
      soloed: false,
      inserts: [],
      audioClips: [],
      midiClips: [
        {
          id: 'm1',
          startBeat: 0,
          durationBeats: 8,
          notes: [
            { id: 'n1', pitch: 48, startBeat: 0, durationBeats: 1.5, velocity: 95 },
            { id: 'n2', pitch: 55, startBeat: 2, durationBeats: 1, velocity: 80 },
            { id: 'n3', pitch: 60, startBeat: 4, durationBeats: 2, velocity: 100 },
            { id: 'n4', pitch: 52, startBeat: 6, durationBeats: 1.5, velocity: 85 },
          ],
        },
      ],
    },
  ],
};

interface ProjectState {
  project: Project;
  isPlaying: boolean;
  currentBeat: number;
  selectedClipIds: string[];
  history: Project[];
  future: Project[];

  // Transport
  setTempo: (bpm: number) => void;
  togglePlay: () => void;
  stop: () => void;

  // Tracks & Clips
  addTrack: (track: Track) => void;
  addTrackOfType: (type: TrackType, name?: string) => void;
  updateTrack: (trackId: string, changes: Partial<Track>) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  addAudioClip: (trackId: string, file: File) => Promise<void>;
  addTestTone: (trackId: string) => Promise<void>;

  // Mix / Inserts (signal chain)
  addInsert: (trackId: string, plugin: Omit<PluginInstance, 'id'>) => void;
  updateInsert: (trackId: string, insertId: string, params: Record<string, number>) => void;
  removeInsert: (trackId: string, insertId: string) => void;
  reorderInsert: (trackId: string, fromIndex: number, toIndex: number) => void;
  loadDemoMixChain: () => void;
  setMasterGain: (gain: number) => void;

  // Metering (polled from UI)
  getTrackMeter: (trackId: string) => { peak: number; rms: number };
  getMasterMeter: () => { peak: number; rms: number };

  // MIDI
  addMidiClip: (trackId: string, startBeat?: number, durationBeats?: number) => void;
  addNote: (clipId: string, pitch: number, startBeat: number, durationBeats: number, velocity?: number) => void;
  updateNote: (clipId: string, noteId: string, changes: Partial<MidiNote>) => void;
  deleteNote: (clipId: string, noteId: string) => void;
  getMidiClip: (clipId: string) => MidiClip | null;

  // Core editing (big picture focus)
  moveClip: (trackId: string, clipId: string, newStartBeat: number) => void;
  resizeClip: (trackId: string, clipId: string, newDurationBeats: number, newStartBeat?: number, newOffsetBeats?: number) => void;
  deleteClip: (trackId: string, clipId: string) => void;
  selectClip: (clipId: string) => void;           // single click: replace selection
  toggleClipSelection: (clipId: string) => void;  // for future ctrl-click
  setSelectedClipIds: (ids: string[]) => void;    // for box selection
  deleteSelectedClips: () => void;                // delete all selected
  clearSelection: () => void;
  pushHistory: () => void;
  quantize: number;
  setQuantize: (q: number) => void;
  isQuantizeOn: boolean;
  toggleQuantize: () => void;
  clipboard: Array<{trackId: string, clip: AudioClip}>;
  copySelectedClips: () => void;
  pasteClips: (targetBeat?: number | null) => void;
  duplicateSelectedClips: (skipHistory?: boolean) => void;

  // Internal helpers
  setCurrentBeat: (beat: number) => void;
  refreshPlayback: () => void;
  seek: (beat: number) => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  audioEngine.subscribeToPosition((beat) => {
    set({ currentBeat: Math.max(0, beat) });
  });

  const getEffectiveGain = (track: Track): number => {
    const latest = get().project.tracks.find(t => t.id === track.id) || track;
    if (latest.muted) return 0;
    const anySolo = get().project.tracks.some(t => t.soloed);
    if (anySolo && !latest.soloed) return 0;
    return Math.max(0, Math.min(2, latest.gain));
  };

  const refreshPlayback = () => {
    const { isPlaying, project } = get();
    if (!isPlaying) return;

    audioEngine.stop();
    audioEngine.play(get().currentBeat);

    // Re-ensure channels + inserts on refresh (keeps mix bus alive)
    project.tracks.forEach(t => {
      audioEngine.ensureChannel?.(t.id);
      audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
      audioEngine.setTrackFader?.(t.id, getEffectiveGain(t));
      audioEngine.setTrackPan?.(t.id, t.pan);
      audioEngine.setTrackMute?.(t.id, t.muted);
    });

    project.tracks.forEach((track) => {
      if (track.type !== 'audio' || !track.audioClips) return;
      const eff = getEffectiveGain(track);
      track.audioClips.forEach((clip) => {
        if (clip.storagePath.startsWith('local:')) {
          const audioId = clip.storagePath.replace('local:', '');
          audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id);
        } else if (clip.storagePath.startsWith('demo:')) {
          audioEngine.scheduleClip(clip.storagePath, clip.startBeat, clip.offsetBeats, eff, track.id);
        }
      });
    });

    // MIDI reschedule on refresh
    const psb = audioEngine.getPlayStartBeat?.() ?? get().currentBeat;
    const pst = audioEngine.getPlayStartTime?.() ?? 0;
    synthEngine.stopAll();
    synthEngine.setTempo(project.tempo);

    project.tracks.forEach((track) => {
      if (!track.midiClips) return;
      const target = audioEngine.getTrackInput?.(track.id) || undefined;
      track.midiClips.forEach((clip) => {
        clip.notes.forEach((note) => {
          const abs = clip.startBeat + note.startBeat;
          synthEngine.scheduleNote(note.pitch, note.velocity, abs, note.durationBeats, psb, pst, 1.0, target);
        });
      });
    });
  };

  return {
    project: defaultProject,
    isPlaying: false,
    currentBeat: 0,
    selectedClipIds: [],
    history: [],
    future: [],
    quantize: 1 / 4,
    setQuantize: (q) => set({ quantize: q }),
    isQuantizeOn: true,
    toggleQuantize: () => set((state) => ({ isQuantizeOn: !state.isQuantizeOn })),

    setTempo: (bpm) => {
      const clamped = Math.max(40, Math.min(300, bpm));
      set((state) => ({
        project: { ...state.project, tempo: clamped },
      }));
      audioEngine.setTempo(clamped);
      synthEngine.setTempo(clamped);
    },

    togglePlay: async () => {
      const { isPlaying, currentBeat, project } = get();

      if (!isPlaying) {
        await audioEngine.play(currentBeat);
        set({ isPlaying: true });

        // Prepare signal chain for all tracks (channel strips + master bus)
        project.tracks.forEach(t => {
          audioEngine.ensureChannel?.(t.id);
          audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
          // Apply current mix state
          audioEngine.setTrackFader?.(t.id, getEffectiveGain(t));
          audioEngine.setTrackPan?.(t.id, t.pan);
          audioEngine.setTrackMute?.(t.id, t.muted);
        });

        // Schedule audio clips
        project.tracks.forEach((track) => {
          if (track.type !== 'audio' || !track.audioClips) return;
          const eff = getEffectiveGain(track);
          track.audioClips.forEach((clip) => {
            if (clip.storagePath.startsWith('local:')) {
              const audioId = clip.storagePath.replace('local:', '');
              audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id);
            } else if (clip.storagePath.startsWith('demo:')) {
              audioEngine.scheduleClip(clip.storagePath, clip.startBeat, clip.offsetBeats, eff, track.id);
            }
          });
        });

        // Schedule MIDI notes from instrument/midi tracks
        const playStartBeat = audioEngine.getPlayStartBeat?.() ?? get().currentBeat;
        const playStartTime = audioEngine.getPlayStartTime?.() ?? 0;
        synthEngine.setTempo(project.tempo);
        synthEngine.stopAll();

        project.tracks.forEach((track) => {
          if (!track.midiClips) return;
          const target = audioEngine.getTrackInput?.(track.id) || undefined;
          track.midiClips.forEach((clip) => {
            clip.notes.forEach((note) => {
              const noteAbsStart = clip.startBeat + note.startBeat;
              const dur = note.durationBeats;
              synthEngine.scheduleNote(
                note.pitch,
                note.velocity,
                noteAbsStart,
                dur,
                playStartBeat,
                playStartTime,
                1.0,   // gain handled by channel strip fader now
                target
              );
            });
          });
        });
      } else {
        audioEngine.stop();
        set({ isPlaying: false });
      }
    },

    stop: () => {
      audioEngine.stop();
      synthEngine.stopAll();
      set({ isPlaying: false });
    },

    addTrack: (track) =>
      set((state) => ({
        project: {
          ...state.project,
          tracks: [...state.project.tracks, track],
        },
      })),

    addTrackOfType: (type, name) => {
      get().pushHistory();
      const baseName = name || (type === 'audio' ? 'Audio Track' : type === 'instrument' ? 'Instrument' : 'MIDI Track');
      const count = get().project.tracks.filter(t => t.type === type).length + 1;
      const newTrack: Track = {
        id: crypto.randomUUID(),
        type,
        name: `${baseName} ${count}`,
        gain: 0.85,
        pan: 0,
        muted: false,
        soloed: false,
        inserts: [],
        audioClips: type === 'audio' ? [] : undefined,
        midiClips: (type === 'instrument' || type === 'midi') ? [] : undefined,
      };
      set((state) => ({
        project: { ...state.project, tracks: [...state.project.tracks, newTrack] }
      }));

      // Prepare channel strip immediately (lazy safe)
      audioEngine.ensureChannel?.(newTrack.id);
      audioEngine.rebuildTrackInserts?.(newTrack.id, []);
    },

    updateTrack: (trackId, changes) => {
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map(t =>
            t.id === trackId ? { ...t, ...changes } : t
          )
        }
      }));

      // Live mix updates via engine nodes when available (high-end mix foundation)
      const latest = get().project.tracks.find(t => t.id === trackId);
      if (latest) {
        audioEngine.setTrackFader?.(trackId, getEffectiveGain(latest));
        audioEngine.setTrackPan?.(trackId, latest.pan);
        audioEngine.setTrackMute?.(trackId, latest.muted);
      }

      // Full reschedule only if necessary (mute/solo changes affect scheduling)
      const needsReschedule = 'muted' in changes || 'soloed' in changes;
      if (needsReschedule && get().isPlaying) {
        get().refreshPlayback();
      }
    },

    toggleMute: (trackId) => {
      const track = get().project.tracks.find(t => t.id === trackId);
      if (!track) return;
      get().updateTrack(trackId, { muted: !track.muted });
    },

    toggleSolo: (trackId) => {
      const { project } = get();
      const track = project.tracks.find(t => t.id === trackId);
      if (!track) return;

      const willSolo = !track.soloed;
      // Classic solo behavior: toggle this one; if turning on solo, others remain as-is
      get().updateTrack(trackId, { soloed: willSolo });
    },

    setTrackGain: (trackId, gain) => {
      const clamped = Math.max(0, Math.min(2, gain));
      get().updateTrack(trackId, { gain: clamped });
    },

    setTrackPan: (trackId, pan) => {
      const clamped = Math.max(-1, Math.min(1, pan));
      get().updateTrack(trackId, { pan: clamped });
    },

    // === Mix Signal Chain: Inserts + Master ===
    addInsert: (trackId, plugin) => {
      // Smart defaults for different insert types
      let defaultParams = { ...plugin.params };
      if (plugin.type === 'eq3band' && Object.keys(defaultParams).length === 0) {
        defaultParams = { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 250, midFreq: 1000, highFreq: 4000 };
      }
      if (plugin.type === 'compressor' && Object.keys(defaultParams).length === 0) {
        defaultParams = { threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 30 };
      }
      if (plugin.type === 'gain' && Object.keys(defaultParams).length === 0) {
        defaultParams = { gain: 1.0 };
      }

      const newInsert: PluginInstance = {
        id: crypto.randomUUID(),
        type: plugin.type,
        params: defaultParams,
        bypass: false,
      };

      set((state) => {
        const tracks = state.project.tracks.map(t =>
          t.id === trackId
            ? { ...t, inserts: [...t.inserts, newInsert] }
            : t
        );
        return { project: { ...state.project, tracks } };
      });

      // Rebuild signal chain live
      const track = get().project.tracks.find(t => t.id === trackId);
      if (track) {
        audioEngine.rebuildTrackInserts?.(trackId, track.inserts);
      }
    },

    updateInsert: (trackId, insertId, params) => {
      set((state) => {
        const tracks = state.project.tracks.map(t => {
          if (t.id !== trackId) return t;
          return {
            ...t,
            inserts: t.inserts.map(ins => {
              if (ins.id !== insertId) return ins;
              const newParams = { ...ins.params, ...params };
              // Normalize bypass if provided as number
              let bypass = ins.bypass;
              if ('bypass' in params) {
                bypass = !!params.bypass || (params.bypass as any) === 1;
              }
              return { ...ins, params: newParams, bypass };
            })
          };
        });
        return { project: { ...state.project, tracks } };
      });

      const track = get().project.tracks.find(t => t.id === trackId);
      if (track) {
        audioEngine.rebuildTrackInserts?.(trackId, track.inserts);
      }
    },

    removeInsert: (trackId, insertId) => {
      set((state) => {
        const tracks = state.project.tracks.map(t =>
          t.id === trackId
            ? { ...t, inserts: t.inserts.filter(i => i.id !== insertId) }
            : t
        );
        return { project: { ...state.project, tracks } };
      });

      const track = get().project.tracks.find(t => t.id === trackId);
      if (track) {
        audioEngine.rebuildTrackInserts?.(trackId, track.inserts);
      }
    },

    reorderInsert: (trackId, fromIndex, toIndex) => {
      set((state) => {
        const tracks = state.project.tracks.map(t => {
          if (t.id !== trackId) return t;
          const newInserts = [...t.inserts];
          const [moved] = newInserts.splice(fromIndex, 1);
          newInserts.splice(toIndex, 0, moved);
          return { ...t, inserts: newInserts };
        });
        return { project: { ...state.project, tracks } };
      });

      const track = get().project.tracks.find(t => t.id === trackId);
      if (track) {
        audioEngine.rebuildTrackInserts?.(trackId, track.inserts);
      }
    },

    setMasterGain: (gain) => {
      const clamped = Math.max(0, Math.min(2, gain));
      audioEngine.setMasterGain?.(clamped);
    },

    loadDemoMixChain: () => {
      get().pushHistory();
      const tracks = get().project.tracks;
      tracks.forEach((track, idx) => {
        const newInserts: PluginInstance[] = [];
        // Different chains per track type for demo
        if (track.type === 'audio') {
          newInserts.push({ id: crypto.randomUUID(), type: 'eq3band', params: { lowGain: 3, midGain: -2, highGain: 1.5, lowFreq: 200, midFreq: 800, highFreq: 5000 } });
          if (idx % 2 === 0) newInserts.push({ id: crypto.randomUUID(), type: 'compressor', params: { threshold: -18, ratio: 5, attack: 0.005, release: 0.2 } });
        } else {
          newInserts.push({ id: crypto.randomUUID(), type: 'eq3band', params: { lowGain: 1, midGain: 2, highGain: -1 } });
          newInserts.push({ id: crypto.randomUUID(), type: 'compressor', params: { threshold: -22, ratio: 3.5, attack: 0.002, release: 0.15 } });
        }
        // Update directly
        const updatedTracks = get().project.tracks.map(t => t.id === track.id ? { ...t, inserts: newInserts } : t);
        // We need to set, but to avoid multiple sets, do in one go outside loop ideally. For demo ok.
      });

      // Better: set once
      const demoTracks = tracks.map((track, idx) => {
        const ins: PluginInstance[] = [];
        if (track.type === 'audio') {
          ins.push({ id: crypto.randomUUID(), type: 'eq3band', params: { lowGain: 3 + idx, midGain: -2, highGain: 1.5 } });
          if (idx % 2 === 0) ins.push({ id: crypto.randomUUID(), type: 'compressor', params: { threshold: -18, ratio: 5 } });
        } else {
          ins.push({ id: crypto.randomUUID(), type: 'eq3band', params: { lowGain: 1, midGain: 2, highGain: -1 } });
          ins.push({ id: crypto.randomUUID(), type: 'compressor', params: { threshold: -22, ratio: 4 } });
        }
        return { ...track, inserts: ins };
      });

      set((state) => ({ project: { ...state.project, tracks: demoTracks } }));

      // Rebuild all chains
      demoTracks.forEach(t => {
        audioEngine.ensureChannel?.(t.id);
        audioEngine.rebuildTrackInserts?.(t.id, t.inserts);
      });
    },

    getTrackMeter: (trackId) => {
      return audioEngine.getTrackMeter?.(trackId) || { peak: 0, rms: 0 };
    },

    getMasterMeter: () => {
      return audioEngine.getMasterMeter?.() || { peak: 0, rms: 0 };
    },

    addAudioClip: async (trackId: string, file: File) => {
      const loaded = await audioEngine.loadAudio(file);
      const tempo = get().project.tempo;

      const newClip: AudioClip = {
        id: crypto.randomUUID(),
        storagePath: `local:${loaded.id}`,
        startBeat: 0,
        durationBeats: (loaded.duration * tempo) / 60,
        offsetBeats: 0,
      };

      set((state) => {
        const tracks = state.project.tracks.map((track) =>
          track.id === trackId
            ? { ...track, audioClips: [...(track.audioClips || []), newClip] }
            : track
        );
        return { project: { ...state.project, tracks } };
      });

      // If currently playing, schedule the new clip right away (from current position)
      if (get().isPlaying) {
        const tr = get().project.tracks.find(t => t.id === trackId);
        const eff = tr ? getEffectiveGain(tr) : 0.85;
        audioEngine.scheduleClip(loaded.id, newClip.startBeat, newClip.offsetBeats, eff, trackId);
      }
    },

    addTestTone: async (trackId: string) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const sampleRate = audioContext.sampleRate;
      const duration = 0.8;
      const length = Math.floor(sampleRate * duration);
      const buffer = audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 4) * 0.7;
      }

      const id = crypto.randomUUID();
      audioEngine.registerBuffer(id, 'Test Tone', buffer, duration);

      const tempo = get().project.tempo;
      const newClip: AudioClip = {
        id: crypto.randomUUID(),
        storagePath: `local:${id}`,
        startBeat: 0,
        durationBeats: (duration * tempo) / 60,
        offsetBeats: 0,
      };

      set((state) => {
        const tracks = state.project.tracks.map((track) =>
          track.id === trackId
            ? { ...track, audioClips: [...(track.audioClips || []), newClip] }
            : track
        );
        return { project: { ...state.project, tracks } };
      });

      // Live schedule if playing
      if (get().isPlaying) {
        const tr = get().project.tracks.find(t => t.id === trackId);
        const eff = tr ? getEffectiveGain(tr) : 0.85;
        audioEngine.scheduleClip(id, newClip.startBeat, newClip.offsetBeats, eff, trackId);
      }
    },

    // === Big Picture Editing ===
    moveClip: (trackId, clipId, newStartBeat) => {
      const { quantize, isQuantizeOn } = get();
      let snapped = newStartBeat;
      if (isQuantizeOn && quantize > 0) {
        snapped = Math.max(0, Math.round(newStartBeat / quantize) * quantize);
      }

      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (track.id !== trackId) return track;

          // Audio clips
          if (track.audioClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              audioClips: track.audioClips.map((clip) =>
                clip.id === clipId ? { ...clip, startBeat: snapped } : clip
              ),
            };
          }

          // MIDI clips
          if (track.midiClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              midiClips: track.midiClips.map((clip) =>
                clip.id === clipId ? { ...clip, startBeat: snapped } : clip
              ),
            };
          }
          return track;
        });
        return { project: { ...state.project, tracks } };
      });
      // NOTE: Do not auto-refresh during drag — it restarts audio.
      // Playback will use the updated positions on next play/stop cycle.
    },

    resizeClip: (trackId, clipId, newDurationBeats, newStartBeat, newOffsetBeats) => {
      const minDur = 0.25;
      const dur = Math.max(minDur, newDurationBeats);

      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (track.id !== trackId) return track;

          if (track.audioClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              audioClips: track.audioClips.map((clip) =>
                clip.id === clipId
                  ? {
                      ...clip,
                      durationBeats: dur,
                      startBeat: newStartBeat !== undefined ? Math.max(0, newStartBeat) : clip.startBeat,
                      offsetBeats: newOffsetBeats !== undefined ? Math.max(0, newOffsetBeats) : clip.offsetBeats,
                    }
                  : clip
              ),
            };
          }

          if (track.midiClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              midiClips: track.midiClips.map((clip) =>
                clip.id === clipId
                  ? {
                      ...clip,
                      durationBeats: Math.max(1, dur),
                      startBeat: newStartBeat !== undefined ? Math.max(0, newStartBeat) : clip.startBeat,
                    }
                  : clip
              ),
            };
          }
          return track;
        });
        return { project: { ...state.project, tracks } };
      });

      if (get().isPlaying) get().refreshPlayback();
    },

    deleteClip: (trackId, clipId) => {
      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (track.id !== trackId) return track;

          if (track.audioClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              audioClips: track.audioClips.filter((c) => c.id !== clipId),
            };
          }
          if (track.midiClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              midiClips: track.midiClips.filter((c) => c.id !== clipId),
            };
          }
          return track;
        });
        return { project: { ...state.project, tracks } };
      });
      // No auto restart during live edit
    },

    selectClip: (clipId) => set({ selectedClipIds: [clipId] }),

    toggleClipSelection: (clipId) => {
      const { selectedClipIds } = get();
      if (selectedClipIds.includes(clipId)) {
        set({ selectedClipIds: selectedClipIds.filter(id => id !== clipId) });
      } else {
        set({ selectedClipIds: [...selectedClipIds, clipId] });
      }
    },

    setSelectedClipIds: (ids) => set({ selectedClipIds: ids }),

    deleteSelectedClips: () => {
      const { selectedClipIds, project } = get();
      if (selectedClipIds.length === 0) return;

      get().pushHistory(); // record before change

      let updatedTracks = project.tracks;

      selectedClipIds.forEach(clipId => {
        updatedTracks = updatedTracks.map(track => {
          // audio
          if (track.audioClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              audioClips: track.audioClips.filter(c => c.id !== clipId)
            };
          }
          // midi
          if (track.midiClips?.some(c => c.id === clipId)) {
            return {
              ...track,
              midiClips: track.midiClips.filter(c => c.id !== clipId)
            };
          }
          return track;
        });
      });

      set({
        project: { ...project, tracks: updatedTracks },
        selectedClipIds: []
      });

      get().refreshPlayback();
    },

    clearSelection: () => set({ selectedClipIds: [] }),

    clipboard: [],

    copySelectedClips: () => {
      const st = get();
      const clips: Array<{trackId: string, clip: AudioClip}> = [];
      st.selectedClipIds.forEach(id => {
        st.project.tracks.forEach(t => {
          const c = (t.audioClips || []).find(c => c.id === id);
          if (c) {
            clips.push({ trackId: t.id, clip: JSON.parse(JSON.stringify(c)) });
          }
        });
      });
      set({ clipboard: clips });
    },

    pasteClips: (targetBeat = null) => {
      const st = get();
      if (!st.clipboard || st.clipboard.length === 0) return;
      st.pushHistory();
      const target = targetBeat !== null ? targetBeat : st.currentBeat;
      const quant = st.quantize;
      const minStart = Math.min(...st.clipboard.map(c => c.clip.startBeat));
      const snappedTarget = Math.round(target / quant) * quant;
      const newSelected: string[] = [];
      const updatedTracks = st.project.tracks.map(track => {
        const toPaste = st.clipboard.filter(c => c.trackId === track.id);
        if (toPaste.length === 0) return track;
        const newClips = toPaste.map(({clip}) => {
          const rel = clip.startBeat - minStart;
          let newStart = snappedTarget + rel;
          newStart = Math.round(newStart / quant) * quant;
          const newClip = {
            ...clip,
            id: crypto.randomUUID(),
            startBeat: newStart
          };
          newSelected.push(newClip.id);
          return newClip;
        });
        return {
          ...track,
          audioClips: [...(track.audioClips || []), ...newClips]
        };
      });
      set({
        project: { ...st.project, tracks: updatedTracks },
        selectedClipIds: newSelected
      });
      if (st.isPlaying) {
        st.refreshPlayback();
      }
    },

    duplicateSelectedClips: (skipHistory = false) => {
      const st = get();
      if (st.selectedClipIds.length === 0) return;
      if (!skipHistory) {
        st.pushHistory();
      }
      const newSelected: string[] = [];
      const updatedTracks = st.project.tracks.map(track => {
        let audioCopies = [];
        let midiCopies = [];
        st.selectedClipIds.forEach(id => {
          const aClip = (track.audioClips || []).find(c => c.id === id);
          if (aClip) {
            const copy = JSON.parse(JSON.stringify(aClip));
            copy.id = crypto.randomUUID();
            audioCopies.push(copy);
            newSelected.push(copy.id);
          }
          const mClip = (track.midiClips || []).find(c => c.id === id);
          if (mClip) {
            const copy = JSON.parse(JSON.stringify(mClip));
            copy.id = crypto.randomUUID();
            midiCopies.push(copy);
            newSelected.push(copy.id);
          }
        });
        return {
          ...track,
          audioClips: audioCopies.length > 0 ? [...(track.audioClips || []), ...audioCopies] : track.audioClips,
          midiClips: midiCopies.length > 0 ? [...(track.midiClips || []), ...midiCopies] : track.midiClips,
        };
      });
      set({
        project: { ...st.project, tracks: updatedTracks },
        selectedClipIds: newSelected
      });
      if (st.isPlaying) {
        st.refreshPlayback();
      }
    },

    setTrackGain: (trackId, gain) => {
      audioEngine.updateTrackGain(trackId, gain);
      set((state) => {
        const tracks = state.project.tracks.map(t =>
          t.id === trackId ? { ...t, gain } : t
        );
        return { project: { ...state.project, tracks } };
      });
    },

    setTrackPan: (trackId, pan) => {
      audioEngine.updateTrackPan(trackId, pan);
      set((state) => {
        const tracks = state.project.tracks.map(t =>
          t.id === trackId ? { ...t, pan } : t
        );
        return { project: { ...state.project, tracks } };
      });
    },

    resizeClip: (trackId, clipId, newStartBeat, newDurationBeats, newOffsetBeats) => {
      get().pushHistory();

      const quant = get().isQuantizeOn ? get().quantize : 0;
      let snappedStart = newStartBeat;
      if (quant > 0) {
        snappedStart = Math.max(0, Math.round(newStartBeat / quant) * quant);
      }
      const snappedDur = Math.max(0.1, newDurationBeats);

      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (track.id !== trackId || !track.audioClips) return track;
          return {
            ...track,
            audioClips: track.audioClips.map((clip) => {
              if (clip.id !== clipId) return clip;
              return {
                ...clip,
                startBeat: snappedStart,
                durationBeats: snappedDur,
                offsetBeats: newOffsetBeats !== undefined ? Math.max(0, newOffsetBeats) : clip.offsetBeats,
              };
            }),
          };
        });
        return { project: { ...state.project, tracks } };
      });

      get().refreshPlayback();
    },

    // === MIDI Support (Phase 3) ===  // Skipped in this session (parallel)
    addMidiClip: (trackId, startBeat = 0, durationBeats = 4) => {
      get().pushHistory();

      const newClip: MidiClip = {
        id: crypto.randomUUID(),
        startBeat: Math.max(0, Math.round(startBeat * 4) / 4),
        durationBeats: Math.max(1, durationBeats),
        notes: [],
      };

      set((state) => {
        const tracks = state.project.tracks.map((track) =>
          track.id === trackId
            ? { ...track, midiClips: [...(track.midiClips || []), newClip] }
            : track
        );
        return { project: { ...state.project, tracks } };
      });

      set({ selectedClipIds: [newClip.id] });
    },

    addNote: (clipId, pitch, startBeat, durationBeats, velocity = 90) => {
      const quant = get().quantize;
      const snappedStart = Math.round(startBeat / quant) * quant;
      const snappedDur = Math.max(quant, Math.round(durationBeats / quant) * quant);

      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (!track.midiClips) return track;
          return {
            ...track,
            midiClips: track.midiClips.map((clip) => {
              if (clip.id !== clipId) return clip;
              const newNote: MidiNote = {
                id: crypto.randomUUID(),
                pitch: Math.max(0, Math.min(127, Math.round(pitch))),
                startBeat: snappedStart,
                durationBeats: snappedDur,
                velocity,
              };
              return { ...clip, notes: [...clip.notes, newNote] };
            }),
          };
        });
        return { project: { ...state.project, tracks } };
      });
    },

    updateNote: (clipId, noteId, changes) => {
      const quant = get().quantize;
      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (!track.midiClips) return track;
          return {
            ...track,
            midiClips: track.midiClips.map((clip) => {
              if (clip.id !== clipId) return clip;
              return {
                ...clip,
                notes: clip.notes.map((note) => {
                  if (note.id !== noteId) return note;
                  const updated = { ...note, ...changes };
                  if (changes.startBeat !== undefined) {
                    updated.startBeat = Math.max(0, Math.round(changes.startBeat / quant) * quant);
                  }
                  if (changes.durationBeats !== undefined) {
                    updated.durationBeats = Math.max(quant / 2, Math.round(changes.durationBeats / quant) * quant);
                  }
                  return updated;
                }),
              };
            }),
          };
        });
        return { project: { ...state.project, tracks } };
      });
    },

    deleteNote: (clipId, noteId) => {
      set((state) => {
        const tracks = state.project.tracks.map((track) => {
          if (!track.midiClips) return track;
          return {
            ...track,
            midiClips: track.midiClips.map((clip) =>
              clip.id === clipId
                ? { ...clip, notes: clip.notes.filter((n) => n.id !== noteId) }
                : clip
            ),
          };
        });
        return { project: { ...state.project, tracks } };
      });
    },

    getMidiClip: (clipId) => {
      for (const track of get().project.tracks) {
        const found = (track.midiClips || []).find((c) => c.id === clipId);
        if (found) return found;
      }
      return null;
    },

    pushHistory: () => {
      const current = get().project;
      set((state) => ({
        history: [...state.history, JSON.parse(JSON.stringify(current))],
        future: [],
      }));
    },

    undo: () => {
      const { history, future, project } = get();
      if (history.length === 0) return;

      const previous = history[history.length - 1];
      const newHistory = history.slice(0, -1);

      set({
        project: JSON.parse(JSON.stringify(previous)),
        history: newHistory,
        future: [JSON.parse(JSON.stringify(project)), ...future],
        selectedClipIds: [],
      });

      if (get().isPlaying) {
        get().refreshPlayback();
      }
    },

    redo: () => {
      const { future, history, project } = get();
      if (future.length === 0) return;

      const next = future[0];
      const newFuture = future.slice(1);

      set({
        project: JSON.parse(JSON.stringify(next)),
        history: [...history, JSON.parse(JSON.stringify(project))],
        future: newFuture,
        selectedClipIds: [],
      });

      if (get().isPlaying) {
        get().refreshPlayback();
      }
    },

    // Helper to find trackId for a clipId
    // Helper kept for compatibility if needed elsewhere
  getTrackIdForClip: (clipId: string) => {
    const { project } = get();
    for (const track of project.tracks) {
      if (track.audioClips?.some((c) => c.id === clipId)) {
        return track.id;
      }
    }
    return null;
  },

    setCurrentBeat: (beat) => set({ currentBeat: beat }),

    seek: (beat: number) => {
      const { quantize, isQuantizeOn } = get();
      let targetBeat = beat;
      if (isQuantizeOn && quantize > 0) {
        targetBeat = Math.max(0, Math.round(beat / quantize) * quantize);
      }
      const clamped = Math.max(0, targetBeat);
      const wasPlaying = get().isPlaying;

      synthEngine.stopAll();

      if (wasPlaying) {
        audioEngine.stop();
        set({ currentBeat: clamped });
        // Resume from new position immediately
        audioEngine.play(clamped).then(() => {
          // Rebuild signal chain after seek
          let { project } = get();
          project.tracks.forEach(t => {
            audioEngine.ensureChannel?.(t.id);
            audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
            audioEngine.setTrackFader?.(t.id, getEffectiveGain(t));
            audioEngine.setTrackPan?.(t.id, t.pan);
            audioEngine.setTrackMute?.(t.id, t.muted);
          });

          set({ isPlaying: true });

          // Refresh project after the state update
          project = get().project;

          project.tracks.forEach((track) => {
            if (track.type !== 'audio' || !track.audioClips) return;
            const eff = getEffectiveGain(track);
            track.audioClips.forEach((clip) => {
              if (clip.storagePath.startsWith('local:')) {
                const audioId = clip.storagePath.replace('local:', '');
                audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id);
              } else if (clip.storagePath.startsWith('demo:')) {
                audioEngine.scheduleClip(clip.storagePath, clip.startBeat, clip.offsetBeats, eff, track.id);
              }
            });
          });

          // Reschedule MIDI
          const psb2 = audioEngine.getPlayStartBeat?.() ?? clamped;
          const pst2 = audioEngine.getPlayStartTime?.() ?? 0;
          project.tracks.forEach((track) => {
            if (!track.midiClips) return;
            const target = audioEngine.getTrackInput?.(track.id) || undefined;
            track.midiClips.forEach((clip) => {
              clip.notes.forEach((note) => {
                synthEngine.scheduleNote(note.pitch, note.velocity, clip.startBeat + note.startBeat, note.durationBeats, psb2, pst2, 1.0, target);
              });
            });
          });
        });
      } else {
        set({ currentBeat: clamped });
      }
    },

    refreshPlayback,
  };
});
