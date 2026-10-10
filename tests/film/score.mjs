// A quiet score for the launch film, synthesised from scratch so the repo carries no audio
// licences: a warm pad, a plucked arpeggio, a soft bass and a bell on every chapter card, timed
// to the marks record-launch.mjs logs. Writes a 44.1 kHz stereo 16-bit WAV.
// Standalone: node film/score.mjs out.wav seconds [marks.json]

import { readFileSync, writeFileSync } from "node:fs";

const SR = 44_100;
const BPM = 84;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// [bass, ...voicing], MIDI notes
const CHORDS = {
  Fmaj9: [41, 57, 60, 64, 67],
  Am7: [45, 55, 60, 64, 69],
  Dm9: [38, 53, 57, 60, 64],
  Bbmaj9: [46, 62, 65, 69, 72],
  Csus2: [36, 55, 60, 62, 67],
  Gm9: [43, 58, 62, 65, 69],
};
const VERSE = ["Fmaj9", "Am7", "Dm9", "Bbmaj9"];
const LIFT = ["Dm9", "Bbmaj9", "Fmaj9", "Csus2"];

export function writeScore(path, seconds, marks = []) {
  const n = Math.ceil((seconds + 2) * SR);
  const pad = [new Float32Array(n), new Float32Array(n)];
  const arp = [new Float32Array(n), new Float32Array(n)];
  const dry = [new Float32Array(n), new Float32Array(n)];
  const bell = [new Float32Array(n), new Float32Array(n)];
  const at = (prefix, fallback) => marks.find((m) => m.name.startsWith(prefix))?.t ?? fallback;
  const T = {
    title: at("title", 6),
    ch1: at("01", 12),
    ch3: at("03", seconds * 0.6),
    hood: at("under", seconds * 0.85),
    outro: at("outro", seconds - 6),
  };
  const section = (t) => (t < T.title ? 0 : t < T.ch1 ? 1 : t < T.ch3 ? 2 : t < T.hood ? 3 : t < T.outro ? 4 : 5);

  const add = (buf, i, l, r) => {
    if (i >= 0 && i < n) {
      buf[0][i] += l;
      buf[1][i] += r;
    }
  };

  /** A slow, slightly detuned additive pad note. */
  function padNote(midi, t0, dur, amp, bright) {
    const start = Math.floor(t0 * SR);
    const len = Math.floor((dur + 2.2) * SR);
    for (const [detune, panL, panR] of [[-5, 0.8, 0.45], [5, 0.45, 0.8]]) {
      const f = hz(midi) * 2 ** (detune / 1200);
      const harm = [1, 2, 3, 4, 5].map((h) => [f * h, (1 / h ** 1.7) * bright ** (h - 1)]);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const env = Math.min(1, t / 1.4) ** 2 * (t > dur ? Math.exp(-(t - dur) / 0.8) : 1);
        if (env < 1e-4 && t > dur) break;
        let s = 0;
        for (const [hf, ha] of harm) s += ha * Math.sin(2 * Math.PI * hf * t);
        s *= env * amp;
        add(pad, start + i, s * panL, s * panR);
      }
    }
  }

  function pluck(midi, t0, amp, pan) {
    const f = hz(midi);
    const start = Math.floor(t0 * SR);
    for (let i = 0; i < 1.6 * SR; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.38);
      const s = amp * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.15));
      add(arp, start + i, s * (1 - pan), s * pan);
    }
  }

  function bass(midi, t0, dur, amp) {
    const f = hz(midi);
    const start = Math.floor(t0 * SR);
    const len = Math.floor((dur + 0.8) * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.06) * (0.65 + 0.35 * Math.exp(-t / 0.5)) * (t > dur ? Math.exp(-(t - dur) / 0.25) : 1);
      const s = amp * env * (Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(4 * Math.PI * f * t));
      add(dry, start + i, s, s);
    }
  }

  function ding(midi, t0, amp) {
    const f = hz(midi);
    const start = Math.floor(t0 * SR);
    const partials = [[1, 1, 2.6], [2.76, 0.35, 1.1], [5.4, 0.12, 0.5]];
    for (let i = 0; i < 4 * SR; i++) {
      const t = i / SR;
      let s = 0;
      for (const [ratio, a, tau] of partials) s += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * ratio * t);
      s *= amp * Math.min(1, t / 0.002);
      add(bell, start + i, s * 0.9, s);
    }
  }

  // Chords on a fixed bar grid; the section decides what plays
  const bars = Math.ceil(seconds / BAR);
  for (let k = 0; k < bars; k++) {
    const t = k * BAR;
    const sec = section(t);
    if (sec === 5) {
      // Resolve on F and let it ring out
      for (const m of CHORDS.Fmaj9.slice(1)) padNote(m, t, Math.max(1, seconds - t), 0.05, 0.42);
      padNote(72, t + BEAT, Math.max(1, seconds - t), 0.025, 0.3);
      bass(41, t, Math.max(1, seconds - t - 0.5), 0.12);
      ding(84, t + 0.05, 0.05);
      break;
    }
    const name = (sec === 3 ? LIFT : VERSE)[k % 4];
    const [root, ...voicing] = CHORDS[name];
    const bright = [0.3, 0.36, 0.4, 0.5, 0.36][sec];
    const amp = [0.042, 0.048, 0.05, 0.055, 0.046][sec];
    for (const m of voicing) padNote(m, t, BAR, amp, bright);
    if (sec >= 1) {
      // Chord tones an octave up, in eighths
      const tones = voicing.map((m) => m + 12);
      const pattern = sec === 3 ? [0, 1, 2, 3, 2, 1, 3, 2] : [0, 2, 1, 3, 2, 1, 3, 1];
      pattern.forEach((p, j) => {
        if (sec === 4 && j % 2) return;
        pluck(tones[p] + (sec === 3 && j === 3 ? 12 : 0), t + (j * BEAT) / 2, sec === 3 ? 0.06 : 0.045, j % 2 ? 0.68 : 0.32);
      });
    }
    if (sec >= 2 && sec !== 4) bass(root, t, BAR - 0.15, 0.11);
    if (sec === 4) bass(root, t, BAR - 0.15, 0.07);
  }
  // A bell on the title and every chapter card
  for (const m of marks) {
    if (m.name === "title") ding(81, m.t + 0.4, 0.07);
    if (/^0\d /.test(m.name)) ding(84, m.t + 0.45, 0.07);
    if (m.name === "under the hood") ding(79, m.t + 0.3, 0.05);
  }

  // Ping-pong delay on the arpeggio, at a dotted eighth
  const d = Math.floor(0.75 * BEAT * SR);
  for (let i = d; i < n; i++) {
    arp[0][i] += 0.32 * arp[1][i - d];
    arp[1][i] += 0.32 * arp[0][i - d];
  }

  // Freeverb-style room on a send
  const send = [0, 1].map((c) => {
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.5 * pad[c][i] + 0.45 * arp[c][i] + 0.6 * bell[c][i];
    return s;
  });
  const wet = send.map((x, c) => reverb(x, c ? 23 : 0));

  const out = [new Float32Array(n), new Float32Array(n)];
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const fadeIn = Math.min(1, i / (1.5 * SR));
      const v = fadeIn * (pad[c][i] + arp[c][i] + dry[c][i] + bell[c][i] + 0.42 * wet[c][i]);
      out[c][i] = Math.tanh(v * 1.2) / 1.2;
      peak = Math.max(peak, Math.abs(out[c][i]));
    }
  }
  const gain = peak > 0 ? 0.5 / peak : 1;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[0][i] * gain)) * 32_767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[1][i] * gain)) * 32_767), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

function reverb(x, spread) {
  const n = x.length;
  const y = new Float32Array(n);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => ({ buf: new Float32Array(l + spread), i: 0, last: 0 }));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of combs) {
      const out = c.buf[c.i];
      c.last = out * 0.75 + c.last * 0.25;
      c.buf[c.i] = x[i] * 0.03 + c.last * 0.86;
      c.i = (c.i + 1) % c.buf.length;
      s += out;
    }
    y[i] = s;
  }
  for (const l of [556, 441, 341, 225]) {
    const buf = new Float32Array(l + spread);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[j];
      const v = y[i];
      buf[j] = v + b * 0.5;
      y[i] = b - v;
      j = (j + 1) % buf.length;
    }
  }
  return y;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [, , out = "score.wav", secs = "60", marksPath] = process.argv;
  writeScore(out, Number(secs), marksPath ? JSON.parse(readFileSync(marksPath, "utf8")) : []);
  console.log("saved", out);
}
