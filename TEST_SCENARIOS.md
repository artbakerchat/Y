# Palette Loading Test Scenarios

## Overview
This document outlines how to test the context-aware palette loading feature across different user scenarios.

---

## Scenario 1: First-time volunteer coordinator visit
**User**: Manager coordinating a food bank's volunteer program
**Entry point**: Direct visit to `http://localhost:3000/?context=volunteering`

**Expected behavior**:
1. Session created with `paletteId: 'volunteering'`
2. Palette loaded with words: `['volunteer','shift','schedule','match',...'assign']` (35 words)
3. Palette story displayed: *"Your volunteer coordinator palette. Use words like "match," "shift," and "availability" to help organize your team. Add words specific to your organization."*
4. User sees the story with left-border accent styling in the hero section
5. Word palette on right shows 35/52 words loaded

**Test steps**:
```bash
# Terminal 1: Start server
npm start

# Terminal 2 or Browser:
# Visit: http://localhost:3000/?context=volunteering
# Verify: Palette story appears above the workspace
# Verify: Right sidebar shows "35 / 52" words
# Verify: First word appears to be "volunteer"
```

---

## Scenario 2: First-time teacher visit (implicit detection)
**User**: Teacher needing help organizing lesson materials
**Entry point**: Direct visit to `http://localhost:3000/` then types first message

**Expected behavior**:
1. User visits homepage (no URL context)
2. Default palette loads initially
3. User types: "How do I scaffold this lesson for different learning levels?"
4. On `/api/ask` call, server detects "lesson," "scaffold" keywords
5. Palette *doesn't change yet* (detection happens, but palette persists once set)
6. On next session reload (after 48h TTL expires), teaching palette would load

**Test steps**:
```bash
# Browser: Visit http://localhost:3000
# Type first message: "How do I scaffold this lesson for diverse learners?"
# Check Network tab in DevTools:
# POST /api/ask payload includes message
# Server logs show: palette detection triggered
# Palette persists on page (editing works as normal)
```

---

## Scenario 3: Revisit after 48 hours (expired session)
**User**: Same volunteer coordinator returns after 2 days
**Entry point**: Direct visit to `http://localhost:3000/?context=volunteering`

**Expected behavior**:
1. Old session expired (48h TTL passed)
2. `loadState()` detects expiration and creates new session
3. Context re-detected from URL parameter
4. Same volunteering palette reloaded
5. Palette story displayed again (first-time appearance in this session)
6. Conversation history lost, but palette consistent

**Test steps**:
```bash
# Setup: Complete Scenario 1
# Wait 48+ hours (or manually delete .data/sessions/<uuid>.json)
# Return to http://localhost:3000/?context=volunteering
# Verify: Palette story appears again
# Verify: Same palette words loaded
# Verify: No conversation history (fresh start)
```

---

## Scenario 4: Researcher with implicit detection
**User**: Academic researcher visiting for the first time
**Entry point**: Direct visit to `http://localhost:3000/` then types first message

**Expected behavior**:
1. Visit homepage (default palette loads)
2. Type: "I'm synthesizing findings from 50 papers on machine learning"
3. Keywords detected: "synthesizing," "findings," (potentially "research" if typed)
4. Palette detection runs but session already loaded with default
5. On fresh session (TTL expiry), researcher palette would load

**Test steps**:
```bash
# Browser: Delete cookies to clear session
# Visit: http://localhost:3000/
# Type: "I'm organizing my research on neural networks and need to synthesize findings"
# Check backend logs (if available):
# detectPaletteContext() called with this message
# Result: "researcher" palette detected
```

---

## Scenario 5: URL context + message mismatch
**User**: Visitor clicks wrong context link but types message for different context
**Entry point**: `http://localhost:3000/?context=volunteering` but types research message

**Expected behavior**:
1. URL parameter takes precedence
2. Volunteering palette loaded
3. Palette story: "Your volunteer coordinator palette..."
4. User types research message (e.g., "help me analyze these papers")
5. Detection sees conflicting signals (URL says volunteering, message says researcher)
6. URL wins (explicit parameter > implicit detection)
7. Palette remains volunteering

**Test steps**:
```bash
# Browser:
# Visit: http://localhost:3000/?context=volunteering
# Verify: Volunteering palette story appears
# Type: "I need help synthesizing research papers on AI"
# Verify: Palette remains volunteering (no switch)
# User can manually edit palette as needed
```

---

## Scenario 6: Mobile user re-visit persistence
**User**: Food bank coordinator on their phone returns to the app
**Entry point**: Browser history or bookmark to `http://localhost:3000`

**Expected behavior**:
1. Session cookie exists from previous visit
2. `loadState()` finds existing session (not expired)
3. Previously selected foodbank palette loaded
4. Palette story shown only once per session (on first load)
5. Conversation history restored from previous session
6. User can continue from where they left off

