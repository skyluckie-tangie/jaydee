// Core data models for Jaydee DAW
// These will be used by Zustand store, Supabase sync, and AudioEngine

export type TrackType = 'audio' | 'midi' | 'instrument';

export interface PluginInstance {
  id: string;
  type: 'compressor' | 'eq3band' | 'gain' | 'filter' | 'drive' | 'delay' | string;
  params: Record<string, number>;
  bypass?: boolean;
}

export interface AudioClip {
  id: string;
  storagePath: string;     // Supabase Storage path or local for now
  startBeat: number;
  durationBeats: number;
  offsetBeats: number;
  sourceDurationBeats?: number; // original full length in beats (for accurate waveform trimming)

  // Fade in/out (non-destructive, applied via gain envelope at playback)
  fadeInMs?: number;      // 0 ~ clip duration in ms
  fadeOutMs?: number;
  fadeInCurve?: 'linear' | 'exp' | 's-curve' | 'custom';
  fadeOutCurve?: 'linear' | 'exp' | 's-curve' | 'custom';
  fadeInPoints?: number[];   // for custom curve, normalized 0-1 values
  fadeOutPoints?: number[];
}

export interface Asset {
  id: string;
  name: string;
  storagePath: string;
  duration: number; // seconds
}

export interface MidiNote {
  id: string;
  pitch: number;           // MIDI note number (0-127)
  startBeat: number;
  durationBeats: number;
  velocity: number;        // 0-127
}

export interface MidiClip {
  id: string;
  startBeat: number;
  durationBeats: number;
  notes: MidiNote[];
}

export interface AutomationPoint {
  beat: number;
  value: number; // normalized or absolute depending on target
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  gain: number;            // 0-1 (linear, for internal use)
  pan: number;             // -1 (left) to 1 (right)
  muted: boolean;
  soloed: boolean;
  automationWrite?: boolean;
  automation?: {
    gain?: AutomationPoint[];
    pan?: AutomationPoint[];
  };
  inserts: PluginInstance[];
  audioClips?: AudioClip[];
  midiClips?: MidiClip[];
  // Future high-end (arrange/mix)
  color?: string;
  height?: number;         // track row height multiplier
  // Sidechain ducking (EDM style, beat triggered)
  sidechain?: {
    enabled: boolean;
    threshold: number;   // 0-1, for future or visual
    reduction: number;   // 0-1, how much to duck (e.g. 0.6 = -4.4dB ish)
    releaseMs: number;   // duration of duck after beat
  };
}

export interface Project {
  id: string;
  name: string;
  tempo: number;           // BPM
  timeSignature: [number, number]; // e.g. [4, 4]
  tracks: Track[];
}

export type ProjectUpdate =
  | Partial<Project>
  | { type: 'add_track' | 'update_track' | 'add_clip' | 'move_clip' | 'update_fx'; payload: any };
