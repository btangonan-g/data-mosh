export type MoshMode = 'liquid' | 'bloom' | 'stutter' | 'transition' | 'reverse' | 'pulse' | 'trail' | 'shatter';

export interface MoshSettings {
    mode: MoshMode;
    intensity: number;
    fps: number;
    preserveAudio: boolean;
}

export interface MoshRegion {
    id: string;
    mode: MoshMode;
    intensity: number;
    startMs: number;
    durationMs: number;
    // Transition mode: second clip whose motion vectors warp the source pixels
    transitionFile?: File;
    transitionName?: string;
}

export interface MediaState {
    id: string;
    dataUrl: string;
    name: string;
    type: 'video';
    file?: File;
    duration?: number; // seconds
}
