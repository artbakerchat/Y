#!/usr/bin/env node
/**
 * validate-skills.js
 *
 * Pre-deployment validation for Markdown skill files.
 * Checks frontmatter, required fields, Markdown structure, and file naming.
 *
 * Usage:
 *   node scripts/validate-skills.js               # validate skills/ directory
 *   node scripts/validate-skills.js [dir...]      # validate one or more directories
 *
 * Exit codes:
 *   0  all skills valid
 *   1  one or more skills failed validation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

// ── Configuration ──────────────────────────────────────────────────────────

/** Fields that every skill frontmatter must contain. */
const REQUIRED_FIELDS = ['name', 'description', 'keywords', 'agents'];

/**
 * Valid values for the `agents` field.
 * `*` means the skill is available to all agent profiles.
 */
const KNOWN_AGENTS_PATTERN = /^(\*|[a-z][a-z0-9-]*)(,\s*[a-z][a-z0-9-*]*)*$/;

/** File name must be kebab-case (lowercase letters, digits, hyphens only). */
const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

/** Maximum allowed length (characters) for individual field values. */
const FIELD_MAX_LENGTH = {
  name: 80,
  description: 300,
  keywords: 500,
  agents: 200,
};

/** Minimum body length (characters) after frontmatter is stripped. */
const MIN_BODY_LENGTH = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Minimal YAML frontmatter parser that handles the subset used by skill files:
 *   key: value (string)
 * Multi-line values and nested objects are not supported and will produce an error.
 *
 * Returns { fields: Record<string, string>, error: string|null }.
 */
function parseFrontmatter(raw) {
  const DELIMITER = '---';
  const lines = raw.split('\n');

  // Must start with ---
  if (lines[0].trimEnd() !== DELIMITER) {
    return { fields: null, error: 'Frontmatter block not found — file must start with ---' };
  }

  // Find closing ---
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trimEnd() === DELIMITER);
  if (closeIdx === -1) {
    return { fields: null, error: 'Frontmatter block is not closed — missing closing ---' };
  }

  const frontLines = lines.slice(1, closeIdx);
  const fields = {};

  for (let i = 0; i < frontLines.length; i++) {
    const line = frontLines[i];

    // Skip blank lines
    if (!line.trim()) continue;

    // Detect unsupported constructs
    if (/^\s+/.test(line)) {
      return { fields: null, error: `Frontmatter line ${i + 2}: indented / multi-line values are not supported` };
    }
    if (line.startsWith('-')) {
      return { fields: null, error: `Frontmatter line ${i + 2}: YAML list items are not supported — use a comma-separated string` };
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      return { fields: null, error: `Frontmatter line ${i + 2}: invalid syntax — expected "key: value", got "${line}"` };
    }

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (!key) {
      return { fields: null, error: `Frontmatter line ${i + 2}: key is empty` };
    }
    if (fields[key] !== undefined) {
      return { fields: null, error: `Frontmatter: duplicate key "${key}"` };
    }

    fields[key] = value;
  }

  const body = lines.slice(closeIdx + 1).join('\n');
  return { fields, body, error: null };
}

/**
 * Validate a single skill file.
 * Returns an array of error strings (empty means the file is valid).
 */
