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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const PROFILES_JSON = path.join(repoRoot, 'agentcore', 'profiles.json');
const JS_AGENTS = path.join(repoRoot, 'src', 'agents.js');
const PY_PROFILES = path.join(repoRoot, 'app', 'ForgeAgent', 'forge_profiles.py');

let errors = [];

// Check that profiles.json exists
if (!fs.existsSync(PROFILES_JSON)) {
  errors.push(`✗ Missing profiles.json at ${PROFILES_JSON}`);
} else {
  console.log(`✓ Found profiles.json`);
}

// Check that Python profiles module exists
if (!fs.existsSync(PY_PROFILES)) {
  errors.push(`✗ Missing forge_profiles.py at ${PY_PROFILES}`);
} else {
  console.log(`✓ Found forge_profiles.py`);
}

// Load and parse profiles.json
let profiles = {};
try {
  const content = fs.readFileSync(PROFILES_JSON, 'utf-8');
  profiles = JSON.parse(content).profiles || {};
  console.log(`✓ Parsed profiles.json (${Object.keys(profiles).length} profiles)`);
} catch (error) {
  errors.push(`✗ Failed to parse profiles.json: ${error.message}`);
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

// Check that JS agents.js references the profiles
const jsContent = fs.readFileSync(JS_AGENTS, 'utf-8');
const jsProfileIds = Object.keys(profiles);
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
