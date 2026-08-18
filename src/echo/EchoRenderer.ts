/**
 * echo-renderer — WebGL2, three GPU passes over a labelled volume.
 *
 *   1. scan     ray-cast per (scanline, depth) in polar space
 *   2. psf      separable convolution, lateral then axial
 *   3. display  TGC, log compression, dynamic range, scan conversion, sector mask
 *
 * "Single render pass" in `contracts/echo-renderer.md` is read as single
 * SCATTERING — one ray-cast, no secondary rays — matching the upgrade path's
 * "secondary rays only if vetting flags missing artifacts". It is not a claim
 * about GPU passes: the same sentence asks for a *separable* PSF convolution,
 * and separability is only realisable across passes.
 *
 * The renderer takes a probe pose and a volume. It does not know what a view is,
 * what a sweep is, or that a free cutter exists. There is deliberately no code
 * path from `{N, s}` into this file.
 */
import {
  LABEL_LUT_SIZE,
  type EchoTuning,
  type VolumeDescriptor,
} from './acoustics.ts';
import type { ImagingFrame } from './probeFrame.ts';
import { FULLSCREEN_VERTEX, DISPLAY_FRAGMENT } from './shaders/displayPass.ts';
import { PSF_FRAGMENT } from './shaders/psfPass.ts';
import { SCAN_FRAGMENT } from './shaders/scanPass.ts';

export class EchoRendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EchoRendererError';
  }
}

/** Polar working resolution: scanlines across the fan, samples along each beam. */
export interface PolarResolution {
  scanlines: number;
  samples: number;
}

/*
 * Polar working resolution. Chosen so the polar image is not coarser than the
 * panel it is resampled onto: at 256x384 the scan conversion was magnifying by
 * more than two, and magnified speckle reads as blockiness rather than texture.
 */
export const DEFAULT_POLAR: Readonly<PolarResolution> = { scanlines: 384, samples: 512 };

/**
 * Quadrature steps for the attenuation path integral, independent of the polar
 * sample count. See the comment in `scanPass.ts`: this is the single number
 * that decides the renderer's cost.
 */
export const ATTENUATION_STEPS = 40;

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new EchoRendererError('could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown';
    gl.deleteShader(shader);
    throw new EchoRendererError(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new EchoRendererError('could not create program');
  const vertexShader = compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown';
    gl.deleteProgram(program);
    throw new EchoRendererError(`program link failed: ${log}`);
  }
  return program;
}

