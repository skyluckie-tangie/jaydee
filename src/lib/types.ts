// Core data models for Jaydee DAW
// These will be used by Zustand store, Supabase sync, and AudioEngine

export type TrackType = 'audio' | 'midi' | 'instrument';

export interface PluginInstance {
  id: string;
  type: 'compressor' | 'eq3band' | 'gain' | 'filter' | string;
  params: Record<string, number>;
  bypass?: boolean;
}

export interface AudioClip {
  id: string;
  storagePath: string;     // Supabase Storage path or local for now
  startBeat: number;
  durationBeats: number;
  offsetBeats: number;
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

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  gain: number;            // 0-1 (linear, for internal use)
  pan: number;             // -1 (left) to 1 (right)
  muted: boolean;
  soloed: boolean;
  inserts: PluginInstance[];
  audioClips?: AudioClip[];
  midiClips?: MidiClip[];
  // Future high-end (arrange/mix)
  color?: string;
  height?: number;         // track row height multiplier
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
