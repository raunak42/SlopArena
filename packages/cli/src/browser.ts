import { spawn } from "node:child_process";

export async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === "darwin"
    ? { bin: "open", args: [url] }
    : platform === "win32"
      ? { bin: "cmd", args: ["/c", "start", "", url] }
      : { bin: "xdg-open", args: [url] };

  return new Promise((resolve) => {
    try {
      const child = spawn(command.bin, command.args, {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => resolve(false));
      child.unref();
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}
