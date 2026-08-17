/** Browser-style zoom ladder as decimal factors (1 = 100%). */
export declare const ZOOM_STEPS: readonly number[];
export declare function clamp(factor: number): number;
export declare function nearest(factor: number): number;
export declare function stepUp(factor: number): number;
export declare function stepDown(factor: number): number;
