import { masteryRank, type Profile } from "@emberbound/game-core";
import type { ItemInstance } from "@emberbound/shared-types";
import { useEffect, useRef, useState } from "react";
import { session } from "../../game/session";
import { number, pct } from "../format";

interface OnlineProfile extends Pick<Profile, "character" | "gold" | "adventure" | "equipment"> {
  profileId: string;
  revision: number;
  inventory: Pick<ItemInstance, "id" | "baseId" | "isNew">[];
  ladders: { id: string; cleared: number; active: number | null; lastResult: { tier: number; outcome: string } | null }[];
}

interface OnlineRaid {
  id: string; raidId: string; endsAtMs: number; phase: number; damage100: number; adds: number; complete: boolean;
}

interface SocialView {
  borrowing: boolean;
  friendRequests: string[];
  borrowable: { id: string; name: string; level: number; classId: string }[];
  invitations: { id: string; name: string }[];
  claimableRaids: { id: string; name: string }[];
  guild?: { id: string; name: string; ownerId: string; members: string[]; marks: number; expeditionTable: boolean; raids: OnlineRaid[] };
  dungeons: { id: string; name: string; unlocked: boolean; rewardGold: number }[];
  raids: { id: string; name: string; phases: { damageGoal100: number; addGoal: number }[] }[];
}

interface EventsView {
  atMs: number;
  active: string | null;
  events: { id: string; name: string; boss: string; startMs: number; endMs: number; tierIntervalMs: number;
    rule: string; relic: string; relicAttackBp: number[]; rewards: string[] }[];
}

interface Account { origin: string; key: string }
interface OnlineState { profile: OnlineProfile; social: SocialView; events: EventsView }
type Action = (path: string, payload: Record<string, unknown>) => Promise<void>;

