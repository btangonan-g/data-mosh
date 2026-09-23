import React, { useRef, useCallback, memo, useEffect } from 'react';
import { MoshRegion } from '../types';
import { Icon } from './Icon';

interface TimelineProps {
    duration: number; // seconds
    regions: MoshRegion[];
    selectedId: string | null;
    currentTime: number; // seconds
    isPlaying: boolean;
    isMuted: boolean;
    onPlayPause: () => void;
    onToggleMute: () => void;
    onSeek: (time: number) => void;
    onUpdateRegion: (id: string, changes: Partial<MoshRegion>) => void;
    onSelectRegion: (id: string) => void;
}

const MIN_BLOCK_MS = 200;

const MODE_COLORS: Record<string, string> = {
    liquid: '#009ebd',
    bloom: '#cc8e00',
    stutter: '#cc0088',
    reverse: '#00b362',
    pulse: '#d64300',
    transition: '#8000cc',
};

const MODE_LABELS: Record<string, string> = {
    liquid: 'Liquid',
    trail: 'Trail',
    bloom: 'Bloom',
    stutter: 'Stutter',
    reverse: 'Reverse',
    pulse: 'Pulse',
    shatter: 'Shatter',
    transition: 'Transition',
};

interface DragState {
    mode: 'move' | 'resize-start' | 'resize-end';
    activeId: string;
    startX: number;
    startDelay: number;
    startDuration: number;
    currentDelay: number;
    currentDuration: number;
}

