// ═════════════════════════════════════════════════════════════════════════════
// QUIZ BANK — the educational payload of מרוץ הפרומפטים
// ═════════════════════════════════════════════════════════════════════════════
//
// 103 kid-level questions about AI and prompting. This file is DATA ONLY — no
// THREE, no DOM, no bus — so it can be unit-checked by a plain node script.
//
// ── ENTRY SHAPE ──
//   {
//     id:      'prompt-detail',      unique, stable (never renumber: saves may reference it)
//     tier:    1 | 2 | 3,            1 = race one, 2 = race two, 3 = the finale
//     topic:   'whatai' | 'prompt' | 'tokens' | 'iterate' | 'mistakes' | 'vibe',
//     correct: 0 | 1 | 2,            index into he.a / en.a (SAME index in both languages)
//     he: { q, a:[3 strings], why },
//     en: { q, a:[3 strings], why },
//   }
//
// ── AUTHORING RULES (please keep these if you add questions) ──
// • Hebrew is the source language. It is written for a 9–12 year old, out loud,
//   and it is GENDER-NEUTRAL throughout: impersonal infinitives ("לכתוב", "כדאי",
//   "אפשר") and plural forms, never "אתה"/"את" and never a masculine imperative.
// • The question fits on one line at a glance — a child is reading this while a
//   kart is still moving. Hard ceiling: 80 characters.
// • All three answers must be defensible-sounding. A distractor that is obviously
//   a joke lets a child score without thinking, which teaches nothing.
// • No trick questions, no double negatives, no "which is NOT".
// • `why` is where the teaching actually happens. It states the rule, not just
//   "correct". Two short sentences, max 190 characters.
// • The correct index is deliberately spread across 0/1/2 so that a child who
//   only ever presses 1 does not get lucky. The runtime ALSO reshuffles options
//   per draw (see quiz.js drawQuestion) — both layers are intentional.
// • Position is shuffled at runtime, so the tells that matter are the ones the
//   TEXT carries. The correct answer must not be the longest option (a child can
//   score without reading), and no word may be a giveaway: "tokens" outside a
//   token question, "always"/"never", or emphasis-by-punctuation must each turn
//   up in right answers roughly as often as in wrong ones. tests/quizbank.test.mjs
//   gates all four; the bank had drifted into every one of them before it did.

export const TOPICS = ['whatai', 'prompt', 'tokens', 'iterate', 'mistakes', 'vibe'];

