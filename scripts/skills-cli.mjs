import { spawn } from "node:child_process";

const child = spawn(process.env.NPX_BIN || "npx", process.argv.slice(2), {
  env: { ...process.env, DISABLE_TELEMETRY: "1" },
  cwd: process.env.SKILLS_CLI_CWD || undefined,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => { process.exitCode = code ?? 1; });
