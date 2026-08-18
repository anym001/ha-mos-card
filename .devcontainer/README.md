# Devcontainer

A Home Assistant instance with the card already wired into it, so a change can be looked at
rather than only compiled.

## Getting started

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).
2. Open the repository in VS Code and choose **Reopen in Container** (`Ctrl+Shift+P` →
   "Dev Containers: Reopen in Container"). The first build takes a few minutes.
3. Home Assistant comes up on <http://localhost:8123>, log in with `dev` / `dev`.
4. Add the card to a dashboard from the GUI — the resource is already registered.

Nothing needs to be started by hand. `postCreateCommand` runs `yarn setup` once, and
`postStartCommand` runs `container launch & yarn start & wait` on every container start, so
Home Assistant and the Rollup watcher are both up whenever the container is.

Saving a source file rebuilds the bundle; reload the browser to pick it up.

## How the card reaches Home Assistant

Three settings in `devcontainer.json` do it:

| Setting                            | Effect                                                |
| ---------------------------------- | ----------------------------------------------------- |
| `dist` → `/config/www/workspace`   | The built bundle lands inside Home Assistant's `www`  |
| `.devcontainer/config` → `/config` | `configuration.yaml` below is Home Assistant's config |
| `LOVELACE_REMOTE_FILES`            | Registers `http://localhost:5000/mos-card.js` for you |

Port 5000 is the Rollup dev server, 8123 is Home Assistant.

## What this instance can and cannot prove

`config/configuration.yaml` is deliberately minimal — `default_config:` and nothing else of
substance. There is **no MOS integration here**, so there are no devices carrying a `model_id`.

That means the instance is good for: the card loading at all, the visual editor opening, the
config options taking effect, and the empty and error states rendering.

It cannot show that device selection works. For that the integration has to be installed and
configured against a real MOS server — see the note in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#testing-your-change).

## Commands

```bash
yarn start    # Rollup watcher on port 5000 (already running in the container)
yarn check    # Everything CI runs - lint, typecheck, markdownlint, format, build
yarn build    # Lint + production bundle
```

The full command table is in
[`docs/development/ARCHITECTURE.md`](../docs/development/ARCHITECTURE.md).

## File structure

```text
.devcontainer/
├── devcontainer.json       # Container image, mounts, ports, lifecycle commands
├── config/
│   └── configuration.yaml  # Mounted as Home Assistant's /config
└── README.md               # This file
```

## Base image

`ghcr.io/custom-cards/custom-card-devcontainer:latest`, running as user `vscode`. It ships the
`container` helper that `postStartCommand` uses to launch Home Assistant.

## Troubleshooting

**Container won't start** — `Ctrl+Shift+P` → "Dev Containers: Rebuild Container".

**Port already in use** — `lsof -i :5000` / `lsof -i :8123`.

**Dependencies out of sync** — `rm -rf node_modules && yarn install`.

**The card does not appear after a change** — the watcher rebuilds, the browser caches. Hard
reload with `Ctrl+Shift+R` / `Cmd+Shift+R`.

## Further reading

- [Home Assistant custom card development](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/)
- [Dev Containers documentation](https://code.visualstudio.com/docs/remote/containers)
- [Lit documentation](https://lit.dev/)
