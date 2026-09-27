#!/usr/bin/env python3
"""
Push Munich weather to Rand/0 Display Mode every N seconds.
Usage: python weather.py [ip] [interval_seconds]
"""
import sys, time, struct, io, requests, websocket
from PIL import Image, ImageDraw, ImageFont

IP       = sys.argv[1] if len(sys.argv) > 1 else "192.168.178.132"
INTERVAL = int(sys.argv[2]) if len(sys.argv) > 2 else 60  # seconds
WS_URL   = f"ws://{IP}/display/gray4"
SIZE     = 200

# wttr.in weather code → simple ASCII symbol
ICONS = {
    113: "☀",   # Sunny
    116: "⛅",  # Partly cloudy
    119: "☁",   # Cloudy
    122: "☁",   # Overcast
    143: "≡",   # Mist
    176: "🌦",  # Patchy rain
    179: "🌨",  # Patchy snow
    182: "🌧",  # Sleet
    185: "🌧",
    200: "⛈",  # Thunder
    227: "❄",   # Blowing snow
    230: "❄",
    248: "≡",   # Fog
    260: "≡",
    263: "🌦",
    266: "🌧",
    281: "🌧",
    284: "🌧",
    293: "🌧",
    296: "🌧",
    299: "🌧",
    302: "🌧",
    305: "🌧",
    308: "🌧",
    311: "🌧",
    314: "🌧",
    317: "🌨",
    320: "🌨",
    323: "❄",
    326: "❄",
    329: "❄",
    332: "❄",
    335: "❄",
    338: "❄",
    350: "🌧",
    353: "🌦",
    356: "🌧",
    359: "🌧",
    362: "🌨",
    365: "🌨",
    368: "❄",
    371: "❄",
    374: "🌨",
    377: "🌨",
    386: "⛈",
    389: "⛈",
    392: "⛈",
    395: "❄",
}


def fetch_weather():
    r = requests.get("https://wttr.in/munich?format=j1", timeout=10)
    r.raise_for_status()
    d = r.json()
    c = d["current_condition"][0]
    w = d["weather"][0]
    return {
        "temp":    int(c["temp_C"]),
        "feels":   int(c["FeelsLikeC"]),
        "desc":    c["weatherDesc"][0]["value"].strip(),
        "code":    int(c["weatherCode"]),
        "humid":   int(c["humidity"]),
        "wind":    int(c["windspeedKmph"]),
        "winddir": c["winddir16Point"],
        "precip":  float(c["precipMM"]),
        "sunrise": w["astronomy"][0]["sunrise"],
        "sunset":  w["astronomy"][0]["sunset"],
        "date":    w["date"],
    }


def render(w) -> bytes:
    img = Image.new("L", (SIZE, SIZE), 255)  # white bg
    d = ImageDraw.Draw(img)

    # Try to load a font, fall back to default
    try:
        big   = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 52)
        med   = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except Exception:
        big = med = small = ImageFont.load_default()

    # Icon / symbol (use text fallback if emoji fails)
    icon = ICONS.get(w["code"], "?")
    try:
        # try emoji font for icons
        efont = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", 36)
        d.text((8, 6), icon, font=efont, fill=0, embedded_color=False)
    except Exception:
        d.text((8, 10), w["desc"][:3], font=med, fill=0)

    # Temperature — big and bold
    d.text((62, 4), f"{w['temp']}°", font=big, fill=0)

    # Description
    desc = w["desc"]
    d.text((8, 58), desc, font=small, fill=60)

    # Divider
    d.line([(8, 80), (192, 80)], fill=100, width=1)

    # Details grid
    rows = [
        (f"Feels  {w['feels']}°C",    f"Humid  {w['humid']}%"),
        (f"Wind   {w['wind']} km/h {w['winddir']}", f"Precip {w['precip']} mm"),
        (f"↑ {w['sunrise']}",          f"↓ {w['sunset']}"),
    ]
    y = 88
    for left, right in rows:
        d.text((8,   y), left,  font=small, fill=0)
        d.text((104, y), right, font=small, fill=0)
        y += 20

    # Date + "Munich" footer
    d.line([(8, 164), (192, 164)], fill=100, width=1)
    from datetime import datetime
    now = datetime.now().strftime("%H:%M")
    d.text((8,   168), "Munich", font=small, fill=0)
    d.text((152, 168), now,      font=small, fill=0)

    # Time of data
    d.text((8, 184), w["date"], font=small, fill=120)

    # Convert to gray4 frame: 2 bits/pixel, 10000 bytes
    # Quantize L to 4 levels: 0,85,170,255 → bits 11,10,01,00
    img_small = img.resize((SIZE, SIZE))
    pixels = list(img_small.tobytes())

    def to_gray4(v):
        # 0=black(11), 64=dark(10), 128=light(01), 192+=white(00)
        if v < 64:   return 0b11
        if v < 128:  return 0b10
        if v < 192:  return 0b01
        return 0b00

    bits = [to_gray4(p) for p in pixels]
    # pack 4 pixels per byte
    frame = bytearray(10000)
    for i in range(0, SIZE * SIZE, 4):
        b = (bits[i] << 6) | (bits[i+1] << 4) | (bits[i+2] << 2) | bits[i+3]
        frame[i // 4] = b
    return bytes(frame)


def connect():
    ws = websocket.WebSocket()
    ws.connect(WS_URL)
    return ws


def run():
    ws = None
    while True:
        try:
            print("Fetching weather...", end=" ", flush=True)
            w = fetch_weather()
            print(f"{w['temp']}°C {w['desc']}")

            frame = render(w)

            if ws is None:
                print(f"Connecting to {WS_URL}...")
                ws = connect()

            ws.send_binary(frame)
            print(f"Sent. Next update in {INTERVAL}s.")

        except KeyboardInterrupt:
            print("\nStopped.")
            break
        except Exception as e:
            print(f"Error: {e} — retrying on next cycle")
            ws = None  # reconnect next iteration

        time.sleep(INTERVAL)

    if ws:
        ws.close()


if __name__ == "__main__":
    run()
