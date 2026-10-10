// Unit conversion. The model is in millimeters (print-native). CSS resolves
// `Xmm` at 96 DPI using this constant. We only need px when integrating with
// libraries that think in pixels (react-moveable drag/resize deltas).
export const PX_PER_MM = 96 / 25.4; // ≈ 3.7795

export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;
