import { describe, it, expect } from 'vitest';
import {
    planABTransition,
    buildABStream,
    crfForHealSpeed,
    sweepColumns,
    MAX_TAIL_SEC,
    CRF_FAST_HEAL,
    CRF_SLOW_HEAL,
    type ABOptions,
} from '../src/services/abTransition';

const FPS = 30;
const base: ABOptions = { cutSec: 5, resolve: 'melt', moshSec: 2, sweepSec: 1, healSpeed: 50, bloomFrames: 0 };

describe('planABTransition', () => {
    it('melt plays every B delta 1:1 after a 1s A reference tail, with no clean B splice', () => {
        const plan = planABTransition(5, 4, base, FPS);
        expect(plan.aHead).toEqual({ startSec: 0, endSec: 4, frames: 120 });
        expect(plan.aTail).toEqual({ startSec: 4, endSec: 5, frames: 30 });
        expect(plan.bDeltas).toBe(119);
        expect(plan.bTail).toBeNull();
        expect(plan.sweep).toBeNull();
        expect(plan.moshSegmentFrames).toBe(30 + 119);
        expect(plan.totalFrames).toBe(120 + 30 + 119);
        expect(plan.audioGapSec).toBe(0);
    });

    it('sweep melts for moshSec, sweeps over sweepSec, then continues with clean B 1:1', () => {
        const plan = planABTransition(5, 4, { ...base, resolve: 'sweep', moshSec: 2, sweepSec: 1 }, FPS);
        expect(plan.sweep).toEqual({ firstB: 60, lastB: 89 });
        expect(plan.bDeltas).toBe(89);
        expect(plan.bTail).toEqual({ startSec: 90 / FPS, endSec: 4, frames: 120 - 90 });
        // Every B frame appears exactly once across the moshed segment and the clean tail.
        expect(plan.bDeltas + 1 + (plan.bTail?.frames ?? 0)).toBe(120);
    });

    it('hold only drops heavy frames during the moshSec smear, then plays like melt with nothing composited', () => {
        const plan = planABTransition(5, 10, { ...base, resolve: 'hold', moshSec: 1, sweepSec: 0.5 }, FPS);
        expect(plan.holdUntilB).toBe(31);
        expect(plan.sweep).toBeNull();
        expect(plan.bTail).toBeNull();
        expect(plan.bDeltas).toBe(299);
        expect(planABTransition(5, 10, base, FPS).holdUntilB).toBeNull();
    });

    it('bloom delays B by the burst length and shifts its audio to match', () => {
        const plan = planABTransition(5, 4, { ...base, bloomFrames: 8 }, FPS);
        expect(plan.bloomFrames).toBe(8);
        expect(plan.moshSegmentFrames).toBe(30 + 8 + 119);
        expect(plan.audioGapSec).toBeCloseTo(8 / FPS);
        expect(planABTransition(5, 4, { ...base, bloomFrames: 99 }, FPS).bloomFrames).toBe(12);
    });

    it('maps heal speed to B residual strength (higher heal = lower CRF)', () => {
        expect(crfForHealSpeed(0)).toBe(CRF_SLOW_HEAL);
        expect(crfForHealSpeed(100)).toBe(CRF_FAST_HEAL);
        expect(crfForHealSpeed(50)).toBe(25);
        expect(planABTransition(5, 4, { ...base, healSpeed: 100 }, FPS).bCrf).toBe(CRF_FAST_HEAL);
    });

    it('clamps the cut to A and shortens the tail when the cut is near the start', () => {
        expect(planABTransition(3, 4, { ...base, cutSec: 99 }, FPS).cutSec).toBe(3);
        const early = planABTransition(3, 4, { ...base, cutSec: 0.5 }, FPS);
        expect(early.aHead).toBeNull();
        expect(early.aTail).toEqual({ startSec: 0, endSec: 0.5, frames: 15 });
        expect(MAX_TAIL_SEC).toBe(1);
    });

    it('clamps the sweep to the frames B has', () => {
        const plan = planABTransition(5, 1, { ...base, resolve: 'sweep', moshSec: 10, sweepSec: 2 }, FPS);
        expect(plan.sweep).toEqual({ firstB: 29, lastB: 29 });
        expect(plan.bTail).toBeNull();
    });

    it('rejects clips too short to mosh', () => {
        expect(() => planABTransition(1 / FPS, 4, base, FPS)).toThrow(/Clip A is too short/);
        expect(() => planABTransition(4, 1 / FPS, base, FPS)).toThrow(/Clip B is too short/);
    });
});

