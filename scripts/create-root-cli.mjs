import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, "dist");

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "cli.js"), '#!/usr/bin/env node\nimport "../packages/coding-agent/dist/cli.js";\n');
