// Deterministic operational foundations for Good Neighbour profiles.
// These tools accept caller-provided records and deliberately do not claim
// that an external roster, notification service, policy repository, or civic
// source is connected until an adapter supplies one.

const asArray = (value) => Array.isArray(value) ? value : [];
const asText = (value) => typeof value === 'string' ? value.trim() : '';
const hasAll = (values, required) => required.every((item) => values.includes(item));

function foodBankTools() {
  return [{
    spec: {
      name: 'match_food_bank_shifts',
      description: 'Match provided food-bank volunteers to shifts by availability and required skills, while reporting roster gaps and inventory threshold warnings.',
      inputSchema: { json: { type: 'object', properties: {
        volunteers: { type: 'array', description: 'Records with id, name, skills, and availability.' },
        shifts: { type: 'array', description: 'Records with id, slot, capacity, and requiredSkills.' },
        inventory: { type: 'array', description: 'Records with item and quantity.' },
        thresholds: { type: 'array', description: 'Records with item and minimum quantity.' },
      }, required: ['volunteers', 'shifts'] } },
    },
    fn: async (input = {}) => {
      const volunteers = asArray(input.volunteers).map((person, index) => ({
        id: asText(person?.id) || `volunteer-${index + 1}`,
        name: asText(person?.name) || `Volunteer ${index + 1}`,
        skills: asArray(person?.skills).map(asText).filter(Boolean),
        availability: asArray(person?.availability).map(asText).filter(Boolean),
      }));
      const assigned = new Set();
      const assignments = [];
      const gaps = [];
      for (const shift of asArray(input.shifts)) {
        const shiftId = asText(shift?.id) || 'unnamed-shift';
        const slot = asText(shift?.slot);
        const requiredSkills = asArray(shift?.requiredSkills).map(asText).filter(Boolean);
        const capacity = Math.max(1, Number(shift?.capacity) || 1);
        const matches = volunteers.filter((person) => !assigned.has(person.id)
          && (!slot || person.availability.includes(slot))
          && hasAll(person.skills, requiredSkills)).slice(0, capacity);
        matches.forEach((person) => assigned.add(person.id));
        assignments.push({ shiftId, volunteers: matches.map((person) => ({ id: person.id, name: person.name })) });
        if (matches.length < capacity) gaps.push({ shiftId, missing: capacity - matches.length, requiredSkills, slot });
      }
      const inventoryGaps = asArray(input.thresholds).flatMap((threshold) => {
        const item = asText(threshold?.item);
        const minimum = Number(threshold?.minimum ?? threshold?.min);
        const current = asArray(input.inventory).find((entry) => asText(entry?.item).toLowerCase() === item.toLowerCase());
        const quantity = Number(current?.quantity) || 0;
        return item && Number.isFinite(minimum) && quantity < minimum ? [{ item, quantity, minimum }] : [];
      });
      return JSON.stringify({ assignments, rosterGaps: gaps, inventoryGaps, notifications: 'No notifications sent; connect a notification adapter after confirming assignments.' });
    },
  }];
}

