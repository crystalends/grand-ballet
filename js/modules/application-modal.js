import { initTrialForm } from "./trial-form.js";

const modalContent = {
  application: {
    title: "Оставьте заявку",
    subtitle: "Мы свяжемся с вами, ответим на вопросы и поможем подобрать подходящий формат занятий",
  },
  trial: {
    title: "Записаться на пробное занятие",
    subtitle: "Оставьте контакты, и мы подберём направление, группу, педагога и удобный адрес.",
  },
  applicant: {
    title: "Заявка для абитуриента",
    subtitle: "Оставьте данные, и мы расскажем об условиях поступления, специальностях, документах и вступительных испытаниях.",
  },
  question: {
    title: "Задать вопрос",
    subtitle: "Напишите, что хотите уточнить, и мы передадим вопрос ответственному специалисту.",
  },
  franchise: {
    title: "Получить презентацию франшизы",
    subtitle: "Оставьте контакты, и мы расскажем об условиях сотрудничества, модели запуска и возможностях открытия школы в вашем городе.",
  },
};

const modalVariants = new Set(Object.keys(modalContent));

const createCloseIcon = () => `
  <span class="application-modal__close-icon" aria-hidden="true">
    <img class="application-modal__close-line application-modal__close-line--horizontal" src="assets/images/application-modal-close-line-a.svg" alt="">
    <img class="application-modal__close-line application-modal__close-line--vertical" src="assets/images/application-modal-close-line-b.svg" alt="">
  </span>
`;

const createModal = () => {
  const modal = document.createElement("dialog");
  modal.className = "application-modal";
  modal.setAttribute("aria-labelledby", "application-modal-title");
  modal.innerHTML = `
    <button class="application-modal__close" type="button" aria-label="Закрыть форму заявки">
      ${createCloseIcon()}
    </button>
    <div class="application-modal__content">
      <div class="application-modal__heading">
        <h2 class="application-modal__title" id="application-modal-title">Оставьте заявку</h2>
        <p class="application-modal__subtitle">Мы свяжемся с вами, ответим на вопросы и поможем подобрать подходящий формат занятий</p>
      </div>
      <form class="application-modal__form" novalidate>
        <div class="application-modal__fields">
          <label class="application-modal__field">
            <span class="visually-hidden application-modal__name-label">Ваше имя</span>
            <input class="application-modal__input" type="text" name="name" autocomplete="name" placeholder="Ваше имя" required>
          </label>
          <label class="application-modal__field">
            <span class="visually-hidden">Телефон</span>
            <input class="application-modal__input" type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="Телефон" required>
          </label>
          <label class="application-modal__field" data-applicant-field hidden>
            <span class="visually-hidden">Имя абитуриента</span>
            <input class="application-modal__input" type="text" name="applicantName" autocomplete="name" placeholder="Имя абитуриента">
          </label>
          <div class="application-modal__field-pair" data-applicant-field hidden>
            <label class="application-modal__field">
              <span class="visually-hidden">Возраст</span>
              <input class="application-modal__input" type="text" name="applicantAge" inputmode="numeric" placeholder="Возраст">
            </label>
            <label class="application-modal__field">
              <span class="visually-hidden">Класс</span>
              <input class="application-modal__input" type="text" name="applicantGrade" inputmode="numeric" placeholder="Класс">
            </label>
          </div>
          <label class="application-modal__field application-modal__field--select" data-applicant-field hidden>
            <span class="visually-hidden">Интересующая специальность</span>
            <select class="application-modal__input application-modal__select" name="specialty">
              <option value="" selected>Интересующая специальность</option>
              <option value="ballet">52.02.01 «Искусство балета»</option>
              <option value="dance">52.02.02 «Искусство танца»</option>
            </select>
          </label>
          <label class="application-modal__field application-modal__field--select" data-trial-field hidden>
            <span class="visually-hidden">Интересующее направление</span>
            <select class="application-modal__input application-modal__select" name="direction">
              <option value="" selected>Интересующее направление</option>
              <option value="children">Балет для детей</option>
              <option value="adults">Балет для взрослых</option>
              <option value="contemporary">Современный танец</option>
              <option value="stretching">Растяжка и физическая подготовка</option>
              <option value="preparation">Подготовка к поступлению</option>
            </select>
          </label>
          <label class="application-modal__field application-modal__field--select" data-question-field hidden>
            <span class="visually-hidden">Тема вопроса</span>
            <select class="application-modal__input application-modal__select" name="questionTopic">
              <option value="" selected>Тема вопроса</option>
              <option value="admission">Поступление</option>
              <option value="education">Обучение</option>
              <option value="trial">Пробное занятие</option>
              <option value="schedule">Расписание и стоимость</option>
              <option value="documents">Документы</option>
              <option value="other">Другое</option>
            </select>
          </label>
          <label class="application-modal__field" data-franchise-field hidden>
            <span class="visually-hidden">Город</span>
            <input class="application-modal__input" type="text" name="city" autocomplete="address-level2" placeholder="Город">
          </label>
          <label class="application-modal__field" data-franchise-field hidden>
            <span class="visually-hidden">Есть ли помещение?</span>
            <input class="application-modal__input" type="text" name="premises" placeholder="Есть ли помещение?">
          </label>
          <label class="application-modal__field" data-trial-field hidden>
            <span class="visually-hidden">Возраст ученика</span>
            <input class="application-modal__input" type="text" name="age" inputmode="numeric" placeholder="Возраст ученика">
          </label>
          <label class="application-modal__field" data-trial-field hidden>
            <span class="visually-hidden">Школа</span>
            <input class="application-modal__input" type="text" name="school" placeholder="Школа">
          </label>
          <label class="application-modal__field application-modal__field--message">
            <span class="visually-hidden">Комментарий</span>
            <textarea class="application-modal__input application-modal__textarea" name="comment" placeholder="Комментарий"></textarea>
          </label>
        </div>
        <div class="application-modal__actions">
          <label class="application-modal__consent">
            <input class="application-modal__checkbox" type="checkbox" name="consent" required>
            <span>Я согласен с <a href="privacy.html">политикой конфиденциальности</a> и даю согласие на обработку персональных данных</span>
          </label>
          <button class="application-modal__submit" type="submit">Отправить</button>
          <p class="application-modal__status" data-form-status role="status" aria-live="polite"></p>
        </div>
      </form>
    </div>
  `;
  document.body.append(modal);
  return modal;
};

