import { spawn } from "node:child_process";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:8080";

const isServerReady = () => new Promise((resolve) => {
  const req = request(BASE_URL, (response) => {
    response.resume();
    resolve(response.statusCode === 200);
  });
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

const getExecutablePath = () => process.env.BROWSER_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: getExecutablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const desktopMenu = page.locator(".site-header__menu-toggle");
  if (await desktopMenu.evaluate((button) => getComputedStyle(button).display) !== "none") {
    throw new Error("Кнопка мобильного меню видна на desktop.");
  }

  const adultsTab = page.locator("#direction-tab-adults");
  await adultsTab.click();
  if (await adultsTab.getAttribute("aria-selected") !== "true" || await adultsTab.getAttribute("tabindex") !== "0") {
    throw new Error("Tabs не обновляют доступное активное состояние.");
  }
  if ((await page.locator(".direction-card__title").first().textContent())?.trim() !== "Балет для взрослых") {
    throw new Error("Tabs не обновляют содержимое направлений.");
  }
  if (await page.locator("#direction-panel").getAttribute("aria-labelledby") !== "direction-tab-adults") {
    throw new Error("Tabpanel не связан с активной вкладкой.");
  }

  const form = page.locator(".trial-form");
  await form.locator(".trial-form__submit").click();
  if ((await form.locator(".trial-form__status").textContent())?.trim() !== "Заполните имя и телефон.") {
    throw new Error("Форма не сообщает об обязательных полях.");
  }
  if (await form.locator('[name="name"]').getAttribute("aria-invalid") !== "true") {
    throw new Error("Форма не отмечает первое некорректное поле.");
  }
  await form.locator('[name="name"]').fill("Анна");
  await form.locator('[name="phone"]').fill("+7 999 123-45-67");
  await form.locator('[name="consent"]').check();
  await form.locator(".trial-form__submit").click();
  if (!(await form.locator(".trial-form__status").textContent())?.includes("отправки заявки позвоните")) {
    throw new Error("Форма должна честно сообщать доступный способ отправки заявки.");
  }

  const imageAudit = await page.evaluate(() => ({
    priorityHero: document.querySelectorAll('.home-hero__main-image[fetchpriority="high"]').length,
  }));
  if (imageAudit.priorityHero !== 1) {
    throw new Error(`Атрибуты загрузки изображений настроены не полностью: ${JSON.stringify(imageAudit)}.`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  const mobileMenu = page.locator(".site-header__menu-toggle");
  await mobileMenu.click();
  if (await mobileMenu.getAttribute("aria-expanded") !== "true" || !await page.locator(".site-header__nav").isVisible()) {
    throw new Error("Основное мобильное меню не открывается.");
  }
  await page.keyboard.press("Escape");
  if (await mobileMenu.getAttribute("aria-expanded") !== "false" || !await mobileMenu.evaluate((button) => button === document.activeElement)) {
    throw new Error("Основное мобильное меню не закрывается по Escape с возвратом фокуса.");
  }

  await page.goto(`${BASE_URL}/college.html`, { waitUntil: "networkidle" });
  const collegeMenu = page.locator(".college-header__menu-toggle");
  await collegeMenu.click();
  if (await collegeMenu.getAttribute("aria-expanded") !== "true" || !await page.locator(".college-header__nav").isVisible()) {
    throw new Error("Мобильное меню колледжа не открывается.");
  }

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Mobile menus, tabs, form and image loading audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
