#!/usr/bin/env node
/**
 * validate-profiles.js
 * 
 * Ensures agent profiles are kept in sync across JavaScript and Python runtimes.
 * Runs as part of CI to catch profile drift before deployment.
 * 
 * Usage: node scripts/validate-profiles.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import profilesData from '../agentcore/profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const PROFILES_JS = path.join(repoRoot, 'agentcore', 'profiles.js');
const BUNDLED_PROFILES_JSON = path.join(repoRoot, 'app', 'ForgeAgent', 'profiles.json');
const JS_AGENTS = path.join(repoRoot, 'src', 'agents.js');
const PY_PROFILES = path.join(repoRoot, 'app', 'ForgeAgent', 'forge_profiles.py');

let errors = [];

// Check that the JavaScript registry exists. A regular module works in both
// Node.js tests and Cloudflare Workers without JSON import attributes.
if (!fs.existsSync(PROFILES_JS)) {
  errors.push("Missing profiles.js at " + PROFILES_JS);
} else {
  console.log("Found profiles.js");
}

// Check that Python profiles module exists
if (!fs.existsSync(PY_PROFILES)) {
  errors.push("Missing forge_profiles.py at " + PY_PROFILES);
} else {
  console.log("Found forge_profiles.py");
}

// Load the canonical JavaScript registry.
const profiles = profilesData.profiles || {};
console.log("Loaded profiles.js (" + Object.keys(profiles).length + " profiles)");

// AgentCore CodeZip deployments package app/ForgeAgent independently, so its
// bundled registry must remain equivalent to the canonical one.
try {
  const bundled = JSON.parse(fs.readFileSync(BUNDLED_PROFILES_JSON, "utf-8")).profiles || {};
  if (JSON.stringify(bundled) !== JSON.stringify(profiles)) {
    errors.push("Bundled Python profiles.json is out of sync with agentcore/profiles.js");
  } else {
    console.log("Bundled Python profile registry is synchronized");
  }
} catch (error) {
  errors.push("Failed to load bundled Python profiles.json: " + error.message);
}

// Validate each profile structure
for (const [profileId, profile] of Object.entries(profiles)) {
  const checks = [
    { key: 'id', type: 'string' },
    { key: 'name', type: 'string' },
    { key: 'description', type: 'string' },
    { key: 'systemPrompt', type: 'string' },
    { key: 'toolNames', type: 'array' },
    { key: 'skillNames', type: 'string' },
    { key: 'dailyRequestLimit', type: 'number' },
    { key: 'maxToolCallsPerRequest', type: 'number' },
  ];
  
  for (const check of checks) {
    const value = profile[check.key];
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== check.type) {
      errors.push(
        `✗ Profile '${profileId}': ${check.key} must be ${check.type}, got ${actualType}`
      );
    }
  }
}

// The JavaScript runtime loads this canonical registry from profiles.js.
const jsContent = fs.readFileSync(JS_AGENTS, 'utf-8');
// Profile IDs are intentionally not duplicated in agents.js; it imports the
// JavaScript registry at runtime. Keep this compatibility loop empty.
const jsProfileIds = [];
for (const profileId of jsProfileIds) {
  if (!jsContent.includes(`'${profileId}'`) && !jsContent.includes(`"${profileId}"`)) {
    errors.push(`✗ JS agents.js does not reference profile '${profileId}'`);
  }
}

// Check that all profile dailyRequestLimit and maxToolCallsPerRequest are reasonable
for (const [profileId, profile] of Object.entries(profiles)) {
  if (profile.dailyRequestLimit < 1 || profile.dailyRequestLimit > 100) {
    errors.push(
      `✗ Profile '${profileId}': dailyRequestLimit ${profile.dailyRequestLimit} is outside reasonable range [1, 100]`
    );
  }
  if (profile.maxToolCallsPerRequest < 1 || profile.maxToolCallsPerRequest > 50) {
    errors.push(
      `✗ Profile '${profileId}': maxToolCallsPerRequest ${profile.maxToolCallsPerRequest} is outside reasonable range [1, 50]`
    );
  }
}

// Report results
if (errors.length > 0) {
  console.error('\n❌ Validation failed:\n');
  errors.forEach(error => console.error(error));
  process.exit(1);
} else {
  console.log('\n✅ All profiles valid and synchronized');
  process.exit(0);
}
