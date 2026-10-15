/** Chord-name parsing and note maths for chord diagrams. */

import type { SongDetail } from "./api";

const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** Intervals above the root for each quality symbol the server writes. */
const INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  m6: [0, 3, 7, 9],
  "6": [0, 4, 7, 9],
  m7: [0, 3, 7, 10],
  "m(maj7)": [0, 3, 7, 11],
  maj7: [0, 4, 7, 11],
  "7": [0, 4, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

export type ParsedChord = { root: number; intervals: number[] };

export function parseChord(name: string): ParsedChord | null {
  const root = name.length > 1 && (name[1] === "#" || name[1] === "b") ? name.slice(0, 2) : name.slice(0, 1);
  const quality = name.slice(root.length);
  if (!(root in PITCH_CLASS) || !(quality in INTERVALS)) return null;
  return { root: PITCH_CLASS[root], intervals: INTERVALS[quality] };
}

/**
 * Keys to press on a two-octave keyboard (0 = the first C), root position:
 * the root in the lower octave and the other tones stacked above it.
 */
export function pianoVoicing(name: string): { keys: number[]; root: number } | null {
  const chord = parseChord(name);
  if (!chord) return null;
  return { keys: chord.intervals.map((i) => chord.root + i), root: chord.root };
}

// Spelling of transposed roots and keys, matching the server's conventions
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const MAJOR_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const FLAT_MAJOR = new Set([1, 3, 5, 8, 10]);
const FLAT_MINOR = new Set([0, 2, 3, 5, 7, 10]);

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Split a chord name into its root's pitch class and the rest ("Bbm7" → 10, "m7"). */
function splitRoot(name: string): { root: number; rest: string } | null {
  const root = name.length > 1 && (name[1] === "#" || name[1] === "b") ? name.slice(0, 2) : name.slice(0, 1);
  return root in PITCH_CLASS ? { root: PITCH_CLASS[root], rest: name.slice(root.length) } : null;
}

/**
 * A key name ("Eb major") moved by `semitones`, plus whether chords in it are spelled
 * with flats. Returns the input unchanged when it can't be parsed.
 */
export function transposeKey(key: string, semitones: number): { key: string; flats: boolean } {
  const [tonic, mode] = key.split(" ");
  if (!(tonic in PITCH_CLASS) || (mode !== "major" && mode !== "minor")) return { key, flats: false };
  const pc = mod12(PITCH_CLASS[tonic] + semitones);
  const minor = mode === "minor";
  return {
    key: `${(minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES)[pc]} ${mode}`,
    flats: (minor ? FLAT_MINOR : FLAT_MAJOR).has(pc),
  };
}

/** A chord name moved by `semitones` ("A#m7", 2 → "Cm7"); names it can't parse pass through. */
export function transposeChord(name: string, semitones: number, flats: boolean): string {
  const parsed = splitRoot(name);
  if (!parsed) return name;
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(parsed.root + semitones)] + parsed.rest;
}

/** The song's detail with its key and chords moved by `semitones` (the player's pitch shift). */
export function transposeDetail(detail: SongDetail, semitones: number): SongDetail;
export function transposeDetail(detail: SongDetail | null, semitones: number): SongDetail | null;
export function transposeDetail(detail: SongDetail | null, semitones: number): SongDetail | null {
  if (!detail?.analysis || semitones === 0) return detail;
  const { key, flats } = transposeKey(detail.analysis.key, semitones);
  const chords = detail.analysis.chords.map((c) => ({ ...c, chord: transposeChord(c.chord, semitones, flats) }));
  return { ...detail, analysis: { ...detail.analysis, key, chords } };
}
