/**
 * Datamosh Engine: Full Timeline Renderer (Optimized)
 *
 * Pipeline:
 * 1. Sort mosh regions by start time
 * 2. Split the timeline into segments (original gaps + moshed regions)
 * 3. For each original segment: FFmpeg copies from source
 * 4. For each moshed segment:
 *    a) FFmpeg re-encodes with -g 99999999 (single GOP): required for datamosh
 *    b) mediabunny extracts raw encoded packets
 *    c) Packets are manipulated (I-frame removal, repetition, shuffling)
 *    d) VideoDecoder batch-decodes the corrupted stream (NO setInterval)
 *    e) VideoEncoder (HW H.264) + mediabunny muxes directly to MP4
 * 5. FFmpeg concat demuxer joins all segments → final MP4
 * 6. Output matches source resolution and covers the full timeline
 */

import { ffmpegService } from './ffmpegService';
import { fetchFile } from '@ffmpeg/util';
import {
    Input,
    BlobSource as MBBlobSource,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    EncodedPacket,
    Output,
    Mp4OutputFormat,
    BufferTarget,
    MP4,
    ALL_FORMATS,
} from 'mediabunny';
import type { MoshSettings, MoshRegion } from '../types';
import { planABTransition, buildABStream, sweepColumns, type ABOptions, type ABPlan } from './abTransition';

const FPS = 30;

export interface MoshResult {
    url: string;
    blob: Blob;
}

// ─── FFmpeg loader ──────────────────────────────────────────────────────

async function ensureFFmpegLoaded(onStatus?: (msg: string) => void) {
    onStatus?.('Loading FFmpeg...');
    await ffmpegService.load((msg) => {
        // Defensive check: ensure msg is a string before calling includes
        const log = typeof msg === 'string' ? msg : String(msg);
        if (!log.includes('built with')) {
            onStatus?.(log);
        }
    });
}

// ─── Get source video metadata ──────────────────────────────────────────

