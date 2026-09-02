import { existsSync, writeFileSync } from "node:fs";
import {
	closeOwnedSessionWorkerOwnerWatch,
	installOwnedSessionWorkerOwnerWatch,
	maybeRunOwnedSessionWorkerFrontend,
} from "../../src/cli/owned-session-worker.js";
import { attachJsonlLineReader, serializeJsonLine } from "../../src/modes/rpc/jsonl.js";

const args = process.argv.slice(2);
const stdinTty = process.env.XENON_AGENT_TEST_STDIN_TTY ?? process.env.XENON_AGENT_TEST_STDIN_TTY;
if (stdinTty) {
	Object.defineProperty(process.stdin, "isTTY", { value: stdinTty === "1" });
}
const pidPath = process.env.XENON_AGENT_TEST_OWNED_PID_PATH ?? process.env.XENON_AGENT_TEST_OWNED_PID_PATH;
installOwnedSessionWorkerOwnerWatch();

const isOwnedWorker =
	process.env.XENON_AGENT_INTERNAL_OWNED_WORKER === "1" || process.env.XENON_AGENT_INTERNAL_OWNED_WORKER === "1";
const ownedProfile =
	process.env.XENON_AGENT_INTERNAL_OWNED_PROFILE ?? process.env.XENON_AGENT_INTERNAL_OWNED_PROFILE ?? "";
const keepAlive = process.env.XENON_AGENT_TEST_KEEP_ALIVE === "1" || process.env.XENON_AGENT_TEST_KEEP_ALIVE === "1";
const exitZeroOnCommand =
	process.env.XENON_AGENT_TEST_EXIT_ZERO_ON_COMMAND ?? process.env.XENON_AGENT_TEST_EXIT_ZERO_ON_COMMAND;
const crashOnCommand = process.env.XENON_AGENT_TEST_CRASH_ON_COMMAND ?? process.env.XENON_AGENT_TEST_CRASH_ON_COMMAND;
const crashOnAck =
	process.env.XENON_AGENT_TEST_CRASH_ON_ACK === "1" || process.env.XENON_AGENT_TEST_CRASH_ON_ACK === "1";
const invalidRpcOutput =
	process.env.XENON_AGENT_TEST_INVALID_RPC_OUTPUT === "1" || process.env.XENON_AGENT_TEST_INVALID_RPC_OUTPUT === "1";
const reverseRpcResponses =
	process.env.XENON_AGENT_TEST_REVERSE_RPC_RESPONSES === "1" ||
	process.env.XENON_AGENT_TEST_REVERSE_RPC_RESPONSES === "1";
const recoveryPath =
	process.env.XENON_AGENT_INTERNAL_OWNED_RECOVERY_DESCRIPTOR ??
	process.env.XENON_AGENT_INTERNAL_OWNED_RECOVERY_DESCRIPTOR;

if (isOwnedWorker) {
	if (pidPath) {
		writeFileSync(`${pidPath}.ppid`, `${process.ppid}\n`);
		writeFileSync(`${pidPath}.profile`, `${ownedProfile}\n`);
		writeFileSync(pidPath, `${process.pid}\n`);
		process.once("SIGTERM", () => {
			writeFileSync(`${pidPath}.terminated`, "terminated\n");
			process.exit(0);
		});
	}
	if (keepAlive) {
		setInterval(() => {}, 1000);
	}
	if (args.includes("--mode") && args.includes("rpc")) {
		const reversedCommands: Array<{ id?: string; type: string; marker?: string }> = [];
		const outputResponse = (command: { id?: string; type: string; marker?: string }) => {
			process.stdout.write(
				serializeJsonLine({
					...(command.id ? { id: command.id } : {}),
					type: "response",
					command: command.type,
					success: true,
					...(command.marker ? { marker: command.marker } : {}),
				}),
			);
		};
		attachJsonlLineReader(process.stdin, (line) => {
			const command = JSON.parse(line) as { id?: string; type: string; marker?: string };
			if (exitZeroOnCommand === command.type) {
				process.exit(0);
			}
			if (crashOnCommand === command.type) {
				process.exit(1);
			}
			if (command.type === "ack_result") {
				if (crashOnAck && pidPath && !existsSync(`${pidPath}.crashed`)) {
					writeFileSync(`${pidPath}.crashed`, "crashed\n");
					if (recoveryPath) {
						writeFileSync(
							recoveryPath,
							`${JSON.stringify({
								version: 1,
								profile: "rpc",
								sessionId: "fixture-session",
								sessionFile: `${pidPath}.jsonl`,
								cwd: process.cwd(),
								updatedAt: new Date().toISOString(),
							})}\n`,
						);
					}
					process.exit(1);
				}
				return;
			}
			if (invalidRpcOutput) {
				process.stdout.write("truncated-json\n");
				process.stdout.write("null\n");
			}
			if (reverseRpcResponses) {
				reversedCommands.push(command);
				if (reversedCommands.length === 2) {
					for (const pending of reversedCommands.reverse()) {
						outputResponse(pending);
					}
				}
				return;
			}
			outputResponse(command);
		});
		process.stdin.once("end", closeOwnedSessionWorkerOwnerWatch);
		process.stdin.resume();
	} else {
		process.stdin.pipe(process.stdout);
		if (!keepAlive) {
			process.stdin.once("end", closeOwnedSessionWorkerOwnerWatch);
		}
	}
} else {
	if (pidPath) {
		writeFileSync(`${pidPath}.frontend`, `${process.pid}\n`);
	}
	await maybeRunOwnedSessionWorkerFrontend(args);
}
