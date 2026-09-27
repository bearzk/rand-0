#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "websocket-client",
#   "pillow",
# ]
# ///
"""
E-ink book reader for Rand/0 Display Mode.
- Down button: next page
- Up button:   previous page
- Progress saved to <book>.progress (page index)

Usage: uv run reader.py <book.txt> [ip]
"""
import sys, time, json, websocket
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime

if len(sys.argv) < 2:
    print("Usage: uv run reader.py <book.txt> [ip]")
    sys.exit(1)

BOOK_PATH = Path(sys.argv[1])
IP        = sys.argv[2] if len(sys.argv) > 2 else "192.168.178.132"
WS_URL    = f"ws://{IP}/display/gray4"
SIZE      = 200

MARGIN    = 6
FONT_SIZE = 20
TEXT_ROWS = 7    # lines of text per page
LINE_H    = 22   # pixels per line
USABLE_W  = SIZE - 2 * MARGIN

PROGRESS_PATH = BOOK_PATH.with_suffix(".progress")


def get_font():
    for path in ("/System/Library/Fonts/STHeiti Light.ttc",
                 "/System/Library/Fonts/STHeiti Medium.ttc",
                 "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(path, FONT_SIZE)
        except Exception:
            pass
    return ImageFont.load_default()


def wrap_line(text: str, font) -> list[str]:
    """Pixel-aware line wrap — handles CJK and Latin mixed text."""
    lines, current, current_w = [], "", 0
    for ch in text:
        ch_w = font.getbbox(ch)[2]
        if current_w + ch_w > USABLE_W:
            lines.append(current)
            current, current_w = ch, ch_w
        else:
            current += ch
            current_w += ch_w
    if current:
        lines.append(current)
    return lines or [""]


def load_book(path: Path) -> list[str]:
    """Load and paginate book into pages of TEXT_ROWS lines."""
    font = get_font()
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = []
    for para in raw.splitlines():
        para = para.strip()
        if not para:
            lines.append("")
        else:
            lines.extend(wrap_line(para, font))
    # chunk into pages
    pages = [lines[i:i + TEXT_ROWS] for i in range(0, len(lines), TEXT_ROWS)]
    return pages


def load_progress() -> int:
    try:
        return int(PROGRESS_PATH.read_text().strip())
    except Exception:
        return 0


def save_progress(page: int) -> None:
    PROGRESS_PATH.write_text(str(page))


def render(pages: list, page_idx: int) -> bytes:
    img = Image.new("L", (SIZE, SIZE), 255)
    d = ImageDraw.Draw(img)

    font  = get_font()
    try:
        small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 10)
    except Exception:
        small = ImageFont.load_default()

    lines = pages[page_idx]
    y = MARGIN
    for line in lines:
        d.text((MARGIN, y), line, font=font, fill=0)
        y += LINE_H

    # status bar at bottom
    d.line([(MARGIN, SIZE - 16), (SIZE - MARGIN, SIZE - 16)], fill=120, width=1)
    pct = int(100 * page_idx / max(len(pages) - 1, 1))
    status = f"p.{page_idx+1}/{len(pages)}  {pct}%"
    d.text((MARGIN, SIZE - 13), status, font=small, fill=0)

    # gray4 encode
    pixels = list(img.tobytes())
    def q(v):
        if v < 64:  return 0b11
        if v < 128: return 0b10
        if v < 192: return 0b01
        return 0b00
    bits = [q(p) for p in pixels]
    frame = bytearray(10000)
    for i in range(0, SIZE * SIZE, 4):
        frame[i // 4] = (bits[i] << 6) | (bits[i+1] << 4) | (bits[i+2] << 2) | bits[i+3]
    return bytes(frame)


def send_page(pages: list, page_idx: int) -> None:
    frame = render(pages, page_idx)
    ws = websocket.WebSocket()
    ws.connect(WS_URL)
    ws.send_binary(frame)
    try:
        ws.close()
    except Exception:
        pass
    print(f"Page {page_idx+1}/{len(pages)}")


def run():
    print(f"Loading {BOOK_PATH}...")
    pages = load_book(BOOK_PATH)
    print(f"{len(pages)} pages ({TEXT_ROWS} lines/page)")

    page_idx = max(0, min(load_progress(), len(pages) - 1))
    send_page(pages, page_idx)
    save_progress(page_idx)

    while True:
        try:
            time.sleep(1)  # brief pause so device is ready after close
            listener = websocket.WebSocket()
            listener.connect(WS_URL)
            listener.settimeout(1.0)
            print("Listening for buttons...")

            while True:
                try:
                    msg = listener.recv()
                    if not msg:
                        continue
                    ev = json.loads(msg)
                    if ev.get("type") != "key" or ev.get("action") != "short":
                        continue
                    key = ev.get("key")
                    if key == "down":
                        page_idx = min(page_idx + 1, len(pages) - 1)
                    elif key == "up":
                        page_idx = max(page_idx - 1, 0)
                    else:
                        continue
                    save_progress(page_idx)
                    try:
                        listener.close()
                    except Exception:
                        pass
                    send_page(pages, page_idx)
                    break  # reconnect listener after send
                except websocket.WebSocketTimeoutException:
                    pass  # no event, keep waiting
                except Exception as e:
                    print(f"Listener dropped: {e}")
                    break

        except KeyboardInterrupt:
            print(f"\nStopped at page {page_idx+1}. Progress saved.")
            return
        except Exception as e:
            print(f"Error: {e} — retry in 5s")
            time.sleep(5)


if __name__ == "__main__":
    run()
