# Changelog

## [0.2.2](https://github.com/anym001/ha-mos-card/compare/v0.2.1...v0.2.2) (2026-08-21)


### Features

* **card:** substitute row values into action configs ([ccf8960](https://github.com/anym001/ha-mos-card/commit/ccf89607f683e2d479dad2cae94824511dab3f9e))


### Bug Fixes

* **card:** keep a waiting power button across a detach ([cbad690](https://github.com/anym001/ha-mos-card/commit/cbad690722a4e012df34e5940fd7a90651452a9d))
* **card:** never subscribe or re-render on a detached element ([d39f37a](https://github.com/anym001/ha-mos-card/commit/d39f37a9e87401419011efe8f4aab875bfac0eb8))
* **card:** only link out to a URL a browser should follow ([6a63307](https://github.com/anym001/ha-mos-card/commit/6a633071fab4f46d02edfe98c5a4b9058e1f987b))
* **card:** open the entity a more-info action names ([aa5141e](https://github.com/anym001/ha-mos-card/commit/aa5141ea12acd535083637547bf04b4bf33ef518))
* **card:** re-render when an update badge appears or clears ([df62ac0](https://github.com/anym001/ha-mos-card/commit/df62ac0732b656b86e7cb8b002b78c92c7801170))
* **devices:** list devices that hang off no known server ([ae8a0af](https://github.com/anym001/ha-mos-card/commit/ae8a0afa00938e8e0820fd3d36d8e600bbe2c281))
* **editor:** correct what the hint says about action targets ([edffed2](https://github.com/anym001/ha-mos-card/commit/edffed2b9eb18cb4146a9793e070ccb55e76c46d))
* **editor:** drop the kinds key instead of writing an empty list ([b3fe61e](https://github.com/anym001/ha-mos-card/commit/b3fe61e18a8a199cfecf58621680383030c9efe8))
* **localize:** call them rows in the action hint ([b01e89f](https://github.com/anym001/ha-mos-card/commit/b01e89ffd4cb049dd12f9312e18a01a486665321))
* **localize:** follow Home Assistant's language, not localStorage ([f637534](https://github.com/anym001/ha-mos-card/commit/f637534f89de59d50c6d7affcc7ad9c6a624bc2a))
* **localize:** stop reading a device name as a replacement pattern ([d2fd6b9](https://github.com/anym001/ha-mos-card/commit/d2fd6b94c8566800ca28da8935794d8de3057abf))

## [0.2.1](https://github.com/anym001/ha-mos-card/compare/v0.2.0...v0.2.1) (2026-08-19)


### Features

* **card:** badge devices reporting a fault ([76a66aa](https://github.com/anym001/ha-mos-card/commit/76a66aa074fda66df59ef7d7562d30be986fef33))
* **card:** badge devices with a waiting update ([2e27aa5](https://github.com/anym001/ha-mos-card/commit/2e27aa57e643f5aee2776cb381c49b39368a23d8))
* **card:** declare the card's footprint for the sections layout ([d71448a](https://github.com/anym001/ha-mos-card/commit/d71448a37046b19c17e13ed6db9b96e726417759))
* **card:** filter rows by name and cap how many a group lists ([46b5cf9](https://github.com/anym001/ha-mos-card/commit/46b5cf9b26c6d3cdef8827896e10d548941ad242))
* **card:** offer a confirmation before stopping a guest ([aa6a891](https://github.com/anym001/ha-mos-card/commit/aa6a8910ae647d65920908cf0256f67c4739365f))
* **card:** offer compact rows and a multi-column layout ([c29202b](https://github.com/anym001/ha-mos-card/commit/c29202bea9a46db64af4146ece4b20fdeaa0d69e))
* **card:** offer sorting rows by state ([0323600](https://github.com/anym001/ha-mos-card/commit/03236009b814280746b54cd513a5e469a98c01eb))
* **card:** show a measurement beside each row's state ([d334a27](https://github.com/anym001/ha-mos-card/commit/d334a270125db5c2f0256d3b15e4ae390d4da5a6))
* **card:** show the power button waiting for the server ([cd2d566](https://github.com/anym001/ha-mos-card/commit/cd2d566dc5d0efa9c2af1bde2d3a0c3b4a4181db))
* **card:** summarise the server beside its name ([274b265](https://github.com/anym001/ha-mos-card/commit/274b26576c0b2e3b8b18b8f252bc8868005feb59))
* **editor:** expose the tap, hold and double tap actions ([af714de](https://github.com/anym001/ha-mos-card/commit/af714de7284d852733c6cc023ab6784bdea38fe3))
* **editor:** show the action note as a visible line ([740cde8](https://github.com/anym001/ha-mos-card/commit/740cde831704c864d9347f6b1e553d16d01868dd))


### Bug Fixes

* **card:** cap columns at two, the widest a card ever gets ([0a0de42](https://github.com/anym001/ha-mos-card/commit/0a0de42de2f80035d8e9aa609b64d4bbbd939e5b))
* **card:** toggle the power switch, not the state sensor ([4fd92ca](https://github.com/anym001/ha-mos-card/commit/4fd92ca56c96dcdf153781562739238ee9812aae))

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
