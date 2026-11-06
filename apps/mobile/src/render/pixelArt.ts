
/**
 * Original placeholder pixel art for the spike, stored as character grids.
 * '.' is transparent; other characters map to PALETTE colours.
 * Textures are generated at runtime with nearest-neighbour sampling.
 */

export const PALETTE: Record<string, string> = {
  K: "#1a1822", // outline
  H: "#2b2331", // hair
  S: "#e8b88a", // skin
  s: "#b98460", // skin shade
  W: "#f2efe6", // headband / highlights
  w: "#b9b4a8",
  G: "#d8c7a0", // monk gi
  g: "#a18e70",
  B: "#8a3b22", // belt
  E: "#15131a", // eyes
  P: "#6246a8", // mage robe
  p: "#3c2b70",
  Y: "#e8b04a", // gold trim
  T: "#6b4a2e", // staff
  O: "#7fd4ff", // orb
  o: "#dff6ff",
  L: "#6cc24a", // slime
  l: "#3e8a33",
  h: "#c9f59c",
  R: "#80502f", // boar
  r: "#4f2e1b",
  M: "#3a2418",
  N: "#e0928a",
  U: "#f1ebdb",
  A: "#8d929c", // wolf
  a: "#5a5f6b",
  Z: "#c9cdd6",
  X: "#9fcf5a", // thorns
  D: "#5d4026", // bark
  d: "#382415",
  F: "#4f9a3a", // leaf
  f: "#2e6a29",
  Q: "#ffd25a", // glow
  q: "#ff8a3a",
  V: "#b04a3a", // red eye
  I: "#cdd3de", // steel
  i: "#7d8596",
  c: "#7a4a22", // grip
  J: "#56b8ec", // gem
  j: "#dff4ff",
  n: "#5a4b7a", // spider (Darkwood); light enough to read on the dark canopy
  m: "#352a4c",
  u: "#cbbde6", // pale carapace
  e: "#c4452d", // ember red (Ashen)
  k: "#6e2317",
  b: "#4b4652", // basalt
  z: "#2c2830",
  C: "#ff6a2a", // lava
};

export interface SpriteDef {
  rows: readonly string[];
  /** Pixel x of the feet / anchor, from the left. */
  anchorX: number;
}

