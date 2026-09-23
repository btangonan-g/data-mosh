import React from 'react';

type EffectName = 'liquid' | 'bloom' | 'stutter' | 'reverse' | 'pulse' | 'transition';

export const EffectPreview: React.FC<{
    name: EffectName | string;
    className?: string;
    width?: number;
    color?: string;
}> = ({ name, className = '', width = 100, color = 'currentColor' }) => {
    const h = Math.round(width * 0.72);
    const filterId = `emboss-${name.split('').filter(c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')).join('')}`;
    return (
        <svg
            width={width}
            height={h}
            viewBox="0 0 80 56"
            fill="none"
            className={className}
            style={{ overflow: 'visible' }}
        >
            <defs>
                <filter id={filterId} colorInterpolationFilters="sRGB" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="bumpMap" />
                    <feSpecularLighting in="bumpMap" surfaceScale="1.5" specularConstant="2.5" specularExponent="78" lightingColor="#ffffff" result="specOut">
                        <feDistantLight azimuth="135" elevation="59" />
                    </feSpecularLighting>
                    <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOutComp" />

                    <feDiffuseLighting in="bumpMap" surfaceScale="1.5" diffuseConstant="1.5" lightingColor="#ffffff" result="diffOut">
                        <feDistantLight azimuth="135" elevation="59" />
                    </feDiffuseLighting>
                    <feComposite in="diffOut" in2="SourceAlpha" operator="in" result="diffOutComp" />

                    <feComposite in="diffOutComp" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="shadedBase" />
                    <feComposite in="specOutComp" in2="shadedBase" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
                </filter>
            </defs>
            <g filter={`url(#${filterId})`}>
                {renderEffect(name as EffectName, color)}
            </g>
        </svg>
    );
};

function renderEffect(name: EffectName, c: string): React.ReactNode {
    switch (name) {

        /* ═══════════════════════════════════════════════
           LIQUID
           ═══════════════════════════════════════════════ */
        case 'liquid':
            return (
                <g fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="14" y="6" width="52" height="44" rx="12" />
                    <path d="M 26 22 Q 40 12 54 22 Q 40 32 26 22 Z" />
                    <circle cx="40" cy="22" r="4" fill={c} stroke="none" />
                    <path d="M 40 34 L 40 42 M 35 38 L 40 43 L 45 38" />
                </g>
            );

        /* ═══════════════════════════════════════════════
           BLOOM
           ═══════════════════════════════════════════════ */
        case 'bloom':
            return (
                <g fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="40" cy="28" r="5" fill={c} stroke="none" />
                    <path d="M 40 16 L 40 8 M 34 13 L 40 7 L 46 13" />
                    <path d="M 40 40 L 40 48 M 34 43 L 40 49 L 46 43" />
                    <path d="M 28 28 L 18 28 M 23 22 L 17 28 L 23 34" />
                    <path d="M 52 28 L 62 28 M 57 22 L 63 28 L 57 34" />
                </g>
            );

        /* ═══════════════════════════════════════════════
           STUTTER
           ═══════════════════════════════════════════════ */
        case 'stutter':
            return (
                <g fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="14" y="6" width="52" height="44" rx="8" />
                    <path d="M 26 22 L 46 16 L 54 22 L 34 28 Z" fill={c} stroke="none" />
                    <path d="M 26 40 L 46 34 L 54 40 L 34 46 Z" fill={c} stroke="none" />
                </g>
            );

        /* ═══════════════════════════════════════════════
           REVERSE
           ═══════════════════════════════════════════════ */
        case 'reverse':
            return (
                <g fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="10" y="10" width="60" height="36" rx="18" />
                    <path d="M 50 32 L 34 32 Q 24 32 24 24 Q 24 16 34 16 L 44 16" />
                    <path d="M 40 11 L 46 16 L 40 21" />
                </g>
            );

        /* ═══════════════════════════════════════════════
           PULSE
           ═══════════════════════════════════════════════ */
        case 'pulse':
            return (
                <path 
                    fill={c} 
                    fillRule="evenodd"
                    d="
                        M 24 8 h 32 a 16 16 0 0 1 16 16 v 8 a 16 16 0 0 1 -16 16 h -32 a 16 16 0 0 1 -16 -16 v -8 a 16 16 0 0 1 16 -16 Z
                        M 28 28 a 6 6 0 1 0 -12 0 a 6 6 0 1 0 12 0 Z
                        M 48 28 a 8 6 0 1 0 -16 0 a 8 6 0 1 0 16 0 Z
                        M 64 28 a 6 6 0 1 0 -12 0 a 6 6 0 1 0 12 0 Z
                    " 
                />
            );

        /* ═══════════════════════════════════════════════
           TRANSITION
           ═══════════════════════════════════════════════ */
        case 'transition':
            return (
                <g fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="18" y="12" width="26" height="26" rx="6" />
                    <rect x="36" y="18" width="26" height="26" rx="6" />
                </g>
            );

        default:
            return <rect x="10" y="8" width="60" height="40" rx="2" stroke={c} strokeWidth="1" opacity="0.3" fill="none" />;
    }
}
