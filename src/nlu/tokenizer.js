// Tokenizer — must match ml/cadvoice_nlu/tokenizer.py exactly (checked by tests/js/parity.test.mjs).
const TOKEN_RE = /#[0-9a-f]{3,6}(?![0-9a-z])|\d+(?:\.\d+)?|[a-z]+(?:'[a-z]+)?|[°%]/g;
const REPL = [["×", "x"], ["µ", "u"], ["μ", "u"], ["ω", "ohm"], ["’", "'"], ["‘", "'"]];

export function normalize(text) {
  let t = text.toLowerCase();
  for (const [a, b] of REPL) t = t.split(a).join(b);
  return t;
}

export function tokenize(text) {
  const t = normalize(text);
  const out = [];
  for (const m of t.matchAll(TOKEN_RE)) out.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  return { text: t, tokens: out };
}

export function words(text) {
  return tokenize(text).tokens.map((x) => x.token);
}
