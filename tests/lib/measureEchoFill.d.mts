/**
 * Types for the shared in-page echo measurement.
 *
 * Hand-written rather than generated because the module it describes is
 * deliberately plain JavaScript: it is serialised into the browser by Playwright
 * and has to survive that with no imports, no helpers and no transpiled
 * scaffolding around it.
 */
export interface EchoFillChordSummary {
  p25: number;
  median: number;
  p75: number;
}

export interface EchoFillLabelGrey {
  label: number;
  structure: string;
  echogenicity: number | null;
  samples: number;
  meanGrey: number;
  medianGrey: number;
}

export interface EchoFillReport {
  view: string;
  structure: string;
  label: number;
  echogenicity: number;
  canvas: [number, number];
  chords: number;
  trueThicknessMm: EchoFillChordSummary;
  perpendicularChords: number;
  perpendicular: {
    trueMedianMm: number;
    renderedMedianMm: number;
    filledFraction: number;
  };
  greyFloor: number;
  greyByLabel: EchoFillLabelGrey[];
  /**
   * Brightness at the edges of a wall against brightness through its middle.
   *
   * The rim-versus-band question as a number, and the one this repository
   * asserts something about: see `tests/visual/echo-resolution.spec.ts`.
   */
  rimVersusCore: { rim: number; core: number; ratio: number };
}

export declare const measureEchoFill: (
  options: { packId: string; structure: string },
) => Promise<EchoFillReport>;
