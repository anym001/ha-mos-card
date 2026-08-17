# Architecture Overview

This document describes the technical architecture of `ha-mos-card`, the Lovelace card for the
[MOS NAS integration](https://github.com/anym001/ha-mos).

## Directory Structure

```text
src/
├── ha-mos-card.ts               # Main card element — LitElement subclass
├── devices.ts                   # Device registry subscription and model_id filtering
├── editor.ts                    # Visual editor — implements LovelaceCardEditor
├── types.ts                     # Card config interface
├── const.ts                     # CARD_VERSION (bumped by release-please)
├── action-handler-directive.ts  # Lit directive: tap / hold / double-tap gestures
└── localize/
    ├── localize.ts              # i18n helper
    └── languages/
        ├── de.json              # German strings
        └── en.json              # English strings
dist/
└── ha-mos-card.js               # Build output — the file HACS ships
```

## The `model_id` Contract

Everything the card renders comes out of the Home Assistant **device registry**, filtered on
`model_id`. This is a deliberate, documented contract on the integration side. The authority is the
`ha-mos` repository — its own `docs/development/ARCHITECTURE.md` ("Base Entity") and the decision
log entry _Container Devices Carry Their Kind in `model_id`_ in its `docs/development/DECISIONS.md`.
Read those before changing how matching works; this file describes only the card's side of it.

| `model_id`         | Rendered as       | Has power switch |
| ------------------ | ----------------- | ---------------- |
| `docker_container` | Docker containers | yes              |
| `lxc_container`    | LXC containers    | yes              |
| `virtual_machine`  | Virtual machines  | yes              |
| `disk`             | Disks             | no               |
| `storage_pool`     | Storage pools     | no               |
| `ups`              | UPS               | no               |

Two properties follow from anchoring here rather than anywhere else.

**It survives renames and refactors.** `model_id` is machine-readable by contract. A device's
`identifiers` carry an internal format the integration reserves the right to change, and the
display name belongs to the user. Matching either would break on a rename; matching `model_id`
does not. The card matches neither, ever.

**Lifecycle comes for free.** The integration adds and removes these devices at runtime through
`async_setup_dynamic_entities`, so following the registry means a deleted container disappears from
the card, a new one shows up, and a container behind a failing MOS endpoint keeps its row and
merely reports unavailable. There is nothing to refresh by hand, and no manual refresh logic should
be added that fights this.

The MOS **server** device deliberately carries no `model_id` of its own. It is derived instead: any
device that is the `via_device_id` parent of a device with a MOS kind is by definition a MOS
server. That is what `findServerDevices()` does, and it is why the card can scope a dashboard to
one server without the integration having to label the server.

## How a Row Is Composed

Each row is built from a single entity per device — the state sensor the integration documents for
exactly this purpose.

- **Icon** — the state sensor's `entity_picture`, which for Docker, LXC and VM guests is the icon
  MOS itself shows. Falls back to the per-kind MDI icon in `KIND_INFO`.
- **State** — the sensor's state through `computeStateDisplay`, so enum states read in the user's
  language and units match the rest of Home Assistant.
- **Link** — the Docker state sensor's `web_ui_url` attribute, falling back to the device's
  configuration URL. The integration omits the attribute entirely for containers without a web
  interface, so its presence is the test; a container without one gets no button rather than a
  dead one.
- **Power** — the single `switch` entity on the device. Each of the three guest kinds contributes
  exactly one, so matching the domain is enough and does not depend on the switch's name.

### Finding the state entity

`findStateEntity()` uses a three-step fallback, in this order:

1. `translation_key` equal to the kind's key (`docker_state`, `lxc_state`, `vm_state`,
   `disk_power_status`, `pool_usage`, `ups_status`). This is the integration's own name for the
   entity and survives renames and `entity_id` changes.
2. A `sensor.` entity whose `unique_id` ends in the kind's description key. Older Home Assistant
   cores do not serialize `translation_key` into the `config/entity_registry/list` payload, and
   this covers them.
3. The first `sensor.` on the device, so a row still renders if the integration grows a kind this
   card has not been taught about.

**Which branch actually fires has not been observed against a live instance.** Only the first has
been reasoned about against the integration source.

### Re-render gating

`hass` is replaced on every state change anywhere in Home Assistant. `shouldUpdate()` therefore
compares only the entities this card displays, collected by `trackedEntityIds()` from the
registries and the config — deliberately not from the rendered rows, because `hide_unavailable`
drops rows based on state and a hidden row's entity still has to be watched for it to come back.

## Build Setup

