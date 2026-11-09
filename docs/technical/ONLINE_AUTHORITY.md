# Online authority and seasonal configuration

`npm run authority` starts the Node 24 service on loopback with SQLite storage. Run the browser app in a second terminal. It opens an online account through the **Open online adventure** entry. Each account has one persistent character. The authority assigns the seed and stores a hash of the generated bearer key. Existing offline characters remain in their device saves. An online account starts its own authority-owned character.

| Variable | Purpose |
| --- | --- |
| `WYRDHOLT_AUTHORITY_DB` | SQLite file. Defaults to `artifacts/wyrdholt-authority.sqlite`. |
| `WYRDHOLT_AUTHORITY_PORT` | Loopback HTTP port. Defaults to `8787`. |
| `WYRDHOLT_AUTHORITY_REGISTRATION` | Set to `true` to enable registration for an authorized test environment. |
| `WYRDHOLT_AUTHORITY_ORIGINS` | Comma-separated browser or Capacitor origins allowed by CORS. |
| `WYRDHOLT_LIVE_CONFIG` | Path to an optional versioned JSON rotation manifest. |

An online command includes the expected profile revision and a request ID. The server settles elapsed time using its own clock and applies the same deterministic game core as the device. The database commits the new revision and journal entry together. A duplicate current command returns its receipt. A stale revision refuses the action. Journal entries contain input, content identity and before and after hashes so the server can replay them against a trusted prior profile. The public leaderboard accepts a season and revision. It derives the rank from verified server progress.

## Friends, dungeons and raids

Players share their character codes to form mutual friendships or join an invited guild. A player can opt in to let those friends and guildmates borrow their build. An attempt captures the three distinct characters' current revisions and equipped gear. Each character attacks, uses mechanics and takes damage independently in game-core. The party starts each wave at full HP. The stored snapshots and content hash reproduce the fight after equipment or membership changes.

Briar Vault opens after Greenfields. A character can lead one dungeon per UTC day. Victories grant up to three Gold rewards per participant per day, including borrowed characters. A victory also grants 20 marks to the leader's guild. The database commits all eligible rewards with the attempt receipt.

The guild leader spends 60 marks on the Expedition Table, which unlocks Cinder Breach. Each raid lasts three days and has three shared phases. Boss damage and defeated adds contribute separately, capped at the phase goals. Each member can lead one attempt per UTC day with two consenting guildmates. Members who took part in a positive contribution can claim the completion reward once. Existing reward entitlements survive guild departure.

## Scheduled rotations

The server loads and validates the manifest at startup. A rotation names a bundled season template, a unique identifier, and a UTC start time. The service archives content by hash. Publish a rotation by adding a new entry and restarting the service with the validated manifest.

```json
{
  "format": "wyrdholt-live-config/1",
  "version": "spring_rotation",
  "rotations": [
    {
      "id": "red_moon",
      "template": "season_hollow_frost",
      "name": "Red Moon",
      "startMs": 1801440000000,
      "days": 42,
      "tierDays": 7
    }
  ]
}
```

`GET /v1/events` serves the calendar, the active rule and reward track. `GET /v1/leaderboard?season=<id>` returns authority-validated standings. Production deployment needs an HTTPS origin, a persistent database location and a registration policy. The local test server binds to loopback.
