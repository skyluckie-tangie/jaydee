import { create } from 'zustand';
import type { Project, Track, AudioClip, MidiClip, MidiNote, PluginInstance, TrackType, Asset } from '../lib/types';
import { audioEngine } from '../audio/AudioEngine';
import { synthEngine } from '../audio/SynthEngine';
import {
  createEmptyProject,
  createDemoProject,
  createStarterBeatProject,
  DEFAULT_DEMO_ASSETS,
  projectHasAudioClips,
} from '../lib/defaultProject';
import { saveProject, loadProject, saveAutosave, uploadAudioAsset, isSupabaseConfigured } from '../lib/projectService';
import { exportAndDownload } from '../audio/ExportEngine';
import { broadcastClipMove, subscribeToProject } from '../lib/realtimeSync';
import { useAuthStore } from './useAuthStore';

const initialProject = loadProjectLocalSafe();

function loadProjectLocalSafe(): Project {
  try {
    const raw = localStorage.getItem('jaydee:project') || localStorage.getItem('jaydee:autosave');
    if (raw) {
      const parsed = JSON.parse(raw);
      const project = (parsed.project ?? parsed) as Project;
      // Upgrade old empty saves (deploy visitors who only had MIDI, no drums)
      if (projectHasAudioClips(project)) return project;
    }
  } catch { /* fall through */ }
  return createStarterBeatProject();
}

function bootstrapAudioForProject(project: Project) {
  audioEngine.ensureDemoSounds?.();
  project.tracks.forEach((t) => {
    audioEngine.ensureChannel?.(t.id);
    audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
  });
}

bootstrapAudioForProject(initialProject);

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeUnsub: (() => void) | null = null;

function scheduleAutosave(project: Project) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveAutosave(project), 1500);
}

function ensureSynthBound() {
  synthEngine.bindContext(
    audioEngine.getSharedContext(),
    audioEngine.getMasterGainNode(),
  );
}

