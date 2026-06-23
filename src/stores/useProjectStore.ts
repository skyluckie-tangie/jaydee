import { create } from 'zustand';
import type { Project, Track } from '../lib/types';

// Default empty project for development
const defaultProject: Project = {
  id: 'local-demo',
  name: 'My First Song',
  tempo: 120,
  timeSignature: [4, 4],
  tracks: [
    {
      id: 't1',
      type: 'audio',
      name: 'Drums',
      gain: 0.85,
      pan: 0,
      inserts: [],
      audioClips: [],
    },
    {
      id: 't2',
      type: 'instrument',
      name: 'Bass Synth',
      gain: 0.75,
      pan: -0.1,
      inserts: [],
      midiClips: [],
    },
  ],
};

interface ProjectState {
  project: Project;
  isPlaying: boolean;
  currentBeat: number;
  setTempo: (bpm: number) => void;
  togglePlay: () => void;
  addTrack: (track: Track) => void;
  // More actions will be added in later phases
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: defaultProject,
  isPlaying: false,
  currentBeat: 0,

  setTempo: (bpm) =>
    set((state) => ({
      project: { ...state.project, tempo: bpm },
    })),

  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

  addTrack: (track) =>
    set((state) => ({
      project: {
        ...state.project,
        tracks: [...state.project.tracks, track],
      },
    })),
}));
