"""Expands ml/data/templates.csv into labelled utterances (BIO over tokenizer tokens)."""
from __future__ import annotations

import csv
import random
import re
from pathlib import Path

from .lexicon import load
from .tokenizer import tokenize

DATA = Path(__file__).resolve().parent.parent / "data"
PLACEHOLDER = re.compile(r"\{([A-Z]+)(?::([a-z]+))?\}")

# placeholder name -> slot label used by the tagger
LABEL = {
    "OBJ": "OBJ", "TARGET": "OBJ", "REF": "OBJ", "COLOR": "COLOR", "MATERIAL": "MATERIAL",
    "WIDTH": "DIM", "HEIGHT": "DIM", "DEPTH": "DIM", "SIZE": "DIM", "DIM": "DIM",
    "DIAMETER": "DIM", "DISTANCE": "DIM", "COUNT": "COUNT", "REL": "REL", "AXIS": "AXIS",
    "AMOUNT": "AMOUNT", "DIRECTION": "DIRECTION", "ANGLE": "ANGLE", "PROP": "PROP",
    "VALUE": "VALUE", "NAME": "NAME", "FORMAT": "FORMAT", "MODE": "MODE", "VIEW": "VIEW",
}
NUMWORDS = "one two three four five six seven eight nine ten".split()
VALUE_RES = ["10k", "4.7k ohm", "220 ohms", "330 ohm", "1k", "47 ohm"]
VALUE_CAP = ["100 nf", "10 uf", "22 pf", "1 uf", "470 uf"]
NAMES = ["main controller", "status light", "power supply", "dining table", "work bench", "reading lamp"]
ROT_DIRS = ["clockwise", "counterclockwise", "anticlockwise"]
PLAIN_DIRS = ["left", "right", "forward", "back", "up", "down"]


def _load_vocab():
    L = load()
    objs = [o["synonyms"].split("|") for o in L["objects"]]
    colors = [c["name"] for c in L["colors"] if c["name"] not in ("grey", "light grey")]
    mats = [m["surface"] for m in L["materials"] if m["canonical"] not in ("pcb",)]
    rels = {}
    for r in L["relations"]:
        rels.setdefault(r["canonical"], []).append(r["surface"])
    views = [v["surface"] for v in L["views"]]
    formats = [f["surface"] for f in L["formats"]]
    modes = [m["surface"] for m in L["modes"]]
    return objs, colors, mats, rels, views, formats, modes


def _dim(rng):
    unit = rng.choice(["cm", "cm", "mm", "m", "inches"])
    n = rng.choice([rng.randint(5, 300), rng.randint(1, 9), round(rng.uniform(0.5, 3), 1)])
    return f"{n} {unit}" if unit != "inches" else f"{n} inches", None


def fill(template: str, rng: random.Random, vocab) -> tuple[str, list[tuple[int, int, str]]]:
    objs, colors, mats, rels, views, formats, modes = vocab
    out, spans, pos = [], [], 0
    for m in PLACEHOLDER.finditer(template):
        out.append(template[pos:m.start()])
        pos = m.end()
        name, mod = m.group(1), m.group(2)
        start = sum(len(x) for x in out)
        text = _value(name, mod, rng, objs, colors, mats, rels, views, formats, modes)
        out.append(text)
        spans.append((start, start + len(text), LABEL[name]))
    out.append(template[pos:])
    return "".join(out), spans


