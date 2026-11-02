"""Tokenizer shared (bit-for-bit) with src/nlu/tokenizer.js. Keep both in sync."""
import re

TOKEN_RE = re.compile(r"#[0-9a-f]{3,6}(?![0-9a-z])|\d+(?:\.\d+)?|[a-z]+(?:'[a-z]+)?|[°%]")
_REPL = [("×", "x"), ("µ", "u"), ("μ", "u"), ("ω", "ohm"), ("’", "'"), ("‘", "'")]


def normalize(text: str) -> str:
    t = text.lower()
    for a, b in _REPL:
        t = t.replace(a, b)
    return t


def tokenize(text: str):
    """Return (normalized_text, [(token, start, end), ...])."""
    t = normalize(text)
    return t, [(m.group(0), m.start(), m.end()) for m in TOKEN_RE.finditer(t)]


def words(text: str):
    return [tok for tok, _, _ in tokenize(text)[1]]
