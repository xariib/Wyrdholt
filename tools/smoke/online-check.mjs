import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";
import { SqliteAuthorityStore } from "../../apps/server/src/authority/sqlite.ts";
import { createAuthorityHttp } from "../../apps/server/src/http.ts";
import { loadLiveConfig } from "../../apps/server/src/live/config.ts";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist");
const web = await preview({ root: resolve("apps/mobile"), configFile: false, build: { outDir: dist }, preview: { host: "127.0.0.1", port: 0 } });
const appOrigin = `http://127.0.0.1:${web.httpServer.address().port}`;
const store = new SqliteAuthorityStore(":memory:");
const config = loadLiveConfig();
const season = [...config.content.seasons.values()][0];
const api = createAuthorityHttp(store, config, { origins: [appOrigin], allowRegistration: true, now: () => season.startMs + 600_000 });
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${api.address().port}`;
let browser;

async function call(path, payload, token) {
  const response = await fetch(`${origin}/v1/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  assert(response.ok && data.ok, data.error);
  return data;
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(appOrigin);
  await page.getByRole("button", { name: "Open online adventure" }).tap();
  await page.getByLabel("Server origin").fill(origin);
  await page.getByLabel("Character name").fill("Online QA");
  await page.getByRole("button", { name: "Create online character", exact: true }).tap();
  await page.getByRole("heading", { name: "Online QA", exact: true }).waitFor();
  const key = await page.getByRole("textbox", { name: "New account key", exact: true }).inputValue();
  const profileId = await page.getByLabel("Character code", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Hide account key" }).tap();
  await page.getByRole("button", { name: "Push", exact: true }).tap();
  await page.getByText("push · Greenfields · Stage 1", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Disconnect online account" }).tap();

  // Controlled late-game fixtures through the test store. Browser actions use normal APIs.
  const allies = await Promise.all(["warrior", "ranger"].map(activeClassId => call("register", { name: `QA ${activeClassId}`, activeClassId, alternateClassId: "mage" })));
  for (const token of [key, ...allies.map(ally => ally.token)]) {
    const id = store.authenticate(createHash("sha256").update(token).digest("hex"));
    const row = await store.read(id);
    row.profile.character.level = 30;
    row.profile.character.xp = config.content.levelTotals[29];
    Object.assign(row.profile.adventure.zones.greenfields, { unlocked: true, cleared: true, bestStage: 10, completions: 1 });
    assert(await store.commit(row.revision, { ...row, revision: row.revision + 1 }));
  }
  for (const ally of allies) {
    await call("borrowing", { enabled: true }, ally.token);
    await call("friends", { profileId, add: true }, ally.token);
  }

  await page.getByLabel("Account key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Connect", exact: true }).tap();
  await page.getByRole("heading", { name: "Online QA", exact: true }).waitFor();
  for (const ally of allies) await page.getByRole("button", { name: `Accept ${ally.profileId.slice(0, 8)}…` }).tap();
  await page.getByLabel("Companion 1").selectOption(allies[0].profileId);
  await page.getByLabel("Companion 2").selectOption(allies[1].profileId);
  await page.getByRole("button", { name: "Enter Briar Vault" }).tap();
  await page.getByText("Dungeon cleared · 3 waves won", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Online character" }).getByText(/75 Gold/).waitFor();
  await page.getByLabel("Guild name").fill("QA Expedition");
  await page.getByRole("button", { name: "Create guild", exact: true }).tap();
  await page.getByRole("heading", { name: "QA Expedition", exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Build Expedition Table · 60 marks" }).isDisabled());
  assert.deepEqual(errors, []);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log("PASS mobile Chromium online registration, reconnect, Push, friend borrowing, dungeon rewards, guild creation and project gate");
} finally {
  await browser?.close();
  await new Promise(resolve => api.close(resolve));
  await web.close();
  store.close();
}
