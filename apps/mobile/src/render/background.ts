import { Texture } from "pixi.js";

/**
 * Procedural pixel-art background (presentation only), drawn at the scene's
 * logical resolution so it scales with hard pixels.
 */

interface Theme {
  sky: string[];
  moon: string;
  far: string;
  mid: string;
  ruins: string;
  trees: string;
  treesDark: string;
  grass: string;
  grassDark: string;
  dirt: string;
  dirtDark: string;
  flowers: string[];
  /** Tree line height multiplier (Darkwood: tall, dense canopy). */
  treeScale?: number;
  /** Tree spacing multiplier (< 1 = denser). */
  treeGap?: number;
  stars?: boolean;
  showRuins?: boolean;
  /** Pointed rock spires instead of trees (Ashen). */
  spires?: boolean;
  /** Glowing cracks in the ground and drifting embers in the sky. */
  lava?: string;
  embers?: string[];
}

const THEMES: Record<string, Theme> = {
  greenfields: {
    sky: ["#10182a", "#152037", "#1b2a45", "#223556", "#2b4262"],
    moon: "#e9dca8",
    far: "#27324a",
    mid: "#2c3f3c",
    ruins: "#1f2a33",
    trees: "#24412f",
    treesDark: "#1a3024",
    grass: "#4f7d3a",
    grassDark: "#3a602c",
    dirt: "#3b2f25",
    dirtDark: "#2b221b",
    flowers: ["#e8c65a", "#d9e6f2", "#e39ab0"],
    stars: true,
    showRuins: true,
  },
  // PROVISIONAL C1 themes.
  darkwood: {
    sky: ["#0b0f17", "#0f1520", "#131b27", "#17202c", "#1b2531"],
    moon: "#9fb3a8",
    far: "#161f25",
    mid: "#18251f",
    ruins: "#121a17",
    trees: "#1b3326",
    treesDark: "#12241b",
    grass: "#2f4d2c",
    grassDark: "#223a22",
    dirt: "#2a241f",
    dirtDark: "#1d1916",
    flowers: ["#9b7fe0", "#7fd4c8", "#c9f59c"],
    treeScale: 2.4,
    treeGap: 0.7,
    stars: false,
    showRuins: false,
  },
  ashen: {
    sky: ["#1a0d0e", "#2a1210", "#3b1a12", "#522516", "#6b3318"],
    moon: "#ff9a4a",
    far: "#2a1a1a",
    mid: "#231818",
    ruins: "#1a1214",
    trees: "#2c2830",
    treesDark: "#1f1c23",
    grass: "#5a5058",
    grassDark: "#433c44",
    dirt: "#2d2830",
    dirtDark: "#1f1b22",
    flowers: ["#ff6a2a", "#ffd25a"],
    stars: false,
    showRuins: false,
    spires: true,
    lava: "#ff6a2a",
    embers: ["#ff9a4a", "#ffd25a", "#ff6a2a"],
  },
};

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function groundY(height: number): number {
  return height - Math.max(18, Math.round(height * 0.2));
}

