# rand-0

Web-based controller for [Rand/0](https://dot.mindreset.tech/docs/rand_0) Display Mode — push weather and book pages to the e-ink screen over local network.

## Requirements

- [Bun](https://bun.sh)
- Rand/0 device on the same Wi-Fi, in Display Mode (`Main menu → More → Display → Confirm`)

## Start

```bash
bun install
bun start
```

Open `http://localhost:3000`.

## Cards

**Weather** — shows current conditions for one or more cities. Down button cycles cities.

**Reader** — paste a `.txt` URL (e.g. Project Gutenberg). Up/down buttons page through. Progress saved per book.

## Config

`~/.config/rand-0.json` — created on first run.

```json
{
  "ip": "192.168.178.132",
  "cities": ["munich", "xian"],
  "bookUrl": "https://...",
  "bookId": "my_book",
  "fonts": {
    "cjk": ["/System/Library/Fonts/STHeiti Light.ttc"]
  }
}
```

| Field | Description |
|---|---|
| `ip` | Device IP shown on Rand/0 display in Display Mode |
| `cities` | Weather cities, cycled with down button |
| `bookUrl` | Last opened book URL |
| `fonts.cjk` | Font paths tried in order — first found wins. macOS defaults included. For Linux/Windows, point to a [Noto Sans CJK](https://github.com/notofonts/noto-cjk) `.ttc` file |

## Notes

- Weather data cached 6 hours per city
- Book pages cached in memory for the server's lifetime — no re-fetch on stop/start
- Progress stored in `~/.config/rand-0-<bookId>.progress`
- Only one card runs at a time — starting one stops the other
