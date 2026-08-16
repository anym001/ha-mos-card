# MOS NAS Card

A Lovelace card for the [MOS NAS integration](https://github.com/anym001/ha-mos) (domain `mos`).
It renders the containers, virtual machines, disks, storage pools and UPS of a MOS server as a
list of rows, and follows them as they come and go.

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)
[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![GitHub Activity][commits-shield]][commits]

---

## Overview

- **Six device kinds**, each switchable on or off: Docker containers, LXC containers, virtual
  machines, disks, storage pools and the UPS.
- **Rows build themselves.** Each row shows the icon, the name, the state, a link to the thing's
  own web interface where it has one, and a start/stop switch for the guests that can be
  controlled.
- **The list stays current.** The card reads the Home Assistant device registry and subscribes to
  registry updates, so a container you delete on the NAS disappears from the card and a new one
  shows up — no editing the card, no manual refresh.
- **A broken endpoint does not empty the card.** Devices behind a failing MOS endpoint keep their
  rows and go unavailable, which is a different thing from being gone.

### How devices are found

The integration writes a `model_id` onto every device it creates for a container, disk, pool or
UPS. This card matches on exactly that, plus `via_device_id` to scope the list to one server:

| `model_id`         | Rendered as       | Has power switch |
| ------------------ | ----------------- | ---------------- |
| `docker_container` | Docker containers | yes              |
| `lxc_container`    | LXC containers    | yes              |
| `virtual_machine`  | Virtual machines  | yes              |
| `disk`             | Disks             | no               |
| `storage_pool`     | Storage pools     | no               |
| `ups`              | UPS               | no               |

The MOS **server** device carries no `model_id` on purpose — it is identified as the `via_device_id`
parent of the devices above.

The card matches on **neither** device `identifiers` (an internal format the integration reserves
the right to change) **nor** display names (yours to rename). That is what makes renaming a
container in Home Assistant safe. The contract is documented on the integration side in
`docs/development/ARCHITECTURE.md` and in the decision log entry _Container Devices Carry Their Kind
in `model_id`_.

---

## Installation

### HACS

1. Open HACS in your Home Assistant instance.
2. Add `https://github.com/anym001/ha-mos-card` as a custom repository of type **Dashboard**.
3. Search for **MOS NAS Card** and click **Download**.
4. Refresh your browser.

### Manual

1. Download `ha-mos-card.js` from the [latest release][releases].
2. Copy it to `<config>/www/ha-mos-card.js`.
3. Add a resource entry in your dashboard settings:

```yaml
resources:
  - url: /local/ha-mos-card.js
    type: module
```

---

## Configuration

### Minimal

Everything is optional. With no options at all the card shows every kind, on every MOS server:

```yaml
type: custom:ha-mos-card
```

### Docker only, on one server

```yaml
type: custom:ha-mos-card
title: Containers
server: 1a2b3c4d5e6f7890abcdef1234567890
kinds:
  - docker_container
```

### Full example

```yaml
type: custom:ha-mos-card
title: Sirius
server: 1a2b3c4d5e6f7890abcdef1234567890
kinds:
  - docker_container
  - lxc_container
  - virtual_machine
  - disk
  - storage_pool
  - ups
group_by_kind: true
show_icon: true
show_state: true
show_link: true
show_power: true
hide_unavailable: false
tap_action:
  action: more-info
hold_action:
  action: none
```

---

## Options

| Name                | Type    | Description                                                              | Default             |
| ------------------- | ------- | ------------------------------------------------------------------------ | ------------------- |
| `type`              | string  | **Required.** `custom:ha-mos-card`                                       |                     |
| `title`             | string  | Card heading. Omit for no heading.                                       | none                |
| `server`            | string  | Device id of the MOS server to show. Omit to show every server, grouped. | all servers         |
| `kinds`             | list    | Which `model_id` kinds to render (see the table above).                  | all six             |
| `group_by_kind`     | boolean | Show a heading above each kind.                                          | `true`              |
| `show_icon`         | boolean | Show the row icon.                                                       | `true`              |
| `show_state`        | boolean | Show the state value on each row.                                        | `true`              |
| `show_link`         | boolean | Show a link button where the device has a URL.                           | `true`              |
| `show_power`        | boolean | Show the start/stop switch on guest rows.                                | `true`              |
| `hide_unavailable`  | boolean | Hide rows whose state is unavailable or unknown.                         | `false`             |
| `tap_action`        | object  | Action for a tap on the row body, applied to that row's state entity.    | `action: more-info` |
| `hold_action`       | object  | Action for a 500 ms hold.                                                | `action: none`      |
| `double_tap_action` | object  | Action for a double tap.                                                 | `action: none`      |