function validateSkillFile(filePath) {
  const errors = [];
  const fileName = path.basename(filePath, '.md');
  const dirName = path.basename(path.dirname(filePath));

  // ── 1. File naming ──────────────────────────────────────────────────────

  // Skills in a sub-directory use a canonical SKILL.md name; top-level skills
  // (e.g., skills/*.md) use a kebab-case file name.
  const isCanonicalName = fileName.toUpperCase() === 'SKILL';
  if (!isCanonicalName) {
    if (!KEBAB_CASE_PATTERN.test(fileName)) {
      errors.push(
        `File name "${fileName}.md" is not kebab-case. ` +
        `Use lowercase letters, digits, and hyphens only (e.g., "research-workflow.md").`
      );
    }
  }

  // If the file lives in a sub-directory, the directory name must also be kebab-case.
  if (isCanonicalName && !KEBAB_CASE_PATTERN.test(dirName)) {
    errors.push(
      `Directory name "${dirName}" is not kebab-case. ` +
      `Use lowercase letters, digits, and hyphens only.`
    );
  }

  // ── 2. Read file ────────────────────────────────────────────────────────

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    errors.push(`Cannot read file: ${err.message}`);
    return errors;
  }

  if (!raw.trim()) {
    errors.push('File is empty.');
    return errors;
  }

  // Normalize line endings
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ── 3. Frontmatter ──────────────────────────────────────────────────────

  const { fields, body, error: fmError } = parseFrontmatter(normalized);
  if (fmError) {
    errors.push(`Frontmatter error: ${fmError}`);
    return errors; // remaining checks depend on parsed fields
  }

  // ── 4. Required fields ──────────────────────────────────────────────────

  for (const field of REQUIRED_FIELDS) {
    if (fields[field] === undefined) {
      errors.push(`Missing required frontmatter field: "${field}"`);
    } else if (!fields[field].trim()) {
      errors.push(`Frontmatter field "${field}" is present but empty`);
    }
  }

  // Stop here if required fields are missing — the checks below would be noisy.
  if (errors.length > 0) return errors;

  // ── 5. Field-level validation ───────────────────────────────────────────

  // name: must match kebab-case
  const nameValue = fields.name.trim();
  if (!KEBAB_CASE_PATTERN.test(nameValue)) {
    errors.push(
      `frontmatter "name" value "${nameValue}" is not kebab-case. ` +
      `Use lowercase letters, digits, and hyphens (e.g., "research-workflow").`
    );
  }

  // name: should match directory/file name for canonical SKILL.md files
  if (isCanonicalName && nameValue !== dirName) {
    errors.push(
      `frontmatter "name" ("${nameValue}") does not match the directory name ("${dirName}"). ` +
      `They should be identical so the skill can be looked up by name.`
    );
  }

  // keywords: comma-separated, at least one keyword
  const keywords = fields.keywords
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  if (keywords.length === 0) {
    errors.push('frontmatter "keywords" must contain at least one keyword');
  }
  for (const kw of keywords) {
    if (/\s{2,}/.test(kw)) {
      errors.push(`frontmatter "keywords" contains a keyword with extra whitespace: "${kw}"`);
    }
  }

  // agents: must match known pattern
  const agentsValue = fields.agents.trim();
  if (!KNOWN_AGENTS_PATTERN.test(agentsValue)) {
    errors.push(
      `frontmatter "agents" value "${agentsValue}" is invalid. ` +
      `Expected "*" or a comma-separated list of agent IDs (e.g., "forge" or "forge, researcher").`
    );
  }

  // Field length limits
  for (const [field, maxLen] of Object.entries(FIELD_MAX_LENGTH)) {
    if (fields[field] && fields[field].length > maxLen) {
      errors.push(
        `frontmatter "${field}" is ${fields[field].length} characters — ` +
        `maximum is ${maxLen}`
      );
    }
  }

  // ── 6. Markdown body ────────────────────────────────────────────────────

  const bodyTrimmed = (body || '').trim();

  if (bodyTrimmed.length < MIN_BODY_LENGTH) {
    errors.push(
      `Skill body is too short (${bodyTrimmed.length} chars). ` +
      `A skill should include a meaningful procedure or description (≥ ${MIN_BODY_LENGTH} chars).`
    );
  }

  // Body must contain at least one heading
  if (!/^#{1,6}\s+\S/m.test(bodyTrimmed)) {
    errors.push('Skill body has no headings. Add at least one Markdown heading (e.g., "# Skill: …").');
  }

  // Warn about unpaired code fences (odd number means a fence was left open)
  const fenceMatches = bodyTrimmed.match(/^```/gm) || [];
  if (fenceMatches.length % 2 !== 0) {
    errors.push('Skill body has an unclosed code fence (odd number of ``` markers).');
  }

  // Detect bare HTML tags that may render unexpectedly in Markdown renderers
  if (/<\/?[a-zA-Z][^>]*>/.test(bodyTrimmed)) {
    errors.push(
      'Skill body contains raw HTML tags. Use Markdown syntax instead, ' +
      'or remove the tags if they are not needed.'
    );
  }

  return errors;
}

// ── Directory scanning ─────────────────────────────────────────────────────

/**
 * Recursively collect all *.md files under a directory.
 * Skips node_modules and hidden directories.
 */
function collectMarkdownFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  // Resolve directories to scan
  const rawDirs = process.argv.slice(2);
  const dirsToScan = rawDirs.length > 0
    ? rawDirs.map(d => path.resolve(d))
    : [path.join(repoRoot, 'skills')];

  // Verify the directories exist
  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) {
      console.error(`✗ Directory not found: ${dir}`);
      process.exit(1);
    }
  }

  // Collect all Markdown files
  const files = dirsToScan.flatMap(collectMarkdownFiles);

  if (files.length === 0) {
    console.error('✗ No Markdown skill files found in the specified directories.');
    process.exit(1);
  }

  console.log(`Validating ${files.length} skill file(s)…\n`);

  let totalErrors = 0;
  const failedFiles = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const errors = validateSkillFile(file);

    if (errors.length === 0) {
      console.log(`  ✓  ${rel}`);
    } else {
      console.error(`  ✗  ${rel}`);
      for (const err of errors) {
        console.error(`       • ${err}`);
      }
      totalErrors += errors.length;
      failedFiles.push(rel);
    }
  }

  console.log('');

  if (totalErrors > 0) {
    console.error(
      `❌ Validation failed: ${totalErrors} error(s) in ${failedFiles.length} file(s):\n` +
      failedFiles.map(f => `   - ${f}`).join('\n')
    );
    process.exit(1);
  } else {
    console.log(`✅ All ${files.length} skill file(s) passed validation.`);
    process.exit(0);
  }
}

main();
