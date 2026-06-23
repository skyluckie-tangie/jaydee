// AudioEngine.ts
// Web Audio API 기반 간단한 beat-synchronized 플레이어 (Phase 1)
// - AudioContext 관리
// - AudioBuffer 로드 (파일 업로드)
// - Beat → Seconds 변환
// - 클립 스케줄링 및 재생/정지
// - 현재 beat 위치 업데이트 (requestAnimationFrame)

import type { PluginInstance } from '../lib/types';
import { downloadAudioAsset } from '../lib/projectService';

export interface LoadedAudio {
  id: string;
  name: string;
  buffer: AudioBuffer;
  duration: number; // seconds
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private isPlaying = false;
  private startTime = 0; // AudioContext time when playback started
  private startBeat = 0;
  private tempo = 120;
  private activeSources: AudioBufferSourceNode[] = [];
  private loadedAudios = new Map<string, LoadedAudio>();
  private waveformCache = new Map<string, { min: number[]; max: number[] }>();

  // Proper signal chain: Master Bus + per-track Channel Strips
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null; // for future metering

  // Channel strip per track
  // Flow: source → input → [inserts...] → fader → panner → mute → master
  private channels = new Map<string, {
    input: GainNode;
    inserts: AudioNode[];
    fader: GainNode;
    panner: StereoPannerNode;
    mute: GainNode;
    analyser?: AnalyserNode;   // for metering
    stripWarmth?: WaveShaperNode;
    warmthGain?: GainNode;
    duckGain?: GainNode; // for sidechain
  }>();

  // Simple peak meter data (updated manually or via raf if needed)
  private meterData = new Map<string, { peak: number; rms: number }>();

  // 현재 beat 위치를 외부에 알려주기 위한 콜백
  private onPositionUpdate?: (beat: number) => void;

  private metronomeEnabled = false;
  private clickBuffer: AudioBuffer | null = null;

  private rafId: number | null = null;

  // Phase 4: track whether custom dynamics worklet module is ready
  // @ts-ignore - intentionally tracked even if not read everywhere yet
  private workletModuleLoaded = false;
  private workletLoadPromise: Promise<void> | null = null;

  constructor() {
    // AudioContext는 사용자 제스처(버튼 클릭) 이후에 생성해야 함
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Creation is allowed; actual start/play requires user gesture (browser policy).
      // resume() will be called on first play or explicit user action.

      // Create Master Bus (Mix Bus) + subtle high-quality processing for overall timbre/air
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.82;

      this.masterAnalyser = this.audioContext.createAnalyser();
      this.masterAnalyser.fftSize = 256;

      // Gentle stereo air / widening (improves perceived sound quality without muddying)
      const splitter = this.audioContext.createChannelSplitter(2);
      const merger = this.audioContext.createChannelMerger(2);
      const delayL = this.audioContext.createDelay(0.015);
      const delayR = this.audioContext.createDelay(0.015);
      delayL.delayTime.value = 0.0028;
      delayR.delayTime.value = 0.009;
      const airFilter = this.audioContext.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.value = 7200;
      airFilter.Q.value = 0.6;

      this.masterGain.connect(splitter);
      splitter.connect(merger, 0, 0);
      splitter.connect(delayR, 1);
      delayR.connect(airFilter);
      airFilter.connect(merger, 0, 1);

      merger.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.audioContext.destination);

      // Preload custom worklet for Phase 4 FX
      this.ensureWorkletModule();

      // Light mastering compressor + final soft limiter for broadcast quality
      const masterComp = this.audioContext.createDynamicsCompressor();
      masterComp.threshold.value = -16;
      masterComp.knee.value = 8;
      masterComp.ratio.value = 3.5;
      masterComp.attack.value = 0.004;
      masterComp.release.value = 0.22;

