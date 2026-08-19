# PhantomBot engineering benchmark

This suite measures autonomous engineering work, not trivia. Each mission begins in an isolated copy of a repository and uses the same deliberately vague user prompt. The evaluator records tests, runtime and visual evidence, edit scope, tool calls, interventions, false actions, and remaining debt.

The first executable fixture is `FULL-001`, a small but real browser application with independent state, interaction, and responsive-layout defects. Do not expose defect locations or causes to the agent. Prepare a disposable copy with:

```text
python benchmarks/engineering/prepare.py FULL-001 <destination>
```

Then start the agent in that destination with only:

```text
The application is broken. Find the problem and fix it.
```

The runner/evaluator remains outside the copied application. Score an evidence record with:

```text
python -m hermes_cli.engineering_benchmark result.json --json-out score.json --markdown-out score.md
```

An overall pass requires at least 85/100 plus actual task success and passing tests. Missing evidence is a failed metric; the scorer never infers success from narrative claims.
