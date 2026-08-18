# Contribution guidelines

Contributing to this project should be as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features

## GitHub is used for everything

GitHub is used to host code, to track issues and feature requests, as well as accept pull requests.

Pull requests are the best way to propose changes to the codebase.

1. Create your branch from `main` (see [Branching model](#branching-model)).
2. Run `yarn setup` — dependencies plus the pre-commit hooks, in one command.
3. If you've changed something, update the documentation.
4. Make sure your code passes all checks: `yarn check` runs lint, type check, markdownlint,
   the formatting check and the build, in that order.
5. Test your contribution — see [Testing your change](#testing-your-change).
6. Open a pull request against `main`.

## Branching model

`main` is the only long-lived branch and is always release-ready.

| Branch      | Purpose                                                                                                                                                                       | Protected |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `main`      | release-ready; [release-please](https://github.com/googleapis/release-please) opens a release PR from Conventional Commits, and merging it tags `vX.Y.Z` and cuts the release | yes       |
| `feature/*` | short-lived work on a single topic; deleted after merge                                                                                                                       | –         |

Keep **Settings → General → "Automatically delete head branches"** enabled — it cleans up merged
branches so only `main` remains on the remote.

### Workflow

```text
feature/xyz ──PR──▶ main ──release-please──▶ Release (vX.Y.Z)
```

1. **Branch** from `main`: `git switch main && git pull && git switch -c feature/xyz`.
2. **Test locally** before opening the PR: `yarn check`, and the card itself in a Home Assistant
   instance.
3. **Open a PR against `main`.** `Lint`, `Test build` and `guard` must be green. On
   `HACS validation`, see the note under [Branch protection](#branch-protection).
4. **Merge with "Rebase and merge".** It is the only method enabled on this repository, and that
   has a consequence worth knowing — see below.
5. **Releases are automatic.** On push to `main`, release-please maintains a release PR; merging
   that PR pushes the `vX.Y.Z` tag, bumps `package.json` and `src/const.ts`, and attaches the built
   `dist/mos-card.js` to the release. That asset is what HACS downloads. There is no manual tag
   step, and neither version is ever edited by hand.

> [!IMPORTANT]
> Because merging is **rebase-only**, every commit you write lands on `main` individually — so
> **every commit subject** has to be a valid Conventional Commit, not just the pull request title.
> Under a squash workflow only the final subject would matter and intermediate work-in-progress
> commits could be sloppy; that is not the case here. The `commitlint` hook enforces it locally,
> and `yarn setup` is what turns it on, so run that before you start.
>
> The upside is that the changelog reads commit by commit, and a merge commit's subject never gets
> counted alongside the commits it contains.

### Versioning

The project is pre-1.0, and the release-please config (`bump-minor-pre-major` +
`bump-patch-for-minor-pre-major`) keeps every bump small:

| Commit type                    | Effect while pre-1.0 | Effect from 1.0.0 |
| ------------------------------ | -------------------- | ----------------- |
| `fix:` / `perf:`               | patch                | patch             |
| `feat:`                        | patch                | minor             |
| `!` or `BREAKING CHANGE:`      | minor                | major             |
| `chore:` `ci:` `docs:` `test:` | no release at all    | no release at all |

That last row surprises people: a pull request consisting only of dependency bumps or CI work
produces no release, so its changes sit on `main` until the next `fix:` or `feat:` ships one.

### Branch protection

`main` is protected by a **ruleset** (GitHub → **Settings → Rules → Rulesets**, the newer system —
note that the older `protected` flag in the branches API stays `false` for rulesets, so it is not a
reliable way to check). Work on a branch and open a pull request; do not push to `main` directly.

> [!WARNING]
> If you extend the ruleset with required status checks, do **not** add `HACS validation` while its
> images sub-check still fails for want of a screenshot in the README — requiring it would block
> every merge. `Lint`, `Test build` and `guard` are safe to require.

## Any contributions you make will be under the MIT Software License

In short, when you submit code changes, your submissions are understood to be under the same
[MIT License](http://choosealicense.com/licenses/mit/) that covers the project. Feel free to
contact the maintainers if that's a concern.

## Report bugs using GitHub's [issues](../../issues)

GitHub issues are used to track public bugs. Report a bug by
[opening a new issue](../../issues/new/choose); it's that easy!

The bug form asks for the card version, the integration version and your browser on purpose. A card
runs in the browser, so **the browser console and your card YAML are usually what actually locate
the problem** — please include both.

If a device is missing from the card, check first whether it is missing from
**Settings → Devices & services** as well. The card renders what the MOS integration registers, so
a device that is not there at all is an integration issue and belongs in
[anym001/ha-mos](https://github.com/anym001/ha-mos/issues).

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce — be specific, and give the card's YAML
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or things you tried that didn't
  work)

People _love_ thorough bug reports. I'm not even kidding.

## Use a consistent coding style

This project uses:

- [ESLint](https://eslint.org/) with the TypeScript and Prettier plugins for linting
- [Prettier](https://prettier.io/) for formatting, including Markdown, YAML and JSON
- [TypeScript](https://www.typescriptlang.org/) in strict mode
- [markdownlint](https://github.com/DavidAnson/markdownlint) for the documentation

`yarn setup` wires all of these into the commit through the pre-commit hooks, and the `Lint`
workflow runs the same commands in CI, so a clean commit is a clean pull request.

> [!IMPORTANT]
> A green `yarn build` is **not** a green type check. `@rollup/plugin-typescript` reports type
> errors as warnings and still emits a bundle, so `yarn build` exits 0 on code that does not
> type-check. Run `yarn typecheck` — it is the only command that fails on one, and `yarn check`
> includes it for exactly that reason.

## Code quality

The card follows Lit 3 and Home Assistant frontend conventions: `@property` for reactive inputs and
`@state` for internal state, configuration validated in `setConfig`, theme variables instead of
hardcoded colours, and no user-facing string outside the localization files.

One rule matters more than the rest:

> [!CAUTION]
> Devices are selected by their `model_id`, scoped to a server through `via_device_id`. Device
> `identifiers` and display names are **never** matched — the first is an internal format the
> integration reserves the right to change, the second belongs to the user. This is a released,
> public contract. Read
> [docs/development/ARCHITECTURE.md](docs/development/ARCHITECTURE.md) and the integration's own
> decision log before changing how matching works.

Architecture, the row-composition rules and the CI layout are all in
[docs/development/ARCHITECTURE.md](docs/development/ARCHITECTURE.md).

## AI-assisted contributions

AI tools may be used for any part of a contribution. What matters is that the pull request says
honestly how far the code was reviewed and tested: fill in the **Verification context** block in
the pull request template. AI usage, human review, automated testing and real-world testing are
separate facts, and a green `Lint` workflow is not a claim that anyone understood the change.

## Adding a dependency

| Add to            | For                                                                        |
| ----------------- | -------------------------------------------------------------------------- |
| `dependencies`    | Something the built card bundles and ships to the browser                  |
| `devDependencies` | Build tooling, linters, type checking — anything that never reaches `dist` |

This repository is **Yarn only**. Run `yarn add` / `yarn add -D`, never `npm install`: npm writes a
`package-lock.json` that would become a second, silently diverging source of dependency versions.
The `Prevent npm lockfiles` workflow fails the build if one is ever committed.

Commit the updated `yarn.lock` alongside `package.json` — CI installs with `--immutable` and fails
if the two disagree.

## Testing your change

> [!NOTE]
> **This repository has no automated test suite.** Every check in CI is a linter, a type check or a
> build. Nothing verifies that the card renders correctly, so testing a change means running it.

The devcontainer gives you a Home Assistant instance with the card already wired up:

1. Open the repository in VS Code with the Dev Containers extension → **Reopen in Container**.
2. Home Assistant starts at <http://localhost:8123>, log in with `dev` / `dev`.
3. `yarn start` rebuilds the card on every save.

For a change to device selection or rendering, that instance needs the MOS integration configured
against a real server — a card that compiles is not a card that works.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.
