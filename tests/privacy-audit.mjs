import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const PORT = Number(process.env.PRIVACY_AUDIT_PORT || 8095);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${BASE_URL}/privacy.html`;

const isServerReady = () => new Promise((resolve) => {
  const req = request(BASE_URL, (response) => { response.resume(); resolve(response.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.end();
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Локальный сервер не запустился на порту ${PORT}.`);
};

const VIEWPORTS = [1920, 1281, 900, 390];

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  for (const viewportWidth of VIEWPORTS) {
    await page.setViewportSize({ width: viewportWidth, height: 1080 });
    await page.goto(PAGE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const audit = await page.evaluate(() => {
      const main = document.querySelector("main");
      const section = document.querySelector(".privacy-section");
      const footer = document.querySelector(".site-footer");
      const sectionRect = section?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const style = section ? getComputedStyle(section) : null;
      const firstHeadingStyle = section ? getComputedStyle(section.querySelector("h1")) : null;
      const secondHeadingStyle = section ? getComputedStyle(section.querySelector("h2")) : null;
      const paragraphStyle = section ? getComputedStyle(section.querySelectorAll("p")[1]) : null;
      const thirdHeadingStyle = section ? getComputedStyle(section.querySelector("h3")) : null;

      return {
        mainChildCount: main?.children.length,
        mainChildClass: main?.firstElementChild?.className,
        sectionCount: document.querySelectorAll(".privacy-section").length,
        legacyCount: document.querySelectorAll(".privacy-heading, .privacy-article, .privacy-section__copy, .privacy-point").length,
        nestedClassCount: section?.querySelectorAll("[class]").length,
        invalidTags: section ? [...section.children]
          .map((node) => node.tagName)
          .filter((tagName) => !["P", "BR", "H1", "H2", "H3", "UL"].includes(tagName)) : [],
        breakCount: section?.querySelectorAll("br").length,
        display: style?.display,
        minHeight: style?.minHeight,
        overflowY: style?.overflowY,
        headingMargin: firstHeadingStyle?.marginBottom,
        subheadingMargin: secondHeadingStyle?.marginBottom,
        paragraphMargin: paragraphStyle?.marginBottom,
        pointMargin: thirdHeadingStyle?.marginBottom,
        sectionLeft: sectionRect?.left,
        sectionRight: sectionRect?.right,
        sectionBottom: sectionRect?.bottom,
        footerTop: footerRect?.top,
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
      };
    });

    if (audit.mainChildCount !== 1 || audit.mainChildClass !== "privacy-section" || audit.sectionCount !== 1) {
      throw new Error(`${viewportWidth}px: в main должна остаться одна .privacy-section. ${JSON.stringify(audit)}`);
    }
    if (audit.legacyCount || audit.nestedClassCount || audit.invalidTags.length) {
      throw new Error(`${viewportWidth}px: внутри текстовой секции осталась лишняя структура. ${JSON.stringify(audit)}`);
    }
    if (audit.breakCount !== 14 || audit.display !== "block" || audit.minHeight !== "0px" || audit.overflowY !== "visible") {
      throw new Error(`${viewportWidth}px: секция не соответствует обычному потоковому блоку. ${JSON.stringify(audit)}`);
    }
    if (audit.headingMargin !== "40px" || audit.subheadingMargin !== "20px" || audit.paragraphMargin !== "10px" || audit.pointMargin !== "5px") {
      throw new Error(`${viewportWidth}px: неверные обычные отступы текста. ${JSON.stringify(audit)}`);
    }
    if (audit.sectionLeft < -1 || audit.sectionRight > audit.viewport + 1 || audit.scroll > audit.viewport) {
      throw new Error(`${viewportWidth}px: появился горизонтальный скролл. ${JSON.stringify(audit)}`);
    }
    if (audit.footerTop < audit.sectionBottom - 1) {
      throw new Error(`${viewportWidth}px: footer накладывается на текст. ${JSON.stringify(audit)}`);
    }
    if (audit.broken) throw new Error(`${viewportWidth}px: не загрузились изображения: ${audit.broken}.`);

    if (viewportWidth === 1920) {
      await mkdir("artifacts", { recursive: true });
      await page.screenshot({ path: "artifacts/privacy-actual.png", fullPage: true });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const growth = await page.evaluate(() => {
    const section = document.querySelector(".privacy-section");
    const footer = document.querySelector(".site-footer");
    const before = {
      sectionHeight: section.getBoundingClientRect().height,
      footerTop: footer.getBoundingClientRect().top,
    };
    section.querySelectorAll("p").forEach((paragraph) => {
      paragraph.textContent += ` ${paragraph.textContent} ${paragraph.textContent}`;
    });
    const sectionRect = section.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      sectionGrowth: sectionRect.height - before.sectionHeight,
      footerShift: footerRect.top - before.footerTop,
      overlap: sectionRect.bottom - footerRect.top,
      scroll: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    };
  });
  if (growth.sectionGrowth <= 0 || growth.footerShift < growth.sectionGrowth - 1 || growth.overlap > 1 || growth.scroll > growth.viewport) {
    throw new Error(`Секция не растягивается за увеличенным текстом: ${JSON.stringify(growth)}`);
  }
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);

  console.log("Privacy page single-section flow and responsive growth audit: OK");
  console.log("Actual: artifacts/privacy-actual.png");
} finally {
  await browser?.close();
  server?.kill();
}