async function request<T>(account: Account, path: string, payload?: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {};
  if (account.key) headers.Authorization = `Bearer ${account.key}`;
  if (payload) headers["Content-Type"] = "application/json";
  const response = await fetch(`${account.origin}/v1/${path}`, {
    method: payload ? "POST" : "GET", headers, redirect: "error", credentials: "omit",
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(typeof data.error === "string" ? data.error : "The game server refused this action.");
  return data as T;
}

function authorityOrigin(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("Enter an HTTPS server origin or a local development server.");
  }
  return url.origin;
}

const keyPattern = /^[A-Za-z0-9_-]{43}$/;

export function OnlineScreen({ onBack }: { onBack: () => void }) {
  const classes = session.content.snapshot.classes.filter(c => c.implemented && c.tier === 1);
  const [origin, setOrigin] = useState(import.meta.env.VITE_WYRDHOLT_AUTHORITY_URL ?? "http://127.0.0.1:8787");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [active, setActive] = useState("monk");
  const [alternate, setAlternate] = useState("mage");
  const [account, setAccount] = useState<Account | null>(null);
  const [online, setOnline] = useState<OnlineState | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef<OnlineState | null>(null);

  async function refresh(connection: Account): Promise<void> {
    const [profile, social, events] = await Promise.all([
      request<OnlineProfile>(connection, "profile"), request<SocialView>(connection, "social"), request<EventsView>(connection, "events"),
    ]);
    latest.current = { profile, social, events };
    setOnline(latest.current);
  }

  async function perform(work: () => Promise<void>, clearResult = true): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    if (clearResult) setResult("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Online action failed."); }
    finally { running.current = false; setBusy(false); }
  }

  async function connect(register: boolean): Promise<void> {
    await perform(async () => {
      const server = authorityOrigin(origin);
      const existing = key.trim();
      if (!register && !keyPattern.test(existing)) throw new Error("Enter your online account key.");
      const registered = register && await request<{ token: string }>({ origin: server, key: "" }, "register", { name, activeClassId: active, alternateClassId: alternate });
      const connection = { origin: server, key: registered ? registered.token : existing };
      if (registered) { setNewKey(connection.key); setKey(connection.key); }
      await refresh(connection);
      setAccount(connection);
    });
  }

  const mutate: Action = async (path, payload) => {
    if (!account) return;
    await perform(async () => {
      try {
        const response = await request<{ receipt?: { won?: boolean; damage100?: number; adds?: number; fights?: { outcome: string }[] }; gold?: number }>(account, path, payload);
        if (path === "dungeons" && response.receipt) {
          const cleared = response.receipt.fights?.filter(fight => fight.outcome === "victory").length ?? 0;
          setResult(`${response.receipt.won ? "Dungeon cleared" : "Dungeon ended"} · ${cleared} waves won`);
        } else if (path === "raids/contribute" && response.receipt) {
          setResult(`Contribution recorded · ${number(Math.floor((response.receipt.damage100 ?? 0) / 100))} damage · ${response.receipt.adds ?? 0} adds`);
        } else if (path === "raids/claim") setResult(`${number(response.gold ?? 0)} Gold claimed`);
      } finally { await refresh(account); }
    });
  };

  const command = (value: Record<string, unknown> | null) => {
    if (!latest.current) return Promise.resolve();
    return mutate("commands", { format: "wyrdholt-command/1", requestId: crypto.randomUUID(), revision: latest.current.profile.revision, command: value });
  };

  useEffect(() => {
    if (!account) return;
    const sync = () => {
      if (document.hidden || running.current || !latest.current) return;
      const profile = latest.current.profile;
      if (profile.adventure.activity === "idle" && !profile.ladders.some(ladder => ladder.active !== null)) return;
      void perform(async () => {
        try {
          await request(account, "commands", { format: "wyrdholt-command/1", requestId: crypto.randomUUID(), revision: profile.revision, command: null });
        } finally { await refresh(account); }
      }, false);
    };
    const timer = setInterval(sync, 15_000);
    return () => clearInterval(timer);
  }, [account]);

  return (
    <main className="screen online-screen stack">
      <button className="btn block" onClick={onBack}>Back to Wyrdholt</button>
      <h1>Online adventure</h1>
      {newKey && <section className="panel stack" aria-label="Save online credentials">
        <p className="small">Save this account key privately. It opens your online character on another device.</p>
        <input aria-label="New account key" readOnly value={newKey} onFocus={event => event.target.select()} />
        <button className="btn block" onClick={() => setNewKey(null)}>Hide account key</button>
      </section>}
      {message && <p className="panel small" role="alert">{message}</p>}
      {result && <p className="panel small" role="status">{result}</p>}
      {account && online ? <>
        <OnlineAdventure profile={online.profile} events={online.events} account={account} busy={busy} command={command} mutate={mutate} />
        <OnlineSocial profileId={online.profile.profileId} social={online.social} busy={busy} mutate={mutate} />
        <button className="btn block" disabled={busy} onClick={() => { setAccount(null); setOnline(null); latest.current = null; setKey(""); setNewKey(null); }}>Disconnect online account</button>
      </> : <>
        <section className="panel stack" aria-label="Connect online account">
          <p className="small muted">The server stores one character per account. Online progress and the save on this device are separate.</p>
          <label>Server origin<input value={origin} onChange={e => setOrigin(e.target.value)} /></label>
          <label>Account key<input type="password" value={key} autoComplete="off" onChange={e => setKey(e.target.value)} /></label>
          <button className="btn primary block" disabled={busy} onClick={() => void connect(false)}>Connect</button>
        </section>
        <section className="panel stack" aria-label="Create online character">
          <h2>Create an online character</h2>
          <label>Character name<input value={name} maxLength={16} onChange={e => setName(e.target.value)} /></label>
          <label>Active class<select value={active} onChange={e => setActive(e.target.value)}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Alternate class<select value={alternate} onChange={e => setAlternate(e.target.value)}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button className="btn block" disabled={busy || active === alternate || name.trim().length < 2} onClick={() => void connect(true)}>Create online character</button>
        </section>
      </>}
    </main>
  );
}

