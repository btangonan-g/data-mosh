/**
 * A → B Datamosh Transition: pure planning and packet splicing.
 *
 * A real melt (I-frame removal): clip A plays clean, then clip B's keyframe is
 * dropped and B's delta frames play 1:1 on top of A's last frame. B's motion
 * drags A's pixels while B's residuals gradually paint B back in.
 *
 * Resolve modes (none of them splices in a keyframe):
 *   melt:  B's deltas play to the end of B; B takes over through its own residuals.
 *   sweep: after the melt, clean B is swept in by 16 px columns, left to right,
 *          the way an x264 periodic intra refresh repaints a picture.
 *   hold:  for the first moshSec, B's intra-heavy delta frames are dropped (tomato.py
 *          -k) so the smear sticks; after that it plays like melt. Pure decoder output:
 *          no pixels are composited. Without the moshSec limit hold never resolves.
 *
 * Pure datamosh cannot fully clean a static B shot: where B does not change, B's
 * deltas carry no new pixels, so A's colors persist until the next keyframe.
 *
 * Bloom is an optional short burst (a few replayed B deltas) at the cut, not a
 * multiplier on the whole melt: replaying the whole melt makes the moshed motion
 * drift from B's real timeline.
 *
 * Everything here is pure so it can be unit tested without WebCodecs/FFmpeg.
 */

export type ResolveMode = 'melt' | 'sweep' | 'hold';

export interface ABOptions {
    /** Where A stops, in seconds from A's start. */
    cutSec: number;
    resolve: ResolveMode;
    /** Sweep: seconds of melt before the sweep. Hold: seconds of sticky smear (heavy frames dropped). */
    moshSec: number;
    /** Sweep only: seconds the sweep takes to cross the frame. */
    sweepSec: number;
    /** 0–100. Higher re-encodes B with stronger residuals, so B paints back in faster. */
    healSpeed: number;
    /** Extra replays of B's first strong-motion delta at the cut (0 = none). */
    bloomFrames: number;
    /** Replays of A's last delta after the cut, so A's motion carries through it (0 = none). */
    carryFrames?: number;
}

export interface Span {
    startSec: number;
    endSec: number;
    frames: number;
}

export interface ABPlan {
    fps: number;
    cutSec: number;
    /** Clean A before the reference tail; null when the cut is at the very start. */
    aHead: Span | null;
    /** Last part of A, decoded as the mosh reference and shown clean. */
    aTail: Span;
    /** B delta frames fed to the decoder (before hold drops). */
    bDeltas: number;
    /** Seconds of B (from its start) consumed by the moshed segment, keyframe included. */
    bConsumedSec: number;
    bloomFrames: number;
    /** Replays of A's last delta between A's tail and B's first delta. */
    carryFrames: number;
    /** Sweep window in B frame indices (1-based deltas), inclusive; null unless sweep. */
    sweep: { firstB: number; lastB: number } | null;
    /** Hold only: B deltas with an index below this may be dropped; null unless hold. */
    holdUntilB: number | null;
    /** Clean B after the sweep; null unless sweep and B has frames left. */
    bTail: Span | null;
    /** Silence before B's audio so B stays in sync (bloom frames delay B's timeline). */
    audioGapSec: number;
    /** Frames in the moshed segment (A tail + bloom + B deltas), before hold drops. */
    moshSegmentFrames: number;
    totalFrames: number;
    /** x264 CRF for the B re-encode, from healSpeed. */
    bCrf: number;
}

/** Longest stretch of A decoded as the mosh reference. */
export const MAX_TAIL_SEC = 1;
/** Residual strength range: CRF at heal 0 (weak residuals, long smear) and heal 100. */
export const CRF_SLOW_HEAL = 36;
export const CRF_FAST_HEAL = 14;
/** Largest bloom burst, per the 5–10 frame "punctuation" practice. */
export const MAX_BLOOM_FRAMES = 12;
/** Longest carry of A's motion past the cut (half a second at 30 fps). */
export const MAX_CARRY_FRAMES = 15;

export function crfForHealSpeed(healSpeed: number): number {
    const t = Math.min(100, Math.max(0, healSpeed)) / 100;
    return Math.round(CRF_SLOW_HEAL + (CRF_FAST_HEAL - CRF_SLOW_HEAL) * t);
}

