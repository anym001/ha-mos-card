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
- **The list stays current.** A container you delete on the NAS disappears from the card and a new
  one shows up on its own — no editing the card, no manual refresh.
- **Renaming is safe.** The card never matches devices by name, so you can rename a container in
  Home Assistant without breaking anything.
- **A broken endpoint does not empty the card.** Devices behind a failing MOS endpoint keep their
  rows and go unavailable, which is a different thing from being gone.

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
| `kinds`             | list    | Which device kinds to render (see below).                                | all six             |
| `group_by_kind`     | boolean | Show a heading above each kind.                                          | `true`              |
| `show_icon`         | boolean | Show the row icon.                                                       | `true`              |
| `show_state`        | boolean | Show the state value on each row.                                        | `true`              |
| `show_link`         | boolean | Show a link button where the device has a URL.                           | `true`              |
| `show_power`        | boolean | Show the start/stop switch on guest rows.                                | `true`              |
| `hide_unavailable`  | boolean | Hide rows whose state is unavailable or unknown.                         | `false`             |
| `tap_action`        | object  | Action for a tap on the row body, applied to that row's state entity.    | `action: more-info` |
| `hold_action`       | object  | Action for a 500 ms hold.                                                | `action: none`      |
| `double_tap_action` | object  | Action for a double tap.                                                 | `action: none`      |

Valid values for `kinds`: `docker_container`, `lxc_container`, `virtual_machine`, `disk`,
`storage_pool`, `ups`. Anything else is a configuration error and the card says so, rather than
silently rendering an empty list.

The visual editor offers all of these, so the YAML above is only needed if you prefer it.

---

## Troubleshooting

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**"No MOS devices found"**
Check that the MOS integration is set up and that its devices are not disabled in
**Settings → Devices & services**. The integration must be recent enough to mark what kind of thing
each device is.

**A container is missing**
Check whether its device is disabled, and whether its kind is enabled in the card's `kinds` option.
Rows are never matched by name, so renaming is not the cause.

**Rows show as unavailable**
That is the intended signal for a MOS endpoint that is failing: the devices stay, their entities go
unavailable. Check the integration's own diagnostics.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki][troubleshooting].

---

## Contributing

Contributions are welcome — issues and pull requests alike. The repository ships a complete dev
environment (Home Assistant, Node 24, all tooling):

- **Devcontainer:** open the repository in VS Code with the Dev Containers extension →
  **Reopen in Container**
- Then: `yarn start` (the card rebuilds on save, Home Assistant on <http://localhost:8123>),
  `yarn build`, `yarn typecheck`

How to contribute — branching, commit conventions, the release process and what testing a card
change actually requires — is in [CONTRIBUTING.md](CONTRIBUTING.md). Architecture, the
device-selection contract and the build setup are in
[docs/development/ARCHITECTURE.md](docs/development/ARCHITECTURE.md).

> [!NOTE]
> **Transparency:** This card was developed with the help of an AI coding agent (Claude Code). It
> follows Home Assistant frontend conventions, but AI-generated code may not be reviewed and tested
> to the same extent as hand-written code. If something behaves unexpectedly, please
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
