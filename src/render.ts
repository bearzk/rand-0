import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";

const SIZE = 200;
const MARGIN = 6;

// register CJK font
for (const f of ["/System/Library/Fonts/STHeiti Light.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]) {
  try { GlobalFonts.registerFromPath(f, "STHeiti"); break; } catch {}
}

function encodeGray4(canvas: any): Buffer {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE); // RGBA, 160000 bytes
  const frame = Buffer.alloc(10000);
  for (let p = 0; p < SIZE * SIZE; p += 4) {
    let byte = 0;
    for (let j = 0; j < 4; j++) {
      const base = (p + j) * 4;
      const v = Math.round(0.299 * data[base]! + 0.587 * data[base+1]! + 0.114 * data[base+2]!);
      const bits = v < 64 ? 0b11 : v < 128 ? 0b10 : v < 192 ? 0b01 : 0b00;
      byte |= bits << (6 - j * 2);
    }
    frame[p / 4] = byte;
  }
  return frame;
}

export function renderWeather(w: {
  city: string; temp: number; feels: number; desc: string;
  humid: number; wind: number; winddir: string; precip: number;
  sunrise: string; sunset: string; date: string; cachedMinsAgo: number;
}): Buffer {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "black";

  ctx.font = "bold 16px STHeiti, Helvetica";
  ctx.fillText(w.desc, MARGIN, 20);

  ctx.font = "bold 38px STHeiti, Helvetica";
  ctx.fillText(`${w.temp}°`, MARGIN, 62);

  ctx.strokeStyle = "#888";
  ctx.beginPath(); ctx.moveTo(MARGIN, 74); ctx.lineTo(SIZE - MARGIN, 74); ctx.stroke();

  const rows = [
    [`Feels ${w.feels}°C`, `Humid ${w.humid}%`],
    [`Wind ${w.wind}km/h ${w.winddir}`, `Precip ${w.precip}mm`],
    [`↑ ${w.sunrise}`, `↓ ${w.sunset}`],
  ];
  ctx.font = "bold 14px STHeiti, Helvetica";
  let y = 92;
  for (const [left, right] of rows) {
    ctx.fillText(left!, MARGIN, y);
    ctx.fillText(right!, 104, y);
    y += 20;
  }

  ctx.strokeStyle = "#888";
  ctx.beginPath(); ctx.moveTo(MARGIN, 154); ctx.lineTo(SIZE - MARGIN, 154); ctx.stroke();

  const now = new Date().toTimeString().slice(0, 5);
  ctx.font = "bold 14px STHeiti, Helvetica";
  ctx.fillText(w.city, MARGIN, 170);
  ctx.fillText(now, 152, 170);

  ctx.fillStyle = "#666";
  ctx.font = "12px Helvetica";
  ctx.fillText(`data ${w.cachedMinsAgo}m ago`, MARGIN, 186);

  return encodeGray4(canvas);
}

export function renderPage(lines: string[], pageIdx: number, totalPages: number): Buffer {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const LINE_H = 22;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "black";
  ctx.font = "20px STHeiti, Helvetica";

  let y = MARGIN + 18;
  for (const line of lines) {
    ctx.fillText(line, MARGIN, y);
    y += LINE_H;
  }

  ctx.strokeStyle = "#aaa";
  ctx.beginPath(); ctx.moveTo(MARGIN, SIZE - 16); ctx.lineTo(SIZE - MARGIN, SIZE - 16); ctx.stroke();
  const pct = Math.round(100 * pageIdx / Math.max(totalPages - 1, 1));
  ctx.font = "11px Helvetica";
  ctx.fillStyle = "black";
  ctx.fillText(`p.${pageIdx + 1}/${totalPages}  ${pct}%`, MARGIN, SIZE - 4);

  return encodeGray4(canvas);
}

function wrapText(text: string, ctx: SKRSContext2D, maxW: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    if (ctx.measureText(current + ch).width > maxW) {
      if (current) lines.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function paginateText(text: string, linesPerPage = 7): string[][] {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.font = "20px STHeiti, Helvetica";
  const maxW = SIZE - 2 * MARGIN;

  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const p = para.trim();
    if (!p) { lines.push(""); continue; }
    lines.push(...wrapText(p, ctx, maxW));
  }

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages;
}
