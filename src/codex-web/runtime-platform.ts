export function runtimePlatformLabel(platformOs: string | null | undefined): string {
  switch (platformOs?.trim().toLowerCase()) {
    case "linux":
      return "Linux";
    case "windows":
    case "win32":
      return "Windows";
    case "macos":
    case "darwin":
      return "macOS";
    default:
      return "Unknown";
  }
}
