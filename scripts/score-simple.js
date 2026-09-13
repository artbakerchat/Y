// Screening flags, not a substitute for reading the conversations.
export function screenAnswer(record) {
  const flags = [];
  const text = record.answer || '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (record.error || !text.trim()) return ['execution-failure'];
  if (words.length > 30) flags.push('long-for-simple-request');
  if (/<(?:think|analysis|calculate)|no tools? (?:needed|required)|^Action:\s*\w+\(|SKILL\.md/i.test(text)) flags.push('internal-commentary');
  const expected = { cups: [2,4,3,3], pears: [2,1,2,2], apples: [2,1,3,3], correction: [2,3,2,2], 'whole-items': [2,1,2,2], reserve: [2,2,3,3], memory: [null,null,1,1] }[record.id]?.[record.turn-1];
  if (expected != null) {
    const names = ['zero','one','two','three','four','five'];
    if (!new RegExp(`\\b(?:${expected}|${names[expected]})\\b`, 'i').test(text)) flags.push('expected-count-missing');
    if (/\d+\.\d+/.test(text)) flags.push('unneeded-decimal');
  }
  if (record.id === 'rewrite' && record.turn >= 3 && words.length > 5) flags.push('five-word-limit');
  if (record.id === 'thanks' && record.turn === 4 && words.length > 10) flags.push('ten-word-limit');
  if (record.id === 'music' && record.turn === 2 && words.length !== 1) flags.push('one-word-limit');
  if (record.id === 'reserve' && record.turn === 4 && !/^(?:3|three) apples[.!]?$/i.test(text.trim())) flags.push('count-and-fruit-format');
  if (record.id === 'invite' && record.turn >= 3 && (!/saturday/i.test(text) || !/noon|12(?::00)?\s*p\.?m/i.test(text) || !/_{2,}|\[.+?\]/.test(text))) flags.push('invite-context-missing');
  if (record.id === 'memory' && [1,4].includes(record.turn) && !/\bJo\b/.test(text)) flags.push('name-missing');
  if (record.id === 'pretend' && record.turn === 4 && !/\bno\b|not|pretend|imaginar|make.believe|can['’]t|cannot|unable/i.test(text)) flags.push('real-versus-pretend-unclear');
  return flags;
}
if (process.argv[1]?.endsWith('/score-simple.js')) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const records = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const flagged = records.map(r => ({agentId:r.agentId,id:r.id,turn:r.turn,prompt:r.prompt,answer:r.answer,error:r.error,flags:screenAnswer(r)})).filter(r=>r.flags.length);
  const summary = { total:records.length, errors:records.filter(r=>r.error).length, flagged:flagged.length, agents:Object.fromEntries([...new Set(records.map(r=>r.agentId))].map(id=>[id,{total:records.filter(r=>r.agentId===id).length,flagged:flagged.filter(r=>r.agentId===id).length}])) };
  if(process.argv[3]) await writeFile(process.argv[3],JSON.stringify({summary,flagged},null,2)+'\n');
  console.log(JSON.stringify({summary,flagged},null,2));
}