async function resolveClipAudioId(storagePath: string): Promise<string> {
  if (storagePath.startsWith('local:')) return storagePath.slice(6);
  if (storagePath.startsWith('demo:')) return storagePath;
  if (storagePath.startsWith('storage:')) {
    const resolved = await audioEngine.ensureStorageAudio?.(storagePath);
    return resolved || storagePath;
  }
  return storagePath;
}

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
  removeTrack: (trackId: string) => void;
  reorderTracks: (oldIndex: number, newIndex: number) => void;
  toggleSidechain: (trackId: string) => void;
  setSidechainParams: (trackId: string, params: Partial<NonNullable<Track['sidechain']>>) => void;
  updateTrack: (trackId: string, changes: Partial<Track>) => void;
  updateClipFade: (trackId: string, clipId: string, updates: Partial<Pick<AudioClip, 'fadeInMs' | 'fadeOutMs' | 'fadeInCurve' | 'fadeOutCurve' | 'fadeInPoints' | 'fadeOutPoints'>>) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  addAudioClip: (trackId: string, file: File) => Promise<void>;
  addTestTone: (trackId: string) => Promise<void>;

  // Asset Pool
  assets: Asset[];
  addAsset: (file: File) => Promise<void>;
  removeAsset: (assetId: string) => void;
  addClipFromAsset: (trackId: string, assetId: string, startBeat: number) => Promise<void>;

  // Mix / Inserts (signal chain)
  addInsert: (trackId: string, plugin: Omit<PluginInstance, 'id'>) => void;
  updateInsert: (trackId: string, insertId: string, params: Record<string, number>) => void;
  removeInsert: (trackId: string, insertId: string) => void;
  toggleInsertBypass: (trackId: string, insertId: string) => void;
  reorderInsert: (trackId: string, fromIndex: number, toIndex: number) => void;
  loadDemoMixChain: () => void;
  loadDemoProject: () => void;
  seedDemoAssets: () => void;
  loadSimpleDrumBeat: () => void;
  newProject: () => void;
  saveProjectNow: (userId?: string | null) => Promise<'local' | 'cloud'>;
  loadSavedProject: (userId?: string | null) => Promise<boolean>;
  toggleAutomationWrite: (trackId: string) => void;
  initRealtime: (userId: string) => void;
  setMasterGain: (gain: number) => void;
  setTrackGain: (trackId: string, gain: number) => void;
  setTrackPan: (trackId: string, pan: number) => void;
  autoCrossfade: (trackId: string) => void;

  // Metronome
  metronomeEnabled: boolean;
  toggleMetronome: () => void;

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

  // Loop Region (for transport loop and region highlight)
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  toggleLoop: () => void;
  setLoopRegion: (start: number, end: number) => void;

  // Internal helpers
  setCurrentBeat: (beat: number) => void;
  refreshPlayback: () => void;
  seek: (beat: number) => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;

  // Export (Phase 6)
  exportProject: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  // Note: demo sounds and FX preload are now lazy (on first play/gesture) to avoid AudioContext autoplay warnings.
  // They will be triggered from play() or explicit demo load buttons.

  audioEngine.subscribeToPosition((beat) => {
    let nextBeat = Math.max(0, beat);
    const { loopEnabled, loopStart, loopEnd, isPlaying } = get();

    if (loopEnabled && loopEnd > loopStart && isPlaying && nextBeat >= loopEnd) {
      // Loop back
      nextBeat = loopStart;
      // To make it seamless, we may need to reschedule, but for now jump position
      // The audio scheduling will need refresh if we want perfect loop, but basic jump first.
      audioEngine.stop();
      audioEngine.play(nextBeat).then(() => {
        // re-schedule current clips after loop jump
        get().refreshPlayback();
      });
      set({ currentBeat: nextBeat, isPlaying: true });
      return;
    }

    set({ currentBeat: nextBeat });
  });

  function getAutomatedValue(track: Track, param: 'gain' | 'pan', beat: number): number | undefined {
    const pts = track.automation?.[param];
    if (!pts || pts.length === 0) return undefined;

    let prev = pts[0];
    let next = pts[pts.length - 1];

    for (let i = 0; i < pts.length; i++) {
      if (pts[i].beat <= beat) prev = pts[i];
      if (pts[i].beat >= beat) {
        next = pts[i];
        break;
      }
    }

    if (prev.beat === next.beat) return prev.value;
    const t = (beat - prev.beat) / (next.beat - prev.beat);
    return prev.value + (next.value - prev.value) * Math.max(0, Math.min(1, t));
  }

  const getEffectiveGain = (track: Track): number => {
    const latest = get().project.tracks.find(t => t.id === track.id) || track;
    if (latest.muted) return 0;
    const anySolo = get().project.tracks.some(t => t.soloed);
    if (anySolo && !latest.soloed) return 0;

    const autoGain = getAutomatedValue(latest, 'gain', get().currentBeat);
    return Math.max(0, Math.min(2, autoGain ?? latest.gain));
  };

  const refreshPlayback = async () => {
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

    for (const track of project.tracks) {
      if (track.type !== 'audio' || !track.audioClips) continue;
      const eff = getEffectiveGain(track);
      for (const clip of track.audioClips) {
        if (clip.storagePath.startsWith('local:')) {
          const audioId = clip.storagePath.replace('local:', '');
          audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id, {
            fadeInMs: clip.fadeInMs || 0,
            fadeOutMs: clip.fadeOutMs || 0,
            fadeInCurve: clip.fadeInCurve || 'linear',
            fadeOutCurve: clip.fadeOutCurve || 'linear'
          });
        } else if (clip.storagePath.startsWith('demo:') || clip.storagePath.startsWith('storage:')) {
          const audioId = await resolveClipAudioId(clip.storagePath);
          if (audioId) {
            audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id, {
              fadeInMs: clip.fadeInMs || 0,
              fadeOutMs: clip.fadeOutMs || 0,
              fadeInCurve: clip.fadeInCurve || 'linear',
              fadeOutCurve: clip.fadeOutCurve || 'linear'
            });
          }
        }
      }
    }

    // MIDI reschedule on refresh
    ensureSynthBound();
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
    project: initialProject,
    isPlaying: false,
    currentBeat: 0,
    selectedClipIds: [],
    history: [],
    future: [],
    quantize: 1, // 1 beat = "1/4" (quarter note) by default in 4/4; value is always in beats
    setQuantize: (q) => set({ quantize: q }),
    isQuantizeOn: true,
    toggleQuantize: () => set((state) => ({ isQuantizeOn: !state.isQuantizeOn })),

    assets: [...DEFAULT_DEMO_ASSETS],

    metronomeEnabled: false,
    toggleMetronome: () => {
      set((state) => ({ metronomeEnabled: !state.metronomeEnabled }));
      const newState = !get().metronomeEnabled;
      audioEngine.setMetronome(newState);
      if (get().isPlaying && newState) {
        const curr = get().currentBeat;
        for (let b = Math.ceil(curr); b < curr + 64; b++) {
          (audioEngine as any).scheduleMetronomeClick?.(b);
        }
      }
    },

    // Loop region (for loop playback and region highlight in arrange)
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 4,
    toggleLoop: () => set((state) => ({ loopEnabled: !state.loopEnabled })),
    setLoopRegion: (start, end) => {
      const s = Math.max(0, Math.min(start, end));
      const e = Math.max(0, Math.max(start, end));
      set({ loopStart: s, loopEnd: e });
    },

    setTempo: (bpm) => {
      const clamped = Math.max(40, Math.min(300, bpm));
      set((state) => ({
        project: { ...state.project, tempo: clamped },
      }));
      audioEngine.setTempo(clamped);
      synthEngine.setTempo(clamped);
    },

    togglePlay: async () => {
      audioEngine.setMetronome(get().metronomeEnabled);
      const st = get();
      let startBeat = st.currentBeat;

      if (st.loopEnabled && st.loopEnd > st.loopStart) {
        if (startBeat < st.loopStart || startBeat >= st.loopEnd) {
          startBeat = st.loopStart;
        }
      }

      if (!st.isPlaying) {
        await audioEngine.play(startBeat);
        set({ isPlaying: true, currentBeat: startBeat });

        // Prepare signal chain for all tracks (channel strips + master bus)
        st.project.tracks.forEach(t => {
          audioEngine.ensureChannel?.(t.id);
          audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
          // Apply current mix state
          audioEngine.setTrackFader?.(t.id, getEffectiveGain(t));
          audioEngine.setTrackPan?.(t.id, t.pan);
          audioEngine.setTrackMute?.(t.id, t.muted);
        });

        // Schedule audio clips
        for (const track of st.project.tracks) {
          if (track.type !== 'audio' || !track.audioClips) continue;
          const eff = getEffectiveGain(track);
          for (const clip of track.audioClips) {
            const audioId = await resolveClipAudioId(clip.storagePath);
            if (audioId) {
              audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id, {
                fadeInMs: clip.fadeInMs || 0,
                fadeOutMs: clip.fadeOutMs || 0,
                fadeInCurve: clip.fadeInCurve || 'linear',
                fadeOutCurve: clip.fadeOutCurve || 'linear'
              });
            }
          }
        }

        // Schedule MIDI notes from instrument/midi tracks
        ensureSynthBound();
        const playStartBeat = audioEngine.getPlayStartBeat?.() ?? get().currentBeat;
        const playStartTime = audioEngine.getPlayStartTime?.() ?? 0;
        synthEngine.setTempo(st.project.tempo);
        synthEngine.stopAll();

        st.project.tracks.forEach((track) => {
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
        automationWrite: false,
        audioClips: type === 'audio' ? [] : undefined,
        midiClips: (type === 'instrument' || type === 'midi') ? [] : undefined,
        inserts: type === 'instrument' ? [
          { id: 'inst-eq', type: 'eq3band', params: { lowGain: 0, midGain: 1, highGain: -1 } },
          { id: 'inst-drive', type: 'drive', params: { amount: 1.5 } }
        ] : [],
      };
      set((state) => ({
        project: { ...state.project, tracks: [...state.project.tracks, newTrack] }
      }));

      // Prepare channel strip immediately (lazy safe)
      audioEngine.ensureChannel?.(newTrack.id);
      audioEngine.rebuildTrackInserts?.(newTrack.id, newTrack.inserts || []);
    },

    removeTrack: (trackId) => {
      get().pushHistory();
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.filter(t => t.id !== trackId)
        },
        selectedClipIds: [] // clear selection for simplicity
      }));
    },

    reorderTracks: (oldIndex, newIndex) => {
      get().pushHistory();
      set((state) => {
        const tracks = [...state.project.tracks];
        const [moved] = tracks.splice(oldIndex, 1);
        tracks.splice(newIndex, 0, moved);
        return {
          project: { ...state.project, tracks }
        };
      });
    },

    toggleSidechain: (trackId) => {
      const track = get().project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const current = track.sidechain || { enabled: false, threshold: 0.5, reduction: 0.5, releaseMs: 150 };
      get().updateTrack(trackId, { sidechain: { ...current, enabled: !current.enabled } });
    },

    setSidechainParams: (trackId, params) => {
      const track = get().project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const current = track.sidechain || { enabled: true, threshold: 0.5, reduction: 0.5, releaseMs: 150 };
      get().updateTrack(trackId, { sidechain: { ...current, ...params } });
      // If playing, reschedule ducks
      if (get().isPlaying) get().refreshPlayback();
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

    updateClipFade: (trackId, clipId, updates) => {
      set((state) => {
        const tracks = state.project.tracks.map(track => {
          if (track.id !== trackId || !track.audioClips) return track;
          return {
            ...track,
            audioClips: track.audioClips.map(clip =>
              clip.id === clipId ? { ...clip, ...updates } as AudioClip : clip
            )
          };
        });
        return { project: { ...state.project, tracks } };
      });

      // If playing, reschedule to apply new fades
      if (get().isPlaying) {
        get().refreshPlayback();
      }
    },

    // Auto crossfade for overlapping audio clips on same track (Cubase like)
    autoCrossfade: (trackId: string) => {
      const track = get().project.tracks.find(t => t.id === trackId);
      if (!track || !track.audioClips || track.audioClips.length < 2) return;

      const clips = [...track.audioClips].sort((a, b) => a.startBeat - b.startBeat);
      for (let i = 0; i < clips.length - 1; i++) {
        const a = clips[i];
        const b = clips[i + 1];
        const aEnd = a.startBeat + a.durationBeats;
        if (b.startBeat < aEnd) {
          const overlapBeats = aEnd - b.startBeat;
          const msPerBeat = 60000 / get().project.tempo;
          const overlapMs = overlapBeats * msPerBeat;
          // Set fadeOut on a and fadeIn on b to overlap
          get().updateClipFade(trackId, a.id, { fadeOutMs: Math.round(overlapMs), fadeOutCurve: 's-curve' });
          get().updateClipFade(trackId, b.id, { fadeInMs: Math.round(overlapMs), fadeInCurve: 's-curve' });
        }
      }
      if (get().isPlaying) get().refreshPlayback();
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
      const st = get();
      const track = st.project.tracks.find(t => t.id === trackId);

      if (track?.automationWrite && st.isPlaying) {
        const beat = st.currentBeat;
        get().pushHistory();
        // Record automation point
        set((state) => {
          const tracks = state.project.tracks.map(t => {
            if (t.id !== trackId) return t;
            const auto = t.automation || {};
            const pts = [...(auto.gain || [])];
            // Remove points very close to current beat for clean overwrite
            const filtered = pts.filter(p => Math.abs(p.beat - beat) > 0.01);
            filtered.push({ beat, value: clamped });
            filtered.sort((a, b) => a.beat - b.beat);
            return { ...t, automation: { ...auto, gain: filtered } };
          });
          return { project: { ...state.project, tracks } };
        });
      }

      get().updateTrack(trackId, { gain: clamped });
    },

    setTrackPan: (trackId, pan) => {
      const clamped = Math.max(-1, Math.min(1, pan));
      const st = get();
      const track = st.project.tracks.find(t => t.id === trackId);

      if (track?.automationWrite && st.isPlaying) {
        const beat = st.currentBeat;
        set((state) => {
          const tracks = state.project.tracks.map(t => {
            if (t.id !== trackId) return t;
            const auto = t.automation || {};
            const pts = [...(auto.pan || [])].filter(p => Math.abs(p.beat - beat) > 0.01);
            pts.push({ beat, value: clamped });
            pts.sort((a, b) => a.beat - b.beat);
            return { ...t, automation: { ...auto, pan: pts } };
          });
          return { project: { ...state.project, tracks } };
        });
      }

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

    toggleInsertBypass: (trackId, insertId) => {
      set((state) => {
        const tracks = state.project.tracks.map(t => {
          if (t.id !== trackId) return t;
          return {
            ...t,
            inserts: t.inserts.map(ins =>
              ins.id === insertId ? { ...ins, bypass: !ins.bypass } : ins
            )
          };
        });
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
        // (actual update happens via demoTracks set below)
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
      scheduleAutosave(get().project);
    },

    loadDemoProject: () => {
      get().pushHistory();
      const demo = createDemoProject();
      set({ project: demo, currentBeat: 0, selectedClipIds: [] });
      audioEngine.ensureDemoSounds?.();
      demo.tracks.forEach(t => {
        audioEngine.ensureChannel?.(t.id);
        audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
      });
      scheduleAutosave(demo);
    },

    seedDemoAssets: () => {
      audioEngine.ensureDemoSounds?.();
      const current = get().assets;
      const toAdd = DEFAULT_DEMO_ASSETS.filter(w => !current.some(a => a.storagePath === w.storagePath));
      if (toAdd.length > 0) {
        set((state) => ({ assets: [...state.assets, ...toAdd] }));

      }
    },

    loadSimpleDrumBeat: () => {
      get().pushHistory();
      set({ currentBeat: 0 });
      audioEngine.ensureDemoSounds?.();
      get().seedDemoAssets();

      // Create or reuse drum tracks
      let state = get();
      let kickTrack = state.project.tracks.find(t => t.name.toLowerCase().includes('kick') || (t.type === 'audio' && t.audioClips?.some(c => c.storagePath.includes('kick'))));
      let snareTrack = state.project.tracks.find(t => t.name.toLowerCase().includes('snare'));
      let hatTrack = state.project.tracks.find(t => t.name.toLowerCase().includes('hat'));
      let crashTrack = state.project.tracks.find(t => t.name.toLowerCase().includes('crash'));

      const makeTrack = (name: string) => {
        const tr: Track = {
          id: crypto.randomUUID(),
          type: 'audio',
          name,
          gain: 0.9,
          pan: 0,
          muted: false,
          soloed: false,
          inserts: [],
          audioClips: [],
        };
        return tr;
      };

      const tracksToAdd: Track[] = [];
      if (!kickTrack) { kickTrack = makeTrack('Kick'); tracksToAdd.push(kickTrack); }
      if (!snareTrack) { snareTrack = makeTrack('Snare'); tracksToAdd.push(snareTrack); }
      if (!hatTrack) { hatTrack = makeTrack('Closed Hat'); tracksToAdd.push(hatTrack); }
      if (!crashTrack) { crashTrack = makeTrack('Crash'); tracksToAdd.push(crashTrack); }

      if (tracksToAdd.length) {
        set((s) => ({ project: { ...s.project, tracks: [...s.project.tracks, ...tracksToAdd] } }));
      }

      // Clear old demo clips on these for clean beat
      const ids = [kickTrack.id, snareTrack.id, hatTrack.id, crashTrack.id];
      set((s) => {
        const newTracks = s.project.tracks.map(tr =>
          ids.includes(tr.id) ? { ...tr, audioClips: [] } : tr
        );
        return { project: { ...s.project, tracks: newTracks } };
      });

      // Place a simple 8-beat groove (at 120bpm)
      const assets = get().assets;
      const findAsset = (name: string) => assets.find(a => a.name.toLowerCase().includes(name.toLowerCase()) || a.storagePath.includes(name.toLowerCase()));

      const kickA = findAsset('kick') || assets.find(a => a.storagePath === 'demo:kick');
      const snareA = findAsset('snare') || assets.find(a => a.storagePath === 'demo:snare');
      const hatA = findAsset('hat') || assets.find(a => a.storagePath === 'demo:hihat');
      const crashA = findAsset('crash') || assets.find(a => a.storagePath === 'demo:crash');

      const clipsToAdd: Array<{ trackId: string; clip: AudioClip }> = [];
      const add = (trackId: string, asset: Asset, start: number) => {
        if (!asset || !trackId) return;
        const durBeats = (asset.duration * get().project.tempo) / 60;
        clipsToAdd.push({
          trackId,
          clip: {
            id: crypto.randomUUID(),
            storagePath: asset.storagePath,
            startBeat: start,
            durationBeats: Math.max(0.25, durBeats * 0.95),
            offsetBeats: 0,
            fadeInMs: 5,
            fadeOutMs: 60,
            fadeInCurve: 'linear',
            fadeOutCurve: 'exp',
          },
        });
      };

      // 8-beat groove from beat 0
      if (kickTrack && kickA) {
        add(kickTrack.id, kickA, 0);
        add(kickTrack.id, kickA, 2);
        add(kickTrack.id, kickA, 4);
        add(kickTrack.id, kickA, 6);
      }
      if (snareTrack && snareA) {
        add(snareTrack.id, snareA, 2);
        add(snareTrack.id, snareA, 6);
      }
      if (hatTrack && hatA) {
        for (let i = 0; i < 16; i++) {
          add(hatTrack.id, hatA, i * 0.5);
        }
      }
      if (crashTrack && crashA) {
        add(crashTrack.id, crashA, 0);
      }

      if (clipsToAdd.length) {
        set((s) => {
          const byTrack = new Map<string, AudioClip[]>();
          for (const { trackId, clip } of clipsToAdd) {
            byTrack.set(trackId, [...(byTrack.get(trackId) || []), clip]);
          }
          return {
            project: {
              ...s.project,
              tracks: s.project.tracks.map(t =>
                byTrack.has(t.id)
                  ? { ...t, audioClips: [...(t.audioClips || []), ...(byTrack.get(t.id) || [])] }
                  : t
              ),
            },
          };
        });
      }

      // Bassline instrument track with full 8-beat MIDI phrase
      let inst = get().project.tracks.find(t => t.type === 'instrument' || t.type === 'midi');
      if (!inst) {
        get().addTrackOfType('instrument', 'Bassline');
        inst = get().project.tracks.find(t => t.type === 'instrument');
      }
      if (inst) {
        const bassNotes = [
          { pitch: 36, start: 0, dur: 0.9, vel: 105 },
          { pitch: 36, start: 2, dur: 0.9, vel: 95 },
          { pitch: 43, start: 4, dur: 0.9, vel: 100 },
          { pitch: 48, start: 6, dur: 1.5, vel: 110 },
        ];
        const midiClip: MidiClip = {
          id: crypto.randomUUID(),
          startBeat: 0,
          durationBeats: 8,
          notes: bassNotes.map((n) => ({
            id: crypto.randomUUID(),
            pitch: n.pitch,
            startBeat: n.start,
            durationBeats: n.dur,
            velocity: n.vel,
          })),
        };
        set((s) => ({
          project: {
            ...s.project,
            tracks: s.project.tracks.map(t =>
              t.id === inst!.id
                ? {
                    ...t,
                    name: t.name.includes('Bass') ? t.name : 'Bassline',
                    gain: 0.88,
                    inserts: t.inserts?.length ? t.inserts : [
                      { id: crypto.randomUUID(), type: 'eq3band', params: { lowGain: 2, midGain: 0.5, highGain: -2 }, bypass: false },
                      { id: crypto.randomUUID(), type: 'drive', params: { amount: 1.6 }, bypass: false },
                    ],
                    midiClips: [midiClip],
                  }
                : t
            ),
          },
        }));
        audioEngine.ensureChannel?.(inst.id);
        audioEngine.rebuildTrackInserts?.(inst.id, get().project.tracks.find(t => t.id === inst!.id)?.inserts || []);
      }

      scheduleAutosave(get().project);
    },

    newProject: () => {
      get().pushHistory();
      const fresh = createEmptyProject();
      set({ project: fresh, currentBeat: 0, selectedClipIds: [], history: [], future: [] });
      scheduleAutosave(fresh);
    },

    saveProjectNow: async (userId) => {
      const mode = await saveProject(get().project, userId);
      return mode;
    },

    loadSavedProject: async (userId) => {
      const { project: current } = get();
      const loaded = await loadProject(current.id, userId);
      if (!loaded) return false;
      set({ project: loaded, currentBeat: 0, selectedClipIds: [] });
      loaded.tracks.forEach(t => {
        audioEngine.ensureChannel?.(t.id);
        audioEngine.rebuildTrackInserts?.(t.id, t.inserts || []);
      });
      return true;
    },

    toggleAutomationWrite: (trackId) => {
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((t) =>
            t.id === trackId ? { ...t, automationWrite: !t.automationWrite } : t
          ),
        },
      }));
    },

    initRealtime: (userId) => {
      realtimeUnsub?.();
      const projectId = get().project.id;
      realtimeUnsub = subscribeToProject(projectId, userId, (evt) => {
        const { trackId, clipId, newStartBeat } = evt;
        set((state) => ({
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track) => {
              if (track.id !== trackId) return track;
              if (track.audioClips?.some(c => c.id === clipId)) {
                return {
                  ...track,
                  audioClips: track.audioClips.map(c =>
                    c.id === clipId ? { ...c, startBeat: newStartBeat } : c
                  ),
                };
              }
              if (track.midiClips?.some(c => c.id === clipId)) {
                return {
                  ...track,
                  midiClips: track.midiClips.map(c =>
                    c.id === clipId ? { ...c, startBeat: newStartBeat } : c
                  ),
                };
              }
              return track;
            }),
          },
        }));
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

      const sourceDurBeats = (loaded.duration * tempo) / 60;
      const newClip: AudioClip & { sourceDurationBeats?: number } = {
        id: crypto.randomUUID(),
        storagePath: `local:${loaded.id}`,
        startBeat: 0,
        durationBeats: sourceDurBeats,
        offsetBeats: 0,
        sourceDurationBeats: sourceDurBeats,
        fadeInMs: 40,  // default small fade for nice UX
        fadeOutMs: 80,
        fadeInCurve: 'linear',
        fadeOutCurve: 's-curve',
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
        audioEngine.scheduleClip(loaded.id, newClip.startBeat, newClip.offsetBeats, eff, trackId, {
          fadeInMs: newClip.fadeInMs || 0,
          fadeOutMs: newClip.fadeOutMs || 0,
          fadeInCurve: newClip.fadeInCurve || 'linear',
          fadeOutCurve: newClip.fadeOutCurve || 'linear'
        });
      }
    },

    addTestTone: async (trackId: string) => {
      // Use main engine context for buffer creation (creation is allowed; resume is handled on gesture)
      const ctx = (audioEngine as any).getContext ? (audioEngine as any).getContext() : new (window.AudioContext || (window as any).webkitAudioContext)();
      const sampleRate = ctx.sampleRate;
      const duration = 0.8;
      const length = Math.floor(sampleRate * duration);
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 4) * 0.7;
      }

      const id = crypto.randomUUID();
      audioEngine.registerBuffer(id, 'Test Tone', buffer, duration);

      const tempo = get().project.tempo;
      const sourceDurBeats = (duration * tempo) / 60;
      const newClip: AudioClip & { sourceDurationBeats?: number } = {
        id: crypto.randomUUID(),
        storagePath: `local:${id}`,
        startBeat: 0,
        durationBeats: sourceDurBeats,
        offsetBeats: 0,
        sourceDurationBeats: sourceDurBeats,
        fadeInMs: 0,
        fadeOutMs: 0,
        fadeInCurve: 'linear',
        fadeOutCurve: 'linear',
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
        audioEngine.scheduleClip(id, newClip.startBeat, newClip.offsetBeats, eff, trackId, {
          fadeInMs: newClip.fadeInMs || 0,
          fadeOutMs: newClip.fadeOutMs || 0,
          fadeInCurve: newClip.fadeInCurve || 'linear',
          fadeOutCurve: newClip.fadeOutCurve || 'linear'
        });
      }
    },

    // Asset Pool
    addAsset: async (file) => {
      const userId = useAuthStore.getState().user?.id;
      let storagePath: string;
      let duration: number;

      if (isSupabaseConfigured && userId) {
        try {
          const objectPath = await uploadAudioAsset(file, userId);
          storagePath = `storage:${objectPath}`;

          // Load locally for immediate use + cache
          const loaded = await audioEngine.loadAudio(file);
          duration = loaded.duration;
          audioEngine.registerBuffer?.(objectPath, file.name, loaded.buffer, duration);
        } catch (e) {
          console.warn('[Storage] upload failed, local fallback', e);
          const loaded = await audioEngine.loadAudio(file);
          storagePath = `local:${loaded.id}`;
          duration = loaded.duration;
        }
      } else {
        const loaded = await audioEngine.loadAudio(file);
        storagePath = `local:${loaded.id}`;
        duration = loaded.duration;
      }

      const newAsset: Asset = {
        id: crypto.randomUUID(),
        name: file.name,
        storagePath,
        duration,
      };

      set((state) => ({
        assets: [...state.assets, newAsset]
      }));
    },

    removeAsset: (assetId) => {
      set((state) => ({
        assets: state.assets.filter(a => a.id !== assetId)
      }));
    },

    addClipFromAsset: async (trackId, assetId, startBeat) => {
      const asset = get().assets.find(a => a.id === assetId);
      if (!asset) return;

      get().pushHistory();

      const tempo = get().project.tempo;
      const durationBeats = (asset.duration * tempo) / 60;

      const newClip: AudioClip = {
        id: crypto.randomUUID(),
        storagePath: asset.storagePath,
        startBeat: Math.max(0, startBeat),
        durationBeats,
        offsetBeats: 0,
        fadeInMs: 30,
        fadeOutMs: 80,
        fadeInCurve: 'linear',
        fadeOutCurve: 'exp',
      };

      set((state) => {
        const tracks = state.project.tracks.map(track =>
          track.id === trackId
            ? { ...track, audioClips: [...(track.audioClips || []), newClip] }
            : track
        );
        return { project: { ...state.project, tracks } };
      });

      if (get().isPlaying) {
        const tr = get().project.tracks.find(t => t.id === trackId);
        const eff = tr ? getEffectiveGain(tr) : 0.85;
        const id = await resolveClipAudioId(asset.storagePath);
        if (id) audioEngine.scheduleClip(id, newClip.startBeat, 0, eff, trackId);
      }

      // Realtime notify collaborators (new clip)
      const uid = useAuthStore.getState().user?.id;
      if (uid) broadcastClipMove(get().project.id, uid, trackId, newClip.id, newClip.startBeat);
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

      // Auto crossfade for quality (Cubase style) on audio clips
      const movedClip = get().project.tracks.find(t => t.id === trackId)?.audioClips?.find(c => c.id === clipId);
      if (movedClip) {
        get().autoCrossfade(trackId);
      }

      scheduleAutosave(get().project);
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        broadcastClipMove(get().project.id, userId, trackId, clipId, snapped);
      }
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
              audioClips: track.audioClips.map((clip) => {
                if (clip.id !== clipId) return clip;
                const updated = {
                  ...clip,
                  durationBeats: dur,
                  startBeat: newStartBeat !== undefined ? Math.max(0, newStartBeat) : clip.startBeat,
                  offsetBeats: newOffsetBeats !== undefined ? Math.max(0, newOffsetBeats) : clip.offsetBeats,
                };
                // Clamp fades if shorter
                const clipMs = dur * (60000 / get().project.tempo);
                if (updated.fadeInMs && updated.fadeInMs > clipMs) updated.fadeInMs = clipMs;
                if (updated.fadeOutMs && updated.fadeOutMs > clipMs) updated.fadeOutMs = clipMs;
                return updated;
              }),
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

      // Broadcast resize as move (simple event reuse for receiver)
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const finalStart = newStartBeat !== undefined ? newStartBeat : get().project.tracks.find(t => t.id === trackId)?.audioClips?.find(c => c.id === clipId)?.startBeat ?? 0;
        broadcastClipMove(get().project.id, userId, trackId, clipId, finalStart);
      }
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
        let audioCopies: any[] = [];
        let midiCopies: any[] = [];
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
        audioEngine.play(clamped).then(async () => {
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

          for (const track of project.tracks) {
            if (track.type !== 'audio' || !track.audioClips) continue;
            const eff = getEffectiveGain(track);
            for (const clip of track.audioClips) {
              if (clip.storagePath.startsWith('local:')) {
                const audioId = clip.storagePath.replace('local:', '');
                audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id, {
                  fadeInMs: clip.fadeInMs || 0,
                  fadeOutMs: clip.fadeOutMs || 0,
                  fadeInCurve: clip.fadeInCurve || 'linear',
                  fadeOutCurve: clip.fadeOutCurve || 'linear'
                });
              } else if (clip.storagePath.startsWith('demo:') || clip.storagePath.startsWith('storage:')) {
                const audioId = await resolveClipAudioId(clip.storagePath);
                if (audioId) {
                  audioEngine.scheduleClip(audioId, clip.startBeat, clip.offsetBeats, eff, track.id, {
                    fadeInMs: clip.fadeInMs || 0,
                    fadeOutMs: clip.fadeOutMs || 0,
                    fadeInCurve: clip.fadeInCurve || 'linear',
                    fadeOutCurve: clip.fadeOutCurve || 'linear'
                  });
                }
              }
            }
          }

          // Reschedule MIDI
          ensureSynthBound();
          synthEngine.setTempo(project.tempo);
          synthEngine.stopAll();
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

          // Schedule sidechain ducks for EDM ducking (beat synced)
          const beatSec = 60 / project.tempo;
          project.tracks.forEach((track) => {
            if (track.sidechain?.enabled) {
              const reduction = track.sidechain.reduction || 0.5;
              const release = track.sidechain.releaseMs || 150;
              // Schedule for next 32 beats using setTimeout (easy, beat accurate enough)
              for (let b = Math.floor(clamped); b < Math.floor(clamped) + 32; b++) {
                const beatStartTime = pst2 + (b - psb2) * beatSec;
                const delay = Math.max(0, (beatStartTime - (audioEngine.getPlayStartTime?.() || Date.now()/1000)) * 1000 );
                setTimeout(() => {
                  if (get().isPlaying) {
                    audioEngine.triggerDuck(track.id, reduction, release);
                  }
                }, delay);
              }
            }
          });
        });
      } else {
        set({ currentBeat: clamped });
      }
    },

    refreshPlayback,

    exportProject: async () => {
      const { project } = get();

      try {
        await exportAndDownload(project);
      } catch (err) {
        console.error('Export failed', err);
      }
    },
  };
});
