/**
 * Community-focused palette templates
 * Each palette is designed for a specific use case and includes context metadata
 * Palettes are loaded based on user intent detected from the first prompt or URL context
 */

export const PALETTE_TEMPLATES = {
  // Default: General word exploration
  default: {
    id: 'default',
    name: 'Word Explorer',
    description: 'A diverse palette for general word exploration and creative writing',
    tags: ['exploration', 'creative', 'general'],
    words: ['anchor','pinnacle','summit','twilight','static','ocean','wander','spark','gravity','money','book','Glimmer','compass','voyage','solitude','prism','nectar','blossom','fossil','zenith','vortex','mirage','starlight','ember','cyclone','glacier','radiance','labyrinth','aurora','thistle','apple','Nebula','crisp','whisper','avalanche','horizon','velvet','mosaic','thunder','marble','cascade','echo','lantern','silver','standard','puzzle','orbit','shadow','flicker','autumn','rhythm','canvas'],
    story: 'Start with these words as seeds. Chat naturally, and your palette will grow with every conversation.',
  },

  // Good Neighbor: Volunteer coordination
  volunteering: {
    id: 'volunteering',
    name: 'Volunteer Coordinator',
    description: 'Build a shared vocabulary for managing volunteers, shifts, and community coordination',
    tags: ['community', 'coordination', 'nonprofit'],
    words: ['volunteer','shift','schedule','match','availability','skills','training','conflict','notify','roster','hours','capacity','role','assignment','coverage','backup','preferences','constraint','workflow','coordination','tracking','organize','assign','recruit','onboard','team','resource','commitment','reliable','urgent','urgent','flexible','reliable','fulltime','parttime','leader','mentor','guide','support','facilitate'],
    story: 'Your volunteer coordinator palette. Use words like "match," "shift," and "availability" to help organize your team. Add words specific to your organization.',
    context: { type: 'nonprofit', role: 'coordinator', scale: 'small-medium' },
  },

  // Good Neighbor: Teaching & education
  teaching: {
    id: 'teaching',
    name: 'Educator',
    description: 'Tools for scaffolding lessons, managing diverse learners, and coordinating classroom resources',
    tags: ['education', 'teaching', 'classroom'],
    words: ['lesson','scaffold','learner','diverse','differentiate','engagement','assessment','rubric','objective','material','resource','grade','feedback','progress','student','classroom','activity','reflection','criteria','standard','accountability','growth','mastery','challenge','support','pacing','inclusive','accessible','evidence','alignment','coherent','depth','rigor'],
    story: 'Your teaching palette. Use words like "scaffold," "differentiate," and "assessment" to design effective lessons. Build your unique vocabulary for your classroom.',
    context: { type: 'school', role: 'educator', scale: 'small' },
  },

  // Good Neighbor: Library & information services
  library: {
    id: 'library',
    name: 'Librarian',
    description: 'Vocabulary for organizing information, serving community members, and coordinating library programs',
    tags: ['library', 'information', 'community-access'],
    words: ['catalog','collection','patron','query','discovery','reference','resource','archive','preserve','curate','organize','access','literacy','community','program','event','outreach','circulation','catalog','metadata','classification','preservation','archive','digital','collection','recommend','reference','research','inquiry','information','literacy','knowledge','learning','exploration'],
    story: 'Your library palette. Words like "patron," "catalog," and "discovery" help you serve your community better. Grow this vocabulary with your library's unique terms.',
    context: { type: 'library', role: 'librarian', scale: 'small-medium' },
  },

  // Good Neighbor: Food bank & distribution
  foodbank: {
    id: 'foodbank',
    name: 'Food Bank Coordinator',
    description: 'Manage donations, volunteers, distribution events, and community food security',
    tags: ['community', 'nonprofit', 'food-security'],
    words: ['donation','inventory','distribution','event','volunteer','shift','recipient','pantry','emergency','food-security','surplus','partner','outreach','need','supply','demand','logistics','capacity','schedule','coordination','transport','storage','expiration','nutritious','access','equity','dignity','community','organize','manage','track','allocate','prioritize'],
    story: 'Your food bank palette. Use words like "donation," "distribution," and "logistics" to coordinate food access. Add words that reflect your community\'s needs.',
    context: { type: 'nonprofit', role: 'coordinator', scale: 'small-medium', focus: 'food-security' },
  },

  // Professional: Contractor & compliance
  contracting: {
    id: 'contracting',
    name: 'Contractor',
    description: 'Manage projects, compliance documentation, timelines, and client communication',
    tags: ['professional', 'compliance', 'project-management'],
    words: ['contract','compliance','deadline','milestone','deliverable','specification','documentation','approval','budget','estimate','change-order','schedule','liability','warranty','inspection','code','permit','regulation','certification','insurance','client','scope','timeline','quality','risk','contingency','communication','approval','authority'],
    story: 'Your contractor palette. Words like "compliance," "deadline," and "documentation" help you manage the paperwork. Build vocabulary for your specific trades.',
    context: { type: 'professional', role: 'contractor', scale: 'solo-small' },
  },

  // Professional: Teacher creating content
  content_creator: {
    id: 'content_creator',
    name: 'Lesson Designer',
    description: 'Scaffold teaching materials, design assignments, and create learning progressions',
    tags: ['professional', 'education', 'content-creation'],
    words: ['scaffold','material','assignment','progression','objective','learner','diversity','accessibility','engagement','reflection','assessment','evidence','criteria','alignment','design','flow','clarity','depth','breadth','rigor','challenge','support','practice','application','synthesis','evaluation','iteration','feedback','revision'],
    story: 'Your lesson design palette. Use "scaffold," "progression," and "engagement" to create learning materials. Add domain-specific vocabulary for your subject.',
    context: { type: 'professional', role: 'educator', scale: 'solo' },
  },

  // Professional: Researcher
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    description: 'Organize papers, synthesize findings, and manage research workflows',
    tags: ['professional', 'research', 'knowledge-work'],
    words: ['research','synthesis','evidence','finding','methodology','analysis','interpretation','uncertainty','limitation','contribution','paper','source','citation','claim','support','debate','consensus','frontier','gap','question','inquiry','observation','validation','peer-review','publication','academic','empirical','theoretical','framework','model'],
    story: 'Your research palette. Words like "synthesis," "evidence," and "methodology" help you organize knowledge. Build vocabulary for your research domain.',
    context: { type: 'professional', role: 'researcher', scale: 'solo-small' },
  },

  // Everyday: Household & family
  household: {
    id: 'household',
    name: 'Household Manager',
    description: 'Organize family calendars, shared responsibilities, and household decisions',
    tags: ['everyday', 'household', 'family-coordination'],
    words: ['schedule','calendar','responsibility','chore','task','deadline','reminder','event','family','coordination','conflict','agreement','decision','flexible','reliable','commitment','household','meal','budget','expense','priority','delegate','organize','track','communicate','discuss','clarify','decide'],
    story: 'Your household palette. Use "schedule," "responsibility," and "coordinate" to keep your family organized. Add words for your family\'s unique needs.',
    context: { type: 'everyday', role: 'family-organizer', scale: 'small-group' },
  },

  // Everyday: Personal wellness & goal tracking
  wellness: {
    id: 'wellness',
    name: 'Wellness Explorer',
    description: 'Track goals, habits, and personal growth with reflection and intentionality',
    tags: ['everyday', 'wellness', 'personal-growth'],
    words: ['habit','goal','progress','reflection','intention','momentum','obstacle','growth','practice','routine','consistency','motivation','challenge','resilience','support','community','accountability','tracking','milestone','breakthrough','patience','compassion','balance','wellbeing','health','vitality','energy','clarity','purpose','meaning'],
    story: 'Your wellness palette. Words like "habit," "progress," and "reflection" help you track what matters. Grow this with your personal goals and values.',
    context: { type: 'everyday', role: 'self-explorer', scale: 'solo' },
  },
};

