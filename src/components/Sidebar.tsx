import React from 'react';
import { Plus } from 'lucide-react';
import { Flow } from 'flow-sdk';
import { MoshRegion, MoshMode } from '../types';
import type { AudioMode } from '../services/datamoshEngine';
import { Icon } from './Icon';
import { SectionLabel, PillButton, RangeSlider, SegmentedToggle } from './Primitives';

interface SidebarProps {
    regions: MoshRegion[];
    selectedRegion: MoshRegion | null;
    onSelectRegion: (id: string) => void;
    onUpdateRegion: (id: string, changes: Partial<MoshRegion>) => void;
    onAddRegion: () => void;
    onDeleteRegion: (id: string) => void;
    hasMedia: boolean;
    audioMode: AudioMode;
    onAudioModeChange: (mode: AudioMode) => void;
}

const MODES: { id: MoshMode; label: string; icon: string; desc: string }[] = [
    { id: 'liquid', label: 'Liquid', icon: 'water_drop', desc: 'I-frame removal — pixels melt' },
    { id: 'bloom', label: 'Bloom', icon: 'flare', desc: 'Segment shuffle — motion explosion' },
    { id: 'stutter', label: 'Stutter', icon: 'stacked_bar_chart', desc: 'Temporal destruction — skip & loop' },
    { id: 'reverse', label: 'Reverse', icon: 'undo', desc: 'Backward P-frames — reverse motion glitch' },
    { id: 'pulse', label: 'Pulse', icon: 'monitor_heart', desc: 'Keyframe heartbeat — clean/glitch cycle' },
    { id: 'transition', label: 'Transition', icon: 'swap_horiz', desc: 'Two-clip mosh — morph between videos' },
];

const MODE_COLORS: Record<string, string> = {
    liquid: '#009ebd',
    bloom: '#cc8e00',
    stutter: '#cc0088',
    reverse: '#00b362',
    pulse: '#d64300',
    transition: '#8000cc',
};

