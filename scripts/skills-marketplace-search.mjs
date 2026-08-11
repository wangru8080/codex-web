import { spawn } from "node:child_process";

const query = process.argv[2] ?? "";
const limit = Number.parseInt(process.argv[3] ?? "20", 10) || 20;
const child = spawn(process.env.NPX_BIN || "npx", ["--yes", "skills", "find", query], {
  env: { ...process.env, DISABLE_TELEMETRY: "1", FORCE_COLOR: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let finished = false;
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
child.on("error", (error) => finish({ error: error.message, skills: [] }, 1));
child.on("close", (code) => finish({ error: code === 0 ? undefined : `skills CLI 退出码 ${code ?? "unknown"}`, skills: parse(output, limit) }, code ?? 1));

function finish(payload, code) {
  if (finished) return;
  finished = true;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = code;
}

function parse(value, max) {
  const lines = value.replace(/\x1B\[[0-9;]*m/g, "").split("\n");
  return lines.map((line) => line.trim().match(/^([a-zA-Z0-9_.-]+\/[^\s@]+)@([^\s]+)(?:\s+.*)?$/))
    .filter(Boolean)
    .slice(0, max)
    .map((match) => ({
      id: `${match[1]}/${match[2]}`,
      package: `${match[1]}@${match[2]}`,
      skillId: match[2],
      name: match[2],
      installs: 0,
      source: match[1],
    }));
}
