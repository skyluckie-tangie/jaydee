// AudioEngine.ts
// Web Audio API 기반 간단한 beat-synchronized 플레이어 (Phase 1)
// - AudioContext 관리
// - AudioBuffer 로드 (파일 업로드)
// - Beat → Seconds 변환
// - 클립 스케줄링 및 재생/정지
// - 현재 beat 위치 업데이트 (requestAnimationFrame)

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
  }>();

  // Simple peak meter data (updated manually or via raf if needed)
  private meterData = new Map<string, { peak: number; rms: number }>();

  // 현재 beat 위치를 외부에 알려주기 위한 콜백
  private onPositionUpdate?: (beat: number) => void;

  private rafId: number | null = null;

  constructor() {
    // AudioContext는 사용자 제스처(버튼 클릭) 이후에 생성해야 함
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Create Master Bus (Mix Bus)
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.9; // default master level

      this.masterAnalyser = this.audioContext.createAnalyser();
      this.masterAnalyser.fftSize = 256;

      // master -> analyser -> destination
      this.masterGain.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  setTempo(newTempo: number) {
    this.tempo = Math.max(40, Math.min(300, newTempo));
    // 재생 중이면 위치를 유지하면서 tempo 변경 (간단하게는 stop 후 다시 시작할 수 있음)
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
    return loaded;
  }

  // Beat를 초 단위로 변환
  private beatsToSeconds(beats: number): number {
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

    // 현재 로드된 모든 audioClips 스케줄 (Phase 1에서는 store에서 전달받아야 함)
    // 지금은 외부에서 scheduleClip을 직접 호출하도록 설계
  }

  // 특정 클립을 특정 beat에 스케줄
  // startBeat: 클립의 시작 beat 위치
  // offsetBeats: 클립 내부 재생 시작 offset
  // trackId: for per-track gain/pan
  scheduleClip(audioId: string, startBeat: number, offsetBeats = 0, gain = 1, trackId?: string) {
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

    if (trackId) {
      const ch = this.ensureChannel(trackId);
      source.connect(ch.input);
    } else {
      // Fallback legacy path (no track routing)
      const g = context.createGain();
      g.gain.value = gain;
      source.connect(g);
      if (this.masterGain) {
        g.connect(this.masterGain);
      } else {
        g.connect(context.destination);
      }
    }

    // 현재 재생 원점(this.startBeat) 기준 상대 위치
    const relStart = startBeat - this.startBeat; // 음수 가능 (클립이 과거에서 시작)
    const playHeadOffsetBeats = Math.max(0, this.startBeat - startBeat); // 이미 지난 부분

    // 오디오 버퍼에서 실제 시작할 오프셋 (클립의 offset + playHead 지나간 부분)
    const effectiveOffsetBeats = offsetBeats + playHeadOffsetBeats;
    const offsetSeconds = this.beatsToSeconds(effectiveOffsetBeats);

    // 이 소스가 언제 시작되어야 하는지 (미래면 미래, 이미 지났으면 지금 당장)
    const startTimeInSeconds = this.beatsToSeconds(relStart);
    const absoluteStartTime = this.startTime + Math.max(0, startTimeInSeconds);

    try {
      // duration 제한 (전체가 아니라 남은 길이만)
      const remainingBeats = clipEndBeat - Math.max(this.startBeat, startBeat);
      const remainingSec = this.beatsToSeconds(remainingBeats);

      source.start(absoluteStartTime, offsetSeconds, remainingSec);
      this.activeSources.push(source);

      source.onended = () => {
        this.activeSources = this.activeSources.filter((s) => s !== source);
      };
    } catch (e) {
      console.error('Failed to schedule source', e);
    }
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
    const panner = ctx.createStereoPanner();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;

    // Default values
    fader.gain.value = 0.85;
    panner.pan.value = 0;
    mute.gain.value = 1;

    // Initial chain (no inserts yet): input -> fader -> panner -> mute -> analyser -> master
    input.connect(fader);
    fader.connect(panner);
    panner.connect(mute);
    mute.connect(analyser);

    if (this.masterGain) {
      analyser.connect(this.masterGain);
    } else {
      analyser.connect(ctx.destination);
    }

    const channel = { input, inserts: [], fader, panner, mute, analyser };
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
      // Simple 3-band EQ using Biquad
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = p.lowFreq ?? 250;
      low.gain.value = p.lowGain ?? 0;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = p.midFreq ?? 1000;
      mid.Q.value = p.midQ ?? 1;
      mid.gain.value = p.midGain ?? 0;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = p.highFreq ?? 4000;
      high.gain.value = p.highGain ?? 0;

      low.connect(mid);
      mid.connect(high);
      return high; // caller will connect into the chain
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

    // Unknown plugin type — passthrough gain
    const g = ctx.createGain();
    g.gain.value = 1;
    return g;
  }

  // Bonus: simple filter insert for variety
  if (t === 'filter') {
    const f = ctx.createBiquadFilter();
    f.type = (p.type as BiquadFilterType) || 'lowpass';
    f.frequency.value = p.frequency ?? 1000;
    f.Q.value = p.q ?? 1;
    return f;
  }
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

  async ensureDemoSounds(): Promise<void> {
    if (this.demosPreloaded) return;
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Kick
    const kick = this.generateKick(ctx);
    this.loadedAudios.set('demo:kick', {
      id: 'demo:kick',
      name: 'Kick',
      buffer: kick.buffer,
      duration: kick.duration,
    });

    // Hats
    const hat = this.generateHat(ctx);
    this.loadedAudios.set('demo:808hats', {
      id: 'demo:808hats',
      name: '808 Hats',
      buffer: hat.buffer,
      duration: hat.duration,
    });

    // Drums
    const drums = this.generateDrums(ctx);
    this.loadedAudios.set('demo:drums', {
      id: 'demo:drums',
      name: 'Big Compressed Drums',
      buffer: drums.buffer,
      duration: drums.duration,
    });

    this.demosPreloaded = true;
  }
}

// 싱글턴으로 사용 (간단하게)
export const audioEngine = new AudioEngine();
