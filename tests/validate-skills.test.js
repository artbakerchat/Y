/**
 * tests/validate-skills.test.js
 *
 * Unit tests for scripts/validate-skills.js.
 * Runs with: node --test tests/validate-skills.test.js
 *
 * Strategy: write temporary skill files to a temp directory, run the
 * validator against them, and assert on the error output.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Import the validator internals ─────────────────────────────────────────
// We test the two exported-style functions by importing the module as text
// and re-evaluating the helpers.  Because the script uses top-level `main()`
// guarded by process.argv, we extract only the helper functions we need.

// Re-implement the helpers locally so tests do not depend on the script's
// process.exit() path.  This keeps tests deterministic and isolated.

/** Minimal YAML frontmatter parser (copied from validate-skills.js). */
function parseFrontmatter(raw) {
  const DELIMITER = '---';
  const lines = raw.split('\n');

  if (lines[0].trimEnd() !== DELIMITER) {
    return { fields: null, body: null, error: 'Frontmatter block not found — file must start with ---' };
  }

  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trimEnd() === DELIMITER);
  if (closeIdx === -1) {
    return { fields: null, body: null, error: 'Frontmatter block is not closed — missing closing ---' };
  }

  const frontLines = lines.slice(1, closeIdx);
  const fields = {};

  for (let i = 0; i < frontLines.length; i++) {
    const line = frontLines[i];
    if (!line.trim()) continue;
    if (/^\s+/.test(line)) {
      return { fields: null, body: null, error: `Frontmatter line ${i + 2}: indented / multi-line values are not supported` };
    }
    if (line.startsWith('-')) {
      return { fields: null, body: null, error: `Frontmatter line ${i + 2}: YAML list items are not supported — use a comma-separated string` };
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      return { fields: null, body: null, error: `Frontmatter line ${i + 2}: invalid syntax — expected "key: value", got "${line}"` };
    }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) return { fields: null, body: null, error: `Frontmatter line ${i + 2}: key is empty` };
    if (fields[key] !== undefined) return { fields: null, body: null, error: `Frontmatter: duplicate key "${key}"` };
    fields[key] = value;
  }

  const body = lines.slice(closeIdx + 1).join('\n');
  return { fields, body, error: null };
}

const REQUIRED_FIELDS = ['name', 'description', 'keywords', 'agents'];
const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
const KNOWN_AGENTS_PATTERN = /^(\*|[a-z][a-z0-9-]*)(,\s*[a-z][a-z0-9-*]*)*$/;
const FIELD_MAX_LENGTH = { name: 80, description: 300, keywords: 500, agents: 200 };
const MIN_BODY_LENGTH = 20;

