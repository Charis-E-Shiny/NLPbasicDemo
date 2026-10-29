#!/usr/bin/env python3
"""Train the lightweight CADVoice intent model using only the Python standard library."""

import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "nlp_commands.csv"
OUTPUT = ROOT / "src" / "intent-model.json"


def features(text):
    words = re.findall(r"[a-z0-9]+", text.lower())
    return words + [f"{left}_{right}" for left, right in zip(words, words[1:])]


def main():
    with DATA.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))
    train = [row for row in rows if row["split"] == "train"]
    test = [row for row in rows if row["split"] == "test"]
    if not train or not test:
        raise ValueError("The CSV must include non-empty train and test splits.")

    documents = Counter(row["intent"] for row in train)
    token_counts = defaultdict(Counter)
    vocabulary = set()
    for row in train:
        current = set(features(row["text"]))
        vocabulary.update(current)
        token_counts[row["intent"]].update(current)

    classes = {}
    total_documents = len(train)
    class_names = sorted(documents)
    for intent in class_names:
        counts = token_counts[intent]
        denominator = sum(counts.values()) + len(vocabulary) + 1
        classes[intent] = {
            "prior": (documents[intent] + 1) / (total_documents + len(class_names)),
            "unknown": 1 / denominator,
            "features": {
                feature: (count + 1) / denominator
                for feature, count in counts.items()
            },
        }

    correct = 0
    for row in test:
        words = set(features(row["text"]))
        scores = {
            intent: math.log(model["prior"])
            + sum(math.log(model["features"].get(word, model["unknown"])) for word in words)
            for intent, model in classes.items()
        }
        correct += max(scores, key=scores.get) == row["intent"]
    accuracy = correct / len(test)

    OUTPUT.write_text(
        json.dumps({"version": 1, "classes": classes}, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Trained {len(class_names)} intents from {len(train)} examples.")
    print(f"Held-out accuracy: {correct}/{len(test)} ({accuracy:.1%})")
    print(f"Model: {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