function OnlineAdventure({ profile, events, account, busy, command, mutate }: {
  profile: OnlineProfile; events: EventsView; account: Account; busy: boolean;
  command: (value: Record<string, unknown> | null) => Promise<void>; mutate: Action;
}) {
  const content = session.content;
  const char = profile.character;
  const rank = masteryRank(content, char.activeClassId, char.masteryXp[char.activeClassId] ?? 0);
  const ladder = (id: string) => profile.ladders.find(candidate => candidate.id === id);
  const activeSeason = events.events.find(candidate => candidate.id === events.active);
  const season = activeSeason ?? events.events.find(candidate => candidate.startMs > events.atMs);
  const ashen = profile.adventure.zones.ashen_mountains?.cleared;
  const fighting = profile.ladders.some(value => value.active !== null);
  const [rankings, setRankings] = useState<{ displayName: string; profileId: string; tier: number }[]>([]);
  const [rankingError, setRankingError] = useState("");
  const [slot, setSlot] = useState("weapon");
  const [copy, setCopy] = useState(0);
  const available = profile.inventory.filter(item => content.items.get(item.baseId)?.slot === slot);
  const current = available.find(item => item.id === copy);
  const equipped = Object.entries(profile.equipment).find(([key]) => key === slot)?.[1];

  const start = (bossId: string, tier: number) => command({ type: "startBoss", tier, autoPush: false, bossId });
  async function loadRankings(seasonId: string) {
    setRankingError("");
    try { setRankings((await request<{ entries: typeof rankings }>(account, `leaderboard?season=${encodeURIComponent(seasonId)}`)).entries); }
    catch (error) { setRankingError(error instanceof Error ? error.message : "Leaderboard unavailable."); }
  }

  return <>
    <section className="panel stack" aria-label="Online character">
      <h2>{char.name}</h2>
      <p className="small">Level {char.level} · {content.classDef(char.activeClassId).name} M{rank} · {number(profile.gold)} Gold</p>
      <p className="small muted">Share your character code for friend and guild invitations.</p>
      <input aria-label="Character code" readOnly value={profile.profileId} onFocus={event => event.target.select()} />
      <button className="btn block" disabled={busy} onClick={() => void command({ type: "setActiveClass", classId: char.alternateClassId })}>Switch to {content.classDef(char.alternateClassId).name}</button>
      <button className="btn block" disabled={busy} onClick={() => void command(null)}>Sync progress</button>
    </section>
    <section className="panel stack" aria-label="Online Adventure zones">
      <h2>Adventure</h2>
      {profile.adventure.run && <p className="small">{profile.adventure.run.mode} · {content.zone(profile.adventure.run.zoneId).name} · Stage {profile.adventure.run.stageIndex + 1}</p>}
      {profile.adventure.lastResult && <p className="small muted">Last Push · {profile.adventure.lastResult.kind} at stage {profile.adventure.lastResult.stage}</p>}
      {content.snapshot.zones.filter(zone => zone.implemented && !zone.hidden).map(zone => {
        const progress = profile.adventure.zones[zone.id];
        return <div className="row spread" key={zone.id}>
          <b>{zone.name}</b>
          <button className="btn" disabled={busy || fighting || !progress?.unlocked} onClick={() => void command({ type: progress?.cleared ? "startFarm" : "startPush", zoneId: zone.id })}>{progress?.cleared ? "Farm" : progress?.unlocked ? "Push" : "Locked"}</button>
          {progress?.unlocked && !progress.cleared && <button className="btn" disabled={busy || fighting} onClick={() => void command({ type: "startFarm", zoneId: zone.id })}>Farm trail</button>}
        </div>;
      })}
    </section>
    <section className="panel stack" aria-label="Online gear">
      <h2>Gear</h2>
      <label>Slot<select value={slot} onChange={e => { setSlot(e.target.value); setCopy(0); }}>{["weapon", "head", "chest", "gloves", "boots", "ring"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Owned copy<select value={copy} onChange={e => setCopy(Number(e.target.value))}>
        <option value={0}>Select gear</option>{available.map(item => <option key={item.id} value={item.id}>{content.item(item.baseId).name} #{item.id}{item.id === equipped ? " · Equipped" : ""}</option>)}
      </select></label>
      {current && <p className="small muted">{content.item(current.baseId).rarity} · {Object.entries(content.item(current.baseId).stats).map(([stat, value]) => `${stat} +${value}`).join(" · ")}</p>}
      <button className="btn block" disabled={busy || !current || copy === equipped} onClick={() => void command({ type: "equip", slot, instanceId: copy })}>Equip selected copy</button>
    </section>
    <section className="panel stack" aria-label="Online boss challenges">
      <h2>Boss challenges</h2>
      <p className="small muted">Clear Ashen Mountains to enter. Progress is saved on the server.</p>
      {ashen && (ladder("ashen_king")?.cleared ?? 0) < 5 && <button className="btn block" disabled={busy || fighting} onClick={() => void start("ashen_king", (ladder("ashen_king")?.cleared ?? 0) + 1)}>Challenge Ashen King</button>}
      {[char.activeClassId, char.alternateClassId].map(classId => {
        const path = content.promotions.get(classId);
        if (!path) return null;
        const ready = ashen && classId === char.activeClassId && char.level >= path.level && rank >= path.mastery;
        return <div className="stack" key={classId}>
          <span className="small">{path.name} · Level {path.level} · M{path.mastery}</span>
          {ladder(path.boss.id)?.cleared ? <span className="tag gold">Promoted</span> : <button className="btn block" disabled={busy || fighting || !ready} onClick={() => void start(path.boss.id, 1)}>Enter {path.boss.name}</button>}
        </div>;
      })}
      {profile.ladders.map(value => <p className="small" key={value.id}>{content.soloBosses.get(value.id)?.name ?? value.id} · {value.active ? `Fighting tier ${value.active}` : `${value.cleared} tiers cleared${value.lastResult ? ` · ${value.lastResult.outcome}` : ""}`}</p>)}
    </section>
    <section className="panel stack" aria-label="Online seasons">
      <h2>{season?.name ?? "Seasons"}</h2>
      {season ? <>
        <p className="small muted">{season.boss} · {season.rule}</p>
        <p className="small muted">{new Date(season.startMs).toLocaleDateString()} – {new Date(season.endMs).toLocaleDateString()}</p>
        {season.rewards.map((title, index) => <div className="row spread small" key={title}><span>{title}</span><span>{(ladder(season.id)?.cleared ?? 0) > index ? "Earned" : `+${pct(season.relicAttackBp[index] ?? 0)} ${season.relic} Attack`}</span></div>)}
        {activeSeason && (ladder(season.id)?.cleared ?? 0) < season.rewards.length && <button className="btn block" disabled={busy || fighting || !ashen || events.atMs < season.startMs + (ladder(season.id)?.cleared ?? 0) * season.tierIntervalMs} onClick={() => void start(season.id, (ladder(season.id)?.cleared ?? 0) + 1)}>Challenge next seasonal tier</button>}
        <button className="btn block" disabled={busy || !ladder(season.id)?.cleared} onClick={() => void mutate("leaderboard", { format: "wyrdholt-leaderboard-submission/1", seasonId: season.id, revision: profile.revision })}>Submit season result</button>
        <button className="btn block" onClick={() => void loadRankings(season.id)}>View season leaderboard</button>
        {rankings.map((entry, index) => <p className="small" key={entry.profileId}>{index + 1}. {entry.displayName} · Tier {entry.tier}</p>)}
        {rankingError && <p className="small" role="alert">{rankingError}</p>}
      </> : <p className="small muted">No event is scheduled.</p>}
    </section>
  </>;
}

function OnlineSocial({ profileId, social, busy, mutate }: { profileId: string; social: SocialView; busy: boolean; mutate: Action }) {
  const [friend, setFriend] = useState("");
  const [guildName, setGuildName] = useState("");
  const [invite, setInvite] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const guild = social.guild;
  const leader = guild?.ownerId === profileId;
  const allies = [first, second];
  const partyReady = first !== second && allies.every(id => social.borrowable.some(person => person.id === id));
  const guildParty = partyReady && allies.every(id => guild?.members.includes(id));
  const raid = guild?.raids.find(value => value.endsAtMs > Date.now());
  const definition = raid && social.raids.find(value => value.id === raid.raidId);
  const phase = raid && definition?.phases[raid.phase];
  return <>
    <section className="panel stack" aria-label="Friends and party">
      <h2>Friends and party</h2>
      <label className="row"><input type="checkbox" checked={social.borrowing} disabled={busy} onChange={e => void mutate("borrowing", { enabled: e.target.checked })} />Allow friends and guildmates to borrow my build</label>
      <label>Friend character code<input value={friend} onChange={e => setFriend(e.target.value)} /></label>
      <button className="btn block" disabled={busy || !friend.trim()} onClick={() => void mutate("friends", { profileId: friend.trim(), add: true })}>Send friend request</button>
      <button className="btn block" disabled={busy || !friend.trim()} onClick={() => void mutate("friends", { profileId: friend.trim(), add: false })}>Remove friend or request</button>
      {social.friendRequests.map(id => <button className="btn block" key={id} disabled={busy} onClick={() => void mutate("friends", { profileId: id, add: true })}>Accept {id.slice(0, 8)}…</button>)}
      {[{ value: first, set: setFirst }, { value: second, set: setSecond }].map(({ value, set }, index) => <label key={index}>Companion {index + 1}<select value={value} onChange={e => set(e.target.value)}>
        <option value="">Choose companion</option>{social.borrowable.map(person => <option key={person.id} value={person.id}>{person.name} · L{person.level} {person.classId}</option>)}
      </select></label>)}
      {social.dungeons.map(dungeon => <button key={dungeon.id} className="btn block" disabled={busy || !partyReady || !dungeon.unlocked} onClick={() => void mutate("dungeons", { dungeonId: dungeon.id, requestId: crypto.randomUUID(), allies })}>{dungeon.unlocked ? `Enter ${dungeon.name}` : `${dungeon.name} · Clear Greenfields`}</button>)}
    </section>
    <section className="panel stack" aria-label="Guild and raids">
      <h2>{guild?.name ?? "Guild"}</h2>
      {guild ? <>
        <p className="small">{guild.members.length} members · {number(guild.marks)} guild marks</p>
        <p className="small muted">Earn guild marks by clearing dungeons. Complete the Expedition Table to open raids.</p>
        {leader && <>
          <label>Invite character code<input value={invite} onChange={e => setInvite(e.target.value)} /></label>
          <button className="btn block" disabled={busy || !invite.trim()} onClick={() => void mutate("guilds/invite", { profileId: invite.trim() })}>Invite to guild</button>
          {!guild.expeditionTable && <button className="btn block" disabled={busy || guild.marks < 60} onClick={() => void mutate("guilds/project", {})}>Build Expedition Table · 60 marks</button>}
          {guild.expeditionTable && !raid && social.raids.map(value => <button className="btn block" key={value.id} disabled={busy} onClick={() => void mutate("raids", { raidId: value.id })}>Open {value.name}</button>)}
        </>}
        {raid && phase && <div className="stack">
          <b>{definition?.name} · Phase {raid.phase + 1}</b>
          <span className="small">{number(Math.floor(raid.damage100 / 100))}/{number(Math.floor(phase.damageGoal100 / 100))} boss damage · {raid.adds}/{phase.addGoal} adds</span>
          <button className="btn primary block" disabled={busy || !guildParty} onClick={() => void mutate("raids/contribute", { raidId: raid.id, requestId: crypto.randomUUID(), allies })}>Lead raid attempt</button>
        </div>}
        {raid?.complete && <p className="small">Raid complete. The current window ends {new Date(raid.endsAtMs).toLocaleDateString()}.</p>}
        <button className="btn block" disabled={busy} onClick={() => void mutate("guilds/leave", {})}>Leave guild</button>
      </> : <>
        <label>Guild name<input value={guildName} maxLength={24} onChange={e => setGuildName(e.target.value)} /></label>
        <button className="btn block" disabled={busy || guildName.trim().length < 3} onClick={() => void mutate("guilds", { name: guildName })}>Create guild</button>
        {social.invitations.map(guild => <button className="btn block" key={guild.id} disabled={busy} onClick={() => void mutate("guilds/join", { guildId: guild.id })}>Join {guild.name}</button>)}
      </>}
      {social.claimableRaids.map(raid => <button className="btn primary block" key={raid.id} disabled={busy} onClick={() => void mutate("raids/claim", { raidId: raid.id })}>Claim {raid.name} reward</button>)}
    </section>
  </>;
}
