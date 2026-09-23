import React from 'react';

interface IconProps {
    name: string;
    size?: number;
    className?: string;
    filled?: boolean;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, className = '', filled = false }) => (
    <span
        className={`material-symbols-rounded select-none leading-none ${className}`}
        style={{
            fontFamily: 'Material Symbols Rounded',
            fontSize: size,
            fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 300, 'GRAD' 0, 'opsz' ${size}`,
        }}
    >
        {name}
    </span>
);
