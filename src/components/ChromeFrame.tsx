import React, { useId, useMemo, useRef, useState, useEffect } from 'react';

/**
 * ChromeFrame — Liquid metal border effect.
 * 
 * Uses the "gooey" SVG filter technique:
 * blur → color matrix threshold → specular + diffuse lighting
 * Applied to multiple wavy stroked paths to create organic chrome blobs.
 */
export const ChromeFrame: React.FC<{
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    borderWidth?: number;
    variant?: 'chrome' | 'brushed' | 'dark';
}> = ({ children, className = '', style, borderWidth = 14, variant = 'chrome' }) => {
    const id = useId().split(':').join('');
    const bw = borderWidth;
    const containerRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

    // Track actual pixel dimensions
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) {
                setDims({ w: Math.round(width), h: Math.round(height) });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const colors = {
        chrome: { stroke: '#b0b0b0', lightColor: '#ffffff' },
        brushed: { stroke: '#808080', lightColor: '#e0e0e0' },
        dark: { stroke: '#555555', lightColor: '#aaaaaa' },
    }[variant];

    // Generate wavy paths based on actual dimensions
    const svgContent = useMemo(() => {
        if (!dims) return null;
        const { w, h } = dims;
        const pad = Math.min(w, h) * 0.06; // ~6% padding
        return generateLiquidMetalSVG(w, h, pad);
    }, [dims]);

    return (
        <div ref={containerRef} className={`chrome-frame-wrapper relative ${className}`} style={style}>
            {/* Liquid metal SVG border */}
            {dims && svgContent && (
                <svg
                    className="absolute inset-0 pointer-events-none z-20"
                    width={dims.w}
                    height={dims.h}
                    viewBox={`0 0 ${dims.w} ${dims.h}`}
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ overflow: 'visible' }}
                >
                    <defs>
                        <filter id={`lm-${id}`} x="-20%" y="-20%" width="140%" height="140%"
                            colorInterpolationFilters="sRGB">
                            {/* 1. Blur to bridge shapes */}
                            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1" />

                            {/* 2. Sharpen alpha → "gooey" edge */}
                            <feColorMatrix in="blur1" mode="matrix"
                                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -10"
                                result="goo" />

                            {/* 3. Extract alpha for bump map */}
                            <feColorMatrix in="goo" type="matrix"
                                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                                result="gooAlpha" />
                            <feGaussianBlur in="gooAlpha" stdDeviation="1" result="bumpMap" />

                            {/* 4. Specular lighting */}
                            <feSpecularLighting in="bumpMap" surfaceScale="1"
                                specularConstant="2.5" specularExponent="78"
                                lightingColor={colors.lightColor} result="specOut">
                                <feDistantLight azimuth="135" elevation="59" />
                            </feSpecularLighting>
                            <feComposite in="specOut" in2="goo" operator="in" result="specOutComp" />

                            {/* 5. Diffuse lighting */}
                            <feDiffuseLighting in="bumpMap" surfaceScale="1"
                                diffuseConstant="1.5" lightingColor={colors.lightColor} result="diffOut">
                                <feDistantLight azimuth="135" elevation="59" />
                            </feDiffuseLighting>
                            <feComposite in="diffOut" in2="goo" operator="in" result="diffOutComp" />

                            {/* Blend diffuse with base */}
                            <feComposite in="diffOutComp" in2="goo" operator="arithmetic"
                                k1="1" k2="0" k3="0" k4="0" result="shadedBase" />

                            {/* Add specular highlights */}
                            <feComposite in="specOutComp" in2="shadedBase" operator="arithmetic"
                                k1="0" k2="1" k3="1" k4="0" />
                        </filter>
                    </defs>

                    <g filter={`url(#lm-${id})`}>
                        <rect
                            x={svgContent.pad} y={svgContent.pad}
                            width={dims.w - svgContent.pad * 2}
                            height={dims.h - svgContent.pad * 2}
                            fill="none" stroke={colors.stroke} strokeWidth="4" rx="16"
                        />
                        {/* Wavy layers */}
                        {svgContent.paths.map((p, i) => (
                            <path key={i} d={p.d} fill="none" stroke={colors.stroke}
                                strokeWidth={p.sw} strokeLinejoin="round" />
                        ))}
                        {/* Accent circles */}
                        {svgContent.circles.map((c, i) => (
                            <circle key={i} cx={c.x} cy={c.y} r={c.r} fill={colors.stroke} />
                        ))}
                    </g>
                </svg>
            )}

            {/* Content */}
            <div className="relative z-10 h-full w-full" style={{ padding: bw }}>
                <div className="relative rounded-lg overflow-hidden h-full w-full">
                    {children}
                </div>
            </div>
        </div>
    );
};