**Test steps**:
```bash
# Browser (Mobile):
# Complete Scenario 1 on phone
# Close browser tab
# Reopen after 1 hour
# Visit: http://localhost:3000
# Verify: Foodbank palette still loaded
# Verify: Previous messages appear
# Verify: Word count matches previous state
```

---

## Scenario 7: Household manager (everyday user)
**User**: Parent coordinating family schedules
**Entry point**: `http://localhost:3000/?context=household`

**Expected behavior**:
1. Household palette loads: `['schedule','calendar','responsibility',...'clarify']`
2. Palette story: *"Your household palette. Use "schedule," "responsibility," and "coordinate" to keep your family organized. Add words for your family's unique needs."*
3. User adds family-specific words (e.g., "soccer," "math-homework," "grocery-run")
4. Palette updates in UI and saved to backend
5. On next visit, custom words persist
6. Palette persists for 48h even with edits

**Test steps**:
```bash
# Browser:
# Visit: http://localhost:3000/?context=household
# Verify: Story appears with "schedule," "family," "coordinate"
# Add words: "soccer games", "homework", "grocery shopping"
# Verify: Words added to palette and count increases
# Save session (automatic)
# Refresh page: Words persist
```

---

## Scenario 8: Library system administrator
**User**: Small library coordinator setting up the system
**Entry point**: `http://localhost:3000/?context=library`

**Expected behavior**:
1. Library palette loads
2. Story explains: *"Your library palette. Words like "patron," "catalog," and "discovery" help you serve your community better..."*
3. Admin adds library-specific terms: "circulation," "holds," "programming," "digital-access"
4. Palette saved and shared with staff
5. Staff members can use library context to discuss operations

**Test steps**:
```bash
# Browser:
# Visit: http://localhost:3000/?context=library
# Note: Story mentions "patron," "catalog," "discovery"
# Add: "circulation", "holds", "programming"
# Test search in palette (if implemented)
# Verify words stick across sessions
```

---

## Testing Checklist

### Backend (Node/Worker)
- [ ] `src/palettes.js` exports all 10 templates
- [ ] `detectPaletteContext()` returns correct palette ID for each test case
- [ ] `getPaletteTemplate()` returns full template with words and story
- [ ] URL parameters parsed correctly (`?context=...`)
- [ ] Message keywords detected from first `/api/ask` call
- [ ] Empty message/URL returns 'default' palette
- [ ] Case-insensitive detection works
- [ ] `emptyState()` accepts paletteId and paletteStory
- [ ] `cleanState()` preserves paletteId and paletteStory
- [ ] `loadState()` receives and uses detection hints
- [ ] 48h TTL triggers re-detection on expiry
- [ ] Sessions with expiry near 48h properly re-detect context

### Frontend (index.html)
- [ ] `showPaletteStory()` function renders story correctly
- [ ] `#palette-story` div displays on first load
- [ ] Story styled with left border and italic text
- [ ] Story disappears/hides when no `paletteStory` in state
- [ ] `loadBackendState()` calls `showPaletteStory()`
- [ ] Palette count updates after story display
- [ ] Story responsive on mobile (readable text, proper spacing)
- [ ] Story doesn't interfere with chat UI layout

### Integration
- [ ] Local server (`npm start`) loads correct palette from URL
- [ ] Local server detects context from message
- [ ] Cloudflare Worker imports `src/palettes.js` without errors
- [ ] Worker passes detection hints to `loadState()`
- [ ] Worker respects URL context parameters
- [ ] Multiple contexts tested end-to-end (at least 3 scenarios)

### Documentation
- [ ] README updated with palette section
- [ ] Palette template list documented
- [ ] Usage examples provided (URL + message)
- [ ] Instructions for adding new palettes clear
- [ ] `src/palettes.js` code well-commented

---

## Running Tests

### Quick verification (no server):
```bash
# Check palette module syntax and exports
node test-palettes.js
```

### Full integration test:
```bash
# Terminal 1: Start local server
npm start

# Terminal 2: Test each scenario
# Use curl or postman to test API endpoints
curl http://localhost:3000/api/state
curl http://localhost:3000/api/state?context=volunteering

# Browser: Visit each URL and verify UI
http://localhost:3000/?context=volunteering
http://localhost:3000/?context=teaching
http://localhost:3000/?context=library
```

---

## Success Criteria

✅ **Implementation complete** when:
1. All 10 palette templates defined in `src/palettes.js`
2. Context detection works from URL and message
3. Palettes load on first session creation
4. Palette story displays on page load
5. Palette persists across sessions (within 48h)
6. No JavaScript errors in console
7. All tests pass
8. Documentation is complete and accurate
