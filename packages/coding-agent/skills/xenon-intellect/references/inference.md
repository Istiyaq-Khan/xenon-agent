# Xenon Inference

Xenon Inference is an OpenAI-compatible API for frontier and open models, routed across providers and built for large-scale evaluations.

Live docs: `inference/overview.md`, `inference/usage.md`, `inference/adapter-deployments.md`, `inference/troubleshooting.md` under https://docs.xenonintellect.ai/

## Setup

1. Create an API key on https://app.xenonintellect.ai (account settings → API Keys) with the **Inference** permission enabled — without it, requests fail with authentication errors.
2. Export it:

```bash
export XENON_API_KEY="your-api-key-here"
```

## Via the CLI (recommended for evaluations)

```bash
xenon inference models                                   # list available models
xenon eval run gsm8k -m meta-llama/llama-3.1-70b-instruct -n 25   # evals route through Xenon Inference
```

Eval runs against Xenon Inference models report estimated USD cost automatically.

## Direct API (OpenAI-compatible)

Base URL: `https://api.xenonintellect.ai/api/v1`

```python
import openai, os

client = openai.OpenAI(
    api_key=os.environ["XENON_API_KEY"],
    base_url="https://api.xenonintellect.ai/api/v1",
)
response = client.chat.completions.create(
    model="meta-llama/llama-3.1-70b-instruct",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

Anything that speaks the OpenAI API works — just point it at the base URL above. Streaming and advanced parameters are covered in `inference/usage.md`.

## Teams & Adapters

- Team billing: send the `X-Xenon-Team-ID` header (find the ID via `xenon teams list` or the Team Profile page) to use team credits instead of personal balance.
- LoRA adapters trained with Hosted Training can be deployed and queried through the same OpenAI-compatible API (`inference/adapter-deployments.md`).