const getVariant = (trigger) => (
  modalVariants.has(trigger.dataset.applicationModal)
    ? trigger.dataset.applicationModal
    : "application"
);

const restoreTriggerFocus = (trigger) => {
  const fallback = document.querySelector(".site-header__menu-toggle, .college-header__menu-toggle");
  const focusTarget = trigger?.getClientRects().length ? trigger : fallback;
  focusTarget?.focus();
};

const setModalVariant = (modal, variant) => {
  const content = modalContent[variant];
  const hasChanged = modal.dataset.variant && modal.dataset.variant !== variant;
  if (hasChanged) {
    const form = modal.querySelector(".application-modal__form");
    form.reset();
    form.querySelector("[data-form-status]").textContent = "";
    form.querySelectorAll("[aria-invalid]").forEach((field) => field.setAttribute("aria-invalid", "false"));
  }
  modal.dataset.variant = variant;
  modal.classList.toggle("application-modal--trial", variant === "trial");
  modal.classList.toggle("application-modal--applicant", variant === "applicant");
  modal.classList.toggle("application-modal--question", variant === "question");
  modal.classList.toggle("application-modal--franchise", variant === "franchise");
  modal.querySelector(".application-modal__title").textContent = content.title;
  modal.querySelector(".application-modal__subtitle").textContent = content.subtitle;
  modal.querySelectorAll("[data-trial-field]").forEach((field) => { field.hidden = variant !== "trial"; });
  modal.querySelectorAll("[data-applicant-field]").forEach((field) => { field.hidden = variant !== "applicant"; });
  modal.querySelectorAll("[data-question-field]").forEach((field) => { field.hidden = variant !== "question"; });
  modal.querySelectorAll("[data-franchise-field]").forEach((field) => { field.hidden = variant !== "franchise"; });
  const usesParentName = variant === "applicant" || variant === "question" || variant === "franchise";
  modal.querySelector(".application-modal__name-label").textContent = usesParentName ? "Имя родителя" : "Ваше имя";
  modal.querySelector('[name="name"]').placeholder = usesParentName ? "Имя родителя" : "Ваше имя";
  modal.querySelector(".application-modal__submit").textContent = variant === "applicant"
    ? "Подать заявку"
    : variant === "question" ? "Отправить вопрос"
      : variant === "franchise" ? "Получить презентацию" : "Отправить";
};

export const initApplicationModal = (triggerElements) => {
  const triggers = Array.from(triggerElements || [])
    .filter((trigger) => modalVariants.has(trigger.dataset.applicationModal));
  if (!triggers.length) return null;

  const modal = createModal();
  const closeButton = modal.querySelector(".application-modal__close");
  const form = modal.querySelector(".application-modal__form");
  let activeTrigger = null;

  initTrialForm(form);

  const openModal = (trigger) => {
    setModalVariant(modal, getVariant(trigger));
    activeTrigger = trigger;
    document.body.classList.add("is-dialog-open");
    modal.showModal();
  };

  triggers.forEach((trigger) => {
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openModal(trigger);
    });
  });

  closeButton.addEventListener("click", () => modal.close());
  modal.addEventListener("click", (event) => {
    const bounds = modal.getBoundingClientRect();
    const isOutside = event.clientX < bounds.left
      || event.clientX > bounds.right
      || event.clientY < bounds.top
      || event.clientY > bounds.bottom;
    if (isOutside) modal.close();
  });
  modal.addEventListener("close", () => {
    document.body.classList.remove("is-dialog-open");
    const trigger = activeTrigger;
    activeTrigger = null;
    requestAnimationFrame(() => restoreTriggerFocus(trigger));
  });

  return modal;
};
