import {
  assertHistoryPaginationRegressionEnv,
  buildHistoryPaginationRegressionPlan,
  historyPaginationRegressionCodexHome,
} from "../server/history-pagination-regression-plan";

try {
  assertHistoryPaginationRegressionEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const threadId = process.argv[2];
const markerPrefix = process.argv[3] ?? "phase6t";
const steps = buildHistoryPaginationRegressionPlan({ threadId, markerPrefix });

console.log("Phase 6T 历史分页回归清单");
console.log(`CODEX_HOME=${historyPaginationRegressionCodexHome}`);
console.log(`markerPrefix=${markerPrefix}`);
console.log("");

steps.forEach((step, index) => {
  console.log(`${index + 1}. ${step.title}`);
  if (step.command) {
    console.log(`   command: ${step.command}`);
  }
  console.log(`   expected: ${step.expected}`);
});
