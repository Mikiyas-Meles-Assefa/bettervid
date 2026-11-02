// Opens one page in the same headless Chrome that renders the video, waits for `window.__result`, prints it as JSON.
// Run by text-browser.ts as a child process, which is what lets compile stay synchronous.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bin, page] = process.argv.slice(2) as [string, string];
const profile = mkdtempSync(join(tmpdir(), "bettervid-chrome-"));
const chrome = spawn(bin, ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const finish = (code: number) => {
  chrome.kill("SIGKILL");
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Chrome may still be letting go of the folder; it lives in the temp directory either way.
  }
  process.exit(code);
};
setTimeout(() => {
  console.error("browser timed out");
  finish(1);
}, 60000).unref();

const address = await new Promise<string>((done, fail) => {
  let seen = "";
  chrome.stderr.on("data", (d) => {
    seen += d;
    const m = /DevTools listening on (ws:\S+)/.exec(seen);
    if (m) done(m[1]!);
  });
  chrome.on("exit", () => fail(new Error(`browser exited: ${seen.slice(-400)}`)));
});

const socket = new WebSocket(address);
await new Promise((done) => socket.addEventListener("open", done, { once: true }));
let next = 1;
const waiting = new Map<number, (r: { result?: any; error?: { message: string } }) => void>();
socket.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id) waiting.get(m.id)?.(m);
});
const send = (method: string, params: object, sessionId?: string) =>
  new Promise<any>((done, fail) => {
    const id = next++;
    waiting.set(id, (m) => (m.error ? fail(new Error(m.error.message)) : done(m.result)));
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

const { targetId } = await send("Target.createTarget", { url: `file://${page}` });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
for (;;) {
  const r = await send("Runtime.evaluate", { expression: "window.__result", awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) {
    console.error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    finish(1);
  }
  if (r.result?.value !== undefined) {
    process.stdout.write(typeof r.result.value === "string" ? r.result.value : JSON.stringify(r.result.value), () => finish(0));
    break;
  }
  await new Promise((done) => setTimeout(done, 20));
}
