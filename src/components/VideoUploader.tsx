import React from 'react';
import { Upload } from 'lucide-react';
import { Flow } from 'flow-sdk';
import { MediaState } from '../types';

interface Props {
    onSelect: (media: MediaState) => void;
    loading?: boolean;
}

export const VideoUploader: React.FC<Props> = ({ onSelect, loading }) => {
    const handleSelect = async () => {
        try {
            const media = await Flow.media.select({ filter: 'video' });
            if (media && media.type === 'video') {
                const bytes = Uint8Array.from(atob(media.base64), c => c.charCodeAt(0));
                const blob = new Blob([bytes], { type: media.mimeType });
                const file = new File([blob], media.name || 'video.mp4', { type: media.mimeType });
                const dataUrl = URL.createObjectURL(file);

                onSelect({
                    id: media.mediaId,
                    dataUrl,
                    name: media.name || 'video.mp4',
                    type: 'video',
                    file,
                });
            }
        } catch (err) {
            console.error('Failed to select media:', err);
        }
    };

    return (
        <div
            onClick={!loading ? handleSelect : undefined}
            className={`\n                relative group cursor-pointer w-full\n                p-6 sm:p-8 md:p-12 flex flex-col items-center justify-center gap-3\n                bg-[#1a1a1a] transition-all duration-300\n                ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-zinc-800/60'}\n            `}
        >
            <button
                disabled={loading}
                className="mt-2 px-5 py-2 bg-white text-black font-medium rounded-full flex items-center gap-2 hover:bg-zinc-200 whitespace-nowrap text-[13px] sm:text-sm"
            >
                <Upload size={16} />
                Import Video
            </button>
            <div className="text-center">
                <p className="text-[10px] sm:text-xs text-zinc-500 whitespace-nowrap">
                    High motion clips work best.
                </p>
            </div>
        </div>
    );
};
