import { ART_BUDGET, type ArtAsset } from "./types";

/** Scene-scoped ownership. Closing a scene cancels requests and releases references. */
export class ArtScope {
  private disposed = false;
  private bytes = 0;
  private images = new Map<string, Promise<HTMLImageElement>>();
  private pending = new Set<() => void>();
  get decodedBytes(): number { return this.bytes; }
  load(a: ArtAsset): Promise<HTMLImageElement> {
    const cached = this.images.get(a.file);
    if (cached) return cached;
    const size = a.atlasWidth * a.atlasHeight * 4;
    if (this.disposed || this.bytes + size > ART_BUDGET.maxDecodedBytes) return Promise.reject(new Error("Art scope closed or memory budget exceeded"));
    this.bytes += size;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const finish = (error?: string) => {
        clearTimeout(timer);
        this.pending.delete(cancel);
        image.onload = image.onerror = null;
        if (error) { image.src = ""; reject(new Error(error)); }
        else resolve(image);
      };
      const cancel = () => finish("Art scope disposed");
      const timer = setTimeout(() => finish("Art load timeout"), 10000);
      this.pending.add(cancel);
      image.onload = () => finish(image.naturalWidth !== a.atlasWidth || image.naturalHeight !== a.atlasHeight ? "Art dimensions differ from manifest" : undefined);
      image.onerror = () => finish(`Missing art: ${a.id}`);
      image.src = `${import.meta.env.BASE_URL}${a.file}`;
    });
    this.images.set(a.file, promise);
    return promise;
  }
  dispose(): void {
    this.disposed = true;
    for (const cancel of this.pending) cancel();
    this.pending.clear();
    this.images.clear();
    this.bytes = 0;
  }
}

/** One full silhouette per frame: helmets/weapons must be present in every pose. */
export function frameCanvas(a: ArtAsset, image: CanvasImageSource, index: number, white = false): HTMLCanvasElement {
  const f = a.frames[index]!;
  const canvas = document.createElement("canvas");
  canvas.width = a.width;
  canvas.height = a.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, f.x, f.y, a.width, a.height, 0, 0, a.width, a.height);
  if (white) {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, a.width, a.height);
  }
  return canvas;
}