async function getSourceMetadata(file: File): Promise<{
    width: number; height: number; duration: number;
}> {
    const input = new Input({
        source: new MBBlobSource(file),
        formats: [MP4],
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found');
    const duration = await track.computeDuration();
    const width = track.codedWidth;
    const height = track.codedHeight;
    input.dispose();
    return { width, height, duration };
}

// ─── Single-region mosh pipeline ────────────────────────────────────────

/** Re-encode a file (or segment) with single-GOP for packet extraction */
async function reencodeSegment(
    inputFile: string,
    outputFile: string,
    startSec?: number,
    durSec?: number,
    scaleToSize?: { w: number; h: number },
    fps?: number,
    mosh?: { crf: number },
): Promise<Uint8Array> {
    const args: string[] = [];
    if (startSec !== undefined && startSec > 0) args.push('-ss', startSec.toFixed(3));
    args.push('-i', inputFile);
    if (durSec !== undefined) args.push('-t', durSec.toFixed(3));
    const filters: string[] = [];
    // Force same resolution for transition clips: critical for packet compatibility
    if (scaleToSize) {
        filters.push(`scale=${scaleToSize.w}:${scaleToSize.h}:force_original_aspect_ratio=decrease,pad=${scaleToSize.w}:${scaleToSize.h}:(ow-iw)/2:(oh-ih)/2`);
    }
    // One packet per timeline frame, so packet counts match frame-based plans.
    if (fps) filters.push(`fps=${fps}`);
    if (filters.length) args.push('-vf', filters.join(','));
    args.push(
        '-vcodec', 'libx264',
        '-g', '99999999',
        '-bf', '0',
        '-flags:v', '+cgop',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart',
        '-crf', String(mosh?.crf ?? 15),
        '-preset', 'ultrafast',
        // A→B: no scene-cut keyframes (they would heal the mosh instantly), and
        // stitchable headers so a different CRF for B keeps A's SPS/PPS valid.
        ...(mosh ? ['-sc_threshold', '0', '-x264-params', 'stitchable=1'] : []),
        '-an',
        outputFile,
    );
    await ffmpegService.exec(args);
    const data = await ffmpegService.readFile(outputFile) as Uint8Array;
    await ffmpegService.deleteFile(outputFile);
    return data;
}

/** Extract encoded packets from an MP4 buffer via mediabunny */
interface PacketInfo { chunk: EncodedVideoChunk; isKey: boolean; byteLength: number; }

async function extractPacketsFromData(
    mp4Data: Uint8Array,
): Promise<{ packets: PacketInfo[]; config: VideoDecoderConfig }> {
    const blob = new Blob([mp4Data as any], { type: 'video/mp4' });
    const input = new Input({
        source: new MBBlobSource(blob),
        formats: [MP4],
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found');
    const config = await videoTrack.getDecoderConfig();
    if (!config) throw new Error('Could not get VideoDecoderConfig');

    const sink = new EncodedPacketSink(videoTrack);
    const packets: PacketInfo[] = [];
    for await (const packet of sink.packets()) {
        const chunk = packet.toEncodedVideoChunk();
        packets.push({ chunk, isKey: chunk.type === 'key', byteLength: chunk.byteLength });
    }
    input.dispose();
    return { packets, config };
}

async function moshRegion(
    region: MoshRegion,
    sourceWidth: number,
    sourceHeight: number,
    onStatus?: (msg: string) => void,
): Promise<Uint8Array> {
    const startSec = region.startMs / 1000;
    const durSec = region.durationMs / 1000;

    if (region.mode === 'transition' && region.transitionFile) {
        // ─── TRANSITION MOSH ─────────────────────────────────────
        const dims = { w: sourceWidth, h: sourceHeight };

        onStatus?.('Re-encoding source for transition...');
        const srcData = await reencodeSegment(
            'source.mp4', `trans_src_${region.id}.mp4`, startSec, durSec, dims
        );
        const { packets: srcPackets, config } = await extractPacketsFromData(srcData);

        onStatus?.('Re-encoding transition clip (matching resolution)...');
        const transInputName = `trans_input_${region.id}.mp4`;
        await ffmpegService.writeFile(transInputName, await fetchFile(region.transitionFile));

        let transData: Uint8Array;
        try {
            transData = await reencodeSegment(
                transInputName, `trans_reenc_${region.id}.mp4`, 0, durSec, dims
            );
        } finally {
            await ffmpegService.deleteFile(transInputName).catch(() => {});
        }

        const { packets: transPackets } = await extractPacketsFromData(transData);

        if (transPackets.filter(p => !p.isKey).length === 0) {
            throw new Error('Transition clip produced no delta frames: try a longer clip');
        }

        onStatus?.(`Building transition stream (${srcPackets.length} + ${transPackets.length} packets)...`);
        const moshed = buildTransitionStream(srcPackets, transPackets, region.intensity);

        onStatus?.(`Encoding ${moshed.length} transition packets → MP4...`);
        const targetFrames = Math.ceil(durSec * FPS);
        return decodeAndEncode(moshed, config, sourceWidth, sourceHeight, targetFrames);
    }

    // ─── STANDARD MOSH MODES ─────────────────────────────────
    const dims = { w: sourceWidth, h: sourceHeight };

    onStatus?.(`Re-encoding ${region.mode} region (${durSec.toFixed(1)}s)...`);
    const reencodedData = await reencodeSegment(
        'source.mp4', `mosh_reenc_${region.id}.mp4`, startSec, durSec
    );
    const { packets: srcPackets, config } = await extractPacketsFromData(reencodedData);

    let packets: PacketInfo[];
    if (region.transitionFile) {
        onStatus?.('Re-encoding secondary clip...');
        const secInputName = `sec_input_${region.id}.mp4`;
        await ffmpegService.writeFile(secInputName, await fetchFile(region.transitionFile));
        let secData: Uint8Array;
        try {
            secData = await reencodeSegment(
                secInputName, `sec_reenc_${region.id}.mp4`, 0, durSec, dims
            );
        } finally {
            await ffmpegService.deleteFile(secInputName).catch(() => {});
        }
        const { packets: secPackets } = await extractPacketsFromData(secData);

        const srcKeys = srcPackets.filter(p => p.isKey);
        const secDeltas = secPackets.filter(p => !p.isKey);
        if (secDeltas.length > 0) {
            packets = [...srcKeys, ...secDeltas];
        } else {
            packets = srcPackets; 
        }
    } else {
        packets = srcPackets;
    }

    if (packets.length < 2) throw new Error('Not enough packets');

    onStatus?.(`Applying ${region.mode} effect (${packets.length} packets)...`);
    let moshed: EncodedVideoChunk[];
    switch (region.mode) {
        case 'liquid': moshed = buildLiquidStream(packets, region.intensity); break;
        case 'trail': moshed = buildTrailStream(packets, region.intensity); break;
        case 'bloom': moshed = buildBloomStream(packets, region.intensity); break;
        case 'stutter': moshed = buildStutterStream(packets, region.intensity); break;
        case 'reverse': moshed = buildReverseStream(packets, region.intensity); break;
        case 'pulse': moshed = buildPulseStream(packets, region.intensity); break;
        case 'shatter': moshed = buildShatterStream(packets, region.intensity); break;
        default: moshed = buildLiquidStream(packets, region.intensity);
    }

    onStatus?.(`Encoding ${moshed.length} packets → MP4...`);
    const targetFrames = Math.ceil(durSec * FPS);
    return decodeAndEncode(moshed, config, sourceWidth, sourceHeight, targetFrames);
}

// ─── Packet stream manipulators ─────────────────────────────────────────

function buildLiquidStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    let foundFirst = false;
    for (const p of packets) {
        if (p.isKey) {
            if (!foundFirst) { result.push(p.chunk); foundFirst = true; }
            continue;
        }
        result.push(p.chunk);
    }
    if (intensity > 60) {
        const repeats = Math.floor((intensity - 60) / 20) + 1;
        const expanded: EncodedVideoChunk[] = [result[0]];
        for (let i = 1; i < result.length; i++) {
            expanded.push(result[i]);
            for (let r = 0; r < repeats; r++) expanded.push(result[i]);
        }
        return expanded;
    }
    return result;
}

function buildTrailStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    const repeatCount = Math.floor(2 + (intensity / 100) * 6);
    let foundFirst = false;
    for (const p of packets) {
        if (p.isKey && !foundFirst) { result.push(p.chunk); foundFirst = true; continue; }
        if (p.isKey) continue;
        for (let i = 0; i < repeatCount; i++) result.push(p.chunk);
    }
    return result;
}

function buildBloomStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    let foundFirst = false;
    const deltas: EncodedVideoChunk[] = [];
    for (const p of packets) {
        if (p.isKey && !foundFirst) { result.push(p.chunk); foundFirst = true; continue; }
        if (p.isKey) continue;
        deltas.push(p.chunk);
    }
    const segSize = Math.max(3, Math.floor(24 * (1 - intensity / 100)));
    const segments: EncodedVideoChunk[][] = [];
    for (let i = 0; i < deltas.length; i += segSize) segments.push(deltas.slice(i, i + segSize));
    for (let i = segments.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [segments[i], segments[j]] = [segments[j], segments[i]];
    }
    for (const seg of segments) {
        result.push(...(Math.random() > 0.5 ? seg.slice().reverse() : seg));
    }
    return result;
}

function buildStutterStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    let foundFirst = false;
    const deltas: EncodedVideoChunk[] = [];
    for (const p of packets) {
        if (p.isKey && !foundFirst) { result.push(p.chunk); foundFirst = true; continue; }
        if (p.isKey) continue;
        deltas.push(p.chunk);
    }
    const loopSize = Math.max(2, Math.floor(8 * (1 - intensity / 100)));
    const skipChance = 0.1 + (intensity / 100) * 0.35;
    let i = 0;
    while (i < deltas.length) {
        if (Math.random() < skipChance) { i += Math.floor(Math.random() * 12) + 2; continue; }
        const end = Math.min(i + loopSize, deltas.length);
        const loops = Math.floor(Math.random() * 4) + 2;
        for (let l = 0; l < loops; l++) for (let j = i; j < end; j++) result.push(deltas[j]);
        i = end;
    }
    return result;
}

function buildReverseStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    let foundFirst = false;
    const deltas: EncodedVideoChunk[] = [];
    for (const p of packets) {
        if (p.isKey && !foundFirst) { result.push(p.chunk); foundFirst = true; continue; }
        if (p.isKey) continue;
        deltas.push(p.chunk);
    }
    const segSize = Math.max(2, Math.floor(30 * (1 - intensity / 100)));
    const segments: EncodedVideoChunk[][] = [];
    for (let i = 0; i < deltas.length; i += segSize) {
        segments.push(deltas.slice(i, i + segSize));
    }
    segments.reverse();
    for (const seg of segments) {
        result.push(...seg.reverse());
    }
    return result;
}

function buildPulseStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    let keyframe: EncodedVideoChunk | null = null;
    const deltas: EncodedVideoChunk[] = [];
    for (const p of packets) {
        if (p.isKey && !keyframe) { keyframe = p.chunk; continue; }
        if (p.isKey) continue;
        deltas.push(p.chunk);
    }
    if (!keyframe) return [];
    const interval = Math.max(3, Math.floor(30 * (1 - intensity / 100)));
    result.push(keyframe);
    for (let i = 0; i < deltas.length; i++) {
        if (i > 0 && i % interval === 0) {
            result.push(keyframe); 
        }
        result.push(deltas[i]);
    }
    return result;
}

