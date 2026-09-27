import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const SIZE = 200;
const MARGIN = 6;

// register CJK font
const CJK_FONTS = [
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
];
for (const f of CJK_FONTS) {
  try { GlobalFonts.registerFromPath(f, "STHeiti"); break; } catch {}
}

export function encodeGray4(canvas: ReturnType<typeof createCanvas>): Buffer {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE); // RGBA
  const frame = Buffer.alloc(10000);
  for (let i = 0; i < SIZE * SIZE; i += 4) {
    const bits = [0, 1, 2, 3].map(j => {
      const idx = (i + j) * 4;
      const v = Math.round(0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2]);
      if (v < 64)  return 0b11;
      if (v < 128) return 0b10;
      if (v < 192) return 0b01;
      return 0b00;
    });
    frame[i / 4] = (bits[0] << 6) | (bits[1] << 4) | (bits[2] << 2) | bits[3];
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

  ctx.font = "bold 18px STHeiti, Helvetica";
  ctx.fillText(w.desc, MARGIN, 22);

  ctx.font = "bold 52px STHeiti, Helvetica";
  ctx.fillText(`${w.temp}°`, MARGIN, 74);

  ctx.font = "14px STHeiti, Helvetica";
  ctx.fillText(w.desc, MARGIN, 92);  // already shown above but keep for spacing reference

  ctx.strokeStyle = "#aaa";
  ctx.beginPath(); ctx.moveTo(MARGIN, 98); ctx.lineTo(SIZE - MARGIN, 98); ctx.stroke();

  const rows = [
    [`Feels ${w.feels}°C`, `Humid ${w.humid}%`],
    [`Wind ${w.wind}km/h ${w.winddir}`, `Precip ${w.precip}mm`],
    [`↑ ${w.sunrise}`, `↓ ${w.sunset}`],
  ];
  ctx.font = "13px STHeiti, Helvetica";
  let y = 114;
  for (const [left, right] of rows) {
    ctx.fillText(left, MARGIN, y);
    ctx.fillText(right, 104, y);
    y += 19;
  }

  ctx.strokeStyle = "#aaa";
  ctx.beginPath(); ctx.moveTo(MARGIN, 168); ctx.lineTo(SIZE - MARGIN, 168); ctx.stroke();

  const now = new Date().toTimeString().slice(0, 5);
  ctx.font = "13px Helvetica";
  ctx.fillText(w.city, MARGIN, 182);
  ctx.fillText(now, 152, 182);

  ctx.fillStyle = "#888";
  ctx.font = "11px Helvetica";
  ctx.fillText(`data ${w.cachedMinsAgo}m ago`, MARGIN, 196);

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

  // status bar
  ctx.strokeStyle = "#aaa";
  ctx.beginPath(); ctx.moveTo(MARGIN, SIZE - 16); ctx.lineTo(SIZE - MARGIN, SIZE - 16); ctx.stroke();
  const pct = Math.round(100 * pageIdx / Math.max(totalPages - 1, 1));
  ctx.font = "11px Helvetica";
  ctx.fillStyle = "black";
  ctx.fillText(`p.${pageIdx + 1}/${totalPages}  ${pct}%`, MARGIN, SIZE - 4);

  return encodeGray4(canvas);
}

export function wrapText(text: string, ctx: CanvasRenderingContext2D, maxW: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxW) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
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
    lines.push(...wrapText(p, ctx as any, maxW));
  }

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages;
}
