#!/usr/bin/env python3
"""Train + evaluate the CADVoice NLU models.

    python ml/train.py              # trains, writes ml/artifacts/*, ml/reports/*, src/nlu/model/*, tests/fixtures/parity.json

Models
  * intent : multinomial logistic regression over lexical/gazetteer features
             (+ an explicit "oos" class learned from ml/data/oos.csv)
  * slots  : linear-chain CRF (BIO) over the same token features, conditioned on intent
Evaluation
  * synthetic held-out templates (split=test, unseen phrasings) — synthetic
  * gold.csv (hand-written, never generated from templates) — the honest number
"""
from __future__ import annotations

import json
import random
import sys
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
import sklearn_crfsuite
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ml"))

from cadvoice_nlu.features import intent_features, slot_features  # noqa: E402
from cadvoice_nlu.generate import generate, load_oos, parse_gold  # noqa: E402
from cadvoice_nlu.lexicon import word_flags  # noqa: E402

ART = ROOT / "ml" / "artifacts"
REP = ROOT / "ml" / "reports"
WEB = ROOT / "src" / "nlu" / "model"
SEED = 13
THRESHOLD = 0.5  # app-side confidence gate, chosen from the sweep in metrics.json
CLUSTERS: dict = {}  # word clusters intentionally empty; kept for feature parity


def oos_split(rng: random.Random):
    lines = load_oos()
    rng.shuffle(lines)
    cut = int(len(lines) * 0.65)
    return lines[:cut], lines[cut:]


def oos_row(text):
    from cadvoice_nlu.tokenizer import words

    toks = words(text)
    return {"text": text, "intent": "oos", "tokens": toks, "labels": ["O"] * len(toks)}


def span_set(labels):
    """Return set of (start, end, type) for BIO sequences."""
    spans, cur = set(), None
    for i, lab in enumerate(labels + ["O"]):
        if lab == "O" or lab.startswith("B-") or (cur and lab[2:] != cur[2]):
            if cur:
                spans.add((cur[0], i, cur[2]))
                cur = None
            if lab != "O":
                cur = (i, None, lab[2:])
    return spans


def entity_f1(gold_seqs, pred_seqs):
    tp = fp = fn = 0
    for g, p in zip(gold_seqs, pred_seqs):
        gs, ps = span_set(g), span_set(p)
        tp += len(gs & ps)
        fp += len(ps - gs)
        fn += len(gs - ps)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"precision": round(prec, 4), "recall": round(rec, 4), "f1": round(f1, 4)}


def build_intent_xy(rows, dv=None):
    X = [intent_features(r["tokens"], CLUSTERS) for r in rows]
    if dv is None:
        dv = DictVectorizer()
        dv.fit(X)
    return dv, dv.transform(X), [r["intent"] for r in rows]


def slot_xseq(rows, intent_of):
    """intent_of(row) -> intent string; called once per utterance."""
    flags = word_flags()
    out = []
    for r in rows:
        it = intent_of(r)
        out.append([slot_features(r["tokens"], i, it, CLUSTERS, flags) for i in range(len(r["tokens"]))])
    return out


