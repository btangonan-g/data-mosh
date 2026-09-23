import { Flow } from 'flow-sdk';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { renderFullTimeline, AudioMode } from './services/datamoshEngine';
import { VideoUploader } from './components/VideoUploader';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { Icon } from './components/Icon';
import { ScribblyArrow } from './components/ScribblyArrow';
import { ChromeFrame } from './components/ChromeFrame';
import { PillButton } from './components/Primitives';
import { ImagePlus } from 'lucide-react';
import { MediaState, MoshRegion } from './types';

// ── Base64 Decoder ──
function base64ToUint8Array(base64: string) {
    const binaryString = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// ── Runtime injection of fonts + global CSS (index.html is ignored in Flow sandbox) ──
const INJECTED_STYLE_ID = 'datamosh-global-styles';
const INJECTED_FONT_ID = 'datamosh-material-symbols';

function useGlobalStyles() {
    useEffect(() => {
        // Preconnect
        const preconnect1 = document.createElement('link');
        preconnect1.rel = 'preconnect';
        preconnect1.href = 'https://fonts.googleapis.com';
        document.head.appendChild(preconnect1);

        const preconnect2 = document.createElement('link');
        preconnect2.rel = 'preconnect';
        preconnect2.href = 'https://fonts.gstatic.com';
        preconnect2.crossOrigin = 'anonymous';
        document.head.appendChild(preconnect2);

        // Material Symbols
        if (!document.getElementById(INJECTED_FONT_ID)) {
            const fontLink = document.createElement('link');
            fontLink.id = INJECTED_FONT_ID;
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
            document.head.appendChild(fontLink);
        }

        // Global CSS
        if (!document.getElementById(INJECTED_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = INJECTED_STYLE_ID;
            style.textContent = `\n                * { box-sizing: border-box; }\n                .material-symbols-rounded { font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20; }\n                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }\n                .no-scrollbar::-webkit-scrollbar { display: none; }\n\n                input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; width: 100%; }\n                input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 3px; background: #3a3a3a; border-radius: 9999px; }\n                input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 10px; height: 10px; border-radius: 50%; background: #e0e0e0; box-shadow: none; margin-top: -3.5px; cursor: pointer; }\n                input[type=range]::-moz-range-track { width: 100%; height: 3px; background: #3a3a3a; border-radius: 9999px; }\n                input[type=range]::-moz-range-thumb { width: 10px; height: 10px; border: none; border-radius: 50%; background: #e0e0e0; box-shadow: none; cursor: pointer; }\n\n                .dark-scrollbar { scrollbar-width: thin; scrollbar-color: #4a4a4a transparent; }\n                .dark-scrollbar::-webkit-scrollbar { width: 4px; }\n                .dark-scrollbar::-webkit-scrollbar-track { background: transparent; }\n                .dark-scrollbar::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 9999px; }\n                .dark-scrollbar::-webkit-scrollbar-thumb:hover { background: #5a5a5a; }\n\n                @keyframes dropdown-enter { from { opacity: 0; transform: scale(0.95) translateY(-5px); } to { opacity: 1; transform: scale(1) translateY(0); } }\n                .animate-dropdown { animation: dropdown-enter 0.15s ease-out forwards; }\n\n                @keyframes layer-enter { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }\n                .animate-layer { animation: layer-enter 0.2s ease-out forwards; }\n\n                @keyframes step-panel-enter { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }\n                .step-panel { animation: step-panel-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }\n                .step-panel-source { animation-delay: 0.05s; }\n                .step-panel-effects { animation-delay: 0.15s; }\n                .step-panel-render { animation-delay: 0.25s; }\n                .step-panel-inner { transition: box-shadow 0.3s ease; }\n\n                @keyframes render-glow {\n                    0%, 100% { box-shadow: 0 0 12px 2px rgba(91, 33, 182, 0.35), 0 0 4px 1px rgba(55, 48, 163, 0.25); background-position: 0% 50%; }\n                    50% { box-shadow: 0 0 24px 6px rgba(109, 40, 217, 0.5), 0 0 8px 2px rgba(91, 33, 182, 0.35); background-position: 100% 50%; }\n                }\n                .render-button:not(:disabled) { animation: render-glow 3s ease-in-out infinite; }\n                .render-button:not(:disabled):hover { box-shadow: 0 0 30px 8px rgba(109, 40, 217, 0.6), 0 0 12px 3px rgba(91, 33, 182, 0.45) !important; filter: brightness(1.15); }\n                .render-button:not(:disabled):active { filter: brightness(0.9); }\n\n                .braille-loader { display: flex; gap: 6px; align-items: center; }\n                .braille-loader span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.5); animation: braille-bounce 1.2s cubic-bezier(0.4,0,0.2,1) infinite; }\n                .braille-loader span:nth-child(1) { animation-delay: 0s; }\n                .braille-loader span:nth-child(2) { animation-delay: 0.15s; }\n                .braille-loader span:nth-child(3) { animation-delay: 0.3s; }\n                .braille-loader span:nth-child(4) { animation-delay: 0.45s; }\n                @keyframes braille-bounce { 0%,60%,100% { opacity: 0.2; transform: scale(0.8); } 30% { opacity: 1; transform: scale(1.2); } }\n\n                html, body, #root {\n                    margin: 0; padding: 0; width: 100%; height: 100%;\n                    background: #141414;\n                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;\n                    -webkit-font-smoothing: antialiased;\n                    -moz-osx-font-smoothing: grayscale;\n                }\n            `;
            document.head.appendChild(style);
        }

        return () => {
            preconnect1.remove();
            preconnect2.remove();
        };
    }, []);
}

export default function App() {
    useGlobalStyles();

    const [sourceMedia, setSourceMedia] = useState<MediaState | null>(null);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(true);

    const [regions, setRegions] = useState<MoshRegion[]>([]);
    const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const [error, setError] = useState<string | null>(null);

    const [audioMode, setAudioMode] = useState<AudioMode>('none');
    const [exportedMedia, setExportedMedia] = useState<{ url: string; blob: Blob } | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const selectedRegion = regions.find(r => r.id === selectedRegionId) || null;

    const handleMetadataLoaded = useCallback(() => {
        const vid = videoRef.current;
        if (!vid) return;
        const dur = vid.duration;
        setDuration(dur);

        if (regions.length === 0) {
            const totalMs = dur * 1000;
            const id = Math.random().toString(36).substr(2, 9);
            setRegions([{
                id,
                mode: 'liquid',
                intensity: 75,
                startMs: Math.round(totalMs * 0.2),
                durationMs: Math.round(totalMs * 0.8),
            }]);
            setSelectedRegionId(id);
        }
    }, [regions.length]);

    const handleTimeUpdate = useCallback(() => {
        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    }, []);

    const handlePlayPause = useCallback(() => {
        const vid = videoRef.current;
        if (!vid) return;
        if (vid.paused) { vid.play(); setIsPlaying(true); }
        else { vid.pause(); setIsPlaying(false); }
    }, []);

    const handleSeek = useCallback((time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                handlePlayPause();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handlePlayPause]);

    const handleAddRegion = useCallback(() => {
        const id = Math.random().toString(36).substr(2, 9);
        const totalMs = duration * 1000;

        let startMs = 0;
        if (regions.length > 0) {
            const last = regions[regions.length - 1];
            startMs = last.startMs + last.durationMs;
        }
        if (startMs >= totalMs) startMs = Math.max(0, totalMs - 2000);
        const durationMs = Math.min(2000, totalMs - startMs);

        setRegions(prev => [...prev, {
            id, mode: 'liquid', intensity: 75,
            startMs: Math.round(startMs), durationMs: Math.round(durationMs),
        }]);
        setSelectedRegionId(id);
    }, [duration, regions]);

    const handleDeleteRegion = useCallback((id: string) => {
        setRegions(prev => prev.filter(r => r.id !== id));
        if (selectedRegionId === id) {
            const remaining = regions.filter(r => r.id !== id);
            setSelectedRegionId(remaining.length > 0 ? remaining[0].id : null);
        }
    }, [selectedRegionId, regions]);

    const handleUpdateRegion = useCallback((id: string, changes: Partial<MoshRegion>) => {
        setRegions(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r));
    }, []);

    const handleSelectMedia = useCallback(async () => {
        try {
            const media = await Flow.media.select({ filter: 'video' });
            if (media && media.type === 'video') {
                const file = media.file || (() => {
                    const bytes = base64ToUint8Array(media.base64 || '');
                    const blob = new Blob([bytes], { type: media.mimeType });
                    return new File([blob], media.name || 'video.mp4', { type: media.mimeType });
                })();
                const dataUrl = media.dataUrl || URL.createObjectURL(file);

                setSourceMedia({ id: media.mediaId, dataUrl, name: media.name || 'video.mp4', type: 'video', file });
                setExportedMedia(null);
                setRegions([]);
                setSelectedRegionId(null);
                setError(null);
            }
        } catch (err) {
            console.error('Failed to select media:', err);
        }
    }, []);

    const handleRender = useCallback(async () => {
        if (!sourceMedia?.file || regions.length === 0) return;

        if (videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
            setIsPlaying(false);
        }

        setIsProcessing(true);
        setProgress(0);
        setError(null);
        setStatusMsg('Starting render...');

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const result = await renderFullTimeline(
                sourceMedia.file,
                regions,
                (p) => setProgress(Math.round(p * 100)),
                (msg) => setStatusMsg(msg),
                audioMode,
            );
            if (!controller.signal.aborted) {
                setExportedMedia(result);
                setStatusMsg('');
            }
        } catch (err: any) {
            if (controller.signal.aborted) {
                console.log('Render cancelled by user');
            } else {
                setError(`Render failed: ${err.message || 'Unknown error'}`);
                console.error(err);
            }
        } finally {
            setIsProcessing(false);
            abortControllerRef.current = null;
        }
    }, [sourceMedia, regions, audioMode]);

    const handleSaveToGallery = useCallback(async () => {
        if (!exportedMedia?.blob) return;
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            try {
                await Flow.save({
                    base64,
                    mimeType: 'video/mp4',
                    name: 'Datamosh Export'
                });
            } catch (err: any) {
                setError(`Failed to save: ${err.message || err}`);
            }
        };
        reader.readAsDataURL(exportedMedia.blob);
    }, [exportedMedia]);

    const canRender = !!sourceMedia && regions.length > 0 && !isProcessing;

    return (
        <div className="fixed inset-0 w-screen h-screen bg-[#141414] text-[#ededed] flex flex-col overflow-hidden font-sans">
            <div className="flex-1 flex items-stretch min-h-0 w-full max-w-[1400px] mx-auto px-8 py-8 gap-0 overflow-hidden">
                <div className="flex flex-col min-0 h-full step-panel step-panel-source" style={{ flex: '1 1 0%' }}>
                    <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                        {sourceMedia ? (
                            <ChromeFrame variant="dark" borderWidth={18} className="w-full max-h-full max-w-[520px]">
                                <div className="flex items-center justify-center h-full relative overflow-hidden p-6">
                                    <video
                                        ref={videoRef}
                                        src={sourceMedia.dataUrl}
                                        muted={isMuted}
                                        onLoadedMetadata={handleMetadataLoaded}
                                        onTimeUpdate={handleTimeUpdate}
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                        onEnded={() => setIsPlaying(false)}
                                        className="max-w-full max-h-full rounded-lg object-contain"
                                    />
                                </div>
                            </ChromeFrame>
                        ) : (
                            <ChromeFrame variant="dark" borderWidth={18} className="w-full max-w-[520px]">
                                <VideoUploader onSelect={(media) => {
                                    setSourceMedia(media);
                                    setExportedMedia(null);
                                }} loading={false} />
                            </ChromeFrame>
                        )}

                        {sourceMedia && duration > 0 && (
                            <div className="shrink-0 w-full max-w-[520px] mt-5 px-1">
                                <Timeline
                                    duration={duration}
                                    regions={regions}
                                    selectedId={selectedRegionId}
                                    currentTime={currentTime}
                                    isPlaying={isPlaying}
                                    isMuted={isMuted}
                                    onPlayPause={handlePlayPause}
                                    onToggleMute={() => setIsMuted(m => !m)}
                                    onSeek={handleSeek}
                                    onUpdateRegion={handleUpdateRegion}
                                    onSelectRegion={setSelectedRegionId}
                                />
                                <p className="text-[9px] text-white/20 tracking-[0.2px] mt-1 text-center select-none">
                                    Scrub to preview source · Effects are applied on render
                                    <br />
                                    Output length might change
                                </p>
                            </div>
                        )}

                        {sourceMedia && (
                            <div className="shrink-0 mt-5 px-1">
                                <PillButton variant="outline" onClick={handleSelectMedia} icon={<ImagePlus size={16} strokeWidth={1.5} />}>
                                    Change Video
                                </PillButton>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-center shrink-0 px-4 text-[rgba(255,255,255,0.25)]">
                    <ScribblyArrow direction="right" animated={false} />
                </div>

                <div className="flex flex-col min-w-0 h-full step-panel step-panel-effects py-8" style={{ flex: '0 0 360px' }}>
                    <ChromeFrame variant="dark" borderWidth={24} className="flex-1 min-h-0 step-panel-inner">
                        <div className="flex flex-col h-full bg-[#1a1a1a] p-8">
                            {sourceMedia ? (
                                <Sidebar
                                    regions={regions}
                                    selectedRegion={selectedRegion}
                                    onSelectRegion={setSelectedRegionId}
                                    onUpdateRegion={handleUpdateRegion}
                                    onAddRegion={handleAddRegion}
                                    onDeleteRegion={handleDeleteRegion}
                                    hasMedia={!!sourceMedia}
                                    audioMode={audioMode}
                                    onAudioModeChange={setAudioMode}
                                />
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center opacity-30 select-none">
                                    <Icon name="tune" size={32} />
                                    <p className="text-[12px] text-white/90">
                                        Select the effect you want to apply.
                                    </p>
                                </div>
                            )}
                        </div>
                    </ChromeFrame>
                </div>

                <div className="flex items-center justify-center shrink-0 px-2 text-[rgba(255,255,255,0.25)]">
                    <ScribblyArrow direction="right" animated={false} />
                </div>

                <div className="flex flex-col min-w-0 h-full step-panel step-panel-render pl-3" style={{ flex: '1 1 0%' }}>
                    <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                        <ChromeFrame variant="dark" borderWidth={8} className="w-full">
                            <div className="relative">
                                <div
                                    className="absolute inset-0 -inset-x-8 -inset-y-6 rounded-3xl pointer-events-none"
                                    style={{
                                        background: 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.15) 0%, rgba(99, 102, 241, 0.05) 50%, transparent 70%)',
                                        filter: 'blur(20px)',
                                    }}
                                />
                                <div className="bg-[#1a1a1a] relative">
                                    <button
                                        disabled={!canRender}
                                        onClick={handleRender}
                                        className={`\n                                        w-full py-6 rounded-xl font-medium tracking-[0.1px] transition-all cursor-pointer select-none\n                                        flex flex-col items-center justify-center gap-2\n                                        disabled:opacity-30 disabled:cursor-not-allowed disabled:animate-none\n                                        ${isProcessing
                                                ? 'bg-[#555] text-white border border-white/10'
                                                : 'text-white border border-white/10 hover:border-white/20'
                                            }\n                                        render-button\n                                    `}
                                        style={!isProcessing ? {
                                            background: 'linear-gradient(135deg, #3730a3, #5b21b6, #6d28d9)',
                                            backgroundSize: '200% 200%',
                                        } : undefined}
                                    >
                                        <span className="text-[14px] font-semibold">Render</span>
                                    </button>
                                </div>
                            </div>
                        </ChromeFrame>
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

            {exportedMedia && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8"
                    onClick={() => setExportedMedia(null)}>
                    <div className="bg-[#141414] border border-[rgba(218,220,224,0.15)] rounded-xl p-5 shadow-2xl max-w-2xl w-full flex flex-col gap-5"
                        onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h2 className="text-[11px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px]">
                                Render Complete
                            </h2>
                            <button
                                onClick={() => setExportedMedia(null)}
                                className="text-[rgba(218,220,224,0.35)] hover:text-white transition-colors p-1"
                            >
                                <Icon name="close" size={16} />
                            </button>
                        </div>

                        <div className="rounded-xl overflow-hidden bg-black border border-[rgba(218,220,224,0.15)] flex items-center justify-center min-h-[300px]">
                            <video
                                src={exportedMedia.url}
                                controls
                                autoPlay
                                loop
                                className="max-h-[60vh] max-w-full object-contain"
                            />
                        </div>

                        <div className="flex gap-[5px] pt-2">
                            <button
                                onClick={() => setExportedMedia(null)}
                                className="flex-1 h-[34px] rounded-xl border border-[rgba(218,220,224,0.15)] hover:bg-white/5 active:bg-white/10 text-[12px] font-medium text-white tracking-[0.1px] transition-all cursor-pointer select-none"
                            >
                                Close
                            </button>
                            <button
                                onClick={handleSaveToGallery}
                                className="flex-1 h-[34px] rounded-xl bg-white hover:bg-gray-200 active:bg-gray-300 text-[12px] font-medium text-black tracking-[0.1px] transition-all cursor-pointer select-none flex items-center justify-center gap-1"
                            >
                                <Icon name="download" size={16} />
                                Save to Gallery
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isProcessing && (
                <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center cursor-wait">
                    <div className="flex flex-col items-center gap-5">
                        <div className="braille-loader" aria-label="Rendering">
                            <span /><span /><span /><span />
                        </div>
                        <span className="text-[11px] font-medium text-[rgba(218,220,224,0.7)] tracking-[0.1px]">
                            Rendering {progress}%
                        </span>
                        <span className="text-[10px] text-[rgba(218,220,224,0.35)] tracking-[0.1px] max-w-[200px] text-center leading-relaxed">
                            This may take a minute.<br />Don&apos;t switch tabs.
                        </span>
                        <button
                            onClick={() => {
                                abortControllerRef.current?.abort();
                                setIsProcessing(false);
                                setProgress(0);
                                setStatusMsg('');
                            }}
                            className="mt-1 h-[30px] px-4 rounded-lg border border-[#444] hover:bg-white/5 active:bg-white/10 text-[11px] font-medium text-white/60 tracking-[0.1px] transition-all cursor-pointer select-none"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
