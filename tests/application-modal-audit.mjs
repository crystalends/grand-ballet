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

const expectHref = async (page, selector, expectedHref) => {
  const link = page.locator(selector).first();
  if (await link.getAttribute("href") !== expectedHref) {
    throw new Error(`Ссылка ${selector} должна вести на ${expectedHref}.`);
  }
  if (await link.getAttribute("aria-haspopup") === "dialog") {
    throw new Error(`Страничная ссылка ${selector} не должна открывать модальное окно.`);
  }
};

const modalExpectations = {
  application: { title: "Оставьте заявку", field: null },
  trial: { title: "Записаться на пробное занятие", field: "[data-trial-field]" },
  applicant: { title: "Заявка для абитуриента", field: "[data-applicant-field]" },
  question: { title: "Задать вопрос", field: "[data-question-field]" },
  franchise: { title: "Получить презентацию франшизы", field: "[data-franchise-field]" },
};

const expectModalVariant = async (page, selector, variant, { fallbackHref = null } = {}) => {
  const trigger = page.locator(selector).first();
  const modal = page.locator(".application-modal");
  const expectation = modalExpectations[variant];
  const tagName = await trigger.evaluate((element) => element.tagName);
  const href = await trigger.getAttribute("href");
  if (fallbackHref) {
    if (tagName !== "A" || href !== fallbackHref) {
      throw new Error(`CTA ${selector} должен сохранять резервную ссылку ${fallbackHref}.`);
    }
  } else if (tagName !== "BUTTON" || href !== null) {
    throw new Error(`Действие ${selector} должно быть кнопкой, а не ссылкой.`);
  }
  if (await trigger.getAttribute("data-application-modal") !== variant || await trigger.getAttribute("aria-haspopup") !== "dialog") {
    throw new Error(`Кнопка ${selector} не связана с вариантом модалки ${variant}.`);
  }
  await trigger.click();
  if (!await modal.isVisible() || await modal.getAttribute("data-variant") !== variant) {
    throw new Error(`Кнопка ${selector} не открывает вариант модалки ${variant}.`);
  }
  if (await modal.locator(".application-modal__title").textContent() !== expectation.title) {
    throw new Error(`У варианта ${variant} неверный заголовок.`);
  }
  if (expectation.field && !await modal.locator(expectation.field).first().isVisible()) {
    throw new Error(`У варианта ${variant} отсутствуют специальные поля.`);
  }
  await modal.locator(".application-modal__close").click();
  if (!await modal.isHidden()) throw new Error(`Вариант модалки ${variant} не закрывается.`);
};

const getMobileModalState = async (modal) => modal.evaluate((dialog) => {
  const content = dialog.querySelector(".application-modal__content");
  const close = dialog.querySelector(".application-modal__close");
  const subtitle = dialog.querySelector(".application-modal__subtitle");
  const submit = dialog.querySelector(".application-modal__submit");
  const fieldPair = dialog.querySelector(".application-modal__field-pair");
  const inputs = [...dialog.querySelectorAll(".application-modal__input")]
    .filter((input) => !input.closest("[hidden]"));
  const rect = dialog.getBoundingClientRect();
  const closeRect = close.getBoundingClientRect();
  const closeTopBeforeScroll = closeRect.top;
  content.scrollTop = content.scrollHeight;
  const closeTopAfterScroll = close.getBoundingClientRect().top;
  const contentRect = content.getBoundingClientRect();
  const submitRect = submit.getBoundingClientRect();
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom },
    dialogOverflowY: getComputedStyle(dialog).overflowY,
    contentOverflowY: getComputedStyle(content).overflowY,
    contentClientHeight: content.clientHeight,
    contentScrollHeight: content.scrollHeight,
    contentClientWidth: content.clientWidth,
    contentScrollWidth: content.scrollWidth,
    closeWidth: closeRect.width,
    closeHeight: closeRect.height,
    closeScrollDelta: Math.abs(closeTopAfterScroll - closeTopBeforeScroll),
    subtitleClipped: subtitle.scrollHeight > subtitle.clientHeight + 1,
    fieldPairDirection: getComputedStyle(fieldPair).flexDirection,
    minimumInputHeight: Math.min(...inputs.map((input) => input.getBoundingClientRect().height)),
    submitVisibleAfterScroll: submitRect.top >= contentRect.top - 1 && submitRect.bottom <= contentRect.bottom + 1,
  };
});

