# Contributing

Thanks for your interest in AI Study Engine.

## Before opening a PR

- Run `npm run check` (typecheck + full test suite) and make it green.
- Keep the invariant **AI output != learner cognition** intact. Any change that
  lets AI output silently count as learner evidence needs explicit discussion.
- Policy or evidence-model changes **require** tests.
- Explain methodology changes in the PR description so reviewers can reason about
  them.

## What we want

- Bug reports with reproduction steps.
- Learning-protocol experiments (with measured results, not anecdotes).
- UX experiments that reduce accidental AI over-help.
- Criticism of the evidence model.
- Reproducible test cases.

## What not to do

- Do not commit learner data, SQLite databases, screenshots, or secrets.
- Do not vendor large binaries (models, tldraw AppImage, llama.cpp).
- Do not fabricate or weaken tests to hide a failure.

## License

By contributing, you agree your contributions are licensed under the MIT License.