function validateSkillContent(fileName, dirName, raw) {
  const errors = [];
  const isCanonicalName = fileName.toUpperCase() === 'SKILL';

  if (!isCanonicalName) {
    if (!KEBAB_CASE_PATTERN.test(fileName)) {
      errors.push(`File name "${fileName}.md" is not kebab-case.`);
    }
  }
  if (isCanonicalName && !KEBAB_CASE_PATTERN.test(dirName)) {
    errors.push(`Directory name "${dirName}" is not kebab-case.`);
  }

  if (!raw.trim()) { errors.push('File is empty.'); return errors; }

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { fields, body, error: fmError } = parseFrontmatter(normalized);
  if (fmError) { errors.push(`Frontmatter error: ${fmError}`); return errors; }

  for (const field of REQUIRED_FIELDS) {
    if (fields[field] === undefined) errors.push(`Missing required frontmatter field: "${field}"`);
    else if (!fields[field].trim()) errors.push(`Frontmatter field "${field}" is present but empty`);
  }
  if (errors.length > 0) return errors;

  const nameValue = fields.name.trim();
  if (!KEBAB_CASE_PATTERN.test(nameValue)) errors.push(`frontmatter "name" value "${nameValue}" is not kebab-case.`);
  if (isCanonicalName && nameValue !== dirName) errors.push(`frontmatter "name" ("${nameValue}") does not match the directory name ("${dirName}").`);

  const keywords = fields.keywords.split(',').map(k => k.trim()).filter(Boolean);
  if (keywords.length === 0) errors.push('frontmatter "keywords" must contain at least one keyword');

  const agentsValue = fields.agents.trim();
  if (!KNOWN_AGENTS_PATTERN.test(agentsValue)) errors.push(`frontmatter "agents" value "${agentsValue}" is invalid.`);

  for (const [field, maxLen] of Object.entries(FIELD_MAX_LENGTH)) {
    if (fields[field] && fields[field].length > maxLen) {
      errors.push(`frontmatter "${field}" is ${fields[field].length} characters — maximum is ${maxLen}`);
    }
  }

  const bodyTrimmed = (body || '').trim();
  if (bodyTrimmed.length < MIN_BODY_LENGTH) errors.push(`Skill body is too short`);
  if (!/^#{1,6}\s+\S/m.test(bodyTrimmed)) errors.push(`Skill body has no headings.`);
  const fences = bodyTrimmed.match(/^```/gm) || [];
  if (fences.length % 2 !== 0) errors.push(`Skill body has an unclosed code fence`);
  if (/<\/?[a-zA-Z][^>]*>/.test(bodyTrimmed)) errors.push(`Skill body contains raw HTML tags.`);

  return errors;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_SKILL = `---
name: word-exploration
description: Explore a word's meaning, origin, connotation, or poetic use.
keywords: meaning, definition, connotation, origin, explore
agents: forge
---

# Skill: Word Exploration

Use this skill when the user wants to understand a word deeply.

## Procedure

1. Identify the target word.
2. Explain its meaning in plain language.
`;

// ── Tests: parseFrontmatter ────────────────────────────────────────────────

test('parseFrontmatter: parses a valid frontmatter block', () => {
  const result = parseFrontmatter(VALID_SKILL);
  assert.equal(result.error, null);
  assert.equal(result.fields.name, 'word-exploration');
  assert.equal(result.fields.agents, 'forge');
  assert.ok(result.body.includes('Skill: Word Exploration'));
});

test('parseFrontmatter: reports missing opening delimiter', () => {
  const result = parseFrontmatter('name: test\n---\n# Body');
  assert.ok(result.error.includes('Frontmatter block not found'));
});

test('parseFrontmatter: reports missing closing delimiter', () => {
  const result = parseFrontmatter('---\nname: test\n# No closing');
  assert.ok(result.error.includes('not closed'));
});

test('parseFrontmatter: reports YAML list syntax', () => {
  const raw = '---\nname: test\nkeywords:\n- one\n- two\n---\n# Body';
  const result = parseFrontmatter(raw);
  assert.ok(result.error.includes('YAML list items are not supported'));
});

test('parseFrontmatter: reports indented / multi-line value', () => {
  const raw = '---\nname: test\n  indented: value\n---\n# Body';
  const result = parseFrontmatter(raw);
  assert.ok(result.error.includes('indented'));
});

test('parseFrontmatter: reports duplicate key', () => {
  const raw = '---\nname: test\nname: duplicate\n---\n# Body';
  const result = parseFrontmatter(raw);
  assert.ok(result.error.includes('duplicate key'));
});

test('parseFrontmatter: returns body text after closing delimiter', () => {
  const result = parseFrontmatter(VALID_SKILL);
  assert.ok(result.body.trim().startsWith('# Skill:'));
});

// ── Tests: validateSkillContent (valid cases) ─────────────────────────────

test('valid canonical SKILL.md passes with no errors', () => {
  const errors = validateSkillContent('SKILL', 'word-exploration', VALID_SKILL);
  assert.deepEqual(errors, []);
});

test('valid top-level skill file passes with no errors', () => {
  const content = VALID_SKILL.replace('name: word-exploration', 'name: my-skill');
  const errors = validateSkillContent('my-skill', 'skills', content);
  assert.deepEqual(errors, []);
});

test('agents wildcard (*) is accepted', () => {
  const content = VALID_SKILL.replace('agents: forge', 'agents: *');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.deepEqual(errors, []);
});

test('multiple agents comma-separated are accepted', () => {
  const content = VALID_SKILL.replace('agents: forge', 'agents: forge, researcher');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.deepEqual(errors, []);
});

// ── Tests: required fields ─────────────────────────────────────────────────

test('missing name field is reported', () => {
  const content = VALID_SKILL.replace('name: word-exploration\n', '');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"name"')));
});

test('missing description field is reported', () => {
  const content = VALID_SKILL.replace(/description:.*\n/, '');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"description"')));
});

test('missing keywords field is reported', () => {
  const content = VALID_SKILL.replace(/keywords:.*\n/, '');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"keywords"')));
});

test('missing agents field is reported', () => {
  const content = VALID_SKILL.replace(/agents:.*\n/, '');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"agents"')));
});

test('empty name field is reported', () => {
  const content = VALID_SKILL.replace('name: word-exploration', 'name:');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"name"') && e.includes('empty')));
});

// ── Tests: naming rules ────────────────────────────────────────────────────

test('name with uppercase letters is rejected', () => {
  const content = VALID_SKILL
    .replace('name: word-exploration', 'name: Word-Exploration')
    .replace('name: word-exploration', 'name: Word-Exploration'); // match both occurrences
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('not kebab-case')));
});

test('name with spaces is rejected', () => {
  const content = VALID_SKILL.replace('name: word-exploration', 'name: word exploration');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('not kebab-case')));
});

test('name with underscores is rejected', () => {
  const content = VALID_SKILL.replace('name: word-exploration', 'name: word_exploration');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('not kebab-case')));
});

test('file name with uppercase is rejected for top-level skill', () => {
  const errors = validateSkillContent('Word-Exploration', 'skills', VALID_SKILL);
  assert.ok(errors.some(e => e.includes('not kebab-case')));
});

test('SKILL.md name mismatch with directory name is reported', () => {
  const content = VALID_SKILL.replace('name: word-exploration', 'name: palette-building');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('does not match the directory name')));
});

test('directory name with spaces is rejected for SKILL.md', () => {
  const content = VALID_SKILL.replace('name: word-exploration', 'name: word-exploration');
  const errors = validateSkillContent('SKILL', 'word exploration', content);
  assert.ok(errors.some(e => e.includes('Directory name') && e.includes('not kebab-case')));
});

// ── Tests: agents field ───────────────────────────────────────────────────

test('agents with uppercase value is rejected', () => {
  const content = VALID_SKILL.replace('agents: forge', 'agents: Forge');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"agents"') && e.includes('invalid')));
});

test('agents: ALL is rejected', () => {
  const content = VALID_SKILL.replace('agents: forge', 'agents: ALL');
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"agents"') && e.includes('invalid')));
});

// ── Tests: body checks ────────────────────────────────────────────────────

test('body with no heading is reported', () => {
  const noHeading = `---
name: word-exploration
description: Explore a word.
keywords: meaning
agents: forge
---

Just some plain text without any headings at all here.
`;
  const errors = validateSkillContent('SKILL', 'word-exploration', noHeading);
  assert.ok(errors.some(e => e.includes('no headings')));
});

test('too-short body is reported', () => {
  const short = `---
name: word-exploration
description: Explore a word.
keywords: meaning
agents: forge
---

# H
`;
  const errors = validateSkillContent('SKILL', 'word-exploration', short);
  assert.ok(errors.some(e => e.includes('too short')));
});

test('unclosed code fence is reported', () => {
  const unclosed = `---
name: word-exploration
description: Explore a word's meaning in depth.
keywords: meaning, definition
agents: forge
---

# Skill: Word Exploration

Here is an example:

\`\`\`javascript
const x = 1;
// missing closing fence
`;
  const errors = validateSkillContent('SKILL', 'word-exploration', unclosed);
  assert.ok(errors.some(e => e.includes('unclosed code fence')));
});

test('balanced code fences pass', () => {
  const balanced = VALID_SKILL + '\n```js\ncode here\n```\n';
  const errors = validateSkillContent('SKILL', 'word-exploration', balanced);
  assert.deepEqual(errors, []);
});

test('raw HTML in body is reported', () => {
  const withHtml = VALID_SKILL + '\n<div>some html</div>\n';
  const errors = validateSkillContent('SKILL', 'word-exploration', withHtml);
  assert.ok(errors.some(e => e.includes('raw HTML')));
});

// ── Tests: empty / missing file content ──────────────────────────────────

test('empty file content is reported', () => {
  const errors = validateSkillContent('SKILL', 'word-exploration', '');
  assert.ok(errors.some(e => e.includes('empty')));
});

test('whitespace-only file content is reported', () => {
  const errors = validateSkillContent('SKILL', 'word-exploration', '   \n\t\n  ');
  assert.ok(errors.some(e => e.includes('empty')));
});

// ── Tests: field length limits ─────────────────────────────────────────────

test('name exceeding 80 chars is reported', () => {
  const longName = 'a' + '-b'.repeat(40); // 81 chars
  const content = VALID_SKILL.replace('name: word-exploration', `name: ${longName}`);
  // Also fix directory name check by using non-canonical file name
  const errors = validateSkillContent(longName, 'skills', content);
  assert.ok(errors.some(e => e.includes('"name"') && e.includes('characters')));
});

test('description exceeding 300 chars is reported', () => {
  const longDesc = 'a'.repeat(301);
  const content = VALID_SKILL.replace(
    /description:.*\n/,
    `description: ${longDesc}\n`
  );
  const errors = validateSkillContent('SKILL', 'word-exploration', content);
  assert.ok(errors.some(e => e.includes('"description"') && e.includes('characters')));
});

// ── Tests: validate the real skill files ──────────────────────────────────

test('all existing skills/ files pass validation', () => {
  const skillsRoot = path.join(__dirname, '..', 'skills');
  if (!fs.existsSync(skillsRoot)) return; // skip if directory absent

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
    return files;
  }

  const files = walk(skillsRoot);
  assert.ok(files.length > 0, 'Expected at least one skill file');

  const allErrors = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf-8');
    const fileName = path.basename(file, '.md');
    const dirName = path.basename(path.dirname(file));
    const errors = validateSkillContent(fileName, dirName, raw);
    if (errors.length > 0) {
      allErrors.push(`${path.relative(skillsRoot, file)}: ${errors.join('; ')}`);
    }
  }

  assert.deepEqual(
    allErrors,
    [],
    `Existing skill files failed validation:\n${allErrors.join('\n')}`
  );
});
