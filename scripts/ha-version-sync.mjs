#!/usr/bin/env node
/**
 * Validate that every statement about the minimum Home Assistant version agrees.
 *
 * The equivalent script in the `ha-mos` repository reconciles four sources,
 * because an integration has four: a pytest harness pinned to a release train,
 * `hacs.json`, a devcontainer `HA_VERSION`, and the CI workflows. A card has
 * none of those. It is not built against Home Assistant, it is not tested
 * against a pinned core, and its devcontainer tracks `latest` — so there is
 * exactly one machine-readable source here, `hacs.json`, and everything else
 * that names a version is prose.
 *
 * Prose is what drifts. `hacs.json` is what HACS enforces, so it is the source
 * of truth, and this checks that the documentation still tells users the same
 * thing it does. It also fails on a version hardcoded into a workflow, which is
 * how a second source of truth gets created by accident.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const checked = [];

const read = (relative) => readFileSync(join(root, relative), 'utf8');

/** Home Assistant's calendar versioning: YYYY.M or YYYY.M.P, no zero padding. */
const HA_VERSION = /^(20\d{2})\.(\d{1,2})(?:\.(\d+))?$/;

// ---------------------------------------------------------------- the source

const hacs = JSON.parse(read('hacs.json'));
const declared = hacs.homeassistant;

if (!declared) {
  errors.push(
    'hacs.json has no "homeassistant" key. Without it HACS offers the card on ' +
      'any core, including ones the integration itself refuses to run on.',
  );
} else if (!HA_VERSION.test(declared)) {
  errors.push(`hacs.json "homeassistant" is "${declared}", which is not a Home Assistant version (YYYY.M[.P]).`);
} else {
  checked.push(`hacs.json declares Home Assistant ${declared}`);
}

/** The release train, e.g. 2026.8 for 2026.8.0 — what prose usually names. */
const train = declared?.split('.').slice(0, 2).join('.');

// ------------------------------------------------------- the prose that must agree

if (declared) {
  for (const file of ['README.md', 'docs/development/ARCHITECTURE.md']) {
    const text = read(file);
    const mentions = [...text.matchAll(/(20\d{2}\.\d{1,2}(?:\.\d+)?)/g)].map((m) => m[1]);
    const disagreeing = mentions.filter((v) => v !== declared && !v.startsWith(`${train}.`) && v !== train);

    if (!mentions.length) {
      errors.push(`${file} never states the minimum Home Assistant version. It must say ${train}, as hacs.json does.`);
    } else if (disagreeing.length) {
      errors.push(
        `${file} names Home Assistant ${[...new Set(disagreeing)].join(', ')} but hacs.json declares ${declared}.`,
      );
    } else {
      checked.push(`${file} agrees on ${train}`);
    }
  }
}

// ------------------------------------------------- no second source of truth

const workflows = join(root, '.github/workflows');
let pinned = false;

for (const name of existsSync(workflows) ? readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f)) : []) {
  const text = read(join('.github/workflows', name));
  const pins = [...text.matchAll(/HA_VERSION\s*[:=]\s*["']?(20\d{2}\.\d[^\s"']*)/g)].map((m) => m[1]);

  if (pins.length) {
    pinned = true;
    errors.push(
      `.github/workflows/${name} hardcodes Home Assistant ${pins.join(', ')}. ` +
        'Pin it in hacs.json instead, or the two drift apart silently.',
    );
  }
}

if (!pinned) {
  checked.push('no workflow pins a Home Assistant version');
}

// ------------------------------------------- the devcontainer, if ever pinned

const devcontainer = JSON.parse(read('.devcontainer/devcontainer.json').replace(/^\s*\/\/.*$/gm, ''));
const tag = String(devcontainer.image ?? '').split(':')[1];

if (tag && tag !== 'latest' && HA_VERSION.test(tag) && !tag.startsWith(`${train}.`) && tag !== train) {
  errors.push(`.devcontainer/devcontainer.json pins image tag "${tag}", which is not on the ${train} release train.`);
} else {
  checked.push(`devcontainer image tag "${tag || 'latest'}" imposes no conflicting version`);
}

// ------------------------------------------------------------------- verdict

for (const line of checked) {
  console.log(`  ok   ${line}`);
}

if (errors.length) {
  console.error('');
  for (const line of errors) {
    console.error(`  FAIL ${line}`);
  }
  console.error(`\n${errors.length} Home Assistant version inconsistency/-ies found.`);
  process.exit(1);
}

console.log('\nHome Assistant version sources are consistent.');
