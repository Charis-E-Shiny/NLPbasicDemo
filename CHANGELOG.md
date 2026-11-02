# Changelog

## 2.0.0
- Merged the React/Vite CADVoice app (UI, properties panel, exports, project files, parametric assemblies) with the trained NLU and real 3D models.
- Replaced the Naive Bayes intent model with a logistic-regression intent classifier and a CRF slot tagger, trained in Python and run in the browser. Intent and entities now feed the existing rule-based executor, which keeps its tested behaviour.
- Added 14 real, openly licensed 3D models (Arduino UNO/Nano/Mega, Raspberry Pi Pico, ESP32 stand-in, ATmega328P, LED, resistor, capacitor, push button, chair, table, sofa, lamp) with licence metadata, fitted to object sizes.
- Added an optional Gemini backup parser on the Vite server. The key stays server-side; answers are restricted to known intents.
- New commands: scale ("make it twice as big"), set value ("set the resistor to 220 ohms"), query the scene, and export by name.
- Tests: legacy rule suite kept; new JS/Python parity tests, backup-parser tests, model integrity tests, quality gates, and a browser smoke test.
- Removed the old `scripts/train_model.py` and `src/intent-model.json`.

## 1.x
- Earlier CADVoice prototype with Naive Bayes intent detection and procedural shapes.
