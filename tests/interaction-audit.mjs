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
  await page.waitForFunction(() => [...document.querySelectorAll("[data-carousel-viewport]")]
    .every((viewport) => viewport.classList.contains("swiper-initialized")));
  const carouselViewports = page.locator("[data-carousel-viewport]");
  for (let index = 0; index < await carouselViewports.count(); index += 1) {
    const viewport = carouselViewports.nth(index);
    await viewport.hover();
    await page.mouse.wheel(1200, 0);
    await page.waitForTimeout(50);
    const carouselScrollState = await viewport.evaluate((element) => ({
      className: element.className,
      overflowX: getComputedStyle(element).overflowX,
      scrollLeft: element.scrollLeft,
    }));
    if (carouselScrollState.overflowX !== "hidden" || carouselScrollState.scrollLeft !== 0) {
      throw new Error(`Swiper использует нативную горизонтальную прокрутку: ${JSON.stringify(carouselScrollState)}.`);
    }

    const slideSnapState = await viewport.evaluate(async (element) => {
      const swiper = element.swiper;
      const viewportRect = element.getBoundingClientRect();
      const initialIndex = swiper.activeIndex;
      const slideWidths = [...element.querySelectorAll(".swiper-slide")]
        .map((slide) => slide.getBoundingClientRect().width);
      swiper.slideNext(0);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const activeRect = swiper.slides[swiper.activeIndex].getBoundingClientRect();
      const isReviews = Boolean(element.closest(".reviews"));
      const reviewTextClipped = isReviews
        ? [...element.querySelectorAll(".review-card__text")]
          .some((text) => text.scrollHeight > text.clientHeight + 1)
        : false;
      const state = {
        viewportWidth: viewportRect.width,
        viewportHeight: element.getBoundingClientRect().height,
        slideWidths,
        initialIndex,
        activeIndex: swiper.activeIndex,
        activeOffset: Math.abs(activeRect.left - viewportRect.left),
        activeHeight: activeRect.height,
        isReviews,
        autoHeight: swiper.params.autoHeight,
        reviewTextClipped,
      };
      swiper.slideTo(0, 0);
      return state;
    });
    if (slideSnapState.slideWidths.some((width) => Math.abs(width - slideSnapState.viewportWidth) > 1)
      || slideSnapState.activeIndex !== slideSnapState.initialIndex + 1
      || slideSnapState.activeOffset > 1) {
      throw new Error(`Мобильный Swiper должен показывать и перелистывать ровно один слайд: ${JSON.stringify(slideSnapState)}.`);
    }
    if (slideSnapState.isReviews
      && (!slideSnapState.autoHeight
        || slideSnapState.reviewTextClipped
        || slideSnapState.viewportHeight + 1 < slideSnapState.activeHeight)) {
      throw new Error(`Мобильные отзывы должны полностью помещаться по высоте: ${JSON.stringify(slideSnapState)}.`);
    }
  }
  const mobileMenu = page.locator(".site-header__menu-toggle");
  await mobileMenu.click();
  if (await mobileMenu.getAttribute("aria-expanded") !== "true" || !await page.locator(".site-header__nav").isVisible()) {
    throw new Error("Основное мобильное меню не открывается.");
  }
  const siteHeaderLayout = await page.evaluate(() => {
    const header = document.querySelector(".site-header");
    const actions = header.querySelector(".site-header__actions");
    const toggle = header.querySelector(".site-header__menu-toggle");
    const icon = toggle.querySelector(".site-header__menu-icon");
    const nav = header.querySelector(".site-header__nav");
    const rect = (element) => element.getBoundingClientRect();
    const toggleRect = rect(toggle);
    const iconRect = rect(icon);
    const navRect = rect(nav);
    const headerRect = rect(header);
    return {
      toggleParent: toggle.parentElement === actions,
      iconOffsetX: Math.abs((toggleRect.left + toggleRect.width / 2) - (iconRect.left + iconRect.width / 2)),
      iconOffsetY: Math.abs((toggleRect.top + toggleRect.height / 2) - (iconRect.top + iconRect.height / 2)),
      navRightOffset: Math.abs(headerRect.right - navRect.right),
      items: [...nav.children].map((item) => ({
        height: rect(item).height,
        textAlign: getComputedStyle(item).textAlign,
      })),
    };
  });
  if (!siteHeaderLayout.toggleParent) throw new Error("Бургер и CTA должны находиться в одной action-группе.");
  if (siteHeaderLayout.iconOffsetX > .5 || siteHeaderLayout.iconOffsetY > .5) throw new Error(`Иконка бургера не отцентрирована: ${JSON.stringify(siteHeaderLayout)}.`);
  if (siteHeaderLayout.navRightOffset > .5) throw new Error(`Меню не выровнено по правому краю header: ${JSON.stringify(siteHeaderLayout)}.`);
  if (siteHeaderLayout.items.some((item) => item.height < 44 || item.textAlign !== "right")) throw new Error(`Пункты меню не имеют единой правой оси или touch-зоны 44px: ${JSON.stringify(siteHeaderLayout.items)}.`);
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
  const collegeHeaderLayout = await page.evaluate(() => {
    const header = document.querySelector(".college-header");
    const actions = header.querySelector(".college-header__actions");
    const toggle = header.querySelector(".college-header__menu-toggle");
    const icon = toggle.querySelector(".college-header__menu-icon");
    const nav = header.querySelector(".college-header__nav");
    const rect = (element) => element.getBoundingClientRect();
    const toggleRect = rect(toggle);
    const iconRect = rect(icon);
    return {
      toggleParent: toggle.parentElement === actions,
      iconOffsetX: Math.abs((toggleRect.left + toggleRect.width / 2) - (iconRect.left + iconRect.width / 2)),
      iconOffsetY: Math.abs((toggleRect.top + toggleRect.height / 2) - (iconRect.top + iconRect.height / 2)),
      items: [...nav.children].map((item) => ({
        height: rect(item).height,
        textAlign: getComputedStyle(item).textAlign,
      })),
    };
  });
  if (!collegeHeaderLayout.toggleParent) throw new Error("Бургер колледжа должен находиться в action-группе.");
  if (collegeHeaderLayout.iconOffsetX > .5 || collegeHeaderLayout.iconOffsetY > .5) throw new Error(`Иконка бургера колледжа не отцентрирована: ${JSON.stringify(collegeHeaderLayout)}.`);
  if (collegeHeaderLayout.items.some((item) => item.height < 44 || item.textAlign !== "right")) throw new Error(`Пункты меню колледжа не имеют единой правой оси или touch-зоны 44px: ${JSON.stringify(collegeHeaderLayout.items)}.`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Mobile carousels, menus, tabs, form and image loading audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
