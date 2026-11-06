/**
 * Frame-time monitor for the developer overlay (P1 measurement).
 * Runs its own requestAnimationFrame loop, independent of React and PixiJS.
 *
 * - fps: frames in the last second
 * - medianFps: median of per-second FPS samples in the current window
 * - longestDipMs: longest continuous period with a rolling (250 ms) FPS below 50
 * The window is reset with reset() (the "Start measurement" button).
 */
export interface PerfSnapshot {
  fps: number;
  frameMsAvg: number;
  frameMsMax: number;
  medianFps: number;
  longestDipMs: number;
  windowMs: number;
  startupMs: number | null;
  startupMarks: Partial<Record<StartupMark, number>>;
  lastCatchUp: CatchUpTiming | null;
  lastBenchmark: CatchUpTiming | null;
}

/**
 * Timing of the most recent offline catch-up. `kind` separates the P3 benchmark
 * (8 simulated hours) from real returns, which can be any length (device finding F3).
 */
export interface CatchUpTiming {
  kind: "benchmark" | "return";
  simulatedMs: number;
  totalMs: number;
  computeMs: number;
  mode: string;
}

/**
 * Startup phases, in ms since the page started loading (P2 investigation, F6):
 * - js: the app's code has been downloaded, parsed and evaluated (main.tsx starts)
 * - saveLoaded: the save file has been read and verified
 * - catchUpDone: time spent away has been settled (skipped for a new character)
 * - ready: the first screen is interactive (the overlay's "startup" value)
 * - combatDrawn: the PixiJS combat renderer exists and draws
 * Native app start before the WebView loads the page is NOT included; use a stopwatch for P2.
 */
export type StartupMark = "js" | "saveLoaded" | "catchUpDone" | "ready" | "combatDrawn";

/** Minimum measurement window for a valid P1 run (Device Test Checklist). */
export const P1_WINDOW_MS = 120_000;

class PerfMonitor {
  private frames: number[] = [];
  private secondSamples: number[] = [];
  private secondStart = 0;
  private secondFrames = 0;
  private dipStart: number | null = null;
  private longestDip = 0;
  private windowStart = performance.now();
  private last = 0;
  private running = false;
  private raf = 0;
  startupMs: number | null = null;
  private readonly startupMarks: Partial<Record<StartupMark, number>> = {};
  lastCatchUp: CatchUpTiming | null = null;
  /** Last 8-hour benchmark, kept separately so a later short return does not replace it. */
  lastBenchmark: CatchUpTiming | null = null;

  recordCatchUp(timing: CatchUpTiming): void {
    this.lastCatchUp = timing;
    if (timing.kind === "benchmark") this.lastBenchmark = timing;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.secondStart = this.last;
    const loop = (now: number): void => {
      if (!this.running) return;
      this.sample(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Pause measurement across backgrounding so a suspended app is not a "dip". */
  pause(): void {
    this.stop();
    this.dipStart = null;
  }

  reset(): void {
    this.frames = [];
    this.secondSamples = [];
    this.longestDip = 0;
    this.dipStart = null;
    this.windowStart = performance.now();
    this.secondStart = this.windowStart;
    this.secondFrames = 0;
  }

  /** Records a startup phase once per page load. */
  mark(name: StartupMark): void {
    if (this.startupMarks[name] === undefined) this.startupMarks[name] = Math.round(performance.now());
  }

  markStartup(): void {
    if (this.startupMs === null) this.startupMs = Math.round(performance.now());
    this.mark("ready");
  }

  private sample(now: number): void {
    const dt = now - this.last;
    this.last = now;
    if (dt > 1000) {
      // Tab was hidden or the app was suspended.
      this.dipStart = null;
      this.secondStart = now;
      this.secondFrames = 0;
      return;
    }
    this.frames.push(dt);
    if (this.frames.length > 240) this.frames.shift();
    this.secondFrames += 1;
    if (now - this.secondStart >= 1000) {
      this.secondSamples.push((this.secondFrames * 1000) / (now - this.secondStart));
      if (this.secondSamples.length > 600) this.secondSamples.shift();
      this.secondStart = now;
      this.secondFrames = 0;
    }
    // Rolling FPS over roughly the last 250 ms.
    let span = 0;
    let count = 0;
    for (let i = this.frames.length - 1; i >= 0 && span < 250; i -= 1) {
      span += this.frames[i] ?? 0;
      count += 1;
    }
    const rolling = span > 0 ? (count * 1000) / span : 60;
    if (rolling < 50) {
      if (this.dipStart === null) this.dipStart = now - span;
      this.longestDip = Math.max(this.longestDip, now - this.dipStart);
    } else {
      this.dipStart = null;
    }
  }

  snapshot(): PerfSnapshot {
    const recent = this.frames.slice(-60);
    const sum = recent.reduce((a, b) => a + b, 0);
    const sorted = [...this.secondSamples].sort((a, b) => a - b);
    const median = sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
    const lastSecond = this.frames.length ? this.secondSamples[this.secondSamples.length - 1] ?? 0 : 0;
    return {
      fps: Math.round(lastSecond),
      frameMsAvg: recent.length ? sum / recent.length : 0,
      frameMsMax: recent.length ? Math.max(...recent) : 0,
      medianFps: Math.round(median * 10) / 10,
      longestDipMs: Math.round(this.longestDip),
      windowMs: Math.round(performance.now() - this.windowStart),
      startupMs: this.startupMs,
      startupMarks: { ...this.startupMarks },
      lastCatchUp: this.lastCatchUp,
      lastBenchmark: this.lastBenchmark,
    };
  }
}

export const perfMonitor = new PerfMonitor();
