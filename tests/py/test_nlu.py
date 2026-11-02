"""Python tests: tokeniser, data integrity, and the model quality gates in reports/metrics.json."""
import csv
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from cadvoice_nlu.generate import generate, parse_gold  # noqa: E402
from cadvoice_nlu.tokenizer import words  # noqa: E402

METRICS = json.loads((ROOT / "ml" / "reports" / "metrics.json").read_text())


def test_tokenizer_handles_units_and_hex():
    assert words("make it #FF8800 and 1.5 times") == ["make", "it", "#ff8800", "and", "1.5", "times"]
    assert words("set it to 4.7k × 2") == ["set", "it", "to", "4.7", "k", "x", "2"]


def test_templates_have_no_unfilled_placeholders():
    for r in generate("train", 3, 0) + generate("test", 3, 0):
        assert "{" not in r["text"] and "}" not in r["text"]


def test_bio_labels_are_well_formed():
    for r in generate("train", 2, 5)[:2000]:
        assert len(r["tokens"]) == len(r["labels"])
        prev = "O"
        for lab in r["labels"]:
            if lab.startswith("I-"):
                assert prev != "O" and prev[2:] == lab[2:], f"orphan I- tag in: {r['text']}"
            prev = lab


def test_gold_set_is_well_formed():
    gold = parse_gold()
    assert len(gold) >= 150
    for r in gold:
        assert r["intent"] and r["tokens"]


def test_lexicons_have_expected_columns():
    for f in (ROOT / "ml" / "data" / "lexicon").glob("*.csv"):
        with open(f, newline="", encoding="utf-8") as h:
            header = next(csv.reader(h))
        assert len(header) >= 2, f.name


def test_catalog_licences_are_recorded():
    cat = json.loads((ROOT / "public" / "models3d" / "catalog.json").read_text())["models"]
    assert len(cat) >= 14
    assert all(m["license"] in ("CC-BY-3.0", "CC-BY-4.0", "CC0-1.0") for m in cat)


# quality gates: the build fails if a retrain drops below these --------------
def test_gold_intent_accuracy_gate():
    assert METRICS["intent"]["gold"]["accuracy"] >= 0.95


def test_synthetic_intent_accuracy_gate():
    assert METRICS["intent"]["synthetic_test"]["accuracy"] >= 0.85


def test_gold_slot_f1_gate():
    assert METRICS["slots"]["gold_gold_intent"]["f1"] >= 0.90


def test_confidence_gate_rarely_rejects_valid_commands():
    t = METRICS["intent"]["threshold_used"]
    rate = METRICS["intent"]["threshold_sweep"][str(t)]["gold_false_reject"]
    assert rate <= 0.02


@pytest.mark.parametrize("name", ["intent.json", "slots.json", "flags.json"])
def test_browser_model_files_exist(name):
    assert (ROOT / "src" / "nlu" / "model" / name).stat().st_size > 100


def test_parity_fixture_exists():
    assert (ROOT / "tests" / "fixtures" / "parity.json").stat().st_size > 100
