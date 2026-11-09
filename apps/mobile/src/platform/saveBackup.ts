import { Capacitor, registerPlugin } from "@capacitor/core";

const SaveBackup = registerPlugin<{
  exportFile(input: { filename: string; text: string }): Promise<{ saved: boolean; downloads?: boolean }>;
}>("SaveBackup");

export async function exportBackupFile(text: string): Promise<"saved" | "cancelled" | "downloaded" | "downloads-folder"> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `Wyrdholt-Backup-${date}.json`;
  if (Capacitor.isPluginAvailable("SaveBackup")) {
    const { saved, downloads } = await SaveBackup.exportFile({ filename, text });
    return saved ? (downloads ? "downloads-folder" : "saved") : "cancelled";
  }
  const file = new File([text], filename, { type: "application/json" });
  if (Capacitor.isNativePlatform() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return "cancelled"; throw error; }
    return "saved";
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return "downloaded";
}
