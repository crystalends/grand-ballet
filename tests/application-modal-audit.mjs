import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

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

const differs = (actual, expected) => Object.entries(expected).some(([key, value]) => Math.abs(actual[key] - value) > .1);

const captureModal = async (modal, path) => {
  await modal.evaluate((element) => {
    element.style.top = "0";
    element.style.left = "0";
    element.style.margin = "0";
    element.style.boxShadow = "0 0 0 1000px #1e1e1e";
  });
  await modal.screenshot({ path });
  await modal.evaluate((element) => {
    element.style.removeProperty("top");
    element.style.removeProperty("left");
    element.style.removeProperty("margin");
    element.style.removeProperty("box-shadow");
  });
};

const compareScreenshot = async ({ referencePath, actualPath, diffPath, label }) => {
  const [referenceBuffer, actualBuffer] = await Promise.all([readFile(referencePath), readFile(actualPath)]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error(`Размер ${label} ${actual.width}×${actual.height} не совпал с Figma ${reference.width}×${reference.height}.`);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`${label} visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  if (diffRatio > .05) throw new Error(`Визуальное расхождение ${label} ${(diffRatio * 100).toFixed(2)}% превышает 5%.`);
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
  await page.evaluate(() => document.fonts.ready);

  const trigger = page.locator('.site-header__notice-link[href="#trial"]');
  const trialTrigger = page.locator('.site-header .button--header[href="#trial"]');
  const modal = page.locator(".application-modal");
  if (await trigger.getAttribute("aria-haspopup") !== "dialog" || await trialTrigger.getAttribute("aria-haspopup") !== "dialog") throw new Error("CTA не связаны с модальными формами.");
  if (!await modal.isHidden()) throw new Error("Форма должна быть закрыта при загрузке.");

  await trigger.click();
  if (!await modal.isVisible()) throw new Error("Форма не открывается по CTA.");
  const box = await modal.boundingBox();
  if (!box || differs(box, { x: 537.5, y: 282.5, width: 845, height: 515 })) throw new Error(`Геометрия формы не совпала с Figma: ${JSON.stringify(box)}.`);
  const contentBox = await modal.locator(".application-modal__content").boundingBox();
  if (!contentBox || differs(contentBox, { x: box.x + 60, y: box.y + 60, width: 725, height: 395 })) throw new Error(`Внутренняя геометрия формы не совпала с Figma: ${JSON.stringify(contentBox)}.`);

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/application-modal-actual.png";
  const diffPath = "artifacts/application-modal-diff.png";
  await captureModal(modal, actualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-application-modal.png", actualPath, diffPath, label: "Application modal" });

  await modal.locator(".application-modal__submit").click();
  const status = modal.locator(".application-modal__status");
  if ((await status.textContent())?.trim() !== "Заполните имя и телефон." || !await status.isVisible()) throw new Error("Модальная форма не показывает валидацию обязательных полей.");
  if (await modal.locator('[name="name"]').getAttribute("aria-invalid") !== "true") throw new Error("Первое некорректное поле не отмечено.");

  await modal.locator(".application-modal__close").click();
  if (!await modal.isHidden() || !await trigger.evaluate((element) => element === document.activeElement)) throw new Error("Закрытие не возвращает фокус на CTA.");

  await trialTrigger.click();
  if (!await modal.isVisible() || !await modal.evaluate((element) => element.classList.contains("application-modal--trial"))) throw new Error("CTA «Записаться» не открывает форму пробного занятия.");
  const trialBox = await modal.boundingBox();
  if (!trialBox || differs(trialBox, { x: 537.5, y: 180, width: 845, height: 720 })) throw new Error(`Геометрия формы пробного занятия не совпала с Figma: ${JSON.stringify(trialBox)}.`);
  const trialContentBox = await modal.locator(".application-modal__content").boundingBox();
  if (!trialContentBox || differs(trialContentBox, { x: trialBox.x + 60, y: trialBox.y + 60, width: 725, height: 600 })) throw new Error(`Внутренняя геометрия формы пробного занятия не совпала с Figma: ${JSON.stringify(trialContentBox)}.`);
  if (!await modal.locator('[name="direction"]').isVisible() || await modal.locator('[name="direction"] option').count() < 2) throw new Error("Выбор направления не реализован.");
  const trialActualPath = "artifacts/trial-lesson-modal-actual.png";
  const trialDiffPath = "artifacts/trial-lesson-modal-diff.png";
  await captureModal(modal, trialActualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-trial-lesson-modal.png", actualPath: trialActualPath, diffPath: trialDiffPath, label: "Trial lesson modal" });
  await modal.locator('[name="direction"]').selectOption("adults");
  if (await modal.locator('[name="direction"]').inputValue() !== "adults") throw new Error("Выбор направления не сохраняется в форме.");

  await page.keyboard.press("Escape");
  if (!await modal.isHidden() || !await trialTrigger.evaluate((element) => element === document.activeElement)) throw new Error("Escape не закрывает форму пробного занятия с возвратом фокуса.");
  await trigger.click();
  await page.mouse.click(10, 500);
  if (!await modal.isHidden()) throw new Error("Клик по backdrop не закрывает форму.");

  const franchiseTrigger = page.locator('[data-application-modal="franchise"]');
  if (await franchiseTrigger.getAttribute("aria-haspopup") !== "dialog") throw new Error("Пункт «Франшиза» не связан с модальной формой.");
  await franchiseTrigger.click();
  if (!await modal.isVisible() || !await modal.evaluate((element) => element.classList.contains("application-modal--franchise"))) throw new Error("Пункт «Франшиза» не открывает форму презентации.");
  const franchiseBox = await modal.boundingBox();
  if (!franchiseBox || differs(franchiseBox, { x: 537.5, y: 195, width: 845, height: 690 })) throw new Error(`Геометрия формы франшизы не совпала с Figma: ${JSON.stringify(franchiseBox)}.`);
  const franchiseContentBox = await modal.locator(".application-modal__content").boundingBox();
  if (!franchiseContentBox || differs(franchiseContentBox, { x: franchiseBox.x + 60, y: franchiseBox.y + 60, width: 725, height: 570 })) throw new Error(`Внутренняя геометрия формы франшизы не совпала с Figma: ${JSON.stringify(franchiseContentBox)}.`);
  if ((await modal.locator(".application-modal__title").textContent())?.trim() !== "Получить презентацию франшизы") throw new Error("Заголовок формы франшизы не совпал с Figma.");
  if (await modal.locator('[name="name"]').getAttribute("placeholder") !== "Имя родителя") throw new Error("Поле имени формы франшизы не совпало с Figma.");
  if (!await modal.locator('[name="city"]').isVisible() || !await modal.locator('[name="premises"]').isVisible()) throw new Error("Поля франшизы не отображаются.");
  if (await modal.locator('[name="questionTopic"]').isVisible() || await modal.locator('[name="specialty"]').isVisible() || await modal.locator('[name="direction"]').isVisible()) throw new Error("Поля других вариантов попали в форму франшизы.");
  if ((await modal.locator(".application-modal__submit").textContent())?.trim() !== "Получить презентацию") throw new Error("Текст кнопки формы франшизы не совпал с Figma.");
  const franchiseActualPath = "artifacts/franchise-modal-actual.png";
  const franchiseDiffPath = "artifacts/franchise-modal-diff.png";
  await captureModal(modal, franchiseActualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-franchise-modal.png", actualPath: franchiseActualPath, diffPath: franchiseDiffPath, label: "Franchise modal" });
  await modal.locator('[name="city"]').fill("Москва");
  if (await modal.locator('[name="city"]').inputValue() !== "Москва") throw new Error("Поле города не сохраняет значение.");
  await modal.locator(".application-modal__close").click();
  if (!await modal.isHidden() || !await franchiseTrigger.evaluate((element) => element === document.activeElement)) throw new Error("Форма франшизы не возвращает фокус на пункт навигации.");

  await page.goto(`${BASE_URL}/admissions.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const applicantTrigger = page.locator('.college-header .button--header[href="#trial"]');
  const applicantModal = page.locator(".application-modal");
  await applicantTrigger.click();
  if (!await applicantModal.isVisible() || !await applicantModal.evaluate((element) => element.classList.contains("application-modal--applicant"))) throw new Error("CTA колледжа не открывает форму абитуриента.");
  const applicantBox = await applicantModal.boundingBox();
  if (!applicantBox || differs(applicantBox, { x: 537.5, y: 199.5, width: 845, height: 681 })) throw new Error(`Геометрия формы абитуриента не совпала с Figma: ${JSON.stringify(applicantBox)}.`);
  const applicantContentBox = await applicantModal.locator(".application-modal__content").boundingBox();
  if (!applicantContentBox || differs(applicantContentBox, { x: applicantBox.x + 60, y: applicantBox.y + 60, width: 725, height: 561 })) throw new Error(`Внутренняя геометрия формы абитуриента не совпала с Figma: ${JSON.stringify(applicantContentBox)}.`);
  if (await applicantModal.locator('[name="name"]').getAttribute("placeholder") !== "Имя родителя" || (await applicantModal.locator(".application-modal__name-label").textContent())?.trim() !== "Имя родителя") throw new Error("Поле родителя не настроено для формы абитуриента.");
  if (!await applicantModal.locator('[name="applicantName"]').isVisible() || !await applicantModal.locator('[name="specialty"]').isVisible()) throw new Error("Поля абитуриента не отображаются.");
  if (await applicantModal.locator('[name="direction"]').isVisible()) throw new Error("Поля пробного занятия попали в форму абитуриента.");
  if ((await applicantModal.locator(".application-modal__submit").textContent())?.trim() !== "Подать заявку") throw new Error("Текст кнопки формы абитуриента не совпал с Figma.");
  const applicantActualPath = "artifacts/applicant-modal-actual.png";
  const applicantDiffPath = "artifacts/applicant-modal-diff.png";
  await captureModal(applicantModal, applicantActualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-applicant-modal.png", actualPath: applicantActualPath, diffPath: applicantDiffPath, label: "Applicant modal" });
  await applicantModal.locator('[name="specialty"]').selectOption("ballet");
  if (await applicantModal.locator('[name="specialty"]').inputValue() !== "ballet") throw new Error("Выбор специальности не сохраняется в форме.");
  await applicantModal.locator(".application-modal__close").click();
  if (!await applicantModal.isHidden() || !await applicantTrigger.evaluate((element) => element === document.activeElement)) throw new Error("Форма абитуриента не возвращает фокус на CTA.");

  const questionTrigger = page.locator('.admissions-hero__question[href="#contacts"]');
  if (await questionTrigger.getAttribute("aria-haspopup") !== "dialog") throw new Error("CTA «Задать вопрос» не связан с модальной формой.");
  await questionTrigger.click();
  if (!await applicantModal.isVisible() || !await applicantModal.evaluate((element) => element.classList.contains("application-modal--question"))) throw new Error("CTA «Задать вопрос» не открывает форму вопроса.");
  const questionBox = await applicantModal.boundingBox();
  if (!questionBox || differs(questionBox, { x: 537.5, y: 258, width: 845, height: 564 })) throw new Error(`Геометрия формы вопроса не совпала с Figma: ${JSON.stringify(questionBox)}.`);
  const questionContentBox = await applicantModal.locator(".application-modal__content").boundingBox();
  if (!questionContentBox || differs(questionContentBox, { x: questionBox.x + 60, y: questionBox.y + 60, width: 725, height: 444 })) throw new Error(`Внутренняя геометрия формы вопроса не совпала с Figma: ${JSON.stringify(questionContentBox)}.`);
  if (await applicantModal.locator('[name="name"]').getAttribute("placeholder") !== "Имя родителя" || (await applicantModal.locator(".application-modal__name-label").textContent())?.trim() !== "Имя родителя") throw new Error("Поле родителя не настроено для формы вопроса.");
  if (!await applicantModal.locator('[name="questionTopic"]').isVisible() || await applicantModal.locator('[name="questionTopic"] option').count() < 2) throw new Error("Выбор темы вопроса не реализован.");
  if (await applicantModal.locator('[name="specialty"]').isVisible() || await applicantModal.locator('[name="direction"]').isVisible()) throw new Error("Поля других вариантов попали в форму вопроса.");
  if ((await applicantModal.locator(".application-modal__submit").textContent())?.trim() !== "Отправить вопрос") throw new Error("Текст кнопки формы вопроса не совпал с Figma.");
  const questionActualPath = "artifacts/question-modal-actual.png";
  const questionDiffPath = "artifacts/question-modal-diff.png";
  await captureModal(applicantModal, questionActualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-question-modal.png", actualPath: questionActualPath, diffPath: questionDiffPath, label: "Question modal" });
  await applicantModal.locator('[name="questionTopic"]').selectOption("admission");
  if (await applicantModal.locator('[name="questionTopic"]').inputValue() !== "admission") throw new Error("Выбор темы не сохраняется в форме вопроса.");
  await applicantModal.locator(".application-modal__close").click();
  if (!await applicantModal.isHidden() || !await questionTrigger.evaluate((element) => element === document.activeElement)) throw new Error("Форма вопроса не возвращает фокус на CTA.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  const mobileApplicantTrigger = page.locator('a[href="#trial"]:visible').filter({ hasText: "Подать заявку" }).first();
  await mobileApplicantTrigger.click();
  const mobileApplicantModal = page.locator(".application-modal");
  const mobileApplicantBox = await mobileApplicantModal.boundingBox();
  if (!mobileApplicantBox || Math.abs(mobileApplicantBox.width - 358) > .1 || !await mobileApplicantModal.evaluate((element) => element.classList.contains("application-modal--applicant"))) throw new Error(`Мобильная форма абитуриента некорректна: ${JSON.stringify(mobileApplicantBox)}.`);
  await mobileApplicantModal.locator(".application-modal__close").click();

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const mobileTrigger = page.locator('a[href="#trial"]:visible').filter({ hasText: "Записаться" }).first();
  await mobileTrigger.click();
  const mobileModal = page.locator(".application-modal");
  const mobileBox = await mobileModal.boundingBox();
  if (!mobileBox || Math.abs(mobileBox.width - 358) > .1) throw new Error(`Ширина мобильной формы некорректна: ${JSON.stringify(mobileBox)}.`);
  if (!await mobileModal.evaluate((element) => element.classList.contains("application-modal--trial"))) throw new Error("На мобильном открылась неверная версия формы.");
  const mobileOverflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (mobileOverflow.scroll > mobileOverflow.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobileOverflow.scroll}px.`);
  await mobileModal.locator(".application-modal__close").click();

  const mobileMenuToggle = page.locator(".site-header__menu-toggle");
  await mobileMenuToggle.click();
  const mobileFranchiseTrigger = page.locator('[data-application-modal="franchise"]:visible');
  await mobileFranchiseTrigger.click();
  const mobileFranchiseBox = await mobileModal.boundingBox();
  if (!mobileFranchiseBox || Math.abs(mobileFranchiseBox.width - 358) > .1 || !await mobileModal.evaluate((element) => element.classList.contains("application-modal--franchise"))) throw new Error(`Мобильная форма франшизы некорректна: ${JSON.stringify(mobileFranchiseBox)}.`);
  if (await mobileMenuToggle.getAttribute("aria-expanded") !== "false") throw new Error("Мобильное меню не закрылось после открытия формы франшизы.");
  await mobileModal.locator(".application-modal__close").click();

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Application modal geometry, visual, validation, focus, backdrop and mobile audit: OK");
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
  console.log(`Trial actual: ${trialActualPath}`);
  console.log(`Trial diff: ${trialDiffPath}`);
  console.log(`Applicant actual: ${applicantActualPath}`);
  console.log(`Applicant diff: ${applicantDiffPath}`);
  console.log(`Question actual: ${questionActualPath}`);
  console.log(`Question diff: ${questionDiffPath}`);
  console.log(`Franchise actual: ${franchiseActualPath}`);
  console.log(`Franchise diff: ${franchiseDiffPath}`);
} finally {
  await browser?.close();
  server?.kill();
}
