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

const getMobileModalState = async (modal) => modal.evaluate((dialog) => {
  const body = dialog.querySelector(".teacher-modal__body");
  const close = dialog.querySelector(".teacher-modal__close");
  const image = dialog.querySelector(".teacher-modal__image");
  const details = dialog.querySelector(".teacher-modal__details");
  const lastSection = dialog.querySelector(".teacher-modal__section:last-child");
  const rect = dialog.getBoundingClientRect();
  const closeRect = close.getBoundingClientRect();
  const detailsVisibleAtStart = details.getBoundingClientRect().top < rect.bottom;
  const closeTopBeforeScroll = closeRect.top;
  body.scrollTop = body.scrollHeight;
  const closeTopAfterScroll = close.getBoundingClientRect().top;
  const bodyRect = body.getBoundingClientRect();
  const lastSectionRect = lastSection.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom },
    dialogOverflowY: getComputedStyle(dialog).overflowY,
    bodyOverflowY: getComputedStyle(body).overflowY,
    bodyClientHeight: body.clientHeight,
    bodyScrollHeight: body.scrollHeight,
    bodyClientWidth: body.clientWidth,
    bodyScrollWidth: body.scrollWidth,
    closeWidth: closeRect.width,
    closeHeight: closeRect.height,
    closeScrollDelta: Math.abs(closeTopAfterScroll - closeTopBeforeScroll),
    imageRatio: imageRect.width / imageRect.height,
    detailsVisibleAtStart,
    lastSectionVisibleAfterScroll: lastSectionRect.bottom <= bodyRect.bottom + 1,
  };
});

const assertMobileModal = (file, viewport, state) => {
  const maxWidth = Math.min(560, viewport.width - 16);
  if (state.rect.width > maxWidth + 1 || state.rect.x < 7 || state.rect.bottom > viewport.height - 7) {
    throw new Error(`${file}: модалка выходит за mobile viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(state.rect)}.`);
  }
  if (state.dialogOverflowY !== "hidden" || state.bodyOverflowY !== "auto") {
    throw new Error(`${file}: прокрутка должна находиться внутри teacher-modal__body: ${JSON.stringify(state)}.`);
  }
  if (state.bodyScrollHeight <= state.bodyClientHeight || state.bodyScrollWidth > state.bodyClientWidth) {
    throw new Error(`${file}: внутренняя прокрутка модалки настроена некорректно: ${JSON.stringify(state)}.`);
  }
  if (state.closeWidth < 44 || state.closeHeight < 44 || state.closeScrollDelta > .5) {
    throw new Error(`${file}: кнопка закрытия должна иметь touch-зону 44px и оставаться на месте: ${JSON.stringify(state)}.`);
  }
  if (Math.abs(state.imageRatio - (4 / 3)) > .02 || !state.detailsVisibleAtStart || !state.lastSectionVisibleAfterScroll) {
    throw new Error(`${file}: мобильная композиция педагога некорректна: ${JSON.stringify(state)}.`);
  }
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

  for (const file of ["index.html", "service.html", "about.html", "college.html", "teachers.html", "college-teachers.html"]) {
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

    const mobileViewport = { width: 390, height: 844 };
    await page.setViewportSize(mobileViewport);
    await trigger.click();
    assertMobileModal(file, mobileViewport, await getMobileModalState(modal));
    await modal.locator(".teacher-modal__close").click();

    if (file === "index.html") {
      const landscapeViewport = { width: 844, height: 390 };
      await page.setViewportSize(landscapeViewport);
      await trigger.click();
      assertMobileModal(file, landscapeViewport, await getMobileModalState(modal));
      await modal.locator(".teacher-modal__close").click();
    }

    if (consoleErrors.length) throw new Error(`${file}: ошибки консоли: ${consoleErrors.join(" | ")}`);
    await page.close();
  }

  console.log("Teacher modal desktop, mobile, keyboard and focus audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
