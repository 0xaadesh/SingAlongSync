/**
 * AudioWorklet that shifts pitch without changing tempo: a streaming phase
 * vocoder (after Stephan Bernsee's smbPitchShift), run per channel.
 * Passes audio straight through while the ratio is 1, so there's no added
 * latency or colouring unless a shift is set.
 */

const FRAME = 2048;
const OSAMP = 4;
const STEP = FRAME / OSAMP;
const HALF = FRAME / 2;
const LATENCY = FRAME - STEP;
const TWO_PI = 2 * Math.PI;
// Loudness matching: power averaged over about half a second, gain kept within limits
const LEVEL_SECONDS = 0.5;
const MIN_GAIN = 0.5;
const MAX_GAIN = 2.5;

const WINDOW = new Float32Array(FRAME);
for (let k = 0; k < FRAME; k++) WINDOW[k] = 0.5 - 0.5 * Math.cos((TWO_PI * k) / FRAME);

const BITS = Math.log2(FRAME);
const REVERSED = new Uint32Array(FRAME);
for (let i = 0; i < FRAME; i++) {
  let r = 0;
  for (let b = 0; b < BITS; b++) r |= ((i >> b) & 1) << (BITS - 1 - b);
  REVERSED[i] = r;
}

/** In-place radix-2 FFT on separate real/imaginary arrays; sign -1 forward, +1 inverse (unscaled). */
function fft(re, im, sign) {
  for (let i = 0; i < FRAME; i++) {
    const j = REVERSED[i];
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= FRAME; size <<= 1) {
    const half = size >> 1;
    const arg = (sign * TWO_PI) / size;
    const wr = Math.cos(arg);
    const wi = Math.sin(arg);
    for (let start = 0; start < FRAME; start += size) {
      let ur = 1;
      let ui = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const tr = re[b] * ur - im[b] * ui;
        const ti = re[b] * ui + im[b] * ur;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = nr;
      }
    }
  }
}

class Channel {
  constructor() {
    this.inFifo = new Float32Array(FRAME);
    this.outFifo = new Float32Array(FRAME);
    this.accum = new Float32Array(2 * FRAME);
    this.lastPhase = new Float32Array(HALF + 1);
    this.sumPhase = new Float32Array(HALF + 1);
    this.anaMagn = new Float32Array(HALF + 1);
    this.anaFreq = new Float32Array(HALF + 1);
    this.synMagn = new Float32Array(HALF + 1);
    this.synFreq = new Float32Array(HALF + 1);
    this.re = new Float32Array(FRAME);
    this.im = new Float32Array(FRAME);
    this.rover = LATENCY;
    this.inPower = 0;
    this.outPower = 0;
  }

  reset() {
    for (const a of [this.inFifo, this.outFifo, this.accum, this.lastPhase, this.sumPhase]) a.fill(0);
    this.rover = LATENCY;
    this.inPower = 0;
    this.outPower = 0;
  }

  /**
   * The vocoder loses loudness (more the further the shift), so the output is
   * scaled to keep its average power level with the input's.
   */
  process(input, output, ratio, freqPerBin) {
    const smooth = 1 / (LEVEL_SECONDS * sampleRate);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = this.outFifo[this.rover - LATENCY];
      this.inPower += (x * x - this.inPower) * smooth;
      this.outPower += (y * y - this.outPower) * smooth;
      const gain = this.outPower > 1e-10 ? Math.sqrt(this.inPower / this.outPower) : 1;
      this.inFifo[this.rover] = x;
      output[i] = y * Math.min(MAX_GAIN, Math.max(MIN_GAIN, gain));
      if (++this.rover >= FRAME) {
        this.rover = LATENCY;
        this.frame(ratio, freqPerBin);
      }
    }
  }

  frame(ratio, freqPerBin) {
    const { re, im, lastPhase, sumPhase, anaMagn, anaFreq, synMagn, synFreq } = this;
    const expected = (TWO_PI * STEP) / FRAME;

    for (let k = 0; k < FRAME; k++) {
      re[k] = this.inFifo[k] * WINDOW[k];
      im[k] = 0;
    }
    fft(re, im, -1);

    // Analysis: each bin's magnitude and true frequency
    for (let k = 0; k <= HALF; k++) {
      const phase = Math.atan2(im[k], re[k]);
      let delta = phase - lastPhase[k] - k * expected;
      lastPhase[k] = phase;
      let qpd = Math.trunc(delta / Math.PI);
      qpd += qpd >= 0 ? qpd & 1 : -(qpd & 1);
      delta -= Math.PI * qpd;
      anaMagn[k] = 2 * Math.hypot(re[k], im[k]);
      anaFreq[k] = (k + (OSAMP * delta) / TWO_PI) * freqPerBin;
    }

    // Move each bin to its shifted position
    synMagn.fill(0);
    synFreq.fill(0);
    for (let k = 0; k <= HALF; k++) {
      const index = Math.trunc(k * ratio);
      if (index > HALF) break;
      synMagn[index] += anaMagn[k];
      synFreq[index] = anaFreq[k] * ratio;
    }

    // Synthesis
    for (let k = 0; k <= HALF; k++) {
      const delta = ((synFreq[k] / freqPerBin - k) * TWO_PI) / OSAMP + k * expected;
      sumPhase[k] += delta;
      re[k] = synMagn[k] * Math.cos(sumPhase[k]);
      im[k] = synMagn[k] * Math.sin(sumPhase[k]);
    }
    for (let k = HALF + 1; k < FRAME; k++) {
      re[k] = 0;
      im[k] = 0;
    }
    fft(re, im, 1);

    // Hann windows applied twice overlap-add to 1.5 at 4x overlap
    const scale = 2 / (HALF * OSAMP * 1.5);
    for (let k = 0; k < FRAME; k++) this.accum[k] += WINDOW[k] * re[k] * scale;
    this.outFifo.set(this.accum.subarray(0, STEP));
    this.accum.copyWithin(0, STEP);
    this.accum.fill(0, FRAME);
    this.inFifo.copyWithin(0, STEP, FRAME);
  }
}

class PitchShifter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = 1;
    this.channels = [];
    this.port.onmessage = (e) => {
      const ratio = e.data.ratio;
      if (ratio === this.ratio) return;
      // Start fresh so stale phases from the old shift don't smear into the new one
      if (this.ratio === 1 || ratio === 1) this.channels.forEach((c) => c.reset());
      this.ratio = ratio;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let ch = 0; ch < output.length; ch++) {
      const source = input[ch] ?? input[0];
      if (!source) {
        output[ch].fill(0);
        continue;
      }
      if (this.ratio === 1) {
        output[ch].set(source);
        continue;
      }
      this.channels[ch] ??= new Channel();
      this.channels[ch].process(source, output[ch], this.ratio, sampleRate / FRAME);
    }
    return true;
  }
}

registerProcessor("pitch-shifter", PitchShifter);
