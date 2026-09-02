<h1 align="center">
Xenon Agent
</h1>

<h3 align="center">
Xenon Agent: A Self-Improving RLM Harness
</h3>

<p align="center">
  <a href="packages/coding-agent/docs/index.md">Documentation</a> &bull;
  <a href="https://github.com/Istiyaq-Khan/xenon-agent">Repository</a> &bull;
  <a href="https://github.com/Istiyaq-Khan/xenon-agent/discussions">Discussions</a>
</p>

<p align="center">
  <a href="https://github.com/Istiyaq-Khan/xenon-agent/actions/workflows/ci.yml">
    <img src="https://github.com/Istiyaq-Khan/xenon-agent/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://github.com/Istiyaq-Khan/xenon-agent/actions/workflows/build-binaries.yml">
    <img src="https://github.com/Istiyaq-Khan/xenon-agent/actions/workflows/build-binaries.yml/badge.svg" alt="Build Binaries" />
  </a>
  <a href="https://arxiv.org/abs/2608.23552">
    <img src="https://img.shields.io/badge/arXiv-2608.23552-b31b1b.svg" alt="arXiv" />
  </a>
</p>

Xenon Agent is an open-source coding and research agent for general and long-running work. It is designed around two core abstractions:

- The **[Recursive Language Model (RLM)](https://www.xenonintellect.ai/blog/rlm)** treats context as variables (*prompt-as-a-variable*) and tools like recursive subagents as function calls (*programmatic tool /sub-agent calling*) inside a persistent REPL.
- The **[Continual Harness](https://arxiv.org/abs/2605.09998)** stores supplemental prompts, memories, skill descriptions, and reusable subagent specifications as durable state that Xenon Agent can refine through small, evidence-backed updates, local to the session by default.

Xenon Agent combines a persistent Python control environment with durable harness state, so useful working context and reusable operating patterns can outlive a single chat window.

- **Everything is programmatic:** a persistent Python REPL is the built-in model tool; file operations, shell commands, tool use, subagents, and context management happen through code.
- **Subagents are built in:** `rlm(...)` spawns real child agents for parallel or background work and returns their results programmatically.
- **The harness can improve:** `/refine` reviews the current trajectory and can apply small, evidence-backed updates to supplemental harness state. It never rewrites the immutable base system prompt, and recorded snapshots support rollback.
- **Skills are executable:** skills are importable Python packages, and the built-in skill creator can turn recurring workflows into project or personal skills.
- **Sessions run in the background:** daemon-backed agents keep running when the terminal disconnects and can be reattached later.
- **Agents communicate directly:** running agents can exchange messages and orchestrate one another without routing everything through the user.
- **Long tasks keep moving:** automatic compaction, persistent goals, heartbeats, schedules, autonomous mode, and retained subagents preserve progress across turns and terminal sessions.

## Getting Started

### Installation & Quickstart

Clone the repository and set up Xenon Agent:

```bash
git clone https://github.com/Istiyaq-Khan/xenon-agent.git
cd xenon-agent
npm install
npm run build
```

Start Xenon Agent from the repository or directory you want it to work in:

```bash
cd /path/to/project
xenon
# or
xenon-agent
```

On first launch, run `/login` to choose a subscription or API-key provider. Xenon Agent works in the current directory and can run commands and modify files there. Use a disposable clone, clean worktree, or another checkpoint you can inspect and restore.

> [!WARNING]
> Xenon Agent executes model-generated Python and project commands with your user permissions. Its worker and kernel processes improve lifecycle isolation and recovery; they are **not** a security sandbox. Review changes and use trusted repositories, instructions, skills, and extensions only. Run untrusted code or instructions in an external sandbox or restricted environment.

Useful commands:

```bash
xenon agents                   # Browse running, idle, and saved sessions
xenon attach <agent>           # Reattach to a running session
xenon --resume [path|id]       # Browse sessions or resume one directly
xenon status                   # Inspect background service state
xenon doctor [--fix]           # Inspect or repair background services
xenon update [--force]         # Update Xenon Agent
xenon shutdown [--force]       # Stop every agent, worker, and background service
```

## Built for Long-Running Work
Xenon Agent is built for long-running work, especially for evaluations in research. These features are available in the TUI, and when run autonomously.

- **Continual Harness:** `/refine` can persist focused, reviewable lessons as supplemental prompts, memories, reusable skill descriptions, or subagent specifications, with recorded refinement history. It does not replace packaging and reviewing new executable skills.
- **Direct agent-to-agent communication:** running agents and retained subagents can discover one another, exchange messages, and steer active work.
- **Daemon-backed continuity:** active sessions, Python REPL state, schedules, and subagents keep running when the terminal detaches and can be reattached later.
- **Heartbeats and schedules:** `/heartbeat`, `rlm_heartbeat`, and `xenon schedule` can re-enter a session periodically or at a specific time.
- **Persistent goals:** `/goal` keeps an objective and its progress active across turns until it is completed, paused, or cleared.
- **Bounded autonomous mode:** `/autonomous` continues within configured turn, token, and time budgets and can run user-defined quality gates. A passed gate checks only what that gate verifies; reaching a limit does not imply task success.

## Documentation

- [Quickstart](packages/coding-agent/docs/quickstart.md) — install, authenticate, and run a first session
- [Usage and CLI reference](packages/coding-agent/docs/usage.md) — commands, sessions, autonomous limits, and output modes
- [Long-running and background agents](packages/coding-agent/docs/long-running-agents.md) — detach and reattach, goals, heartbeats, and schedules
- [RLM programming model](packages/coding-agent/docs/rlm.md) — the persistent Python REPL, subagents, skills, and the trust model
- [JSON mode](packages/coding-agent/docs/json.md) and [RPC mode](packages/coding-agent/docs/rpc.md) — headless automation and integrations
- [Skills](packages/coding-agent/docs/skills.md) — install and create reusable capabilities
- [Provider setup](packages/coding-agent/docs/providers.md) — subscription and API-key providers
- [Architecture overview](packages/coding-agent/docs/architecture.md) — daemon, worker, kernel, and persistence boundaries
- [Development](packages/coding-agent/docs/development.md) — build and run from source

## Contributing

Start with a GitHub Discussion for [general questions](https://github.com/Istiyaq-Khan/xenon-agent/discussions/categories/general), [bug reports](https://github.com/Istiyaq-Khan/xenon-agent/discussions/categories/bug-reports), and [feature requests](https://github.com/Istiyaq-Khan/xenon-agent/discussions/categories/feature-requests). Maintainers promote accepted work into Issues, and pull requests are reviewed from maintainers and vouched contributors.

Read the [contribution guidelines](CONTRIBUTING.md) for the full process. Report security vulnerabilities privately by following the [security policy](SECURITY.md).

## Acknowledgements

Our agent and TUI is built on top of [`pi`](https://github.com/earendil-works/pi). We thank the authors for their valuable work.

Based on architectures originally created by Mario Zechner, modified and maintained as Xenon Agent under the MIT License.

## License

Xenon Agent is fully open source and released under the [MIT License](LICENSE).

## Citation

If you use this codebase in your research, please cite:

```bibtex
@article{karten2026xenon,
  title={Xenon Agent: A Self-Improving RLM Harness},
  author={Karten, Seth and Zhang, Alex L. and Thomas, Kevin and Müller, Sebastian and Bakouch, Elie and Auras, Daniel and Senghaas, Mika and Obeid, Fares and Dunas, Konstantin and Hagemann, Johannes and Jaghouar, Sami},
  journal={arXiv preprint arXiv:2608.23552},
  year={2026}
}
```

Available at [https://arxiv.org/abs/2608.23552](https://arxiv.org/abs/2608.23552).
