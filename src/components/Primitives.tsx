import React from 'react';

/* ─── Section Label ─── */
export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex items-center px-2">
        <span className="text-[12px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px]">
            {children}
        </span>
    </div>
);

/* ─── Pill Button ─── */
export const PillButton: React.FC<{
    icon?: React.ReactNode; children: React.ReactNode;
    variant?: 'filled' | 'outline' | 'solid'; onClick?: () => void;
    disabled?: boolean; size?: 'default' | 'large';
}> = ({ icon, children, variant = 'filled', onClick, disabled, size = 'default' }) => {
    const height = size === 'large' ? 'h-[68px]' : 'h-[34px]';
    const base = `flex items-center gap-[2px] justify-center w-full ${height} rounded-xl font-medium tracking-[0.1px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-[inset_1.5px_1.5px_3px_rgba(255,255,255,0.15),inset_-2px_-2px_4px_rgba(0,0,0,0.3)]`;
    const variants: Record<string, string> = {
        filled: 'bg-[#555] hover:bg-[#666] active:bg-[#444] text-white text-[12px] pl-[8px] pr-[24px] py-1 select-none',
        outline: 'border border-[#3a3a3a] hover:bg-white/5 hover:text-white active:bg-white/10 backdrop-blur-[40px] text-[12px] font-medium text-[rgba(255,255,255,0.35)] pl-[8px] pr-[16px] py-1.5 select-none transition-colors',
        solid: 'bg-[#e0e0e0] hover:bg-[#ccc] active:bg-[#bbb] text-[#1a1a1a] text-[13px] pl-[8px] pr-[16px] py-2 select-none',
    };
    return (
        <button className={`${base} ${variants[variant]}`} onClick={onClick} disabled={disabled}>
            {icon && <span className="flex items-center justify-center w-6 h-6">{icon}</span>}
            <span>{children}</span>
        </button>
    );
};

/* ─── Range Slider ─── */
export const RangeSlider: React.FC<{
    label: string; value: number; min: number; max: number;
    step?: number; formatValue?: (val: number) => string;
    onChange: (val: number) => void;
}> = ({ label, value, min, max, step = 1, formatValue = (v) => String(v), onChange }) => (
    <div className="flex flex-col gap-2 pt-2 pb-[5px] w-full">
        <div className="flex items-center justify-between px-2 select-none">
            <span className="text-[12px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px]">{label}</span>
            <span className="text-[12px] font-medium text-[#c7c9cd] tracking-[0.1px]">{formatValue(value)}</span>
        </div>
        <div className="px-2 w-full h-2 relative" onPointerDown={e => e.stopPropagation()}>
            <input type="range" min={min} max={max} step={step} value={value}
                className="absolute top-1/2 left-2 w-[calc(100%-16px)] -translate-y-1/2 h-6 cursor-pointer bg-transparent"
                onChange={(e) => onChange(Number(e.target.value))} />
        </div>
    </div>
);

/* ─── Segmented Toggle ─── */
export const SegmentedToggle: React.FC<{
    value: string; items: { value: string; label: string; icon?: React.ReactNode }[];
    onChange: (val: string) => void;
}> = ({ value, items, onChange }) => (
    <div className="flex w-full items-center border border-[#3a3a3a] rounded-xl overflow-hidden bg-transparent">
        {items.map((item) => (
            <button key={item.value} type="button" onClick={() => onChange(item.value)}
                className={`flex-1 flex items-center justify-center gap-1 h-[34px] px-3 py-2 rounded-xl text-[13px] font-medium tracking-[0.1px] transition-all duration-150 ease-[cubic-bezier(0.34,1.56,0.64,1)] cursor-pointer active:scale-95 shadow-[inset_1.5px_1.5px_3px_rgba(255,255,255,0.15),inset_-2px_-2px_4px_rgba(0,0,0,0.3)] ${
                    value === item.value ? 'bg-[#555] text-white' : 'text-[rgba(218,220,224,0.75)] hover:text-white hover:bg-white/5'
                }`}>
                {item.icon}<span>{item.label}</span>
            </button>
        ))}
    </div>
);
