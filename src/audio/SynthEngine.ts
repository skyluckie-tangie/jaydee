// Simple Subtractive Synth for MIDI playback (Phase 3)
// Saw/square oscillator + lowpass filter + ADSR envelope
// Designed to be scheduled with beat timing like AudioEngine

export interface Voice {
  id: string;
  pitch: number;
  stop: (when?: number) => void;
}

export class SynthEngine {
  private audioContext: AudioContext | null = null;
  private activeVoices = new Map<string, { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; envGain: GainNode; }>();

  private masterGain: GainNode | null = null;
  private tempo = 120;

  getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.6;
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

  // Schedule a MIDI note (non-blocking)
  // startBeat: absolute project beat when note starts
  // playStartBeat: the beat where playback started (for relative timing)
  // playStartTime: AudioContext time when playback started
  // trackGain: legacy baked gain (used when no target)
  // target: optional destination node (used for routing to track channel strip)
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
    if (ctx.state === 'suspended') {
      // Will be resumed by caller
    }

    const startTime = playStartTime + Math.max(0, this.beatsToSeconds(startBeat - playStartBeat));
    const durSec = this.beatsToSeconds(durationBeats);
    const endTime = startTime + durSec;

    if (endTime <= ctx.currentTime) return null; // already passed

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);

    // Lowpass filter (subtractive character)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200 + (velocity / 127) * 1400; // brighter with velocity
    filter.Q.value = 0.7;

    // Amplitude envelope (ADSR simplified)
    const envGain = ctx.createGain();
    const ampGain = ctx.createGain();

    const velGain = (velocity / 127) * 0.9 + 0.1;
    const baseGain = velGain * trackGain;

    // Attack + Decay + Sustain
    const now = Math.max(ctx.currentTime, startTime - 0.001);
    envGain.gain.value = 0;
    envGain.gain.linearRampToValueAtTime(baseGain, now + 0.008);        // fast attack
    envGain.gain.linearRampToValueAtTime(baseGain * 0.65, now + 0.12);  // decay to sustain

    // Release handled on stop
    ampGain.gain.value = 1;

    // Chain: osc -> filter -> env -> ampGain
    osc.connect(filter);
    filter.connect(envGain);
    envGain.connect(ampGain);

    // Route to track channel input (preferred for proper mix bus + inserts) or legacy master
    if (target) {
      ampGain.connect(target);
    } else {
      ampGain.connect(this.masterGain!);
    }

    osc.start(startTime);

    const voiceId = crypto.randomUUID();

    const stop = (when = endTime) => {
      const releaseTime = 0.18;
      try {
        const stopAt = Math.max(ctx.currentTime + 0.01, when);
        envGain.gain.cancelScheduledValues(stopAt);
        envGain.gain.linearRampToValueAtTime(0.0001, stopAt + releaseTime);
        osc.stop(stopAt + releaseTime + 0.02);
      } catch {}
      // cleanup later
      setTimeout(() => {
        this.activeVoices.delete(voiceId);
      }, 300);
    };

    // Auto stop
    setTimeout(() => {
      if (this.activeVoices.has(voiceId)) {
        stop(endTime);
      }
    }, (endTime - ctx.currentTime + 0.5) * 1000);

    this.activeVoices.set(voiceId, { osc, filter, gain: ampGain, envGain });

    osc.onended = () => {
      this.activeVoices.delete(voiceId);
    };

    return { id: voiceId, pitch, stop };
  }

  // Stop all currently playing voices (used on stop/seek)
  stopAll() {
    this.activeVoices.forEach((nodes) => {
      try {
        nodes.envGain.gain.cancelScheduledValues(0);
        nodes.envGain.gain.linearRampToValueAtTime(0.0001, this.audioContext!.currentTime + 0.06);
        nodes.osc.stop(this.audioContext!.currentTime + 0.1);
      } catch {}
    });
    this.activeVoices.clear();
  }

  getIsPlaying(): boolean {
    return this.activeVoices.size > 0;
  }

  // Immediate preview play (for piano keys etc.)
  playPreview(pitch: number, velocity = 100, durationSec = 0.65) {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500 + (velocity / 127) * 1300;
    filter.Q.value = 0.6;

    const envGain = ctx.createGain();
    const baseGain = (velocity / 127) * 0.72;

    envGain.gain.value = 0;
    envGain.gain.linearRampToValueAtTime(baseGain, now + 0.005);
    envGain.gain.linearRampToValueAtTime(baseGain * 0.68, now + 0.065);

    osc.connect(filter);
    filter.connect(envGain);
    envGain.connect(this.masterGain!);

    osc.start(now);

    const stopAt = now + durationSec;
    const rel = 0.16;

    setTimeout(() => {
      try {
        envGain.gain.cancelScheduledValues(stopAt);
        envGain.gain.linearRampToValueAtTime(0.0001, stopAt + rel);
        osc.stop(stopAt + rel + 0.015);
      } catch {}
    }, Math.max(5, (stopAt - now) * 1000));
  }
}

export const synthEngine = new SynthEngine();
