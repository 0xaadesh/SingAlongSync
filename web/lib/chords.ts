/** Chord-name parsing and note maths for chord diagrams. */

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
