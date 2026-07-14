// GENERATED CODE! DO NOT MODIFY BY HAND!

import type { SandboxPolicy } from "./SandboxPolicy";
import type { ApprovalsReviewer } from "./ApprovalsReviewer";
import type { AskForApproval } from "./AskForApproval";

export type ThreadSettingsUpdateParams = {
  threadId: string;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandboxPolicy?: SandboxPolicy | null;
  permissions?: string | null;
  model?: string | null;
};