function buildShatterStream(packets: PacketInfo[], intensity: number): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    let foundFirst = false;
    const deltas: EncodedVideoChunk[] = [];
    for (const p of packets) {
        if (p.isKey && !foundFirst) { result.push(p.chunk); foundFirst = true; continue; }
        if (p.isKey) continue;
        deltas.push(p.chunk);
    }
    const randomChance = 0.2 + (intensity / 100) * 0.7; 
    for (let i = 0; i < deltas.length; i++) {
        if (Math.random() < randomChance) {
            const randIdx = Math.floor(Math.random() * deltas.length);
            result.push(deltas[randIdx]);
        } else {
            result.push(deltas[i]);
        }
    }
    return result;
}

function buildTransitionStream(
    srcPackets: PacketInfo[],
    transPackets: PacketInfo[],
    intensity: number,
): EncodedVideoChunk[] {
    const result: EncodedVideoChunk[] = [];
    const srcKeyframes = srcPackets.filter(p => p.isKey);
    if (srcKeyframes.length === 0) throw new Error('No keyframe in source');
    const transDeltas = transPackets.filter(p => !p.isKey);
    if (transDeltas.length === 0) throw new Error('No delta frames in transition clip');
    result.push(srcKeyframes[0].chunk);
    const resetInterval = intensity >= 90
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

async function decodeAndEncode(
    chunks: EncodedVideoChunk[],
    config: VideoDecoderConfig,
    width: number,
    height: number,
    targetFrames: number,
): Promise<Uint8Array> {
    const frames: VideoFrame[] = [];
    const decoder = new VideoDecoder({
        error: (e) => console.debug('Decoder (expected mosh):', e.message),
        output: (frame) => {
            if (frames.length < targetFrames) {
                frames.push(frame);
            } else {
                frame.close();
            }
        },
    });
    decoder.configure(config);
    for (const chunk of chunks) {
        try { decoder.decode(chunk); } catch (e) {}
    }
    await decoder.flush().catch(() => {});
    if (decoder.state !== 'closed') decoder.close();
    if (frames.length === 0) {
        throw new Error('Decoder produced no frames');
    }
    while (frames.length < targetFrames) {
        const lastFrame = frames[frames.length - 1];
        frames.push(new VideoFrame(lastFrame, { timestamp: lastFrame.timestamp! }));
    }
    const target = new BufferTarget();
    const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
    });
    const videoSource = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(videoSource);
    await output.start();
    const encoderDone = new Promise<void>((resolve, reject) => {
        const encoder = new VideoEncoder({
            output: async (chunk, meta) => {
                try {
                    await videoSource.add(
                        EncodedPacket.fromEncodedChunk(chunk),
                        meta ?? undefined,
                    );
                } catch (e) {
                    console.debug('Muxer add error (non-fatal):', e);
                }
            },
            error: reject,
        });
        encoder.configure({
            codec: 'avc1.4d0034', 
            width,
            height,
            bitrate: 8_000_000,
            framerate: FPS,
        });
        const frameDuration = 1_000_000 / FPS; 
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const retimedFrame = new VideoFrame(frame, {
                timestamp: i * frameDuration,
                duration: frameDuration,
            });
            frame.close();
            encoder.encode(retimedFrame, { keyFrame: i === 0 });
            retimedFrame.close();
        }
        encoder.flush().then(() => {
            encoder.close();
            resolve();
        }).catch(reject);
    });
    await encoderDone;
    await output.finalize();
    return new Uint8Array(target.buffer);
}

function snapToFrame(sec: number): number {
    return Math.round(sec * FPS) / FPS;
}

function framesToCount(startSec: number, endSec: number): number {
    return Math.round((endSec - startSec) * FPS);
}

interface Segment {
    type: 'original' | 'moshed';
    startSec: number;
    endSec: number;
    frames: number;
    region?: MoshRegion;
    filename: string;
}

export type AudioMode = 'none' | 'preserve' | 'glitch';