def main():
    rng = random.Random(SEED)
    oos_train, oos_eval = oos_split(rng)

    train = generate("train", per_template=30, seed=SEED)
    train += [oos_row(t) for t in oos_train for _ in range(25)]  # oos is a small class
    synth_test = generate("test", per_template=20, seed=SEED + 1)
    gold = parse_gold()
    oos_eval_rows = [oos_row(t) for t in oos_eval]

    print(f"train={len(train)}  synthetic_test={len(synth_test)}  gold={len(gold)}  oos_eval={len(oos_eval_rows)}")

    # ---- intent --------------------------------------------------------------
    dv, Xtr, ytr = build_intent_xy(train)
    clf = LogisticRegression(C=8.0, max_iter=3000, class_weight="balanced")
    clf.fit(Xtr, ytr)
    print(f"intent features: {len(dv.feature_names_)}  classes: {len(clf.classes_)}")

    def predict_intent(rows):
        _, X, _ = build_intent_xy(rows, dv)
        proba = clf.predict_proba(X)
        idx = proba.argmax(1)
        return [clf.classes_[i] for i in idx], proba.max(1)

    res = {"intent": {}, "slots": {}, "data": {"train": len(train), "synthetic_test": len(synth_test),
                                               "gold": len(gold), "oos_eval": len(oos_eval_rows)}}
    for name, rows in [("synthetic_test", synth_test), ("gold", gold)]:
        pred, _ = predict_intent(rows)
        y = [r["intent"] for r in rows]
        res["intent"][name] = {
            "accuracy": round(accuracy_score(y, pred), 4),
            "macro_f1": round(f1_score(y, pred, average="macro"), 4),
        }
        (REP / f"intent_report_{name}.txt").write_text(classification_report(y, pred, zero_division=0))

    # out-of-scope: oos should be predicted as oos with the default threshold
    pred_oos, conf_oos = predict_intent(oos_eval_rows)
    res["intent"]["oos_rejection"] = {
        "rate": round(float(np.mean([p == "oos" for p in pred_oos])), 4), "n": len(oos_eval_rows)
    }
    # threshold for "unknown": if top prob < t, treat as oos (used by the app)
    pred_gold, conf_gold = predict_intent(gold)
    res["intent"]["gold_confidence_p10"] = round(float(np.percentile(conf_gold, 10)), 4)

    # confidence gate used by the app: below THRESHOLD -> "unknown" (rejected)
    pred_syn, conf_syn = predict_intent(synth_test)
    sweep = {}
    for t in (0.3, 0.4, 0.5, 0.6, 0.7):
        rej_oos = float(np.mean([c < t or p == "oos" for p, c in zip(pred_oos, conf_oos)]))
        false_rej_gold = float(np.mean([c < t for c in conf_gold]))
        false_rej_syn = float(np.mean([c < t for c in conf_syn]))
        sweep[str(t)] = {"oos_rejected": round(rej_oos, 4), "gold_false_reject": round(false_rej_gold, 4),
                         "synthetic_false_reject": round(false_rej_syn, 4)}
    res["intent"]["threshold_sweep"] = sweep
    res["intent"]["threshold_used"] = THRESHOLD
    res["intent"]["oos_rejection_with_threshold"] = sweep[str(THRESHOLD)]["oos_rejected"]

    # ---- slots (CRF) ----------------------------------------------------------
    crf = sklearn_crfsuite.CRF(algorithm="lbfgs", c1=0.05, c2=0.05, max_iterations=200, all_possible_transitions=True)
    Xs = slot_xseq(train, lambda r: r["intent"])
    ys = [r["labels"] for r in train]
    crf.fit(Xs, ys)

    # gold slots with gold intent (isolates the tagger) and with predicted intent (end-to-end)
    gold_pred_intent, _ = predict_intent(gold)
    g_gold = crf.predict(slot_xseq(gold, lambda r: r["intent"]))
    pi = iter(gold_pred_intent)
    g_pipe = crf.predict(slot_xseq(gold, lambda r: next(pi)))
    res["slots"]["gold_gold_intent"] = entity_f1([r["labels"] for r in gold], g_gold)
    res["slots"]["gold_predicted_intent"] = entity_f1([r["labels"] for r in gold], g_pipe)
    res["slots"]["gold_token_accuracy"] = round(
        float(np.mean([a == b for r, p in zip(gold, g_gold) for a, b in zip(r["labels"], p)])), 4
    )
    st = crf.predict(slot_xseq(synth_test, lambda r: r["intent"]))
    res["slots"]["synthetic_test"] = entity_f1([r["labels"] for r in synth_test], st)

    REP.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)

    joblib.dump({"dv": dv, "clf": clf}, ART / "intent.joblib")
    joblib.dump(crf, ART / "slots_crf.joblib")
    (REP / "metrics.json").write_text(json.dumps(res, indent=2) + "\n")

    # ---- export for the browser (exact same features in JS) -------------------
    export_web(dv, clf, crf)
    print(json.dumps(res, indent=2))


def export_web(dv, clf, crf):
    # intent: W[feature] = coef per class; only features the model learned from
    coef = clf.coef_  # classes x features
    names = dv.feature_names_
    W = {}
    for j, name in enumerate(names):
        col = coef[:, j]
        if np.any(np.abs(col) > 0.02):  # prune near-zero weights to keep the web bundle small
            W[name] = [round(float(v), 3) for v in col]
    intent = {"classes": list(map(str, clf.classes_)), "intercept": [round(float(v), 5) for v in clf.intercept_],
              "threshold": THRESHOLD, "weights": W}
    (WEB / "intent.json").write_text(json.dumps(intent, separators=(",", ":")))
    # NB: pruning means the web model can differ slightly from the joblib model; see metrics.json note

    state = {}
    for (attr, label), w in crf.state_features_.items():
        if abs(w) < 0.02:
            continue
        state.setdefault(attr, {})[label] = round(float(w), 5)
    trans = {}
    for (a, b), w in crf.transition_features_.items():
        trans.setdefault(a, {})[b] = round(float(w), 5)
    slots = {"labels": sorted({l for (_, l) in crf.state_features_} | {a for (a, _) in crf.transition_features_}), "state": state, "trans": trans}
    (WEB / "slots.json").write_text(json.dumps(slots, separators=(",", ":")))

    flags = word_flags()
    (WEB / "flags.json").write_text(json.dumps(flags, separators=(",", ":")))
    fixtures = ROOT / "tests" / "fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / "parity.json").write_text(json.dumps(parity_cases(dv, clf, crf), indent=1))


def parity_cases(dv, clf, crf):
    """Fixed inputs with Python feature output + Python model predictions (unpruned joblib
    models), used by tests/js/parity.test.mjs (written to tests/fixtures/) to confirm the JS port matches."""
    from cadvoice_nlu.tokenizer import words

    cases = []
    texts = [
        "make the table 120 cm wide", "add a red chair next to the lamp", "export as stl",
        "clear the scene", "undo that", "rotate the sofa 90 degrees", "set the resistor to 220 ohms",
        "what is in the scene", "xyzzy plugh frobnicate",
    ] + [r["text"] for r in parse_gold()[:40]]
    for text in texts:
        toks = words(text)
        X = dv.transform([intent_features(toks, CLUSTERS)])
        pred = str(clf.predict(X)[0])
        proba = clf.predict_proba(X)[0]
        slot_pred = list(crf.predict([[slot_features(toks, i, pred, CLUSTERS) for i in range(len(toks))]])[0]) if toks else []
        cases.append({
            "text": text,
            "tokens": toks,
            "intent_pred": pred,
            "intent_confidence": round(float(proba.max()), 6),
            "slot_pred": [str(x) for x in slot_pred],
            "intent_features": intent_features(toks, CLUSTERS),
            "slot_features": [slot_features(toks, i, pred, CLUSTERS) for i in range(len(toks))],
        })
    return cases


if __name__ == "__main__":
    main()
