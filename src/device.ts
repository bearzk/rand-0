import WebSocket from "ws";

const SIZE = 200;

export async function sendFrame(ip: string, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${ip}/display/gray4`);
    ws.on("open", () => {
      ws.send(frame, { binary: true }, (err) => {
        ws.close();
        err ? reject(err) : resolve();
      });
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
}

/** Connect and listen for button events. Calls onButton with "up"|"down".
 *  Returns a close() function to stop listening. */
export function listenButtons(
  ip: string,
  onButton: (key: "up" | "down") => void,
  onClose?: () => void
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    ws = new WebSocket(`ws://${ip}/display/gray4`);
    ws.on("message", (data) => {
      try {
        const ev = JSON.parse(data.toString());
        if (ev.type === "key" && ev.action === "short" && (ev.key === "up" || ev.key === "down")) {
          onButton(ev.key);
        }
      } catch {}
    });
    ws.on("close", () => {
      if (!stopped) setTimeout(connect, 1000); // reconnect
    });
    ws.on("error", () => {
      ws?.terminate();
      if (!stopped) setTimeout(connect, 2000);
    });
  }

  connect();

  return () => {
    stopped = true;
    ws?.terminate();
    onClose?.();
  };
}