The build stays on **Rollup**. Vite's hot reload buys nothing for a Home Assistant card, because HA
loads the built bundle from a resource URL rather than from a dev server. Rollup produces that
single bundle directly, so the dev loop and the shipped artifact are the same thing.

`rollup.config.js` is production only; `rollup.config.dev.js` is what `yarn start` runs and is the
one with the dev server.

| Command            | Description                                        |
| ------------------ | -------------------------------------------------- |
| `yarn build`       | Lint + production bundle (minified, ES2022 output) |
| `yarn rollup`      | Production bundle only (skips lint)                |
| `yarn start`       | Development watcher with rebuild on save           |
| `yarn lint`        | ESLint across all `src/` files                     |
| `yarn typecheck`   | `tsc --noEmit`                                     |
| `yarn lint:md`     | markdownlint                                       |
| `yarn lint:format` | `prettier --check`                                 |

> [!IMPORTANT]
> A green `yarn build` is **not** a green type check. `@rollup/plugin-typescript` reports type
> errors as warnings and still emits a bundle, so `yarn build` exits 0 on code that does not
> type-check. `yarn typecheck` is the only command that fails on one, which is why the Lint
> workflow runs it separately from the Build workflow.

Rollup and Terser both target ES2022. Do not lower those targets: Lit 3 uses native `class`
syntax, and transpiling to ES5 produces `TypeError: Class constructor cannot be invoked without
'new'` at runtime.

## Continuous Integration

| Workflow               | What it proves                                                                    |
| ---------------------- | --------------------------------------------------------------------------------- |
| `lint.yml`             | ESLint, `tsc --noEmit`, markdownlint and `prettier --check` — the type gate       |
| `build.yml`            | A clean checkout with `--immutable` dependencies still produces a bundle          |
| `no-npm-lockfiles.yml` | No `package-lock.json` slipped in; this repository is Yarn-only                   |
| `validate.yml`         | `hacs/action` with `category: plugin`, nightly and on pull requests               |
| `release-please.yml`   | Opens the release PR, then tags and attaches `dist/ha-mos-card.js` to the release |

ESLint runs in both `lint.yml` and (via `yarn build`) `build.yml`. That duplication is deliberate:
it costs about twenty seconds and buys a lint failure that reads as "Lint" rather than as a broken
build, while keeping a local `yarn build` self-checking.

Every action is pinned to a commit sha with the version in a trailing comment. A moving tag like
`v7` is a mutable pointer; Dependabot reads the comment and updates sha and comment together.

## Development Environment

| Tool    | Minimum version | Notes                               |
| ------- | --------------- | ----------------------------------- |
| Node.js | 24              | Required by `custom-card-helpers@2` |
| Yarn    | 4               | Managed via Corepack                |

TypeScript, Rollup, ESLint and the rest are installed locally by `yarn install` — no global
installs needed.

### Devcontainer (recommended)

1. Open the repository in VS Code.
2. When prompted, click **Reopen in Container**.
3. A local Home Assistant instance starts automatically at `http://localhost:8123`.
4. Log in with `dev` / `dev`.
5. The built card is served from the container and rebuilds on every save.

Requires the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
extension.

### Locally

```bash
git clone https://github.com/anym001/ha-mos-card.git
cd ha-mos-card

yarn install
pre-commit install   # formatting, linting and the commit-message check
yarn build
yarn start
```

Then add the built file as a Lovelace resource:

```yaml
resources:
  - url: /local/ha-mos-card.js
    type: module
```

## Commits and Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commitlint` hook at the `commit-msg` stage that `pre-commit install` sets up. `release-please`
reads those subjects to decide the next version and to write the changelog, so a malformed subject
produces a wrong release — fix the message rather than bypassing the hook. The full type and scope
table is in [`AGENTS.md`](../../AGENTS.md).

Releases are not hand-tagged. Merging to `main` opens or updates a release PR; merging that PR tags
the release, bumps `package.json` and `src/const.ts`, and attaches the built `ha-mos-card.js`,
which is what HACS downloads. Never edit either version by hand.

Merging is restricted to **rebase**, so commits land on `main` individually and the changelog does
not pick up a merge commit's subject alongside the commits it contains.

## Localization

The card ships German and English, the same two the MOS integration ships, and the German follows
the integration's own wording so the two read alike: Docker-Container, LXC-Container, VMs,
Festplatten, Speicherpools, USV, MOS-Server, and the du-form throughout.

A key missing from one file falls back to English rather than showing a raw key, which makes a
partial translation safe but easy to miss — add new keys to both files.

To add a third language:

1. Copy `src/localize/languages/en.json` to `src/localize/languages/<lang>.json`.
2. Translate the values, keeping all keys identical.
3. Import and register the new translations in `src/localize/localize.ts`.
