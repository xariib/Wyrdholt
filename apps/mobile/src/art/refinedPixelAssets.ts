import type { HeroClass } from "./gearSkins";
import { REFINED_CLASSES, REFINED_LINEUP, refinedGearFamilies, refinedGearSource } from "./refinedPixelSources";
export interface PixelRaster {
    canvas: HTMLCanvasElement;
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
}
export const refinedBodies = new Map<HeroClass, PixelRaster>();
export const refinedStrikes = new Map<HeroClass, PixelRaster>();
export const refinedItems = new Map<string, PixelRaster>();
const requests = new Map<string, Promise<void>>();
const sourceBytes = new Map<string, number>();
export function raster(width: number, height: number): PixelRaster {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, width, height, rgba: new Uint8ClampedArray(width * height * 4) };
}
export function pixelsOf(canvas: HTMLCanvasElement): PixelRaster {
    return { canvas, width: canvas.width, height: canvas.height,
        rgba: canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data };
}
export function refinedReady(cls: HeroClass): boolean {
    return refinedBodies.has(cls) && refinedStrikes.has(cls) && refinedGearFamilies(cls).every(f => refinedItems.has(`${cls}/${f}`));
}
export function refinedDecodedBytes(): number {
    return [...sourceBytes.values()].reduce((n, b) => n + b, 0)
        + [...refinedBodies.values(), ...refinedStrikes.values(), ...refinedItems.values()].reduce((n, p) => n + p.width * p.height * 8, 0);
}
function crop(source: HTMLCanvasElement, col: number, row: number, columns: number, rows: number, padding = 0): PixelRaster {
    const x0 = Math.max(0, Math.floor(col * source.width / columns) - padding), y0 = Math.floor(row * source.height / rows);
    const width = Math.min(source.width, Math.floor((col + 1) * source.width / columns) + padding) - x0, height = Math.floor((row + 1) * source.height / rows) - y0;
    const data = source.getContext("2d", { willReadFrequently: true })!.getImageData(x0, y0, width, height);
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            if (data.data[(y * width + x) * 4 + 3]! < 180)
                continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    if (right < left)
        throw new Error(`Empty refined pixel cell ${col},${row}`);
    const c = raster(right - left + 1, bottom - top + 1);
    c.canvas.getContext("2d")!.putImageData(data, -left, -top);
    return pixelsOf(c.canvas);
}
/** Rasterize imported artwork onto the game's native grid; transparent space stays empty. */
function native(source: PixelRaster, width: number, height: number, keepLargest = false): PixelRaster {
    const result = raster(width, height), ctx = result.canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source.canvas, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height), data = image.data;
    for (let i = 3; i < data.length; i += 4)
        data[i] = data[i]! >= 180 ? 255 : 0;
    // Source extraction can leave isolated subpixel fringe. Keep the connected artwork.
    const visited = new Uint8Array(width * height), components: number[][] = [];
    for (let i = 0; i < visited.length; i++) {
        if (visited[i] || !data[i * 4 + 3])
            continue;
        const queue = [i];
        visited[i] = 1;
        for (let n = 0; n < queue.length; n++) {
            const at = queue[n]!, x = at % width, y = Math.floor(at / width);
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx, yy = y + dy, next = yy * width + xx;
                    if (xx < 0 || yy < 0 || xx >= width || yy >= height || visited[next] || !data[next * 4 + 3])
                        continue;
                    visited[next] = 1;
                    queue.push(next);
                }
        }
        components.push(queue);
    }
    const largest = Math.max(0, ...components.map(c => c.length));
    for (const component of components)
        if (component.length < (keepLargest ? largest : Math.max(2, largest * 0.015)))
            for (const at of component)
                data[at * 4 + 3] = 0;
    ctx.putImageData(image, 0, 0);
    return pixelsOf(result.canvas);
}
async function load(key: string, source: {
    file: string;
    width: number;
    height: number;
}, publish: (canvas: HTMLCanvasElement) => void): Promise<void> {
    const existing = requests.get(key);
    if (existing)
        return existing;
    const promise = new Promise<void>((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => finish(new Error(`Refined pixel art timeout: ${key}`)), 10000);
        function finish(error?: Error) {
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            image.src = "";
            sourceBytes.delete(key);
            if (error) {
                requests.delete(key);
                reject(error);
            }
            else
                resolve();
        }
        image.onload = () => {
            try {
                if (image.naturalWidth !== source.width || image.naturalHeight !== source.height)
                    throw new Error(`Invalid refined pixel atlas: ${key}`);
                sourceBytes.set(key, source.width * source.height * 4);
                const c = raster(source.width, source.height);
                c.canvas.getContext("2d")!.drawImage(image, 0, 0);
                publish(c.canvas);
                finish();
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        };
        image.onerror = () => finish(new Error(`Refined pixel art unavailable: ${key}`));
        image.src = `${import.meta.env.BASE_URL}${source.file}`;
    });
    requests.set(key, promise);
    return promise;
}
export async function loadRefinedHero(cls: HeroClass): Promise<void> {
    await Promise.all([
        load("lineup", REFINED_LINEUP, source => {
            for (let pose = 0; pose < 2; pose++) {
                const prepared = REFINED_CLASSES.map((name, col) => {
                    const cell = crop(source, col, pose, 4, 2, pose ? 16 : 0), height = [96, 100, 104, 98][col]!;
                    const body = native(cell, Math.round(cell.width * height / cell.height), height, true);
                    let footLeft = body.width, footRight = 0;
                    for (let y = height - 6; y < height; y++)
                        for (let x = 0; x < body.width; x++)
                            if (body.rgba[(y * body.width + x) * 4 + 3]) {
                                footLeft = Math.min(footLeft, x);
                                footRight = Math.max(footRight, x);
                            }
                    const c = raster(128, 128);
                    c.canvas.getContext("2d")!.drawImage(body.canvas, 64 - Math.round((footLeft + footRight) / 2), 120 - height);
                    return [name, pixelsOf(c.canvas)] as const;
                });
                for (const [name, body] of prepared)
                    (pose ? refinedStrikes : refinedBodies).set(name, body);
            }
        }),
        load(cls, refinedGearSource(cls), source => {
            const prepared = refinedGearFamilies(cls).map((family, index) => {
                const cell = crop(source, index % 8, Math.floor(index / 8), 8, 4);
                const scale = 60 / Math.max(cell.width, cell.height);
                return [`${cls}/${family}`, native(cell, Math.max(1, Math.round(cell.width * scale)), Math.max(1, Math.round(cell.height * scale)))] as const;
            });
            for (const [key, item] of prepared)
                refinedItems.set(key, item);
        }),
    ]);
}
