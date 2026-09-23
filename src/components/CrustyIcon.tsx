import React from 'react';

type EffectName = 'liquid' | 'trail' | 'bloom' | 'stutter' | 'reverse' | 'pulse' | 'shatter' | 'transition';

export const CrustyIcon: React.FC<{ name: EffectName | string; className?: string; size?: number; style?: React.CSSProperties }> = ({ name, className = '', size = 16, style }) => {
    return (
        <svg 
            width={size} 
            height={size} 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            style={style}
        >
            <defs>
                <filter id={`scribble-${name}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" result="noise" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </defs>
            <g filter={`url(#scribble-${name})`}>
            {name === 'liquid' && (
                <>
                    <path d="M11 2 C8 6 6 11 5 15 C3 21 9 23 11 21 C15 23 20 18 16 12 C15 9 13 5 11 2 Z" fill="none" strokeWidth="1" />
                    <path d="M12 3 C10 8 7 12 7 16 C6 20 10 22 13 22 C17 21 19 16 17 11 C15 6 13 4 12 3 Z" fill="none" strokeWidth="1.5" />
                    <path d="M9 13 Q12 18 15 15" strokeWidth="1" strokeDasharray="1 3" />
                </>
            )}
            {name === 'trail' && (
                <>
                    <path d="M3 14 L8 11 L14 15 L21 10 M4 16 L9 13 L15 17 L22 12 M2 12 L7 9 L13 13 L20 8" strokeWidth="1.2" fill="none" />
                    <path d="M6 5 L18 5 M5 19 L19 19" strokeWidth="1" strokeDasharray="3 4" />
                </>
            )}
            {name === 'bloom' && (
                <>
                    <path d="M12 2 L13 9 L21 8 L16 14 L19 22 L12 17 L5 21 L8 13 L2 9 L10 8 Z" fill="none" strokeWidth="1" strokeLinejoin="miter" />
                    <path d="M12 4 L14.5 10 L22 11 L15 15 L18 21 L12 17.5 L6 20 L9 15 L2 12 L9.5 10 Z" fill="none" strokeWidth="1.5" strokeLinejoin="miter" />
                    <circle cx="12" cy="13" r="1.5" fill="none" />
                    <circle cx="5" cy="5" r="1" fill="currentColor" />
                    <circle cx="21" cy="20" r="1.5" fill="none" strokeDasharray="1 2" />
                </>
            )}
            {name === 'stutter' && (
                <>
                    <rect x="3" y="3" width="3" height="15" fill="none" strokeWidth="1"/>
                    <rect x="4" y="5" width="2" height="17" fill="none" strokeWidth="1.5" strokeDasharray="2 2"/>
                    <rect x="9" y="8" width="4" height="13" fill="none" strokeWidth="1"/>
                    <rect x="15" y="2" width="6" height="18" fill="none" strokeWidth="1.5"/>
                    <rect x="14" y="4" width="7" height="20" fill="none" strokeWidth="1" strokeDasharray="1 3"/>
                    <line x1="2" y1="12" x2="22" y2="13" strokeWidth="2" strokeDasharray="1 4" />
                </>
            )}
            {name === 'reverse' && (
                <>
                    <path d="M22 10 L8 10 M12 4 L6 10 L15 17" strokeWidth="1" fill="none"/>
                    <path d="M21 13 L7 12 M10 7 L3 12 L12 20" strokeWidth="1.5" fill="none"/>
                    <circle cx="18" cy="18" r="0.5" fill="currentColor" stroke="none"/>
                </>
            )}
            {name === 'pulse' && (
                <path d="M1 12 L4 11 L7 2 L10 22 L14 8 L17 18 L19 12 L23 13 M2 14 L6 13 L8 5 L12 20 L15 6 L18 15 L21 14" strokeWidth="1.5" fill="none" strokeLinejoin="miter" />
            )}
            {name === 'shatter' && (
                <>
                    <path d="M10 2L4 12L12 13Z M13 5L20 10L14 16Z M6 15L3 21L12 22Z M15 18L22 23L18 21Z M12 6L10 10L13 12Z" fill="none" strokeWidth="1.5" strokeLinejoin="miter" />
                    <path d="M12 2L6 14L14 15Z" fill="none" strokeWidth="1" strokeDasharray="2 3" />
                </>
            )}
            {name === 'transition' && (
                <>
                    <path d="M6 8 C6 2 12 1 15 5 C18 9 14 15 10 15 C6 15 6 12 6 8 Z" fill="none" strokeWidth="1"/>
                    <path d="M4 11 C4 4 14 3 17 8 C20 13 15 20 9 20 C3 20 4 16 4 11 Z" fill="none" strokeWidth="1.5" strokeDasharray="4 2"/>
                    <path d="M10 10 C14 6 22 8 20 14 C18 20 11 22 7 18 C3 14 7 10 10 10 Z" fill="none" strokeWidth="1.5"/>
                    <line x1="2" y1="2" x2="22" y2="22" strokeWidth="1" strokeDasharray="1 1" />
                </>
            )}
            {/* Fallback for standard icons if passed */}
            {!['liquid', 'trail', 'bloom', 'stutter', 'reverse', 'pulse', 'shatter', 'transition'].includes(name) && (
                <circle cx="12" cy="12" r="10" strokeWidth="1" strokeDasharray="2,2" />
            )}
            </g>
        </svg>
    );
};
