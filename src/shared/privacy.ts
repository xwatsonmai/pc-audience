export function isSensitiveApp(appName: string, sensitiveApps: string[]): boolean {
  const app = appName.toLowerCase();
  return sensitiveApps.some((item) => item.trim() && app.includes(item.trim().toLowerCase()));
}
