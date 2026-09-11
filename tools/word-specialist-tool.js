// ---------------------------------------------------------------------------
// WORD SPECIALIST TOOL + SPECIALIST-ONLY TOOLS
//
// wordSpecialistTool: the spec the orchestrator exposes to the main agent.
//   fn is null — the worker dispatches this to invokeWordSpecialist instead.
//
// specialistTools: internal tools available only inside the specialist's own
//   agent loop, not exposed to the main orchestrator. This matches the
//   module-6 pattern where the sub-agent has its own focused toolset.
// ---------------------------------------------------------------------------

// Static etymology and connotation data used by look_up_word_details.
const WORD_DETAILS = {
  anchor: {
    etymology: 'Old English ancor, from Latin ancora, from Greek ankura. Related to the Greek ankos (bend).',
    connotation: 'Stability, grounding, constraint. Often connotes security but also immobility or being held back.',
    register: 'neutral / figurative in literary contexts',
  },
  aurora: {
    etymology: 'Latin aurora (dawn). Cognate with Greek eos. Used since Classical Latin for the goddess of dawn.',
    connotation: 'Luminous beauty, rarity, renewal. Carries a sense of the sublime and the natural spectacular.',
    register: 'formal / poetic',
  },
  cascade: {
    etymology: 'French cascade, from Italian cascata, from cascare (to fall). Entered English in the 17th century.',
    connotation: 'Abundance, inevitable progression, sometimes overwhelm. Strong visual and auditory imagery.',
    register: 'neutral / figurative',
  },
  echo: {
    etymology: 'Latin echo, from Greek ēkhō. Derived from the myth of the nymph Echo. Also a common noun for reflected sound.',
    connotation: 'Repetition, longing, absence. Implies that something once full is now only a trace.',
    register: 'neutral / poetic',
  },
  ember: {
    etymology: 'Old English æmerge (ashes, embers). Related to Old High German eimuria. No Latin root.',
    connotation: 'Dying warmth, persistence, potential for revival. Melancholic but not extinguished.',
    register: 'poetic / literary',
  },
  glacier: {
    etymology: 'French glacier, from glace (ice), from Latin glacies. In English use since the 18th century.',
    connotation: 'Slow inexorable force, age, cold beauty, permanence threatened by change.',
    register: 'neutral / scientific / figurative',
  },
  horizon: {
    etymology: 'Latin horizon, from Greek horizōn (bounding circle), from horizein (to bound, limit). From horos (boundary).',
    connotation: 'Possibility, distance, the limit of the known. Carries optimism but also unreachability.',
    register: 'neutral / figurative',
  },
  labyrinth: {
    etymology: 'Latin labyrinthus, from Greek labyrinthos. Possibly pre-Greek, linked to the Minoan palace at Knossos.',
    connotation: 'Complexity, disorientation, hidden danger. Can carry a sense of intellectual richness or entrapment.',
    register: 'formal / literary',
  },
  mirage: {
    etymology: 'French mirage, from se mirer (to be reflected), from Latin mirare (to look at). Related to mirror.',
    connotation: 'Illusion, desire, the gap between appearance and reality. Often used for false hope.',
    register: 'neutral / figurative',
  },
  mosaic: {
    etymology: 'French mosaïque, from Italian mosaico, from Medieval Latin musaicum. Possibly from Greek Mousa (Muse).',
    connotation: 'Diversity unified into a whole, fragmentation that creates meaning, patience and craft.',
    register: 'neutral / figurative',
  },
  nebula: {
    etymology: 'Latin nebula (mist, cloud, vapor). From Proto-Indo-European nebh (cloud). Astronomical use from the 17th century.',
    connotation: 'Vastness, diffuse beauty, the origin of things, mystery at a cosmic scale.',
    register: 'scientific / poetic',
  },
  prism: {
    etymology: 'Latin prisma, from Greek prisma (something sawed), from prizein (to saw). Optical use from the 17th century.',
    connotation: 'Multiplicity, hidden complexity revealed by light. The idea that one thing contains many.',
    register: 'neutral / figurative / scientific',
  },
  solitude: {
    etymology: 'Latin solitudo (loneliness, a lonely place), from solus (alone). In English since the 14th century.',
    connotation: 'Chosen aloneness vs. loneliness. Carries dignity when voluntary; melancholy when imposed.',
    register: 'formal / literary',
  },
  vortex: {
    etymology: 'Latin vortex (whirlpool, eddy), from vortere (to turn). Variant of vertex. In English from the 17th century.',
    connotation: 'Inescapable force, chaos, being pulled into something consuming. Dynamic and dangerous.',
    register: 'neutral / figurative',
  },
  whisper: {
    etymology: 'Old English hwisprian (to murmur). Imitative / echoic origin. Related to Old Norse hvísla.',
    connotation: 'Intimacy, secrecy, fragility, the barely-audible. Can be tender or conspiratorial.',
    register: 'neutral / poetic',
  },
};

