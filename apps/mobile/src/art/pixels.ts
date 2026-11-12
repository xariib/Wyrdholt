export type PixelPoint = readonly [
    number,
    number
];
/** Map joints first, then rasterize on the integer pixel grid, including rotated cuffs. */
export class Pixels {
    constructor(readonly ctx: CanvasRenderingContext2D, readonly map: (x: number, y: number) => PixelPoint = (x, y) => [x, y]) { }
    rect(color: string, x: number, y: number, w: number, h: number) {
        if (w > 0 && h > 0)
            this.poly(color, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    }
    poly(color: string, points: readonly PixelPoint[]) {
        const ps = points.map(p => this.map(...p));
        const low = Math.floor(Math.min(...ps.map(p => p[1]))), high = Math.ceil(Math.max(...ps.map(p => p[1])));
        this.ctx.fillStyle = color;
        for (let y = low; y < high; y++) {
            const hits: number[] = [];
            ps.forEach((a, i) => {
                const b = ps[(i + 1) % ps.length]!;
                if ((a[1] <= y + .5 && b[1] > y + .5) || (b[1] <= y + .5 && a[1] > y + .5))
                    hits.push(a[0] + (y + .5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
            });
            hits.sort((a, b) => a - b);
            for (let i = 0; i + 1 < hits.length; i += 2) {
                const x = Math.ceil(hits[i]! - .5), end = Math.ceil(hits[i + 1]! - .5);
                if (end > x)
                    this.ctx.fillRect(x, y, end - x, 1);
            }
        }
    }
    line(color: string, a: PixelPoint, b: PixelPoint, width = 1) {
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            this.rect(color, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, width, width);
        }
    }
}
