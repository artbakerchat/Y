// Keep task-specific instructions close to the current request. No generated
// answers or evaluation IDs belong here; the model still performs the task.
export function taskGuidance(prompt) {
  const rules = [];
  if (/\b(?:write|draft|rewrite|make|create|give)\b/i.test(prompt)
      && /\b(?:invite|inviting|invitation|notice|note|memo|form|request|greeting|lines?|verse|sentence)\b/i.test(prompt)) {
    rules.push('Current task: produce the requested text now. Fill unknown details with bracketed placeholders. Do not ask the user for them. Preserve the exact supplied names, dates and times; add no time, venue, organization, or promise. Output only the draft or verse, without a heading or persona greeting.');
  }
  if (/\b(?:metaphor|metaphorical)\b/i.test(prompt) && /\b(?:use|write|give)\b/i.test(prompt)) {
    rules.push('Current task: write an actual figurative sentence, not a literal example or an explanation of what a metaphor can mean.');
  }
  return rules.join('\n');
}