export function planABTransition(
    aDurationSec: number,
    bDurationSec: number,
    options: ABOptions,
    fps = 30,
): ABPlan {
    const frameSec = 1 / fps;
    const snap = (sec: number) => Math.round(sec * fps) / fps;
    const frameCount = (sec: number) => Math.round(sec * fps);

    const aFrames = Math.floor(aDurationSec * fps);
    const bFrames = Math.floor(bDurationSec * fps);
    if (aFrames < 2) throw new Error('Clip A is too short: it needs at least 2 frames');
    if (bFrames < 2) throw new Error('Clip B is too short: it needs at least 2 frames');

    const cutSec = snap(Math.min(Math.max(options.cutSec, 2 * frameSec), aFrames / fps));
    const tailSec = snap(Math.min(MAX_TAIL_SEC, cutSec));
    const headFrames = frameCount(cutSec - tailSec);
    const aHead: Span | null = headFrames >= 1
        ? { startSec: 0, endSec: cutSec - tailSec, frames: headFrames }
        : null;
    const aTail: Span = { startSec: cutSec - tailSec, endSec: cutSec, frames: frameCount(tailSec) };

    const bDeltasAvailable = bFrames - 1; // B's first frame is the dropped keyframe
    const bloomFrames = Math.round(Math.min(MAX_BLOOM_FRAMES, Math.max(0, options.bloomFrames)));
    const carryFrames = Math.round(Math.min(MAX_CARRY_FRAMES, Math.max(0, options.carryFrames ?? 0)));

    let bDeltas = bDeltasAvailable;
    let sweep: ABPlan['sweep'] = null;
    let bTail: Span | null = null;
    const holdUntilB = options.resolve === 'hold'
        ? Math.min(bDeltasAvailable + 1, Math.max(1, frameCount(options.moshSec)) + 1)
        : null;
    if (options.resolve === 'sweep') {
        const firstB = Math.min(bDeltasAvailable, Math.max(1, frameCount(options.moshSec)));
        const lastB = Math.min(bDeltasAvailable, firstB + Math.max(1, frameCount(options.sweepSec)) - 1);
        sweep = { firstB, lastB };
        bDeltas = lastB;
        const tailFrames = bFrames - (lastB + 1);
        if (tailFrames >= 1) bTail = { startSec: (lastB + 1) / fps, endSec: bFrames / fps, frames: tailFrames };
    }

    const moshSegmentFrames = aTail.frames + carryFrames + bloomFrames + bDeltas;
    const totalFrames = (aHead?.frames ?? 0) + moshSegmentFrames + (bTail?.frames ?? 0);

    return {
        fps, cutSec, aHead, aTail, bDeltas,
        bConsumedSec: (bDeltas + 1) / fps,
        bloomFrames, carryFrames, sweep, holdUntilB, bTail,
        audioGapSec: (carryFrames + bloomFrames) / fps,
        moshSegmentFrames, totalFrames,
        bCrf: crfForHealSpeed(options.healSpeed),
    };
}

export interface PacketLike<T> {
    chunk: T;
    isKey: boolean;
    byteLength: number;
}

export interface ABStream<T> {
    chunks: T[];
    /** Per output frame: -1 for A's tail, else the B frame index (1-based deltas) it shows. */
    bIndex: number[];
    /** B delta indices removed by hold. */
    dropped: number[];
}

/** tomato.py default: kill frames larger than 0.7 × the largest delta. */
export const HOLD_KILL_RATIO = 0.7;

/**
 * Splice the decoder input: A's tail as encoded (keyframe first, so the decoder
 * has a clean reference), then B's delta frames 1:1 with B's keyframes removed.
 * Optional carry: replay A's last delta right after A's tail (A's momentum through the cut).
 * Optional bloom burst: replay the strongest of B's first few deltas at the cut.
 * Optional hold: drop B deltas bigger than HOLD_KILL_RATIO × the largest one.
 */
export function buildABStream<T>(
    aTailPackets: PacketLike<T>[],
    bPackets: PacketLike<T>[],
    /** holdBefore: only drop deltas with a B index below this (hold's smear window). */
    opts: { maxBDeltas: number; bloomFrames?: number; carryFrames?: number; hold?: boolean; holdBefore?: number },
): ABStream<T> {
    if (aTailPackets.length === 0 || !aTailPackets[0].isKey) {
        throw new Error('Clip A tail must start with a keyframe');
    }
    const deltas = bPackets.filter(p => !p.isKey).slice(0, Math.max(0, opts.maxBDeltas));
    if (deltas.length === 0) {
        throw new Error('Clip B produced no delta frames: try a longer or higher-motion clip');
    }

    const chunks: T[] = aTailPackets.map(p => p.chunk);
    const bIndex: number[] = aTailPackets.map(() => -1);
    const dropped: number[] = [];

    // Carry: replay A's last delta so A's motion keeps dragging its pixels past the cut.
    const lastA = aTailPackets[aTailPackets.length - 1];
    const carry = lastA.isKey ? 0 : Math.max(0, Math.round(opts.carryFrames ?? 0));
    for (let r = 0; r < carry; r++) { chunks.push(lastA.chunk); bIndex.push(-1); }

    const bloom = Math.max(0, Math.round(opts.bloomFrames ?? 0));
    const maxBytes = Math.max(...deltas.map(d => d.byteLength));
    const killAbove = HOLD_KILL_RATIO * maxBytes;

    // Bloom source: the largest (most motion) of B's first 6 deltas, replayed before it plays.
    const window = deltas.slice(0, 6);
    const bloomAt = bloom > 0 ? window.indexOf(window.reduce((a, b) => (b.byteLength > a.byteLength ? b : a))) : -1;

    deltas.forEach((d, i) => {
        const index = i + 1;
        if (opts.hold && i > 0 && index < (opts.holdBefore ?? Infinity) && d.byteLength > killAbove) {
            dropped.push(index);
            return;
        }
        if (i === bloomAt) {
            for (let r = 0; r < bloom; r++) { chunks.push(d.chunk); bIndex.push(index); }
        }
        chunks.push(d.chunk);
        bIndex.push(index);
    });
    return { chunks, bIndex, dropped };
}

/** Columns (16 px macroblocks) of clean B visible at a point in the sweep. */
export function sweepColumns(width: number, bFrameIndex: number, sweep: { firstB: number; lastB: number }): number {
    const cols = Math.ceil(width / 16);
    if (bFrameIndex < sweep.firstB) return 0;
    if (bFrameIndex >= sweep.lastB) return cols;
    const span = sweep.lastB - sweep.firstB + 1;
    return Math.round(((bFrameIndex - sweep.firstB + 1) / span) * cols);
}
