# Contributing to CADVoice

Thanks for helping! Code, data, bug reports, and model improvements are all welcome.

## Set up
```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # Node tests
pip install -r tools/requirements.txt && npm run test:py
```

## Adding voice commands
1. Add templates to `ml/data/templates.csv` (`intent,split,template`). `split=test` marks held-out phrasings.
2. Add new vocabulary to `ml/data/lexicon/*.csv`.
3. Add hand-written examples to `ml/data/gold.csv`. Never generate gold examples from the templates.
4. Run `npm run train:model`, then `npm test` and `npm run test:py`. Commit the regenerated `src/nlu/model/*.json` and `ml/reports/metrics.json`. The quality gates must still pass.

## Adding 3D models
Only add models under a licence that allows redistribution (CC0, CC-BY, MIT, Apache-2.0). Add an entry to `tools/models.config.json` with `license`, `author`, and `page`, run `python tools/build_models.py <id>`, and map the object type in `src/realModelMap.js`.

## Working on the AI backup
Never commit a real key. Keys belong in `.env` (git-ignored); see `.env.example`. Tests never call the network: they use a fake `fetch`.

## Pull requests
- Keep changes focused and describe what changed and why.
- Make sure `npm test` and `npm run build` pass. Add tests for new behaviour.
- Match the existing style (ES modules, React function components).

## Code of conduct
Be respectful and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