describe('buildABStream', () => {
    const key = (id: string, bytes = 5000) => ({ chunk: id, isKey: true, byteLength: bytes });
    const delta = (id: string, bytes = 300) => ({ chunk: id, isKey: false, byteLength: bytes });

    it('keeps A tail intact, drops every B keyframe, and plays B deltas exactly once', () => {
        const s = buildABStream([key('A0'), delta('A1')], [key('B0'), delta('B1'), key('B2'), delta('B3')], { maxBDeltas: 10 });
        expect(s.chunks).toEqual(['A0', 'A1', 'B1', 'B3']);
        expect(s.bIndex).toEqual([-1, -1, 1, 2]);
        expect(s.dropped).toEqual([]);
    });

    it('bloom replays the strongest of the first deltas at the cut only', () => {
        const b = [key('B0'), delta('B1', 100), delta('B2', 900), delta('B3', 200)];
        const s = buildABStream([key('A0')], b, { maxBDeltas: 10, bloomFrames: 3 });
        expect(s.chunks).toEqual(['A0', 'B1', 'B2', 'B2', 'B2', 'B2', 'B3']);
        expect(s.bIndex).toEqual([-1, 1, 2, 2, 2, 2, 3]);
    });

    it('carry replays A\'s last delta after A\'s tail, before any B delta, and never a keyframe', () => {
        const s = buildABStream([key('A0'), delta('A1'), delta('A2')], [key('B0'), delta('B1')], { maxBDeltas: 10, carryFrames: 3 });
        expect(s.chunks).toEqual(['A0', 'A1', 'A2', 'A2', 'A2', 'A2', 'B1']);
        expect(s.bIndex).toEqual([-1, -1, -1, -1, -1, -1, 1]);
        expect(buildABStream([key('A0')], [key('B0'), delta('B1')], { maxBDeltas: 10, carryFrames: 3 }).chunks).toEqual(['A0', 'B1']);
        const plan = planABTransition(5, 4, { ...base, carryFrames: 99 }, FPS);
        expect(plan.carryFrames).toBe(15);
        expect(plan.moshSegmentFrames).toBe(30 + 15 + 119);
        expect(plan.audioGapSec).toBeCloseTo(15 / FPS);
    });

    it('hold drops intra-heavy deltas above 0.7 x the largest, but never the first', () => {
        const b = [key('B0'), delta('B1', 1000), delta('B2', 100), delta('B3', 950), delta('B4', 200)];
        const s = buildABStream([key('A0')], b, { maxBDeltas: 10, hold: true });
        expect(s.chunks).toEqual(['A0', 'B1', 'B2', 'B4']);
        expect(s.dropped).toEqual([3]);
    });

    it('hold keeps every delta from holdBefore on, so the heal window is not squeezed', () => {
        const b = [key('B0'), delta('B1', 1000), delta('B2', 950), delta('B3', 960), delta('B4', 200)];
        const s = buildABStream([key('A0')], b, { maxBDeltas: 10, hold: true, holdBefore: 3 });
        expect(s.dropped).toEqual([2]);
        expect(s.chunks).toEqual(['A0', 'B1', 'B3', 'B4']);
    });

    it('caps the number of B deltas and validates inputs', () => {
        expect(buildABStream([key('A0')], [key('B0'), delta('B1'), delta('B2')], { maxBDeltas: 1 }).chunks).toEqual(['A0', 'B1']);
        expect(() => buildABStream([delta('A1')], [delta('B1')], { maxBDeltas: 5 })).toThrow(/must start with a keyframe/);
        expect(() => buildABStream([key('A0')], [key('B0')], { maxBDeltas: 5 })).toThrow(/no delta frames/);
    });
});

describe('sweepColumns', () => {
    const win = { firstB: 60, lastB: 89 };
    it('is 0 before the sweep, full after, and grows monotonically in between', () => {
        expect(sweepColumns(1280, 59, win)).toBe(0);
        expect(sweepColumns(1280, 89, win)).toBe(80);
        const cols = Array.from({ length: 30 }, (_, i) => sweepColumns(1280, 60 + i, win));
        expect(cols.every((c, i) => i === 0 || c >= cols[i - 1])).toBe(true);
        expect(Math.max(...cols.map((c, i) => (i ? c - cols[i - 1] : 0)))).toBeLessThanOrEqual(3);
    });
});