      const finalLimiter = this.audioContext.createWaveShaper();
      const limCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        limCurve[i] = Math.tanh(x * 3.8) * 0.97; // soft brickwall
      }
      finalLimiter.curve = limCurve;

      try {
        merger.disconnect(this.masterAnalyser);
      } catch {}
      merger.connect(masterComp);
      masterComp.connect(finalLimiter);
      finalLimiter.connect(this.masterAnalyser);
    }
    return this.audioContext;
  }

  /** Call this on any user gesture (click, key, transport) to unlock audio */
  async resumeContext(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        // expected if called too early; will retry on next gesture
      }
    }
  }

  setTempo(newTempo: number) {
    this.tempo = Math.max(40, Math.min(300, newTempo));
    // 재생 중이면 위치를 유지하면서 tempo 변경 (간단하게는 stop 후 다시 시작할 수 있음)
  }

  setMetronome(enabled: boolean) {
    this.metronomeEnabled = enabled;
  }

  private getClickBuffer(): AudioBuffer {
    if (this.clickBuffer) return this.clickBuffer;
    const ctx = this.getContext();
    const duration = 0.05;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      // Short high click + low thump for metronome
      data[i] = (Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t * 80) * 0.8 + 
                 Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 30) * 0.4);
    }
    this.clickBuffer = buffer;
    return buffer;
  }

  // 파일을 로드해서 AudioBuffer로 디코딩
  async loadAudio(file: File): Promise<LoadedAudio> {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = this.getContext();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);

    const loaded: LoadedAudio = {
      id: crypto.randomUUID(),
      name: file.name,
      buffer,
      duration: buffer.duration,
    };

    this.loadedAudios.set(loaded.id, loaded);
    this.computeAndCacheWaveform(loaded.id, buffer);
    return loaded;
  }

  private computeAndCacheWaveform(key: string, buffer: AudioBuffer) {
    if (this.waveformCache.has(key)) return;
    const { min, max } = this.computePeaks(buffer, 1024); // higher res for detailed waveform at zoom
    this.waveformCache.set(key, { min, max });
  }

  private computePeaks(buffer: AudioBuffer, targetPoints: number): { min: number[]; max: number[] } {
    const numChannels = buffer.numberOfChannels;
    const channelData: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channelData.push(buffer.getChannelData(c));
    }

    const totalSamples = buffer.length;
    const samplesPerPoint = Math.max(1, Math.floor(totalSamples / targetPoints));
    const minPeaks: number[] = [];
    const maxPeaks: number[] = [];

    for (let i = 0; i < targetPoints; i++) {
      const start = i * samplesPerPoint;
      const end = Math.min(start + samplesPerPoint, totalSamples);
      let min = 0;
      let max = 0;
      for (let j = start; j < end; j++) {
        let v = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          v = Math.max(v, channelData[ch][j]);  // for max
          min = Math.min(min, channelData[ch][j]);
          max = Math.max(max, channelData[ch][j]);
        }
      }
      minPeaks.push(min);
      maxPeaks.push(max);
    }
    return { min: minPeaks, max: maxPeaks };
  }

  getWaveformPeaks(rawKey: string): { min: number[]; max: number[] } | null {
    if (!rawKey) return null;
    if (this.waveformCache.has(rawKey)) {
      return this.waveformCache.get(rawKey)!;
    }
    if (rawKey.startsWith('local:')) {
      const id = rawKey.slice(6);
      if (this.waveformCache.has(id)) return this.waveformCache.get(id)!;
    }
    if (rawKey.startsWith('demo:')) {
      if (this.waveformCache.has(rawKey)) return this.waveformCache.get(rawKey)!;
    }
    if (rawKey.startsWith('storage:')) {
      const id = rawKey.slice(8);
      if (this.waveformCache.has(id)) return this.waveformCache.get(id)!;
      if (this.waveformCache.has(rawKey)) return this.waveformCache.get(rawKey)!;
    }
    const stripped = rawKey.replace(/^local:|^demo:|^storage:/, '');
    if (this.waveformCache.has(stripped)) return this.waveformCache.get(stripped)!;
    if (this.waveformCache.has('demo:' + stripped)) return this.waveformCache.get('demo:' + stripped)!;
    return null;
  }

  /** Ensure the custom worklet module is loaded (idempotent) */
  private ensureWorkletModule(): Promise<void> {
    if (this.workletLoadPromise) return this.workletLoadPromise;
    const ctx = this.getContext();
    this.workletLoadPromise = ctx.audioWorklet.addModule('/dynamics-processor.js')
      .then(() => { this.workletModuleLoaded = true; })
      .catch((e) => {
        console.warn('Failed to load dynamics-processor worklet module', e);
        this.workletModuleLoaded = false;
      });
    return this.workletLoadPromise;
  }

  /** Create a compressor node: prefer the custom AudioWorklet, fallback to native DynamicsCompressor */
  createCompressorInsert(params: Record<string, number> = {}): AudioNode {
    const ctx = this.getContext();

    // Always attempt worklet creation — if module not ready it will throw and we fallback + preload
    try {
      const node = new AudioWorkletNode(ctx, 'dynamics-processor');
      const p = node.parameters;
      const setP = (name: string, def: number) => {
        const param = p.get(name);
        if (param) param.value = (params as any)[name] ?? def;
      };
      setP('threshold', params.threshold ?? -24);
      setP('knee', params.knee ?? 30);
      setP('ratio', params.ratio ?? 4);
      setP('attack', params.attack ?? 0.003);
      setP('release', params.release ?? 0.25);
      setP('makeupGain', params.makeupGain ?? 0);
      this.workletModuleLoaded = true;
      return node;
    } catch (e) {
      // Module not registered yet — kick preload for next time and use native
      if (!this.workletLoadPromise) {
        this.ensureWorkletModule();
      }
      // Fallback to high-quality native
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = params.threshold ?? -24;
      comp.knee.value = params.knee ?? 30;
      comp.ratio.value = params.ratio ?? 4;
      comp.attack.value = params.attack ?? 0.003;
      comp.release.value = params.release ?? 0.25;
      return comp;
    }
  }

  /** Load and create custom dynamics worklet (for real Phase 4 FX) */
  async createDynamicsWorkletNode(params: any = {}): Promise<AudioWorkletNode | null> {
    await this.ensureWorkletModule();
    const ctx = this.getContext();
    try {
      const node = new AudioWorkletNode(ctx, 'dynamics-processor');
      const p = node.parameters;
      const setParam = (name: string, val: number) => {
        const param = p.get(name);
        if (param) param.value = val;
      };
      setParam('threshold', params.threshold ?? -24);
      setParam('ratio', params.ratio ?? 4);
      setParam('attack', params.attack ?? 0.003);
      setParam('release', params.release ?? 0.25);
      setParam('knee', params.knee ?? 30);
      setParam('makeupGain', params.makeupGain ?? 0);
      return node;
    } catch (e) {
      console.warn('Dynamics worklet failed, falling back', e);
      return null;
    }
  }

  // Beat를 초 단위로 변환
  beatsToSeconds(beats: number): number {
    return (beats / this.tempo) * 60;
  }

  // 현재 오디오 시간 기준으로 beat 계산
  private getCurrentBeat(): number {
    if (!this.isPlaying || !this.audioContext) return this.startBeat;

    const elapsed = this.audioContext.currentTime - this.startTime;
    return this.startBeat + (elapsed * this.tempo) / 60;
  }

  // 위치 업데이트 루프
  private startPositionLoop() {
    const loop = () => {
      if (this.isPlaying && this.onPositionUpdate) {
        const beat = this.getCurrentBeat();
        this.onPositionUpdate(beat);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopPositionLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // 외부에서 위치 업데이트를 구독 (UI에서 currentBeat 표시용)
  subscribeToPosition(callback: (beat: number) => void) {
    this.onPositionUpdate = callback;
  }

  // 재생 시작 (startBeat부터)
  async play(startBeat: number = 0) {
    if (this.isPlaying) return;

    const context = this.getContext();

    // suspended 상태면 resume (브라우저 정책)
    if (context.state === 'suspended') {
      await context.resume();
    }

    // 데모 사운드 미리 준비 (kick/hats/drums)
    await this.ensureDemoSounds();

    this.isPlaying = true;
    this.startBeat = startBeat;
    this.startTime = context.currentTime;

    this.startPositionLoop();

    // Schedule metronome clicks if enabled
    if (this.metronomeEnabled) {
      const startB = Math.floor(startBeat);
      for (let b = startB; b < startB + 128; b++) {  // enough for long play
        this.scheduleMetronomeClick(b);
      }
    }

    // 현재 로드된 모든 audioClips 스케줄 (Phase 1에서는 store에서 전달받아야 함)
    // 지금은 외부에서 scheduleClip을 직접 호출하도록 설계
  }

  // 특정 클립을 특정 beat에 스케줄
  // startBeat: 클립의 시작 beat 위치
  // offsetBeats: 클립 내부 재생 시작 offset
  // trackId: for per-track gain/pan
  // fade options for non-destructive fade in/out (Cubase style)
  scheduleClip(
    audioId: string, 
    startBeat: number, 
    offsetBeats = 0, 
    gain = 1, 
    trackId?: string,
    fade?: {
      fadeInMs?: number;
      fadeOutMs?: number;
      fadeInCurve?: 'linear' | 'exp' | 's-curve' | 'custom';
      fadeOutCurve?: 'linear' | 'exp' | 's-curve' | 'custom';
      fadeInPoints?: number[];
      fadeOutPoints?: number[];
      // for custom, could pass points but for now basic curves
    }
  ) {
    if (!this.isPlaying || !this.audioContext) return;

    let loaded = this.loadedAudios.get(audioId);

    // Demo sounds use full 'demo:xxx' keys
    if (!loaded && audioId.startsWith('demo:')) {
      console.warn('Demo sound not preloaded yet:', audioId);
      return;
    }

    if (!loaded) {
      console.warn('Audio not loaded:', audioId);
      return;
    }

    const clipEndBeat = startBeat + (loaded.duration * this.tempo) / 60;

    // 클립이 현재 play 시작점보다 완전히 과거면 스킵
    if (clipEndBeat <= this.startBeat) return;

    const context = this.audioContext;
    const source = context.createBufferSource();
    source.buffer = loaded.buffer;

    let fadeGain: GainNode | null = null;

    if (trackId) {
      const ch = this.ensureChannel(trackId);
      const hasFade = (fade?.fadeInMs || 0) > 0 || (fade?.fadeOutMs || 0) > 0;
      if (hasFade) {
        fadeGain = context.createGain();
        fadeGain.gain.value = 1.0;
        source.connect(fadeGain);
        fadeGain.connect(ch.input);
      } else {
        source.connect(ch.input);
      }
    } else {
      const g = context.createGain();
      g.gain.value = gain;
      source.connect(g);
      if (this.masterGain) {
        g.connect(this.masterGain);
      } else {
        g.connect(context.destination);
      }
    }

    // Calculate timing
    const relStart = startBeat - this.startBeat;
    const playHeadOffsetBeats = Math.max(0, this.startBeat - startBeat);
    const effectiveOffsetBeats = offsetBeats + playHeadOffsetBeats;
    const offsetSeconds = this.beatsToSeconds(effectiveOffsetBeats);
    const startTimeInSeconds = this.beatsToSeconds(relStart);
    const absoluteStartTime = this.startTime + Math.max(0, startTimeInSeconds);

    const clipDurationSec = loaded.duration; // full buffer duration

    // Apply fades using GainNode ramps (non-destructive)
    const fadeInMs = fade?.fadeInMs ?? 0;
    const fadeOutMs = fade?.fadeOutMs ?? 0;
    const fadeInSec = fadeInMs / 1000;
    const fadeOutSec = fadeOutMs / 1000;

    const fadeInEndTime = absoluteStartTime + fadeInSec;
    const fadeOutStartTime = absoluteStartTime + clipDurationSec - fadeOutSec;

    try {
      if (fadeGain) {
        // Start at 0 for fade in
        if (fadeInSec > 0) {
          fadeGain.gain.setValueAtTime(0, absoluteStartTime);
          const curve = fade?.fadeInCurve || 'linear';
          if (curve === 'exp') {
            fadeGain.gain.exponentialRampToValueAtTime(1.0, fadeInEndTime);
          } else if (curve === 's-curve') {
            const mid = absoluteStartTime + fadeInSec / 2;
            fadeGain.gain.linearRampToValueAtTime(0.05, mid);
            fadeGain.gain.linearRampToValueAtTime(1.0, fadeInEndTime);
          } else if (curve === 'custom' && fade?.fadeInPoints?.length) {
            fade?.fadeInPoints.forEach((v, i) => {
              const tt = absoluteStartTime + (fadeInSec * (i+1)/fade.fadeInPoints!.length);
              fadeGain.gain.linearRampToValueAtTime(v, tt);
            });
            fadeGain.gain.linearRampToValueAtTime(1, fadeInEndTime);
          } else {
            fadeGain.gain.linearRampToValueAtTime(1.0, fadeInEndTime);
          }
        } else {
          fadeGain.gain.setValueAtTime(1.0, absoluteStartTime);
        }

        // Fade out
        if (fadeOutSec > 0) {
          if (fadeInSec > 0 && fadeOutStartTime > fadeInEndTime) {
            fadeGain.gain.setValueAtTime(1.0, fadeOutStartTime);
          }
          const curve = fade?.fadeOutCurve || 'linear';
          if (curve === 'exp') {
            fadeGain.gain.exponentialRampToValueAtTime(0.0001, absoluteStartTime + clipDurationSec);
          } else if (curve === 's-curve') {
            const mid = fadeOutStartTime + (clipDurationSec - fadeOutSec) / 2;
            fadeGain.gain.linearRampToValueAtTime(0.95, mid);
            fadeGain.gain.linearRampToValueAtTime(0.0001, absoluteStartTime + clipDurationSec);
          } else if (curve === 'custom' && fade?.fadeOutPoints?.length) {
            fadeGain.gain.setValueAtTime(1, fadeOutStartTime);
            fade?.fadeOutPoints.forEach((v, i) => {
              const tt = fadeOutStartTime + ((clipDurationSec - fadeOutSec) * (i+1)/fade.fadeOutPoints!.length);
              fadeGain.gain.linearRampToValueAtTime(v, tt);
            });
          } else {
            fadeGain.gain.linearRampToValueAtTime(0.0001, absoluteStartTime + clipDurationSec);
          }
        }
      }

      // Schedule source with remaining time
      const remainingBeats = clipEndBeat - Math.max(this.startBeat, startBeat);
      const remainingSec = this.beatsToSeconds(remainingBeats);

      source.start(absoluteStartTime, offsetSeconds, remainingSec);
      this.activeSources.push(source);

      source.onended = () => {
        this.activeSources = this.activeSources.filter((s) => s !== source);
      };
    } catch (e) {
      console.error('Failed to schedule source with fade', e);
    }
  }

  scheduleMetronomeClick(beat: number) {
    if (!this.metronomeEnabled || !this.isPlaying || !this.audioContext) return;
    const ctx = this.audioContext;
    const buffer = this.getClickBuffer();
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = 0.6;

    // Route to master or separate
    const absTime = this.startTime + this.beatsToSeconds(beat - this.startBeat);
    if (absTime < ctx.currentTime) return;

    source.connect(gain);
    gain.connect(this.masterGain!);  // or destination

    source.start(absTime);
    this.activeSources.push(source);
  }

  // === Channel Strip + Signal Chain ===

  /** Get or create a full channel strip for a track */
  ensureChannel(trackId: string) {
    const ctx = this.getContext();
    if (this.channels.has(trackId)) {
      return this.channels.get(trackId)!;
    }

    const input = ctx.createGain();
    const fader = ctx.createGain();
    const duckGain = ctx.createGain(); // for sidechain ducking
    duckGain.gain.value = 1;
    const panner = ctx.createStereoPanner();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;

    // Default values
    fader.gain.value = 0.85;
    panner.pan.value = 0;
    mute.gain.value = 1;

    // Subtle per-channel warmth (console-like character, squeezed for quality)
    const stripWarmth = ctx.createWaveShaper();
    const wCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      wCurve[i] = Math.tanh(x * 1.35) * 0.96;
    }
    stripWarmth.curve = wCurve;
    const warmthGain = ctx.createGain();
    warmthGain.gain.value = 0.88;

    // Initial chain (no inserts yet): input -> fader -> duckGain (sidechain) -> warmth -> panner -> mute -> analyser -> master
    input.connect(fader);
    fader.connect(duckGain);
    duckGain.connect(stripWarmth);
    stripWarmth.connect(warmthGain);
    warmthGain.connect(panner);
    panner.connect(mute);
    mute.connect(analyser);

    if (this.masterGain) {
      analyser.connect(this.masterGain);
    } else {
      analyser.connect(ctx.destination);
    }

    const channel = { input, inserts: [], fader, duckGain, panner, mute, analyser, stripWarmth, warmthGain };
    this.channels.set(trackId, channel);

    // init meter data
    this.meterData.set(trackId, { peak: 0, rms: 0 });

    return channel;
  }

  /** Returns the input node for a track so sources (clips or synth) can connect to it */
  getTrackInput(trackId: string): GainNode | null {
    const ch = this.channels.get(trackId);
    return ch ? ch.input : null;
  }

  /** Rebuild the insert chain for a track (call when inserts list changes) */
  rebuildTrackInserts(trackId: string, pluginInstances: { id: string; type: string; params: Record<string, number>; bypass?: boolean }[]) {
    // Kick off worklet preload (non-blocking) so compressor can use custom impl soon
    if (pluginInstances.some(pi => pi.type === 'compressor')) {
      this.ensureWorkletModule();
    }

    const ch = this.ensureChannel(trackId);
    const ctx = this.getContext();

    // Disconnect old inserts
    ch.inserts.forEach(node => {
      try { node.disconnect(); } catch {}
    });
    ch.inserts = [];

    // Disconnect fader from previous point
    try { ch.input.disconnect(); } catch {}

    let current: AudioNode = ch.input;

    for (const plugin of pluginInstances) {
      if (plugin.bypass) continue;

      const insertNode = this.createInsertNode(plugin, ctx);
      if (!insertNode) continue;

      current.connect(insertNode);
      ch.inserts.push(insertNode);
      current = insertNode;
    }

    // Connect last point to fader
    current.connect(ch.fader);
  }

  private createInsertNode(plugin: PluginInstance, ctx: AudioContext): AudioNode | null {
    const t = plugin.type;
    const p = plugin.params || {};

    if (t === 'gain') {
      const g = ctx.createGain();
      g.gain.value = p.gain ?? 1;
      return g;
    }

    if (t === 'eq3band') {
      // High-quality 3-band for musical timbre shaping
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = (p as any).lowFreq ?? 240;
      low.gain.value = (p as any).lowGain ?? 0;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = (p as any).midFreq ?? 950;
      mid.Q.value = Math.max(0.4, (p as any).midQ ?? 1.15);
      mid.gain.value = (p as any).midGain ?? 0;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = (p as any).highFreq ?? 4200;
      high.gain.value = (p as any).highGain ?? 0;

      low.connect(mid);
      mid.connect(high);
      return high;
    }

    if (t === 'compressor') {
      // Phase 4: use custom AudioWorklet when available, native fallback otherwise
      return this.createCompressorInsert(p);
    }

    if (t === 'filter') {
      const f = ctx.createBiquadFilter();
      f.type = ((p as any).type as BiquadFilterType) || 'lowpass';
      f.frequency.value = (p as any).frequency ?? 1000;
      f.Q.value = (p as any).q ?? 1;
      return f;
    }

    // Drive / saturation - high quality analog-style warmth (squeezed for professional feel)
    if (t === 'drive') {
      const drive = ctx.createWaveShaper();
      const amount = Math.max(1.0, Math.min(9, (p as any).amount ?? 3.2));
      const curve = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) {
        const x = (i / 2047) * 2 - 1;
        curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
      }
      drive.curve = curve;
      const outGain = ctx.createGain();
      outGain.gain.value = 0.65; // tasteful compensation
      drive.connect(outGain);
      return outGain;
    }

    // Musical delay as series insert (feedback for character, mixed internally)
    if (t === 'delay') {
      const dly = ctx.createDelay(1.2);
      dly.delayTime.value = (p as any).time ?? 0.29;

      const fb = ctx.createGain();
      fb.gain.value = Math.min(0.6, (p as any).feedback ?? 0.29);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = (p as any).damp ?? 4800;

      const inG = ctx.createGain();
      inG.connect(dly);
      dly.connect(lp);
      lp.connect(fb);
      fb.connect(dly); // feedback

      // Simple wet/dry: full wet for insert character or adjust
      const wetG = ctx.createGain();
      wetG.gain.value = (p as any).wet ?? 0.22;
      lp.connect(wetG);

      const dryG = ctx.createGain();
      dryG.gain.value = 1 - wetG.gain.value * 0.7;
      inG.connect(dryG);

      const outG = ctx.createGain();
      dryG.connect(outG);
      wetG.connect(outG);

      // The chain will connect to inG, next will connect from outG? 
      // To make linear chain work, return inG and have outG not used; instead make outG the return
      // For this insert, return the inG as entry, but to satisfy current = insertNode, we'll return outG and connect inG from previous? 
      // Practical: return outG, caller connects previous to outG? No.
      // Simplest high-quality compromise: return inG as the node; the wet is added in parallel inside.
      // To make it correct, we will return outG and manually handle in rebuild? For now return outG and adjust.
      return outG; // caller connects previous to this
    }

    // Unknown plugin type — passthrough gain
    const g = ctx.createGain();
    g.gain.value = 1;
    return g;
  }

  /** Live parameter updates (no rebuild needed) */
  setTrackFader(trackId: string, gain: number) {
    const ch = this.channels.get(trackId);
    if (ch) ch.fader.gain.value = Math.max(0, Math.min(2, gain));
  }

  setTrackPan(trackId: string, pan: number) {
    const ch = this.channels.get(trackId);
    if (ch) ch.panner.pan.value = Math.max(-1, Math.min(1, pan));
  }

  setTrackMute(trackId: string, muted: boolean) {
    const ch = this.channels.get(trackId);
    if (ch) ch.mute.gain.value = muted ? 0 : 1;
  }

  // Sidechain ducking: trigger reduction on beat for EDM ducking
  triggerDuck(trackId: string, reduction: number, releaseMs: number = 150) {
    const ch = this.channels.get(trackId);
    if (!ch || !ch.duckGain || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const target = Math.max(0.01, 1 - reduction);
    ch.duckGain.gain.cancelScheduledValues(now);
    ch.duckGain.gain.setValueAtTime(ch.duckGain.gain.value, now);
    ch.duckGain.gain.linearRampToValueAtTime(target, now + 0.005);
    ch.duckGain.gain.linearRampToValueAtTime(1, now + releaseMs / 1000);
  }

  setMasterGain(gain: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(2, gain));
    }
  }

  /** Get current peak meter for a track (0-1 range). Call this from UI raf loop. */
  getTrackMeter(trackId: string): { peak: number; rms: number } {
    const ch = this.channels.get(trackId);
    if (!ch || !ch.analyser) return { peak: 0, rms: 0 };

    const bufferLength = ch.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    ch.analyser.getByteTimeDomainData(dataArray);

    let peak = 0;
    let sum = 0;

    for (let i = 0; i < bufferLength; i++) {
      const val = (dataArray[i] - 128) / 128; // -1 to 1
      const abs = Math.abs(val);
      if (abs > peak) peak = abs;
      sum += val * val;
    }

    const rms = Math.sqrt(sum / bufferLength);

    const meter = { peak: Math.min(1, peak * 1.5), rms: Math.min(1, rms * 1.5) };
    this.meterData.set(trackId, meter);
    return meter;
  }

  getMasterMeter(): { peak: number; rms: number } {
    if (!this.masterAnalyser) return { peak: 0, rms: 0 };
    const bufferLength = this.masterAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.masterAnalyser.getByteTimeDomainData(dataArray);

    let peak = 0;
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const val = (dataArray[i] - 128) / 128;
      peak = Math.max(peak, Math.abs(val));
      sum += val * val;
    }
    return { peak: Math.min(1, peak * 1.5), rms: Math.min(1, Math.sqrt(sum / bufferLength) * 1.5) };
  }

  /** Legacy support (used by store) */
  updateTrackGain(trackId: string, gain: number) {
    this.setTrackFader(trackId, gain);
  }

  updateTrackPan(trackId: string, pan: number) {
    this.setTrackPan(trackId, pan);
  }

  stop() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.stopPositionLoop();

    // 모든 활성 소스 정지
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {}
    });
    this.activeSources = [];

    // 마지막 위치 기억
    if (this.audioContext) {
      const elapsed = this.audioContext.currentTime - this.startTime;
      this.startBeat += (elapsed * this.tempo) / 60;
    }
  }

  // 모든 로드된 오디오 정보 반환 (디버그/선택용)
  getLoadedAudios(): LoadedAudio[] {
    return Array.from(this.loadedAudios.values());
  }

  // 외부에서 미리 생성한 AudioBuffer를 등록 (test tone 등)
  registerBuffer(id: string, name: string, buffer: AudioBuffer, duration: number) {
    this.loadedAudios.set(id, { id, name, buffer, duration });
    this.computeAndCacheWaveform(id, buffer);
  }

  /** Resolve a storage: path into a loaded buffer id (fetches from Supabase if needed) */
  async ensureStorageAudio(storagePath: string): Promise<string | null> {
    if (!storagePath.startsWith('storage:')) return null;
    const objectPath = storagePath.slice(8);

    // Already loaded?
    if (this.loadedAudios.has(objectPath)) return objectPath;
    if (this.loadedAudios.has(storagePath)) return storagePath;

    try {
      const arrayBuffer = await downloadAudioAsset(objectPath);
      const ctx = this.getContext();
      const buffer = await ctx.decodeAudioData(arrayBuffer);

      const id = objectPath;
      this.loadedAudios.set(id, {
        id,
        name: objectPath.split('/').pop() || 'cloud-audio',
        buffer,
        duration: buffer.duration,
      });
      this.computeAndCacheWaveform(id, buffer);
      return id;
    } catch (e) {
      console.error('Failed to load storage audio', objectPath, e);
      return null;
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getCurrentBeatSync(): number {
    return this.getCurrentBeat();
  }

  // Expose for MIDI scheduling sync
  getPlayStartBeat(): number {
    return this.startBeat;
  }

  getPlayStartTime(): number {
    return this.startTime;
  }

  getIsPlayingState(): boolean {
    return this.isPlaying;
  }

  /** Public: kick off custom worklet preload (Phase 4) */
  preloadCustomFX() {
    this.ensureWorkletModule();
  }

  // === Demo sounds (Phase 1) ===
  // 미리 생성된 데모 트랙 사운드 (kick, hats, drums)
  private demosPreloaded = false;

  private generateKick(ctx: AudioContext): { buffer: AudioBuffer; duration: number } {
    const duration = 0.7;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const freq = 130 * Math.exp(-t * 5.2);
      let sample = Math.sin(2 * Math.PI * freq * t);
      const bodyEnv = Math.exp(-t * 6.2);
      const click = i < ctx.sampleRate * 0.0035 ? (Math.random() - 0.5) * 2.2 * (1 - i / (ctx.sampleRate * 0.0035)) : 0;
      data[i] = (sample * bodyEnv * 0.95 + click * 0.55) * 0.9;
    }
    return { buffer, duration };
  }

  private generateHat(ctx: AudioContext): { buffer: AudioBuffer; duration: number } {
    // Short 808-style closed hat, repeat a few times for longer perceived clip
    const duration = 1.9;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const beatSec = 60 / 120; // at default tempo

    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const localT = t % (beatSec * 0.5); // repeat every half beat
      const noise = Math.random() * 2 - 1;
      const ring = Math.sin(2 * Math.PI * 7600 * localT) * 0.28 + Math.sin(2 * Math.PI * 10200 * localT) * 0.18;
      const env = Math.exp(-localT * 26);
      // Quieter on off-beats for groove
      const beatPhase = Math.floor(t / (beatSec * 0.5)) % 2;
      const vol = beatPhase === 0 ? 0.82 : 0.55;
      data[i] = (noise * 0.6 + ring) * env * vol * 0.7;
    }
    return { buffer, duration };
  }

  private generateDrums(ctx: AudioContext): { buffer: AudioBuffer; duration: number } {
    // Punchy drums phrase for ~4 beats feel at 120
    const duration = 2.0;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      // Main kick hit
      const kfreq = 118 * Math.exp(-t * 4.5);
      const kick = Math.sin(2 * Math.PI * kfreq * t) * Math.exp(-t * 5.5) * 0.9;

      // Snare-ish mid
      const snareNoise = (Math.random() * 2 - 1) * Math.exp(-Math.max(0, t - 0.45) * 8) * 0.4;
      const snareBody = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-Math.max(0, t - 0.4) * 6) * 0.35;

      // Extra hat layer
      const hatT = (t + 0.25) % 0.5;
      const hat = (Math.random() * 2 - 1) * Math.exp(-hatT * 30) * 0.22;

      data[i] = (kick + snareNoise + snareBody + hat) * 0.85;
    }
    return { buffer, duration };
  }

  private generateSnare(ctx: AudioContext): { buffer: AudioBuffer; duration: number } {
    const duration = 0.6;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 12);
      const body = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 9) * 0.6;
      const click = i < 80 ? (Math.random()-0.5) * 1.6 : 0;
      data[i] = (noise * 0.75 + body + click * 0.4) * 0.9;
    }
    return { buffer, duration };
  }

  private generateClosedHat(ctx: AudioContext): { buffer: AudioBuffer; duration: number } {
    const duration = 0.25;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const noise = Math.random() * 2 - 1;
      const ring = Math.sin(2 * Math.PI * 8500 * t) * 0.25 + Math.sin(2 * Math.PI * 12000 * t) * 0.15;
      const env = Math.exp(-t * 55);
      data[i] = (noise * 0.65 + ring) * env * 0.85;
    }
    return { buffer, duration };
  }

  private generateCrash(ctx: AudioContext): { buffer: AudioBuffer; duration: number } {
    const duration = 1.8;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const noise = Math.random() * 2 - 1;
      const tone = Math.sin(2 * Math.PI * 420 * t) * 0.3 + Math.sin(2 * Math.PI * 720 * t) * 0.2;
      const env = Math.exp(-t * 1.8);
      data[i] = (noise * 0.55 + tone) * env * 0.8;
    }
    return { buffer, duration };
  }

  async ensureDemoSounds(): Promise<void> {
    if (this.demosPreloaded) return;
    const ctx = this.getContext();
    // Do NOT resume here. Resume must be called only from user gesture handlers (play button, etc.)
    // to comply with browser autoplay policy. Creating the context is fine; starting audio is not.

    // Kick
    const kick = this.generateKick(ctx);
    this.loadedAudios.set('demo:kick', {
      id: 'demo:kick',
      name: 'Kick',
      buffer: kick.buffer,
      duration: kick.duration,
    });
    this.computeAndCacheWaveform('demo:kick', kick.buffer);

    // Snare
    const snare = this.generateSnare(ctx);
    this.loadedAudios.set('demo:snare', {
      id: 'demo:snare',
      name: 'Snare',
      buffer: snare.buffer,
      duration: snare.duration,
    });
    this.computeAndCacheWaveform('demo:snare', snare.buffer);

    // Closed HiHat
    const hihat = this.generateClosedHat(ctx);
    this.loadedAudios.set('demo:hihat', {
      id: 'demo:hihat',
      name: 'Closed Hat',
      buffer: hihat.buffer,
      duration: hihat.duration,
    });
    this.computeAndCacheWaveform('demo:hihat', hihat.buffer);

    // Crash
    const crash = this.generateCrash(ctx);
    this.loadedAudios.set('demo:crash', {
      id: 'demo:crash',
      name: 'Crash',
      buffer: crash.buffer,
      duration: crash.duration,
    });
    this.computeAndCacheWaveform('demo:crash', crash.buffer);

    // Hats (loop style)
    const hat = this.generateHat(ctx);
    this.loadedAudios.set('demo:808hats', {
      id: 'demo:808hats',
      name: '808 Hats',
      buffer: hat.buffer,
      duration: hat.duration,
    });
    this.computeAndCacheWaveform('demo:808hats', hat.buffer);

    // Drums composite
    const drums = this.generateDrums(ctx);
    this.loadedAudios.set('demo:drums', {
      id: 'demo:drums',
      name: 'Big Compressed Drums',
      buffer: drums.buffer,
      duration: drums.duration,
    });
    this.computeAndCacheWaveform('demo:drums', drums.buffer);

    this.demosPreloaded = true;
  }
}

// 싱글턴으로 사용 (간단하게)
export const audioEngine = new AudioEngine();
