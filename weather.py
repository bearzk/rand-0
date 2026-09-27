#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "websocket-client",
#   "pillow",
#   "requests",
# ]
# ///
"""
Push weather to Rand/0 Display Mode.
- Cycles cities on down-button short press
- Fetches only if cache is older than CACHE_TTL seconds
- Renders from cache every INTERVAL seconds

Usage: uv run weather.py [ip] [interval_seconds]
"""
import sys, time, json, threading, requests, websocket
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

IP        = sys.argv[1] if len(sys.argv) > 1 else "192.168.178.132"
INTERVAL  = int(sys.argv[2]) if len(sys.argv) > 2 else 60
WS_URL    = f"ws://{IP}/display/gray4"
SIZE      = 200
CACHE_TTL = 6 * 3600  # seconds

CITIES = ["munich", "xian"]

# shared state
cache: dict = {}      # city -> {"data": ..., "fetched_at": float}
city_idx = 0
lock = threading.Lock()

ICONS = {
    113: "Sunny", 116: "PtCloudy", 119: "Cloudy", 122: "Overcast",
    143: "Mist",  176: "PtRain",   200: "Thunder", 227: "Snow",
    248: "Fog",   260: "Fog",      263: "Drizzle", 266: "Drizzle",
    293: "Rain",  296: "Rain",     299: "Rain",    302: "HvyRain",
    305: "HvyRain", 308: "HvyRain", 317: "Sleet",  320: "Sleet",
    323: "Snow",  326: "Snow",     356: "HvyRain", 359: "HvyRain",
    362: "Sleet", 365: "Sleet",    368: "LtSnow",  371: "HvySnow",
    386: "Thunder", 389: "Thunder", 395: "ThdrSnow",
}

def fetch(city: str) -> dict:
    r = requests.get(f"https://wttr.in/{city}?format=j1", timeout=10)
    r.raise_for_status()
    d = r.json()
    c = d["current_condition"][0]
    w = d["weather"][0]
    return {
        "city":    city.capitalize(),
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


def get_weather(city: str) -> dict:
    """Return cached data, fetching if missing or stale."""
    with lock:
        entry = cache.get(city)
        age = time.time() - entry["fetched_at"] if entry else CACHE_TTL + 1
    if age > CACHE_TTL:
        print(f"Fetching {city}...", end=" ", flush=True)
        data = fetch(city)
        print(f"{data['temp']}°C {data['desc']}")
        with lock:
            cache[city] = {"data": data, "fetched_at": time.time()}
    return cache[city]["data"]


def render(w: dict) -> bytes:
    img = Image.new("L", (SIZE, SIZE), 255)
    d = ImageDraw.Draw(img)

    try:
        big   = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 52)
        med   = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except Exception:
        big = med = small = ImageFont.load_default()

    # Weather icon text
    icon_label = ICONS.get(w["code"], w["desc"][:8])
    d.text((8, 6), icon_label, font=med, fill=0)

    # Temperature
    d.text((8, 26), f"{w['temp']}°C", font=big, fill=0)

    # Description
    d.text((8, 80), w["desc"], font=small, fill=60)

    d.line([(8, 98), (192, 98)], fill=100, width=1)

    rows = [
        (f"Feels  {w['feels']}°C",          f"Humid  {w['humid']}%"),
        (f"Wind   {w['wind']} km/h {w['winddir']}", f"Precip {w['precip']}mm"),
        (f"Rise {w['sunrise']}",             f"Set  {w['sunset']}"),
    ]
    y = 106
    for left, right in rows:
        d.text((8,   y), left,  font=small, fill=0)
        d.text((104, y), right, font=small, fill=0)
        y += 20

    d.line([(8, 168), (192, 168)], fill=100, width=1)

    # City + time
    now = datetime.now().strftime("%H:%M")
    d.text((8,   172), w["city"], font=small, fill=0)
    d.text((152, 172), now,       font=small, fill=0)

    # Cache age
    with lock:
        fetched_at = cache.get(w["city"].lower(), {}).get("fetched_at", 0)
    age_min = int((time.time() - fetched_at) / 60) if fetched_at else 0
    d.text((8, 186), f"data {age_min}m ago", font=small, fill=150)

    # gray4 encode: 2 bits/pixel, row-major, high bits = left pixels
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


def run():
    global city_idx

    while True:
        city = CITIES[city_idx]
        try:
            # send frame
            print(f"Connecting to {WS_URL}...")
            ws = websocket.WebSocket()
            ws.connect(WS_URL)
            w = get_weather(city)
            frame = render(w)
            ws.send_binary(frame)
            print(f"Sent {city} @ {datetime.now().strftime('%H:%M:%S')}")
            try:
                ws.close()
            except Exception:
                pass

            # reconnect to listen for button events during the interval
            time.sleep(1)  # brief pause so device is ready
            print("Listening for buttons...")
            listener = websocket.WebSocket()
            listener.connect(WS_URL)
            listener.settimeout(1.0)
            deadline = time.time() + INTERVAL
            button_pressed = False
            while time.time() < deadline:
                try:
                    msg = listener.recv()
                    if msg:
                        ev = json.loads(msg)
                        if ev.get("type") == "key" and ev.get("key") == "down" and ev.get("action") == "short":
                            with lock:
                                city_idx = (city_idx + 1) % len(CITIES)
                            print(f"Button: switched to {CITIES[city_idx]}")
                            button_pressed = True
                            break
                except websocket.WebSocketTimeoutException:
                    pass  # no event, keep waiting
                except Exception as e:
                    print(f"Listener dropped: {e}")
                    break
            try:
                listener.close()
            except Exception:
                pass

        except KeyboardInterrupt:
            print("\nStopped.")
            return
        except Exception as e:
            print(f"Error: {e} — retry in 5s")
            time.sleep(5)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nStopped.")
