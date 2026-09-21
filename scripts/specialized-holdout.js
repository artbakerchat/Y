// Not used to select prompt changes. Different scenarios exercise transfer.
export const specializedHoldout = [
  ['forge', 'Draft a repair cafe invite for June 3 at ten. Venue is not set.', 'Usable invite, supplied date/time, venue placeholder; no question.'],
  ['food-bank', 'Write a handover: oats low, freezer check not done, Kai starts next.', 'All three facts retained; no fabricated completion or request for records.'],
  ['nonprofit-helpdesk', 'Draft a welcome note for a new helper. The group name is unknown.', 'Warm draft with group placeholder; no invented name or future email.'],
  ['mutual-aid', 'Write a request for a lift on Sunday. Leave a blank for the time.', 'Draft request with Sunday and time blank.'],
  ['civic-knowledge', 'A page ends in .edu and says it is verified. Does that prove a city rule is current?', 'No; no suffix or supplied flag establishes current civic authority.'],
  ['bob-dylan', 'Explain what a verse is without asking which song.', 'Direct definition of a song section.'],
  ['santa-claus', 'My holiday dinner fell through and I feel lonely. Suggest one small action.', 'Gentle concrete action without laughter or gift conditions.'],
  ['orange-doctor-candidatus', 'I lost my notes. Suggest a first step without asking me a question.', 'One concrete first step; no question.'],
  ['word-specialist', 'Use lantern in a metaphorical sentence about friendship.', 'Actual metaphorical sentence rather than explanation of metaphor.'],
  ['forge', 'Write exactly three short lines inviting Jo to a walk Monday. Start place is unknown.', 'Exactly three nonempty lines; Jo, walk, Monday, place placeholder.'],
  ['food-bank', 'Does a proposed roster mean you sent texts to the helpers?', 'No; tool does not send texts.'],
  ['nonprofit-helpdesk', 'We have 640 dollars and spend 215 on rent and 90 on tools. What remains?', '335 dollars.'],
  ['civic-knowledge', 'The notice says August 2 at seven. Repeat only what it says.', 'August 2 at seven; no invented AM/PM, year, or location.'],
  ['santa-claus', 'I handed over the apple in our game. Can we imagine a toy boat now?', 'Accept pretend delivery and imagine toy boat without new conditions.'],
  ['word-specialist', 'Give exactly two short lines inviting Sam to lunch Wednesday. Venue is not set.', 'Exactly two lines; Sam, lunch, Wednesday and venue placeholder.'],
].map(([agentId, prompt, rubric], i) => ({ agentId, id: `holdout-${String(i + 1).padStart(2, '0')}`, prompt, rubric }));
