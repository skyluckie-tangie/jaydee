// @ts-nocheck
// Subtractive Synth for MIDI — shares AudioEngine's AudioContext for mixer routing

export interface Voice {
  id: string;
  pitch: number;
  stop: (when?: number) => void;
}

interface VoiceNodes {
  oscs: OscillatorNode[];
  sub: OscillatorNode | null;
  filter: BiquadFilterNode;
  envGain: GainNode;
  ampGain: GainNode;
  lfo: OscillatorNode | null;
  lfoGain: GainNode | null;
  noise?: AudioBufferSourceNode;
}

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices = new Map<string, VoiceNodes>();
  private tempo = 120;

  /** Must use the same context as AudioEngine so notes route into channel strips */
  bindContext(ctx: AudioContext, masterBus?: GainNode | null) {
    if (this.audioContext && this.audioContext !== ctx) {
      this.stopAll();
    }
    this.audioContext = ctx;
    this.masterGain = masterBus ?? this.masterGain;
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0.75;
      this.masterGain.connect(ctx.destination);
    }
  }

  getContext(): AudioContext {
    if (!this.audioContext) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.bindContext(ctx);
    }
    return this.audioContext!;
  }

  setTempo(newTempo: number) {
    this.tempo = Math.max(40, Math.min(300, newTempo));
  }

  private beatsToSeconds(beats: number): number {
    return (beats / this.tempo) * 60;
  }

  scheduleNote(
    pitch: number,
    velocity: number,
    startBeat: number,
    durationBeats: number,
    playStartBeat: number,
    playStartTime: number,
    trackGain = 0.8,
    target?: AudioNode
  ): Voice | null {
    const ctx = this.getContext();

    const startTime = playStartTime + Math.max(0, this.beatsToSeconds(startBeat - playStartBeat));
    const durSec = this.beatsToSeconds(durationBeats);
    const endTime = startTime + durSec;

    if (endTime <= ctx.currentTime + 0.001) return null;

    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const vel = Math.max(0.1, velocity / 127);

    const oscs: OscillatorNode[] = [];
    const spreads = [-2.2, -0.9, 0, 0.9, 2.2];
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = spreads[i] * 0.11;
      oscs.push(o);
    }

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;

    const oscMix = ctx.createGain();
    oscMix.gain.value = 0.42;
    oscs.forEach(o => o.connect(oscMix));
    sub.connect(oscMix);

    const warmth = ctx.createWaveShaper();
    const curveLen = 2048;
    const curve = new Float32Array(curveLen);
    for (let i = 0; i < curveLen; i++) {
      const x = (i / (curveLen - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.1) * 0.92;
    }
    warmth.curve = curve;
    oscMix.connect(warmth);

    const noise = ctx.createBufferSource();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = noiseBuf;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.value = vel * 0.04;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1800;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseEnv);
    noiseEnv.connect(warmth);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const baseCutoff = 580 + vel * 1950;
    const keyTrack = (pitch - 60) * 22;
    const cutoff = Math.max(120, Math.min(16000, baseCutoff + keyTrack));
    filter.frequency.value = cutoff;
    filter.Q.value = 0.9 + vel * 0.95;

    const filterEnv = ctx.createGain();
    const filterEnvDepth = ctx.createGain();
    filterEnvDepth.gain.value = vel * 2650;

    const filterEnvAttack = 0.006;
    const filterEnvDecay = 0.38;
    const filterEnvSustain = 0.35;

    const envGain = ctx.createGain();
    const ampGain = ctx.createGain();

    const baseAmp = vel * 0.78 * trackGain;
    const attack = 0.0032;
    const decay = 0.21;
    const sustain = 0.55;

    const t0 = Math.max(startTime, ctx.currentTime);

    envGain.gain.cancelScheduledValues(t0);
    envGain.gain.setValueAtTime(0.0001, t0);
    envGain.gain.linearRampToValueAtTime(baseAmp, t0 + attack);
    envGain.gain.linearRampToValueAtTime(baseAmp * sustain, t0 + attack + decay);
    envGain.gain.setValueAtTime(baseAmp * sustain, Math.max(t0 + attack + decay, endTime - 0.08));
    envGain.gain.linearRampToValueAtTime(0.0001, endTime);

    filterEnv.gain.cancelScheduledValues(t0);
    filterEnv.gain.setValueAtTime(0.0001, t0);
    filterEnv.gain.linearRampToValueAtTime(1, t0 + filterEnvAttack);
    filterEnv.gain.linearRampToValueAtTime(filterEnvSustain, t0 + filterEnvAttack + filterEnvDecay);
    filterEnv.connect(filterEnvDepth);
    filterEnvDepth.connect(filter.frequency);

    ampGain.gain.value = 1.0;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3.5;
    lfo.connect(lfoGain);
    oscs.forEach(o => lfoGain.connect(o.detune));
    const lfoToFilter = ctx.createGain();
    lfoToFilter.gain.value = vel * 180;
    lfo.connect(lfoToFilter);
    lfoToFilter.connect(filter.frequency);

    warmth.connect(filter);
    filter.connect(envGain);
    envGain.connect(ampGain);

    if (target) {
      ampGain.connect(target);
    } else if (this.masterGain) {
      ampGain.connect(this.masterGain);
    }

    oscs.forEach(o => o.start(startTime));
    sub.start(startTime);
    lfo.start(startTime);
    noise.start(startTime);

    const voiceId = crypto.randomUUID();
    const nodes: VoiceNodes = { oscs, sub, filter, envGain, ampGain, lfo, lfoGain, noise };

    const stop = (when = endTime) => {
      const release = 0.22;
      const stopAt = Math.max(ctx.currentTime + 0.005, when);
      try {
        envGain.gain.cancelScheduledValues(stopAt);
        envGain.gain.linearRampToValueAtTime(0.0001, stopAt + release);
        oscs.forEach(o => o.stop(stopAt + release + 0.03));
        if (sub) sub.stop(stopAt + release + 0.03);
        if (lfo) lfo.stop(stopAt + release + 0.03);
        if (noise) noise.stop(stopAt + 0.02);
      } catch {}
      setTimeout(() => this.activeVoices.delete(voiceId), 350);
    };

    setTimeout(() => {
      if (this.activeVoices.has(voiceId)) stop(endTime);
    }, Math.max(0, (endTime - ctx.currentTime + 0.6) * 1000));

    this.activeVoices.set(voiceId, nodes);
    oscs[0].onended = () => this.activeVoices.delete(voiceId);

    return { id: voiceId, pitch, stop };
  }

  stopAll() {
    const now = this.audioContext?.currentTime || 0;
    this.activeVoices.forEach((nodes) => {
      try {
        nodes.envGain.gain.cancelScheduledValues(now);
        nodes.envGain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
        nodes.oscs.forEach(o => o.stop(now + 0.08));
        if (nodes.sub) nodes.sub.stop(now + 0.08);
        if (nodes.lfo) nodes.lfo.stop(now + 0.08);
        if (nodes.noise) nodes.noise.stop(now + 0.04);
      } catch {}
    });
    this.activeVoices.clear();
  }

  getIsPlaying(): boolean {
    return this.activeVoices.size > 0;
  }

  playPreview(pitch: number, velocity = 110, durationSec = 0.7) {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const vel = velocity / 127;

    const oscs: OscillatorNode[] = [];
    for (let i = -1; i <= 1; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = i * 0.07;
      oscs.push(o);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;

    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    oscs.forEach(o => o.connect(mix));
    sub.connect(mix);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900 + vel * 1600;
    filter.Q.value = 1.3;

    const env = ctx.createGain();
    const base = vel * 0.9;
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(base, now + 0.003);
    env.gain.linearRampToValueAtTime(base * 0.55, now + 0.12);

    mix.connect(filter);
    filter.connect(env);
    if (this.masterGain) env.connect(this.masterGain);

    oscs.forEach(o => o.start(now));
    sub.start(now);

    const rel = 0.18;
    const stopAt = now + durationSec;
    env.gain.linearRampToValueAtTime(0.0001, stopAt + rel);
    oscs.forEach(o => o.stop(stopAt + rel + 0.02));
    sub.stop(stopAt + rel + 0.02);
  }
}

export const synthEngine = new SynthEngine();