export async function renderFullTimeline(
    file: File,
    regions: MoshRegion[],
    onProgress?: (progress: number) => void,
    onStatus?: (msg: string) => void,
    audioMode: AudioMode = 'none',
): Promise<MoshResult> {
    await ensureFFmpegLoaded(onStatus);
    onStatus?.('Analyzing source video...');
    const { width, height, duration: srcDuration } = await getSourceMetadata(file);
    const totalMs = srcDuration * 1000;
    onStatus?.('Loading source into FFmpeg...');
    await ffmpegService.writeFile('source.mp4', await fetchFile(file));
    const sorted = [...regions]
        .filter(r => r.durationMs > 0)
        .sort((a, b) => a.startMs - b.startMs);
    const segments: Segment[] = [];
    let segIdx = 0;
    let cursor = 0; 
    for (const region of sorted) {
        const rStart = snapToFrame(Math.max(0, region.startMs / 1000));
        const rEnd = snapToFrame(Math.min(srcDuration, (region.startMs + region.durationMs) / 1000));
        if (rStart > cursor + (1 / FPS)) {
            segments.push({
                type: 'original',
                startSec: cursor,
                endSec: rStart,
                frames: framesToCount(cursor, rStart),
                filename: `seg_${segIdx++}.mp4`,
            });
        }
        segments.push({
            type: 'moshed',
            startSec: rStart,
            endSec: rEnd,
            frames: framesToCount(rStart, rEnd),
            region,
            filename: `seg_${segIdx++}.mp4`,
        });
        cursor = rEnd;
    }
    const snappedEnd = snapToFrame(srcDuration);
    if (cursor < snappedEnd - (1 / FPS)) {
        segments.push({
            type: 'original',
            startSec: cursor,
            endSec: snappedEnd,
            frames: framesToCount(cursor, snappedEnd),
            filename: `seg_${segIdx++}.mp4`,
        });
    }
    const totalSegments = segments.length;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const baseProgress = i / totalSegments;
        onProgress?.(baseProgress);
        if (seg.type === 'original') {
            onStatus?.(`Copying original segment ${i + 1}/${totalSegments} (${seg.frames} frames)...`);
            await ffmpegService.exec([
                '-i', 'source.mp4',
                '-ss', seg.startSec.toFixed(6),
                '-frames:v', String(seg.frames),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-pix_fmt', 'yuv420p',
                '-r', String(FPS),
                '-video_track_timescale', String(FPS * 3000),
                '-an',
                '-y', seg.filename,
            ]);
        } else {
            const mp4Data = await moshRegion(seg.region!, width, height, onStatus);
            onStatus?.(`Writing moshed segment ${i + 1}/${totalSegments}...`);
            await ffmpegService.writeFile(seg.filename, mp4Data);
        }
        onProgress?.((i + 1) / totalSegments * 0.9);
    }
    onStatus?.('Joining segments into final MP4...');
    onProgress?.(0.9);
    const concatContent = segments.map(s => `file '${s.filename}'`).join('\n');
    await ffmpegService.writeFile('concat.txt',
        new TextEncoder().encode(concatContent));
    await ffmpegService.exec([
        '-f', 'concat', '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        '-movflags', 'faststart',
        '-y', 'output_video.mp4',
    ]);
    let finalFile = 'output_video.mp4';
    if (audioMode !== 'none') {
        onStatus?.(audioMode === 'glitch' ? 'Glitching audio...' : 'Muxing audio...');
        onProgress?.(0.95);
        if (audioMode === 'preserve') {
            await ffmpegService.exec([
                '-i', 'output_video.mp4',
                '-i', 'source.mp4',
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', '192k',
                '-map', '0:v:0',
                '-map', '1:a:0?',
                '-shortest',
                '-movflags', 'faststart',
                '-y', 'output_final.mp4',
            ]);
            finalFile = 'output_final.mp4';
        } else {
            await ffmpegService.exec([
                '-i', 'output_video.mp4',
                '-i', 'source.mp4',
                '-c:v', 'copy',
                '-map', '0:v:0',
                '-map', '1:a:0?',
                '-af', 'aecho=0.8:0.88:60|120:0.4|0.25,aphaser=type=t:speed=2:decay=0.6,atempo=0.98',
                '-c:a', 'aac', '-b:a', '192k',
                '-shortest',
                '-movflags', 'faststart',
                '-y', 'output_final.mp4',
            ]);
            finalFile = 'output_final.mp4';
        }
    }
    const outputData = await ffmpegService.readFile(finalFile) as Uint8Array;
    const outputBlob = new Blob([outputData.buffer as any], { type: 'video/mp4' });
    const url = URL.createObjectURL(outputBlob);
    onProgress?.(1);
    onStatus?.('Done!');
    const cleanup = async () => {
        for (const seg of segments) await ffmpegService.deleteFile(seg.filename).catch(() => {});
        await ffmpegService.deleteFile('source.mp4').catch(() => {});
        await ffmpegService.deleteFile('concat.txt').catch(() => {});
        await ffmpegService.deleteFile('output_video.mp4').catch(() => {});
        await ffmpegService.deleteFile('output_final.mp4').catch(() => {});
    };
    cleanup();
    return { url, blob: outputBlob };
}