export function drawBackground(themeId: string, width: number, height: number): Texture {
  const theme = THEMES[themeId] ?? THEMES.greenfields!;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const rand = lcg(width * 7919 + height);
  const ground = groundY(height);

  // Sky bands with a 1px dither between bands.
  const band = Math.ceil(ground / theme.sky.length);
  theme.sky.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, i * band, width, band);
    if (i > 0) {
      ctx.fillStyle = theme.sky[i - 1]!;
      for (let x = i % 2; x < width; x += 2) ctx.fillRect(x, i * band, 1, 1);
    }
  });
  if (theme.stars !== false) {
    ctx.fillStyle = "#c9d4ee";
    for (let i = 0; i < width / 6; i += 1) {
      const x = Math.floor(rand() * width);
      const y = Math.floor(rand() * ground * 0.45);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (theme.embers) {
    for (let i = 0; i < width / 5; i += 1) {
      ctx.fillStyle = theme.embers[Math.floor(rand() * theme.embers.length)]!;
      ctx.fillRect(Math.floor(rand() * width), Math.floor(rand() * ground * 0.8), 1, 1);
    }
  }
  // Moon
  const mx = Math.round(width * 0.62);
  const my = Math.round(ground * 0.24);
  ctx.fillStyle = theme.moon;
  for (let y = -4; y <= 4; y += 1) {
    const span = Math.round(Math.sqrt(16 - y * y + 2));
    ctx.fillRect(mx - span, my + y, span * 2 + 1, 1);
  }
  ctx.fillStyle = "#cfc190";
  ctx.fillRect(mx + 1, my - 1, 2, 1);
  ctx.fillRect(mx - 2, my + 2, 1, 1);

  // Far mountains (stepped ridge)
  const ridge = (color: string, base: number, amp: number, step: number, phase: number) => {
    ctx.fillStyle = color;
    for (let x = 0; x < width; x += 1) {
      const h =
        amp * (0.55 + 0.45 * Math.sin((x + phase) / step)) + amp * 0.35 * Math.sin((x + phase * 3) / (step * 0.37));
      const top = Math.round(base - Math.max(0, h));
      ctx.fillRect(x, top, 1, ground - top);
    }
  };
  ridge(theme.far, ground - 12, ground * 0.32, 23, 11);
  if (theme.lava) {
    // Glow along the far ridge line.
    ctx.fillStyle = theme.lava;
    for (let x = 0; x < width; x += 3 + Math.floor(rand() * 6)) ctx.fillRect(x, ground - 13 - Math.floor(rand() * 3), 1, 1);
  }
  ridge(theme.mid, ground - 4, ground * 0.18, 13, 57);

  if (theme.showRuins !== false) {
    // Ruined arches on the right
    ctx.fillStyle = theme.ruins;
    const rx = Math.round(width * 0.78);
    const rh = Math.round(ground * 0.42);
    for (let k = 0; k < 3; k += 1) {
      const px = rx + k * 9;
      const ph = rh - k * 4;
      ctx.fillRect(px, ground - ph, 4, ph);
    }
    ctx.fillRect(rx, ground - rh, 22, 3);
    ctx.fillStyle = theme.sky[2]!;
    ctx.fillRect(rx + 5, ground - rh + 5, 3, 6);
    ctx.fillRect(rx + 14, ground - rh + 8, 3, 6);
  }

  // Tree line (or rock spires)
  const treeScale = theme.treeScale ?? 1;
  const gap = theme.treeGap ?? 1;
  for (let x = -4; x < width; x += Math.max(2, Math.round((5 + Math.floor(rand() * 4)) * gap))) {
    const h = Math.round((6 + Math.floor(rand() * 9)) * treeScale);
    const base = ground - 1;
    ctx.fillStyle = rand() > 0.5 ? theme.trees : theme.treesDark;
    for (let y = 0; y < h; y += 1) {
      const half = theme.spires ? Math.floor(((y + 1) * 3) / h) : Math.floor((y + 2) / 2.5);
      ctx.fillRect(x + 3 - half, base - h + y, half * 2 + 1, 1);
    }
  }

  // Ground
  ctx.fillStyle = theme.grass;
  ctx.fillRect(0, ground, width, 3);
  ctx.fillStyle = theme.grassDark;
  ctx.fillRect(0, ground + 3, width, 2);
  ctx.fillStyle = theme.dirt;
  ctx.fillRect(0, ground + 5, width, height - ground - 5);
  ctx.fillStyle = theme.dirtDark;
  for (let i = 0; i < width / 2; i += 1) {
    ctx.fillRect(Math.floor(rand() * width), ground + 6 + Math.floor(rand() * (height - ground - 6)), 2, 1);
  }
  if (theme.lava) {
    // Glowing cracks in the ash.
    ctx.fillStyle = theme.lava;
    for (let i = 0; i < width / 12; i += 1) {
      let cx = Math.floor(rand() * width);
      let cy = ground + 6 + Math.floor(rand() * Math.max(1, height - ground - 8));
      for (let k = 0; k < 4; k += 1) {
        ctx.fillRect(cx, cy, 2, 1);
        cx += 2;
        cy += rand() > 0.5 ? 1 : -1;
      }
    }
  }
  // Grass tufts and flowers
  for (let x = 0; x < width; x += 2 + Math.floor(rand() * 5)) {
    ctx.fillStyle = rand() > 0.5 ? theme.grass : theme.grassDark;
    ctx.fillRect(x, ground - 1, 1, 1);
    if (rand() > 0.6) ctx.fillRect(x + 1, ground - 2, 1, 2);
    if (rand() > 0.9) {
      ctx.fillStyle = theme.flowers[Math.floor(rand() * theme.flowers.length)]!;
      ctx.fillRect(x, ground - 3, 1, 1);
    }
  }
  return Texture.from({ resource: canvas, scaleMode: "nearest" });
}
