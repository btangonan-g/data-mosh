import React from 'react';

/**
 * A hand-drawn, scribbly SVG arrow connector.
 * Inspired by MaxMSP / M4L patch cable aesthetics.
 */
export const ScribblyArrow: React.FC<{
    className?: string;
    direction?: 'right' | 'down';
    animated?: boolean;
}> = ({ className = '', direction = 'right', animated = true }) => {
    if (direction === 'down') {
        return (
            <svg
                viewBox="0 0 40 80"
                fill="none"
                className={`${className}`}
                style={{ width: 40, height: 80 }}
            >
                <defs>
                    <filter id="scribbly-arrow-down" x="-20%" y="-20%" width="140%" height="140%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" seed="3" />
                        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                    </filter>
                </defs>
                <g filter="url(#scribbly-arrow-down)">
                    <path
                        d="M20 4 C18 16 22 28 19 40 C16 52 24 60 20 72"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        fill="none"
                        strokeDasharray={animated ? "120" : "none"}
                        strokeDashoffset={animated ? "120" : "0"}
                    >
                        {animated && (
                            <animate
                                attributeName="stroke-dashoffset"
                                values="120;0"
                                dur="1.5s"
                                fill="freeze"
                                begin="0.3s"
                            />
                        )}
                    </path>
                    {/* Arrowhead */}
                    <path
                        d="M14 64 L20 74 L26 64"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        opacity={animated ? "0" : "1"}
                    >
                        {animated && (
                            <animate
                                attributeName="opacity"
                                values="0;1"
                                dur="0.3s"
                                fill="freeze"
                                begin="1.6s"
                            />
                        )}
                    </path>
                </g>
            </svg>
        );
    }

    return (
        <svg
            viewBox="0 0 100 60"
            fill="none"
            className={`${className}`}
            style={{ width: '100%', height: 60, minWidth: 40, maxWidth: 70 }}
        >
            <defs>
                <filter id="scribbly-arrow-right" x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" result="noise" seed="2" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </defs>
            <g filter="url(#scribbly-arrow-right)">
                {/* Main squiggly line */}
                <path
                    d="M6 30 C16 26 24 34 34 28 C44 22 50 38 60 30 C70 22 76 36 86 30"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={animated ? "160" : "none"}
                    strokeDashoffset={animated ? "160" : "0"}
                >
                    {animated && (
                        <animate
                            attributeName="stroke-dashoffset"
                            values="160;0"
                            dur="1.2s"
                            fill="freeze"
                            begin="0.3s"
                        />
                    )}
                </path>
                {/* Arrowhead */}
                <path
                    d="M78 22 L90 30 L78 38"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={animated ? "0" : "1"}
                >
                    {animated && (
                        <animate
                            attributeName="opacity"
                            values="0;1"
                            dur="0.3s"
                            fill="freeze"
                            begin="1.3s"
                        />
                    )}
                </path>
            </g>
        </svg>
    );
};

/**
 * A hand-drawn step number circle (MaxMSP inlet/outlet style)
 */
export const StepBadge: React.FC<{
    step: number;
    label: string;
    active?: boolean;
}> = ({ step, label, active = false }) => (
    <div className="flex items-center gap-2 mb-3 select-none">
        <div className={`\n            relative w-[28px] h-[28px] rounded-full flex items-center justify-center\n            border-[1.5px] text-[13px] font-semibold tracking-wide\n            transition-all duration-300\n            ${active
                ? 'border-white/40 text-white bg-white/[0.08]'
                : 'border-[#555] text-[#777] bg-transparent'
            }\n        `}
            style={{
                fontFamily: 'monospace',
            }}
        >
            {/* Scribbly ring */}
            <svg className="absolute inset-[-3px] w-[34px] h-[34px] pointer-events-none" viewBox="0 0 34 34" fill="none">
                <circle cx="17" cy="17" r="15" stroke={active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'} strokeWidth="1" strokeDasharray="3 4" />
            </svg>
            {step}
        </div>
        <span className={`text-[11px] font-medium tracking-[0.3px] uppercase transition-colors duration-300 ${active ? 'text-white/60' : 'text-white/25'}`}>
            {label}
        </span>
    </div>
);