An unknown value in `kinds` is a configuration error and the card says so, rather than silently
rendering an empty list.

### Where a row's parts come from

Each row is built from a single entity per device — the state sensor the integration documents for
exactly this purpose:

- **Icon** — the state sensor's `entity_picture`, which for Docker, LXC and VM guests is the icon
  MOS itself shows. Falls back to a per-kind MDI icon.
- **State** — the sensor's state, formatted the way Home Assistant formats it everywhere else, so
  enum states read in your language.
- **Link** — the Docker state sensor's `web_ui_url` attribute, falling back to the device's
  configuration URL. Containers without a web interface get no button rather than a dead one.
- **Power** — the single `switch` entity on the device, for the three guest kinds that have one.

---

## Developer Guide

### Prerequisites

| Tool    | Minimum version | Notes                               |
| ------- | --------------- | ----------------------------------- |
| Node.js | 24              | Required by `custom-card-helpers@2` |
| Yarn    | 4               | Managed via Corepack                |

TypeScript, Rollup, ESLint, and all other build tools are installed locally via `yarn install` — no
global installs needed.

### Quick start — devcontainer (recommended)

1. Open the project in VS Code.
2. When prompted, click **Reopen in Container**.
3. A local Home Assistant instance starts automatically at `http://localhost:8123`.
4. Log in with `dev` / `dev`.
5. The built card is served from the container and rebuilds on every save.

**Requires:** [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.

### Quick start — local

```bash
git clone https://github.com/anym001/ha-mos-card.git
cd ha-mos-card

yarn install
pre-commit install   # formatting, linting and commit-message checks
yarn build
yarn start
```

Then add your local file as a Lovelace resource:

```yaml
resources:
  - url: /local/ha-mos-card.js
    type: module
```

### Available scripts

| Command       | Description                                        |
| ------------- | -------------------------------------------------- |
| `yarn build`  | Lint + production bundle (minified, ES2022 output) |
| `yarn rollup` | Production bundle only (skips lint)                |
| `yarn start`  | Development watcher with rebuild on save           |
| `yarn lint`   | ESLint across all `src/` files                     |

### Project structure

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
        ├── en.json              # English strings
        └── nb.json              # Norwegian strings
dist/
└── ha-mos-card.js               # Build output — serve this to HA
```

### Why Rollup and not Vite

Deliberate. Vite's hot reload buys nothing for a Home Assistant card, because HA loads the built
bundle from a resource URL rather than from a dev server. Rollup produces that single bundle
directly, so the dev loop and the shipped artifact are the same thing.

### Commits and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commitlint` hook at the `commit-msg` stage (`pre-commit install` sets it up). `release-please`
reads those subjects to decide the next version and to write the changelog, so a malformed subject
produces a wrong release — fix the message rather than bypassing the hook.

Releases are not hand-tagged. Merging to `master` opens or updates a release PR; merging that PR
tags the release, bumps `package.json` and `src/const.ts`, and attaches the built `ha-mos-card.js`
to it, which is what HACS downloads.

### Adding a new language

1. Copy `src/localize/languages/en.json` to `src/localize/languages/<lang>.json`.
2. Translate the values (keep all keys identical).
3. Import and register the new translations in `src/localize/localize.ts`.

---

## Troubleshooting

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**"No MOS devices found"**
The card found no device with a MOS `model_id`. Check that the MOS integration is set up and that
its devices are not disabled in **Settings → Devices & services**. The integration must be recent
enough to write `model_id` onto its devices.

**A container is missing**
Check whether its device is disabled, and whether its kind is enabled in the card's `kinds` option.
Rows are never matched by name, so renaming is not the cause.

**Rows show as unavailable**
That is the intended signal for a MOS endpoint that is failing: the devices stay, their entities go
unavailable. Check the integration's own diagnostics.

**`TypeError: Class constructor cannot be invoked without 'new'`**
Your bundler is transpiling Lit's class syntax down to ES5. Rollup and Terser are both configured
for ES2022 output here — do not lower those targets.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki][troubleshooting].

---

[commits-shield]: https://img.shields.io/github/commit-activity/y/anym001/ha-mos-card.svg?style=for-the-badge
[commits]: https://github.com/anym001/ha-mos-card/commits/master
[license-shield]: https://img.shields.io/github/license/anym001/ha-mos-card.svg?style=for-the-badge
[releases-shield]: https://img.shields.io/github/release/anym001/ha-mos-card.svg?style=for-the-badge
[releases]: https://github.com/anym001/ha-mos-card/releases
[troubleshooting]: https://github.com/thomasloven/hass-config/wiki/Lovelace-Plugins