export const Timeline: React.FC<TimelineProps> = memo(({
    duration, regions, selectedId, currentTime, isPlaying, isMuted,
    onPlayPause, onToggleMute, onSeek, onUpdateRegion, onSelectRegion,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const blockRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const dragRef = useRef<DragState | null>(null);
    const playheadRef = useRef<HTMLDivElement>(null);

    const durationRef = useRef(duration);
    durationRef.current = duration;
    const onSeekRef = useRef(onSeek);
    onSeekRef.current = onSeek;
    const onSelectRegionRef = useRef(onSelectRegion);
    onSelectRegionRef.current = onSelectRegion;
    const onUpdateRegionRef = useRef(onUpdateRegion);
    onUpdateRegionRef.current = onUpdateRegion;

    // Update playhead position
    useEffect(() => {
        if (playheadRef.current && duration > 0) {
            playheadRef.current.style.left = `${(currentTime / duration) * 100}%`;
        }
    }, [currentTime, duration]);

    const getTimeFromX = useCallback((clientX: number) => {
        if (!containerRef.current || durationRef.current === 0) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        const padding = 4;
        const width = rect.width - padding * 2;
        const x = clientX - rect.left - padding;
        return Math.max(0, Math.min(1, x / width)) * durationRef.current;
    }, []);

    /* ─── Seek (scrub playhead on track background) ─── */
    const handleTrackMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-block-id]')) return;
        onSeekRef.current(getTimeFromX(e.clientX));
        const onMove = (ev: MouseEvent) => onSeekRef.current(getTimeFromX(ev.clientX));
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [getTimeFromX]);

    /* ─── Block drag ─── */
    const startDrag = useCallback((e: React.MouseEvent, id: string, mode: 'move' | 'resize-start' | 'resize-end') => {
        e.stopPropagation();
        e.preventDefault();
        onSelectRegionRef.current(id);

        const region = regions.find(r => r.id === id);
        if (!region || !containerRef.current) return;

        dragRef.current = {
            mode,
            activeId: id,
            startX: e.clientX,
            startDelay: region.startMs,
            startDuration: region.durationMs,
            currentDelay: region.startMs,
            currentDuration: region.durationMs,
        };

        const draggedEl = blockRefs.current.get(id);
        if (draggedEl) {
            draggedEl.style.transition = 'none';
            draggedEl.style.zIndex = '25';
            draggedEl.style.opacity = '0.85';
        }

        document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';

        const onMove = (ev: MouseEvent) => {
            const drag = dragRef.current;
            if (!drag || !containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const deltaX = ev.clientX - drag.startX;
            const deltaTimeMs = (deltaX / rect.width) * durationRef.current * 1000;
            const totalMs = durationRef.current * 1000;

            let newDelay = drag.startDelay;
            let newDuration = drag.startDuration;

            if (drag.mode === 'move') {
                newDelay = Math.max(0, Math.min(totalMs - drag.startDuration, drag.startDelay + deltaTimeMs));
                newDuration = drag.startDuration;
            } else if (drag.mode === 'resize-start') {
                const rawDelay = drag.startDelay + deltaTimeMs;
                const maxDelay = (drag.startDelay + drag.startDuration) - MIN_BLOCK_MS;
                newDelay = Math.max(0, Math.min(maxDelay, rawDelay));
                newDuration = (drag.startDelay + drag.startDuration) - newDelay;
            } else {
                const rawEnd = (drag.startDelay + drag.startDuration) + deltaTimeMs;
                newDuration = Math.max(MIN_BLOCK_MS, Math.min(totalMs - drag.startDelay, rawEnd - drag.startDelay));
                newDelay = drag.startDelay;
            }

            const el = blockRefs.current.get(drag.activeId);
            if (el) {
                el.style.left = `${(newDelay / 1000 / durationRef.current) * 100}%`;
                el.style.width = `${(newDuration / 1000 / durationRef.current) * 100}%`;
            }

            drag.currentDelay = newDelay;
            drag.currentDuration = newDuration;
        };

        const onUp = () => {
            const drag = dragRef.current;
            if (drag) {
                const el = blockRefs.current.get(drag.activeId);
                if (el) {
                    el.style.transition = 'left 150ms ease-out, width 150ms ease-out, opacity 150ms ease-out';
                    el.style.opacity = '';
                    el.style.zIndex = '';
                }

                setTimeout(() => {
                    const el2 = blockRefs.current.get(drag.activeId);
                    if (el2) el2.style.transition = '';
                    onUpdateRegionRef.current(drag.activeId, {
                        startMs: Math.round(drag.currentDelay),
                        durationMs: Math.round(drag.currentDuration),
                    });
                }, 160);
            }

            document.body.style.cursor = '';
            dragRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [regions]);

    const setBlockRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
        if (el) blockRefs.current.set(id, el);
        else blockRefs.current.delete(id);
    }, []);

    if (duration === 0) return null;

    return (
        <div className="w-full space-y-1 select-none flex flex-col">
            {/* Controls */}
            <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                        <button onClick={onPlayPause}
                            className="w-[26px] h-[26px] flex items-center justify-center rounded-lg hover:bg-white/8 active:bg-white/12 transition-colors text-white/90">
                            <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={15} filled />
                        </button>
                        <button onClick={onToggleMute}
                            className="w-[26px] h-[26px] flex items-center justify-center rounded-lg hover:bg-white/8 active:bg-white/12 transition-colors text-white/40 hover:text-white/70">
                            <Icon name={isMuted ? 'volume_off' : 'volume_up'} size={15} filled />
                        </button>
                    </div>
                    <span className="text-[10px] font-medium tracking-[0.3px] text-white/50 tabular-nums">
                        {formatTime(currentTime)}
                    </span>
                </div>
                <span className="text-[10px] font-medium tracking-[0.3px] text-white/50 tabular-nums">
                    {formatTime(duration)}
                </span>
            </div>

            <div
                ref={containerRef}
                onMouseDown={handleTrackMouseDown}
                className="relative h-[32px] w-full bg-[#1a1a1a]/60 rounded-lg cursor-pointer border border-white/[0.08] p-0.5"
            >
                <div className="absolute inset-x-0.5 inset-y-0">
                    {regions.map((region) => {
                        const startPercent = ((region.startMs || 0) / 1000 / duration) * 100;
                        const widthPercent = ((region.durationMs || 0) / 1000 / duration) * 100;
                        const isSelected = selectedId === region.id;
                        const color = MODE_COLORS[region.mode] || '#969696';

                        return (
                            <div
                                key={region.id}
                                ref={setBlockRef(region.id)}
                                data-block-id={region.id}
                                onMouseDown={(e) => startDrag(e, region.id, 'move')}
                                className={`absolute top-0.5 bottom-0.5 rounded-md z-10 cursor-grab active:cursor-grabbing border overflow-hidden group/clip will-change-[left,width] transition-colors shadow-[inset_1px_1px_2px_rgba(255,255,255,0.2),inset_-1px_-1px_3px_rgba(0,0,0,0.4)]\n                                    ${isSelected
                                        ? 'z-20'
                                        : 'hover:brightness-110'
                                    }`}
                                style={{
                                    left: `${startPercent}%`,
                                    width: `${widthPercent}%`,
                                    backgroundColor: isSelected ? color : `${color}88`,
                                    borderColor: isSelected ? color : `${color}44`,
                                }}
                            >
                                {/* Resize handles */}
                                <div onMouseDown={(e) => startDrag(e, region.id, 'resize-start')}
                                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 z-30 transition-colors" />
                                <div onMouseDown={(e) => startDrag(e, region.id, 'resize-end')}
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 z-30 transition-colors" />

                                <div className="absolute inset-0 flex items-center px-2 pointer-events-none overflow-hidden">
                                    <span className={`text-[10px] font-semibold tracking-[0.3px] whitespace-nowrap truncate ${isSelected ? 'text-white' : 'text-white/70'}`}>
                                        {MODE_LABELS[region.mode] || region.mode}
                                    </span>
                                </div>
                            </div>
                        );
                    })}

                    <div
                        ref={playheadRef}
                        className="absolute top-0 bottom-0 w-[1.5px] bg-white z-40 pointer-events-none"
                        style={{ left: `${(currentTime / duration) * 100}%` }}
                    >
                        <div className="absolute -top-[3px] left-1/2 -translate-x-1/2 w-[7px] h-[7px] bg-white rounded-full" />
                    </div>
                </div>
            </div>
        </div>
    );
});

function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
