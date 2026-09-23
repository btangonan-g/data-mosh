import React, { useCallback, useRef, useState } from 'react';
import { Flow } from 'flow-sdk';
import { ArrowLeftRight, Upload } from 'lucide-react';
import { renderABTransition, type ABAudioMode, type ABResult } from '../services/datamoshEngine';
import type { ResolveMode } from '../services/abTransition';
import type { MediaState } from '../types';
import { ChromeFrame } from './ChromeFrame';
import { Icon } from './Icon';
import { PillButton, RangeSlider, SectionLabel, SegmentedToggle } from './Primitives';
import { ScribblyArrow } from './ScribblyArrow';

function base64ToUint8Array(base64: string) {
    const binary = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function pickVideo(): Promise<MediaState | null> {
    const media = await Flow.media.select({ filter: 'video' });
    if (!media || media.type !== 'video') return null;
    const file = media.file ?? new File(
        [new Blob([base64ToUint8Array(media.base64 || '')], { type: media.mimeType })],
        media.name || 'video.mp4',
        { type: media.mimeType },
    );
    return {
        id: media.mediaId || media.id || `media_${Date.now()}`,
        dataUrl: media.dataUrl || URL.createObjectURL(file),
        name: media.name || file.name,
        type: 'video',
        file,
    };
}

const fmtSec = (s: number) => `${s.toFixed(1)}s`;

const ClipSlot: React.FC<{
    label: string;
    media: MediaState | null;
    onPick: () => void;
    onDuration: (sec: number) => void;
}> = ({ label, media, onPick, onDuration }) => (
    <div className="flex flex-col gap-3 w-full">
        <SectionLabel>{label}</SectionLabel>
        <ChromeFrame variant="dark" borderWidth={12} className="w-full">
            {media ? (
                <div className="relative bg-black flex items-center justify-center aspect-video">
                    <video
                        src={media.dataUrl}
                        muted
                        loop
                        autoPlay
                        playsInline
                        onLoadedMetadata={(e) => onDuration(e.currentTarget.duration)}
                        className="max-w-full max-h-full object-contain"
                    />
                    <button
                        onClick={onPick}
                        className="absolute bottom-2 right-2 h-[26px] px-3 rounded-lg bg-black/60 border border-white/15 text-[11px] text-white/80 hover:text-white"
                    >
                        Change
                    </button>
                </div>
            ) : (
                <button
                    onClick={onPick}
                    className="w-full aspect-video bg-[#1a1a1a] hover:bg-zinc-800/60 flex flex-col items-center justify-center gap-2 text-[12px] text-white/70"
                >
                    <Upload size={18} />
                    Import {label}
                </button>
            )}
        </ChromeFrame>
        {media && <p className="text-[10px] text-white/35 px-2 truncate">{media.name}</p>}
    </div>
);

export const ABTransitionView: React.FC = () => {
    const [clipA, setClipA] = useState<MediaState | null>(null);
    const [clipB, setClipB] = useState<MediaState | null>(null);
    const [durA, setDurA] = useState(0);
    const [cutSec, setCutSec] = useState<number | null>(null); // null = end of A
    const [resolve, setResolve] = useState<ResolveMode>('sweep');
    const [moshSec, setMoshSec] = useState(2);
    const [sweepSec, setSweepSec] = useState(1);
    const [healSpeed, setHealSpeed] = useState(50);
    const [bloomFrames, setBloomFrames] = useState(0);
    const [carryFrames, setCarryFrames] = useState(0);
    const [audioMode, setAudioMode] = useState<ABAudioMode>('none');

    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ABResult | null>(null);
    const cancelled = useRef(false);

    const pick = useCallback(async (slot: 'A' | 'B') => {
        try {
            const media = await pickVideo();
            if (!media) return;
            if (slot === 'A') { setClipA(media); setCutSec(null); } else { setClipB(media); }
            setResult(null);
            setError(null);
        } catch (err) {
            console.error('Failed to select media:', err);
        }
    }, []);

    const swap = useCallback(() => {
        setClipA(clipB);
        setClipB(clipA);
        setDurA(0);
        setCutSec(null);
        setResult(null);
    }, [clipA, clipB]);

    const effectiveCut = cutSec ?? durA;
    const canRender = !!clipA?.file && !!clipB?.file && durA > 0 && !isProcessing;

    const handleRender = useCallback(async () => {
        if (!clipA?.file || !clipB?.file) return;
        cancelled.current = false;
        setIsProcessing(true);
        setProgress(0);
        setError(null);
        setStatusMsg('Starting render...');
        try {
            const out = await renderABTransition(
                clipA.file, clipB.file,
                { cutSec: effectiveCut, resolve, moshSec, sweepSec, healSpeed, bloomFrames, carryFrames },
                (p) => setProgress(Math.round(p * 100)),
                (msg) => setStatusMsg(msg),
                audioMode,
            );
            if (!cancelled.current) setResult(out);
        } catch (err: any) {
            if (!cancelled.current) setError(`Render failed: ${err?.message || 'Unknown error'}`);
            console.error(err);
        } finally {
            setIsProcessing(false);
            setStatusMsg('');
        }
    }, [clipA, clipB, effectiveCut, resolve, moshSec, sweepSec, healSpeed, bloomFrames, carryFrames, audioMode]);

    const handleSave = useCallback(() => {
        if (!result) return;
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            try {
                await Flow.save({ base64, mimeType: 'video/mp4', name: 'Datamosh A to B', filename: 'datamosh_a_to_b.mp4' });
            } catch (err: any) {
                setError(`Failed to save: ${err?.message || err}`);
            }
        };
        reader.readAsDataURL(result.blob);
    }, [result]);

    return (
        <div className="fixed inset-0 w-screen h-screen bg-[#141414] text-[#ededed] flex flex-col overflow-hidden font-sans">
            <div className="flex-1 flex items-stretch min-h-0 w-full max-w-[1400px] mx-auto px-8 pt-16 pb-8 gap-0 overflow-hidden">
                {/* Clips */}
                <div className="flex flex-col justify-center gap-6 min-w-0 step-panel step-panel-source" style={{ flex: '1 1 0%' }}>
                    <ClipSlot label="Clip A" media={clipA} onPick={() => pick('A')} onDuration={setDurA} />
                    <div className="flex items-center justify-center">
                        <button
                            onClick={swap}
                            disabled={!clipA && !clipB}
                            className="h-[28px] px-3 rounded-lg border border-[#3a3a3a] text-[11px] text-white/50 hover:text-white disabled:opacity-30 flex items-center gap-1.5"
                            aria-label="Swap clips"
                        >
                            <ArrowLeftRight size={13} /> Swap
                        </button>
                    </div>
                    <ClipSlot label="Clip B" media={clipB} onPick={() => pick('B')} onDuration={() => {}} />
                </div>

                <div className="flex items-center justify-center shrink-0 px-4 text-[rgba(255,255,255,0.25)]">
                    <ScribblyArrow direction="right" animated={false} />
                </div>

                {/* Controls */}
                <div className="flex flex-col min-w-0 h-full step-panel step-panel-effects py-8" style={{ flex: '0 0 360px' }}>
                    <ChromeFrame variant="dark" borderWidth={24} className="flex-1 min-h-0 step-panel-inner">
                        <div className="flex flex-col h-full bg-[#1a1a1a] p-8 gap-5 overflow-y-auto dark-scrollbar">
                            <div className="px-2">
                                <p className="text-[13px] font-medium text-white">A → B mosh</p>
                                <p className="text-[11px] text-white/40 leading-relaxed mt-1">
                                    A plays clean, then B&apos;s motion drags A&apos;s last frame until B resolves.
                                </p>
                            </div>
                            <RangeSlider
                                label="Cut point in A"
                                value={durA > 0 ? Math.min(effectiveCut, durA) : 0}
                                min={0.1}
                                max={Math.max(0.1, durA)}
                                step={0.1}
                                formatValue={fmtSec}
                                onChange={setCutSec}
                            />
                            <div className="flex flex-col gap-2">
                                <SectionLabel>Resolve</SectionLabel>
                                <SegmentedToggle
                                    value={resolve}
                                    items={[
                                        { value: 'melt', label: 'Melt' },
                                        { value: 'sweep', label: 'Sweep' },
                                        { value: 'hold', label: 'Hold' },
                                    ]}
                                    onChange={(v) => {
                                        const mode = v as ResolveMode;
                                        setResolve(mode);
                                        // Hold defaults to a 1 s sticky smear, then it melts.
                                        if (mode === 'hold') setMoshSec(1);
                                        if (mode === 'sweep') { setMoshSec(2); setSweepSec(1); }
                                    }}
                                />
                                <p className="text-[10px] text-white/35 leading-relaxed px-2">
                                    {resolve === 'melt' && 'B keeps moshing until its own frames paint it back in.'}
                                    {resolve === 'sweep' && 'After the melt, clean B sweeps in column by column, like a codec intra refresh.'}
                                    {resolve === 'hold' && 'Drops B’s heaviest frames for a sticky smear, then melts like Melt. Pure decoder output.'}
                                </p>
                            </div>
                            {(resolve === 'sweep' || resolve === 'hold') && (
                                <>
                                    <RangeSlider
                                        label={resolve === 'hold' ? 'Smear' : 'Melt before sweep'}
                                        value={moshSec}
                                        min={0.2}
                                        max={8}
                                        step={0.1}
                                        formatValue={fmtSec}
                                        onChange={setMoshSec}
                                    />
                                    {resolve === 'sweep' && (
                                        <RangeSlider
                                            label="Sweep time"
                                            value={sweepSec}
                                            min={0.2}
                                            max={3}
                                            step={0.1}
                                            formatValue={fmtSec}
                                            onChange={setSweepSec}
                                        />
                                    )}
                                </>
                            )}
                            <RangeSlider
                                label="Heal speed"
                                value={healSpeed}
                                min={0}
                                max={100}
                                formatValue={(v) => `${v}%`}
                                onChange={setHealSpeed}
                            />
                            <RangeSlider
                                label="Carry A's motion"
                                value={carryFrames}
                                min={0}
                                max={15}
                                formatValue={(v) => (v === 0 ? 'Off' : `${v} frames`)}
                                onChange={setCarryFrames}
                            />
                            <RangeSlider
                                label="Bloom burst at cut"
                                value={bloomFrames}
                                min={0}
                                max={12}
                                formatValue={(v) => (v === 0 ? 'Off' : `${v} frames`)}
                                onChange={setBloomFrames}
                            />
                            <div className="flex flex-col gap-2">
                                <SectionLabel>Audio</SectionLabel>
                                <SegmentedToggle
                                    value={audioMode}
                                    items={[{ value: 'none', label: 'None' }, { value: 'keep', label: 'A then B' }]}
                                    onChange={(v) => setAudioMode(v as ABAudioMode)}
                                />
                            </div>
                        </div>
                    </ChromeFrame>
                </div>

                <div className="flex items-center justify-center shrink-0 px-2 text-[rgba(255,255,255,0.25)]">
                    <ScribblyArrow direction="right" animated={false} />
                </div>

                {/* Render */}
                <div className="flex flex-col min-w-0 h-full step-panel step-panel-render pl-3" style={{ flex: '1 1 0%' }}>
                    <div className="flex-1 flex flex-col items-center justify-center min-h-0 gap-3">
                        <ChromeFrame variant="dark" borderWidth={8} className="w-full">
                            <button
                                disabled={!canRender}
                                onClick={handleRender}
                                className="w-full py-6 rounded-xl text-[14px] font-semibold text-white border border-white/10 hover:border-white/20 render-button disabled:opacity-30 disabled:cursor-not-allowed disabled:animate-none"
                                style={{ background: 'linear-gradient(135deg, #3730a3, #5b21b6, #6d28d9)', backgroundSize: '200% 200%' }}
                            >
                                Render A → B
                            </button>
                        </ChromeFrame>
                        {!canRender && !isProcessing && (
                            <p className="text-[10px] text-white/30">Import both clips to render.</p>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div className="shrink-0 mx-auto max-w-5xl px-6 pb-3 w-full">
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-[11px]">
                        <Icon name="error" size={16} />
                        {error}
                    </div>
                </div>
            )}

            {result && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8" onClick={() => setResult(null)}>
                    <div
                        className="bg-[#141414] border border-[rgba(218,220,224,0.15)] rounded-xl p-5 shadow-2xl max-w-2xl w-full flex flex-col gap-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="text-[11px] font-medium text-[rgba(218,220,224,0.9)]">Render Complete</h2>
                            <button onClick={() => setResult(null)} className="text-white/35 hover:text-white p-1" aria-label="Close">
                                <Icon name="close" size={16} />
                            </button>
                        </div>
                        <div className="rounded-xl overflow-hidden bg-black border border-white/10 flex items-center justify-center min-h-[300px]">
                            <video src={result.url} controls autoPlay loop className="max-h-[60vh] max-w-full object-contain" />
                        </div>
                        <p className="text-[10px] text-white/40">
                            {(result.plan.totalFrames / result.plan.fps).toFixed(1)}s · {resolve}{result.plan.sweep ? ` · sweep ${((result.plan.sweep.lastB - result.plan.sweep.firstB + 1) / result.plan.fps).toFixed(1)}s` : ''}
                            {result.audioNote ? ` · ${result.audioNote}` : ''}
                        </p>
                        <div className="flex gap-[5px]">
                            <PillButton variant="outline" onClick={() => setResult(null)}>Close</PillButton>
                            <PillButton variant="solid" onClick={handleSave} icon={<Icon name="download" size={16} />}>Save</PillButton>
                        </div>
                    </div>
                </div>
            )}

            {isProcessing && (
                <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center cursor-wait">
                    <div className="flex flex-col items-center gap-4">
                        <div className="braille-loader" aria-label="Rendering"><span /><span /><span /><span /></div>
                        <span className="text-[11px] font-medium text-white/70">Rendering {progress}%</span>
                        <span className="text-[10px] text-white/35 max-w-[260px] text-center leading-relaxed">{statusMsg}</span>
                        <button
                            onClick={() => { cancelled.current = true; setIsProcessing(false); setProgress(0); }}
                            className="mt-1 h-[30px] px-4 rounded-lg border border-[#444] hover:bg-white/5 text-[11px] font-medium text-white/60"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
