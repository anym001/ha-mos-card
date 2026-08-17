# AI Agent Instructions

This document provides guidance for AI coding agents working on `ha-mos-card`, the Home Assistant Lovelace card for the
[MOS NAS integration](https://github.com/anym001/ha-mos) (domain `mos`).
The codebase is TypeScript + Lit and builds with Rollup.

Use these instructions as project-specific guardrails when generating, editing, or reviewing code.
They are agent-independent: anything tool-specific belongs in that tool's own file, not here.

## Quick reference

### Core commands

```bash
yarn install
yarn start
yarn build
yarn lint        # ESLint
yarn typecheck   # tsc --noEmit
yarn lint:md     # markdownlint
yarn lint:format # prettier --check
```

### Primary files

- `src/ha-mos-card.ts` — main card implementation
- `src/devices.ts` — device registry subscription, `model_id` filtering, per-kind facts
- `src/editor.ts` — visual editor (`LovelaceCardEditor`)
- `src/types.ts` — card config and type definitions
- `src/const.ts` — `CARD_VERSION`, bumped by release-please
- `src/action-handler-directive.ts` — tap/hold/double-tap directive
- `src/localize/localize.ts` — localization helper
- `src/localize/languages/de.json` and `src/localize/languages/en.json` — translation files
- `rollup.config.js` and `rollup.config.dev.js` — production and dev build config

## The `model_id` contract (read this before touching device selection)

The card discovers what to render from the Home Assistant **device registry**, not from a
hand-maintained entity list. The integration writes a `model_id` onto every container device it
creates, and that field is the only supported anchor:

- Valid values: `docker_container`, `lxc_container`, `virtual_machine`, `disk`, `storage_pool`, `ups`.
- The MOS **server** device deliberately carries no `model_id`. Container devices hang off it via
  `via_device_id`, which is how the card scopes a dashboard to one server.
- **Never** match on device `identifiers` (an internal format the integration reserves the right to
  change) or on display names (the user's to rename).

This is a released, public contract. It is documented on the integration side in
`docs/development/ARCHITECTURE.md` ("Base Entity") and in the decision log entry
_Container Devices Carry Their Kind in `model_id`_ in `docs/development/DECISIONS.md`.
Changing how the card matches means re-reading both first.

Because the integration adds and removes these devices at runtime
(`async_setup_dynamic_entities`), a card that follows the registry gets lifecycle for free:
removed containers disappear, new ones show up, and a container behind a failing endpoint stays
listed and merely reports unavailable. Do not add manual refresh logic that fights this.

## Architecture and patterns

- The custom element is `custom:ha-mos-card`.
- Prefer Lit 3 patterns and idiomatic web component structure.
- Keep configuration shape centralized in `src/types.ts`.
- Keep editor schema and defaults aligned with runtime card behavior.
- Keep feature logic in small, readable helpers instead of long monolithic methods.
- Registry subscriptions belong in `connectedCallback` and must be torn down in
  `disconnectedCallback` — a card element is created and destroyed on every dashboard edit.

## TypeScript standards

- Use strict, explicit typing; avoid `any` unless there is no practical alternative.
- Use `import type` for type-only imports where appropriate.
- Validate and narrow optional config fields before use.
- Keep public API names stable unless explicitly requested to change them.

## Lit and component guidance

- Use `@property` for public reactive inputs and `@state` for internal state.
- Avoid direct DOM mutation when Lit reactivity can handle updates.
- Preserve existing card/editor lifecycle behavior.
- For card config, validate early in `setConfig` and throw actionable errors.
- Keep `getCardSize` deterministic and aligned with rendered density.

## Home Assistant integration

- Use Home Assistant helpers and conventions from `custom-card-helpers`.
- Ensure tap, hold, and double-tap actions are wired through existing action patterns.
- Support unavailable/loading/error states gracefully — an unreachable MOS endpoint is a normal
  state, not an error state.
- Keep Lovelace config compatibility in mind when changing schema or defaults.

## Localization and copy

- Do not hardcode user-facing strings when a localize key should be used.
- Add new translation keys to both language files (`de.json`, `en.json`) — a key present in one
  and missing in the other silently falls back to English.
- German follows the MOS integration's own wording, so the card and the integration read the
  same way: Docker-Container, LXC-Container, VMs, Festplatten, Speicherpools, USV, MOS-Server,
  and the du-form throughout.
- Keep copy concise, sentence case, and user-facing.
- Favor consistent terminology across card UI and editor labels.

## Styling and UX

- Respect Home Assistant theme variables and CSS custom properties.
- Avoid hardcoded colors when theme tokens can be used.
- Keep spacing and typography consistent with existing card styles.
- Ensure layouts work in both compact and wider dashboard widths.

## Build and quality expectations

- Keep `yarn lint` clean for changed code.
- Ensure `yarn build` succeeds after non-trivial changes.
- Run `yarn typecheck` as well, and do not read a green build as a green type check.
  `@rollup/plugin-typescript` reports type errors as warnings and still emits a bundle, so
  `yarn build` exits 0 on code that does not type-check. `yarn typecheck` is the only command
  that fails on one, which is why the Lint workflow runs it separately from the Build workflow.
- Do not introduce unrelated refactors in focused changes.
- If updating build tooling, keep dev and prod Rollup configs consistent.
- The build stays on **Rollup**. Vite's hot reload buys nothing here: Home Assistant loads the
  built bundle from a resource URL, not from a dev server.

## Commit messages (non-negotiable)

Every commit MUST follow [Conventional Commits](https://www.conventionalcommits.org/).
`release-please` derives the next version and the changelog from these subjects, so a malformed
message silently produces a wrong release.

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
- Unrelated changes → separate commits

This is enforced mechanically by a `commitlint` hook at the `commit-msg` stage (see
`.commitlintrc.json` and `.pre-commit-config.yaml`). Install it once with `pre-commit install`.
If it trips, fix the message — do not bypass it with `--no-verify`.

## Releases

Releases are driven by `release-please`, not by hand-tagging. Merging to `main` opens or updates
a release PR; merging that PR tags the release and the workflow attaches `dist/ha-mos-card.js` to
it, which is what HACS downloads. `package.json` and `src/const.ts` are both bumped automatically —
never edit either version by hand.

## Safe change workflow

1. Read adjacent code before editing.
2. Implement the smallest viable change.
3. Run relevant checks (`yarn lint`, `yarn build`, or targeted command).
4. Update docs/README when behavior or config changes.
5. Summarize what changed and why.

## Pull request guidance

- Keep PRs focused to one logical change.
- Include screenshots or short clips for visible UI/editor changes.
- Document config changes and migration notes when applicable.
- Call out any follow-up work explicitly instead of bundling extra scope.

## Avoid these common issues

- Matching devices on `identifiers` or display names instead of `model_id`
- Breaking editor/card config parity
- Adding untyped dynamic config access
- Hardcoding text instead of localization keys
- Overriding theme behavior with fixed styles
- Changing output filenames or card tag without explicit request
- Hand-editing a version number that release-please owns
