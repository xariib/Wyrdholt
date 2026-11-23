// Exercise the actual update sheet and browser save with a disposable native bridge.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, expect } from "playwright/test";
import { createServer } from "vite";

const bridgePath = "virtual:wyrdholt-update-qa";
const bridgeId = "\0" + bridgePath;
const bridge = `
const state = { currentVersion: "0.9.0", supported: true, published: true, available: false, ready: false };
const calls = [];
let progress, download;
export const hasAppUpdater = () => true;
export const AppUpdater = {
  async addListener(_name, handler) { progress = handler; return { remove: async () => {} }; },
  async getState() { return { ...state }; },
  async check() {
    calls.push("check");
    if (calls.length === 1) throw new Error("Temporary network failure");
    Object.assign(state, { available: true, version: "0.9.1", bytes: 26_000_000 });
    return { ...state };
  },
  download() {
    calls.push("download");
    progress?.({ received: 3, total: 0 });
    return new Promise((resolve, reject) => { download = { resolve, reject }; });
  },
  async cancel() {
    calls.push("cancel");
    download.reject(new Error("Download cancelled."));
  },
  async install() {
    calls.push("install");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("Disc", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await new Promise((resolve, reject) => {
      const request = db.transaction("FileStorage").objectStore("FileStorage").get("/DATA/saves/profile.json");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (JSON.parse(JSON.parse(saved.content).payload).character.name !== "UpdaterBrowser") throw new Error("Missing fixture save");
    calls.push("save verified");
    if (calls.filter(call => call === "install").length === 1) throw new Error("Android permission was declined.");
    Object.assign(state, { currentVersion: "0.9.1", available: false, ready: false });
  },
};
window.updateQa = {
  calls,
  finishDownload() {
    Object.assign(state, { ready: true });
    progress?.({ received: state.bytes, total: state.bytes });
    download.resolve({ ...state });
  },
};
`;

const server = await createServer({
  root: resolve("apps/mobile"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{
    name: "disposable-update-bridge",
    enforce: "pre",
    resolveId(id) { if (id === bridgePath) return bridgeId; },
    load(id) { if (id === bridgeId) return bridge; },
    transform(code, id) {
      if (!id.endsWith("/ui/screens/AppUpdates.tsx")) return;
      return code.replace('from "../../platform/appUpdater"', `from "${bridgePath}"`);
    },
  }],
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole("textbox", { name: "Character name" }).fill("UpdaterBrowser");
  await page.getByRole("button", { name: "Begin in Greenfields", exact: true }).click();
  await page.getByRole("navigation", { name: "Game navigation" }).getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: /^App updates/ }).click();
  const sheet = page.getByRole("dialog", { name: "App updates" });
  await expect(sheet).toContainText("Installed version 0.9.0");
  await sheet.getByRole("button", { name: "Check for updates" }).click();

  const download = sheet.getByRole("button", { name: /^Download update/ });
  await expect(download).toBeVisible();
  await download.click();
  await expect(sheet.getByRole("progressbar")).toHaveAttribute("value", "0");
  await sheet.getByRole("button", { name: "Cancel download" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Download cancelled.");
  await download.click();
  await expect(sheet.getByRole("progressbar")).toBeVisible();
  await page.evaluate(() => window.updateQa.finishDownload());

  const install = sheet.getByRole("button", { name: "Install update" });
  await install.click();
  await expect(sheet.getByRole("alert")).toHaveText("Android permission was declined.");
  await install.click();
  await expect(sheet).toContainText("Installed version 0.9.1");
  const calls = await page.evaluate(() => window.updateQa.calls);
  assert.deepEqual(calls, ["check", "check", "download", "cancel", "download", "install", "save verified", "install", "save verified"]);
  assert.deepEqual(errors, []);
  console.log("PASS: failed check, retry, canceled download, verified re-download, installer refusal and retry with a durable save.");
} finally {
  await browser?.close();
  await server.close();
}