// ── Robust Base64 Decoder (localized) ──
function base64ToUint8Array(base64: string) {
    const binaryString = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

export const Sidebar: React.FC<SidebarProps> = ({
    regions, selectedRegion, onSelectRegion, onUpdateRegion,
    onAddRegion, onDeleteRegion, hasMedia,
    audioMode, onAudioModeChange,
}) => {
    
    const handleSelectTransitionClip = async () => {
        if (!selectedRegion) return;
        try {
            const media = await Flow.media.select({ filter: 'video' });
            if (media && media.type === 'video') {
                const bytes = base64ToUint8Array(media.base64);
                const blob = new Blob([bytes], { type: media.mimeType });
                const file = new File([blob], media.name || 'transition.mp4', { type: media.mimeType });
                
                onUpdateRegion(selectedRegion.id, { 
                    transitionFile: file, 
                    transitionName: media.name || 'transition.mp4' 
                });
            }
        } catch (err) {
            console.error('Failed to select transition clip:', err);
        }
    };

    return (
        <div className="relative flex flex-col items-start justify-start overflow-clip w-full h-full min-h-0 bg-transparent">
            {/* Content */}
            <div className="flex-1 flex flex-col gap-[20px] items-start w-full overflow-y-auto overflow-x-hidden dark-scrollbar py-4 pr-1">
                {/* Regions */}
                <div className="flex flex-col gap-2 items-start w-full">
                    <div className="flex flex-col gap-1.5 w-full">
                        {regions.map((region, i) => {
                            const isActive = selectedRegion?.id === region.id;
                            const color = MODE_COLORS[region.mode] || '#969696';
                            return (
                                <div key={region.id} className="flex gap-1 w-full items-center animate-layer">
                                    <button
                                        onClick={() => onSelectRegion(region.id)}
                                        className={`flex-1 flex items-center gap-2.5 border rounded-xl w-full px-3 py-2.5 text-left transition-all relative overflow-hidden group shadow-[inset_1.5px_1.5px_3px_rgba(255,255,255,0.1),inset_-2px_-2px_4px_rgba(0,0,0,0.5)]\n                                            ${isActive
                                                ? 'border-white/20 bg-white/[0.06]'
                                                : 'border-[#3a3a3a] hover:border-[#555] hover:bg-white/[0.02]'
                                            }`}
                                    >
                                        <div className="absolute top-1/2 right-3 -translate-y-1/2 opacity-100 pointer-events-none z-0 origin-right" style={{ color }}>
                                            <Icon name={MODES.find(m => m.id === region.mode)?.icon || 'star'} size={24} />
                                        </div>
                                        <div className="flex-1 min-w-0 z-10 relative pointer-events-none">
                                            <span className="text-[12px] font-medium text-white tracking-[0.1px] truncate block">
                                                {MODES.find(m => m.id === region.mode)?.label || region.mode}
                                            </span>
                                            <span className="text-[11px] text-[rgba(255,255,255,0.3)] tracking-[0.1px]">
                                                {formatMs(region.startMs)} – {formatMs(region.startMs + region.durationMs)}
                                            </span>
                                        </div>
                                    </button>
                                    <div className={`overflow-hidden transition-all duration-300 ease-in-out ${regions.length > 1 ? 'w-7 opacity-100 ml-1' : 'w-0 opacity-0 ml-0'}`}>
                                        <button onClick={() => onDeleteRegion(region.id)}
                                            className="text-[rgba(218,220,224,0.35)] hover:text-red-400 transition-colors p-[5px] whitespace-nowrap flex items-center justify-center">
                                            <Icon name="delete" size={16} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        <div className="pt-1">
                            <PillButton variant="outline" onClick={onAddRegion} icon={<Plus size={16} strokeWidth={1.5} />}>
                                Add Effect
                            </PillButton>
                        </div>
                    </div>
                </div>

                {/* Effect picker */}
                {selectedRegion && (
                    <>
                        <div className="flex flex-col gap-2 items-start w-full">
                            <SectionLabel>Effect</SectionLabel>
                            <div className="grid grid-cols-2 gap-1.5 w-full">
                                {MODES.map((m) => {
                                    const isSelected = selectedRegion.mode === m.id;
                                    const color = MODE_COLORS[m.id];
                                    return (
                                        <button
                                            key={m.id}
                                            onClick={() => onUpdateRegion(selectedRegion.id, { mode: m.id })}
                                            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border p-1.5 transition-all shadow-[inset_1.5px_1.5px_3px_rgba(255,255,255,0.1),inset_-2px_-2px_4px_rgba(0,0,0,0.5)] group\n                                                ${isSelected
                                                    ? 'border-white/20 bg-white/[0.08] ring-1 ring-white/10'
                                                    : 'border-[#3a3a3a] bg-transparent hover:border-[#555] hover:bg-white/[0.02]'
                                                }`}
                                        >
                                            <div className="flex items-center justify-center w-full overflow-hidden h-[40px]" style={{ color: isSelected ? color : `${color}88` }}>
                                                <Icon name={m.icon} size={28} />
                                            </div>
                                            <span className={`text-[9px] font-medium tracking-[0.2px] ${isSelected ? 'text-white' : 'text-[rgba(218,220,224,0.6)]'}`}>
                                                {m.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Secondary clip picker — only for transition mode */}
                        {selectedRegion.mode === 'transition' && (
                            <div className="flex flex-col gap-2 items-start w-full">
                                {selectedRegion.transitionName ? (
                                    <div className="w-full">
                                        <div className="border border-[#3a3a3a] rounded-xl px-3 py-2.5 flex items-center gap-2 w-full">
                                            <Icon name="movie" size={16} className="text-[#ec4899] shrink-0" />
                                            <span className="text-[12px] font-medium text-white tracking-[0.1px] truncate flex-1">
                                                {selectedRegion.transitionName}
                                            </span>
                                            <button
                                                onClick={() => {
                                                    onUpdateRegion(selectedRegion.id, { transitionFile: undefined, transitionName: undefined });
                                                }}
                                                className="text-[rgba(218,220,224,0.35)] hover:text-red-400 transition-colors shrink-0 mr-1">
                                                <Icon name="close" size={12} />
                                            </button>
                                            <button
                                                onClick={handleSelectTransitionClip}
                                                className="text-[rgba(218,220,224,0.35)] hover:text-white transition-colors shrink-0">
                                                <Icon name="swap_horiz" size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <PillButton
                                        variant="outline"
                                        onClick={handleSelectTransitionClip}
                                        icon={<Icon name="upload" size={16} />}
                                    >
                                        Select Transition Clip
                                    </PillButton>
                                )}
                            </div>
                        )}

                        {/* Parameters */}
                        <div className="flex flex-col gap-2 items-start w-full">
                            <div className="flex flex-col gap-1 w-full">
                                <RangeSlider
                                    label="Intensity"
                                    value={selectedRegion.intensity}
                                    min={1} max={100}
                                    formatValue={v => `${Math.round(v)}%`}
                                    onChange={v => onUpdateRegion(selectedRegion.id, { intensity: v })}
                                />
                            </div>
                        </div>
                    </>
                )}
                {/* Audio toggle — always visible when media is loaded */}
                {hasMedia && (
                    <div className="flex flex-col gap-2 items-start w-full">
                        <SectionLabel>Audio</SectionLabel>
                        <SegmentedToggle
                            value={audioMode}
                            items={[
                                { value: 'none', label: 'None' },
                                { value: 'preserve', label: 'Keep' },
                                { value: 'glitch', label: 'Glitch' },
                            ]}
                            onChange={(v) => onAudioModeChange(v as AudioMode)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

function formatMs(ms: number): string {
    const totalSec = ms / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
