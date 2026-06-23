import type { Project, Track, PluginInstance } from '../lib/types';
import { audioEngine } from './AudioEngine';
import { encodeWav, downloadBlob } from '../lib/wavEncode';

function beatsToSeconds(beats: number, tempo: number): number {
  return (beats / tempo) * 60;
}

function copyBuffer(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const dst = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    dst.copyToChannel(src.getChannelData(ch), ch);
  }
  return dst;
}

function getEffectiveGain(track: Track, tracks: Track[]): number {
  if (track.muted) return 0;
  const anySolo = tracks.some((t) => t.soloed);
  if (anySolo && !track.soloed) return 0;
  return Math.max(0, Math.min(2, track.gain));
}

function applyFadeCurve(
  gainParam: AudioParam,
  startTime: number,
  durationSec: number,
  fadeMs: number,
  curve: string,
  direction: 'in' | 'out',
) {
  if (fadeMs <= 0 || durationSec <= 0) return;
  const fadeSec = Math.min(fadeMs / 1000, durationSec * 0.9);
  if (direction === 'in') {
    gainParam.setValueAtTime(0.0001, startTime);
    if (curve === 'exp') {
      gainParam.exponentialRampToValueAtTime(1, startTime + fadeSec);
    } else {
      gainParam.linearRampToValueAtTime(1, startTime + fadeSec);
    }
  } else {
    const fadeStart = startTime + durationSec - fadeSec;
    gainParam.setValueAtTime(1, fadeStart);
    if (curve === 'exp') {
      gainParam.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
    } else {
      gainParam.linearRampToValueAtTime(0.0001, startTime + durationSec);
    }
  }
}

function createOfflineInsert(ctx: OfflineAudioContext, plugin: PluginInstance): AudioNode | null {
  const t = plugin.type;
  const p = plugin.params || {};
  if (plugin.bypass) return null;

  if (t === 'eq3band') {
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = p.lowFreq ?? 240;
    low.gain.value = p.lowGain ?? 0;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = p.midFreq ?? 950;
    mid.Q.value = Math.max(0.4, p.midQ ?? 1.15);
    mid.gain.value = p.midGain ?? 0;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = p.highFreq ?? 4200;
    high.gain.value = p.highGain ?? 0;
    low.connect(mid);
    mid.connect(high);
    return high;
  }

  if (t === 'compressor') {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = p.threshold ?? -24;
    comp.knee.value = p.knee ?? 30;
    comp.ratio.value = p.ratio ?? 4;
    comp.attack.value = p.attack ?? 0.003;
    comp.release.value = p.release ?? 0.25;
    return comp;
  }

  if (t === 'drive') {
    const drive = ctx.createWaveShaper();
    const amount = Math.max(1, Math.min(9, p.amount ?? 3.2));
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      const x = (i / 2047) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    drive.curve = curve;
    const out = ctx.createGain();
    out.gain.value = 0.65;
    drive.connect(out);
    return out;
  }

  if (t === 'filter') {
    const f = ctx.createBiquadFilter();
    f.type = (p.type as unknown as BiquadFilterType) || 'lowpass';
    f.frequency.value = p.frequency ?? 1000;
    f.Q.value = p.q ?? 1;
    return f;
  }

  if (t === 'gain') {
    const g = ctx.createGain();
    g.gain.value = p.gain ?? 1;
    return g;
  }

  // Simple delay (sufficient for export parity; feedback approximated)
  if (t === 'delay') {
    const dly = ctx.createDelay(2.0);
    dly.delayTime.value = Math.min(1.5, p.time ?? 0.3);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.damp ?? 4800;

    const wet = ctx.createGain();
    wet.gain.value = Math.max(0, Math.min(1, p.wet ?? 0.25));

    const dry = ctx.createGain();
    dry.gain.value = 0.85;

    const input = ctx.createGain();
    const output = ctx.createGain();

    input.connect(dry);
    input.connect(dly);
    dly.connect(lp);
    lp.connect(wet);
    dry.connect(output);
    wet.connect(output);

    // Return input; the output graph is attached but for simple export chain we accept
    // a basic delay effect. For full feedback a more advanced graph would be needed.
    (input as any)._out = output;
    return input;
  }

  return null;
}

