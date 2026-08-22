import { describe, expect, it } from 'vitest';
import {
  DEPTH_MARKER_INTERVAL_MM,
  DEPTH_MARKER_VIEWPORT_X_FRACTION,
  ECHO_STAGE_ASPECT,
  MAX_DEPTH_MARKER_COUNT,
  echoDepthMarkers,
} from '../../src/echo/depthMarkers.ts';

const frame = (overrides: Partial<{
  depthMm: number;
  halfAngleRad: number;
  vertex: 'up' | 'down';
}> = {}) => ({
  depthMm: 167.9,
  halfAngleRad: (40 * Math.PI) / 180,
  vertex: 'down' as const,
  ...overrides,
});

function markerGeometry(marker: ReturnType<typeof echoDepthMarkers>[number], vertex: 'up' | 'down') {
  const screenX = ((marker.leftPercent / 100) - 0.5) * 2 * ECHO_STAGE_ASPECT;
  const top = marker.topPercent / 100;
  const axial = vertex === 'down' ? 2 * (1 - top) : 2 * top;
  return {
    radius: Math.hypot(screenX, axial),
    angle: Math.atan2(screenX, axial),
  };
}

describe('echo depth-marker dots', () => {
  it('places one dot at every whole centimetre inside a fractional distal depth', () => {
    const markers = echoDepthMarkers(frame());
    expect(DEPTH_MARKER_INTERVAL_MM).toBe(10);
    expect(markers).toHaveLength(16);
    expect(markers.map((marker) => marker.depthMm)).toEqual(
      Array.from({ length: 16 }, (_, index) => (index + 1) * 10),
    );
    expect(markers.at(-1)?.depthMm).toBeLessThan(167.9);
  });

  it('does not draw zero or a dot exactly on the distal boundary', () => {
    expect(echoDepthMarkers(frame({ depthMm: 80 })).map((marker) => marker.depthMm))
      .toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(echoDepthMarkers(frame({ depthMm: 10 }))).toEqual([]);
  });

  it('places every ordinary marker on the right fan edge at its exact radial depth', () => {
    const markers = echoDepthMarkers(frame());
    for (const marker of markers) {
      const geometry = markerGeometry(marker, 'down');
      expect(geometry.radius).toBeCloseTo((marker.depthMm / 167.9) * 2, 12);
      expect(geometry.angle).toBeCloseTo((40 * Math.PI) / 180, 12);
    }
    expect(markers.every((marker) => marker.leftPercent <= 100)).toBe(true);
    expect(ECHO_STAGE_ASPECT).toBe(4 / 3);
  });

  it('keeps wide-sector crop markers on their depth circles instead of clamping x alone', () => {
    const depthMm = 200;
    const halfAngleRad = Math.PI / 2;
    const markers = echoDepthMarkers(frame({ depthMm, halfAngleRad }));
    const cropped = markers.filter(
      (marker) => marker.leftPercent > 50 + DEPTH_MARKER_VIEWPORT_X_FRACTION * 50 - 1e-9,
    );
    expect(cropped.length).toBeGreaterThan(0);
    for (const marker of cropped) {
      const geometry = markerGeometry(marker, 'down');
      expect(geometry.radius).toBeCloseTo((marker.depthMm / depthMm) * 2, 12);
      expect(geometry.angle).toBeLessThanOrEqual(halfAngleRad);
      expect(marker.leftPercent).toBeCloseTo(
        50 + DEPTH_MARKER_VIEWPORT_X_FRACTION * 50,
        12,
      );
    }
  });

  it('mirrors vertically with the displayed vertex but stays on screen-right', () => {
    const down = echoDepthMarkers(frame({ vertex: 'down' }));
    const up = echoDepthMarkers(frame({ vertex: 'up' }));
    expect(up).toHaveLength(down.length);
    for (let index = 0; index < down.length; index += 1) {
      expect(up[index].leftPercent).toBeCloseTo(down[index].leftPercent, 12);
      expect(up[index].topPercent + down[index].topPercent).toBeCloseTo(100, 12);
    }
  });

  it('recalibrates both count and spacing when live fan depth changes', () => {
    const eight = echoDepthMarkers(frame({ depthMm: 80 }));
    const eightAndAHalf = echoDepthMarkers(frame({ depthMm: 85 }));
    expect(eight).toHaveLength(7);
    expect(eightAndAHalf).toHaveLength(8);
    expect(eightAndAHalf[0].topPercent).toBeGreaterThan(eight[0].topPercent);
  });

  it('fails closed for invalid geometry', () => {
    expect(echoDepthMarkers(frame({ depthMm: 0 }))).toEqual([]);
    expect(echoDepthMarkers(frame({ depthMm: Number.NaN }))).toEqual([]);
    expect(echoDepthMarkers(frame({ halfAngleRad: 0 }))).toEqual([]);
  });

  it('fails closed instead of creating an unbounded DOM ruler for extreme imported depth', () => {
    expect(MAX_DEPTH_MARKER_COUNT).toBe(100);
    expect(echoDepthMarkers(frame({ depthMm: 1_000_000_000 }))).toEqual([]);
  });
});