export const QUESTIONS = [
  // ───────────────────────────────────────────────── what AI / an LLM actually is
  {
    id: 'ai-what-is', tier: 1, topic: 'whatai', correct: 1,
    he: {
      q: 'מה זה בעצם מודל שפה, כמו הצ׳אטים החכמים?',
      a: [
        'אנציקלופדיה ענקית שמחפשים בה תשובה מוכנה',
        'תוכנה שלמדה מהמון טקסט לנחש איזו מילה מתאימה להמשך',
        'אדם אמיתי שיושב מהצד השני של המסך ומקליד את התשובות',
      ],
      why: 'מודל שפה קרא כמות עצומה של טקסט ולמד לנחש מה מתאים לבוא אחר כך. זה נשמע כמו שיחה, אבל מאחורי הקלעים זה ניחוש חכם מאוד.',
    },
    en: {
      q: 'What is a language model — the kind behind smart chats?',
      a: [
        'A giant encyclopedia where you look up a ready-made answer',
        'Software that learned from lots of text to guess the next word',
        'A real person on the other side of the screen, typing each answer',
      ],
      why: 'A language model read an enormous amount of text and learned to guess what fits next. It feels like a conversation, but under the hood it is a very clever guess.',
    },
  },
  {
    id: 'ai-how-learns', tier: 1, topic: 'whatai', correct: 0,
    he: {
      q: 'איך מודל AI לומד את מה שהוא יודע?',
      a: [
        'מאימון על כמות עצומה של דוגמאות',
        'מישהו הקליד לו את כל הכללים אחד־אחד',
        'הוא קורא מחדש את כל האינטרנט בכל פעם ששואלים',
      ],
      why: 'אף אחד לא כתב למודל רשימת כללים. הוא ראה מיליוני דוגמאות ומצא בעצמו את הדפוסים החוזרים — בערך כמו ללמוד שפה משמיעה.',
    },
    en: {
      q: 'How does an AI model learn what it knows?',
      a: [
        'By training on an enormous number of examples',
        'Someone typed every rule into it one by one',
        'It rereads the entire internet every time you ask it something',
      ],
      why: 'Nobody wrote the model a rulebook. It saw millions of examples and found the repeating patterns itself — a bit like picking up a language by ear.',
    },
  },
  {
    id: 'ai-answer-source', tier: 1, topic: 'whatai', correct: 2,
    he: {
      q: 'כשה־AI עונה, מאיפה מגיעה התשובה?',
      a: [
        'מתשובה שמורה שנשלפת מהזיכרון',
        'ממומחה אנושי שמקבל את השאלה ומכתיב את התשובה',
        'הוא מרכיב אותה חתיכה אחרי חתיכה, ממש עכשיו',
      ],
      why: 'התשובה נבנית תוך כדי, חתיכה אחרי חתיכה. לכן אותה שאלה יכולה לקבל ניסוח אחר בכל פעם — אין מגירה עם תשובות מוכנות.',
    },
    en: {
      q: 'When an AI answers, where does the answer come from?',
      a: [
        'A saved answer pulled out of storage',
        'A human expert who receives the question',
        'It builds it piece by piece, right now',
      ],
      why: 'The answer is built as it goes, piece by piece. That is why the same question can come back worded differently — there is no drawer of ready answers.',
    },
  },
  {
    id: 'ai-feelings', tier: 2, topic: 'whatai', correct: 1,
    he: {
      q: 'מה נכון לגבי AI ורגשות?',
      a: [
        'הוא מרגיש שמחה, עצב והתרגשות ממש כמו בן אדם',
        'הוא יודע לכתוב על רגשות, אבל לא מרגיש אותם',
        'הוא לא מסוגל לכתוב על רגשות בכלל',
      ],
      why: 'המודל למד איך אנשים כותבים על רגשות, ולכן הוא כותב על זה יפה. זה עדיין תיאור של רגש ולא רגש — נחמד לזכור את זה כשהתשובה נשמעת אישית.',
    },
    en: {
      q: 'What is true about AI and feelings?',
      a: [
        'It feels joy, sadness and excitement just like a person does',
        'It can write about feelings, but does not feel them',
        'It cannot write about feelings at all',
      ],
      why: 'The model learned how people write about feelings, so it writes about them well. That is still a description of a feeling, not a feeling — worth remembering when an answer sounds personal.',
    },
  },
  {
    id: 'ai-same-question', tier: 2, topic: 'whatai', correct: 2,
    he: {
      q: 'למה אותה שאלה בדיוק יכולה לקבל שתי תשובות שונות?',
      a: [
        'כי המודל זוכר מי שאל אותו קודם ומשתעמם מחזרות',
        'כי כל אחד מקבל מודל אחר',
        'כי בבחירת המילים יש גם קצת אקראיות',
      ],
      why: 'בכל צעד יש כמה מילים שמתאימות, והמודל בוחר ביניהן עם קצת אקראיות. זה מה שנותן גיוון — ובדיוק לכן שווה לנסות שוב כשהתשובה לא קלעה.',
    },
    en: {
      q: 'Why can the exact same question get two different answers?',
      a: [
        'The model remembers who asked before and gets bored of repeating',
        'Everyone gets a different model',
        'There is a little randomness in how words get picked',
      ],
      why: 'At each step several words fit, and the model picks among them with a little randomness. That is what gives variety — and exactly why retrying is worth it.',
    },
  },
  {
    id: 'ai-context-window', tier: 1, topic: 'whatai', correct: 1,
    he: {
      q: 'מה זה "חלון הקשר" של מודל?',
      a: [
        'החלון שבתוכנה שבו מקלידים את השאלה ולוחצים על שליחה',
        'כמות הטקסט שהמודל יכול להחזיק מול העיניים בבת אחת',
        'מספר השאלות שמותר לשאול ביום',
      ],
      why: 'למודל יש גבול לכמות הטקסט שהוא מחזיק בבת אחת. כששיחה נעשית ארוכה מאוד, הדברים הישנים נדחקים החוצה — ולכן שווה לחזור על מה שחשוב.',
    },
    en: {
      q: 'What is a model\'s "context window"?',
      a: [
        'The box on screen where you type the question and press send',
        'How much text the model can hold in view at once',
        'How many questions you are allowed per day',
      ],
      why: 'A model can only hold so much text at once. In a very long chat the older parts get pushed out — so it pays to restate what matters.',
    },
  },

  // ───────────────────────────────────────────────────── what a prompt is
  {
    id: 'prompt-what-is', tier: 1, topic: 'prompt', correct: 2,
    he: {
      q: 'מה זה פרומפט?',
      a: [
        'השם של המודל החכם שאיתו עובדים כרגע',
        'הכפתור ששולח את ההודעה',
        'ההוראה או הבקשה שכותבים ל־AI',
      ],
      why: 'כל מה שנכתב בתיבה הוא הפרומפט, כולל ה״שלום״ וה״תודה״. זה גם החלק היחיד שבשליטתנו: המודל, בסך הכול, מגיב אליו.',
    },
    en: {
      q: 'What is a prompt?',
      a: [
        'The name of the smart model you are working with',
        'The button that sends the message',
        'The instruction or request written to the AI',
      ],
      why: 'Everything typed in the box is the prompt, the \'hello\' and \'thanks\' included. It is also the only part you control: the model just responds to it.',
    },
  },
  {
    id: 'prompt-better-one', tier: 1, topic: 'prompt', correct: 1,
    he: {
      q: 'איזה פרומפט ייתן סיפור קרוב יותר למה שדמיינו?',
      a: [
        'לכתוב סיפור, תודה רבה!',
        'לכתוב סיפור קצר לילדי כיתה ד׳ על חתול אמיץ שמפחד ממים',
        'לכתוב סיפור ממש מעולה, מרגש מאוד ומרתק שכל הכיתה תאהב',
      ],
      why: 'מילים כמו "מעולה" לא אומרות למודל כלום. פרטים כן: על מה, למי, ובאיזה אורך. נימוס זה נחמד — אבל פרטים זה מה שעובד.',
    },
    en: {
      q: 'Which prompt gives a story closer to the one imagined?',
      a: [
        'Write a story, thanks a lot!',
        'Write a short story for 4th graders about a brave cat afraid of water',
        'Write a truly excellent, very moving story that the whole class will love',
      ],
      why: 'Words like "excellent" tell the model nothing. Details do: about what, for whom, how long. Politeness is nice — details are what work.',
    },
  },
  {
    id: 'prompt-add-detail', tier: 1, topic: 'prompt', correct: 0,
    he: {
      q: 'מה הכי כדאי להוסיף לפרומפט "לצייר בית"?',
      a: [
        'איזה בית, באיזה סגנון ובאילו צבעים',
        'סימני קריאה רבים, כדי להדגיש שזה באמת חשוב',
        'לחזור על אותו פרומפט שלוש פעמים',
      ],
      why: 'ל"בית" יש מיליון גרסאות, והמודל יבחר אחת. כל פרט שמוסיפים — סגנון, צבע, שעה ביום — מקרב את התוצאה לתמונה שבראש.',
    },
    en: {
      q: 'What is most worth adding to the prompt "draw a house"?',
      a: [
        'Which house, in what style, in which colours',
        'Lots of exclamation marks, to show that it really matters',
        'The same prompt repeated three times',
      ],
      why: 'A "house" has a million versions and the model will pick one. Every detail added — style, colour, time of day — pulls the result toward the picture in your head.',
    },
  },
  {
    id: 'prompt-audience', tier: 2, topic: 'prompt', correct: 2,
    he: {
      q: 'למה עוזר לכתוב "להסביר כאילו לילד בן עשר"?',
      a: [
        'כי ככה המודל עובד מהר יותר ומחזיר תשובה כמעט מיד',
        'כי הסבר לילד קצר יותר, וקצר עולה פחות טוקנים',
        'כי קהל היעד משנה את המילים ואת רמת ההסבר',
      ],
      why: 'אותו תוכן אפשר להסביר במאה רמות. כשאומרים למי ההסבר מיועד, המודל בוחר מילים ודוגמאות שמתאימות בדיוק לקהל הזה.',
    },
    en: {
      q: 'Why does "explain it like I\'m ten" help?',
      a: [
        'It makes the model run faster',
        'An explanation for a child is shorter, and short costs fewer tokens',
        'Naming the audience changes the words and the level',
      ],
      why: 'The same content can be explained a hundred ways. Naming who it is for lets the model pick words and examples that fit that reader.',
    },
  },
  {
    id: 'prompt-example', tier: 2, topic: 'prompt', correct: 1,
    he: {
      q: 'מה עושה דוגמה שמצרפים לתוך הפרומפט?',
      a: [
        'מבלבלת את המודל בין הדוגמה לפרומפט',
        'מראה בדיוק באיזה פורמט רוצים את התשובה',
        'מאריכה את הפרומפט בלי להשפיע על התוצאה',
      ],
      why: 'קשה לתאר במילים "טבלה כזאת" או "סגנון כזה". דוגמה אחת קטנה חוסכת פסקה שלמה של הסברים, והמודל מחקה את הפורמט.',
    },
    en: {
      q: 'What does an example inside a prompt do?',
      a: [
        'Confuses the model between the example and the prompt',
        'Shows exactly what format the answer should take',
        'Makes the prompt longer without changing the result',
      ],
      why: 'It is hard to describe "a table like this" in words. One small example saves a paragraph of explanation, and the model copies the format.',
    },
  },
  {
    id: 'prompt-short-answer', tier: 2, topic: 'prompt', correct: 0,
    he: {
      q: 'מה הכי יעזור לקבל תשובה קצרה?',
      a: [
        'לבקש מראש שלוש שורות לכל היותר — פחות טוקנים וגם ברור יותר',
        'לכתוב "קצר בבקשה" בלי מספר',
        'לשאול שאלה קצרה ולקוות לתשובה קצרה',
      ],
      why: '"קצר" זה יחסי, ומספר זה לא. גבול ברור — שלוש שורות, חמישה משפטים — הופך פרומפט מעורפל להוראה שאפשר לעמוד בה.',
    },
    en: {
      q: 'What helps most to get a short answer?',
      a: [
        'Asking up front for three lines at most — fewer tokens, clearer answer',
        'Writing "keep it short" with no number',
        'Asking a short question and hoping for a short answer',
      ],
      why: '"Short" is relative; a number is not. A clear limit — three lines, five sentences — turns a vague wish into an instruction that can be followed.',
    },
  },
  {
    id: 'prompt-role', tier: 3, topic: 'prompt', correct: 2,
    he: {
      q: 'מה עושה תפקיד בפרומפט, כמו "בתור מדריך טיולים"?',
      a: [
        'הופך את המודל למומחה אמיתי בתחום, עם ידע שלא היה לו',
        'גורם לתשובה להיות ארוכה יותר',
        'מכוון את נקודת המבט ואת סוג הדברים שיעלו בתשובה',
      ],
      why: 'תפקיד לא מוסיף למודל ידע חדש, אבל הוא בוחר מאיזו זווית לענות. מדריך טיולים ידבר על מסלולים ונוף, ביולוג ידבר על בעלי חיים.',
    },
    en: {
      q: 'What does a role like "as a hiking guide" do in a prompt?',
      a: [
        'Turns the model into a real expert with new knowledge of the field',
        'Makes the answer longer',
        'Steers the point of view and what the answer brings up',
      ],
      why: 'A role adds no new knowledge, but it picks the angle. A hiking guide talks trails and views; a biologist talks animals.',
    },
  },
  {
    id: 'prompt-break-steps', tier: 3, topic: 'prompt', correct: 1,
    he: {
      q: 'בפרומפט גדול ומורכב, מה עוזר בדרך כלל?',
      a: [
        'לכתוב את הכול במשפט אחד ארוך מאוד',
        'לפרק לשלבים ולהגיד מה חשוב בכל שלב',
        'לשלוח כמה פרומפטים קצרים בלי לקשר ביניהם',
      ],
      why: 'משימה גדולה בהודעה אחת מזמינה תשובה שמחמיצה חלקים. שלבים מסודרים נותנים למודל — ולנו — לבדוק כל חלק לפני שממשיכים.',
    },
    en: {
      q: 'For one big, complicated prompt, what usually helps?',
      a: [
        'Writing it all in one very long sentence',
        'Breaking it into steps and saying what matters in each',
        'Sending several short prompts with no connection between them',
      ],
      why: 'A big task in one message invites an answer that misses parts. Ordered steps let the model — and you — check each piece before moving on.',
    },
  },

  // ─────────────────────────────────────────────────────────── tokens
  {
    id: 'tokens-what-is', tier: 1, topic: 'tokens', correct: 1,
    he: {
      q: 'מה זה טוקנים?',
      a: [
        'מטבעות שאוספים בתוך משחקי מחשב ואפליקציות',
        'חתיכות קטנות של טקסט שהמודל סופר',
        'שמות הדגמים של מודלי ה־AI',
      ],
      why: 'טקסט מפורק לחתיכות קטנות: מילה, חצי מילה או סימן פיסוק. המודל קורא וכותב בחתיכות האלה, ולכן סופרים אותן.',
    },
    en: {
      q: 'What are tokens?',
      a: [
        'Coins you collect inside computer games and apps',
        'Small chunks of text that the model counts',
        'The model names of AI systems',
      ],
      why: 'Text is broken into small chunks: a word, half a word, or a punctuation mark. The model reads and writes in those chunks, so those are what get counted.',
    },
  },
  {
    id: 'tokens-long-costs', tier: 1, topic: 'tokens', correct: 2,
    he: {
      q: 'למה פרומפט ארוך מאוד "עולה" יותר?',
      a: [
        'כי היא נשלחת למקום רחוק יותר',
        'כי המודל מתקשה להתרכז בטקסט ארוך ומאבד סבלנות',
        'כי יש בה יותר טוקנים, וכל טוקן דורש עבודה',
      ],
      why: 'לכל טוקן יש מחיר קטן בחישוב. הרבה טוקנים — הרבה חישוב, ולכן יותר זמן ויותר עלות. זה בדיוק כמו הטוקנים שאוספים במסלול.',
    },
    en: {
      q: 'Why does a very long prompt "cost" more?',
      a: [
        'Because it is sent somewhere further away',
        'Because the model struggles to stay focused through long text',
        'Because it holds more tokens, and each token takes work',
      ],
      why: 'Every token costs a little computation. Many tokens means much computation — more time and more cost. Just like the tokens you collect on track.',
    },
  },
  {
    id: 'tokens-both-ways', tier: 2, topic: 'tokens', correct: 0,
    he: {
      q: 'מה נספר בטוקנים?',
      a: [
        'גם מה ששולחים וגם מה שחוזר בתשובה',
        'רק מה ששולחים, כי התשובה כבר נכתבת בחינם',
        'רק התשובה שחוזרת',
      ],
      why: 'שני הכיוונים נספרים. לכן פרומפט שמבקש תשובה ענקית יכול לעלות יותר מהפרומפט עצמו — ולכן שווה לבקש בדיוק את האורך שצריך.',
    },
    en: {
      q: 'What gets counted as tokens?',
      a: [
        'Both what you send and what comes back',
        'Only what you send, since the answer is written for free',
        'Only the answer that comes back',
      ],
      why: 'Both directions count. Asking for a giant answer can cost more than the question did — another reason to ask for the length you actually need.',
    },
  },
  {
    id: 'tokens-save-well', tier: 2, topic: 'tokens', correct: 2,
    he: {
      q: 'איך חוסכים טוקנים בלי לפגוע בתוצאה?',
      a: [
        'מוחקים את כל הפרטים ומשאירים מילה אחת בלבד',
        'כותבים בקיצורים שקשה להבין',
        'כותבים פרומפט ממוקד, בלי חזרות ובלי מילוי',
      ],
      why: 'חיסכון חכם מוחק מה שלא מוסיף — נימוסים ארוכים, חזרות, "כמו שאמרתי קודם". הפרטים שמסבירים מה רוצים נשארים תמיד.',
    },
    en: {
      q: 'How do you save tokens without hurting the result?',
      a: [
        'Delete every detail and leave just one single word',
        'Write in abbreviations that are hard to follow',
        'Write a focused prompt, no repeats and no filler',
      ],
      why: 'Smart saving cuts what adds nothing — long pleasantries, repeats, "as I said before". The details that explain what you want always stay.',
    },
  },
  {
    id: 'tokens-worth-spending', tier: 3, topic: 'tokens', correct: 1,
    he: {
      q: 'מתי דווקא שווה "לבזבז" טוקנים?',
      a: [
        'אף פעם — קצר תמיד עדיף',
        'כשמוסיפים הקשר או דוגמה שבאמת משפרים את התשובה',
        'כשרוצים שהתשובה תיראה ארוכה ומרשימה יותר',
      ],
      why: 'טוקנים הם תקציב, לא ציון. משפט הקשר שחוסך שלושה ניסיונות כושלים הוא העסקה הכי משתלמת שיש.',
    },
    en: {
      q: 'When is it actually worth "spending" tokens?',
      a: [
        'Never — shorter is always better',
        'When context or an example genuinely improves the answer',
        'When you want the answer to look longer and more impressive',
      ],
      why: 'Tokens are a budget, not a score. One sentence of context that saves three failed attempts is the best deal on the table.',
    },
  },
  {
    id: 'tokens-languages', tier: 3, topic: 'tokens', correct: 0,
    he: {
      q: 'משפט קצר בעברית ומשפט קצר באנגלית — מה נכון?',
      a: [
        'מספר הטוקנים יכול להיות שונה בין השפות',
        'מספר הטוקנים נקבע לפי מספר המילים במשפט',
        'טוקנים נספרים לפי מספר האותיות בלבד',
      ],
      why: 'החלוקה לטוקנים נלמדה בעיקר מטקסטים באנגלית, ולכן עברית מתפרקת לרוב לחתיכות קטנות יותר. אותו רעיון, יותר טוקנים.',
    },
    en: {
      q: 'A short Hebrew sentence and a short English one — what is true?',
      a: [
        'The token count can differ between languages',
        'The token count is set by how many words the sentence has',
        'Tokens are counted purely by number of letters',
      ],
      why: 'Token splitting was learned mostly from English text, so Hebrew usually breaks into smaller pieces. Same idea, more tokens.',
    },
  },

  // ─────────────────────────────────────────────────── iteration
  {
    id: 'iterate-try-again', tier: 1, topic: 'iterate', correct: 2,
    he: {
      q: 'התשובה יצאה לגמרי לא מה שרצו. מה הכי כדאי לעשות?',
      a: [
        'לוותר ולעשות את זה לבד',
        'לשלוח שוב בדיוק את אותו פרומפט',
        'לשפר את הפרומפט — ולנסות שוב',
      ],
      why: 'ניסיון ראשון הוא טיוטה, לא גזר דין. מי שמשפר פרומפט ומנסה שוב מקבל תוצאות טובות בהרבה ממי שמנסה פעם אחת.',
    },
    en: {
      q: 'The answer came out nothing like what you wanted. What is best?',
      a: [
        'Give up and do it yourself',
        'Send the exact same prompt again and hope for better',
        'Improve the prompt — and try again',
      ],
      why: 'A first try is a draft, not a verdict. People who sharpen the prompt and retry get far better results than people who ask once.',
    },
  },
  {
    id: 'iterate-keep-change', tier: 2, topic: 'iterate', correct: 1,
    he: {
      q: 'התשובה כמעט טובה. מה הכי יעיל לכתוב עכשיו?',
      a: [
        'לכתוב "לא טוב" ולחכות',
        'להגיד מה לשמור ומה לשנות',
        'לפתוח שיחה חדשה ולהתחיל מההתחלה',
      ],
      why: '"לא טוב" משאיר את המודל לנחש. "הפתיחה מצוינת, הסוף ארוך מדי" נותן לו בדיוק את מה שצריך כדי לתקן רק את החלק השבור.',
    },
    en: {
      q: 'The answer is almost right. What is most effective to write now?',
      a: [
        'Write "not good" and wait',
        'Say what to keep and what to change',
        'Open a brand new chat and start over from scratch',
      ],
      why: '"Not good" leaves the model guessing. "The opening is great, the ending is too long" gives it exactly what it needs to fix only the broken part.',
    },
  },
  {
    id: 'iterate-one-change', tier: 2, topic: 'iterate', correct: 0,
    he: {
      q: 'למה כדאי לשנות דבר אחד בכל ניסיון?',
      a: [
        'כי ככה יודעים איזה שינוי הוא זה שעזר',
        'כי המודל לא מסוגל לקלוט שני שינויים בבת אחת',
        'כי ניסיון עם שינוי אחד רץ מהר יותר',
      ],
      why: 'כששני דברים משתנים יחד ומשהו משתפר — אי אפשר לדעת מי אחראי. שינוי אחד בכל פעם הופך ניחוש לניסוי אמיתי.',
    },
    en: {
      q: 'Why change one thing per attempt?',
      a: [
        'So you know which change is the one that helped',
        'Because the model cannot handle two changes at once',
        'Because a one-change attempt runs faster',
      ],
      why: 'When two things change together and something improves, you cannot tell which did it. One change at a time turns guessing into a real experiment.',
    },
  },
  {
    id: 'iterate-fresh-chat', tier: 3, topic: 'iterate', correct: 1,
    he: {
      q: 'מתי עדיף להתחיל שיחה חדשה במקום להמשיך לתקן?',
      a: [
        'אחרי בדיוק חמש הודעות בשיחה, לפי הכלל המקובל',
        'כשהשיחה מלאה בכיוונים ישנים שממשיכים לחזור',
        'עדיף להמשיך באותה שיחה, כי המודל כבר מכיר את ההקשר',
      ],
      why: 'המודל רואה את כל השיחה, כולל הניסיונות שנכשלו, וממשיך להיגרר אליהם. פתיחה נקייה עם הפרומפט המשופר עוקפת את כל הרעש הזה.',
    },
    en: {
      q: 'When is a fresh chat better than more fixing?',
      a: [
        'After exactly five messages, as the usual rule goes',
        'When the chat is full of old directions that keep coming back',
        'Better to continue the same chat, since it already knows the context',
      ],
      why: 'The model sees the whole chat, failed attempts included, and keeps drifting back to them. A clean start with the improved prompt skips all that noise.',
    },
  },

  // ──────────────────────────────────────────── AI makes mistakes
  {
    id: 'mistakes-confident', tier: 1, topic: 'mistakes', correct: 0,
    he: {
      q: 'ה־AI ענה בביטחון מלא. אפשר לסמוך על זה?',
      a: [
        'לא בהכרח — גם תשובה בטוחה מאוד יכולה להיות שגויה',
        'כן, כשהתשובה נשמעת בטוחה זה בדרך כלל סימן שהיא נכונה',
        'כן, אם התשובה ארוכה ומפורטת',
      ],
      why: 'המודל כותב הכול באותו טון בטוח, גם כשהוא טועה. הביטחון בטקסט הוא סגנון כתיבה — לא הוכחה.',
    },
    en: {
      q: 'The AI answered with total confidence. Can you rely on it?',
      a: [
        'Not necessarily — a very confident answer can still be wrong',
        'Yes, when an answer sounds sure that usually means it is right',
        'Yes, if the answer is long and detailed',
      ],
      why: 'The model writes everything in the same confident tone, including its mistakes. Confidence in the text is a writing style, not proof.',
    },
  },
  {
    id: 'mistakes-check-fact', tier: 1, topic: 'mistakes', correct: 2,
    he: {
      q: 'איך בודקים עובדה שה־AI נתן?',
      a: [
        'שואלים את אותו AI שוב אם הוא בטוח בתשובה שלו',
        'סופרים כמה פעמים הוא חזר על זה',
        'משווים למקור אמין נוסף, מחוץ לשיחה',
      ],
      why: 'לשאול את המודל "אתה בטוח?" בדרך כלל רק מוליד תשובה בטוחה עוד יותר. בדיקה אמיתית מגיעה ממקור אחר: אתר, ספר, מבוגר שיודע.',
    },
    en: {
      q: 'How do you check a fact the AI gave you?',
      a: [
        'Ask the same AI again whether it is really sure of its answer',
        'Count how many times it repeated it',
        'Compare it with a trustworthy source outside the chat',
      ],
      why: 'Asking a model "are you sure?" usually just produces an even surer answer. A real check comes from elsewhere: a site, a book, an adult who knows.',
    },
  },
  {
    id: 'mistakes-hallucination', tier: 2, topic: 'mistakes', correct: 1,
    he: {
      q: 'מה זה "הזיה" של מודל?',
      a: [
        'כשהוא מסרב לענות על שאלה שנראית לו בעייתית או מוזרה',
        'כשהוא ממציא פרט שנשמע נכון לגמרי אבל אינו נכון',
        'כשהוא עונה לאט מהרגיל',
      ],
      why: 'המודל תמיד מנסה להשלים משהו שמתאים, גם כשאין לו את המידע. אז נולד פרט שנשמע מושלם ופשוט לא קיים — ולכן בודקים.',
    },
    en: {
      q: 'What is a model "hallucination"?',
      a: [
        'When it refuses to answer a question that it finds odd or risky',
        'When it invents a detail that sounds completely right but is not',
        'When it answers slower than usual',
      ],
      why: 'The model always tries to complete something that fits, even with no information. Out comes a detail that sounds perfect and simply does not exist — hence checking.',
    },
  },
  {
    id: 'mistakes-sources', tier: 2, topic: 'mistakes', correct: 0,
    he: {
      q: 'ה־AI צירף קישור או שם של ספר. מה עושים?',
      a: [
        'פותחים ובודקים שהמקור באמת קיים ומתאים',
        'מעתיקים ישר לעבודה, כי זה נראה מסודר ומקצועי',
        'מניחים שזה תקין כי יש שם ותאריך',
      ],
      why: 'שמות מקורות הם בדיוק המקום שבו מודל ממציא בביטחון. מקור אמיתי אפשר לפתוח — וזו בדיקה של חמש שניות.',
    },
    en: {
      q: 'The AI gave a link or a book title. What now?',
      a: [
        'Open it and check the source really exists and fits',
        'Copy it straight into the work, since it looks tidy and professional',
        'Assume it is fine because it has a name and a date',
      ],
      why: 'Source names are exactly where a model invents confidently. A real source can be opened — that is a five-second check.',
    },
  },
  {
    id: 'mistakes-math', tier: 3, topic: 'mistakes', correct: 2,
    he: {
      q: 'בחשבון או בתאריכים, למה שווה לבדוק שוב אחרי ה־AI?',
      a: [
        'כי מספרים עולים יותר טוקנים',
        'כי מודל שפה מחשב לאט, ותאריכים מבלבלים אותו במיוחד',
        'כי הוא מנחש טקסט, ודיוק במספרים הוא לא החוזק שלו',
      ],
      why: 'מודל שפה מנחש מה מתאים לבוא אחר כך — וזה לא אותו דבר כמו לחשב. בחישוב ארוך שווה תמיד לוודא, או לבקש ממנו לפרט את השלבים.',
    },
    en: {
      q: 'With arithmetic or dates, why double-check the AI?',
      a: [
        'Because numbers cost more tokens',
        'Because a language model calculates slowly, and dates confuse it badly',
        'Because it guesses text, and exact numbers are not its strength',
      ],
      why: 'A language model guesses what comes next — which is not the same as calculating. On a long computation, verify, or ask it to show the steps.',
    },
  },

  // ──────────────────────────────────────────────────── vibe coding
  {
    id: 'vibe-what-is', tier: 2, topic: 'vibe', correct: 1,
    he: {
      q: 'מה זה "וייב־קודינג"?',
      a: [
        'להעתיק קוד מוכן מהאינטרנט בלי לשנות',
        'לתאר במילים מה התוכנה צריכה לעשות, ולתת ל־AI לכתוב את הקוד',
        'לכתוב את רוב הקוד לבד ולבקש מ־AI רק לחפש בו שגיאות קטנות',
      ],
      why: 'בוייב־קודינג מתארים את הרעיון בשפה רגילה, וה־AI כותב את הקוד. התיאור הוא העבודה האמיתית — בדיוק כמו פרומפט טוב.',
    },
    en: {
      q: 'What is "vibe coding"?',
      a: [
        'Copying ready-made code off the internet unchanged',
        'Describing what the software should do, and letting AI write the code',
        'Writing most of the code yourself and asking AI only to hunt for small bugs',
      ],
      why: 'In vibe coding you describe the idea in ordinary language and the AI writes the code. The description is the real work — exactly like a good prompt.',
    },
  },
  {
    id: 'vibe-start-project', tier: 1, topic: 'vibe', correct: 2,
    he: {
      q: 'בונים משחק עם AI. איך הכי כדאי להתחיל?',
      a: [
        'לבקש "לבנות משחק מגניב" ולחכות',
        'לבקש את כל הקוד של המשחק בהודעה ענקית אחת',
        'לתאר מה קורה במשחק, ואז לבקש שלב אחר שלב',
      ],
      why: 'קודם מסבירים מה המשחק עושה — מי זז, מה קורה כשמנצחים. אחר כך בונים חלק־חלק ובודקים כל חלק. ככה יוצא משחק ולא ערימת קוד.',
    },
    en: {
      q: 'Building a game with AI. What is the best way to start?',
      a: [
        'Ask for "a cool game" and wait',
        'Ask for all of the code for the whole game in one giant message',
        'Describe what happens in the game, then build step by step',
      ],
      why: 'First explain what the game does — who moves, what happens when you win. Then build piece by piece and test each one. That gets a game, not a pile of code.',
    },
  },
  {
    id: 'vibe-error', tier: 3, topic: 'vibe', correct: 0,
    he: {
      q: 'הקוד שה־AI כתב לא עובד. מה הכי יעזור?',
      a: [
        'להעתיק את הודעת השגיאה ולהסביר מה קרה בפועל',
        'לכתוב "לא עובד, לתקן"',
        'למחוק הכול ולבקש מה־AI לכתוב את זה מחדש מאפס',
      ],
      why: 'הודעת השגיאה היא הרמז הכי שווה שיש, והיא עולה טוקנים בודדים. "לא עובד" מבקש מהמודל לנחש איפה הבעיה.',
    },
    en: {
      q: 'The code the AI wrote does not work. What helps most?',
      a: [
        'Paste the error message and describe what actually happened',
        'Write "broken, fix it"',
        'Delete everything and ask the AI to write it again from scratch',
      ],
      why: 'The error message is the most valuable clue there is, and it costs a handful of tokens. "Broken" asks the model to guess where the problem is.',
    },
  },
  {
    id: 'vibe-test-each', tier: 3, topic: 'vibe', correct: 1,
    he: {
      q: 'למה מריצים ובודקים כל שינוי שה־AI עשה?',
      a: [
        'כי ה־AI לא באמת זוכר מה הוא כתב לפני רגע',
        'כי רק הרצה אמיתית מראה אם זה באמת עובד',
        'כי בדיקה תכופה חוסכת טוקנים',
      ],
      why: 'קוד יכול להיראות מושלם ולהתפוצץ בהרצה הראשונה. בדיקה אחרי כל שינוי קטן מאתרת את התקלה כשעוד ברור מה גרם לה.',
    },
    en: {
      q: 'Why run and test every change the AI made?',
      a: [
        'Because the AI does not really remember what it just wrote',
        'Because only actually running it shows whether it works',
        'Because frequent testing saves tokens',
      ],
      why: 'Code can look perfect and blow up on the first run. Testing after each small change catches the break while it is still obvious what caused it.',
    },
  },
  {
    id: 'vibe-good-spec', tier: 3, topic: 'vibe', correct: 2,
    he: {
      q: 'מה מסמן תיאור טוב של פיצ׳ר ל־AI?',
      a: [
        'הוא ארוך מאוד ומכסה הכול',
        'הוא מלא במילים טכניות מרשימות שנשמעות מקצועיות מאוד',
        'כתוב בו מה קורה, מתי זה קורה, ומה רואים על המסך',
      ],
      why: 'תיאור טוב הוא כזה שאפשר לבדוק אחריו. "כשלוחצים רווח הכדור קופץ ונשמע צליל" — אפשר להריץ ולראות אם זה קרה.',
    },
    en: {
      q: 'What marks a good feature description for an AI?',
      a: [
        'It is very long and covers everything',
        'It is packed with impressive technical words that sound professional',
        'It says what happens, when it happens, and what appears on screen',
      ],
      why: 'A good description is one you can check afterwards. "Press space, the ball jumps and a sound plays" — you can run it and see whether that happened.',
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // WAVE-3 EXPANSION — the bank grew 34 → 100 so a full championship (three
  // races) never shows the same question twice. Same tiers, same six topics,
  // same voice; new ground covered inside the existing topics: fairness and
  // safety and everyday AI live under `whatai` and `mistakes` rather than in
  // new topic keys, because quiz.js owns the topic labels and TOPICS is frozen.
  // ═══════════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────── tier 1 · what AI is (race one)
  {
    id: 'ai-everyday', tier: 1, topic: 'whatai', correct: 1,
    he: {
      q: 'איפה פוגשים AI ביום רגיל?',
      a: [
        'רק במעבדות של מדענים ובאוניברסיטאות גדולות',
        'בתרגום, בהמלצות סרטים ובסינון דואר זבל',
        'רק במשחקי מחשב חדשים',
      ],
      why: 'AI כבר יושב בהמון מקומות שגרתיים: תרגום, ניווט, המלצות וסינון ספאם. רוב הפעמים בכלל לא שמים לב שהוא שם.',
    },
    en: {
      q: 'Where do you meet AI on an ordinary day?',
      a: [
        'Only in the laboratories of scientists and big universities',
        'In translation, film recommendations and spam filtering',
        'Only in brand new video games',
      ],
      why: 'AI already sits in plenty of everyday places: translation, navigation, recommendations, spam filters. Most of the time nobody notices it is there.',
    },
  },
  {
    id: 'ai-not-magic', tier: 1, topic: 'whatai', correct: 0,
    he: {
      q: 'איך הכי נכון לתאר AI במשפט אחד?',
      a: [
        'תוכנה שמזהה דפוסים בהמון מידע ומנחשת לפיהם',
        'מוח אלקטרוני קטן שחושב בדיוק כמו בן אדם חכם',
        'קסם מודרני שאי אפשר להסביר אותו במילים פשוטות',
      ],
      why: 'יודעים בדיוק איך בנו אותו ואיך אימנו אותו, גם כשלא ברור למה יצאה דווקא התשובה הזאת. זו הנדסה — ואפשר ללמוד אותה.',
    },
    en: {
      q: 'What is the best one-sentence description of AI?',
      a: [
        'Software that spots patterns in lots of data and guesses from them',
        'A small electronic brain that thinks exactly like a clever person does',
        'Modern magic that cannot really be explained in plain words',
      ],
      why: 'We know exactly how it was built and trained, even when it is unclear why this particular answer came out. It is engineering — and engineering can be learned.',
    },
  },
  {
    id: 'ai-needs-examples', tier: 2, topic: 'whatai', correct: 0,
    he: {
      q: 'למה AI צריך המון דוגמאות כדי ללמוד?',
      a: [
        'כי דפוס מתגלה רק כשרואים אותו שוב ושוב',
        'כי ככה מתמלא הזיכרון שלו',
        'כי דוגמאות חדשות מחליפות אצלו את הישנות',
      ],
      why: 'מדוגמה אחת אי אפשר לדעת מה כלל ומה יוצא דופן. רק אחרי המון דוגמאות מתברר מה חוזר תמיד — וזה מה שנלמד.',
    },
    en: {
      q: 'Why does AI need so many examples to learn?',
      a: [
        'Because a pattern only shows up when you see it again and again',
        'Because that is how its memory gets filled',
        'Because newer examples simply replace the older ones it saw',
      ],
      why: 'One example cannot tell you what is a rule and what is an exception. Only after a great many does what always repeats become clear — and that is what gets learned.',
    },
  },
  {
    id: 'ai-knows-me', tier: 2, topic: 'whatai', correct: 0,
    he: {
      q: 'האם ה־AI יודע מי כותב לו?',
      a: [
        'כן, הוא מנחש גיל וסגנון מהכתיבה, אבל לא יודע מי זה',
        'לא, הוא רואה מילים בלבד ולא מסיק מהן שום דבר נוסף',
        'כן, השם והכיתה נשלחים אליו אוטומטית עם כל הודעה',
      ],
      why: 'מהניסוח אפשר לנחש די הרבה, ומודל באמת מנחש. את מה שחשוב שיידע — גיל, כיתה, מטרה — עדיף פשוט לכתוב לו.',
    },
    en: {
      q: 'Does the AI know who is writing to it?',
      a: [
        'Yes, it guesses age and style from the writing, but not who you are',
        'No, it sees only words and draws nothing at all from them',
        'Yes, your name and class are sent to it automatically each time',
      ],
      why: 'Phrasing gives a lot away, and a model does guess from it. Whatever it genuinely needs — age, class, purpose — is better just written down.',
    },
  },
  {
    id: 'ai-image-models', tier: 1, topic: 'whatai', correct: 2,
    he: {
      q: 'יש גם AI שמצייר. מה הוא עושה בעצם?',
      a: [
        'מחפש תמונה מוכנה באינטרנט ומדביק אותה',
        'מצלם את מה שמתארים לו',
        'בונה תמונה חדשה לפי התיאור שנכתב',
      ],
      why: 'מודל תמונה למד את הקשר בין מילים לתמונות ומייצר ציור חדש בכל פעם. גם כאן תיאור מפורט מקרב לתוצאה שרוצים.',
    },
    en: {
      q: 'There is AI that draws too. What does it actually do?',
      a: [
        'Finds a ready-made picture online and pastes it in',
        'Photographs whatever is described to it',
        'Builds a new image from the description written',
      ],
      why: 'An image model learned how words relate to pictures and makes a fresh image every time. Here too, a detailed description gets you closer to what you wanted.',
    },
  },

  // ─────────────────────────────────────────────── tier 1 · prompts (race one)
  {
    id: 'prompt-say-goal', tier: 1, topic: 'prompt', correct: 0,
    he: {
      q: 'למה כדאי לכתוב בשביל מה צריך את התשובה?',
      a: [
        'כי מטרה ברורה משנה את מה שייכנס לתשובה',
        'כי זה מקצר את זמן ההמתנה',
        'כי בלי מטרה ברורה המודל מבקש הבהרה במקום לענות',
      ],
      why: 'הסבר לשיעורי בית והסבר להצגה בכיתה נראים אחרת לגמרי. כשכותבים למה צריך את זה, המודל מכוון לשימוש הנכון.',
    },
    en: {
      q: 'Why say what the answer is needed for?',
      a: [
        'Because a clear purpose changes what goes into the answer',
        'Because it shortens the waiting time',
        'Because with no purpose the model asks for clarification instead',
      ],
      why: 'An explanation for homework and one for a class presentation look completely different. Saying why you need it aims the model at the right use.',
    },
  },
  {
    id: 'prompt-vague-word', tier: 1, topic: 'prompt', correct: 1,
    he: {
      q: 'מה הבעיה בבקשה "לכתוב משהו יפה"?',
      a: [
        'היא ארוכה מדי',
        '"יפה" אומר דבר אחר לכל אחד',
        'המילה "משהו" מבלבלת את המודל יותר מכל מילה אחרת',
      ],
      why: 'מילות שבח לא מתארות כלום. במקום "יפה" עדיף לכתוב מה בדיוק רוצים: שיר קצר, מחורז, על הים בלילה.',
    },
    en: {
      q: 'What is wrong with "write something nice"?',
      a: [
        'It is too long',
        '"Nice" means something different to everyone',
        'The word "something" confuses the model more than any other',
      ],
      why: 'Praise words describe nothing. Instead of "nice", say exactly what you want: a short rhyming poem about the sea at night.',
    },
  },
  {
    id: 'prompt-format-ask', tier: 1, topic: 'prompt', correct: 2,
    he: {
      q: 'רוצים לקבל את התשובה בטבלה. מה עושים?',
      a: [
        'מקווים שהמודל יבחר בטבלה, כי זה הפורמט הכי ברור',
        'כותבים "מסודר בבקשה"',
        'מבקשים טבלה במפורש, ואילו עמודות שיהיו בה',
      ],
      why: 'המודל לא מנחש פורמט. בקשה לטבלה עם רשימת העמודות מחזירה בדיוק את זה, בלי סבב תיקונים.',
    },
    en: {
      q: 'You want the answer as a table. What do you do?',
      a: [
        'Hope the model picks a table, since that is the clearest format',
        'Write "make it tidy please"',
        'Ask for a table outright, and which columns it should have',
      ],
      why: 'The model does not guess format. Asking for a table and listing the columns returns exactly that, with no round of fixes.',
    },
  },
  {
    id: 'prompt-language-ask', tier: 1, topic: 'prompt', correct: 0,
    he: {
      q: 'רוצים תשובה בעברית גם בשאלה טכנית. מה הכי בטוח?',
      a: [
        'לכתוב בפרומפט שהתשובה תהיה בעברית',
        'לכתוב את הבקשה בעברית ולהניח שגם התשובה תהיה כזאת',
        'לבקש תשובה קצרה, כי תשובות קצרות יוצאות בעברית',
      ],
      why: 'לרוב פרומפט בעברית מחזיר עברית, אבל לא תמיד — בייחוד בנושאים טכניים. שורה אחת מפורשת סוגרת את העניין.',
    },
    en: {
      q: 'You want a Hebrew answer even on a technical question. What is safest?',
      a: [
        'Write in the prompt that the answer should be in Hebrew',
        'Write the request in Hebrew and assume the answer follows',
        'Ask for a short answer, since short answers come back in Hebrew',
      ],
      why: 'A Hebrew prompt usually returns Hebrew — but not always, especially on technical topics. One explicit line settles it.',
    },
  },
  {
    id: 'prompt-one-thing', tier: 1, topic: 'prompt', correct: 1,
    he: {
      q: 'יש שלוש שאלות שונות. מה עדיף לעשות?',
      a: [
        'לדחוס את שלושתן למשפט אחד',
        'לשאול אותן בנפרד, אחת אחרי השנייה',
        'לשאול רק את הקלה מביניהן ולוותר על השאר',
      ],
      why: 'בהודעה עמוסה יש סיכוי טוב שחלק מהשאלות ייבלעו. שאלה בכל פעם מקבלת תשובה מלאה, ואפשר להמשיך משם.',
    },
    en: {
      q: 'You have three different questions. What is better?',
      a: [
        'Cram all three into one sentence',
        'Ask them separately, one after another',
        'Ask only the easy one and give up on the rest',
      ],
      why: 'In a crowded message some questions get swallowed. One question at a time gets a full answer, and you can build from there.',
    },
  },
  {
    id: 'prompt-context-what', tier: 2, topic: 'prompt', correct: 2,
    he: {
      q: 'מה זה "הקשר" בפרומפט?',
      a: [
        'המילים המנומסות בהתחלה',
        'האורך והפורמט שמבקשים שיהיו לתשובה',
        'המידע הנוסף שעוזר להבין את הבקשה',
      ],
      why: 'הקשר הוא כל מה שהמודל לא יכול לדעת לבד: לאיזו כיתה, לאיזו מטרה, מה כבר ניסו. הוא שהופך תשובה כללית למתאימה.',
    },
    en: {
      q: 'What is "context" in a prompt?',
      a: [
        'The polite words at the start',
        'The length and the format you are asking the answer to come in',
        'The extra information that helps make sense of the request',
      ],
      why: 'Context is everything the model cannot know by itself: which class, what for, what was already tried. It turns a generic answer into a fitting one.',
    },
  },

  // ──────────────────────────────────────────────── tier 1 · tokens (race one)
  {
    id: 'tokens-not-words', tier: 1, topic: 'tokens', correct: 1,
    he: {
      q: 'האם טוקן זה תמיד מילה שלמה?',
      a: [
        'כן, כל מילה במשפט היא בדיוק טוקן אחד',
        'לא — לפעמים חצי מילה או סימן פיסוק',
        'כן, אבל רק באנגלית',
      ],
      why: 'מילים ארוכות מתפרקות לכמה חתיכות, ופסיק הוא חתיכה בפני עצמו. לכן ספירת טוקנים כמעט אף פעם לא שווה לספירת מילים.',
    },
    en: {
      q: 'Is a token always a whole word?',
      a: [
        'Yes, every word in a sentence is exactly one token',
        'No — sometimes half a word or a punctuation mark',
        'Yes, but only in English',
      ],
      why: 'Long words split into several chunks, and a comma is a chunk of its own. That is why a token count almost never equals a word count.',
    },
  },
  {
    id: 'tokens-why-count', tier: 1, topic: 'tokens', correct: 2,
    he: {
      q: 'למה בכלל סופרים טוקנים?',
      a: [
        'כדי לדעת כמה שאלות נשאלו',
        'כדי לתת ציון לאיכות התשובה שהתקבלה',
        'כי הם מודדים כמה עבודה המודל עשה',
      ],
      why: 'טוקנים הם יחידת המידה של הטקסט: כמה נקרא וכמה נכתב. לפי זה נמדדים הזמן, העלות והמקום שנשאר בשיחה.',
    },
    en: {
      q: 'Why count tokens at all?',
      a: [
        'To know how many questions were asked',
        'To grade the quality of the answer that came back',
        'Because they measure how much work the model did',
      ],
      why: 'Tokens are the unit of text: how much was read and how much was written. Time, cost and remaining room in the chat are all measured by them.',
    },
  },
  {
    id: 'tokens-filler-words', tier: 1, topic: 'tokens', correct: 0,
    he: {
      q: 'מה קורה כשמוסיפים מילים שלא מוסיפות מידע?',
      a: [
        'משלמים עליהן בטוקנים בלי לקבל תמורה',
        'המודל מוחק אותן לבד, אז אין לזה שום השפעה',
        'התשובה נעשית מדויקת יותר',
      ],
      why: 'כל מילה נספרת, גם "בבקשה בבקשה מאוד". עדיף להשקיע את אותם טוקנים בפרט שבאמת מכוון את התשובה.',
    },
    en: {
      q: 'What happens when you add words that add no information?',
      a: [
        'You pay for them in tokens and get nothing back',
        'The model deletes them by itself, so nothing changes',
        'The answer becomes more accurate',
      ],
      why: 'Every word counts, including "please oh please". Better to spend those same tokens on a detail that actually steers the answer.',
    },
  },

  // ──────────────────────────────────────────── tier 1 · trying again (race one)
  {
    id: 'iterate-say-what-wrong', tier: 1, topic: 'iterate', correct: 2,
    he: {
      q: 'התשובה ארוכה מדי. מה כותבים עכשיו?',
      a: [
        '"לא אהבתי"',
        '"לנסות שוב, אולי הפעם זה ייצא טוב יותר"',
        '"לקצר לשלוש שורות ולהשאיר רק את העיקר"',
      ],
      why: 'ביקורת מדויקת היא כבר הוראת תיקון. כשאומרים בדיוק מה להחליף, הסיבוב הבא כמעט תמיד קולע.',
    },
    en: {
      q: 'The answer is too long. What do you write now?',
      a: [
        '"I did not like it"',
        '"Try again — maybe this time it comes out better"',
        '"Cut it to three lines and keep only the main point"',
      ],
      why: 'Precise criticism is already a repair instruction. Say exactly what to swap and the next round almost always lands.',
    },
  },
  {
    id: 'iterate-ask-options', tier: 1, topic: 'iterate', correct: 0,
    he: {
      q: 'לא בטוחים איזה כיוון מתאים. מה שווה לבקש?',
      a: [
        'שלוש אפשרויות שונות זו מזו, ואז בוחרים אחת',
        'תשובה אחת מפורטת מאוד שמכסה את כל הכיוונים ביחד',
        'שהמודל יבחר את הכיוון הכי פופולרי בין כל המשתמשים',
      ],
      why: 'קל בהרבה לבחור מתוך שלוש אפשרויות מאשר לתאר מראש מה רוצים. אחרי הבחירה מעמיקים רק בכיוון אחד.',
    },
    en: {
      q: 'Not sure which direction fits. What is worth asking for?',
      a: [
        'Three options that differ from each other, then pick one',
        'One very detailed answer covering all the directions at once',
        'For the model to pick whichever direction most users prefer',
      ],
      why: 'Choosing between three options is far easier than describing what you want up front. After choosing, go deep on one direction only.',
    },
  },

  // ──────────────────────────────────── tier 1 · checking the AI (race one)
  {
    id: 'mistakes-old-info', tier: 2, topic: 'mistakes', correct: 1,
    he: {
      q: 'שאלו AI על משהו שקרה השבוע. למה כדאי לבדוק?',
      a: [
        'כי הוא שוכח מידע ישן אחרי כמה חודשים בלי שימוש',
        'כי הידע שלו נעצר בתאריך, אלא אם חיפש ממש עכשיו',
        'כי חדשות מגיעות אליו תמיד באיחור של יום בדיוק',
      ],
      why: 'האימון נעצר בנקודת זמן כלשהי. חלק מהכלים יודעים גם לחפש ברשת תוך כדי — ואז מבקשים לראות את הקישור עצמו.',
    },
    en: {
      q: 'You asked an AI about something from this week. Why check it?',
      a: [
        'Because it forgets older information after a few unused months',
        'Because its knowledge stops at a date, unless it just searched',
        'Because news always reaches it exactly one day late',
      ],
      why: 'Training stopped at some point in time. Some tools can also search the web as they go — in which case, ask to see the link itself.',
    },
  },
  {
    id: 'mistakes-homework', tier: 1, topic: 'mistakes', correct: 2,
    he: {
      q: 'מה נכון לעשות עם תשובה של AI בשיעורי בית?',
      a: [
        'להעתיק אותה ולשנות קצת מילים כדי שתישמע אחרת',
        'להשתמש בה כמו שהיא ולציין בסוף שהיא נכתבה ב־AI',
        'לקרוא, להבין, לבדוק ולכתוב את זה בסגנון שלנו',
      ],
      why: 'החלפת מילים לא הופכת את התשובה לשלנו, וגם לא מלמדת כלום. מה שלא מבינים מתגלה בדיוק בשיעור הבא.',
    },
    en: {
      q: 'What is the right thing to do with an AI answer in homework?',
      a: [
        'Copy it and swap a few words so it sounds different',
        'Use it as is and note at the end that AI wrote it',
        'Read it, understand it, check it and write it in your own voice',
      ],
      why: 'Swapping words does not make the answer yours, and teaches nothing. Whatever you did not understand surfaces in the very next lesson.',
    },
  },
  {
    id: 'mistakes-private-info', tier: 1, topic: 'mistakes', correct: 0,
    he: {
      q: 'איזה מידע לא כדאי לכתוב לצ׳אט של AI?',
      a: [
        'כתובת, מספר טלפון וסיסמאות',
        'שם של חיית מחמד בתוך סיפור',
        'שאלות על שיעורי בית',
      ],
      why: 'פרטים אישיים לא צריכים להיכנס לשיחה בכלל. אפשר לתאר את הבעיה בלי הפרטים המזהים ולקבל בדיוק אותה עזרה.',
    },
    en: {
      q: 'What information should not go into an AI chat?',
      a: [
        'An address, a phone number and passwords',
        'A pet\'s name inside a story',
        'Questions about homework',
      ],
      why: 'Personal details do not belong in the conversation at all. Describe the problem without the identifying bits and get exactly the same help.',
    },
  },

  // ───────────────────────────────────────── tier 1 · vibe coding (race one)

  // ─────────────────────────────────────────── tier 2 · what AI is (race two)
  {
    id: 'ai-training-vs-use', tier: 2, topic: 'whatai', correct: 2,
    he: {
      q: 'מה ההבדל בין אימון המודל לבין שימוש בו?',
      a: [
        'אין שום הבדל אמיתי, מדובר בדיוק באותו תהליך',
        'באימון הוא עונה, ובשימוש הוא לומד',
        'באימון הוא לומד מראש, ובשימוש הוא רק עונה',
      ],
      why: 'האימון קרה פעם אחת, הרבה לפני שהמודל הגיע אלינו. שיחה איתו לא מלמדת אותו — היא רק משתמשת במה שכבר נלמד.',
    },
    en: {
      q: 'What is the difference between training a model and using it?',
      a: [
        'No real difference — training and using are the same process',
        'In training it answers, in use it learns',
        'In training it learns ahead of time, in use it only answers',
      ],
      why: 'Training happened once, long before the model reached you. Chatting does not teach it — it only uses what was already learned.',
    },
  },
  {
    id: 'ai-bias', tier: 2, topic: 'whatai', correct: 1,
    he: {
      q: 'למה חשוב איזה מידע נכנס לאימון של AI?',
      a: [
        'כי יותר מדי מידע מאט את המודל',
        'כי אם המידע מוטה, גם התשובות ייצאו מוטות',
        'כי מידע ישן מתערבב אצלו עם מידע חדש יותר',
      ],
      why: 'מודל לומד ממה שהראו לו. אם בכל הסיפורים שקרא רק בנים משחקים כדורגל, זה מה שייצא לו — וזאת לא האמת על העולם.',
    },
    en: {
      q: 'Why does it matter which data goes into training an AI?',
      a: [
        'Because too much data slows the model down',
        'Because if the data is skewed, the answers come out skewed too',
        'Because older data gets muddled together with the newer data',
      ],
      why: 'A model learns from what it was shown. If every story it read had only boys playing football, that is what comes out — and that is not the truth about the world.',
    },
  },
  {
    id: 'ai-not-search', tier: 2, topic: 'whatai', correct: 0,
    he: {
      q: 'במה מודל שפה שונה ממנוע חיפוש?',
      a: [
        'הוא מנסח תשובה בעצמו במקום להראות רשימת דפים',
        'הוא מחזיק בתוכו עותק מלא ומעודכן של כל האינטרנט',
        'הוא בודק כל עובדה בשלושה אתרים לפני שהוא עונה',
      ],
      why: 'חיפוש מחזיר מקורות שאפשר לפתוח; מודל מנסח תשובה. גם כשהוא כן מחפש ברשת, את הניסוח הוא עדיין כותב בעצמו.',
    },
    en: {
      q: 'How is a language model different from a search engine?',
      a: [
        'It writes the answer itself instead of showing a list of pages',
        'It holds a full, up-to-date copy of the whole internet inside it',
        'It checks every fact on three websites before it answers',
      ],
      why: 'Search hands back sources you can open; a model writes an answer. Even when it does search the web, the wording is still its own.',
    },
  },
  {
    id: 'ai-memory-chat', tier: 2, topic: 'whatai', correct: 2,
    he: {
      q: 'מה המודל קורא לפני כל תשובה בשיחה?',
      a: [
        'את כל מה שנכתב לו אי פעם, בכל השיחות של כל המשתמשים',
        'רק את ההודעה האחרונה שנשלחה אליו ברגע זה',
        'את השיחה הנוכחית, ועוד דברים שנשמרו לו במיוחד',
      ],
      why: 'הזיכרון של המודל הוא הטקסט שמגישים לו בכל פעם: השיחה עד כה, ולפעמים סיכומים שנשמרו בשבילו. מה שלא שם, לא קיים בשבילו.',
    },
    en: {
      q: 'What does the model read before every answer in a chat?',
      a: [
        'Everything ever written to it, in the chats of every single user',
        'Only the single message that was just sent to it',
        'The current conversation, plus anything specially saved for it',
      ],
      why: 'The model\'s memory is the text handed to it each time: the chat so far, and sometimes summaries saved for it. What is not in there does not exist for it.',
    },
  },

  // ─────────────────────────────────────────────── tier 2 · prompts (race two)
  {
    id: 'prompt-constraints', tier: 2, topic: 'prompt', correct: 1,
    he: {
      q: 'מה עושה הגבלה בפרומפט, כמו "בלי מילים באנגלית"?',
      a: [
        'מבלבלת את המודל',
        'מצמצמת את התשובות האפשריות לכיוון שרוצים',
        'מאריכה את זמן התשובה ומקשה על המודל לענות',
      ],
      why: 'הגבלה עובדת כמו גדר במגרש: היא לא אומרת לאן לרוץ, אבל היא מוציאה מהמשחק את כל מה שלא מתאים.',
    },
    en: {
      q: 'What does a limit like "no slang" do in a prompt?',
      a: [
        'Confuses the model',
        'Narrows the possible answers toward the one you want',
        'Makes the answer take longer and the model work harder',
      ],
      why: 'A limit works like a fence on a pitch: it does not say where to run, but it takes everything that does not fit out of the game.',
    },
  },
  {
    id: 'prompt-tone', tier: 2, topic: 'prompt', correct: 0,
    he: {
      q: 'איך מבקשים תשובה בסגנון מסוים?',
      a: [
        'כותבים את הסגנון: מצחיק, רשמי או מסתורי',
        'מוסיפים המון אימוג׳ים שמתאימים לסגנון',
        'בוחרים מודל אחר, כי לכל מודל יש סגנון קבוע',
      ],
      why: 'סגנון הוא בקשה כמו כל בקשה אחרת. "בטון מצחיק, כמו הסבר לחבר" משנה את כל בחירת המילים בתשובה.',
    },
    en: {
      q: 'How do you ask for an answer in a particular style?',
      a: [
        'Name the style: funny, formal or mysterious',
        'Add lots of emoji that match the style',
        'Switch models, since each model has one fixed style',
      ],
      why: 'Style is a request like any other. "In a funny tone, like explaining to a friend" changes every word choice in the answer.',
    },
  },
  {
    id: 'prompt-checklist', tier: 2, topic: 'prompt', correct: 2,
    he: {
      q: 'מה בודקים בפרומפט לפני ששולחים אותו?',
      a: [
        'שיש בו לפחות חמישה משפטים',
        'שאין בו אף שגיאת כתיב',
        'שכתוב בו מה רוצים, למי, ובאיזה פורמט',
      ],
      why: 'כמעט כל תשובה שמחטיאה מפספסת דווקא באחד השלושה. מי שסורק אותם לפני השליחה תופס את זה בחמש שניות.',
    },
    en: {
      q: 'What do you check in a prompt before sending it?',
      a: [
        'That it has at least five sentences',
        'That it has no spelling mistakes at all',
        'That it says what you want, for whom, and in what format',
      ],
      why: 'Nearly every answer that misses went wrong on one of those three. Scanning them before you send catches it in five seconds.',
    },
  },
  {
    id: 'prompt-negative', tier: 2, topic: 'prompt', correct: 1,
    he: {
      q: 'מה עדיף על הבקשה "לא לכתוב סוף עצוב"?',
      a: [
        'לחזור על הבקשה שלוש פעמים',
        'להוסיף גם מה כן רוצים: סוף שמח ומפתיע',
        'לחזור על הבקשה גם בסוף ההודעה, להדגשה',
      ],
      why: 'בקשה שלילית מתארת רק מה לפסול ומשאירה אינסוף אפשרויות. הכיוון החיובי אומר למודל לאן ללכת.',
    },
    en: {
      q: 'What beats the request "do not write a sad ending"?',
      a: [
        'Repeating the request three times',
        'Adding what you do want: a happy, surprising ending',
        'Repeating the request at the end of the message too',
      ],
      why: 'A negative request only says what to rule out and leaves endless options. The positive direction tells the model where to go.',
    },
  },
  {
    id: 'prompt-steps-ask', tier: 2, topic: 'prompt', correct: 0,
    he: {
      q: 'למה לבקש מה־AI להראות את השלבים?',
      a: [
        'כי אז אפשר לראות איפה בדיוק הוא טעה',
        'כי זה מקצר את התשובה',
        'כי זה גורם לו להיות בטוח יותר',
      ],
      why: 'תשובה בשלבים אפשר לבדוק שלב אחרי שלב במקום להאמין לשורה האחרונה. בדרך גם מבינים את הנושא בעצמנו.',
    },
    en: {
      q: 'Why ask the AI to show its steps?',
      a: [
        'Because then you can see exactly where it went wrong',
        'Because it shortens the answer',
        'Because it makes the model more certain',
      ],
      why: 'A step-by-step answer can be checked step by step, instead of trusting the last line. Along the way you understand the topic yourself.',
    },
  },

  // ──────────────────────────────────────────────── tier 2 · tokens (race two)
  {
    id: 'tokens-context-budget', tier: 2, topic: 'tokens', correct: 0,
    he: {
      q: 'איך אפשר לחשוב על חלון ההקשר?',
      a: [
        'כמו תיק עם מקום מוגבל שאורזים בחוכמה',
        'כמו מדף שנשמר בין שיחה לשיחה ומצטבר עם הזמן',
        'כמו מהירות: ככל שיש בו יותר, התשובה חוזרת מהר יותר',
      ],
      why: 'מה שנכנס לתיק הוא בדיוק מה שהמודל רואה, וכשהוא מלא משהו נופל החוצה. לכן אורזים את מה שמשנה, לא את הכול.',
    },
    en: {
      q: 'What is a good way to picture the context window?',
      a: [
        'Like a bag with limited room that you pack wisely',
        'Like a shelf that carries over between chats and builds up',
        'Like speed: the more of it there is, the faster the answer',
      ],
      why: 'What goes in the bag is exactly what the model sees, and when it is full something falls out. So pack what matters, not everything.',
    },
  },

  // ─────────────────────────────────────── tier 2 · trying again (race two)
  {
    id: 'iterate-compare-two', tier: 2, topic: 'iterate', correct: 2,
    he: {
      q: 'איך יודעים איזה משני פרומפטים טוב יותר?',
      a: [
        'לפי זה שנשמע מנומס יותר',
        'לפי זה שארוך יותר',
        'מריצים את שניהם ומשווים את התשובות',
      ],
      why: 'בפרומפטים קשה מאוד לנחש מראש. ניסוי קטן — אותו נושא, שתי גרסאות — נותן תשובה ודאית תוך דקה.',
    },
    en: {
      q: 'How do you know which of two prompts is better?',
      a: [
        'The one that sounds more polite',
        'The one that is longer',
        'Run both and compare the answers',
      ],
      why: 'With prompts, guessing ahead is hard. A tiny experiment — same topic, two versions — settles it in a minute.',
    },
  },
  {
    id: 'iterate-save-good', tier: 1, topic: 'iterate', correct: 0,
    he: {
      q: 'פרומפט יצא מצוין. מה כדאי לעשות איתו?',
      a: [
        'לשמור אותו, כי פרומפט טוב תמיד שווה שימוש חוזר',
        'לשלוח אותו שוב מיד, כדי לקבל תשובה שנייה להשוואה',
        'לזכור בערך מה היה בו ולנסח אותו מחדש בפעם הבאה',
      ],
      why: 'ניסוח מחדש מהזיכרון מאבד בדיוק את הפרטים שעשו את ההבדל. פרומפט שמור הוא כלי שאפשר לשלוף בעוד חודש.',
    },
    en: {
      q: 'A prompt came out great. What should you do with it?',
      a: [
        'Save it — a good prompt is always worth reusing',
        'Send it again right away, for a second answer to compare',
        'Roughly remember it and rewrite it from scratch next time',
      ],
      why: 'Rewriting from memory loses exactly the details that made the difference. A saved prompt is a tool you can pull out a month later.',
    },
  },
  {
    id: 'iterate-ask-questions', tier: 2, topic: 'iterate', correct: 1,
    he: {
      q: 'מה עוזר כשקשה לנסח את הבקשה?',
      a: [
        'לכתוב פרומפט ארוך במיוחד',
        'לבקש מה־AI לשאול שאלות לפני שהוא עונה',
        'לשלוח את אותה בקשה כמה פעמים',
      ],
      why: 'כשהמודל שואל "לאיזה גיל? באיזה אורך?", השאלות שלו מגלות מה חסר בפרומפט. עונים עליהן ומקבלים תשובה מדויקת.',
    },
    en: {
      q: 'What helps when the request is hard to phrase?',
      a: [
        'Writing an extra long prompt',
        'Asking the AI to ask questions before it answers',
        'Sending the same request several times',
      ],
      why: 'When the model asks "for what age? how long?", its questions reveal what the prompt is missing. Answer them and the result lands.',
    },
  },

  // ──────────────────────────────── tier 2 · checking the AI (race two)
  {
    id: 'mistakes-two-answers', tier: 2, topic: 'mistakes', correct: 2,
    he: {
      q: 'קיבלו שתי תשובות סותרות באותה שאלה. מה זה אומר?',
      a: [
        'שאחת מהן בטוח נכונה',
        'שהמודל התקלקל',
        'שהנושא הזה על גבול הידע שלו',
      ],
      why: 'סתירה מסמנת בדיוק איפה המודל מנחש. שימו לב: זה לא אומר שאחת התשובות נכונה — לפעמים שתיהן לא.',
    },
    en: {
      q: 'The same question got two contradicting answers. What does that mean?',
      a: [
        'One of them is definitely right',
        'The model is broken',
        'That this topic sits at the edge of what it knows',
      ],
      why: 'A contradiction marks exactly where the model is guessing. Note that it does not mean one answer is right — sometimes neither is.',
    },
  },
  {
    id: 'mistakes-ask-reasoning', tier: 2, topic: 'mistakes', correct: 0,
    he: {
      q: 'איך בודקים על מה התשובה מתבססת?',
      a: [
        'מבקשים הסבר איך הוא הגיע לתשובה, ואז בודקים',
        'שואלים אם הוא בטוח',
        'מבקשים תשובה ארוכה יותר',
      ],
      why: 'הסבר אפשר לבחון, גם כשהוא לא מושלם. הצהרת ביטחון אי אפשר לבחון בכלל, ולכן היא לא מוסיפה מידע.',
    },
    en: {
      q: 'How do you check what an answer is based on?',
      a: [
        'Ask it to explain how it got there, then check that',
        'Ask whether it is sure',
        'Ask for a longer answer',
      ],
      why: 'An explanation can be examined, even an imperfect one. A statement of confidence cannot be examined at all, so it adds nothing.',
    },
  },
  {
    id: 'mistakes-images-fake', tier: 2, topic: 'mistakes', correct: 1,
    he: {
      q: 'ראו תמונה מדהימה ברשת. איך יודעים אם AI יצר אותה?',
      a: [
        'סופרים אצבעות ואותיות — שם AI תמיד נשבר בסוף',
        'בודקים פרטים מוזרים, ובעיקר מבררים מי פרסם ומאיפה',
        'מחפשים אותה בכלי זיהוי, והתשובה שלו סוגרת את העניין',
      ],
      why: 'סימני האצבעות והאותיות נעלמים ככל שהכלים משתפרים, וגם כלי זיהוי טועה. מקור הפרסום נשאר הרמז החזק ביותר.',
    },
    en: {
      q: 'You saw an amazing photo online. How do you tell if AI made it?',
      a: [
        'Count the fingers and letters — AI always breaks there',
        'Look for odd details, and above all trace who posted it',
        'Run it through a detector tool and take its verdict as final',
      ],
      why: 'Finger and letter glitches fade as tools improve, and detectors get it wrong too. Where a picture came from stays the strongest clue.',
    },
  },
  {
    id: 'mistakes-unfair-answer', tier: 2, topic: 'mistakes', correct: 2,
    he: {
      q: 'התשובה נשמעת לא הוגנת כלפי קבוצת אנשים. מה עושים?',
      a: [
        'מבקשים מהמודל לנסח את אותה תשובה בצורה עדינה יותר',
        'מקבלים את זה, כי המודל ראה יותר מידע מכל אדם אחד',
        'לא מקבלים את זה כעובדה, ומדברים על זה עם מבוגר',
      ],
      why: 'ניסוח עדין יותר לא הופך טענה מוטה לנכונה. מודל חוזר לפעמים על הטיות שהיו בטקסט שלמד ממנו, וזה בדיוק מקום לעצור.',
    },
    en: {
      q: 'An answer sounds unfair toward a group of people. What now?',
      a: [
        'Ask the model to word the same claim more gently',
        'Accept it, since the model has seen more text than any person',
        'Do not take it as fact, and talk it over with an adult',
      ],
      why: 'Gentler wording does not make a skewed claim true. A model sometimes repeats biases from the text it learned from, and that is a place to stop.',
    },
  },

  // ─────────────────────────────────────── tier 2 · vibe coding (race two)
  {
    id: 'vibe-small-steps', tier: 2, topic: 'vibe', correct: 0,
    he: {
      q: 'איך בונים תוכנה עם AI בלי להסתבך?',
      a: [
        'חתיכה קטנה בכל פעם, ובודקים אחרי כל אחת',
        'הכול בבת אחת, ואז מתקנים',
        'כותבים רק את הסוף ומשלימים אחורה',
      ],
      why: 'כשמשהו נשבר אחרי שינוי קטן, ברור מיד מה גרם לזה. אחרי מאה שורות בבת אחת כבר אי אפשר לדעת.',
    },
    en: {
      q: 'How do you build software with AI without getting tangled?',
      a: [
        'One small piece at a time, testing after each',
        'All of it at once, then fix it',
        'Write only the ending and fill in backwards',
      ],
      why: 'When something breaks right after a small change, the cause is obvious. After a hundred lines at once, it is anyone\'s guess.',
    },
  },
  {
    id: 'vibe-read-code', tier: 2, topic: 'vibe', correct: 1,
    he: {
      q: 'למה כדאי לקרוא את הקוד שה־AI כתב?',
      a: [
        'כדי לוודא שאין בו שגיאות כתיב',
        'כי מי שמבין את הקוד יכול לשנות אותו לבד',
        'כי קריאה חוסכת טוקנים',
      ],
      why: 'קוד שלא מבינים אי אפשר לתקן וגם לא ללמוד ממנו. תמיד אפשר לבקש הסבר שורה־שורה — זה חלק מהעבודה.',
    },
    en: {
      q: 'Why read the code the AI wrote?',
      a: [
        'To make sure there are no spelling mistakes in it',
        'Because whoever understands the code can change it themselves',
        'Because reading saves tokens',
      ],
      why: 'Code you do not understand you cannot fix, and cannot learn from. You can always ask for a line-by-line explanation — that is part of the job.',
    },
  },

  // ───────────────────────────────────────── tier 3 · what AI is (the finale)
  {
    id: 'ai-temperature', tier: 2, topic: 'whatai', correct: 1,
    he: {
      q: 'יש הגדרה שקובעת כמה התשובות מפתיעות. מה היא עושה?',
      a: [
        'קובעת כמה זמן המודל ישקיע בכל תשובה',
        'קובעת כמה אקראיות יש בבחירת המילים',
        'קובעת באיזו שפה תיכתב התשובה',
      ],
      why: 'ערך נמוך נותן תשובות זהירות ודומות זו לזו, ערך גבוה נותן תשובות יצירתיות ופחות צפויות. בוחרים לפי המשימה.',
    },
    en: {
      q: 'A setting controls how surprising answers are. What does it do?',
      a: [
        'Sets how long the model spends on each answer',
        'Sets how much randomness there is in picking words',
        'Sets which language the answer is written in',
      ],
      why: 'A low value gives cautious, similar answers; a high value gives creative, less predictable ones. You pick according to the task.',
    },
  },
  {
    id: 'ai-step-by-step-gen', tier: 3, topic: 'whatai', correct: 2,
    he: {
      q: 'למה AI לפעמים פותח משפט מצוין ומסיים בשטות?',
      a: [
        'כי הוא מתעייף באמצע משפטים ארוכים מדי',
        'כי מישהו מחליף אותו באמצע התשובה במודל אחר',
        'כי הוא בוחר מילה בכל פעם, ולא תמיד מתכנן עד הסוף',
      ],
      why: 'המודל בוחר את ההמשך המתאים בכל צעד, בלי לדעת לאן המשפט הולך. לכן שווה לבקש קודם ראשי פרקים ורק אחר כך את הטקסט המלא.',
    },
    en: {
      q: 'Why does AI sometimes open a great sentence and end in nonsense?',
      a: [
        'Because it gets tired in the middle of long sentences',
        'Because a different model quietly takes over mid-answer',
        'Because it picks one word at a time and does not always plan ahead',
      ],
      why: 'The model picks a fitting continuation each step without knowing where the sentence is going. So ask for an outline first, then the full text.',
    },
  },
  {
    id: 'ai-multimodal', tier: 2, topic: 'whatai', correct: 0,
    he: {
      q: 'מה זה מודל שמקבל גם תמונות וגם טקסט?',
      a: [
        'מודל רב־מודאלי, שעובד עם כמה סוגי מידע',
        'מודל שמריץ שתי תוכנות במקביל',
        'מודל שמתרגם תמונות למילים בלבד',
      ],
      why: 'הוא רואה את התמונה, אבל לא יודע מה מעניין בה. ״מה כתוב בשלט?״ יביא תשובה טובה בהרבה מ״מה יש בתמונה?״.',
    },
    en: {
      q: 'What is a model that takes both images and text?',
      a: [
        'A multimodal model, working with several kinds of input',
        'A model running two programs at once',
        'A model that only turns pictures into words',
      ],
      why: 'It can see the picture, but it does not know what you find interesting in it. "What does the sign say?" beats "what is in this photo?" every time.',
    },
  },
  {
    id: 'ai-limits-honest', tier: 1, topic: 'whatai', correct: 1,
    he: {
      q: 'מה נכון לגבי הגבולות של מודלים כאלה?',
      a: [
        'אין להם גבולות, רק צריך לשאול נכון',
        'תמיד יש דברים שהם לא יודעים ולא יכולים לדעת',
        'הגבול היחיד שלהם הוא מהירות התשובה',
      ],
      why: 'הוא לא יודע מה קרה אתמול בכיתה, מה יהיה מחר במזג האוויר, ולא מה חשבנו ולא כתבנו. אלה לא באגים — זה פשוט מחוץ לתחום.',
    },
    en: {
      q: 'What is true about the limits of these models?',
      a: [
        'They have no limits — you just have to ask correctly',
        'There are always things they do not and cannot know',
        'Their only limit is how fast they answer',
      ],
      why: 'It does not know what happened in class yesterday, what tomorrow\'s weather will be, or what you thought and never typed. Not bugs — just out of range.',
    },
  },

  // ────────────────────────────────────────────── tier 3 · prompts (the finale)
  {
    id: 'prompt-few-shot', tier: 3, topic: 'prompt', correct: 2,
    he: {
      q: 'מה עושות שתיים־שלוש דוגמאות באותו פרומפט?',
      a: [
        'מבזבזות טוקנים בלי סיבה',
        'מכריחות את המודל להעתיק אותן מילה במילה',
        'מכוונות אותו לדפוס שרוצים, בלי לאמן אותו מחדש',
      ],
      why: 'מדוגמה אחת קשה להסיק מה הכלל; משלוש הדפוס כבר ברור. הן מלמדות פורמט וסגנון בלי הסבר ארוך.',
    },
    en: {
      q: 'What do two or three examples in one prompt do?',
      a: [
        'Waste tokens for no reason',
        'Force the model to copy them word for word',
        'Steer it toward the pattern you want, without retraining it',
      ],
      why: 'From one example the rule is hard to infer; from three the pattern is clear. They teach format and style without a long explanation.',
    },
  },
  {
    id: 'prompt-order', tier: 3, topic: 'prompt', correct: 0,
    he: {
      q: 'בפרומפט ארוך, איפה כדאי לשים את ההוראה החשובה?',
      a: [
        'בהתחלה או בסוף, במקום בולט',
        'באמצע, בין שאר הפרטים',
        'לא משנה, המודל קורא הכול אותו דבר',
      ],
      why: 'בפרומפט ארוך מה שיושב בקצוות בולט יותר. הוראה קריטית שקבורה באמצע פסקה נוטה להיבלע.',
    },
    en: {
      q: 'In a long prompt, where should the most important instruction go?',
      a: [
        'At the start or the end, somewhere prominent',
        'In the middle, among the other details',
        'It makes no difference, the model reads it all the same',
      ],
      why: 'In a long prompt, what sits at the edges stands out. A critical instruction buried mid-paragraph tends to get swallowed.',
    },
  },
  {
    id: 'prompt-success-test', tier: 3, topic: 'prompt', correct: 1,
    he: {
      q: 'מה זה "מדד הצלחה" בפרומפט?',
      a: [
        'ציון שהמודל נותן לעצמו בסוף',
        'משפט שמגדיר מראש מתי התשובה טובה',
        'מספר הניסיונות שמותר לעשות',
      ],
      why: 'כשכותבים "התשובה טובה אם היא מסבירה בלי מונחים טכניים", יש במה למדוד. בלי מדד כל תשובה נראית סבירה.',
    },
    en: {
      q: 'What is a "success test" in a prompt?',
      a: [
        'A grade the model gives itself at the end',
        'A sentence defining up front when the answer is good',
        'The number of attempts allowed',
      ],
      why: 'Writing "the answer is good if it explains with no technical terms" gives you something to measure against. Without a measure, any answer looks fine.',
    },
  },
  {
    id: 'prompt-delimiters', tier: 3, topic: 'prompt', correct: 2,
    he: {
      q: 'איך מפרידים בין ההוראה לבין טקסט ארוך שמצרפים?',
      a: [
        'כותבים את הכול ברצף אחד',
        'מוחקים את ההוראה כדי לא לבלבל',
        'מסמנים את הטקסט בגבולות ברורים, למשל בכוכביות',
      ],
      why: 'בלי הפרדה המודל עלול לקרוא את הטקסט המצורף כאילו הוא ההוראות. סימון פשוט אומר "זה החומר, וזו הבקשה".',
    },
    en: {
      q: 'How do you separate the instruction from long attached text?',
      a: [
        'Write it all as one run of text',
        'Delete the instruction so nothing gets confused',
        'Mark the text with clear boundaries, asterisks for instance',
      ],
      why: 'With no separation the model may read the attached text as instructions. A simple marker says "this is the material, this is the request".',
    },
  },
  {
    id: 'prompt-template', tier: 3, topic: 'prompt', correct: 0,
    he: {
      q: 'מה הופך פרומפט לתבנית שאפשר להשתמש בה שוב?',
      a: [
        'מבנה קבוע עם מקום שמחליפים בו את הנושא',
        'זה שהוא ארוך במיוחד',
        'זה שהוא שמור בשיחה ישנה',
      ],
      why: 'תבנית שומרת את מה שעבד — התפקיד, הפורמט וההגבלות — ומשאירה חור אחד לנושא. ככה פרומפט מוצלח נעשה כלי קבוע.',
    },
    en: {
      q: 'What turns a prompt into a reusable template?',
      a: [
        'A fixed structure with one slot where the topic gets swapped',
        'Being especially long',
        'Being saved in an old conversation',
      ],
      why: 'A template keeps what worked — the role, the format, the limits — and leaves one hole for the topic. That is how a good prompt becomes a permanent tool.',
    },
  },

  // ─────────────────────────────────────────────── tier 3 · tokens (the finale)
  {
    id: 'tokens-how-much-context', tier: 3, topic: 'tokens', correct: 1,
    he: {
      q: 'איך מחליטים כמה הקשר להכניס לפרומפט?',
      a: [
        'את המקסימום שאפשר להכניס, ליתר ביטחון',
        'מכניסים את מה שמשנה את התשובה, ולא יותר',
        'את המינימום ההכרחי, מילה או שתיים',
      ],
      why: 'הקשר הוא לא "כמה שיותר" ולא "כמה שפחות". השאלה היחידה היא אם הפרט הזה היה משנה את התשובה בפועל.',
    },
    en: {
      q: 'How do you decide how much context to put in a prompt?',
      a: [
        'The maximum you can fit, just to be safe',
        'Include what changes the answer, and nothing more',
        'The bare minimum — a word or two',
      ],
      why: 'Context is neither "as much as possible" nor "as little as possible". The only question is whether that detail would actually change the answer.',
    },
  },
  {
    id: 'tokens-summarize-chat', tier: 3, topic: 'tokens', correct: 2,
    he: {
      q: 'שיחה נעשתה ארוכה מדי. איך ממשיכים בלי לאבד מידע?',
      a: [
        'מוחקים הודעות ישנות אחת אחת',
        'מתחילים מחדש בלי שום דבר',
        'מסכמים את העיקר ופותחים שיחה חדשה עם הסיכום',
      ],
      why: 'סיכום קצר שומר את ההחלטות ומוותר על כל הדרך אליהן. זה מנקה את חלון ההקשר ומשאיר בו רק את מה שצריך.',
    },
    en: {
      q: 'A chat got too long. How do you continue without losing information?',
      a: [
        'Delete old messages one at a time',
        'Start over with nothing at all',
        'Summarise the essentials and open a new chat with the summary',
      ],
      why: 'A short summary keeps the decisions and drops the road to them. That clears the context window and leaves only what is needed.',
    },
  },
  {
    id: 'tokens-code-paste', tier: 3, topic: 'tokens', correct: 0,
    he: {
      q: 'מדביקים קוד ארוך לתוך השיחה. מה קורה?',
      a: [
        'הוא נספר בטוקנים ותופס מקום בחלון ההקשר',
        'קוד לא נספר, רק טקסט רגיל נספר',
        'התשובה מתקצרת אוטומטית בגלל הקוד',
      ],
      why: 'כל תו נספר, גם סוגריים ורווחים. לכן מדביקים את הקטע שרלוונטי לבעיה, ולא את כל הקובץ מההתחלה.',
    },
    en: {
      q: 'You paste long code into the chat. What happens?',
      a: [
        'It counts as tokens and takes room in the context window',
        'Code is not counted, only ordinary text is',
        'The answer shortens automatically because of the code',
      ],
      why: 'Every character counts, brackets and spaces included. So paste the part relevant to the problem, not the whole file.',
    },
  },
  {
    id: 'tokens-example-tradeoff', tier: 3, topic: 'tokens', correct: 1,
    he: {
      q: 'מתי דוגמה בפרומפט לא שווה את הטוקנים שלה?',
      a: [
        'כמעט בכל מקרה, דוגמאות רק מאריכות את הפרומפט',
        'כשהפורמט כבר ברור לגמרי מההוראה',
        'כשמבקשים פורמט חדש ולא מוכר',
      ],
      why: 'דוגמה עוזרת בדיוק כשקשה לתאר במילים. כשההוראה כבר חד־משמעית, הדוגמה רק מאריכה בלי להוסיף.',
    },
    en: {
      q: 'When is an example in a prompt not worth its tokens?',
      a: [
        'In nearly every case, examples just make the prompt longer',
        'When the format is already completely clear from the instruction',
        'When asking for a new, unfamiliar format',
      ],
      why: 'An example earns its place when words struggle. If the instruction is already unambiguous, the example only adds length.',
    },
  },

  // ────────────────────────────────────── tier 3 · trying again (the finale)
  {
    id: 'iterate-diagnose', tier: 3, topic: 'iterate', correct: 2,
    he: {
      q: 'התשובה מחטיאה שוב ושוב. מה בודקים קודם?',
      a: [
        'אם המודל עמוס בבקשות',
        'אם צריך לעבור לכתוב באנגלית',
        'אם הפרומפט באמת אומר את מה שחשבנו שהוא אומר',
      ],
      why: 'לרוב הבעיה היא שהבקשה עצמה מעורפלת. קריאה של הפרומפט כאילו מישהו אחר כתב אותו מגלה את זה מהר מאוד.',
    },
    en: {
      q: 'The answer keeps missing. What do you check first?',
      a: [
        'Whether the model is overloaded with requests',
        'Whether you should switch to writing in English',
        'Whether the prompt really says what you thought it said',
      ],
      why: 'Usually the request itself is the vague part. Reading the prompt as though someone else wrote it exposes that very fast.',
    },
  },
  {
    id: 'iterate-keep-old', tier: 2, topic: 'iterate', correct: 0,
    he: {
      q: 'למה שווה לשמור את הפרומפט הישן כשמשפרים?',
      a: [
        'כדי להשוות, ולחזור אחורה אם השינוי הרע',
        'כדי להאריך את השיחה',
        'כדי שאפשר יהיה להראות אותו למישהו אחר',
      ],
      why: 'לא כל שינוי הוא שיפור. כששתי הגרסאות שמורות אפשר להשוות תשובות ולבחור, במקום לשחזר מהזיכרון.',
    },
    en: {
      q: 'Why keep the old prompt when improving it?',
      a: [
        'To compare, and to go back if the change made things worse',
        'To make the conversation longer',
        'So it can be shown to somebody else later',
      ],
      why: 'Not every change is an improvement. With both versions saved you can compare answers and choose, instead of reconstructing from memory.',
    },
  },
  {
    id: 'iterate-stop-point', tier: 1, topic: 'iterate', correct: 1,
    he: {
      q: 'מתי מפסיקים לשפר ומגישים?',
      a: [
        'אחרי בדיוק עשרה סיבובים',
        'כשהתשובה עונה על מה שהוגדר מראש כטוב',
        'כשנגמר הכוח להמשיך לנסות',
      ],
      why: 'בלי הגדרה מראש אפשר לשפר עד אינסוף. מדד פשוט שנקבע לפני ההתחלה אומר בדיוק מתי הגענו.',
    },
    en: {
      q: 'When do you stop improving and hand it in?',
      a: [
        'After exactly ten rounds',
        'When the answer meets what you defined as good in advance',
        'When you run out of energy to keep trying',
      ],
      why: 'With no definition up front you can polish forever. A simple measure set before you start says exactly when you have arrived.',
    },
  },

  // ─────────────────────────── tier 3 · checking the AI (the finale)
  {
    id: 'mistakes-quote', tier: 1, topic: 'mistakes', correct: 1,
    he: {
      q: 'ה־AI ציטט משפט בשם אדם מפורסם. מה עושים?',
      a: [
        'משתמשים בו, ציטוטים כאלה בדרך כלל מדויקים',
        'מחפשים את הציטוט המקורי ומוודאים',
        'מוסיפים מרכאות וזה מספיק',
      ],
      why: 'ציטוטים ושמות הם מהדברים שמודל ממציא בקלות, כי הם נשמעים נכון. חיפוש קצר מוודא שהמשפט באמת נאמר.',
    },
    en: {
      q: 'The AI quoted a line by a famous person. What do you do?',
      a: [
        'Use it, quotes like that are usually accurate',
        'Look up the original quote and verify it',
        'Add quotation marks and that is enough',
      ],
      why: 'Quotes and names are among the easiest things for a model to invent, because they sound right. A quick search confirms it was really said.',
    },
  },
  {
    id: 'mistakes-agrees-fast', tier: 3, topic: 'mistakes', correct: 2,
    he: {
      q: 'אמרו ל־AI שהוא טועה והוא מיד הסכים. מה זה אומר?',
      a: [
        'שהוא באמת טעה',
        'שהוא לומד תוך כדי השיחה',
        'שהוא נוטה להסכים, אז זה לא מוכיח כלום',
      ],
      why: 'מודל מכוון להיות נעים ומועיל, ולכן הוא מתיישר לפי מה שנאמר לו. הסכמה מהירה היא לא ראיה — בודקים במקור.',
    },
    en: {
      q: 'You told the AI it was wrong and it agreed at once. What does that mean?',
      a: [
        'It really was wrong',
        'It is learning during the conversation',
        'It tends to agree, so this proves nothing',
      ],
      why: 'A model is tuned to be pleasant and helpful, so it falls in line with what it is told. Quick agreement is not evidence — check the source.',
    },
  },
  {
    id: 'mistakes-responsibility', tier: 1, topic: 'mistakes', correct: 0,
    he: {
      q: 'מי אחראי על מה שמפרסמים בעזרת AI?',
      a: [
        'מי שהשתמש בכלי ובחר לפרסם',
        'חברת ה־AI בלבד',
        'אף אחד, זה נכתב אוטומטית',
      ],
      why: 'הכלי מציע, ואנחנו לוחצים על שלח. אם יש בפנים טעות, היא כבר שלנו — אז קוראים ומתקנים לפני שזה יוצא.',
    },
    en: {
      q: 'Who is responsible for what gets published with AI\'s help?',
      a: [
        'Whoever used the tool and chose to publish',
        'The AI company alone',
        'Nobody — it was written automatically',
      ],
      why: 'The tool suggests; you press send. If there is a mistake inside, it is yours now — so read it and fix it before it goes out.',
    },
  },

  // ─────────────────────────────────────── tier 3 · vibe coding (the finale)
  {
    id: 'vibe-learn-from-code', tier: 3, topic: 'vibe', correct: 1,
    he: {
      q: 'איך באמת לומדים מהקוד שה־AI כתב?',
      a: [
        'מריצים אותו כמה פעמים ברצף',
        'מבקשים הסבר על כל חלק ומנסים לשנות בעצמנו',
        'שומרים אותו בצד בלי לפתוח',
      ],
      why: 'שינוי קטן שעושים לבד מלמד יותר מכל הסבר. אם משהו נשבר — זה בדיוק הרגע שבו מבינים איך זה עובד.',
    },
    en: {
      q: 'How do you actually learn from the code the AI wrote?',
      a: [
        'Run it several times in a row',
        'Ask for an explanation of each part and try changing it yourself',
        'File it away without opening it',
      ],
      why: 'One small change you make yourself teaches more than any explanation. If something breaks, that is the moment you understand how it works.',
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ROUND-2 ADDITIONS — vibe coding had a single tier-1 question, so a child in
  // race one almost never met the topic; three gentle ones fix that. The rest
  // close real gaps the bank had no question for at all: grounding (hand the
  // model the text instead of trusting its memory), standing instructions, and
  // asking the model to critique its own output.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'vibe-say-what-happens', tier: 1, topic: 'vibe', correct: 2,
    he: {
      q: 'מבקשים מ־AI לבנות משחק. מה הכי חשוב להגיד לו?',
      a: [
        'שהמשחק צריך לצאת הכי טוב שיש, ברמה של משחקים אמיתיים',
        'בערך כמה שורות קוד לכתוב, וכמה קבצים שיהיו',
        'מה קורה במשחק: מי זז, מי מנצח, ומה רואים על המסך',
      ],
      why: 'תוכנה היא בסך הכול רצף של "מה קורה כש…". מי שמתאר את זה במילים פשוטות כבר עשה את החלק הקשה.',
    },
    en: {
      q: 'You ask an AI to build a game. What matters most to tell it?',
      a: [
        'That the game must turn out as good as real commercial games',
        'Roughly how many lines of code to write, and how many files',
        'What happens in the game: who moves, who wins, what you see',
      ],
      why: 'Software is really just a stack of "what happens when…". Describing that in plain words is already the hard part done.',
    },
  },
  {
    id: 'vibe-run-it', tier: 1, topic: 'vibe', correct: 0,
    he: {
      q: 'ה־AI כתב קוד. מה עושים איתו ראשון?',
      a: [
        'מריצים אותו ורואים מה באמת קורה',
        'קוראים אותו לאט ומחפשים שורות שנראות מוזרות',
        'מבקשים מיד את החלק הבא, כדי לא לאבד את הקצב',
      ],
      why: 'גם קוד שנראה מצוין יכול להתפוצץ בשנייה הראשונה. ההרצה לוקחת שניות והיא הדבר היחיד שמספר את האמת.',
    },
    en: {
      q: 'The AI wrote some code. What do you do with it first?',
      a: [
        'Run it and see what actually happens',
        'Read it slowly and look for lines that seem odd',
        'Ask straight away for the next part, to keep the momentum',
      ],
      why: 'Even code that looks perfect can blow up in the first second. Running it takes seconds and is the only thing that tells the truth.',
    },
  },
  {
    id: 'vibe-ask-explain', tier: 1, topic: 'vibe', correct: 1,
    he: {
      q: 'לא מבינים שורה בקוד שה־AI כתב. מה עושים?',
      a: [
        'ממשיכים הלאה, כי בסוף מה שחשוב זה שהתוכנה עובדת',
        'מבקשים הסבר פשוט בדיוק על השורה הזאת',
        'מוחקים את השורה ובודקים אם משהו בכלל השתנה',
      ],
      why: 'לבקש הסבר לא עולה כלום, וזה בדיוק הרגע שבו לומדים. קוד שמבינים אפשר גם לתקן לבד בפעם הבאה.',
    },
    en: {
      q: 'You do not understand a line in the code the AI wrote. What now?',
      a: [
        'Move on, because in the end what matters is that it works',
        'Ask for a simple explanation of that exact line',
        'Delete the line and check whether anything actually changed',
      ],
      why: 'Asking for an explanation costs nothing, and it is exactly where the learning happens. Code you understand you can fix yourself next time.',
    },
  },
  {
    id: 'prompt-grounding', tier: 2, topic: 'prompt', correct: 2,
    he: {
      q: 'רוצים שאלות חזרה על סיפור שקראנו בכיתה. מה הכי עוזר?',
      a: [
        'לכתוב את שם הסיפור ואת שם הסופר, ולסמוך על הזיכרון שלו',
        'לבקש ממנו לנחש מה קורה בסיפור לפי השם שלו',
        'להדביק את הטקסט עצמו, גם אם זה עולה עוד טוקנים',
      ],
      why: 'כשהטקסט מול העיניים של המודל הוא עונה עליו, ולא על זיכרון מטושטש ממנו. זה ההבדל בין לצטט לבין לנחש.',
    },
    en: {
      q: 'You want revision questions on a story read in class. What helps most?',
      a: [
        'Give the title and the author, and rely on its memory',
        'Ask it to guess what happens in the story from the title',
        'Paste the text itself, even though that costs extra tokens',
      ],
      why: 'With the text in front of it, the model answers about the text and not about a hazy memory of it. That is the gap between quoting and guessing.',
    },
  },
  {
    id: 'prompt-standing-rules', tier: 2, topic: 'prompt', correct: 0,
    he: {
      q: 'מה ההבדל בין כלל קבוע לשיחה לבין בקשה חד־פעמית?',
      a: [
        'כלל קבוע נכתב פעם אחת ותקף להמשך השיחה',
        'אין הבדל אמיתי, המודל מתייחס לשניהם בדיוק אותו דבר',
        'כלל קבוע עובד רק אם כותבים אותו בהודעה הראשונה בשיחה',
      ],
      why: '"מעכשיו לענות בעברית ובקצרה" חוסך לחזור על זה כל פעם. בשיחה ארוכה שווה להזכיר את הכלל שוב מדי פעם.',
    },
    en: {
      q: 'What is the difference between a standing rule and a one-off request?',
      a: [
        'A standing rule is written once and holds for the rest of the chat',
        'No real difference, the model treats both of them the same way',
        'A standing rule only works if it is the first message in the chat',
      ],
      why: '"From now on, answer in Hebrew and keep it short" saves repeating yourself. In a long chat it is worth restating the rule now and then.',
    },
  },
  {
    id: 'iterate-self-critique', tier: 2, topic: 'iterate', correct: 1,
    he: {
      q: 'התשובה מוכנה. מה אפשר לבקש לפני שמשתמשים בה?',
      a: [
        'לכתוב את אותה תשובה שוב, הפעם במילים אחרות לגמרי',
        'לעבור עליה, לסמן שתי חולשות ולהציע שיפור אחד',
        'להוסיף עוד פסקה בסוף, כדי שהתשובה תרגיש שלמה',
      ],
      why: 'קל יותר למצוא בעיות בטקסט מוכן מאשר לכתוב אותו נכון מהתחלה, וזה נכון גם למודל. את התיקונים עדיין בוחרים בעצמנו.',
    },
    en: {
      q: 'The answer is ready. What can you ask for before using it?',
      a: [
        'To write the same answer again, this time in completely different words',
        'To go over it, name two weak spots and suggest one fix',
        'To add another paragraph at the end so it feels complete',
      ],
      why: 'Finding problems in finished text is easier than getting it right first time — true for the model too. You still choose which fixes to take.',
    },
  },
  {
    id: 'prompt-only-from-text', tier: 3, topic: 'prompt', correct: 2,
    he: {
      q: 'צירפנו מאמר ורוצים תשובה שמבוססת רק עליו. מה כותבים?',
      a: [
        '"לענות בצורה מדויקת ואמינה, בלי להמציא שום דבר"',
        '"לקרוא את המאמר המצורף היטב לפני שעונים על השאלה"',
        '"לענות רק לפי המאמר, ולכתוב אם התשובה לא נמצאת בו"',
      ],
      why: 'ההוראה הזאת נותנת למודל דרך לומר "אין לי", במקום להשלים מהזיכרון. תשובה כזאת גם קל לבדוק מול הטקסט.',
    },
    en: {
      q: 'You attached an article and want an answer based only on it. What do you write?',
      a: [
        '"Answer accurately and reliably, without inventing anything"',
        '"Read the attached article carefully before answering the question"',
        '"Answer only from the article, and say so if the answer is not in it"',
      ],
      why: 'That instruction gives the model a way to say "I do not have it" instead of filling in from memory. It also makes the answer easy to check against the text.',
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ROUND-3 ADDITIONS — tier 3 had filled up with "what is X" definitions while
  // the genuinely hard questions are the trade-offs: when the usual advice stops
  // working. These three are all of that shape, and their correct answer is the
  // SHORTEST option, which the finale had almost none of.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'prompt-too-many-details', tier: 3, topic: 'prompt', correct: 1,
    he: {
      q: 'מתי דווקא יותר מדי פרטים בפרומפט מזיקים?',
      a: [
        'כשהפרומפט נעשה ארוך יותר מהתשובה שמבקשים ממנו',
        'כשהם סותרים זה את זה',
        'כשהם כתובים בשפה פשוטה מדי בשביל מודל חכם',
      ],
      why: 'שני פרטים שלא מסתדרים יחד — "קצר מאוד" ו"עם שלוש דוגמאות" — מכריחים את המודל לוותר על אחד, והוא לא בהכרח יבחר כמונו.',
    },
    en: {
      q: 'When do too many details in a prompt actually hurt?',
      a: [
        'When the prompt ends up longer than the answer you asked for',
        'When they contradict each other',
        'When they are written too simply for a clever model',
      ],
      why: 'Two details that cannot both hold — "very short" and "with three examples" — force the model to drop one, and it may not drop the one you would.',
    },
  },
  {
    id: 'vibe-simplify', tier: 3, topic: 'vibe', correct: 2,
    he: {
      q: 'הקוד עובד, אבל יצא מסובך ומבלבל. מה עושים?',
      a: [
        'משאירים אותו בדיוק כמו שהוא, כי הוא כבר עובד ואין טעם לגעת',
        'מבקשים לכתוב את כל התוכנית מחדש, הפעם בצורה מסודרת יותר',
        'מפשטים חלק אחד, ובודקים',
      ],
      why: 'קוד מסובך נשבר בפעם הבאה שנוגעים בו, וכתיבה מחדש שוברת גם את מה שעבד. פישוט קטן משאיר תמיד גרסה עובדת מאחור.',
    },
    en: {
      q: 'The code works, but it came out tangled and confusing. What now?',
      a: [
        'Leave it exactly as it is, since it already works and touching it is risky',
        'Ask for the whole program to be rewritten, this time in a tidier way',
        'Simplify one part, then test',
      ],
      why: 'Tangled code breaks the next time you touch it, and a rewrite breaks what already worked. A small simplification always leaves a working version behind.',
    },
  },
  {
    id: 'mistakes-self-check', tier: 3, topic: 'mistakes', correct: 0,
    he: {
      q: 'מתי לבקש מהמודל לבדוק את עצמו באמת עוזר?',
      a: [
        'כשיש קריטריון ברור לבדוק מולו',
        'כששואלים אותו סתם אם הוא בטוח בתשובה שהוא נתן',
        'כשמבקשים ממנו לדרג את התשובה שלו מאחת עד עשר',
      ],
      why: '"לבדוק מול שלוש הדרישות שביקשתי" זו משימה אמיתית עם תשובה. "אתה בטוח?" ו"תן ציון" מייצרים דעה חדשה, לא בדיקה.',
    },
    en: {
      q: 'When does asking the model to check itself genuinely help?',
      a: [
        'When there is a clear criterion to check against',
        'When you simply ask whether it is sure about the answer it gave',
        'When you ask it to rate its own answer from one to ten',
      ],
      why: '"Check it against the three requirements I listed" is a real task with a real answer. "Are you sure?" and "give it a score" produce a new opinion, not a check.',
    },
  },
];

/** Tiers a given race draws from. Race 1 → tier 1, race 2 → 1–2, race 3 → 2–3. */
export function tiersForDifficulty(difficulty = 1) {
  const d = Math.max(1, Math.min(3, Math.round(difficulty) || 1));
  return d === 1 ? [1] : d === 2 ? [1, 2] : [2, 3];
}

/**
 * All questions eligible for a race difficulty, in bank order.
 *
 * `exclude` is the championship no-repeat hook: pass the ids already asked in
 * earlier races of the same championship and they drop out of the pool. It is
 * OPTIONAL and defaults to nothing, so the old one-argument call is unchanged.
 * If excluding would leave fewer than MIN_POOL questions (it cannot with the
 * current bank, but a future trim must not brick the quiz) the full eligible
 * list is returned instead — a repeated question is always better than none.
 */
export const MIN_POOL = 12;

export function questionsForDifficulty(difficulty = 1, exclude = null) {
  const tiers = tiersForDifficulty(difficulty);
  const all = QUESTIONS.filter(q => tiers.includes(q.tier));
  if (!exclude) return all;
  const seen = exclude instanceof Set ? exclude : new Set(exclude);
  if (!seen.size) return all;
  const left = all.filter(q => !seen.has(q.id));
  return left.length >= MIN_POOL ? left : all;
}

/** Counts per tier / per topic — used by the bank validator and by tooling. */
export function bankStats() {
  const byTier = {}, byTopic = {};
  for (const q of QUESTIONS) {
    byTier[q.tier] = (byTier[q.tier] || 0) + 1;
    byTopic[q.topic] = (byTopic[q.topic] || 0) + 1;
  }
  return { total: QUESTIONS.length, byTier, byTopic };
}
