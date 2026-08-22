import type { ImagingFrame } from './probeFrame.ts';

/** The echo stage is deliberately fixed at 4:3 in `styles.css`. */
export const ECHO_STAGE_ASPECT = 4 / 3;
/** One calibration dot per centimetre, matching the schema's authored depth unit. */
export const DEPTH_MARKER_INTERVAL_MM = 10;
/** Keep a centred 3 px dot wholly visible when a wide fan runs beyond the canvas. */
export const DEPTH_MARKER_VIEWPORT_X_FRACTION = 0.99;
/** A corrupt/imported pose must never create an unbounded DOM ruler. */
export const MAX_DEPTH_MARKER_COUNT = 100;

export interface EchoDepthMarker {
  depthMm: number;
  leftPercent: number;
  topPercent: number;
}

/**
 * Locate physical depth dots along the screen-right edge of the displayed fan.
 *
 * Depth is radial from the sector vertex, not vertical screen distance. The
 * display shader maps full depth to a normalised radius of two, so the same
 * polar-to-Cartesian relationship places this DOM overlay exactly on its fan.
 * `flip_lr` does not enter the calculation: the scale belongs to screen-right,
 * while `markerSide` describes the probe-notch convention and is a different
 * clinical symbol.
 *
 * A schema-valid sector can be wider than the 4:3 viewport. When its edge is
 * off-screen, the marker moves to a small inset from the right crop boundary
 * and its axial coordinate is recomputed from the SAME depth circle. Merely
 * clamping x would falsely change its radial depth.
 *
 * Zero and the distal boundary are omitted. They are already visible as the
 * vertex and fan edge, and drawing a boundary dot would be half-clipped.
 */
export function echoDepthMarkers(
  frame: Pick<ImagingFrame, 'depthMm' | 'halfAngleRad' | 'vertex'>,
  aspect = ECHO_STAGE_ASPECT,
): EchoDepthMarker[] {
  if (
    !Number.isFinite(frame.depthMm)
    || !Number.isFinite(frame.halfAngleRad)
    || !Number.isFinite(aspect)
    || frame.depthMm <= 0
    || frame.halfAngleRad <= 0
    || aspect <= 0
  ) return [];

  const markerCount = Math.max(
    0,
    Math.ceil((frame.depthMm - 1e-9) / DEPTH_MARKER_INTERVAL_MM) - 1,
  );
  if (markerCount > MAX_DEPTH_MARKER_COUNT) return [];

  const markers: EchoDepthMarker[] = [];
  for (let index = 1; index <= markerCount; index += 1) {
    const depthMm = index * DEPTH_MARKER_INTERVAL_MM;
    const fraction = depthMm / frame.depthMm;
    // The shader maps full depth to radius 2 in its aspect-corrected p-space.
    const radius = fraction * 2;
    const fanEdgeX = radius * Math.sin(frame.halfAngleRad);
    const maxVisibleX = aspect * DEPTH_MARKER_VIEWPORT_X_FRACTION;
    const screenX = Math.min(fanEdgeX, maxVisibleX);
    const axial = fanEdgeX <= maxVisibleX
      ? radius * Math.cos(frame.halfAngleRad)
      : Math.sqrt(Math.max(0, radius * radius - screenX * screenX));
    markers.push({
      depthMm,
      leftPercent: (0.5 + screenX / (2 * aspect)) * 100,
      topPercent: (frame.vertex === 'down' ? 1 - axial / 2 : axial / 2) * 100,
    });
  }
  return markers;
}
