"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AETHER · WebGL dot-matrix particle field.
 *
 * A meditative, retro-futurist dot grid rendered with custom shaders:
 * charcoal dots on black, sparse spacing, soft depth fade, a slow
 * breathing pulse and a subtle pointer-reactive parallax drift.
 * DPR is clamped to 2. Falls back to a CSS dot pattern when WebGL
 * is unavailable, and renders a single static frame under
 * prefers-reduced-motion.
 */

const VERT_SRC = `
attribute vec2 aPos;    // dot position in CSS pixels
attribute float aDepth; // 0..1 pseudo-depth of the dot
uniform vec2 uRes;      // canvas size in device pixels
uniform float uTime;
uniform vec2 uPointer;  // -1..1, lerped pointer offset
uniform float uDpr;
varying float vDepth;
varying float vBreath;

void main() {
  vDepth = aDepth;

  // slow breathing pulse, de-synced per dot via depth + position
  float phase = uTime * 0.45 + aDepth * 6.2831 + aPos.x * 0.021 + aPos.y * 0.017;
  vBreath = 0.5 + 0.5 * sin(phase);

  vec2 pos = aPos * uDpr;

  // pointer parallax drift — deeper dots move less (subtle)
  pos += uPointer * (5.0 + 22.0 * aDepth) * uDpr;

  // slow ambient wander
  pos.x += cos(uTime * 0.07 + aPos.y * 0.013) * 2.2 * uDpr;
  pos.y += sin(uTime * 0.06 + aPos.x * 0.011) * 2.2 * uDpr;

  vec2 clip = (pos / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);

  gl_PointSize = (1.7 + vBreath * 1.7) * uDpr * (0.8 + aDepth * 1.1);
}
`;

const FRAG_SRC = `
precision mediump float;
varying float vDepth;
varying float vBreath;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  // soft-edged dot particle
  float disc = smoothstep(0.5, 0.16, d);

  // charcoal on black — slightly lifted by depth
  float base = 0.28 + 0.22 * vDepth;
  vec3 col = vec3(base);

  // soft depth fade + breathing alpha
  float alpha = disc * (0.50 + 0.50 * vBreath) * mix(0.45, 1.0, vDepth);

  gl_FragColor = vec4(col, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/** Deterministic hash → 0..1 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

const SPACING = 34; // CSS px — sparse dot matrix

export default function AetherCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", { alpha: true, antialias: false, depth: false }) as
        | WebGLRenderingContext
        | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) {
      setFallback(true);
      return;
    }

    const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vert || !frag) {
      setFallback(true);
      return;
    }

    const prog = gl.createProgram();
    if (!prog) {
      setFallback(true);
      return;
    }
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uPointer = gl.getUniformLocation(prog, "uPointer");
    const uDpr = gl.getUniformLocation(prog, "uDpr");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let dots = 0;
    const buf = gl.createBuffer();

    const build = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);

      // sparse jittered grid of dots with pseudo-depth
      const cols = Math.ceil(width / SPACING) + 2;
      const rows = Math.ceil(height / SPACING) + 2;
      const data = new Float32Array(cols * rows * 3);
      let i = 0;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const seed = gx * 74.7 + gy * 151.3;
          const jx = (hash(seed) - 0.5) * SPACING * 0.55;
          const jy = (hash(seed + 91.7) - 0.5) * SPACING * 0.55;
          data[i++] = (gx - 0.5) * SPACING + jx;
          data[i++] = (gy - 0.5) * SPACING + jy;
          data[i++] = 0.2 + hash(seed + 33.3) * 0.8; // depth
        }
      }
      dots = cols * rows;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

      const aPos = gl.getAttribLocation(prog, "aPos");
      const aDepth = gl.getAttribLocation(prog, "aDepth");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
      gl.enableVertexAttribArray(aDepth);
      gl.vertexAttribPointer(aDepth, 1, gl.FLOAT, false, 12, 8);

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uDpr, dpr);
    };

    build();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    // pointer state, softly lerped (drift, not chase)
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    const onPointer = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let running = true;
    const t0 = performance.now();

    const frame = () => {
      if (!running) return;
      px += (tx - px) * 0.035;
      py += (ty - py) * 0.035;
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.uniform2f(uPointer, px, py);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, dots);
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 150);
    };
    window.addEventListener("resize", onResize, { passive: true });

    frame();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, []);

  if (fallback) {
    // DOM fallback — CSS dot matrix with a breathing opacity
    return (
      <div
        aria-hidden="true"
        className="aether-dots-fallback pointer-events-none fixed inset-0 z-0"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
