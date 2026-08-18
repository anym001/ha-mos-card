# Claude Code Instructions

This repository uses a shared AI agent instruction system. **All instructions are in [`AGENTS.md`](AGENTS.md).**

Read `AGENTS.md` completely before starting any work. It contains:

- What this card is and how it relates to the MOS NAS integration
- The `model_id` device contract — read this before touching device selection
- Architecture, TypeScript, and Lit patterns
- Home Assistant integration, localization, and styling rules
- Build and quality expectations, and the safe change workflow

## Quick Reference

- **Card type:** `custom:mos-card`
- **Integration:** [`anym001/ha-mos`](https://github.com/anym001/ha-mos), domain `mos`
- **Main code:** `src/mos-card.ts`, device selection in `src/devices.ts`
- **Technical docs:** `docs/development/ARCHITECTURE.md` (the README is for end users)
- **Validate:** `yarn check` (lint + typecheck + lint:md + lint:format + build)
- **Build:** `yarn build` (lint + production bundle)
- **Careful:** a green `yarn build` is not a green type check — run `yarn typecheck`
- **Dev watcher:** `yarn start`
- **Hooks:** installed by `yarn setup` (formatting, lint, and the commit-msg check)

## The `model_id` Contract (non-negotiable)

The card selects devices from the Home Assistant device registry by their `model_id`
(`docker_container`, `lxc_container`, `virtual_machine`, `disk`, `storage_pool`, `ups`), scoped to a
server via `via_device_id`. Device `identifiers` and display names are **never** matched — the first
is an internal format, the second is the user's to rename.

This is a released, public contract documented on the integration side in
the **`ha-mos` repository's** `docs/development/ARCHITECTURE.md` and in the decision log entry
_Container Devices Carry Their Kind in `model_id`_ in its `docs/development/DECISIONS.md`. Read both
before changing how matching works. This repository has its own
[`docs/development/ARCHITECTURE.md`](docs/development/ARCHITECTURE.md) describing the card side.

Full rationale and the lifecycle consequences: see the `model_id` section in `AGENTS.md`.

## Commit Messages (non-negotiable)

Every commit MUST follow [Conventional Commits](https://www.conventionalcommits.org/).
This is not optional and not a stylistic preference — `release-please` derives the
next version and the changelog from these subjects, so a malformed message
silently produces a wrong release.

```text
type(scope): short summary (max 72 chars)

- Body bullet: WHAT changed and WHY, not HOW
- One bullet per logical change

BREAKING CHANGE: description (required if breaking)
```

- **Types:** `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`, `perf`
- **Scope:** required when the change is clearly scoped to one component —
  e.g. `card`, `editor`, `config`, `devices`, `localize`, `build`, `deps`
- **Subject:** imperative, ≤ 72 chars, no capital after the colon, no trailing period
- **Body:** required when more than one file changes; bullets, not prose
- Analyze the **full staged diff** first — every modified file must be accounted for
- Unrelated changes → separate commits

This is enforced mechanically: a `commitlint` hook runs at the `commit-msg`
stage (see `.commitlintrc.json` and `.pre-commit-config.yaml`) and rejects the
commit if the message does not conform. If it trips, fix the message — do not
bypass it with `--no-verify`.

## Releases

Releases are driven by `release-please`, not by hand-tagging. Merging to `main` opens or updates
a release PR; merging that PR tags the release and the workflow attaches `dist/mos-card.js` to
it, which is what HACS downloads. `package.json` and `src/const.ts` are both bumped automatically —
never edit either version by hand.
