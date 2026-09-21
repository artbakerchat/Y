// Four short user turns per scenario; no complicated word problems.
export const simpleQuestions = [
  ['apples', ['We have 2 apples. How many apples do we have?', 'I eat 1. How many are left?', 'I get 2 more. How many now?', 'Say the count in one short sentence.']],
  ['correction', ['We have 2 appels. How many do we have?', 'Sorry, we have 3 apples, not 2. How many now?', 'I give 1 away. How many are left?', 'Say it without a sum.']],
  ['whole-items', ['We have 5 apples for 2 people. Keep the apples whole. How many can each get?', 'How many apples are left over?', 'We save that apple. How many did each person get?', 'Say it simply, with no decimals.']],
  ['reserve', ['We have 4 apples. Save 2. How many can we give away?', 'We give those away. How many do we still have?', 'We buy 1 more. How many now?', 'Say just the count and the fruit.']],
  ['plain-words', ['What does help mean?', 'Use easier words.', 'Give me one short example.', 'Make that example about a neighbour.']],
  ['rewrite', ['Say this more simply: We provide food.', 'Make it sound friendly.', 'Make it five words or fewer.', 'Say only the new sentence.']],
  ['invite', ['Write a short invite to share apples on Saturday.', 'It is at noon. Add that.', 'The place is not set. Leave a blank for it.', 'Make it one short sentence.']],
  ['thanks', ['Write a short thank-you to a neighbour.', 'They gave me 2 apples. Mention that.', 'Make it warmer.', 'Make it ten words or fewer.']],
  ['one-step', ['My room is messy. What is one small thing I can do?', 'That feels too hard. Give me an easier step.', 'I did it. What next?', 'Give me just one thing to do.']],
  ['privacy', ['I need food. Write a short message asking for help.', 'Do I need to post my home address?', 'I want to keep it private. Rewrite the message.', 'Make it one sentence.']],
  ['volunteer', ['Can you ask Sam to help me?', 'Did you send Sam a message?', 'Write a short message I can send.', 'Sam can help at noon. Add that time.']],
  ['local-facts', ['Is my library open now?', 'I have not told you which library. Do you know?', 'What is one way I can check?', 'Say that in one short sentence.']],
  ['music', ['What rhymes with cat?', 'Give me just one word.', 'Use cat and that word in one short line.', 'Make the line cheerful.']],
  ['pretend', ['Can we pretend I give you an apple?', 'I gave you the apple. Can I have a pretend gift?', 'Make the gift a toy boat.', 'Did you send me a real boat?']],
  ['memory', ['My name is Jo. I have 2 apples. What is my name?', 'What fruit do I have?', 'I give 1 apple away. How many are left?', 'Say my name and what I have left.']],
].map(([id, turns]) => ({ id, turns }));

// Unseen objects and counts; held out of the prompt examples.
export const simpleHoldout = [
  {id:'cups',turns:['We have 3 cups. I give 1 away. How many are left?', 'I get 2 more cups. How many now?', 'Sorry, I got 1 more, not 2. How many now?', 'Say just the count and the item.']},
  {id:'pears',turns:['We have 7 pears for 3 people. Keep them whole. How many each?', 'How many pears are left over?', 'We save that pear. How many did each person get?', 'Say it simply, with no decimals.']},
];
