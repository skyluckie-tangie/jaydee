import type { Project } from './types';

/** Clean starter project — no demo clips */
export function createEmptyProject(name = 'Untitled'): Project {
  return {
    id: crypto.randomUUID(),
    name,
    tempo: 120,
    timeSignature: [4, 4],
    tracks: [
      {
        id: crypto.randomUUID(),
        type: 'audio',
        name: 'Audio 1',
        gain: 0.85,
        pan: 0,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [],
        audioClips: [],
      },
      {
        id: crypto.randomUUID(),
        type: 'instrument',
        name: 'Instrument 1',
        gain: 0.82,
        pan: 0,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [],
        audioClips: [],
        midiClips: [],
      },
    ],
  };
}

/** Full demo project for testing mix engine */
export function createDemoProject(): Project {
  return {
    id: 'local-demo',
    name: 'Demo Mix',
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
        automationWrite: false,
        inserts: [
          { id: 'demo-eq', type: 'eq3band', params: { lowGain: 2.5, midGain: -1.8, highGain: 1.2, lowFreq: 220, midFreq: 850, highFreq: 4800 }, bypass: false },
          { id: 'demo-comp', type: 'compressor', params: { threshold: -20, ratio: 3.5, attack: 0.004, release: 0.18, knee: 8 }, bypass: false },
        ],
        audioClips: [
          { id: 'c1', storagePath: 'demo:808hats', startBeat: 0, durationBeats: 4, offsetBeats: 0, fadeInMs: 50, fadeOutMs: 120, fadeInCurve: 'linear', fadeOutCurve: 'exp' },
          { id: 'c2', storagePath: 'demo:808hats', startBeat: 4, durationBeats: 4, offsetBeats: 0, fadeInMs: 80, fadeOutMs: 80, fadeInCurve: 's-curve', fadeOutCurve: 's-curve' },
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
        automationWrite: false,
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
        automationWrite: false,
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
        automationWrite: false,
        inserts: [
          { id: 'bass-eq', type: 'eq3band', params: { lowGain: 1.5, midGain: 0.8, highGain: -2.2 }, bypass: false },
          { id: 'bass-drive', type: 'drive', params: { amount: 1.9 }, bypass: false },
          { id: 'bass-delay', type: 'delay', params: { time: 0.22, feedback: 0.28, wet: 0.18, damp: 5200 }, bypass: false },
        ],
        sidechain: { enabled: true, threshold: 0.5, reduction: 0.65, releaseMs: 180 },
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
}