/**
 * Detect user context from first message or URL
 * Returns the most likely palette template ID
 * Falls back to 'default' if no strong match
 */
export function detectPaletteContext(message = '', urlParams = {}) {
  if (!message && !urlParams.context) return 'default';

  const text = (message + '').toLowerCase();
  const contextParam = (urlParams.context || '').toLowerCase();

  // Check URL context parameter first (explicit)
  const urlMatches = {
    'volunteer': 'volunteering',
    'teach': 'teaching',
    'library': 'library',
    'food': 'foodbank',
    'contract': 'contracting',
    'content': 'content_creator',
    'research': 'researcher',
    'household': 'household',
    'wellness': 'wellness',
  };

  for (const [key, paletteId] of Object.entries(urlMatches)) {
    if (contextParam.includes(key)) return paletteId;
  }

  // Check message keywords
  const keywords = {
    volunteering: ['volunteer', 'shift', 'schedule', 'nonprofit', 'coordinator', 'team', 'match'],
    teaching: ['teach', 'lesson', 'student', 'classroom', 'scaffold', 'grade', 'curriculum'],
    library: ['library', 'patron', 'catalog', 'research', 'book', 'information'],
    foodbank: ['food', 'donation', 'distribution', 'pantry', 'community'],
    contracting: ['contract', 'compliance', 'deadline', 'permit', 'budget'],
    content_creator: ['lesson', 'material', 'content', 'course', 'design'],
    researcher: ['research', 'paper', 'study', 'analysis', 'finding'],
    household: ['family', 'schedule', 'household', 'calendar', 'chore'],
    wellness: ['habit', 'goal', 'wellness', 'health', 'track', 'progress'],
  };

  // Score each palette by keyword matches
  const scores = {};
  for (const [paletteId, words] of Object.entries(keywords)) {
    scores[paletteId] = words.filter(word => text.includes(word)).length;
  }

  // Return highest-scoring palette, or default if no matches
  const bestMatch = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)[0];

  return bestMatch ? bestMatch[0] : 'default';
}

/**
 * Get a palette template by ID
 * Returns the template with words, story, and metadata
 */
export function getPaletteTemplate(paletteId = 'default') {
  return PALETTE_TEMPLATES[paletteId] || PALETTE_TEMPLATES.default;
}

/**
 * Get all available palette templates (for UI enumeration)
 */
export function listPaletteTemplates() {
  return Object.values(PALETTE_TEMPLATES).map(template => ({
    id: template.id,
    name: template.name,
    description: template.description,
    tags: template.tags,
    story: template.story,
  }));
}
