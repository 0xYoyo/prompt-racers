// ═════════════════════════════════════════════════════════════════════════════
// QUIZ BANK — the educational payload of מרוץ הפרומפטים
// ═════════════════════════════════════════════════════════════════════════════
//
// 34 kid-level questions about AI and prompting. This file is DATA ONLY — no
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
        'אדם אמיתי שיושב ועונה מהצד השני של המסך',
      ],
      why: 'מודל שפה קרא כמות עצומה של טקסט ולמד לנחש מה מתאים לבוא אחר כך. זה נשמע כמו שיחה, אבל מאחורי הקלעים זה ניחוש חכם מאוד.',
    },
    en: {
      q: 'What is a language model — the kind behind smart chats?',
      a: [
        'A huge encyclopedia you look a ready answer up in',
        'Software that learned from huge amounts of text to guess the next word',
        'A real person sitting and answering on the other side',
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
        'הוא מחובר לאינטרנט וקורא הכול בזמן אמת',
      ],
      why: 'אף אחד לא כתב למודל רשימת כללים. הוא ראה מיליוני דוגמאות ומצא בעצמו את הדפוסים החוזרים — בערך כמו ללמוד שפה משמיעה.',
    },
    en: {
      q: 'How does an AI model learn what it knows?',
      a: [
        'By training on an enormous number of examples',
        'Someone typed every rule into it one by one',
        'It is wired to the internet and reads everything live',
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
        'ממומחה אנושי שמקבל את השאלה',
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
        'הוא מרגיש שמחה ועצב ממש כמו בן אדם',
        'הוא יודע לכתוב על רגשות, אבל לא מרגיש אותם',
        'הוא לא מסוגל לכתוב על רגשות בכלל',
      ],
      why: 'המודל למד איך אנשים כותבים על רגשות, ולכן הוא כותב על זה יפה. זה עדיין תיאור של רגש ולא רגש — נחמד לזכור את זה כשהתשובה נשמעת אישית.',
    },
    en: {
      q: 'What is true about AI and feelings?',
      a: [
        'It feels joy and sadness just like a person',
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
        'כי המודל זוכר מי שאל קודם ומשתעמם',
        'כי כל אחד מקבל מודל אחר',
        'כי בבחירת המילים יש גם קצת אקראיות',
      ],
      why: 'בכל צעד יש כמה מילים שמתאימות, והמודל בוחר ביניהן עם קצת אקראיות. זה מה שנותן גיוון — ובדיוק לכן שווה לנסות שוב כשהתשובה לא קלעה.',
    },
    en: {
      q: 'Why can the exact same question get two different answers?',
      a: [
        'The model remembers who asked before and gets bored',
        'Everyone gets a different model',
        'There is a little randomness in how words get picked',
      ],
      why: 'At each step several words fit, and the model picks among them with a little randomness. That is what gives variety — and exactly why retrying is worth it.',
    },
  },
  {
    id: 'ai-context-window', tier: 3, topic: 'whatai', correct: 1,
    he: {
      q: 'מה זה "חלון הקשר" של מודל?',
      a: [
        'החלון בתוכנה שבו מקלידים את השאלה',
        'כמות הטקסט שהמודל יכול להחזיק מול העיניים בבת אחת',
        'מספר השאלות שמותר לשאול ביום',
      ],
      why: 'למודל יש גבול לכמות הטקסט שהוא מחזיק בבת אחת. כששיחה נעשית ארוכה מאוד, הדברים הישנים נדחקים החוצה — ולכן שווה לחזור על מה שחשוב.',
    },
    en: {
      q: 'What is a model\'s "context window"?',
      a: [
        'The box on screen where you type the question',
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
        'השם של המודל שאיתו עובדים',
        'הכפתור ששולח את ההודעה',
        'ההוראה או הבקשה שכותבים ל־AI',
      ],
      why: 'פרומפט הוא כל מה שכותבים ל־AI כדי להסביר מה רוצים. זו נקודת ההשפעה הגדולה ביותר — התוצאה מתחילה בפרומפט.',
    },
    en: {
      q: 'What is a prompt?',
      a: [
        'The name of the model being used',
        'The button that sends the message',
        'The instruction or request written to the AI',
      ],
      why: 'A prompt is everything written to the AI to explain what is wanted. It is the biggest point of influence — the result starts with the prompt.',
    },
  },
  {
    id: 'prompt-better-one', tier: 1, topic: 'prompt', correct: 1,
    he: {
      q: 'איזה פרומפט ייתן סיפור קרוב יותר למה שדמיינו?',
      a: [
        'לכתוב סיפור, תודה רבה!',
        'לכתוב סיפור קצר לילדי כיתה ד׳ על חתול אמיץ שמפחד ממים',
        'לכתוב סיפור מעולה ומרגש מאוד',
      ],
      why: 'מילים כמו "מעולה" לא אומרות למודל כלום. פרטים כן: על מה, למי, ובאיזה אורך. נימוס זה נחמד — אבל פרטים זה מה שעובד.',
    },
    en: {
      q: 'Which prompt gives a story closer to the one imagined?',
      a: [
        'Write a story, thanks a lot!',
        'Write a short story for 4th graders about a brave cat afraid of water',
        'Write a truly excellent and very moving story',
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
        'סימני קריאה, כדי להדגיש שזה חשוב',
        'לחזור על אותו פרומפט שלוש פעמים',
      ],
      why: 'ל"בית" יש מיליון גרסאות, והמודל יבחר אחת. כל פרט שמוסיפים — סגנון, צבע, שעה ביום — מקרב את התוצאה לתמונה שבראש.',
    },
    en: {
      q: 'What is most worth adding to the prompt "draw a house"?',
      a: [
        'Which house, in what style, in which colours',
        'Exclamation marks, to show it matters',
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
        'כי ככה המודל עובד מהר יותר',
        'כי זה תמיד חוסך טוקנים',
        'כי הגדרת קהל היעד משנה את המילים ואת רמת ההסבר',
      ],
      why: 'אותו תוכן אפשר להסביר במאה רמות. כשאומרים למי ההסבר מיועד, המודל בוחר מילים ודוגמאות שמתאימות בדיוק לקהל הזה.',
    },
    en: {
      q: 'Why does "explain it like I\'m ten" help?',
      a: [
        'It makes the model run faster',
        'It always saves tokens',
        'Naming the audience changes the words and the level of the explanation',
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
        'לבקש מראש: "בשלוש שורות לכל היותר"',
        'לכתוב "קצר בבקשה" בלי מספר',
        'לשאול שאלה קצרה ולקוות לתשובה קצרה',
      ],
      why: '"קצר" זה יחסי, ומספר זה לא. גבול ברור — שלוש שורות, חמישה משפטים — הופך פרומפט מעורפל להוראה שאפשר לעמוד בה.',
    },
    en: {
      q: 'What helps most to get a short answer?',
      a: [
        'Asking up front: "three lines at most"',
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
        'הופך את המודל למומחה אמיתי בתחום',
        'גורם לתשובה להיות ארוכה יותר',
        'מכוון את נקודת המבט ואת סוג הדברים שיעלו בתשובה',
      ],
      why: 'תפקיד לא מוסיף למודל ידע חדש, אבל הוא בוחר מאיזו זווית לענות. מדריך טיולים ידבר על מסלולים ונוף, ביולוג ידבר על בעלי חיים.',
    },
    en: {
      q: 'What does a role like "as a hiking guide" do in a prompt?',
      a: [
        'Turns the model into a real expert on the subject',
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
        'מטבעות שקיימים רק בתוך משחקים',
        'חתיכות קטנות של טקסט שהמודל סופר',
        'שמות הדגמים של מודלי ה־AI',
      ],
      why: 'טקסט מפורק לחתיכות קטנות: מילה, חצי מילה או סימן פיסוק. המודל קורא וכותב בחתיכות האלה, ולכן סופרים אותן.',
    },
    en: {
      q: 'What are tokens?',
      a: [
        'Coins that only exist inside games',
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
        'כי המודל מתעצבן מטקסט ארוך',
        'כי יש בה יותר טוקנים, וכל טוקן דורש עבודה',
      ],
      why: 'לכל טוקן יש מחיר קטן בחישוב. הרבה טוקנים — הרבה חישוב, ולכן יותר זמן ויותר עלות. זה בדיוק כמו הטוקנים שאוספים במסלול.',
    },
    en: {
      q: 'Why does a very long prompt "cost" more?',
      a: [
        'Because it is sent somewhere further away',
        'Because the model gets annoyed by long text',
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
        'רק מה ששולחים',
        'רק התשובה שחוזרת',
      ],
      why: 'שני הכיוונים נספרים. לכן פרומפט שמבקש תשובה ענקית יכול לעלות יותר מהפרומפט עצמו — ולכן שווה לבקש בדיוק את האורך שצריך.',
    },
    en: {
      q: 'What gets counted as tokens?',
      a: [
        'Both what you send and what comes back',
        'Only what you send',
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
        'מוחקים את כל הפרטים ומשאירים מילה אחת',
        'כותבים בקיצורים שקשה להבין',
        'כותבים פרומפט ממוקד, בלי חזרות ובלי מילוי',
      ],
      why: 'חיסכון חכם מוחק מה שלא מוסיף — נימוסים ארוכים, חזרות, "כמו שאמרתי קודם". הפרטים שמסבירים מה רוצים נשארים תמיד.',
    },
    en: {
      q: 'How do you save tokens without hurting the result?',
      a: [
        'Delete every detail and leave one word',
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
        'כשרוצים שהמודל ייקח יותר זמן לחשוב',
      ],
      why: 'טוקנים הם תקציב, לא ציון. משפט הקשר שחוסך שלושה ניסיונות כושלים הוא העסקה הכי משתלמת שיש.',
    },
    en: {
      q: 'When is it actually worth "spending" tokens?',
      a: [
        'Never — shorter is always better',
        'When context or an example genuinely improves the answer',
        'When you want the model to take longer thinking',
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
        'תמיד יוצא בדיוק אותו מספר טוקנים',
        'טוקנים נספרים לפי מספר האותיות בלבד',
      ],
      why: 'החלוקה לטוקנים נלמדה בעיקר מטקסטים באנגלית, ולכן עברית מתפרקת לרוב לחתיכות קטנות יותר. אותו רעיון, יותר טוקנים.',
    },
    en: {
      q: 'A short Hebrew sentence and a short English one — what is true?',
      a: [
        'The token count can differ between languages',
        'It always comes out to exactly the same number',
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
        'Send the exact same prompt again',
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
        'Open a new chat and start over',
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
        'כי המודל לא מסוגל לקלוט שני שינויים',
        'כי ניסיון עם שינוי אחד רץ מהר יותר',
      ],
      why: 'כששני דברים משתנים יחד ומשהו משתפר — אי אפשר לדעת מי אחראי. שינוי אחד בכל פעם הופך ניחוש לניסוי אמיתי.',
    },
    en: {
      q: 'Why change one thing per attempt?',
      a: [
        'So you know which change is the one that helped',
        'Because the model cannot handle two changes',
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
        'אחרי בדיוק חמש הודעות, תמיד',
        'כשהשיחה מלאה בכיוונים ישנים שממשיכים לחזור',
        'אף פעם — תמיד עדיף להמשיך באותה שיחה',
      ],
      why: 'המודל רואה את כל השיחה, כולל הניסיונות שנכשלו, וממשיך להיגרר אליהם. פתיחה נקייה עם הפרומפט המשופר עוקפת את כל הרעש הזה.',
    },
    en: {
      q: 'When is a fresh chat better than more fixing?',
      a: [
        'After exactly five messages, always',
        'When the chat is full of old directions that keep coming back',
        'Never — continuing the same chat is always better',
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
        'כן, ביטחון בתשובה מעיד שהיא נכונה',
        'כן, אם התשובה ארוכה ומפורטת',
      ],
      why: 'המודל כותב הכול באותו טון בטוח, גם כשהוא טועה. הביטחון בטקסט הוא סגנון כתיבה — לא הוכחה.',
    },
    en: {
      q: 'The AI answered with total confidence. Can you rely on it?',
      a: [
        'Not necessarily — a very confident answer can still be wrong',
        'Yes, confidence means it is correct',
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
        'שואלים את אותו AI אם הוא בטוח',
        'סופרים כמה פעמים הוא חזר על זה',
        'משווים למקור אמין נוסף מחוץ לשיחה',
      ],
      why: 'לשאול את המודל "אתה בטוח?" בדרך כלל רק מוליד תשובה בטוחה עוד יותר. בדיקה אמיתית מגיעה ממקור אחר: אתר, ספר, מבוגר שיודע.',
    },
    en: {
      q: 'How do you check a fact the AI gave you?',
      a: [
        'Ask the same AI whether it is sure',
        'Count how many times it repeated it',
        'Compare it against a trustworthy source outside the chat',
      ],
      why: 'Asking a model "are you sure?" usually just produces an even surer answer. A real check comes from elsewhere: a site, a book, an adult who knows.',
    },
  },
  {
    id: 'mistakes-hallucination', tier: 2, topic: 'mistakes', correct: 1,
    he: {
      q: 'מה זה "הזיה" של מודל?',
      a: [
        'כשהוא מסרב לענות על שאלה',
        'כשהוא ממציא פרט שנשמע נכון לגמרי אבל אינו נכון',
        'כשהוא עונה לאט מהרגיל',
      ],
      why: 'המודל תמיד מנסה להשלים משהו שמתאים, גם כשאין לו את המידע. אז נולד פרט שנשמע מושלם ופשוט לא קיים — ולכן בודקים.',
    },
    en: {
      q: 'What is a model "hallucination"?',
      a: [
        'When it refuses to answer a question',
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
        'מעתיקים ישר לעבודה, זה נראה מסודר',
        'מניחים שזה תקין כי יש שם ותאריך',
      ],
      why: 'שמות מקורות הם בדיוק המקום שבו מודל ממציא בביטחון. מקור אמיתי אפשר לפתוח — וזו בדיקה של חמש שניות.',
    },
    en: {
      q: 'The AI gave a link or a book title. What now?',
      a: [
        'Open it and check the source really exists and fits',
        'Copy it straight into the work, it looks tidy',
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
        'כי מודל שפה לא מסוגל לחשב בכלל',
        'כי הוא מנחש טקסט, ודיוק במספרים הוא לא החוזק שלו',
      ],
      why: 'מודל שפה מנחש מה מתאים לבוא אחר כך — וזה לא אותו דבר כמו לחשב. בחישוב ארוך שווה תמיד לוודא, או לבקש ממנו לפרט את השלבים.',
    },
    en: {
      q: 'With arithmetic or dates, why double-check the AI?',
      a: [
        'Because numbers cost more tokens',
        'Because a language model cannot calculate at all',
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
        'לכתוב את הקוד לבד ולבקש מ־AI רק לחפש שגיאות',
      ],
      why: 'בוייב־קודינג מתארים את הרעיון בשפה רגילה, וה־AI כותב את הקוד. התיאור הוא העבודה האמיתית — בדיוק כמו פרומפט טוב.',
    },
    en: {
      q: 'What is "vibe coding"?',
      a: [
        'Copying ready-made code off the internet unchanged',
        'Describing what the software should do, and letting AI write the code',
        'Writing the code yourself and only asking AI to hunt for bugs',
      ],
      why: 'In vibe coding you describe the idea in ordinary language and the AI writes the code. The description is the real work — exactly like a good prompt.',
    },
  },
  {
    id: 'vibe-start-project', tier: 2, topic: 'vibe', correct: 2,
    he: {
      q: 'בונים משחק עם AI. איך הכי כדאי להתחיל?',
      a: [
        'לבקש "לבנות משחק מגניב" ולחכות',
        'לבקש את כל הקוד בהודעה ענקית אחת',
        'לתאר מה קורה במשחק, ואז לבקש שלב אחר שלב',
      ],
      why: 'קודם מסבירים מה המשחק עושה — מי זז, מה קורה כשמנצחים. אחר כך בונים חלק־חלק ובודקים כל חלק. ככה יוצא משחק ולא ערימת קוד.',
    },
    en: {
      q: 'Building a game with AI. What is the best way to start?',
      a: [
        'Ask for "a cool game" and wait',
        'Ask for all the code in one giant message',
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
        'למחוק הכול ולבקש לכתוב מחדש מאפס',
      ],
      why: 'הודעת השגיאה היא הרמז הכי שווה שיש, והיא עולה טוקנים בודדים. "לא עובד" מבקש מהמודל לנחש איפה הבעיה.',
    },
    en: {
      q: 'The code the AI wrote does not work. What helps most?',
      a: [
        'Paste the error message and describe what actually happened',
        'Write "broken, fix it"',
        'Delete everything and ask for a rewrite from scratch',
      ],
      why: 'The error message is the most valuable clue there is, and it costs a handful of tokens. "Broken" asks the model to guess where the problem is.',
    },
  },
  {
    id: 'vibe-test-each', tier: 3, topic: 'vibe', correct: 1,
    he: {
      q: 'למה מריצים ובודקים כל שינוי שה־AI עשה?',
      a: [
        'כי ה־AI לא זוכר מה כתב לפני רגע',
        'כי רק הרצה אמיתית מראה אם זה באמת עובד',
        'כי בדיקה תכופה חוסכת טוקנים',
      ],
      why: 'קוד יכול להיראות מושלם ולהתפוצץ בהרצה הראשונה. בדיקה אחרי כל שינוי קטן מאתרת את התקלה כשעוד ברור מה גרם לה.',
    },
    en: {
      q: 'Why run and test every change the AI made?',
      a: [
        'Because the AI does not remember what it just wrote',
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
        'הוא מלא במילים טכניות מרשימות',
        'כתוב בו מה קורה, מתי זה קורה, ומה רואים על המסך',
      ],
      why: 'תיאור טוב הוא כזה שאפשר לבדוק אחריו. "כשלוחצים רווח הכדור קופץ ונשמע צליל" — אפשר להריץ ולראות אם זה קרה.',
    },
    en: {
      q: 'What marks a good feature description for an AI?',
      a: [
        'It is very long and covers everything',
        'It is packed with impressive technical words',
        'It says what happens, when it happens, and what appears on screen',
      ],
      why: 'A good description is one you can check afterwards. "Press space, the ball jumps and a sound plays" — you can run it and see whether that happened.',
    },
  },
];

/** Tiers a given race draws from. Race 1 → tier 1, race 2 → 1–2, race 3 → 2–3. */
export function tiersForDifficulty(difficulty = 1) {
  const d = Math.max(1, Math.min(3, Math.round(difficulty) || 1));
  return d === 1 ? [1] : d === 2 ? [1, 2] : [2, 3];
}

/** All questions eligible for a race difficulty, in bank order. */
export function questionsForDifficulty(difficulty = 1) {
  const tiers = tiersForDifficulty(difficulty);
  return QUESTIONS.filter(q => tiers.includes(q.tier));
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
