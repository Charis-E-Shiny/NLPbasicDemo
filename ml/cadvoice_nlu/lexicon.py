"""Lexicons (gazetteers) loaded from ml/data/lexicon/*.csv."""
import csv
from functools import lru_cache
from pathlib import Path

from .tokenizer import words

DATA = Path(__file__).resolve().parent.parent / "data"
LEX = DATA / "lexicon"

NUM_WORDS = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand point half "
    "quarter couple"
).split()
AXIS_WORDS = (
    "width height depth length thickness diameter radius size wide tall high deep long thick thin big large small "
    "bigger larger smaller taller shorter wider narrower longer deeper thicker thinner higher lower"
).split()
DIR_WORDS = (
    "left right up down forward forwards backward backwards back front clockwise counterclockwise anticlockwise "
    "counter anti upward downward"
).split()
PROP_WORDS = "screen lid display angle hinge opening tilt".split()
AMOUNT_WORDS = (
    "twice double triple quadruple halve half times percent bit little slightly lot much significantly "
    "somewhat"
).split()
DET_WORDS = "the a an this that these those my its it".split()
COUNT_PHRASE = "another more copies copy".split()
VERB_WORDS = (
    "make create add put place move rotate turn delete remove set change paint color colour select duplicate copy "
    "clone rename export save open close connect wire link scale resize enlarge shrink show draw build insert "
    "generate spawn shift slide push lift raise lower undo redo clear reset zoom switch go use apply join "
    "increase decrease reduce grow stretch extend center position erase trash discard pick choose highlight "
    "call name label tilt adjust"
).split()


def _read(name):
    with open(LEX / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


@lru_cache(maxsize=1)
def load():
    objects = _read("objects.csv")
    colors = _read("colors.csv")
    materials = _read("materials.csv")
    relations = _read("relations.csv")
    units = _read("units.csv")
    formats = _read("formats.csv")
    views = _read("views.csv")
    modes = _read("modes.csv")
    return dict(
        objects=objects, colors=colors, materials=materials, relations=relations,
        units=units, formats=formats, views=views, modes=modes,
    )


def _wordset(phrases):
    out = set()
    for p in phrases:
        out.update(words(p))
    return out


@lru_cache(maxsize=1)
def word_flags():
    """word -> sorted list of gazetteer flags (used as CRF / intent features)."""
    L = load()
    groups = {
        "OBJ": _wordset(s for o in L["objects"] for s in o["synonyms"].split("|")),
        "COLOR": _wordset(c["name"] for c in L["colors"]) | {"grey"},
        "MAT": _wordset(m["surface"] for m in L["materials"]),
        "UNIT": _wordset(u["surface"] for u in L["units"]),
        "REL": _wordset(r["surface"] for r in L["relations"]),
        "FMT": _wordset(f["surface"] for f in L["formats"]),
        "VIEW": _wordset(v["surface"] for v in L["views"]),
        "MODE": _wordset(m["surface"] for m in L["modes"]),
        "NUMW": set(NUM_WORDS),
        "AXIS": set(AXIS_WORDS),
        "DIR": set(DIR_WORDS),
        "PROP": set(PROP_WORDS),
        "AMT": set(AMOUNT_WORDS),
        "DET": set(DET_WORDS),
        "VERB": set(VERB_WORDS),
    }
    # words that only occur inside multi-word phrases are poor gazetteer cues
    groups["OBJ"] -= {"emitting", "work"}
    flags = {}
    for g, ws in groups.items():
        for w in ws:
            flags.setdefault(w, []).append(g)
    return {w: sorted(v) for w, v in flags.items()}
