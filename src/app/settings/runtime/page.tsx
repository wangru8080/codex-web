import { redirect } from "next/navigation";

export default function SettingsRuntimeRedirect() {
  redirect("/settings/codex");
}
