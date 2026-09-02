# Environments, Evaluations & Training

verifiers is Xenon Intellect's Python library for LLM environments: packages that expose `load_environment` and bundle datasets, rollout logic, and reward rubrics. Environments power evaluations (local and hosted) and RL training (Hosted Training or self-managed xenon-rl).

Live docs: `verifiers/overview.md`, `tutorials-environments/getting-started.md`, `hosted-training/getting-started.md`, `xenon-rl/overview.md` under https://docs.xenonintellect.ai/ (append `.md` for raw markdown). Source: https://github.com/Istiyaq-Khan/verifiers and https://github.com/Istiyaq-Khan/xenon-rl

## Discovering Environments (Hub)

```bash
xenon env list --search "math" --owner xenonintellect --show-actions
xenon env list --tag tools --tag sandbox
xenon env list --mine
xenon env list --starred
xenon env info owner/name        # metadata, version, dependencies
xenon env status owner/name      # CI/action status
xenon env pull owner/name -t ./tmp-env   # pull source for inspection
xenon env install owner/name     # install locally
```

When picking candidates, prefer: `xenonintellect`-owned, passing latest actions, updated within ~2 months, recent verifiers versions. Compare task type (single-turn, multi-turn, tool, sandbox, agent), reward type (binary, continuous, judge-based), and dependency/secret requirements.

## Creating Environments

```bash
xenon env init my-env --v1       # scaffold (add --with-harness for an explicit reusable harness)
xenon env install my-env
xenon eval run my-env -m openai/gpt-4.1-mini -n 5   # smoke test immediately
xenon env push                   # publish to the Hub
```

Build guidance:

- Define the task contract first: prompt shape, allowed tools, stop conditions, rubric outputs, metrics.
- Prefer starting from an existing Hub environment (`xenon env list --search`, then `xenon env install owner/name`) over building from scratch.
- v1 environments expose `load_environment(config: vf.EnvConfig) -> vf.Env`; Taskset + Harness environments additionally expose `load_taskset(config)` and optionally `load_harness(config)` with `load_environment` delegating through `vf.load_taskset`/`vf.load_harness`.
- The environment must install, load, evaluate, and train without hidden setup.

## Evaluations

`xenon eval run` is the canonical eval path. Runs save automatically (visible in the Evaluations tab and `xenon eval view`); do not add `--skip-upload` unless the user explicitly asks.

```bash
xenon eval run my-env -m openai/gpt-4.1-mini -n 5               # smoke
xenon eval run owner/env -m openai/gpt-4.1-mini -n 200 -r 3 --shuffle -s   # scaled
xenon eval run owner/env --hosted --follow                       # hosted, streaming logs
```

- Smoke-test first; scale only after a pass. Use `--shuffle` (seed defaults to 0; set `--shuffle-seed` for reproducible reports).
- Hosted evals require the environment to be published (`xenon env push`) and support TOML configs and temporary sandbox/tunnel permissions (`--allow-tunnel-access`).
- Xenon Inference models include estimated run cost in eval output automatically.
- Keep reusable model endpoints as aliases in `configs/endpoints.toml` (fields: `endpoint_id`, `model`, `url`, key) and reference them with `-m <endpoint_id>`.

## Training

Default to Hosted Training unless the user explicitly wants self-managed infrastructure.

```bash
xenon lab setup                  # Lab workspace for environments, evals, GEPA, Hosted Training
xenon train models               # supported models, capacity, pricing
xenon train init                 # generate a training config
xenon train rl.toml              # launch the run
```

- Hosted Training launches from a CPU machine; no local GPUs needed.
- Validate the environment with an eval before training (e.g. `-n 20 -r 3 -s`) and confirm reward diversity exists at baseline.
- Self-managed path: `xenon lab setup --xenon-rl`, then follow xenon-rl's own configs and launch commands. Treat xenon-rl as a power-user path requiring local GPU access; see https://docs.xenonintellect.ai/xenon-rl/overview.md.

## Model Family Choice

Ask the user whether they want instruct or reasoning models before non-trivial runs:

- Instruct (quick behavior checks): `gpt-4.1` series, `qwen3` instruct series.
- Reasoning (harder probes, deeper coverage): `gpt-5` series, `qwen3` thinking series, `glm` series.