export const SPRITES: Record<string, SpriteDef> = {
  monk: {
    anchorX: 7,
    rows: [
      "....KKKKK.......",
      "...KHHHHHK......",
      "..KWWWWWWWKWW...",
      "..KHSSSSSKW..W..",
      "..KSESSESK......",
      "...KSSSSK.......",
      "....KssK........",
      "..KKGGGGKKK.....",
      ".KSGGGGGGSSKK...",
      ".KSKGGGGKKSSSK..",
      ".KSKGgggK.KSSK..",
      "..K.KBBBK..KK...",
      "...KGGGGGK......",
      "...KGGgGGK......",
      "..KGGK.KGGK.....",
      "..KGgK.KgGK.....",
      "..KGGK..KGGK....",
      ".KKKKK..KKKKK...",
    ],
  },
  mage: {
    anchorX: 7,
    rows: [
      "......KK........",
      ".....KPPK.......",
      "....KPPPK.......",
      "...KPPpPPK....K.",
      "..KYYYYYYYK..KOK",
      "...KSSSSSK...KoK",
      "...KSESESK....T.",
      "....KSSSK....KT.",
      "...KPPYPPK..KST.",
      "..KPPPYPPPKKSKT.",
      "..KPpPYPpPPSK.T.",
      "..KPPPYPPPK...T.",
      "..KPpPYPpPK...T.",
      "..KPPPYPPPK...T.",
      ".KPPpPYPpPPK..T.",
      ".KPPPPYPPPPK..T.",
      ".KpPPpYpPPpK..T.",
      "..KKKKKKKKK...K.",
    ],
  },
  slime: {
    anchorX: 6,
    rows: [
      "....KKKK....",
      "..KKLLLLKK..",
      ".KLLhhLLLLK.",
      ".KLhLLLLLLK.",
      "KLLLEKLEKLLK",
      "KLLLEKLEKLLK",
      "KLLLLLLLLLLK",
      "KlLLLLLLLLlK",
      ".KllLLLLllK.",
      "..KKKKKKKK..",
    ],
  },
  boar: {
    anchorX: 10,
    rows: [
      "......KKKKKKKK......",
      "....KKMMMMMMMMKK....",
      "..KKMRRRRRRRRRMMK...",
      ".KURRRRRRRRRRRRRMK..",
      "KUKRVRRRRRRRRRRRRMK.",
      "KNNRRRRRRRRRRRRRRRK.",
      "KNNRRrRRRRRRRRRRRRK.",
      ".KKRRrrRRRRRRRRRRK..",
      "...KRRKKRRKKKKRRK...",
      "...KrrK.KrK..KrrK...",
      "...KKKK.KKK..KKKK...",
    ],
  },
  boar_elite: {
    anchorX: 11,
    rows: [
      "......X..X..X..X.......",
      "......KXKKXKKXKKXK.....",
      "....KKMMMMMMMMMMMMKK...",
      "..KKMRRRRRRRRRRRRRMMK..",
      ".KURRRRRRRRRRRRRRRRRMK.",
      "KUUKRVRRRRRRRRRRRRRRRMK",
      "KNNRRRRRRRRRRRRRRRRRRRK",
      "KNNRRrRRRRRRRRRRRRRRRRK",
      ".KKRRrrRRRRRRRRRRRRRRK.",
      "...KRRRKKRRRKKKKKRRRK..",
      "...KrrrK.KrrK...KrrrK..",
      "...KKKKK.KKKK...KKKKK..",
    ],
  },
  wolf: {
    anchorX: 9,
    rows: [
      ".KK.KK............",
      ".KAKAK............",
      ".KAAAAK...........",
      "KZVAAAAKKKKKKK..KK",
      "KZZAAAAAAAAAAAKKAK",
      ".KKZAAAAAAAAAAAAK.",
      "...KZAAAAAAAAAAAK.",
      "...KZZAaAAAAAaAK..",
      "...KAK.KAK.KAKAK..",
      "...KaK.KaK.KaKaK..",
      "...KKK.KKK.KKKKK..",
    ],
  },
  root_boss: {
    anchorX: 13,
    rows: [
      "..........FFFF............",
      "......FFFFfFFFFFF.........",
      "....FFfFFFFFFfFFFFF.......",
      "...FFFFFFfFFFFFFFfFF......",
      "..FfFFFFFFFFFFfFFFFFF.....",
      "..FFFFFfFFFFFFFFFFFfF.....",
      "...FFfFFFFKKKFFFFFFF......",
      ".....FFFKKDDDKKFFFF.......",
      ".......KDDDDDDDK..........",
      "......KDDdDDDdDDK.........",
      "......KDQQDDDQQDK.........",
      "......KDqQDdDqQDK.........",
      "......KDDDDDDDDDK.........",
      ".....KDDdKKKKKdDDK........",
      ".....KDDKdddddKDDK........",
      "....KDDDDKKKKKDDDDK.......",
      "...KDDdDDDDDDDDDdDDK......",
      "..KDDKDDDdDDDdDDDKDDK.....",
      ".KDDK.KDDDDDDDDDK.KDDK....",
      "KDDK..KDDdDDDdDDK..KDDK...",
      "KdK...KDDDDDDDDDK...KdK...",
      ".K...KDDDKKKKKDDDK...K....",
      "....KDDDK.....KDDDK.......",
      "...KDdDK.......KDdDK......",
      "..KKKKK.........KKKKK.....",
    ],
  },
  sprout: {
    anchorX: 5,
    rows: [
      "...FF.FF...",
      "..FfFKFfF..",
      "...FKKKF...",
      "....KFK....",
      "...KDDDK...",
      "..KDEDEDK..",
      "..KDDDDDK..",
      "...KDdDK...",
      "..KDK.KDK..",
      "..KK...KK..",
    ],
  },
  // C1 Darkwood and Ashen Mountains (PROVISIONAL placeholders).
  spider: {
    anchorX: 6,
    rows: [
      "......KKKKK...",
      "....KKnnnnnKK.",
      "..KKnnmnnunnnK",
      ".KnnKnnnnmnnnK",
      "KVnVKnnnnnnnK.",
      "KnnnKKnnnnnKK.",
      "KmK.KmKKKKmK..",
      "K.K.K..K..K.K.",
      "K..K...K...K..",
    ],
  },
  wisp: {
    anchorX: 5,
    rows: [
      "....o.....",
      "...oO.....",
      "..oOOo....",
      "..OOOOo...",
      ".oOOOOOo..",
      ".OjEOOEO..",
      ".OOOOOOOo.",
      ".oOOjOOOO.",
      "..OOOOOOo.",
      "...OoOOo..",
      "....O.oO..",
      ".....o..O.",
    ],
  },
  brute: {
    anchorX: 8,
    rows: [
      ".....FFfFF........",
      "...FFfFFFFfF......",
      "..KDDDDDDDDDK.....",
      ".KDQQDDDQQDDDK....",
      ".KDDDDDDDDDDDDK...",
      "KDDdKKKKKdDDDDK...",
      "KDDKUKUKUKDDDDDK..",
      "KDDDKKKKKDDDdDDDK.",
      ".KDdDDDDDDDDDDDDDK",
      "KDDKDDdDDDDdDDKDDK",
      "KDDKDDDDDDDDDDKDDK",
      "KdDKDDDdDDDDDDKdDK",
      ".KK.KDDDKKKDDDK.K.",
      "....KDDK...KDDK...",
      "...KDdDK...KDdDK..",
      "...KKKKK...KKKKK..",
    ],
  },
  warden: {
    anchorX: 9,
    rows: [
      "..X...X...X.......",
      "..KX.KXK.XK.......",
      "..KDDDDDDDK.......",
      ".KDDDDDDDDDK......",
      ".KDQQDDDQQDK......",
      ".KDDDDDDDDDK...X..",
      "..KDDdKKdDDK..KXK.",
      ".KKDDDDDDDKKK.KTK.",
      "KXDDKDDDDKDDXKKTK.",
      "KDDKDDXDDDKDDDKTK.",
      "KDDKDDDDDXKDDKKTK.",
      "KDXKDXDDDDKXDK.TK.",
      ".KK.KDDDDDK.KK.TK.",
      "....KDDDDDK....TK.",
      "...KDDKKKDDK...T..",
      "...KDdK.KDdK...T..",
      "..KDDDK.KDDDK..K..",
      "..KKKKK.KKKKK.....",
    ],
  },
  matron: {
    anchorX: 14,
    rows: [
      "..........KKKKKK............",
      "........KKuuuuuuKK..........",
      ".......KuuKuuuuKuuK.........",
      ".......KuVVuuuuVVuK.........",
      ".......KuuuuuuuuuuK.........",
      "........KuuKKKKuuK..........",
      ".........KKnnnnKK...........",
      ".......KKnnnnnnnnKKKKK......",
      ".....KKnnmnnnnnnnnnnnnKK....",
      "....KnnnnnnnnmnnnnnnunnnK...",
      "...KnnunnnnnnnnnnnnnnnnnnK..",
      "..KnnnnnnnmnnnnnunnnnnmnnnK.",
      "..KnnmnnnnnnnnnnnnnnnnnnnnK.",
      "..KnnnnnnunnnnnmnnnnnnunnnK.",
      "...KnnnnnnnnnnnnnnnnnnnnnK..",
      "....KKnnnnmnnnnnnnnmnnKK....",
      "...KmKKKnnnnnnnnnnnnKKKmK...",
      "..KmK.KmKKKKKKKKKKKKmK.KmK..",
      ".KmK.KmK..KmK..KmK..KmK.KmK.",
      "KmK..KmK..KmK..KmK..KmK..KmK",
      "KK..KmK...KmK..KmK...KmK..KK",
      "....KK....KK....KK....KK....",
    ],
  },
  imp: {
    anchorX: 6,
    rows: [
      ".U....U.....",
      ".KU..UK.....",
      "..KeeK......",
      ".KeeeeK.....",
      ".KQeQeK..K..",
      ".KeeeeK.KeK.",
      "..KkkK..KeK.",
      ".KeeeeKKeK..",
      "KeKeekeKK...",
      "KK.Keek.....",
      "...KeeK.....",
      "..KeKKeK....",
      "..KK..KK....",
    ],
  },
  hound: {
    anchorX: 8,
    rows: [
      "..KK.KK.............",
      "..KaKKaK............",
      ".KAAAAAK..q.q.q.....",
      "KQAAAAAAKqKqKqK.....",
      "KZAAAAAAAAAAAAAKK.KK",
      ".KKZAAAAAAAAAAAAKKqK",
      "...KZAaAAAAAAAaAAK..",
      "...KZZAAAAAAAAAAAK..",
      "...KAAKKAKKKKAAKAK..",
      "...KaK.KaK..KaK.KaK.",
      "...KKK.KKK..KKK.KKK.",
    ],
  },
  golem: {
    anchorX: 10,
    rows: [
      ".....KKKKKKK........",
      "....KbbbbbbbK.......",
      "...KbzbbbbbzbK......",
      "...KbQbbbbbQbK......",
      "...KbbbzCzbbbK......",
      "..KKKbbbbbbbKKKK....",
      ".KbbbKbbzbbKbbbbK...",
      "KbbzbbbbCbbbbbzbbK..",
      "KbbKbbzbbbbbbKbbbK..",
      "KbzKbbbbCCbbbKbzbK..",
      "KbbKbbbbbbbzbKbbbK..",
      ".KK.KbbzbbbbbK.KK...",
      "....KbbbKKbbbK......",
      "...KbbzK..KbzbK.....",
      "...KbbbK..KbbbK.....",
      "..KKKKKK..KKKKKK....",
    ],
  },
  warlord: {
    anchorX: 9,
    rows: [
      "...U.....U........",
      "...KUKKKUK........",
      "...KIIIIIK........",
      "...KiEIEiK........",
      "...KIIIIIK........",
      "..KkKIIIKkK.......",
      ".KkeIIiIIIekK..I..",
      "KkeKIIIIIIKekK.I..",
      "KkeKIiIIiIKeekKIK.",
      "KkeKIIIIIIKeekKSK.",
      "KkeKKBBBBKKeek.K..",
      "Kke.KIIIIK.Keek...",
      "KkK.KIiiIK..KeK...",
      "KK.KIIK.KIIK.KK...",
      "...KiIK.KIiK......",
      "..KKKKK.KKKKK.....",
    ],
  },
  drake: {
    anchorX: 15,
    rows: [
      "..U.U...........................",
      ".KeKeK..........................",
      "KeeeeeK.........KK..............",
      "KQeeeeeK......KKkkK.............",
      "KeeeeeeeK....KkkkkkK............",
      ".KCKKeeeeK..KkkkkkkkK...........",
      "..KK.KeeeeKKkkkkkkkkkK..........",
      ".......KeeeeKkkkkkkkkkK.........",
      "........KeeeeeeeeeeKkkK.........",
      ".......KeeeeeeeeeeeeeKK.........",
      "......KeeQQQQQeeeeeeeeeK........",
      "......KeQQQQQQQeeeeeeeeeKKK.....",
      "......KeeQQQQQeeeeeeeeeeeeeKK...",
      ".......KeeeeeeeeeeeeeeKKeeeeeKK.",
      "........KKeeeKKKKeeeK..KKKeeeeeK",
      "........KeeK.....KeeK.....KKKeK.",
      ".......KkeK.....KkeK.........KK.",
      ".......KKKK.....KKKK............",
    ],
  },
  // Future classes (shown only as silhouettes in class previews).
  warrior: {
    anchorX: 7,
    rows: [
      "....KKKKK.......",
      "...KwwwwwK......",
      "...KwKKKwK......",
      "...KwwwwwK......",
      "..KKwwwwwKK..K..",
      ".KwwVwwwVwwKKwK.",
      ".KwwwwwwwwwKKwK.",
      ".KwKwwwwwKwKKwK.",
      ".KwKwwwwwKwK.K..",
      "..K.KBBBK.K.....",
      "...KwwwwwK......",
      "..KwwK.KwwK.....",
      "..KwwK.KwwK.....",
      ".KKKKK.KKKKK....",
    ],
  },
  ranger: {
    anchorX: 7,
    rows: [
      "....KKKK........",
      "...KFFFFK.......",
      "..KFFfFFFK..K...",
      "..KFSSSSFK.KTK..",
      "..KFSESEFK.KTK..",
      "...KSSSSK..KTK..",
      "..KFFFFFFK.KTK..",
      ".KFFfFFfFFKKTK..",
      ".KSKFFFFKSKKTK..",
      "...KFBBFK...K...",
      "...KFFFFK.......",
      "..KFFK.KFFK.....",
      "..KDDK.KDDK.....",
      ".KKKKK.KKKKK....",
    ],
  },
};

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // Small, CPU-backed canvases: toDataURL() and texture uploads then need no GPU
  // readback, which was the main cost of showing new item icons on slow phones.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