def _value(name, mod, rng, objs, colors, mats, rels, views, formats, modes):
    if name in ("OBJ", "TARGET", "REF"):
        if mod == "ecad":
            pool = objs[13:]  # ecad rows
        elif mod in ("board",):
            pool = [["pcb"], ["arduino uno"], ["arduino nano"], ["pcb"]]
        elif mod == "led":
            return rng.choice(["led", "led", "led"])
        elif mod == "resistor":
            return rng.choice(["resistor", "resistor"])
        elif mod == "capacitor":
            return rng.choice(["capacitor", "cap"])
        elif mod == "round":
            pool = [["sphere"], ["cylinder"], ["ball"], ["pipe"]]
        elif mod == "plural":
            w = rng.choice(objs)[0]
            return w + rng.choice(["s", "s", "es"]) if not w.endswith("s") else w
        else:
            pool = objs
        if name == "REF" and mod is None and rng.random() < 0.3:
            return rng.choice(["table", "desk", "board", "pcb", "arduino", "wall", "floor"])
        if name == "REF" and mod == "floor":
            return "floor"
        return rng.choice(rng.choice(pool))
    if name == "COLOR":
        return rng.choice(colors)
    if name == "MATERIAL":
        return rng.choice(mats)
    if name == "WIDTH":
        d, _ = _dim(rng)
        return f"{d} {rng.choice(['wide', 'wide', 'long'])}"
    if name == "HEIGHT":
        d, _ = _dim(rng)
        return f"{d} {rng.choice(['tall', 'high'])}"
    if name == "DEPTH":
        d, _ = _dim(rng)
        return f"{d} {rng.choice(['deep', 'thick'])}"
    if name == "DIAMETER":
        d, _ = _dim(rng)
        return rng.choice([f"{d} in diameter", f"diameter {d}", f"{d} diameter"])
    if name == "SIZE":
        a, b, c = (rng.randint(10, 200) for _ in range(3))
        u = rng.choice(["cm", "mm"])
        return rng.choice([f"{a} x {b} x {c} {u}", f"{a} by {b} {u}", f"{a} by {b} by {c} {u}"])
    if name == "DIM":
        return _dim(rng)[0]
    if name == "DISTANCE":
        return f"{rng.randint(1, 100)} {rng.choice(['cm', 'mm', 'meter', 'centimeters'])}"
    if name == "COUNT":
        return rng.choice(NUMWORDS + [str(rng.randint(2, 9))])
    if name == "REL":
        key = mod if mod else rng.choice(list(rels))
        key = {"beside": "beside", "around": "around", "on": "on"}.get(key, key)
        return rng.choice(rels.get(key, ["next to"]))
    if name == "AXIS":
        if mod == "noun":
            return rng.choice(["width", "height", "depth", "length", "diameter", "thickness"])
        if mod == "round":
            return rng.choice(["diameter", "radius"])
        if mod == "adj":
            return rng.choice(["bigger", "smaller", "wider", "taller"])
        return rng.choice(["bigger", "smaller", "taller", "shorter", "wider", "larger", "longer", "thicker"])
    if name == "AMOUNT":
        if mod == "abs":
            return f"{rng.randint(5, 80)} {rng.choice(['cm', 'mm'])}"
        if mod == "factor":
            return rng.choice(["twice", "1.5 times", "half", "a third"])
        if mod == "small":
            return rng.choice(["a bit", "slightly", "a little", "a lot"])
        if mod == "verb":
            return rng.choice(["double", "halve", "triple"])
        return rng.choice(["10 percent", "20 percent", "50 percent", "30 cm", "a bit", "twice"])
    if name == "DIRECTION":
        return rng.choice(ROT_DIRS if mod == "rot" else PLAIN_DIRS)
    if name == "ANGLE":
        return f"{rng.choice([15, 30, 45, 60, 90, 120, 135, 180])} degrees"
    if name == "PROP":
        return rng.choice(["screen", "lid", "screen angle", "display", "hinge"])
    if name == "VALUE":
        if mod == "res":
            return rng.choice(VALUE_RES)
        if mod == "cap":
            return rng.choice(VALUE_CAP)
        return rng.choice(VALUE_RES + VALUE_CAP)
    if name == "NAME":
        return rng.choice(NAMES)
    if name == "FORMAT":
        return rng.choice(formats)
    if name == "MODE":
        return rng.choice(modes)
    if name == "VIEW":
        if mod == "dir":
            return rng.choice(["top", "front", "left", "right", "back", "isometric"])
        if mod == "zoom":
            return rng.choice(["zoom in", "zoom out"])
        return rng.choice(["reset the view", "fit all", "zoom to fit", "zoom in", "zoom out", "top view"])
    raise KeyError(name)


def bio_tokens(text: str, spans):
    """Tokenize text and give each token a BIO label from character-span overlap."""
    _, toks = tokenize(text)
    labels, prev_span = [], None
    for tok, s, e in toks:
        hit = None
        for idx, (a, b, L) in enumerate(spans):
            if s >= a and e <= b:
                hit = (idx, L)
                break
        if hit is None:
            labels.append("O")
            prev_span = None
        else:
            idx, L = hit
            labels.append(("I-" if prev_span == idx else "B-") + L)
            prev_span = idx
    return [t for t, _, _ in toks], labels


def read_templates(split: str):
    with open(DATA / "templates.csv", newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r["split"] == split]


def generate(split: str, per_template: int, seed: int):
    rng = random.Random(seed)
    vocab = _load_vocab()
    rows = []
    for r in read_templates(split):
        for _ in range(per_template):
            text, spans = fill(r["template"], rng, vocab)
            toks, labels = bio_tokens(text, spans)
            rows.append({"text": text, "intent": r["intent"], "tokens": toks, "labels": labels})
    return rows


def load_oos():
    with open(DATA / "oos.csv", newline="", encoding="utf-8") as f:
        return [r["text"] for r in csv.DictReader(f)]


def parse_gold(path: Path | None = None):
    """gold.csv rows: intent,annotated  with  [span|LABEL] markup for slots."""
    path = path or (DATA / "gold.csv")
    rows = []
    pat = re.compile(r"\[([^\]|]+)\|([A-Z]+)\]")
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ann = r["annotated"]
            plain, spans, pos, out = "", [], 0, ""
            for m in pat.finditer(ann):
                out += ann[pos:m.start()]
                s = len(out)
                out += m.group(1)
                spans.append((s, len(out), LABEL.get(m.group(2), m.group(2))))
                pos = m.end()
            out += ann[pos:]
            toks, labels = bio_tokens(out, spans)
            rows.append({"text": out, "intent": r["intent"], "tokens": toks, "labels": labels})
    return rows
