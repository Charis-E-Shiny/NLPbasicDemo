# Contributing

Thanks for helping improve CADVoice. Keep changes focused, preserve offline-first behavior, and avoid sending project content to external services.

## Development setup

1. Install Node.js 20+ and Python 3.9+ (Python is only required to retrain the NLP model).
2. Run `npm ci`.
3. Run `npm run dev` to start the local Vite server.

## Before opening a pull request

```powershell
npm test
npm run build
```

For changes to training phrases or model behavior, update `data/nlp_commands.csv`, keep the train/test split independent, run `npm run train:model`, and check the reported held-out accuracy. Add focused regression tests in `tests/` for parser and scene behavior.

## Contribution guidelines

- Explain the user-visible behavior and any limitations in the pull request.
- Keep dependencies and third-party assets minimal; include license and attribution details for any new asset.
- Do not commit credentials, private user designs, generated build output, or `node_modules`.
- Use accessible labels and provide visible error/status feedback.
- Do not claim manufacturing, EDA, or production guarantees that the implementation does not provide.

By submitting a contribution, you agree that it may be distributed under the project's MIT License.
