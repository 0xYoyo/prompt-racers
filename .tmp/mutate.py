import sys, re
p='src/ui/learn.js'
s=open(p).read()
m=sys.argv[1]
if m=='M1':
    old="""        h('div.lr-hero', null,"""
    new="""        h('input', { type: 'text', placeholder: 'השם שלך' }),
        h('div.lr-hero', null,"""
elif m=='M2':
    old="""  return typeof id === 'string' && CERT_TITLE_IDS.includes(id) ? id : null;"""
    new="""  return typeof id === 'string' && id ? id : null;"""
elif m=='M3':
    old="""  return Array.isArray(raw) ? raw.filter(id => BADGE_IDS.includes(id)) : [];"""
    new="""  void raw; return ['quiz-first'];"""
elif m=='M4':
    old="""  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  /* ---- head ---- */
  let y = 118;"""
    new="""  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (1) return;

  /* ---- head ---- */
  let y = 118;"""
elif m=='M5':
    old="""  try {
    const url = URL.createObjectURL(blob);"""
    new="""  if (1) return { ok: true, size: blob.size };
  try {
    const url = URL.createObjectURL(blob);"""
elif m=='M6':
    old="""  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);"""
    new="""  const src = 'https://example.com/icon.svg?x=' + encodeURIComponent(markup).slice(0, 20);"""
elif m=='M7':
    old=""".lr-cert-acts .btn{font-size:17px;padding:13px 26px;min-height:48px;"""
    new=""".lr-cert-acts .btn{font-size:13px;padding:8px 18px;min-height:0;"""
else:
    sys.exit('unknown')
assert old in s, m
open(p,'w').write(s.replace(old,new,1))
print('mutated', m)