/* ═══════════════════════════════════════════
   Path Generation
   ═══════════════════════════════════════════ */

interface LiquidMetalSVG {
    pad: number;
    paths: { d: string; sw: number }[];
    circles: { x: number; y: number; r: number }[];
}

function generateLiquidMetalSVG(w: number, h: number, pad: number): LiquidMetalSVG {
    // Three layers of wavy paths with different wave characteristics
    // [amplitude, wavelength, harmonicAmp, harmonicWavelength, phase, strokeWidth]
    const layers: [number, number, number, number, number, number][] = [
        [10, 100, 4, 55, 0, 4],            // smooth medium waves
        [10, 85, 4.5, 40, 2.2, 3.2],       // tighter, phase-shifted
        [8, 120, 9, 32, 1.1, 2.4],         // moderate spiky harmonics
    ];

    const paths = layers.map(([amp, wl, hAmp, hWl, phase, sw]) => ({
        d: wavyRectPath(w, h, pad, amp, wl, hAmp, hWl, phase),
        sw,
    }));

    // Random decorative circles
    const circles: { x: number; y: number; r: number }[] = [];
    const rng = seeded(42);
    for (let i = 0; i < 4; i++) {
        const edge = Math.floor(rng() * 4);
        const t = 0.15 + rng() * 0.7;
        const jitter = (rng() - 0.5) * 12;
        let x: number, y: number;
        switch (edge) {
            case 0: x = pad + t * (w - pad * 2); y = pad + jitter; break;
            case 1: x = w - pad + jitter; y = pad + t * (h - pad * 2); break;
            case 2: x = pad + t * (w - pad * 2); y = h - pad + jitter; break;
            default: x = pad + jitter; y = pad + t * (h - pad * 2); break;
        }
        circles.push({ x, y, r: 1 + rng() * 1.5 });
    }

    return { pad, paths, circles };
}

function wavyRectPath(
    w: number, h: number, pad: number,
    amp: number, wavelength: number, hAmp: number, hWavelength: number, phase: number
): string {
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    const stepsPerEdge = 54;

    const wave = (dist: number): number => {
        return Math.sin(dist / wavelength * Math.PI * 2 + phase) * amp
            + Math.sin(dist / hWavelength * Math.PI * 2 + phase * 1.7) * hAmp;
    };

    const pts: [number, number][] = [];

    // Top edge (L→R), wave perpendicular = Y offset
    for (let i = 0; i <= stepsPerEdge; i++) {
        const t = i / stepsPerEdge;
        pts.push([pad + t * iw, pad + wave(t * iw)]);
    }
    // Right edge (T→B), wave perpendicular = X offset
    for (let i = 1; i <= stepsPerEdge; i++) {
        const t = i / stepsPerEdge;
        pts.push([w - pad + wave(iw + t * ih), pad + t * ih]);
    }
    // Bottom edge (R→L), wave perpendicular = Y offset
    for (let i = 1; i <= stepsPerEdge; i++) {
        const t = i / stepsPerEdge;
        pts.push([w - pad - t * iw, h - pad + wave(iw + ih + t * iw)]);
    }
    // Left edge (B→T), wave perpendicular = X offset
    for (let i = 1; i < stepsPerEdge; i++) {
        const t = i / stepsPerEdge;
        pts.push([pad + wave(2 * iw + ih + t * ih), h - pad - t * ih]);
    }

    return 'M ' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ') + ' Z';
}

function seeded(seed: number) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
