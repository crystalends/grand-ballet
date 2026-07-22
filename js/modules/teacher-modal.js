const teacherImageIndexes = new Map([
  ["Сиротин Сергей Вадимович", 1],
  ["Иванова Майя Евгеньевна", 2],
  ["Жаворонкова Елена Владиленовна", 3],
  ["Черкасова Татьяна Владимировна", 4],
]);

const getTeacherData = (card) => {
  const name = card.querySelector(".teacher-card__name")?.textContent.trim() || "Педагог ГРАНДБАЛЕТ";
  const currentImage = card.querySelector(".teacher-card__image")?.getAttribute("src") || "";
  const imageIndex = teacherImageIndexes.get(name);
  const imageCollection = currentImage.includes("/about/") ? "about" : "service";

  return {
    name,
    role: card.querySelector(".teacher-card__role")?.textContent.trim() || "Педагог ГРАНДБАЛЕТ",
    image: imageIndex ? `assets/images/${imageCollection}/teacher-${imageIndex}.png` : currentImage,
  };
};

const createModal = () => {
  const modal = document.createElement("dialog");
  modal.className = "teacher-modal";
  modal.setAttribute("aria-labelledby", "teacher-modal-name");
  modal.innerHTML = `
    <button class="teacher-modal__close" type="button" aria-label="Закрыть информацию о педагоге">
      <span aria-hidden="true">×</span>
    </button>
    <div class="teacher-modal__body">
      <div class="teacher-modal__summary">
        <img class="teacher-modal__image" alt="">
        <div class="teacher-modal__identity">
          <h2 class="teacher-modal__name" id="teacher-modal-name"></h2>
          <p class="teacher-modal__role"></p>
        </div>
      </div>
      <div class="teacher-modal__details" tabindex="0" aria-label="Подробная информация о педагоге">
        <section class="teacher-modal__section">
          <h3 class="teacher-modal__heading">О педагоге</h3>
          <div class="teacher-modal__text teacher-modal__about">
            <p class="teacher-modal__introduction"></p>
            <p>На занятиях педагог помогает ученикам постепенно освоить технику, укрепить тело, развить пластику и почувствовать уверенность в движении. Особое внимание уделяется правильной постановке корпуса, работе стоп, координации, музыкальности и безопасности нагрузки.</p>
          </div>
        </section>
        <section class="teacher-modal__section">
          <h3 class="teacher-modal__heading">Образование и опыт</h3>
          <div class="teacher-modal__text">
            <p>Педагог получил профессиональное образование в сфере хореографии и продолжает развиваться в направлении классического танца, современной хореографии и педагогической практики.</p>
            <p>Опыт работы включает занятия с учениками разного возраста и уровня подготовки: от начинающих до тех, кто готовится к выступлениям, конкурсам или поступлению.</p>
            <ul class="teacher-modal__list">
              <li>профессиональное хореографическое образование;</li>
              <li>опыт преподавания детям и взрослым;</li>
              <li>работа с начинающими учениками;</li>
              <li>подготовка к выступлениям и просмотрам;</li>
              <li>участие в постановках, проектах или конкурсах;</li>
              <li>регулярное повышение квалификации.</li>
            </ul>
          </div>
        </section>
        <section class="teacher-modal__section">
          <h3 class="teacher-modal__heading">Профессиональный опыт и достижения</h3>
          <div class="teacher-modal__text">
            <p>Педагог участвует в развитии учеников ГРАНДБАЛЕТ, помогает им готовиться к выступлениям, открытым урокам, конкурсам и дальнейшему обучению.</p>
            <ul class="teacher-modal__list">
              <li>подготовка учеников к выступлениям;</li>
              <li>участие в школьных постановках;</li>
              <li>работа с детьми и взрослыми разных уровней;</li>
              <li>сопровождение учеников на этапе подготовки к поступлению;</li>
              <li>индивидуальная работа над техникой и выразительностью.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
    <span class="teacher-modal__scrollbar" aria-hidden="true">
      <span class="teacher-modal__scrollbar-thumb"></span>
    </span>
  `;
  document.body.append(modal);
  return modal;
};

const fillModal = (modal, teacher) => {
  const image = modal.querySelector(".teacher-modal__image");
  image.src = teacher.image;
  image.alt = teacher.name;
  modal.querySelector(".teacher-modal__name").textContent = teacher.name;
  modal.querySelector(".teacher-modal__role").textContent = teacher.role;
  modal.querySelector(".teacher-modal__introduction").textContent = `${teacher.name} — педагог ГРАНДБАЛЕТ, который соединяет профессиональную хореографическую базу, внимательное отношение к ученику и понятную подачу материала.`;
  modal.querySelector(".teacher-modal__body").scrollTop = 0;
  modal.querySelector(".teacher-modal__details").scrollTop = 0;
};

export const initTeacherModal = (teacherCards) => {
  const cards = Array.from(teacherCards || []);
  if (!cards.length) return null;

  const modal = createModal();
  fillModal(modal, getTeacherData(cards[0]));
  const closeButton = modal.querySelector(".teacher-modal__close");
  const details = modal.querySelector(".teacher-modal__details");
  const scrollbar = modal.querySelector(".teacher-modal__scrollbar");
  const scrollbarThumb = modal.querySelector(".teacher-modal__scrollbar-thumb");
  let activeTrigger = null;

  const syncScrollbar = () => {
    const maxScroll = details.scrollHeight - details.clientHeight;
    const maxOffset = scrollbar.clientHeight - scrollbarThumb.clientHeight;
    const offset = maxScroll > 0 ? (details.scrollTop / maxScroll) * maxOffset : 0;
    scrollbarThumb.style.transform = `translateY(${offset}px)`;
  };

  const openModal = (card, trigger) => {
    fillModal(modal, getTeacherData(card));
    activeTrigger = trigger;
    document.body.classList.add("is-dialog-open");
    modal.showModal();
    requestAnimationFrame(syncScrollbar);
  };

  cards.forEach((card) => {
    const teacher = getTeacherData(card);
    const image = card.querySelector(".teacher-card__image");
    if (image) image.src = teacher.image;
    const trigger = document.createElement("button");
    trigger.className = "teacher-card__trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-label", `Подробнее о педагоге ${teacher.name}`);
    trigger.addEventListener("click", () => openModal(card, trigger));
    card.append(trigger);
  });

  closeButton.addEventListener("click", () => modal.close());
  details.addEventListener("scroll", syncScrollbar, { passive: true });
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
    activeTrigger?.focus();
    activeTrigger = null;
  });

  return modal;
};
