# Wyrdholt project guide

Use [xariib/Wyrdholt](https://github.com/xariib/Wyrdholt) and `main` as the baseline. Check the current branch and working tree before editing.

Keep game outcomes in the deterministic `packages/game-core` simulation. React and PixiJS display results and submit player commands. Preserve the internal Emberbound identifiers, save compatibility, and Android signing identity.

Keep one persistent character, automatic combat, manual entry into new zones, and rewards already earned on a failed push. [Gameplay systems](docs/design/GAMEPLAY_SYSTEMS.md) and the individual C3 contracts describe the current rules. Treat changes to progression, balance, or save schemas as separate decisions.

Use JavaScript for simple tooling and TypeScript where it protects game and app contracts. Run the relevant checks in [README](README.md) and distinguish browser testing, physical-device validation, and human playtesting in results. Keep raw player saves, credentials, test output, and archives out of commits.