const assertMobileModal = (viewport, state) => {
  const maxWidth = Math.min(560, viewport.width - 16);
  if (state.rect.width > maxWidth + 1 || state.rect.x < 7 || state.rect.bottom > viewport.height - 7) {
    throw new Error(`Форма выходит за mobile viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(state.rect)}.`);
  }
  if (state.dialogOverflowY !== "hidden" || state.contentOverflowY !== "auto") {
    throw new Error(`Прокрутка должна находиться внутри application-modal__content: ${JSON.stringify(state)}.`);
  }
  if (state.contentScrollWidth > state.contentClientWidth || state.subtitleClipped) {
    throw new Error(`Содержимое формы обрезано или имеет горизонтальное переполнение: ${JSON.stringify(state)}.`);
  }
  if (state.closeWidth < 44 || state.closeHeight < 44 || state.closeScrollDelta > .5) {
    throw new Error(`Кнопка закрытия должна иметь touch-зону 44px и оставаться на месте: ${JSON.stringify(state)}.`);
  }
  if (state.fieldPairDirection !== "column" || state.minimumInputHeight < 48 || !state.submitVisibleAfterScroll) {
    throw new Error(`Поля формы не адаптированы для touch-ввода: ${JSON.stringify(state)}.`);
  }
};

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await Promise.all([
    expectHref(page, ".site-header__notice-link", "service.html"),
    expectHref(page, '.site-header__nav-link:has-text("Направления")', "service.html"),
    expectHref(page, '.site-header__nav-link:has-text("Колледж")', "college.html"),
    expectHref(page, '.site-header__nav-link:has-text("Интенсивы")', "service.html"),
    expectHref(page, '.site-header__nav-link:has-text("Педагоги")', "teachers.html"),
    expectHref(page, '.site-header__nav-link:has-text("О школе")', "about.html"),
    expectHref(page, '.site-header__nav-link:has-text("Контакты")', "halls.html"),
  ]);

  await expectModalVariant(page, ".site-header .button--header", "trial", { fallbackHref: "service.html" });

  await Promise.all([
    page.waitForURL(`${BASE_URL}/service.html`),
    page.locator('.site-header__nav-link:has-text("Направления")').click(),
  ]);

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const franchiseTrigger = page.locator('[data-application-modal="franchise"]');
  const modal = page.locator(".application-modal");
  if (await franchiseTrigger.getAttribute("aria-haspopup") !== "dialog") throw new Error("Пункт «Франшиза» не связан с модальной формой.");
  await franchiseTrigger.click();
  if (!await modal.isVisible() || !await modal.evaluate((element) => element.classList.contains("application-modal--franchise"))) {
    throw new Error("Пункт «Франшиза» не открывает форму презентации.");
  }
  await modal.locator(".application-modal__close").click();
  if (!await modal.isHidden()) throw new Error("Форма франшизы не закрывается.");

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const menuToggle = page.locator(".site-header__menu-toggle");
    await menuToggle.click();
    await franchiseTrigger.click();
    if (!await modal.locator(".application-modal__close").evaluate((button) => button === document.activeElement)) {
      throw new Error(`Фокус не установлен на кнопку закрытия при ${viewport.width}x${viewport.height}.`);
    }
    assertMobileModal(viewport, await getMobileModalState(modal));
    if (!await page.locator("body").evaluate((body) => body.classList.contains("is-dialog-open"))) {
      throw new Error(`Прокрутка страницы не заблокирована при ${viewport.width}x${viewport.height}.`);
    }
    await modal.locator(".application-modal__close").click();
    await page.waitForFunction((button) => button === document.activeElement, await menuToggle.elementHandle());
  }

  await page.goto(`${BASE_URL}/admissions.html`, { waitUntil: "networkidle" });
  await Promise.all([
    expectHref(page, ".college-header__notice a", "admissions.html"),
  ]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectModalVariant(page, ".college-header .button--header", "applicant", { fallbackHref: "admissions.html" });
  await expectModalVariant(page, '.admissions-hero__actions [data-application-modal="applicant"]', "applicant");
  await expectModalVariant(page, '.admissions-hero__actions [data-application-modal="question"]', "question");

  await page.goto(`${BASE_URL}/service.html`, { waitUntil: "networkidle" });
  await expectModalVariant(page, '.service-hero__actions [data-application-modal="trial"]', "trial");
  await expectModalVariant(page, '.service-hero__actions [data-application-modal="application"]', "application");

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await expectModalVariant(page, '.promo-card [data-application-modal="trial"]', "trial");

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Page navigation and all application modal variants audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
