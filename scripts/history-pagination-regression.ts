import {
  buildHistoryPaginationRegressionPlan,
} from "../server/history-pagination-regression-plan";
import { resolveTestCodexHome } from "../server/test-codex-home";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;

const threadId = process.argv[2];
const markerPrefix = process.argv[3] ?? "phase6t";
const steps = buildHistoryPaginationRegressionPlan({ threadId, markerPrefix, codexHome });

console.log("Phase 6T 历史分页回归清单");
console.log(`CODEX_HOME=${codexHome}`);
console.log(`markerPrefix=${markerPrefix}`);
console.log("");

steps.forEach((step, index) => {
  console.log(`${index + 1}. ${step.title}`);
  if (step.command) {
    console.log(`   command: ${step.command}`);
  }
  console.log(`   expected: ${step.expected}`);
});
