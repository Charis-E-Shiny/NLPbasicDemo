// Intent classifier (softmax over linear weights) and linear-chain CRF decoder (Viterbi).
import { intentFeatures, slotFeatures } from "./features.js";
import { tokenize } from "./tokenizer.js";

export function classifyIntent(model, toks, flags) {
  const feats = intentFeatures(toks, flags);
  const K = model.classes.length;
  const score = model.intercept.slice();
  for (const name in feats) {
    const w = model.weights[name];
    if (!w) continue;
    for (let k = 0; k < K; k++) score[k] += w[k];
  }
  const max = Math.max(...score);
  const exps = score.map((s) => Math.exp(s - max));
  const Z = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / Z);
  let best = 0;
  for (let k = 1; k < K; k++) if (probs[k] > probs[best]) best = k;
  const threshold = model.threshold ?? 0.5;
  const label = probs[best] < threshold ? "unknown" : model.classes[best];
  return { intent: label, rawIntent: model.classes[best], confidence: probs[best] };
}

export function decodeSlots(crf, toks, intent, flags) {
  const labels = crf.labels;
  const L = labels.length;
  const n = toks.length;
  if (n === 0) return [];
  const emit = (i) => {
    const feats = slotFeatures(toks, i, intent, flags);
    const s = new Float64Array(L);
    for (const name in feats) {
      const row = crf.state[name];
      if (!row) continue;
      for (let l = 0; l < L; l++) s[l] += row[labels[l]] || 0;
    }
    return s;
  };
  const trans = (a, b) => (crf.trans[a] && crf.trans[a][b]) || 0;
  let prev = emit(0);
  const back = [];
  for (let i = 1; i < n; i++) {
    const cur = emit(i);
    const next = new Float64Array(L);
    const bp = new Int32Array(L);
    for (let b = 0; b < L; b++) {
      let best = -Infinity, arg = 0;
      for (let a = 0; a < L; a++) {
        const v = prev[a] + trans(labels[a], labels[b]);
        if (v > best) { best = v; arg = a; }
      }
      next[b] = best + cur[b];
      bp[b] = arg;
    }
    back.push(bp);
    prev = next;
  }
  let last = 0;
  for (let l = 1; l < L; l++) if (prev[l] > prev[last]) last = l;
  const path = [last];
  for (let i = back.length - 1; i >= 0; i--) path.unshift(back[i][path[0]]);
  return path.map((l) => labels[l]);
}

// Turn BIO labels into [{type, text, start, end}] using the original string.
export function bioToEntities(text, tokens, labels) {
  const norm = tokenize(text).text;
  const ents = [];
  let cur = null;
  tokens.forEach((tok, i) => {
    const lab = labels[i];
    const { start, end } = tok;
    if (lab === "O") { if (cur) ents.push(cur); cur = null; return; }
    const [bi, type] = [lab[0], lab.slice(2)];
    if (bi === "B" || !cur || cur.type !== type) {
      if (cur) ents.push(cur);
      cur = { type, text: norm.slice(start, end), start, end };
    } else {
      cur.end = end;
      cur.text = norm.slice(cur.start, end);
    }
  });
  if (cur) ents.push(cur);
  return ents;
}
