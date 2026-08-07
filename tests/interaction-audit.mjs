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
  await page.addStyleTag({ content: "html { scrollbar-gutter: stable; }" });
  const mobileDirectionTabsState = await page.locator(".direction-picker__tabs").evaluate((tabs) => {
    tabs.scrollLeft = tabs.scrollWidth;
    const tabsRect = tabs.getBoundingClientRect();
    const buttonBottom = Math.max(...Array.from(tabs.children, (button) => button.getBoundingClientRect().bottom));
    return {
      clientWidth: tabs.clientWidth,
      scrollWidth: tabs.scrollWidth,
      scrollLeft: tabs.scrollLeft,
      scrollbarWidth: getComputedStyle(tabs).scrollbarWidth,
      bottomClearance: tabsRect.bottom - buttonBottom,
    };
  });
  if (mobileDirectionTabsState.scrollWidth <= mobileDirectionTabsState.clientWidth
    || mobileDirectionTabsState.scrollLeft <= 0
    || mobileDirectionTabsState.scrollbarWidth !== "none"
    || mobileDirectionTabsState.bottomClearance < .9) {
    throw new Error(`Табы направлений должны прокручиваться без видимого scrollbar: ${JSON.stringify(mobileDirectionTabsState)}.`);
  }
  const mobileTextarea = page.locator(".trial-form__textarea").first();
  await mobileTextarea.fill("А".repeat(500));
  const mobileTextareaState = await mobileTextarea.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  if (mobileTextareaState.overflowX !== "hidden"
    || mobileTextareaState.scrollWidth > mobileTextareaState.clientWidth + 1) {
    throw new Error(`Textarea допускает горизонтальный скролл: ${JSON.stringify(mobileTextareaState)}.`);
  }
  await mobileTextarea.fill("");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-carousel-viewport]")]
    .every((viewport) => viewport.classList.contains("swiper-initialized")));
  const mobileNewsArrowAlignment = await page.locator(".home-news").evaluate((section) => {
    const image = section.querySelector(".news-card__image").getBoundingClientRect();
    const previous = section.querySelector("[data-carousel-previous]").getBoundingClientRect();
    const next = section.querySelector("[data-carousel-next]").getBoundingClientRect();
    const imageCenter = image.top + image.height / 2;
    return {
      previousDelta: Math.abs(previous.top + previous.height / 2 - imageCenter),
      nextDelta: Math.abs(next.top + next.height / 2 - imageCenter),
    };
  });
  if (mobileNewsArrowAlignment.previousDelta > 1 || mobileNewsArrowAlignment.nextDelta > 1) {
    throw new Error(`Стрелки новостей не выровнены по центру фотографии: ${JSON.stringify(mobileNewsArrowAlignment)}.`);
  }
  const carouselViewports = page.locator("[data-carousel-viewport]");
  for (let index = 0; index < await carouselViewports.count(); index += 1) {
    const viewport = carouselViewports.nth(index);
    const carousel = viewport.locator("xpath=ancestor::*[@data-carousel][1]");
    const previousButton = carousel.locator("[data-carousel-previous]");
    const nextButton = carousel.locator("[data-carousel-next]");
    if (!await previousButton.isVisible() || !await nextButton.isVisible()) {
      throw new Error(`Стрелки мобильной карусели скрыты: ${await carousel.getAttribute("data-carousel-label")}.`);
    }
    const arrowOverlapState = await viewport.evaluate((element) => {
      const carousel = element.closest("[data-carousel]");
      const previous = carousel.querySelector("[data-carousel-previous]").getBoundingClientRect();
      const next = carousel.querySelector("[data-carousel-next]").getBoundingClientRect();
      const viewportRect = element.getBoundingClientRect();
      return {
        previousOverlapsEdge: previous.left < viewportRect.left && previous.right > viewportRect.left,
        nextOverlapsEdge: next.left < viewportRect.right && next.right > viewportRect.right,
        previousInsideViewport: previous.left >= 0,
        nextInsideViewport: next.right <= document.documentElement.clientWidth,
      };
    });
    if (!arrowOverlapState.previousOverlapsEdge
      || !arrowOverlapState.nextOverlapsEdge
      || !arrowOverlapState.previousInsideViewport
      || !arrowOverlapState.nextInsideViewport) {
      throw new Error(`Мобильные стрелки должны частично выступать за края слайда, не выходя за viewport: ${JSON.stringify(arrowOverlapState)}.`);
    }
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

    const initialButtonIndex = await viewport.evaluate((element) => element.swiper.activeIndex);
    await nextButton.click();
    await page.waitForFunction(
      ({ viewportIndex, initialIndex }) => document.querySelectorAll("[data-carousel-viewport]")[viewportIndex].swiper.activeIndex !== initialIndex,
      { viewportIndex: index, initialIndex: initialButtonIndex },
    );
    await previousButton.click();
  }
  const mobileMenu = page.locator(".site-header__menu-toggle");
  await mobileMenu.click();
  if (await mobileMenu.getAttribute("aria-expanded") !== "true" || !await page.locator(".site-header__nav").isVisible()) {
    throw new Error("Основное мобильное меню не открывается.");
  }
  const mobileMenuPhone = page.locator(".site-header__menu-phone");
  if (await mobileMenuPhone.count() !== 1
    || (await mobileMenuPhone.textContent())?.trim() !== "+7(495)125-18-18"
    || await mobileMenuPhone.getAttribute("href") !== "tel:+74951251818") {
    throw new Error("Телефон из header не добавлен в основное мобильное меню.");
  }
  await page.waitForTimeout(1100);
  const directionsToggle = page.locator(".site-header__directions-toggle");
  if (await directionsToggle.count() !== 1
    || await page.locator(".site-header__directions-source-link").evaluate((link) => getComputedStyle(link).display) !== "none") {
    throw new Error("На мобильном ссылка «Направления» должна заменяться одной кнопкой подменю.");
  }
  await directionsToggle.click();
  await page.waitForTimeout(650);
  const directionsSubmenu = await page.evaluate(() => {
    const panel = document.querySelector(".site-header__directions-panel");
    const content = document.querySelector(".site-header__menu-content");
    return {
      expanded: document.querySelector(".site-header__directions-toggle").getAttribute("aria-expanded"),
      panelHeight: panel.getBoundingClientRect().height,
      groupHeadings: [...panel.querySelectorAll(".site-header__directions-heading")].map((heading) => heading.textContent.trim()),
      linkLabels: [...panel.querySelectorAll(".site-header__directions-link")].map((link) => link.textContent.trim()),
      pageHref: panel.querySelector(".site-header__directions-page-link")?.getAttribute("href"),
      pageLabel: panel.querySelector(".site-header__directions-page-link")?.textContent.trim(),
      contentOverflowY: getComputedStyle(content).overflowY,
      contentScrolls: content.scrollHeight > content.clientHeight,
    };
  });
  const expectedDirections = [
    "Балет для детей", "Мама и малыш", "Начальная хореография", "Классическая хореография", "Современная хореография", "Уличные танцы",
    "Балет для взрослых", "Body ballet", "Партерная гимнастика", "Йога", "Телесные практики",
    "Подготовка к поступлению", "Интенсивы", "Индивидуальные занятия", "Аренда залов",
  ];
  if (directionsSubmenu.expanded !== "true"
    || directionsSubmenu.panelHeight < 550
    || directionsSubmenu.groupHeadings.join("|") !== "Для детей|Для взрослых|Дополнительные форматы"
    || directionsSubmenu.linkLabels.join("|") !== expectedDirections.join("|")
    || directionsSubmenu.pageHref !== "directions.html"
    || directionsSubmenu.pageLabel !== "Все направления"
    || directionsSubmenu.contentOverflowY !== "auto"
    || !directionsSubmenu.contentScrolls) {
    throw new Error(`Подменю должно содержать все направления и прокручиваться внутри основной панели: ${JSON.stringify(directionsSubmenu)}.`);
  }
  await page.keyboard.press("Escape");
  if (await directionsToggle.getAttribute("aria-expanded") !== "false"
    || await mobileMenu.getAttribute("aria-expanded") !== "true"
    || !await directionsToggle.evaluate((button) => button === document.activeElement)) {
    throw new Error("Первый Escape должен закрывать только подменю направлений и возвращать фокус на его кнопку.");
  }
  const siteHeaderLayout = await page.evaluate(() => {
    const header = document.querySelector(".site-header");
    const actions = header.querySelector(".site-header__actions");
    const toggle = header.querySelector(".site-header__menu-toggle");
    const icon = toggle.querySelector(".site-header__menu-icon");
    const nav = header.querySelector(".site-header__nav");
    const content = nav.querySelector(".site-header__menu-content");
    const shortcuts = nav.querySelector(".site-header__menu-shortcuts");
    const middleLine = icon.querySelector(".site-header__menu-line--middle");
    const rect = (element) => element.getBoundingClientRect();
    const toggleRect = rect(toggle);
    const iconRect = rect(icon);
    const navRect = rect(nav);
    const headerRect = rect(header);
    const filler = document.createElement("div");
    filler.style.cssText = "height:1000px;flex:0 0 1000px";
    content.append(filler);
    content.scrollTop = 100;
    const internalScrollWorks = content.scrollTop > 0;
    filler.remove();
    content.scrollTop = 0;
    return {
      toggleParent: toggle.parentElement === actions,
      iconOffsetX: Math.abs((toggleRect.left + toggleRect.width / 2) - (iconRect.left + iconRect.width / 2)),
      iconOffsetY: Math.abs((toggleRect.top + toggleRect.height / 2) - (iconRect.top + iconRect.height / 2)),
      iconWidth: iconRect.width,
      iconHeight: iconRect.height,
      navRightOffset: Math.abs(headerRect.right - navRect.right),
      navBottomOffset: window.innerHeight - navRect.bottom,
      navPosition: getComputedStyle(nav).position,
      navTransitionProperties: getComputedStyle(nav).transitionProperty,
      panelTransitionProperties: getComputedStyle(nav, "::after").transitionProperty,
      panelTransitionTiming: getComputedStyle(nav, "::after").transitionTimingFunction,
      lineCount: icon.querySelectorAll(".site-header__menu-line").length,
      middleLineDuration: getComputedStyle(middleLine).transitionDuration,
      middleLineDelay: getComputedStyle(middleLine).transitionDelay,
      bodyScrollLocked: getComputedStyle(document.body).overflow === "hidden",
      contentOverflowY: getComputedStyle(content).overflowY,
      internalScrollWorks,
      shortcutLabels: [...shortcuts.querySelectorAll(".site-header__menu-shortcut")].map((item) => item.textContent.trim()),
      shortcutLinkCount: shortcuts.querySelectorAll("a").length,
      items: [...content.children].map((item) => ({
        isPhone: item.classList.contains("site-header__menu-phone"),
        isDirections: item.classList.contains("site-header__directions"),
        height: rect(item).height,
        textAlign: getComputedStyle(item).textAlign,
      })),
    };
  });
  if (!siteHeaderLayout.toggleParent) throw new Error("Бургер и CTA должны находиться в одной action-группе.");
  if (siteHeaderLayout.iconOffsetX > .5 || siteHeaderLayout.iconOffsetY > .5) throw new Error(`Иконка бургера не отцентрирована: ${JSON.stringify(siteHeaderLayout)}.`);
  if (siteHeaderLayout.iconWidth !== 30 || siteHeaderLayout.iconHeight !== 20 || siteHeaderLayout.lineCount !== 3) throw new Error(`Бургер должен повторять трёхлинейную структуру из /old: ${JSON.stringify(siteHeaderLayout)}.`);
  if (siteHeaderLayout.navRightOffset > .5) throw new Error(`Меню не выровнено по правому краю header: ${JSON.stringify(siteHeaderLayout)}.`);
  if (siteHeaderLayout.navPosition !== "fixed" || Math.abs(siteHeaderLayout.navBottomOffset - 16) > .5) throw new Error(`Мобильное меню должно заканчиваться в 16px от низа viewport: ${JSON.stringify(siteHeaderLayout)}.`);
  if (!siteHeaderLayout.navTransitionProperties.includes("visibility")
    || !siteHeaderLayout.panelTransitionProperties.includes("width")
    || !siteHeaderLayout.panelTransitionProperties.includes("height")
    || !siteHeaderLayout.panelTransitionTiming.includes("cubic-bezier(0.77, 0, 0.175, 1)")) {
    throw new Error(`Не перенесено круговое раскрытие панели из /old: ${JSON.stringify(siteHeaderLayout)}.`);
  }
  if (siteHeaderLayout.middleLineDuration.split(", ").some((duration) => duration !== "0.7s") || siteHeaderLayout.middleLineDelay !== "0.5s") throw new Error(`Тайминги превращения бургера в крест не соответствуют /old: ${JSON.stringify(siteHeaderLayout)}.`);
  if (!siteHeaderLayout.bodyScrollLocked) throw new Error("При открытом мобильном меню прокрутка страницы должна блокироваться.");
  if (siteHeaderLayout.contentOverflowY !== "auto" || !siteHeaderLayout.internalScrollWorks) throw new Error(`Прокрутка должна работать только внутри контента меню: ${JSON.stringify(siteHeaderLayout)}.`);
  if (siteHeaderLayout.shortcutLabels.join("|") !== "Для детей|Для взрослых" || siteHeaderLayout.shortcutLinkCount !== 0) {
    throw new Error(`Верхние пункты направлений должны быть неактивными: ${JSON.stringify(siteHeaderLayout)}.`);
  }
  if (siteHeaderLayout.items.some((item) => (!item.isDirections && item.height < 44) || item.textAlign !== "left")) {
    throw new Error(`Пункты меню не имеют заданного выравнивания или touch-зоны 44px: ${JSON.stringify(siteHeaderLayout.items)}.`);
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
  const collegeHeaderLayout = await page.evaluate(() => {
    const header = document.querySelector(".college-header");
    const actions = header.querySelector(".college-header__actions");
    const toggle = header.querySelector(".college-header__menu-toggle");
    const icon = toggle.querySelector(".college-header__menu-icon");
    const referenceButton = actions.querySelector(".college-header__icon-button");
    const phoneIcon = actions.querySelector('.college-header__icon-button[href^="tel:"] .college-header__icon');
    const nav = header.querySelector(".college-header__nav");
    const content = nav.querySelector(".college-header__menu-content");
    const rect = (element) => element.getBoundingClientRect();
    const toggleRect = rect(toggle);
    const iconRect = rect(icon);
    const referenceButtonRect = rect(referenceButton);
    const phoneIconRect = rect(phoneIcon);
    return {
      toggleParent: toggle.parentElement === actions,
      iconOffsetX: Math.abs((toggleRect.left + toggleRect.width / 2) - (iconRect.left + iconRect.width / 2)),
      iconOffsetY: Math.abs((toggleRect.top + toggleRect.height / 2) - (iconRect.top + iconRect.height / 2)),
      toggleWidth: toggleRect.width,
      toggleHeight: toggleRect.height,
      referenceButtonWidth: referenceButtonRect.width,
      referenceButtonHeight: referenceButtonRect.height,
      menuIconWidth: iconRect.width,
      menuIconHeight: iconRect.height,
      phoneIconWidth: phoneIconRect.width,
      phoneIconHeight: phoneIconRect.height,
      lineCount: icon.querySelectorAll(".college-header__menu-line").length,
      items: [...content.children].map((item) => ({
        height: rect(item).height,
        textAlign: getComputedStyle(item).textAlign,
      })),
    };
  });
  if (!collegeHeaderLayout.toggleParent) throw new Error("Бургер колледжа должен находиться в action-группе.");
  if (collegeHeaderLayout.iconOffsetX > .5 || collegeHeaderLayout.iconOffsetY > .5) throw new Error(`Иконка бургера колледжа не отцентрирована: ${JSON.stringify(collegeHeaderLayout)}.`);
  if (collegeHeaderLayout.toggleWidth !== collegeHeaderLayout.referenceButtonWidth
    || collegeHeaderLayout.toggleHeight !== collegeHeaderLayout.referenceButtonHeight
    || collegeHeaderLayout.menuIconWidth !== 30
    || collegeHeaderLayout.menuIconHeight !== 20
    || collegeHeaderLayout.lineCount !== 3
    || collegeHeaderLayout.phoneIconWidth !== 20
    || collegeHeaderLayout.phoneIconHeight !== 20) {
    throw new Error(`Бургер колледжа должен использовать новую трёхлинейную анимацию в прежней touch-зоне: ${JSON.stringify(collegeHeaderLayout)}.`);
  }
  if (collegeHeaderLayout.items.some((item) => item.height < 44 || item.textAlign !== "left")) throw new Error(`Пункты меню колледжа не имеют единой левой оси или touch-зоны 44px: ${JSON.stringify(collegeHeaderLayout.items)}.`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Mobile carousels, menus, tabs, form and image loading audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
