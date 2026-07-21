import { spawn } from "node:child_process";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:8080";

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
  throw new Error("Локальный сервер не запустился на порту 8080.");
};

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });

  for (const file of ["index.html", "service.html", "about.html", "college.html"]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto(`${BASE_URL}/${file}`, { waitUntil: "networkidle" });

    const firstCard = page.locator(".teacher-card").first();
    const trigger = firstCard.locator(".teacher-card__trigger");
    const expectedName = (await firstCard.locator(".teacher-card__name").textContent())?.trim();
    const expectedImage = await firstCard.locator(".teacher-card__image").getAttribute("src");
    await trigger.focus();
    await trigger.press("Enter");

    const modal = page.locator(".teacher-modal");
    if (!await modal.evaluate((dialog) => dialog.open)) throw new Error(`${file}: модалка не открылась.`);
    if ((await modal.locator(".teacher-modal__name").textContent())?.trim() !== expectedName) throw new Error(`${file}: имя педагога не перенесено в модалку.`);
    if (await modal.locator(".teacher-modal__image").getAttribute("src") !== expectedImage) throw new Error(`${file}: фотография педагога не перенесена в модалку.`);
    if (!await modal.locator(".teacher-modal__close").evaluate((button) => button === document.activeElement)) throw new Error(`${file}: фокус не установлен на кнопку закрытия.`);
    if (!await page.locator("body").evaluate((body) => body.classList.contains("is-dialog-open"))) throw new Error(`${file}: прокрутка страницы не заблокирована.`);

    const modalBox = await modal.boundingBox();
    const expectedModal = { x: 450, y: 136.5, width: 1020, height: 806 };
    if (!modalBox || Object.entries(expectedModal).some(([key, value]) => Math.abs(modalBox[key] - value) > .1)) {
      throw new Error(`${file}: позиционирование desktop-модалки не соответствует Figma: ${JSON.stringify(modalBox)}.`);
    }

    const innerBoxes = await modal.evaluate((dialog) => {
      const box = (selector) => {
        const modalRect = dialog.getBoundingClientRect();
        const rect = dialog.querySelector(selector).getBoundingClientRect();
        return { x: rect.x - modalRect.x, y: rect.y - modalRect.y, width: rect.width, height: rect.height };
      };
      return {
        image: box(".teacher-modal__image"),
        details: box(".teacher-modal__details"),
        close: box(".teacher-modal__close"),
        scrollbar: box(".teacher-modal__scrollbar"),
      };
    });
    const expectedInnerBoxes = {
      image: { x: 60, y: 60, width: 370, height: 410 },
      details: { x: 450, y: 60, width: 500, height: 686 },
      close: { x: 976, y: 20, width: 24, height: 24 },
      scrollbar: { x: 996, y: 60, width: 4, height: 686 },
    };
    for (const [part, expected] of Object.entries(expectedInnerBoxes)) {
      if (Object.entries(expected).some(([key, value]) => Math.abs(innerBoxes[part][key] - value) > .1)) {
        throw new Error(`${file}: ${part} позиционирован не по Figma: ${JSON.stringify(innerBoxes[part])}.`);
      }
    }

    await page.keyboard.press("Escape");
    if (await modal.evaluate((dialog) => dialog.open)) throw new Error(`${file}: Escape не закрыл модалку.`);
    if (!await trigger.evaluate((button) => button === document.activeElement)) throw new Error(`${file}: фокус не вернулся на карточку.`);

    await trigger.click();
    await page.mouse.click(8, 8);
    if (await modal.evaluate((dialog) => dialog.open)) throw new Error(`${file}: клик по фону не закрыл модалку.`);

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    const mobileSize = await modal.evaluate((dialog) => ({ width: dialog.getBoundingClientRect().width, scroll: dialog.scrollWidth }));
    if (mobileSize.width > 358 || mobileSize.scroll > mobileSize.width) throw new Error(`${file}: модалка выходит за мобильный viewport.`);
    await modal.locator(".teacher-modal__close").click();

    if (consoleErrors.length) throw new Error(`${file}: ошибки консоли: ${consoleErrors.join(" | ")}`);
    await page.close();
  }

  console.log("Teacher modal desktop, mobile, keyboard and focus audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
