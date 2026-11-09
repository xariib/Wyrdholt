import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteAuthorityStore } from "./authority/sqlite";
import { createAuthorityHttp } from "./http";
import { loadLiveConfig } from "./live/config";

const port = Number(process.env.WYRDHOLT_AUTHORITY_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid Wyrdholt authority port");
const manifest = process.env.WYRDHOLT_LIVE_CONFIG;
const config = loadLiveConfig(manifest ? JSON.parse(readFileSync(manifest, "utf8")) : undefined);
const database = resolve(process.env.WYRDHOLT_AUTHORITY_DB ?? "artifacts/wyrdholt-authority.sqlite");
mkdirSync(dirname(database), { recursive: true });
const store = new SqliteAuthorityStore(database);
const origins = (process.env.WYRDHOLT_AUTHORITY_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173,https://localhost")
  .split(",").map(origin => origin.trim()).filter(Boolean);
const server = createAuthorityHttp(store, config, { origins, allowRegistration: process.env.WYRDHOLT_AUTHORITY_REGISTRATION === "true" });
server.listen(port, "127.0.0.1", () => console.log(`Wyrdholt authority listening on http://127.0.0.1:${port}`));
function close(): void { server.close(() => store.close()); }
process.once("SIGINT", close);
process.once("SIGTERM", close);
