import re
p='src/garage/prompts.js'
src=open(p).read()
lines=src.split('\n')
start=re.compile(r"^\s+[erwc]\('[a-z]+', \d,")
idx=[i for i,l in enumerate(lines) if start.match(l)]
assert len(idx)==48, len(idx)

SUBS = [
 # ── GOALS · engine ──────────────────────────────────────────────────────────
 ('בורג ינחש מה זה חזק. בהצלחה.', 'Boreg will guess what strong means. Good luck.'),
 ('מהר יותר — אבל בישורת או ביציאה מסיבוב?', 'Faster — but on the straight, or out of a corner?'),
 ('"אחרי בלימה" זה כבר רגע אמיתי על המסלול', '"After braking" is already a real moment on track'),
 ('יציאה מסיבוב: מתי, איפה, ומה בדיוק נמדד', 'Corner exit: when, where, and exactly what gets measured'),
 # ── GOALS · tires ───────────────────────────────────────────────────────────
 ('"טוב" זה לא מידה. בורג ינחש.', '"Good" is not a measurement. Boreg will guess.'),
 ('להחליק פחות — איפה? בכל המסלול?', 'Slide less — where? Everywhere on the track?'),
 ('בלימה מאוחרת יותר היא משהו שאפשר למדוד', 'Braking later is something that can actually be measured'),
 ('גם המשטח נכנס לבקשה: חול, ביציאה מסיבוב', 'The surface goes into the ask too: sand, on corner exit'),
 # ── GOALS · wing ────────────────────────────────────────────────────────────
 ('"מרשימה" זה לא מספר. בורג ינחש.', '"Impressive" is not a number. Boreg will guess.'),
 ('יציבות — אבל באיזה חלק של הסיבוב?', 'Steadier — but in which part of the corner?'),
 ('הרגע שבו הקארט רוקד הוא רגע שאפשר לכוון אליו', 'The moment the kart dances is a moment you can aim at'),
 ('סיבוב מהיר בלי להרים גלגל — בקשה שאפשר לבדוק', 'A fast corner without lifting a wheel — an ask you can check'),
 # ── GOALS · chassis ─────────────────────────────────────────────────────────
 ('בורג ינחש מה זה "טובה".', 'Boreg will guess what "good" means.'),
 ('להסתובב מהר — בעיקול אחד או בכל המסלול?', 'Turn quicker — in one bend, or everywhere?'),
 ('שרשרת עיקולים היא מקום מדויק על המסלול', 'A chain of bends is an exact place on the track'),
 ('סוללת שפה בסיבוב: אירוע אחד, ברור לגמרי', 'A kerb in a corner: one event, perfectly clear'),
 # ── LIMITS · engine ─────────────────────────────────────────────────────────
 ('מותר לו הכול. גם דברים מוזרים.', 'Anything goes. Including weird things.'),
 ('הגבלה — אבל "אחר" הוא לא חלק בקארט', 'A limit — but "anything else" is not a part of the kart'),
 ('משקל זה מספר: אפשר לשקול ולראות מי צדק', 'Weight is a number: you can put it on a scale and see'),
 ('קל וגם יציב — שתי דרישות שמושכות הפוך', 'Light AND steady — two demands pulling opposite ways'),
 # ── LIMITS · tires ──────────────────────────────────────────────────────────
 ('מותר להם הכול. גם להימס.', 'Anything goes. Including melting.'),
 ('הגבלה — אבל "שאר הנסיעה" זה לא משהו שנמדד', 'A limit — but "the rest of the drive" is not a thing you measure'),
 ('סיבוב אחד זה מדד: אפשר פשוט לספור', 'One lap is a measure: you can simply count'),
 ('גם לא להישחק וגם לא ללכת בחום — קשה לשניהם', 'Neither wearing out nor going off when hot — both at once is hard'),
 # ── LIMITS · wing ───────────────────────────────────────────────────────────
 ('מותר לה הכול. גם להיות דלת.', 'Anything goes. Including becoming a door.'),
 ('הגבלה — אבל לא נאמר על איזה חלק להגן', 'A limit — but it never says which part to protect'),
 ('הישורת היא מקום, ושם רואים בדיוק מה זה עלה', 'The straight is a place, and it shows exactly what this cost'),
 ('בלי להאט וגם בלי משקל מאחור — הכנף בצרות', 'No slowing down and no weight at the back — the wing is in trouble'),
 # ── LIMITS · chassis ────────────────────────────────────────────────────────
 ('מותר לה הכול. גם להתפרק.', 'Anything goes. Including falling apart.'),
 ('הגבלה — אבל "משהו" זה לא בורג ולא ריתוך', 'A limit — but "something" is not a bolt and not a weld'),
 ('התפתלות בבלימה: אפשר להרגיש אותה, אז אפשר למדוד', 'Flex under braking: you can feel it, so you can measure it'),
 ('לא להתפתל וגם לא להוסיף גרם — או מתכת או קשיחות', 'No flexing and not one gram — it is metal or stiffness, pick'),
 # ── STYLES · engine ─────────────────────────────────────────────────────────
 ('בלי כיוון, בורג בוחר לבד. הוא אוהב סגול.', 'With no direction Boreg picks. He likes purple.'),
 ('צבע אחד כבר נותן לבורג תמונה בראש', 'One colour already gives Boreg a picture in his head'),
 ('מדבר, פסים ואבק — לסגנון יש כיוון', 'Desert, stripes and dust — the style has a direction'),
 ('בית יציקה: סגנון שמספר מאיפה המנוע הזה בא', 'A foundry: a style that says where this engine came from'),
 # ── STYLES · tires ──────────────────────────────────────────────────────────
 ('בלי כיוון — בורג יצבע אותם איך שבא לו', 'No direction — Boreg will colour them however he feels'),
 ('צבע דופן זה כבר פרט שרואים מהמסלול', 'A sidewall colour is already a detail you see from the track'),
 ('פס צהוב כמו בצמיגי מרוץ — יש דוגמה להסתכל עליה', 'A yellow stripe like race rubber — there is an example to look at'),
 ('אבק וחריצים: סגנון שמספר איפה הם כבר נסעו', 'Dust and grooves: a style that says where they have already been'),
 # ── STYLES · wing ───────────────────────────────────────────────────────────
 ('בלי כיוון, אז בורג בוחר. שוב סגול.', 'No direction, so Boreg chooses. Purple again.'),
 ('ניאון זה צבע שאי אפשר לפספס בחושך', 'Neon is a colour you cannot miss in the dark'),
 ('קו אור לאורך הקצה — סגנון עם פרט אחד מדויק', 'A light line along the edge — a style with one exact detail'),
 ('מספר ומדבקות: לכנף יש עכשיו סיפור משלה', 'A number and stickers: now the wing has a story of its own'),
 # ── STYLES · chassis ────────────────────────────────────────────────────────
 ('בלי כיוון. סגול, כרגיל.', 'No direction. Purple, as usual.'),
 ('זהב מט זה גם צבע וגם גימור', 'Matte gold is a colour and a finish at once'),
 ('מוסך ישן, טלאים וברגים — כיוון ברור לגמרי', 'Old workshop, patches and bolts — a completely clear direction'),
 ('פסגת הענן: סגנון שלקוח ממקום אמיתי במשחק', 'Cloud Peak: a style borrowed from a real place in this game'),
]
assert len(SUBS)==48
q = lambda s: "'" + s.replace("'", "\\'") + "'"
sub_line = re.compile(r"^(\s*)(?:'(?:[^'\\]|\\.)*'|\"[^\"]*\"), (?:'(?:[^'\\]|\\.)*'|\"[^\"]*\"),\s*$")
for n, i in enumerate(idx):
    j = i + 1
    m = sub_line.match(lines[j])
    assert m, (n, lines[j])
    he, en = SUBS[n]
    lines[j] = f"{m.group(1)}{q(he)}, {q(en)},"
open(p,'w').write('\n'.join(lines))
print('ok')
