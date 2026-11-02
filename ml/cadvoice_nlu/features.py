"""Feature extraction. MUST stay identical to src/nlu/features.js (parity-tested)."""
import re

from .lexicon import word_flags

_DIGIT = re.compile(r"^\d+(?:\.\d+)?$")


def shape(w: str) -> str:
    if w.startswith("#"):
        return "hex"
    if _DIGIT.match(w):
        return "dec" if "." in w else "int"
    if w in ("°", "%"):
        return "sym"
    return "alpha"


def _cluster(w, clusters):
    return clusters.get(w, "unk")


def slot_features(toks, i, intent, clusters, flags=None):
    """toks: list of token strings. Returns {feature: 1.0}."""
    flags = flags if flags is not None else word_flags()
    n = len(toks)
    f = {"b": 1.0}
    w = toks[i]

    def at(k):
        j = i + k
        return toks[j] if 0 <= j < n else ("<s>" if j < 0 else "</s>")

    for k in (-2, -1, 0, 1, 2):
        t = at(k)
        f[f"w{k}={t}"] = 1.0
        if 0 <= i + k < n:
            for fl in flags.get(t, ()):
                f[f"f{k}={fl}"] = 1.0
            f[f"c{k}={_cluster(t, clusters)}"] = 1.0
            f[f"s{k}={shape(t)}"] = 1.0
    f[f"w-1|w0={at(-1)}|{w}"] = 1.0
    f[f"w0|w+1={w}|{at(1)}"] = 1.0
    f[f"w-2|w-1={at(-2)}|{at(-1)}"] = 1.0
    f[f"w+1|w+2={at(1)}|{at(2)}"] = 1.0
    if shape(w) == "alpha":
        f[f"p3={w[:3]}"] = 1.0
        f[f"s3={w[-3:]}"] = 1.0
        f[f"s2={w[-2:]}"] = 1.0
    if i == 0:
        f["first"] = 1.0
    if i == n - 1:
        f["last"] = 1.0
    f[f"I={intent}"] = 1.0
    f[f"I|w0={intent}|{w}"] = 1.0
    for fl in flags.get(w, ()):
        f[f"I|f0={intent}|{fl}"] = 1.0
    f[f"I|f-1={intent}|{','.join(flags.get(at(-1), ()))}"] = 1.0
    return f


def intent_features(toks, clusters, flags=None):
    flags = flags if flags is not None else word_flags()
    n = len(toks)
    f = {}
    for i, w in enumerate(toks):
        f[f"w={w}"] = 1.0
        if i + 1 < n:
            f[f"b={w}|{toks[i+1]}"] = 1.0
        if i + 2 < n:
            f[f"t={w}|{toks[i+1]}|{toks[i+2]}"] = 1.0
        for fl in flags.get(w, ()):
            f[f"f={fl}"] = 1.0
        f[f"c={_cluster(w, clusters)}"] = 1.0
        if shape(w) in ("int", "dec"):
            f["hasnum"] = 1.0
    if n:
        f[f"first={toks[0]}"] = 1.0
        if n > 1:
            f[f"first2={toks[0]}|{toks[1]}"] = 1.0
        f[f"last={toks[-1]}"] = 1.0
    f[f"len={min(n, 12)}"] = 1.0
    f["b"] = 1.0
    return f
