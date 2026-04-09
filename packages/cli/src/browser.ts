import { exec } from "node:child_process";

export async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === "darwin"
    ? `open "${url}"`
    : platform === "win32"
      ? `start "" "${url}"`
      : `xdg-open "${url}"`;

  return new Promise((resolve) => {
    exec(command, (error) => {
      resolve(!error);
    });
  });
}