// ─── A → B two-clip transition ──────────────────────────────────────────

export type ABAudioMode = 'none' | 'keep';

export interface ABResult extends MoshResult {
    plan: ABPlan;
    /** Set when audio was requested but could not be kept. */
    audioNote?: string;
}

interface VideoInfo {
    width: number;
    height: number;
    duration: number;
    hasAudio: boolean;
}

async function getVideoInfo(file: File): Promise<VideoInfo> {
    const input = new Input({ source: new MBBlobSource(file), formats: ALL_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error(`No video track found in ${file.name}`);
        const duration = await input.computeDuration();
        const hasAudio = (await input.getPrimaryAudioTrack()) !== null;
        // H.264 needs even dimensions; display size avoids coded padding (1080 → 1088).
        const even = (n: number) => Math.max(2, n - (n % 2));
        return { width: even(track.displayWidth), height: even(track.displayHeight), duration, hasAudio };
    } finally {
        input.dispose();
    }
}

/** Every segment joined by stream-copy concat must share codec settings and timebase. */
const X264_SEGMENT_ARGS = [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    // WebCodecs tags the mosh segment BT.709 limited range. Tag every segment the
    // same, or players switch color conversion at each join and the picture pops.
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    '-video_track_timescale', String(FPS * 3000),
];

/** Re-encode a clean span, letterboxed to the output size, at the timeline frame rate. */
async function encodeCleanSpan(
    inputFile: string,
    outputFile: string,
    startSec: number,
    frames: number,
    dims: { w: number; h: number },
): Promise<void> {
    await ffmpegService.exec([
        '-ss', startSec.toFixed(6),
        '-i', inputFile,
        '-frames:v', String(frames),
        '-vf', `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=decrease,pad=${dims.w}:${dims.h}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`,
        ...X264_SEGMENT_ARGS,
        '-an',
        '-y', outputFile,
    ]);
}

/** Decode clean B frames for the sweep window, keyed by B frame index (0 = B's keyframe). */
async function decodeCleanFrames(
    packets: PacketInfo[],
    config: VideoDecoderConfig,
    firstB: number,
    lastB: number,
): Promise<Map<number, VideoFrame>> {
    const frames = new Map<number, VideoFrame>();
    let n = 0;
    const decoder = new VideoDecoder({
        error: (e) => console.debug('Clean B decode:', e.message),
        output: (frame) => {
            const index = n++;
            if (index >= firstB && index <= lastB) frames.set(index, frame);
            else frame.close();
        },
    });
    decoder.configure(config);
    for (const p of packets.slice(0, lastB + 1)) {
        while (decoder.decodeQueueSize > 16) await new Promise(r => setTimeout(r, 1));
        decoder.decode(p.chunk);
    }
    await decoder.flush();
    decoder.close();
    return frames;
}

/**
 * Decode the moshed stream and re-encode it frame by frame (no whole-clip buffering).
 * In sweep mode each output frame showing B frame b gets the first sweepColumns()
 * 16 px columns replaced by clean B frame b: an intra-refresh style repaint.
 * Melt and hold composite nothing: the output is exactly what the decoder produced.
 */
interface HealContext {
    window: { firstB: number; lastB: number };
    clean: Map<number, VideoFrame>;
}

async function encodeMoshSegment(
    chunks: EncodedVideoChunk[],
    bIndex: number[],
    config: VideoDecoderConfig,
    width: number,
    height: number,
    sweep?: HealContext,
): Promise<{ data: Uint8Array; frames: number }> {
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const videoSource = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(videoSource);
    await output.start();

    let muxChain: Promise<void> = Promise.resolve();
    let encoderError: unknown = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => {
            muxChain = muxChain.then(() => videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta ?? undefined));
        },
        error: (e) => { encoderError = e; },
    });
    encoder.configure({ codec: 'avc1.4d0034', width, height, bitrate: 8_000_000, framerate: FPS });

    const canvas = sweep ? new OffscreenCanvas(width, height) : null;
    const ctx = canvas ? canvas.getContext('2d') : null;
    const frameDuration = 1_000_000 / FPS;
    let n = 0;
    const decoder = new VideoDecoder({
        error: (e) => console.debug('Decoder (expected mosh):', e.message),
        output: (frame) => {
            const i = n++;
            const b = bIndex[i] ?? -1;
            const clean = sweep && b > 0 ? sweep.clean.get(b) : undefined;
            let out: VideoFrame;
            if (ctx && canvas && clean && sweep) {
                const cleanWidth = Math.min(width, sweepColumns(width, b, sweep.window) * 16);
                ctx.drawImage(frame, 0, 0, width, height);
                if (cleanWidth > 0) ctx.drawImage(clean, 0, 0, cleanWidth, height, 0, 0, cleanWidth, height);
                out = new VideoFrame(canvas, { timestamp: i * frameDuration, duration: frameDuration });
            } else {
                out = new VideoFrame(frame, { timestamp: i * frameDuration, duration: frameDuration });
            }
            frame.close();
            encoder.encode(out, { keyFrame: i === 0 });
            out.close();
        },
    });
    decoder.configure(config);
    for (const chunk of chunks) {
        while (decoder.decodeQueueSize > 16 || encoder.encodeQueueSize > 16) {
            await new Promise(r => setTimeout(r, 1));
        }
        try { decoder.decode(chunk); } catch (e) { /* corrupt references are the point */ }
    }
    await decoder.flush().catch(() => {});
    if (decoder.state !== 'closed') decoder.close();
    await encoder.flush();
    encoder.close();
    await muxChain;
    if (encoderError) throw encoderError;
    if (n === 0) throw new Error('Decoder produced no frames');
    await output.finalize();
    return { data: new Uint8Array(target.buffer), frames: n };
}