export class EchoRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly scanProgram: WebGLProgram;
  private readonly psfProgram: WebGLProgram;
  private readonly displayProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;

  private volumeTexture: WebGLTexture | null = null;
  private lutTexture: WebGLTexture | null = null;
  private descriptor: VolumeDescriptor | null = null;
  private targets: Target[] = [];
  private polar: PolarResolution = { ...DEFAULT_POLAR };
  private disposed = false;

  /**
   * Half-precision float targets. The envelope spans several orders of
   * magnitude before compression, so an 8-bit intermediate would quantise the
   * low-level speckle to nothing — which is precisely the content priority 1
   * cares about. `EXT_color_buffer_float` is required rather than optional for
   * that reason; a fallback to RGBA8 would silently render a worse image.
   */
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new EchoRendererError('WebGL2 is unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new EchoRendererError(
        'EXT_color_buffer_float is unavailable; the echo intermediate needs float targets',
      );
    }
    this.gl = gl;
    this.scanProgram = link(gl, SCAN_FRAGMENT);
    this.psfProgram = link(gl, PSF_FRAGMENT);
    this.displayProgram = link(gl, DISPLAY_FRAGMENT);

    const vao = gl.createVertexArray();
    if (!vao) throw new EchoRendererError('could not create vertex array');
    this.vao = vao;
  }

  /** Upload the label volume and its lookup. Call once per pack. */
  setVolume(descriptor: VolumeDescriptor, voxels: Uint8Array): void {
    const gl = this.gl;
    const [width, height, depth] = descriptor.resolution;
    if (voxels.length !== width * height * depth) {
      throw new EchoRendererError(
        `volume is ${voxels.length} B; resolution ${width}x${height}x${depth} implies ${width * height * depth} B`,
      );
    }

    this.disposeVolume();

    const volume = gl.createTexture();
    if (!volume) throw new EchoRendererError('could not create volume texture');
    gl.bindTexture(gl.TEXTURE_3D, volume);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.R8, width, height, depth, 0, gl.RED, gl.UNSIGNED_BYTE, voxels,
    );
    /*
     * NEAREST, not LINEAR. These are label ids, not intensities: interpolating
     * between label 3 and label 9 yields label 6, which is a different tissue.
     * Every boundary in the image would gain a ring of whatever structure
     * happens to sit numerically between its neighbours.
     */
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    const lut = gl.createTexture();
    if (!lut) throw new EchoRendererError('could not create lookup texture');
    gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, LABEL_LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      descriptor.lut.data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    this.volumeTexture = volume;
    this.lutTexture = lut;
    this.descriptor = descriptor;
  }

  setPolarResolution(polar: PolarResolution): void {
    this.polar = polar;
    this.disposeTargets();
  }

  private ensureTargets(): Target[] {
    if (this.targets.length === 2) return this.targets;
    const gl = this.gl;
    const { scanlines, samples } = this.polar;
    this.targets = [0, 1].map(() => {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new EchoRendererError('could not create render target');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, scanlines, samples, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new EchoRendererError('polar render target is incomplete');
      }
      return { framebuffer, texture };
    });
    return this.targets;
  }

  /** Render one frame for `frame` into the canvas. */
  render(frame: ImagingFrame, tuning: EchoTuning): void {
    if (this.disposed) throw new EchoRendererError('renderer has been disposed');
    const gl = this.gl;
    const descriptor = this.descriptor;
    if (!descriptor || !this.volumeTexture || !this.lutTexture) {
      throw new EchoRendererError('no volume has been set');
    }

    const [scan, blur] = this.ensureTargets();
    const { scanlines, samples } = this.polar;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    /* --- pass 1: ray-cast --------------------------------------------- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, scan.framebuffer);
    gl.viewport(0, 0, scanlines, samples);
    gl.useProgram(this.scanProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    this.setInt(this.scanProgram, 'uVolume', 0);
    this.setInt(this.scanProgram, 'uLut', 1);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.scanProgram, 'uMeshToVolume'), false,
      new Float32Array(descriptor.meshToVolume),
    );
    this.setVec3(this.scanProgram, 'uVolumeSize', descriptor.resolution);
    this.setVec3(this.scanProgram, 'uOrigin', frame.origin);
    this.setVec3(this.scanProgram, 'uBeam', frame.beam);
    this.setVec3(this.scanProgram, 'uLateral', frame.lateral);
    this.setFloat(this.scanProgram, 'uHalfAngle', frame.halfAngleRad);
    this.setFloat(this.scanProgram, 'uDepthMm', frame.depthMm);
    this.setFloat(this.scanProgram, 'uAttenuationScale', descriptor.lut.attenuationScale);
    this.setFloat(this.scanProgram, 'uAttenDbPerCm', tuning.attenuationDbPerCm);
    this.setFloat(this.scanProgram, 'uScattererDensity', tuning.scattererDensity);
    this.setFloat(this.scanProgram, 'uScatter', tuning.scatter);
    this.setFloat(this.scanProgram, 'uSpecular', tuning.specular);
    this.setFloat(this.scanProgram, 'uBoundaryReflection', tuning.boundaryReflection);
    this.setFloat(this.scanProgram, 'uClutter', tuning.clutter);
    this.setFloat(this.scanProgram, 'uSeed', descriptor.scattererSeed % 65536);
    this.setInt(this.scanProgram, 'uSteps', samples);
    this.setInt(this.scanProgram, 'uAttenSteps', ATTENUATION_STEPS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* --- pass 2: separable PSF ---------------------------------------- */
    const mmPerSample = frame.depthMm / samples;
    const mmPerScanline = (frame.halfAngleRad * 2 * frame.depthMm) / scanlines;
    const lateralSigma = tuning.psfLateralMm / Math.max(mmPerScanline, 1e-6);
    const axialSigma = tuning.psfAxialMm / Math.max(mmPerSample, 1e-6);

    // Lateral first, then axial; the envelope is formed on the second.
    this.psfPass(scan, blur, [1, 0], lateralSigma, tuning, frame, false);
    this.psfPass(blur, scan, [0, 1], axialSigma, tuning, frame, true);

    /* --- pass 3: post + scan conversion ------------------------------- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scan.texture);
    this.setInt(this.displayProgram, 'uPolar', 0);
    this.setFloat(this.displayProgram, 'uHalfAngle', frame.halfAngleRad);
    this.setFloat(this.displayProgram, 'uDepthMm', frame.depthMm);
    this.setFloat(this.displayProgram, 'uTgcDb', tuning.tgcDb);
    this.setFloat(this.displayProgram, 'uGain', tuning.gain);
    this.setFloat(this.displayProgram, 'uGamma', tuning.gamma);
    this.setFloat(this.displayProgram, 'uDynamicRangeDb', tuning.dynamicRangeDb);
    this.setFloat(this.displayProgram, 'uReject', tuning.reject);
    this.setInt(this.displayProgram, 'uVertexDown', frame.vertex === 'down' ? 1 : 0);
    this.setInt(this.displayProgram, 'uFlipLr', frame.flipLr ? 1 : 0);
    this.setFloat(this.displayProgram, 'uAspect', width / Math.max(height, 1));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private psfPass(
    from: Target, to: Target, axis: [number, number], sigma: number,
    tuning: EchoTuning, frame: ImagingFrame, envelope: boolean,
  ): void {
    const gl = this.gl;
    const { scanlines, samples } = this.polar;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
    gl.viewport(0, 0, scanlines, samples);
    gl.useProgram(this.psfProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.texture);
    this.setInt(this.psfProgram, 'uSource', 0);
    gl.uniform2f(gl.getUniformLocation(this.psfProgram, 'uTexel'), 1 / scanlines, 1 / samples);
    gl.uniform2f(gl.getUniformLocation(this.psfProgram, 'uAxis'), axis[0], axis[1]);
    this.setFloat(this.psfProgram, 'uSigma', sigma);
    this.setFloat(this.psfProgram, 'uDefocus', tuning.psfDefocus);
    this.setFloat(this.psfProgram, 'uFocusDepth', Math.min(1, frame.focusMm / frame.depthMm));
    // Three sigma captures the kernel; the shader caps the loop at 64 either way.
    this.setInt(this.psfProgram, 'uRadius', Math.min(64, Math.max(1, Math.ceil(sigma * 3))));
    this.setInt(this.psfProgram, 'uEnvelope', envelope ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private setFloat(program: WebGLProgram, name: string, value: number): void {
    this.gl.uniform1f(this.gl.getUniformLocation(program, name), value);
  }

  private setInt(program: WebGLProgram, name: string, value: number): void {
    this.gl.uniform1i(this.gl.getUniformLocation(program, name), value);
  }

  private setVec3(program: WebGLProgram, name: string, value: readonly number[]): void {
    this.gl.uniform3f(this.gl.getUniformLocation(program, name), value[0], value[1], value[2]);
  }

  private disposeVolume(): void {
    if (this.volumeTexture) this.gl.deleteTexture(this.volumeTexture);
    if (this.lutTexture) this.gl.deleteTexture(this.lutTexture);
    this.volumeTexture = null;
    this.lutTexture = null;
  }

  private disposeTargets(): void {
    for (const target of this.targets) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
    this.targets = [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeVolume();
    this.disposeTargets();
    this.gl.deleteProgram(this.scanProgram);
    this.gl.deleteProgram(this.psfProgram);
    this.gl.deleteProgram(this.displayProgram);
    this.gl.deleteVertexArray(this.vao);
  }
}

/** Fetch a `raw-u8` label volume. Kept here so the panel does not hand-roll it. */
export async function fetchVolume(url: string, init?: RequestInit): Promise<Uint8Array> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new EchoRendererError(`echo volume fetch failed: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
