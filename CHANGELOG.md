# Changelog

## [0.2.0](https://github.com/anym001/ha-mos-card/compare/v0.1.2...v0.2.0) (2026-08-18)


### ⚠ BREAKING CHANGES

* **card:** `type: custom:ha-mos-card` must become `type: custom:mos-card`. Manual installs also need the resource URL repointed, since the file is now `mos-card.js`.

### Features

* **card:** rename the custom element to mos-card ([92c94d4](https://github.com/anym001/ha-mos-card/commit/92c94d45b56b020e6e01ca3a57d2ecfc9e29a0d7))
* **config:** declare the minimum Home Assistant version ([5c2b21e](https://github.com/anym001/ha-mos-card/commit/5c2b21e0a5c2023717c3a0195d87314dd6b74d3d))


### Bug Fixes

* **card:** follow the icons the integration declares ([287356a](https://github.com/anym001/ha-mos-card/commit/287356ad1b894064a44fad720dba0b90dff77fa9))
* **editor:** make the server picker work again ([c8d2680](https://github.com/anym001/ha-mos-card/commit/c8d268021232971df6f887ecc38d920ac37eb6a8))
* **localize:** call the power control a button, not a switch ([d5f615e](https://github.com/anym001/ha-mos-card/commit/d5f615e03a3e8b8fab2d77ec17e2bf7b755fb5ee))

## [0.1.2](https://github.com/anym001/ha-mos-card/compare/v0.1.1...v0.1.2) (2026-08-17)


### Features

* **card:** draw each device as a tile instead of a list row ([b9efceb](https://github.com/anym001/ha-mos-card/commit/b9efceb97690cff395b98117299a4eefc4c38734))


### Bug Fixes

* **build:** emit decorated fields with accessor semantics ([68a24c2](https://github.com/anym001/ha-mos-card/commit/68a24c2bcb2113cf8c53d6cf7c6d88c82f1657ae))
* **card:** show the state the way Home Assistant does ([2eb20c3](https://github.com/anym001/ha-mos-card/commit/2eb20c3c2f186abee0661362e467387a0075de22))

## [0.1.1](https://github.com/anym001/ha-mos-card/compare/1e40a4c9d72f3ca939c9b8d7f9f7091967ae3567...v0.1.1) (2026-08-17)


### Features

* **card:** render MOS devices from the device registry ([9ddf9be](https://github.com/anym001/ha-mos-card/commit/9ddf9bed902854a677456c21f0bd09e24f53550b))
* turn the boilerplate clone into the MOS NAS card ([635434a](https://github.com/anym001/ha-mos-card/commit/635434aea493829420e3fee2de0dfc96b63d9483))


### Bug Fixes

* **build:** tag releases as v0.1.1 instead of ha-mos-card-v0.1.1 ([1152ce3](https://github.com/anym001/ha-mos-card/commit/1152ce3954bde8ada7caf2f286df3b0269095363))
