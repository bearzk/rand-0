import { createConnection } from "net";

const SIZE = 200;

function buildWsFrame(payload: Buffer): Buffer {
  // RFC 6455 binary frame, client-side masked, payload > 125 bytes uses 16-bit length
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!;
  // FIN=1, opcode=0x02 (binary), MASK=1, 16-bit extended length
  const header = Buffer.from([
    0x82,                          // FIN + binary opcode
    0xFE,                          // MASK + 126 (16-bit length follows)
    (payload.length >> 8) & 0xFF,
    payload.length & 0xFF,
    ...mask,
  ]);
  return Buffer.concat([header, masked]);
}

export async function sendFrame(ip: string, frame: Buffer): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const sock = createConnection(80, ip, () => {
      const upgrade = [
        "GET /display/gray4 HTTP/1.1",
        `Host: ${ip}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "", "",
      ].join("\r\n");
      sock.write(upgrade);
    });

    let upgraded = false;
    sock.on("data", (data) => {
      if (!upgraded) {
        upgraded = true;
        console.log(`[device] handshake: ${data.toString().split("\r\n")[0]}`);
        const wsFrame = buildWsFrame(frame);
        sock.write(wsFrame, (err) => {
          if (err) { sock.destroy(); resolve({ ok: false, error: err.message }); return; }
          console.log(`[device] frame sent (${wsFrame.length}b)`);
          setTimeout(() => { sock.destroy(); resolve({ ok: true }); }, 500);
        });
      } else {
        console.log(`[device] response:`, data.toString());
      }
    });
    sock.on("error", (e) => {
      console.error("[device] error:", e.message);
      resolve({ ok: false, error: e.message });
    });
    setTimeout(() => { sock.destroy(); resolve({ ok: false, error: "connection timeout — is Rand/0 in Display Mode?" }); }, 5000);
  });
}

/** Connect and listen for button events via raw WebSocket. */
export function listenButtons(
  ip: string,
  onButton: (key: "up" | "down") => void,
): () => void {
  let stopped = false;
  let sock: ReturnType<typeof createConnection> | null = null;

  function connect() {
    if (stopped) return;
    sock = createConnection(80, ip, () => {
      const upgrade = [
        "GET /display/gray4 HTTP/1.1",
        `Host: ${ip}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "", "",
      ].join("\r\n");
      sock!.write(upgrade);
    });

    let upgraded = false;
    let buf = Buffer.alloc(0);

    sock.on("data", (data: Buffer) => {
      if (!upgraded) {
        upgraded = true;
        return; // skip HTTP 101 response
      }
      buf = Buffer.concat([buf, data]);
      // parse WebSocket text frames
      while (buf.length >= 2) {
        const fin = (buf[0]! >> 7) & 1;
        const opcode = buf[0]! & 0x0F;
        const masked = (buf[1]! >> 7) & 1;
        const lenByte = buf[1]! & 0x7F;
        let headerLen = 2 + (masked ? 4 : 0);
        let payloadLen = lenByte;
        if (lenByte === 126) { headerLen += 2; payloadLen = buf.readUInt16BE(2); }
        if (buf.length < headerLen + payloadLen) break;
        const payload = buf.slice(headerLen, headerLen + payloadLen);
        buf = buf.slice(headerLen + payloadLen);
        if (opcode === 0x01) { // text
          try {
            const ev = JSON.parse(payload.toString());
            if (ev.type === "key" && ev.action === "short" && (ev.key === "up" || ev.key === "down")) {
              onButton(ev.key);
            }
          } catch {}
        }
      }
    });
    sock.on("close", () => { if (!stopped) setTimeout(connect, 1000); });
    sock.on("error", () => { sock?.destroy(); if (!stopped) setTimeout(connect, 2000); });
  }

  connect();
  return () => { stopped = true; sock?.destroy(); };
}