export function validateSprite(name: string, def: SpriteDef): void {
  const width = def.rows[0]?.length ?? 0;
  def.rows.forEach((row, i) => {
    if (row.length !== width) throw new Error(`Sprite ${name} row ${i} has width ${row.length}, expected ${width}`);
    for (const ch of row) if (ch !== "." && !PALETTE[ch]) throw new Error(`Sprite ${name}: unknown colour ${ch}`);
  });
}

/** Draw a sprite grid to a canvas. `solid` paints every opaque pixel one colour (hit flash / silhouettes). */
export function spriteCanvas(def: SpriteDef, solid?: string): HTMLCanvasElement {
  const height = def.rows.length;
  const width = def.rows[0]?.length ?? 0;
  const [canvas, ctx] = makeCanvas(width, height);
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x] ?? ".";
      if (ch === ".") continue;
      ctx.fillStyle = solid ?? PALETTE[ch] ?? "#ff00ff";
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

/** Data URL of a sprite, scaled up with hard pixels (for React portraits). */
export function spriteDataUrl(name: string, scale: number): string {
  const def = SPRITES[name];
  if (!def) return "";
  const small = spriteCanvas(def);
  const [canvas, ctx] = makeCanvas(small.width * scale, small.height * scale);
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL();
}

// ---------------------------------------------------------------------------
// 3x5 pixel font for combat numbers (with a 1px outline).
// ---------------------------------------------------------------------------

export const GLYPHS: Record<string, string[]> = {
  "◇": ["111", "101", "101", "111", "010"],
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
  "!": ["010", "010", "010", "000", "010"],
  "/": ["001", "001", "010", "100", "100"],
};

/** One 3x5 glyph with a 1px dark outline, on a 5x7 canvas. */
export function glyphCanvas(ch: string, color: string): HTMLCanvasElement {
  const glyph = GLYPHS[ch] ?? GLYPHS["0"]!;
  const [canvas, ctx] = makeCanvas(5, 7);
  const plot = (dx: number, dy: number, fill: string) => {
    ctx.fillStyle = fill;
    glyph.forEach((row, y) => {
      for (let x = 0; x < 3; x += 1) if (row[x] === "1") ctx.fillRect(1 + x + dx, 1 + y + dy, 1, 1);
    });
  };
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] as const) plot(dx, dy, "#120f16");
  plot(0, 0, color);
  return canvas;
}