function nonprofitTools() {
  return [
    {
      spec: { name: 'generate_nonprofit_template', description: 'Generate a reusable small-nonprofit template for an incident report, board memo, or grant tracker.', inputSchema: { json: { type: 'object', properties: { templateType: { type: 'string' }, organization: { type: 'string' }, details: { type: 'string' } }, required: ['templateType'] } } },
      fn: async ({ templateType, organization = '', details = '' } = {}) => {
        const type = asText(templateType).toLowerCase();
        const headings = type.includes('incident') ? ['Incident Report', 'Date and time', 'People involved', 'What happened', 'Immediate actions', 'Follow-up owner']
          : type.includes('board') ? ['Board Memo', 'Decision requested', 'Context', 'Options considered', 'Recommendation', 'Next steps']
            : ['Grant Tracker', 'Funder and grant', 'Deadline', 'Deliverables', 'Owner', 'Status and next action'];
        return [`# ${headings[0]}`, organization ? `Organization: ${organization}` : 'Organization: [add]', ...headings.slice(1).map((heading) => `## ${heading}\n${heading === 'Status and next action' ? details || '[add]' : '[add]'}`)].join('\n\n');
      },
    },
    {
      spec: { name: 'search_internal_policies', description: 'Search caller-provided bylaws or HR policy records and return only matching text with its supplied source citation.', inputSchema: { json: { type: 'object', properties: { query: { type: 'string' }, documents: { type: 'array' } }, required: ['query', 'documents'] } } },
      fn: async ({ query = '', documents = [] } = {}) => {
        const needle = asText(query).toLowerCase();
        const matches = asArray(documents).filter((doc) => `${doc?.title || ''} ${doc?.text || ''}`.toLowerCase().includes(needle));
        if (!matches.length) return 'No supplied internal policy matched. Do not infer an organizational rule; ask for the relevant document or an administrator.';
        return matches.slice(0, 5).map((doc) => `${doc.title || 'Untitled'} — ${doc.text || ''} [Source: ${doc.source || 'source not supplied'}]`).join('\n');
      },
    },
  ];
}

function mutualAidTools() {
  return [
    {
      spec: { name: 'sanitize_mutual_aid_intake', description: 'Redact common contact, precise-location, and sensitive-status details from a mutual-aid intake before sharing it.', inputSchema: { json: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
      fn: async ({ text = '' } = {}) => asText(text)
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gi, '[redacted contact]')
        .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted contact]')
        .replace(/\b(?:address|location|diagnosis|medical status|immigration status|shelter)\s*:\s*[^;\n]+/gi, (match) => `${match.split(':')[0]}: [redacted]`),
    },
    {
      spec: { name: 'pair_mutual_aid_needs', description: 'Pair anonymous needs with community offers only when both records explicitly opt in to peer connection.', inputSchema: { json: { type: 'object', properties: { needs: { type: 'array' }, offers: { type: 'array' } }, required: ['needs', 'offers'] } } },
      fn: async ({ needs = [], offers = [] } = {}) => {
        const matches = [];
        for (const need of asArray(needs)) {
          if (need?.optIn !== true) continue;
          const needTags = asArray(need.tags).map((tag) => asText(tag).toLowerCase());
          const offer = asArray(offers).find((candidate) => candidate?.optIn === true && asArray(candidate.tags).some((tag) => needTags.includes(asText(tag).toLowerCase())));
          if (offer) matches.push({ needId: asText(need.id) || 'anonymous-need', offerId: asText(offer.id) || 'anonymous-offer', status: 'pending-mutual-confirmation' });
        }
        return JSON.stringify({ matches, note: 'No contact details were shared. Both participants must confirm before connection.' });
      },
    },
  ];
}

function civicTools() {
  return [{
    spec: { name: 'verify_civic_sources', description: 'Check supplied civic sources for explicit verification and official institutional URLs before grounding an answer.', inputSchema: { json: { type: 'object', properties: { sources: { type: 'array' } }, required: ['sources'] } } },
    fn: async ({ sources = [] } = {}) => {
      const checked = asArray(sources).map((source) => {
        const url = asText(source?.url);
        const officialUrl = /^https:\/\//i.test(url) && /\.(gov|gc\.ca|edu|org)(\/|$)/i.test(url);
        return { title: asText(source?.title) || 'Untitled source', url, verified: source?.verified === true && officialUrl };
      });
      return JSON.stringify({ grounded: checked.length > 0 && checked.every((source) => source.verified), sources: checked, instruction: 'If grounded is false, state the uncertainty and provide an official contact point instead of asserting the answer.' });
    },
  }];
}

export function createCommunityTools(profileId) {
  if (profileId === 'food-bank') return foodBankTools();
  if (profileId === 'nonprofit-helpdesk') return nonprofitTools();
  if (profileId === 'mutual-aid') return mutualAidTools();
  if (profileId === 'civic-knowledge') return civicTools();
  return [];
}
