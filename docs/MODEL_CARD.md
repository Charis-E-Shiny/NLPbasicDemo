# Model card: CADVoice NLU

## What it is
Two small models that run in the browser (bundled into the app, no network needed):
1. **Intent classifier**: multinomial logistic regression over lexical and gazetteer features. 24 classes: 23 CAD/ECAD commands plus `oos` (not a command). Predictions below a confidence of 0.5 are treated as unknown.
2. **Slot tagger**: linear-chain CRF with BIO tags for 17 slot types (OBJ, COLOR, MATERIAL, DIM, REL, AXIS, AMOUNT, DIRECTION, ANGLE, COUNT, PROP, VALUE, NAME, FORMAT, MODE, VIEW, and the relation labels).

Both are classical models trained from scratch on project data. No pretrained language model is used, so the models are small (about 2 MB) and fast, but they only cover the phrasings in the data.

## Intended use
Controlling a 3D and ECAD design tool with short commands. It is not a general assistant and should not be used for anything else.

## Training data
- `ml/data/templates.csv`: 426 training templates across 23 intents, expanded into about 13,800 utterances with random but realistic values for objects, colours, dimensions, materials and relations. 82 held-out test templates use phrasings the model never trained on.
- `ml/data/lexicon/*.csv`: object, colour, material, relation, unit, format, view and mode vocabularies.
- `ml/data/oos.csv`: 60 non-command sentences; 39 for training, 21 held out.
- `ml/data/gold.csv`: 156 hand-written, annotated examples, kept out of training.

Templates were written by the project author. There is no crowd-sourced or real-user data yet. This is the main source of uncertainty in the numbers below.

## Results (from `ml/reports/metrics.json`)

| Evaluation | Metric | Value |
|---|---|---|
| Gold set (n = 156) | intent accuracy | 0.987 |
| Gold set | intent macro-F1 | 0.989 |
| Held-out phrasings (n = 1,640) | intent accuracy | 0.871 |
| Held-out phrasings | intent macro-F1 | 0.838 |
| Gold set, gold intents | slot entity F1 | 0.949 |
| Gold set, predicted intents | slot entity F1 | 0.939 |
| Gold set | slot token accuracy | 0.975 |
| Held-out phrasings | slot entity F1 | 0.981 |
| Out-of-scope (n = 21) | rejected at threshold 0.5 | 0.619 |
| Gold set | wrongly rejected at 0.5 | 0.006 |

The threshold sweep (0.3 to 0.7) is in the same file. Raising the threshold rejects more out-of-scope text but also rejects more valid commands, so 0.5 was chosen as the balance point.

## Interpreting the numbers
- The **gold** result is optimistic. The examples share vocabulary and style with the templates, so it mostly confirms that the model handles the patterns it was trained on.
- The **held-out** result is the more honest estimate of how it generalises to new phrasings, and it is lower. Intents whose held-out phrasings used new vocabulary (for example "reapply" or "get rid of everything") scored worst before the project added paraphrases for them. Those paraphrases are now in training, so this number reflects a second round of data-writing, not a fresh benchmark.
- Out-of-scope detection is the weakest area. A confidence threshold cannot reliably separate "a sentence about something else" from "an unusual command" without more negative examples.

## Backup parser (optional, not part of the model)
When the local model is unsure and a Gemini key is configured on the Vite server, the app asks Google's Gemini model to choose one of the known command names. This is a separate system with its own failure modes, and its quality has not been measured in this project. Its answers are checked against the allow-list of command names (`server/gemini.mjs`) before use.

## Known failure modes
- Unfamiliar object names fall back to "I don't have a model for that" rather than guessing.
- Multi-step requests ("add a chair, then make it red") are not supported; each utterance is one command.
- Numbers written as words are only partly handled ("two", "half", "twice"); "one hundred twenty" is not parsed.
- Negation ("don't delete the chair") is not modelled and may trigger the wrong action.
- The models have never seen real-user speech transcripts, so accuracy on voice input (which contains recognition errors) is unmeasured.

## Ethical and privacy notes
Everything runs locally in the browser. Commands and scene data are not sent to a server by the app. Voice input uses the browser's built-in speech recognition, which may send audio to the browser vendor; users should check their browser's policy.

## Reproducing
```bash
python ml/train.py   # writes ml/artifacts/, ml/reports/metrics.json, src/nlu/model/, tests/fixtures/
python -m pytest -q tests/
```
The training is seeded (`SEED = 13` in `ml/train.py`), so results should reproduce on the same library versions.
