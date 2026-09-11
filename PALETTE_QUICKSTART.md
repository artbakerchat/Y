# Palette System Quick Start

## TL;DR

Forge now automatically loads a relevant word palette based on user context. No configuration needed.

## How It Works

### First Time Visiting
**Option 1: Use URL context**
```
http://localhost:3000/?context=volunteering
http://localhost:3000/?context=teaching
http://localhost:3000/?context=foodbank
```

**Option 2: Type first message (auto-detect)**
- Type: "I need help organizing volunteers"
- Palette automatically loads: **volunteering**
- Type: "Help me scaffold this lesson"
- Palette automatically loads: **teaching**

### Available Contexts
```
volunteering    → Nonprofit volunteer coordination
teaching        → Classroom & lesson design
library         → Library & information services
foodbank        → Food bank & distribution
contracting     → Contractor & compliance
content_creator → Lesson material design
researcher      → Academic research
household       → Family & home coordination
wellness        → Personal habits & goals
default         → General word exploration
```

## What's New

### For Users
1. **Contextual palette**: First visit loads relevant words for your use case
2. **Story display**: Explanation of what the palette includes appears in the hero section
3. **Persistent**: Your palette stays the same for 48 hours, even if you refresh
4. **Editable**: Add, remove, or reorder words as needed (changes saved automatically)

### For Developers
1. **`src/palettes.js`**: New module with 10 community palettes
2. **`detectPaletteContext()`**: Function that identifies user context from URL or message
3. **Enhanced backends**: Both `server.mjs` and `src/worker.js` support palette loading
4. **Frontend story**: `index.html` shows palette context explanation on load

## Testing Locally

```bash
# Start the local server
npm install
npm start

# Test URL context detection
# Visit: http://localhost:3000/?context=volunteering
# Expected: Palette story appears in hero section

# Test message detection
# Visit: http://localhost:3000/
# Type: "I'm a researcher synthesizing papers"
# Expected: Researcher palette loaded (next session)

# Test persistence
# Refresh the page
# Expected: Same palette and story appear
```

## Adding a New Context

1. **Edit `src/palettes.js`**:
```javascript
mycontext: {
  id: 'mycontext',
  name: 'My Context Name',
  description: 'What this palette is for',
  tags: ['tag1', 'tag2'],
  words: ['word1', 'word2', /* ... up to 52 words ... */],
  story: 'This palette helps with...',
  context: { type: 'category', role: 'user_role', scale: 'team_size' },
}
```

2. **Add keywords to detection**:
```javascript
keywords.mycontext = ['keyword1', 'keyword2', 'keyword3'];
```

3. **Deploy**: Push to `main`, GitHub Actions updates R2, Worker uses new palette

## API Changes

### GET /api/state
```javascript
// Response now includes:
{
  paletteId: 'volunteering',
  paletteStory: 'Your volunteer coordinator palette...',
  palette: ['shift', 'schedule', 'match', ...],
  // ... other fields
}
```

### POST /api/ask
```javascript
// Message is analyzed for context keywords
// Palette persists (set only on session creation)
```

## Frontend Integration

### Display Palette Story
```javascript
// Automatically shown by showPaletteStory()
// Appears in #palette-story div
// Styled with left border and italic text
```

### Access Palette Data
```javascript
// In index.html scripts:
backendState.paletteId     // e.g., 'volunteering'
backendState.paletteStory  // e.g., 'Your volunteer...'
backendState.palette       // Array of 35-50 words
```

## Session State

Each session now includes:
```javascript
{
  paletteId: 'volunteering',        // Context identifier
  paletteStory: 'Your volunteer...', // Explanatory text
  palette: [/* 35-50 words */],     // The vocabulary
  messages: [...],                   // Conversation history
  rate: { day, count },              // Daily request limit
  expiresAt: timestamp               // 48h TTL
}
```

## Persistence

- **Duration**: 48 hours
- **Storage**: 
  - Node: `.data/sessions/<uuid>.json`
  - Worker: R2 bucket under `sessions/` prefix
- **On expiry**: Session recreated, context re-detected from URL

## Examples

### Volunteer Coordinator
```
URL: http://localhost:3000/?context=volunteering
Story: "Your volunteer coordinator palette. Use words like 'match,' 'shift,' 
        and 'availability' to help organize your team. Add words specific 
        to your organization."
Words: volunteer, shift, schedule, match, availability, skills, training, ...
```

### Teacher
```
URL: http://localhost:3000/?context=teaching
Story: "Your teaching palette. Use words like 'scaffold,' 'differentiate,' 
        and 'assessment' to design effective lessons. Build your unique 
        vocabulary for your classroom."
Words: lesson, scaffold, learner, diverse, differentiate, engagement, ...
```

### Researcher
```
URL: http://localhost:3000/?context=researcher
Story: "Your research palette. Words like 'synthesis,' 'evidence,' and 
        'methodology' help you organize knowledge. Build vocabulary for 
        your research domain."
Words: research, synthesis, evidence, finding, methodology, analysis, ...
```

## Troubleshooting

**Story doesn't appear?**
- Check browser console for errors
- Verify `paletteStory` is in API response: `curl http://localhost:3000/api/state`
- Ensure session is fresh (clear cookies if needed)

**Wrong palette loaded?**
- Check URL parameter is correct: `?context=volunteering` (case-insensitive)
- Check message keywords match: contains "volunteer," "shift," etc.
- URL parameter always wins over message detection

**Palette reverts to default?**
- Session expired (48h TTL) → context re-detected
- Check for detection in latest message or URL
- Clear cookies and start fresh to force re-detection

**Can't add/edit words?**
- Check right sidebar has word input field
- Verify no JS console errors
- Try adding single word first

## What's Next?

See [`IMPLEMENTATION_SUMMARY.md`](IMPLEMENTATION_SUMMARY.md) for complete docs.

See [`TEST_SCENARIOS.md`](TEST_SCENARIOS.md) for testing procedures.

See [`src/palettes.js`](src/palettes.js) for all templates and detection logic.
