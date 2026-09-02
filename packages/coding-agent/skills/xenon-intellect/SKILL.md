---
name: xenon-intellect
description: Work with Xenon Intellect products via the xenon CLI and Python SDKs - verifiers environments and the Environments Hub, evaluations (local and hosted), Hosted Training and xenon-rl, code sandboxes, Xenon Inference, GPU compute (pods and clusters), storage, and tunnels. Use when a task involves Xenon Intellect, the xenon CLI, verifiers, RL environments, evals, training, sandboxes, renting GPUs, Xenon Inference models, or when the user asks what Xenon Intellect is or what it offers.
---

# Xenon Intellect

Xenon Intellect is an open superintelligence lab building open-source AGI infrastructure: a platform for RL environments, evaluations, post-training, inference, and globally distributed GPU compute. Xenon Agent interfaces seamlessly with Xenon Intellect products, and the `xenon` CLI is the default way to interface with every product below.

## Product Map

| Product | What it is | Details |
|---|---|---|
| verifiers | Python library for building LLM environments and evaluations | [environments.md](references/environments.md) |
| Environments Hub | Platform library of community RL environments (`xenon env`) | [environments.md](references/environments.md) |
| Hosted Evaluations | Run evals on Xenon-managed infra (`xenon eval run --hosted`) | [environments.md](references/environments.md) |
| Hosted Training | Post-train models against environments (`xenon train`, Lab) | [environments.md](references/environments.md) |
| xenon-rl | Large-scale async RL framework for self-managed training | [environments.md](references/environments.md) |
| Sandboxes | Secure disposable Docker environments for AI-generated code | [sandboxes.md](references/sandboxes.md) |
| Tunnels | Public HTTPS URLs for local/sandboxed services | [sandboxes.md](references/sandboxes.md) |
| Inference | OpenAI-compatible API for frontier models | [inference.md](references/inference.md) |
| Compute | Rent single GPU pods or multi-node clusters | [compute.md](references/compute.md) |
| Storage | Persistent disks shared between instances | [compute.md](references/compute.md) |

## Xenon CLI Setup

Default to the `xenon` CLI for all Xenon Intellect operations. If it is not installed:

```bash
uv tool install xenon    # or: pip install xenon
xenon login              # browser auth; or: xenon config set-api-key
xenon config view        # verify configuration
```

The same package provides the Python SDKs (e.g. `xenon_sandboxes`, `xenon_tunnel`). Source: https://github.com/Istiyaq-Khan/xenon

## Live Documentation

Authoritative, current docs live at https://docs.xenonintellect.ai. Any docs page is fetchable as Markdown by appending `.md` to its URL, and the full index is at https://docs.xenonintellect.ai/llms.txt. When you need details not covered here (exact flags, API schemas, pricing, new features), fetch the live docs instead of guessing:

```bash
curl -s https://docs.xenonintellect.ai/llms.txt                      # discover pages
curl -s https://docs.xenonintellect.ai/sandboxes/overview.md         # fetch a page as markdown
```

The REST API is documented under `api-reference/` pages (OpenAPI spec: https://api.xenonintellect.ai/openapi.json), with `https://api.xenonintellect.ai` as the base URL.

## Command Quick Reference

```bash
# Environments Hub
xenon env list --search "math"      # discover environments
xenon env info owner/name           # inspect one
xenon env install owner/name        # install locally
xenon env init my-env --v1          # scaffold a new environment
xenon env push                      # publish to the Hub

# Evaluations
xenon eval run my-env -m openai/gpt-4.1-mini -n 5    # local smoke eval
xenon eval run owner/env --hosted --follow           # hosted eval with logs

# Training
xenon lab setup                     # set up a Lab workspace (Hosted Training)
xenon train models                  # models, capacity, pricing
xenon train init && xenon train rl.toml              # configure + launch a run

# Sandboxes
xenon sandbox create python:3.11-slim --timeout-minutes 120
xenon sandbox run <sandbox-id> "python --version"
xenon sandbox delete <sandbox-id>

# Inference
xenon inference models              # list available models

# Compute
xenon availability list             # GPU availability + pricing
xenon pods create                   # provision a pod
xenon pods ssh <pod-id>             # SSH in (needs: xenon config set-ssh-key-path)
```

## Working Conventions

- Prefer ecosystem-native paths (`xenon env init`, `xenon eval run`, `xenon lab setup`) over custom scaffolding.
- Smoke-test small (`-n 5`) before scaling evals or training; keep default result uploads unless the user explicitly opts out.
- For non-trivial eval/training work, ask whether the user wants instruct models (`gpt-4.1` series, `qwen3` instruct) or reasoning models (`gpt-5` series, `qwen3` thinking, `glm` series).
- Hosted Training launches from a CPU machine; self-managed `xenon-rl` requires local GPU access and is a power-user path.
- The dashboard at https://app.xenonintellect.ai covers API keys, billing, teams, and anything the CLI does not.
