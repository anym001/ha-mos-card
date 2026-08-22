# MOS NAS Card

A Lovelace card for the [MOS NAS integration](https://github.com/anym001/ha-mos) (domain `mos`).
It lists the containers, virtual machines, disks, storage pools and UPS of a MOS server as rows and
follows them as they come and go.

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)
[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![GitHub Activity][commits-shield]][commits]

![Every kind of device on a MOS server, in one card](https://raw.githubusercontent.com/anym001/ha-mos-card/main/assets/overview-light.png)

---

## Features

- **Six device kinds**, each switchable on or off: Docker containers, LXC containers, virtual
  machines, disks, storage pools and the UPS.
- **Every row** carries the icon, the name, the state, a link to the device's own web interface and
  a start/stop button for the guests that can be controlled. A fault or a waiting update adds a
  badge on the icon.
- **Colour follows state.** A running guest gets a coloured ring and a coloured state, a stopped
  one stays neutral. Disks and pools stay neutral on purpose — a disk reporting `Active` names its
  power mode, it does not report good news.
- **The list stays current.** A container deleted on the NAS leaves the card, a new one appears —
  no editing, no manual refresh.
- **Renaming is safe.** Device selection goes by `model_id`, never by name. Only the optional
  `filter` reads names.
- **A broken endpoint does not empty the card.** Devices behind a failing MOS endpoint keep their
  rows and go unavailable.

---

## Requirements

- **Home Assistant 2026.8** or newer. HACS does not offer the card on older cores.
- The [MOS NAS integration](https://github.com/anym001/ha-mos), set up and reporting devices.

---

## Installation

### HACS

1. Open HACS in your Home Assistant instance.
2. Add `https://github.com/anym001/ha-mos-card` as a custom repository of type **Dashboard**.
3. Search for **MOS NAS Card** and click **Download**.
4. Refresh your browser.

### Manual

1. Download `mos-card.js` from the [latest release][releases].
2. Copy it to `<config>/www/mos-card.js`.
3. Add a resource entry in your dashboard settings:

```yaml
resources:
  - url: /local/mos-card.js
    type: module
```

---

## Configuration

Everything is optional. With no options at all the card shows every kind on every MOS server:

```yaml
type: custom:mos-card
```

Containers only, on one server:

```yaml
type: custom:mos-card
title: Containers
server: 1a2b3c4d5e6f7890abcdef1234567890
kinds:
  - docker_container
  - lxc_container
sort: state
secondary_info: auto
```

Every option is in the visual editor, so YAML is only needed if you prefer it. The preview beside
the form is the real card.

![The card's visual editor, with the live preview beside it](https://raw.githubusercontent.com/anym001/ha-mos-card/main/assets/editor-light.png)

### Options

| Name                  | Type    | Description                                                           | Default             |
| --------------------- | ------- | --------------------------------------------------------------------- | ------------------- |
| `type`                | string  | **Required.** `custom:mos-card`                                       |                     |
| `title`               | string  | Card heading. Omit for no heading.                                    | none                |
| `server`              | string  | Device id of the MOS server to show. Omit for every server, grouped.  | all servers         |
| `kinds`               | list    | Which device kinds to render.                                         | all six             |
| `group_by_kind`       | boolean | Show a heading above each kind.                                       | `true`              |
| `filter`              | object  | `include` / `exclude` name patterns.                                  | none                |
| `max_rows`            | number  | Cap rows per group; the rest fold behind a line that opens them.      | no cap              |
| `columns`             | number  | One or two columns per group. A card too narrow for two falls back.   | `1`                 |
| `compact`             | boolean | Shorter rows with smaller controls. Two columns want this.            | `false`             |
| `sort`                | string  | Row order within a group: `name` or `state`.                          | `name`              |
| `secondary_info`      | string  | Extra value beside the state: `none`, `auto`, `cpu` or `memory`.      | `none`              |
| `show_server_summary` | boolean | Show the server's CPU load, memory usage and CPU temperature.         | `false`             |
| `show_icon`           | boolean | Show the row icon.                                                    | `true`              |
| `show_state`          | boolean | Show the state value on each row.                                     | `true`              |
| `show_link`           | boolean | Show a link button where the device has a URL.                        | `true`              |
| `show_power`          | boolean | Show the start/stop button on guest rows.                             | `true`              |
| `confirm_stop`        | boolean | Ask before stopping a running guest. Starting never asks.             | `false`             |
| `show_problem`        | boolean | Badge rows whose device reports a fault (needs `show_icon`).          | `true`              |
| `show_update`         | boolean | Badge rows whose device reports a waiting update (needs `show_icon`). | `true`              |
| `hide_unavailable`    | boolean | Hide rows whose state is unavailable or unknown.                      | `false`             |
| `tap_action`          | object  | Action for a tap on the row body, applied to that row's state entity. | `action: more-info` |
| `hold_action`         | object  | Action for a 500 ms hold.                                             | `action: none`      |
| `double_tap_action`   | object  | Action for a double tap.                                              | `action: none`      |

Valid values for `kinds`: `docker_container`, `lxc_container`, `virtual_machine`, `disk`,
`storage_pool`, `ups`. Anything else is a configuration error and the card says so.

Notes on individual options:

- `sort: state` lists running first, then paused, then stopped, alphabetically within each. Disks
  and pools stay alphabetical either way.
- `secondary_info: auto` picks per kind: CPU and memory for a container or VM, temperature for a
  disk, free space for a pool, load for the UPS. A value the server cannot report is left out.
- `show_server_summary` also shows the server name when there is only one server.
- A fault is what the integration marks with Home Assistant's `problem` device class — a SMART
  warning, an unhealthy container, a degraded pool, a UPS on bypass. The badge names what it found.
- While the server works on a start or a stop, the button shows that it is waiting and ignores
  further presses until the device reports its new state.

### Filtering by name

```yaml
type: custom:mos-card
filter:
  include: ['*arr', plex]
  exclude: '-test'
```

`*` and `?` are wildcards; a pattern without either matches anywhere in the name, so `arr` finds
Sonarr and Radarr. Matching ignores case, `exclude` wins, and a group left with no rows disappears
with its heading. This is the one place names are matched — _which_ devices exist is still decided
by `model_id`.

### Actions

The three actions are configured once and used by every row, so a `[[key]]` anywhere inside one is
replaced with the value of the row it fires on:

| Placeholder     | Value                                                     |
| --------------- | --------------------------------------------------------- |
| `[[entity]]`    | the row's state entity — the one `more-info` opens        |
| `[[power]]`     | the row's start/stop switch, on the kinds that have one   |
| `[[device_id]]` | the row's device id in the Home Assistant registry        |
| `[[name]]`      | the name shown on the row                                 |
| `[[kind]]`      | `docker_container`, `lxc_container`, `virtual_machine`, … |

```yaml
type: custom:mos-card
tap_action:
  action: fire-dom-event
  browser_mod:
    service: browser_mod.popup
    data:
      title: '[[name]]'
      content:
        type: entities
        entities:
          - '[[entity]]'
```

- Quote a placeholder that stands alone as a value — `- '[[entity]]'` — or YAML reads the brackets
  as a nested list.
- An action's own `entity` takes a placeholder too: `entity: '[[power]]'` on a `more-info` action
  opens the row's start/stop switch instead of its state entity.
- Substitution is textual, in the sense `[[ ]]` has in decluttering-card: Jinja and JavaScript are
  not evaluated. An unknown key stays as written; a key the row has no value for becomes empty.
- `toggle` is the one action that does not use the row's state entity — that entity only reports a
  state, so the action goes to the row's start/stop switch. Rows without one ignore it.
- The visual editor has no field for placeholders: Home Assistant's action editor offers an entity
  picker, which cannot hold one. Pick the action in the editor, write the rest in YAML.

### Themes

The card takes its colours from the active theme and follows light and dark without configuration:

| Light                                                                                                                                          | Dark                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://raw.githubusercontent.com/anym001/ha-mos-card/main/assets/containers-light.png" width="400" alt="The card on a light theme"> | <img src="https://raw.githubusercontent.com/anym001/ha-mos-card/main/assets/containers-dark.png" width="400" alt="The card on a dark theme"> |

---

## Troubleshooting

**"Custom element doesn't exist: ha-mos-card"**
The element is `mos-card`: use `type: custom:mos-card`, and for a manual install the file
`mos-card.js`. Remove any resource entry pointing at `ha-mos-card.js` under
**Settings → Dashboards → Resources**.

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**"No MOS devices found"**
Check that the MOS integration is set up and that its devices are not disabled in
**Settings → Devices & services**.

**A container is missing**
Check whether its device is disabled, whether its kind is enabled in `kinds`, and whether a `filter`
or `max_rows` holds it back. Without a `filter`, no device is selected by name.

**Rows show as unavailable**
That is the signal for a failing MOS endpoint: the devices stay, their entities go unavailable.
Check the integration's own diagnostics.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki][troubleshooting].

---

## Contributing

Contributions are welcome — issues and pull requests alike. The repository ships a complete dev
environment (Home Assistant, Node 24, all tooling):

- **Devcontainer:** open the repository in VS Code with the Dev Containers extension →
  **Reopen in Container**
- Then `yarn start` (the card rebuilds on save, Home Assistant on <http://localhost:8123>) and
  `yarn check` before opening a pull request

Branching, commit conventions, the release process and what testing a card change requires are in
[CONTRIBUTING.md](CONTRIBUTING.md). Architecture, the device-selection contract and the build setup
are in [docs/development/ARCHITECTURE.md](docs/development/ARCHITECTURE.md).

> **Note — Transparency:** This card is developed with the help of an AI coding agent (Claude Code).
> It follows Home Assistant frontend conventions, but AI-generated code may not be reviewed and
> tested to the same extent as hand-written code. If something behaves unexpectedly, please
> [open an issue](../../issues).

---

## License

MIT — see [LICENSE](LICENSE).

Maintained by [@anym001][user_profile].

[commits-shield]: https://img.shields.io/github/commit-activity/y/anym001/ha-mos-card.svg?style=for-the-badge
[commits]: https://github.com/anym001/ha-mos-card/commits/main
[license-shield]: https://img.shields.io/github/license/anym001/ha-mos-card.svg?style=for-the-badge
[releases-shield]: https://img.shields.io/github/release/anym001/ha-mos-card.svg?style=for-the-badge
[releases]: https://github.com/anym001/ha-mos-card/releases
[troubleshooting]: https://github.com/thomasloven/hass-config/wiki/Lovelace-Plugins
[user_profile]: https://github.com/anym001