function scheduleOfflineNote(
  ctx: OfflineAudioContext,
  tempo: number,
  pitch: number,
  velocity: number,
  startBeat: number,
  durationBeats: number,
  dest: AudioNode,
  trackGain: number,
) {
  const startTime = beatsToSeconds(startBeat, tempo);
  const durSec = beatsToSeconds(durationBeats, tempo);
  const freq = 440 * Math.pow(2, (pitch - 69) / 12);
  const vel = Math.max(0.1, velocity / 127);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800 + vel * 1800;
  filter.Q.value = 0.8;

  const env = ctx.createGain();
  const amp = vel * 0.55 * trackGain;
  env.gain.setValueAtTime(0.0001, startTime);
  env.gain.linearRampToValueAtTime(amp, startTime + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, startTime + durSec);

  osc.connect(filter);
  filter.connect(env);
  env.connect(dest);

  osc.start(startTime);
  osc.stop(startTime + durSec + 0.05);
}

function computeProjectDurationBeats(project: Project): number {
  let maxBeat = 4;
  project.tracks.forEach((t) => {
    (t.audioClips || []).forEach((c) => {
      maxBeat = Math.max(maxBeat, c.startBeat + c.durationBeats);
    });
    (t.midiClips || []).forEach((c) => {
      maxBeat = Math.max(maxBeat, c.startBeat + c.durationBeats);
    });
  });
  return maxBeat + 2;
}

export async function exportProjectMix(project: Project): Promise<Blob> {
  await audioEngine.ensureDemoSounds();

  const tempo = project.tempo;
  const durationBeats = computeProjectDurationBeats(project);
  const durationSec = beatsToSeconds(durationBeats, tempo) + 0.5;

  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * 44100), 44100);

  const master = ctx.createGain();
  master.gain.value = 0.82;
  master.connect(ctx.destination);

  const bufferMap = new Map<string, AudioBuffer>();
  for (const loaded of audioEngine.getLoadedAudios()) {
    bufferMap.set(loaded.id, copyBuffer(ctx, loaded.buffer));
    if (loaded.id.startsWith('demo:')) {
      bufferMap.set(loaded.id, copyBuffer(ctx, loaded.buffer));
    }
  }

  for (const track of project.tracks) {
    const eff = getEffectiveGain(track, project.tracks);
    if (eff <= 0) continue;

    const input = ctx.createGain();
    let chainEnd: AudioNode = input;

    for (const insert of track.inserts || []) {
      const node = createOfflineInsert(ctx, insert);
      if (!node) continue;

      // Handle complex inserts that expose _out (e.g. delay)
      const outNode = (node as any)._out || node;
      chainEnd.connect(node);
      chainEnd = outNode;
    }

    const fader = ctx.createGain();
    fader.gain.value = eff;
    const panner = ctx.createStereoPanner();
    panner.pan.value = track.pan;

    chainEnd.connect(fader);
    fader.connect(panner);
    panner.connect(master);

    if (track.audioClips) {
      for (const clip of track.audioClips) {
        const key = clip.storagePath.startsWith('local:')
          ? clip.storagePath.slice(6)
          : clip.storagePath;
        const buffer = bufferMap.get(key);
        if (!buffer) continue;

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const clipGain = ctx.createGain();
        clipGain.gain.value = 1;
        source.connect(clipGain);
        clipGain.connect(input);

        const startTime = beatsToSeconds(clip.startBeat, tempo);
        const offsetSec = beatsToSeconds(clip.offsetBeats, tempo);
        const playDur = beatsToSeconds(clip.durationBeats, tempo);

        applyFadeCurve(clipGain.gain, startTime, playDur, clip.fadeInMs ?? 0, clip.fadeInCurve ?? 'linear', 'in');
        applyFadeCurve(clipGain.gain, startTime, playDur, clip.fadeOutMs ?? 0, clip.fadeOutCurve ?? 'linear', 'out');

        source.start(startTime, offsetSec, playDur);
      }
    }

    if (track.midiClips) {
      for (const clip of track.midiClips) {
        for (const note of clip.notes) {
          scheduleOfflineNote(
            ctx,
            tempo,
            note.pitch,
            note.velocity,
            clip.startBeat + note.startBeat,
            note.durationBeats,
            input,
            eff,
          );
        }
      }
    }
  }

  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

export async function exportAndDownload(project: Project): Promise<void> {
  const blob = await exportProjectMix(project);
  const safeName = project.name.replace(/[^\w\-]+/g, '_') || 'mix';
  downloadBlob(blob, `${safeName}.wav`);
}