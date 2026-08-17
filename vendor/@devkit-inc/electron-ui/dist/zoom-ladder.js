"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZOOM_STEPS = void 0;
exports.clamp = clamp;
exports.nearest = nearest;
exports.stepUp = stepUp;
exports.stepDown = stepDown;
/** Browser-style zoom ladder as decimal factors (1 = 100%). */
exports.ZOOM_STEPS = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];
const MIN = exports.ZOOM_STEPS[0];
const MAX = exports.ZOOM_STEPS[exports.ZOOM_STEPS.length - 1];
const EPS = 1e-3; // absorb float drift from getZoomFactor()
function clamp(factor) {
    return Math.min(MAX, Math.max(MIN, factor));
}
function nearest(factor) {
    return exports.ZOOM_STEPS.reduce((a, b) => (Math.abs(b - factor) < Math.abs(a - factor) ? b : a));
}
function stepUp(factor) {
    return exports.ZOOM_STEPS.find((s) => s > factor + EPS) ?? MAX;
}
function stepDown(factor) {
    return [...exports.ZOOM_STEPS].reverse().find((s) => s < factor - EPS) ?? MIN;
}
