// Photographs a local HTML page with headless Chrome over the DevTools protocol (the shell's own --screenshot flag
// hangs on this machine). For proof sheets only.
import { spawn } from "node:child_process";

export async function screenshot(chrome: string, page: string, out: string, width: number, height: number): Promise<void> {
  const proc = spawn(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const wsUrl = await new Promise<string>((ok, fail) => {
      let buf = "";
      const t = setTimeout(() => fail(new Error("chrome did not start")), 20000);
      proc.stderr!.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) (clearTimeout(t), ok(m[1]!));
      });
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
    let n = 0;
    const waiting = new Map<number, (v: Record<string, unknown>) => void>();
    const events: ((m: Record<string, unknown>) => void)[] = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && waiting.has(m.id)) waiting.get(m.id)!(m.result ?? m);
      else for (const f of events) f(m);
    });
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
      new Promise<Record<string, unknown>>((ok) => {
        const id = ++n;
        waiting.set(id, ok);
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    const { targetId } = (await send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
    const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = new Promise<void>((ok) => events.push((m) => m.method === "Page.loadEventFired" && ok()));
    await send("Page.navigate", { url: `file://${page}` }, sessionId);
    await loaded;
    await new Promise((ok) => setTimeout(ok, 400));
    const shot = (await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } }, sessionId)) as { data: string };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    ws.close();
  } finally {
    proc.kill();
  }
}
