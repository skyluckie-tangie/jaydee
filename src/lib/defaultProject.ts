import type { Project, AudioClip, Asset } from './types';

/** Demo samples available in AudioEngine.ensureDemoSounds */
export const DEFAULT_DEMO_ASSETS: Asset[] = [
  { id: 'd-kick', name: 'Kick', storagePath: 'demo:kick', duration: 0.65 },
  { id: 'd-snare', name: 'Snare', storagePath: 'demo:snare', duration: 0.55 },
  { id: 'd-hihat', name: 'Closed Hat', storagePath: 'demo:hihat', duration: 0.28 },
  { id: 'd-crash', name: 'Crash', storagePath: 'demo:crash', duration: 1.6 },
];

const TEMPO = 120;

function clipBeats(durationSec: number, tempo = TEMPO): number {
  return Math.max(0.25, (durationSec * tempo) / 60 * 0.95);
}

function demoClip(storagePath: string, startBeat: number, durationSec: number): AudioClip {
  return {
    id: crypto.randomUUID(),
    storagePath,
    startBeat,
    durationBeats: clipBeats(durationSec),
    offsetBeats: 0,
    fadeInMs: 5,
    fadeOutMs: 60,
    fadeInCurve: 'linear',
    fadeOutCurve: 'exp',
  };
}

/** Ready-to-play 8-beat groove — default for first visit / deploy */
export function createStarterBeatProject(): Project {
  const kickId = crypto.randomUUID();
  const snareId = crypto.randomUUID();
  const hatId = crypto.randomUUID();
  const crashId = crypto.randomUUID();
  const bassId = crypto.randomUUID();
  const midiClipId = crypto.randomUUID();

  const kickClips = [0, 2, 4, 6].map((b) => demoClip('demo:kick', b, 0.65));
  const snareClips = [2, 6].map((b) => demoClip('demo:snare', b, 0.55));
  const hatClips = Array.from({ length: 16 }, (_, i) => demoClip('demo:hihat', i * 0.5, 0.28));
  const crashClips = [demoClip('demo:crash', 0, 1.6)];

  return {
    id: crypto.randomUUID(),
    name: 'Starter Beat',
    tempo: TEMPO,
    timeSignature: [4, 4],
    tracks: [
      {
        id: kickId,
        type: 'audio',
        name: 'Kick',
        gain: 0.92,
        pan: 0,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [],
        audioClips: kickClips,
      },
      {
        id: snareId,
        type: 'audio',
        name: 'Snare',
        gain: 0.88,
        pan: 0,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [],
        audioClips: snareClips,
      },
      {
        id: hatId,
        type: 'audio',
        name: 'Closed Hat',
        gain: 0.72,
        pan: 0.12,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [],
        audioClips: hatClips,
      },
      {
        id: crashId,
        type: 'audio',
        name: 'Crash',
        gain: 0.7,
        pan: 0,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [],
        audioClips: crashClips,
      },
      {
        id: bassId,
        type: 'instrument',
        name: 'Bassline',
        gain: 0.88,
        pan: -0.05,
        muted: false,
        soloed: false,
        automationWrite: false,
        inserts: [
          { id: 'bass-eq', type: 'eq3band', params: { lowGain: 2, midGain: 0.5, highGain: -2 }, bypass: false },
          { id: 'bass-drive', type: 'drive', params: { amount: 1.6 }, bypass: false },
        ],
        audioClips: [],
        midiClips: [
          {
            id: midiClipId,
            startBeat: 0,
            durationBeats: 8,
            notes: [
              { id: crypto.randomUUID(), pitch: 36, startBeat: 0, durationBeats: 0.9, velocity: 105 },
              { id: crypto.randomUUID(), pitch: 36, startBeat: 2, durationBeats: 0.9, velocity: 95 },
              { id: crypto.randomUUID(), pitch: 43, startBeat: 4, durationBeats: 0.9, velocity: 100 },
              { id: crypto.randomUUID(), pitch: 48, startBeat: 6, durationBeats: 1.5, velocity: 110 },
            ],
          },
        ],
      },
    ],
  };
}

export function projectHasAudioClips(project: Project): boolean {
  return project.tracks.some((t) => (t.audioClips?.length ?? 0) > 0);
}

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
        inserts: [
          { id: 'inst-eq', type: 'eq3band', params: { lowGain: 1.5, midGain: 0.5, highGain: -1.5 }, bypass: false },
          { id: 'inst-drive', type: 'drive', params: { amount: 1.3 }, bypass: false },
        ],
        audioClips: [],
        midiClips: [
          {
            id: crypto.randomUUID(),
            startBeat: 0,
            durationBeats: 4,
            notes: [
              { id: crypto.randomUUID(), pitch: 48, startBeat: 0, durationBeats: 1, velocity: 95 },
              { id: crypto.randomUUID(), pitch: 50, startBeat: 1, durationBeats: 1, velocity: 88 },
              { id: crypto.randomUUID(), pitch: 52, startBeat: 2, durationBeats: 1, velocity: 92 },
              { id: crypto.randomUUID(), pitch: 55, startBeat: 3, durationBeats: 1, velocity: 90 },
            ],
          },
        ],
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