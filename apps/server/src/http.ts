import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ProfileAuthority } from "./authority/profiles";
import type { SqliteAuthorityStore } from "./authority/sqlite";
import { liveEvents, type loadLiveConfig } from "./live/config";
import { SocialAuthority } from "./social/service";

interface HttpOptions {
  origins: readonly string[];
  allowRegistration: boolean;
  now?: () => number;
}

const credentialHash = (key: string) => createHash("sha256").update(key).digest("hex");
const invalid = (error: string) => ({ ok: false as const, error });

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new Error("JSON required");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65_536) throw new Error("Request too large");
    chunks.push(bytes);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

function respond(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

export function createAuthorityHttp(store: SqliteAuthorityStore, config: ReturnType<typeof loadLiveConfig>, options: HttpOptions) {
  const now = options.now ?? Date.now;
  const profiles = new ProfileAuthority(config.content, store, now);
  const social = new SocialAuthority(config.content, store, now);
  store.archiveContent(config.content.longTermHash, config.content.snapshot);
  store.archiveContent(config.content.socialHash, config.content.snapshot);
  store.archiveContent(config.content.promotionHash, config.content.snapshot);
  for (const hash of config.content.seasonHashes.values()) store.archiveContent(hash, config.content.snapshot);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (origin && !options.origins.includes(origin)) return respond(res, 403, invalid("Origin is not allowed."));
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (req.method === "GET" && path === "/v1/events") return respond(res, 200, liveEvents(config, now()));
    if (req.method === "GET" && path === "/v1/leaderboard") return respond(res, 200, { entries: await profiles.leaderboard(url.searchParams.get("season") ?? "") });

    if (req.method === "POST" && path === "/v1/register") {
      if (!options.allowRegistration) return respond(res, 403, invalid("Registration is closed."));
      const input = await body(req);
      if (typeof input.name !== "string" || typeof input.activeClassId !== "string" || typeof input.alternateClassId !== "string") {
        return respond(res, 400, invalid("Invalid character request."));
      }
      const token = randomBytes(32).toString("base64url");
      const identity = { accountId: randomUUID() };
      const result = await profiles.create(identity, {
        name: input.name, activeClassId: input.activeClassId, alternateClassId: input.alternateClassId,
      }, credentialHash(token));
      return respond(res, result.ok ? 201 : 400, result.ok ? { ...result, token } : result);
    }

    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "")?.[1];
    const accountId = token ? store.authenticate(credentialHash(token)) : null;
    if (!accountId) return respond(res, 401, invalid("A valid account key is required."));
    const identity = { accountId };
    if (req.method === "GET" && path === "/v1/profile") return respond(res, 200, await profiles.view(identity));
    if (req.method === "GET" && path === "/v1/social") return respond(res, 200, await social.view(identity));
    if (req.method !== "POST") return respond(res, 404, invalid("Unknown route."));
    const input = await body(req);
    const field = (key: string) => typeof input[key] === "string" ? input[key] as string : "";
    let result: { ok: boolean };
    switch (path) {
      case "/v1/commands": result = await profiles.submit(identity, input); break;
      case "/v1/leaderboard": result = await profiles.submitLeaderboard(identity, {
        format: input.format as "wyrdholt-leaderboard-submission/1", seasonId: field("seasonId"), revision: input.revision as number,
      }); break;
      case "/v1/borrowing": result = await social.setBorrowing(identity, input.enabled as boolean); break;
      case "/v1/friends": result = await social.friend(identity, field("profileId"), input.add as boolean); break;
      case "/v1/dungeons": result = await social.dungeon(identity, field("requestId"), field("dungeonId"), input.allies); break;
      case "/v1/guilds": result = await social.createGuild(identity, field("name")); break;
      case "/v1/guilds/invite": result = await social.invite(identity, field("profileId")); break;
      case "/v1/guilds/join": result = await social.join(identity, field("guildId")); break;
      case "/v1/guilds/leave": result = await social.leave(identity); break;
      case "/v1/guilds/project": result = await social.completeProject(identity); break;
      case "/v1/raids": result = await social.openRaid(identity, field("raidId")); break;
      case "/v1/raids/contribute": result = await social.contribute(identity, field("raidId"), field("requestId"), input.allies); break;
      case "/v1/raids/claim": result = await social.claimRaid(identity, field("raidId")); break;
      default: return respond(res, 404, invalid("Unknown route."));
    }
    respond(res, result.ok ? 200 : 409, result);
  }

  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    void route(req, res).catch(error => {
      if (res.destroyed || res.headersSent) return;
      if (error instanceof SyntaxError || ["JSON required", "JSON object required", "Request too large"].includes(error?.message)) {
        respond(res, 400, invalid("Invalid JSON request."));
      } else {
        console.error("Wyrdholt authority request failed", error instanceof Error ? error.name : "UnknownError");
        respond(res, 500, invalid("The game server could not complete the request."));
      }
    });
  });
}
