import { renderPage, paginateText } from "./render";
import { sendFrame, listenButtons } from "./device";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export class ReaderSession {
  private stop: (() => void) | null = null;
  private pages: string[][];
  private pageIdx: number;
  private progressPath: string;
  private ip: string;

  constructor(text: string, bookId: string, ip: string) {
    this.ip = ip;
    this.pages = paginateText(text);
    this.progressPath = join(homedir(), ".config", `rand-0-${bookId}.progress`);
    this.pageIdx = this.loadProgress();
    console.log(`Reader: ${this.pages.length} pages, starting at ${this.pageIdx + 1}`);
  }

  async start() {
    await this.push();
    this.stop = listenButtons(this.ip, async (key) => {
      if (key === "down") this.pageIdx = Math.min(this.pageIdx + 1, this.pages.length - 1);
      if (key === "up")   this.pageIdx = Math.max(this.pageIdx - 1, 0);
      this.saveProgress();
      await this.push().catch(console.error);
    });
  }

  private async push() {
    const page = this.pages[this.pageIdx] ?? [];
    const frame = renderPage(page, this.pageIdx, this.pages.length);
    await sendFrame(this.ip, frame);
    console.log(`Reader: sent page ${this.pageIdx + 1}/${this.pages.length}`);
  }

  private loadProgress(): number {
    try {
      if (existsSync(this.progressPath))
        return Math.max(0, parseInt(readFileSync(this.progressPath, "utf8").trim()) || 0);
    } catch {}
    return 0;
  }

  private saveProgress() {
    try { writeFileSync(this.progressPath, String(this.pageIdx)); } catch {}
  }

  close() {
    this.stop?.();
    this.stop = null;
  }
}