/**
 * Datamosh from clip A into clip B (I-frame removal melt). A plays clean up to
 * the cut, then B's delta frames play 1:1 on A's last frame; B takes over through
 * its residuals (melt), a column sweep (sweep), or a sticky smear that then melts
 * (hold). Output size follows clip A.
 */
export async function renderABTransition(
    fileA: File,
    fileB: File,
    options: ABOptions,
    onProgress?: (progress: number) => void,
    onStatus?: (msg: string) => void,
    audioMode: ABAudioMode = 'none',
): Promise<ABResult> {
    await ensureFFmpegLoaded(onStatus);
    onStatus?.('Analyzing clips...');
    const [infoA, infoB] = await Promise.all([getVideoInfo(fileA), getVideoInfo(fileB)]);
    const dims = { w: infoA.width, h: infoA.height };
    const plan = planABTransition(infoA.duration, infoB.duration, options, FPS);

    onStatus?.('Loading clips into FFmpeg...');
    await ffmpegService.writeFile('ab_a.mp4', await fetchFile(fileA));
    await ffmpegService.writeFile('ab_b.mp4', await fetchFile(fileB));

    const segments: string[] = [];
    const scratch = ['ab_a.mp4', 'ab_b.mp4', 'ab_concat.txt', 'ab_video.mp4', 'ab_final.mp4'];
    onProgress?.(0.05);

    try {
        if (plan.aHead) {
            onStatus?.(`Clip A: ${plan.aHead.frames} clean frames...`);
            await encodeCleanSpan('ab_a.mp4', 'ab_seg_head.mp4', plan.aHead.startSec, plan.aHead.frames, dims);
            segments.push('ab_seg_head.mp4');
        }
        onProgress?.(0.2);

        // A's tail and B share every x264 header setting, so B's slices decode against A's SPS/PPS.
        onStatus?.('Re-encoding the end of clip A as the mosh reference...');
        const tailData = await reencodeSegment(
            'ab_a.mp4', 'ab_tail_reenc.mp4', plan.aTail.startSec, plan.aTail.endSec - plan.aTail.startSec, dims, FPS,
            { crf: 15 },
        );
        const { packets: tailPackets, config } = await extractPacketsFromData(tailData);
        onProgress?.(0.3);

        onStatus?.(`Re-encoding clip B for its motion (heal CRF ${plan.bCrf})...`);
        const bData = await reencodeSegment('ab_b.mp4', 'ab_b_reenc.mp4', 0, plan.bConsumedSec, dims, FPS, { crf: plan.bCrf });
        const { packets: bPackets, config: bConfig } = await extractPacketsFromData(bData);
        onProgress?.(0.45);

        const stream = buildABStream(tailPackets, bPackets, {
            maxBDeltas: plan.bDeltas,
            bloomFrames: plan.bloomFrames,
            carryFrames: plan.carryFrames,
            hold: options.resolve === 'hold',
            holdBefore: plan.holdUntilB ?? undefined,
        });
        let sweepCtx: HealContext | undefined;
        if (plan.sweep) {
            onStatus?.('Decoding clean B for the sweep...');
            sweepCtx = {
                window: plan.sweep,
                clean: await decodeCleanFrames(bPackets, bConfig, plan.sweep.firstB, plan.sweep.lastB),
            };
        }
        const bShown = stream.bIndex.filter(b => b > 0).length;
        onStatus?.(`Moshing: ${bShown} B frames over ${tailPackets.length} A frames` +
            (plan.carryFrames ? `, A's motion carried ${plan.carryFrames} frames` : '') +
            (stream.dropped.length ? `, ${stream.dropped.length} heavy frames held back` : '') + '...');
        let mosh: { data: Uint8Array; frames: number };
        try {
            mosh = await encodeMoshSegment(stream.chunks, stream.bIndex, config, dims.w, dims.h, sweepCtx);
        } finally {
            sweepCtx?.clean.forEach(f => f.close());
        }
        const moshData = mosh.data;
        // The WebCodecs segment has its own timebase (1/57600) and profile. Stream-copy
        // concat of mixed timebases collapses its timestamps, so bring it to the same
        // x264 settings as the clean segments before joining.
        await ffmpegService.writeFile('ab_seg_mosh_raw.mp4', moshData);
        scratch.push('ab_seg_mosh_raw.mp4');
        await ffmpegService.exec([
            '-i', 'ab_seg_mosh_raw.mp4',
            '-vf', `fps=${FPS}`,
            ...X264_SEGMENT_ARGS,
            '-an', '-y', 'ab_seg_mosh.mp4',
        ]);
        segments.push('ab_seg_mosh.mp4');
        onProgress?.(0.75);

        if (plan.bTail) {
            onStatus?.(`Clip B: ${plan.bTail.frames} clean frames...`);
            await encodeCleanSpan('ab_b.mp4', 'ab_seg_btail.mp4', plan.bTail.startSec, plan.bTail.frames, dims);
            segments.push('ab_seg_btail.mp4');
        }
        onProgress?.(0.85);

        onStatus?.('Joining segments...');
        await ffmpegService.writeFile('ab_concat.txt',
            new TextEncoder().encode(segments.map(s => `file '${s}'`).join('\n')));
        await ffmpegService.exec([
            '-f', 'concat', '-safe', '0', '-i', 'ab_concat.txt',
            '-c', 'copy', '-movflags', 'faststart', '-y', 'ab_video.mp4',
        ]);

        let finalFile = 'ab_video.mp4';
        let audioNote: string | undefined;
        if (audioMode === 'keep') {
            if (!infoA.hasAudio || !infoB.hasAudio) {
                audioNote = 'One clip has no audio track, so the export is silent.';
            } else {
                onStatus?.('Joining audio...');
                const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
                const gapMs = Math.round(plan.audioGapSec * 1000);
                const bChain = gapMs > 0 ? `${fmt},adelay=${gapMs}:all=1` : fmt;
                await ffmpegService.exec([
                    '-i', 'ab_video.mp4', '-i', 'ab_a.mp4', '-i', 'ab_b.mp4',
                    '-filter_complex',
                    `[1:a]atrim=0:${plan.cutSec.toFixed(6)},asetpts=PTS-STARTPTS,${fmt}[a0];` +
                    `[2:a]asetpts=PTS-STARTPTS,${bChain}[a1];` +
                    `[a0][a1]concat=n=2:v=0:a=1[aout]`,
                    '-map', '0:v:0', '-map', '[aout]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                    '-shortest', '-movflags', 'faststart', '-y', 'ab_final.mp4',
                ]);
                finalFile = 'ab_final.mp4';
            }
        }

        const outputData = await ffmpegService.readFile(finalFile) as Uint8Array;
        const blob = new Blob([outputData.buffer as any], { type: 'video/mp4' });
        onProgress?.(1);
        onStatus?.('Done!');
        return { url: URL.createObjectURL(blob), blob, plan, audioNote };
    } finally {
        for (const f of [...segments, ...scratch]) await ffmpegService.deleteFile(f).catch(() => {});
    }
}
