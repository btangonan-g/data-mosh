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
} from 'mediabunny';
import type { MoshSettings, MoshRegion } from '../types';

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
): Promise<Uint8Array> {
    const args: string[] = [];
    if (startSec !== undefined && startSec > 0) args.push('-ss', startSec.toFixed(3));
    args.push('-i', inputFile);
    if (durSec !== undefined) args.push('-t', durSec.toFixed(3));
    // Force same resolution for transition clips: critical for packet compatibility
    if (scaleToSize) {
        args.push('-vf', `scale=${scaleToSize.w}:${scaleToSize.h}:force_original_aspect_ratio=decrease,pad=${scaleToSize.w}:${scaleToSize.h}:(ow-iw)/2:(oh-ih)/2`);
    }
    args.push(
        '-vcodec', 'libx264',
        '-g', '99999999',
        '-bf', '0',
        '-flags:v', '+cgop',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart',
        '-crf', '15',
        '-preset', 'ultrafast',
        '-an',
        outputFile,
    );
    await ffmpegService.exec(args);
    const data = await ffmpegService.readFile(outputFile) as Uint8Array;
    await ffmpegService.deleteFile(outputFile);
    return data;
}

/** Extract encoded packets from an MP4 buffer via mediabunny */
interface PacketInfo { chunk: EncodedVideoChunk; isKey: boolean; }

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
        packets.push({ chunk, isKey: chunk.type === 'key' });
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
