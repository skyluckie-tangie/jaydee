// Basic Dynamics Processor (Compressor) as AudioWorklet
// Artisan starting point for custom FX (replaces native DynamicsCompressor for Phase 4)

class DynamicsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -24, minValue: -100, maxValue: 0 },
      { name: 'knee', defaultValue: 30, minValue: 0, maxValue: 40 },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20 },
      { name: 'attack', defaultValue: 0.003, minValue: 0, maxValue: 1 },
      { name: 'release', defaultValue: 0.25, minValue: 0, maxValue: 1 },
      { name: 'makeupGain', defaultValue: 0, minValue: -20, maxValue: 20 }
    ];
  }

  constructor() {
    super();
    this.envelope = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || input.length === 0) return true;

    const threshold = parameters.threshold[0];
    const knee = parameters.knee[0];
    const ratio = parameters.ratio[0];
    const attack = parameters.attack[0];
    const release = parameters.release[0];
    const makeup = Math.pow(10, parameters.makeupGain[0] / 20);

    const sampleRate = globalThis.sampleRate || 44100;
    const attackCoeff = Math.exp(-1 / (Math.max(0.0001, sampleRate * attack)));
    const releaseCoeff = Math.exp(-1 / (Math.max(0.0001, sampleRate * release)));

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let i = 0; i < inputChannel.length; i++) {
        const sample = inputChannel[i];
        const absSample = Math.abs(sample);

        // Simple peak detector
        let target = absSample > 0 ? 20 * Math.log10(absSample) : -100;
        const diff = target - threshold;

        let gainReduction = 0;
        if (diff > 0) {
          // Above threshold
          const kneeStart = threshold - knee / 2;
          const kneeEnd = threshold + knee / 2;
          if (target < kneeEnd) {
            // Soft knee
            const t = (target - kneeStart) / knee;
            gainReduction = (diff * t * t) / (2 * (ratio - 1) || 1);
          } else {
            gainReduction = diff * (1 - 1 / ratio);
          }
        }

        // Envelope follower (attack when GR increases, release when GR decreases)
        const coeff = gainReduction > this.envelope ? attackCoeff : releaseCoeff;
        this.envelope = gainReduction + coeff * (this.envelope - gainReduction);

        const gain = Math.pow(10, (-this.envelope / 20)) * makeup;
        outputChannel[i] = sample * gain;
      }
    }

    return true;
  }
}

registerProcessor('dynamics-processor', DynamicsProcessor);