// Thematic word clusters used by find_related_words_deep.
const DEEP_WORD_CLUSTERS = {
  light:     ['luminous', 'aureate', 'lambent', 'incandescent', 'phosphorescent', 'crepuscular', 'scintilla'],
  dark:      ['tenebrous', 'umbral', 'stygian', 'cimmerian', 'murk', 'penumbra', 'gloaming'],
  water:     ['riparian', 'littoral', 'pelagic', 'thalassic', 'lacustrine', 'brackish', 'abyssal'],
  movement:  ['peripatetic', 'kinetic', 'sinuous', 'undulant', 'mercurial', 'flux', 'torrent'],
  silence:   ['susurrus', 'hush', 'mute', 'taciturn', 'laconic', 'quiescent', 'still'],
  time:      ['ephemeral', 'transient', 'sempiternal', 'diurnal', 'vestigial', 'archaic', 'nascent'],
  nature:    ['sylvan', 'arboreal', 'lithic', 'alluvial', 'verdant', 'boreal', 'tidal'],
  mind:      ['liminal', 'numinous', 'ineffable', 'noetic', 'apophatic', 'subliminal', 'lucid'],
  structure: ['lattice', 'armature', 'trellis', 'plinth', 'keystone', 'lintel', 'stratum'],
  decay:     ['patina', 'verdigris', 'detritus', 'molder', 'wan', 'atrophy', 'vestige'],
};

// ---------------------------------------------------------------------------
// Specialist tool 1: look_up_word_details
// Returns etymology, connotation, and register for a known word.
// ---------------------------------------------------------------------------
export const lookUpWordDetailsTool = {
  spec: {
    name: 'look_up_word_details',
    description: 'Look up stored etymology, connotation, and register data for a word. Returns structured detail if available.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'The word to look up' },
        },
        required: ['word'],
      },
    },
  },
  fn: async ({ word }) => {
    const key = (word || '').toLowerCase().trim();
    const entry = WORD_DETAILS[key];
    if (!entry) {
      return `No stored details for "${word}". Proceed with general linguistic knowledge.`;
    }
    return [
      `Word: ${word}`,
      `Etymology: ${entry.etymology}`,
      `Connotation: ${entry.connotation}`,
      `Register: ${entry.register}`,
    ].join('\n');
  },
};

// ---------------------------------------------------------------------------
// Specialist tool 2: find_related_words_deep
// Returns thematically close words from a richer, more literary cluster set.
// Distinct from the orchestrator's suggest_related_words (which uses simple
// theme banks); this tool returns rarer, more precise vocabulary.
// ---------------------------------------------------------------------------
export const findRelatedWordsDeepTool = {
  spec: {
    name: 'find_related_words_deep',
    description: 'Find thematically related words from a deep literary vocabulary set. Returns richer, less common candidates than the standard palette suggestion tool.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          theme: { type: 'string', description: 'The theme or semantic field to draw from (e.g. light, water, silence, time, decay)' },
        },
        required: ['theme'],
      },
    },
  },
  fn: async ({ theme }) => {
    const key = Object.keys(DEEP_WORD_CLUSTERS).find((k) => (theme || '').toLowerCase().includes(k));
    const words = key ? DEEP_WORD_CLUSTERS[key] : DEEP_WORD_CLUSTERS.mind;
    return `Deep vocabulary for theme "${theme}": ${words.join(', ')}`;
  },
};

// ---------------------------------------------------------------------------
// The specialist tool spec the orchestrator exposes to the main agent.
// fn is null — dispatched to invokeWordSpecialist in worker.js.
// ---------------------------------------------------------------------------
export const wordSpecialistTool = {
  spec: {
    name: 'consult_word_specialist',
    description: 'Delegate to a specialist agent for deep word-craft advice: etymology, connotation, or poetic use of a word.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          word:   { type: 'string', description: 'The word to analyse' },
          aspect: { type: 'string', description: 'Focus area: etymology | connotation | poetic_use' },
        },
        required: ['word'],
      },
    },
  },
  fn: null, // dispatched via invokeWordSpecialist — see worker.js
};

// Exported together so invokeWordSpecialist can build its own toolConfig.
export const specialistTools = [lookUpWordDetailsTool, findRelatedWordsDeepTool];
