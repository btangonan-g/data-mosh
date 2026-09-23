import { describe, it, expect } from 'vitest';

interface MockPacket {
  isKey: boolean;
  chunk: { type: 'key' | 'delta'; timestamp: number; byteLength: number };
}

function buildTransitionStream(
  srcPackets: MockPacket[],
  transPackets: MockPacket[],
  intensity: number
) {
  const result: any[] = [];
  const srcKeyframes = srcPackets.filter((p) => p.isKey);
  if (srcKeyframes.length === 0) throw new Error('No keyframe in source');
  const transDeltas = transPackets.filter((p) => !p.isKey);
  if (transDeltas.length === 0) throw new Error('No delta frames in transition clip');

  result.push(srcKeyframes[0].chunk);
  const resetInterval =
    intensity >= 90
      ? Infinity
      : Math.max(3, Math.floor(transDeltas.length * (1 - intensity / 100)));

  for (let i = 0; i < transDeltas.length; i++) {
    if (resetInterval !== Infinity && i > 0 && i % resetInterval === 0) {
      result.push(srcKeyframes[0].chunk);
    }
    result.push(transDeltas[i].chunk);
  }
  return result;
}

describe('Datamosh Transition Algorithm (buildTransitionStream)', () => {
  it('throws an error if source clip has no keyframes (I-frames)', () => {
    const src: MockPacket[] = [
      { isKey: false, chunk: { type: 'delta', timestamp: 0, byteLength: 500 } },
    ];
    const trans: MockPacket[] = [
      { isKey: false, chunk: { type: 'delta', timestamp: 33, byteLength: 400 } },
    ];
    expect(() => buildTransitionStream(src, trans, 50)).toThrow('No keyframe in source');
  });

  it('throws an error if transition clip has no delta frames (P/B-frames)', () => {
    const src: MockPacket[] = [
      { isKey: true, chunk: { type: 'key', timestamp: 0, byteLength: 5000 } },
    ];
    const trans: MockPacket[] = [
      { isKey: true, chunk: { type: 'key', timestamp: 33, byteLength: 4000 } },
    ];
    expect(() => buildTransitionStream(src, trans, 50)).toThrow('No delta frames in transition clip');
  });

  it('builds a continuous datamosh stream transplanting delta motion vectors onto source keyframe', () => {
    const src: MockPacket[] = [
      { isKey: true, chunk: { type: 'key', timestamp: 0, byteLength: 5000 } },
    ];
    const trans: MockPacket[] = [
      { isKey: true, chunk: { type: 'key', timestamp: 0, byteLength: 4000 } },
      { isKey: false, chunk: { type: 'delta', timestamp: 33, byteLength: 300 } },
      { isKey: false, chunk: { type: 'delta', timestamp: 66, byteLength: 350 } },
      { isKey: false, chunk: { type: 'delta', timestamp: 99, byteLength: 320 } },
      { isKey: false, chunk: { type: 'delta', timestamp: 132, byteLength: 310 } },
    ];

    const stream = buildTransitionStream(src, trans, 100);
    // At intensity 100%, resetInterval is Infinity; result is 1 keyframe + 4 deltas
    expect(stream.length).toBe(5);
    expect(stream[0].type).toBe('key');
    expect(stream[1].type).toBe('delta');
    expect(stream[4].type).toBe('delta');
  });

  it('inserts reset keyframes when intensity is lowered', () => {
    const src: MockPacket[] = [
      { isKey: true, chunk: { type: 'key', timestamp: 0, byteLength: 5000 } },
    ];
    const trans: MockPacket[] = Array.from({ length: 20 }, (_, i) => ({
      isKey: false,
      chunk: { type: 'delta' as const, timestamp: i * 33, byteLength: 200 },
    }));

    const stream = buildTransitionStream(src, trans, 20);
    const keyframes = stream.filter((c: any) => c.type === 'key');
    // At 20% intensity, reset intervals insert periodic keyframes to calm the mosh
    expect(keyframes.length).toBeGreaterThan(1);
  });
});
