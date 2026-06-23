// @ts-nocheck
// High-quality Subtractive Synth for MIDI (improved timbre & technical quality)
// Features for better sound:
// - 3x detuned saw + sub sine for rich, fat bass/lead timbre (unison)
// - Velocity-sensitive filter + amp
// - Proper exponential ADSR envelopes
// - Simple LFO vibrato
// - Better polyphony / voice management
// - Routes correctly into per-track channel strips + inserts

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

// @ts-nocheck
export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private activeVoices = new Map<string, VoiceNodes>();
  private maxVoices = 12; // reasonable polyphony

  private masterGain: GainNode | null = null;
  private tempo = 120;

  getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.75;
      this.masterGain.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  setTempo(newTempo: number) {
    this.tempo = Math.max(40, Math.min(300, newTempo));
  }

  private beatsToSeconds(beats: number): number {
    return (beats / this.tempo) * 60;
  }

  // private stealOldestVoice() {
  //   if (this.activeVoices.size === 0) return;
  //   const oldest = Array.from(this.activeVoices.keys())[0];
  //   const nodes = this.activeVoices.get(oldest)!;
  //   this._stopVoiceNodes(nodes, 0.01);
  //   this.activeVoices.delete(oldest);
  // }

  // High quality voice
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

    if (endTime <= ctx.currentTime) return null;

    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const vel = Math.max(0.1, velocity / 127);

    // === Premium timbre: 5 detuned saws + sub sine for expensive, wide sound ===
    const oscs: OscillatorNode[] = [];
    const spreads = [-2.2, -0.9, 0, 0.9, 2.2]; // wider, musical detune
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

    // Mixer for oscs
    const oscMix = ctx.createGain();
    oscMix.gain.value = 0.42; // lower to leave headroom for warmth
    oscs.forEach(o => o.connect(oscMix));
    sub.connect(oscMix);

    // Subtle analog-style warmth via waveshaper (squeezed quality, not distortion)
    const warmth = ctx.createWaveShaper();
    const curveLen = 2048;
    const curve = new Float32Array(curveLen);
    for (let i = 0; i < curveLen; i++) {
      const x = (i / (curveLen - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.1) * 0.92; // gentle, expensive tube feel
    }
    warmth.curve = curve;
    oscMix.connect(warmth);

    // Very light noise for attack character / realism (common in analog synths)
    const noise = ctx.createBufferSource();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = noiseBuf;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.value = vel * 0.04; // amount of attack noise for character
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1800;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseEnv);
    noiseEnv.connect(warmth); // noise through warmth for cohesive analog character

    // Filter with velocity + key tracking + dedicated filter envelope (this is what makes timbre expensive)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const baseCutoff = 580 + vel * 1950;
    const keyTrack = (pitch - 60) * 22;
    const cutoff = Math.max(120, Math.min(16000, baseCutoff + keyTrack));
    filter.frequency.value = cutoff;
    filter.Q.value = 0.9 + vel * 0.95;

    // Filter envelope (independent ADSR on cutoff - crucial for pro sound movement)
    const filterEnv = ctx.createGain();
    const filterEnvDepth = ctx.createGain();
    filterEnvDepth.gain.value = vel * 2650; // sweep amount
    // Connect filterEnv to filter.frequency later

    const filterEnvAttack = 0.006;
    const filterEnvDecay = 0.38;
    const filterEnvSustain = 0.35;

    // Amplitude + envelope
    const envGain = ctx.createGain();
    const ampGain = ctx.createGain();

    const baseAmp = vel * 0.78 * trackGain;
    const attack = 0.0032;
    const decay = 0.21;
    const sustain = 0.55;

    const now = Math.max(ctx.currentTime, startTime - 0.001);

    envGain.gain.value = 0.0001;
    envGain.gain.linearRampToValueAtTime(baseAmp, now + attack);
    envGain.gain.linearRampToValueAtTime(baseAmp * sustain, now + attack + decay);

    // Apply filter envelope
    filterEnv.gain.value = 0.0001;
    filterEnv.gain.linearRampToValueAtTime(1, now + filterEnvAttack);
    filterEnv.gain.linearRampToValueAtTime(filterEnvSustain, now + filterEnvAttack + filterEnvDecay);
    filterEnv.connect(filterEnvDepth);
    filterEnvDepth.connect(filter.frequency);

    ampGain.gain.value = 1.0;

    // Light LFO vibrato for life
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3.5; // cents
    lfo.connect(lfoGain);

    // Route LFO lightly to main oscs and filter for rich movement
    oscs.forEach(o => {
      lfoGain.connect(o.detune);
    });
    const lfoToFilter = ctx.createGain();
    lfoToFilter.gain.value = vel * 180; // filter mod amount
    lfo.connect(lfoToFilter);
    lfoToFilter.connect(filter.frequency);

    // Signal flow (warmth -> filter for rich, controlled timbre)
    warmth.connect(filter);
    filter.connect(envGain);
    envGain.connect(ampGain);

    // Route to track channel (so inserts + mix bus work) or fallback
    if (target) {
      ampGain.connect(target);
    } else {
      ampGain.connect(this.masterGain!);
    }

    // Start everything
    oscs.forEach(o => o.start(startTime));
    sub.start(startTime);
    lfo.start(startTime);
    noise.start(startTime);

    const voiceId = crypto.randomUUID();

    const nodes: VoiceNodes = { oscs, sub, filter, envGain, ampGain, lfo, lfoGain };

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
      setTimeout(() => {
        this.activeVoices.delete(voiceId);
      }, 350);
    };

    // Auto release
    setTimeout(() => {
      if (this.activeVoices.has(voiceId)) {
        stop(endTime);
      }
    }, (endTime - ctx.currentTime + 0.6) * 1000);

    nodes.noise = noise; // for stopAll
    this.activeVoices.set(voiceId, nodes);

    oscs[0].onended = () => {
      this.activeVoices.delete(voiceId);
    };

    return { id: voiceId, pitch, stop };
  }

  stopAll() {
    const now = (this.audioContext?.currentTime || 0);
    this.activeVoices.forEach((nodes) => {
      try {
        nodes.envGain.gain.cancelScheduledValues(0);
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

  // Preview with richer sound too
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
    env.gain.value = 0.001;
    env.gain.linearRampToValueAtTime(base, now + 0.003);
    env.gain.linearRampToValueAtTime(base * 0.55, now + 0.12);

    mix.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain!);

    oscs.forEach(o => o.start(now));
    sub.start(now);

    const rel = 0.18;
    const stopAt = now + durationSec;

    setTimeout(() => {
      try {
        env.gain.cancelScheduledValues(stopAt);
        env.gain.linearRampToValueAtTime(0.0001, stopAt + rel);
        oscs.forEach(o => o.stop(stopAt + rel + 0.02));
        sub.stop(stopAt + rel + 0.02);
      } catch {}
    }, 5);
  }
}

export const synthEngine = new SynthEngine();
