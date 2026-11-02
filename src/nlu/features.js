// Feature extraction — must match ml/cadvoice_nlu/features.py exactly.
const DIGIT = /^\d+(?:\.\d+)?$/;

export function shape(w) {
  if (w.startsWith("#")) return "hex";
  if (DIGIT.test(w)) return w.includes(".") ? "dec" : "int";
  if (w === "°" || w === "%") return "sym";
  return "alpha";
}

export function intentFeatures(toks, flags) {
  const n = toks.length;
  const f = {};
  for (let i = 0; i < n; i++) {
    const w = toks[i];
    f[`w=${w}`] = 1;
    if (i + 1 < n) f[`b=${w}|${toks[i + 1]}`] = 1;
    if (i + 2 < n) f[`t=${w}|${toks[i + 1]}|${toks[i + 2]}`] = 1;
    for (const fl of flags[w] || []) f[`f=${fl}`] = 1;
    f["c=unk"] = 1;
    if (shape(w) === "int" || shape(w) === "dec") f.hasnum = 1;
  }
  if (n) {
    f[`first=${toks[0]}`] = 1;
    if (n > 1) f[`first2=${toks[0]}|${toks[1]}`] = 1;
    f[`last=${toks[n - 1]}`] = 1;
  }
  f[`len=${Math.min(n, 12)}`] = 1;
  f.b = 1;
  return f;
}

export function slotFeatures(toks, i, intent, flags) {
  const n = toks.length;
  const f = { b: 1 };
  const w = toks[i];
  const at = (k) => {
    const j = i + k;
    return j >= 0 && j < n ? toks[j] : j < 0 ? "<s>" : "</s>";
  };
  for (const k of [-2, -1, 0, 1, 2]) {
    const t = at(k);
    f[`w${k}=${t}`] = 1;
    if (i + k >= 0 && i + k < n) {
      for (const fl of flags[t] || []) f[`f${k}=${fl}`] = 1;
      f[`c${k}=unk`] = 1;
      f[`s${k}=${shape(t)}`] = 1;
    }
  }
  f[`w-1|w0=${at(-1)}|${w}`] = 1;
  f[`w0|w+1=${w}|${at(1)}`] = 1;
  f[`w-2|w-1=${at(-2)}|${at(-1)}`] = 1;
  f[`w+1|w+2=${at(1)}|${at(2)}`] = 1;
  if (shape(w) === "alpha") {
    f[`p3=${w.slice(0, 3)}`] = 1;
    f[`s3=${w.slice(-3)}`] = 1;
    f[`s2=${w.slice(-2)}`] = 1;
  }
  if (i === 0) f.first = 1;
  if (i === n - 1) f.last = 1;
  f[`I=${intent}`] = 1;
  f[`I|w0=${intent}|${w}`] = 1;
  for (const fl of flags[w] || []) f[`I|f0=${intent}|${fl}`] = 1;
  f[`I|f-1=${intent}|${(flags[at(-1)] || []).join(",")}`] = 1;
  return f;
}
