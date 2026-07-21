const directionData = {
  children: [
    ["Мама и малыш", "2-3 года", "Смоленская, Шаболовская", "Первое знакомство с движением"],
    ["Начальная хореография", "3-4 года", "Смоленская, Шаболовская", "Координация и ритм"],
    ["Балет для детей", "5-13 лет", "Смоленская, Шаболовская", "Классическая техника"],
    ["Современная хореография", "5-17 лет", "Смоленская, Шаболовская", "Современный танец"],
  ],
  teenagers: [
    ["Балет для подростков", "11-17 лет", "Смоленская, Шаболовская", "Техника, осанка и артистизм"],
    ["Современный танец", "11-17 лет", "Смоленская, Шаболовская", "Контемпорари и джаз-модерн"],
    ["Растяжка", "12-17 лет", "Смоленская, Шаболовская", "Гибкость и безопасная нагрузка"],
    ["Сценическая практика", "12-17 лет", "Смоленская, Шаболовская", "Подготовка к выступлениям"],
  ],
  adults: [
    ["Балет для взрослых", "от 18 лет", "Смоленская, Шаболовская", "Группы для начинающих"],
    ["Боди-балет", "от 18 лет", "Смоленская, Шаболовская", "Пластика и укрепление мышц"],
    ["Растяжка", "от 18 лет", "Смоленская, Шаболовская", "Мягкое развитие гибкости"],
    ["Современная хореография", "от 18 лет", "Шаболовская", "Движение и импровизация"],
  ],
  admission: [
    ["Подготовка к поступлению", "11-17 лет", "Смоленская", "Подготовка к творческому просмотру"],
    ["Классический танец", "11-17 лет", "Смоленская", "Укрепление академической базы"],
    ["Современный танец", "11-17 лет", "Шаболовская", "Техника и сценическая выразительность"],
    ["Колледж", "15-18 лет", "Шаболовская", "Профессиональное образование"],
  ],
};

const renderDirections = (panel, directionKey) => {
  const cards = Array.from(panel?.querySelectorAll(".direction-card") || []);
  const items = directionData[directionKey];
  if (!items || cards.length !== items.length) return;

  cards.forEach((card, index) => {
    const [title, age, place, description] = items[index];
    card.querySelector(".direction-card__title").textContent = title;
    card.querySelector(".course-meta__item--users").textContent = age;
    card.querySelector(".course-meta__item--place").textContent = place;
    card.querySelector(".direction-card__description").textContent = description;
  });
};

const activateTab = (tabs, activeTab, panel) => {
  tabs.forEach((tab) => {
    const isActive = tab === activeTab;
    tab.classList.toggle("direction-picker__tab--active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });
  panel?.setAttribute("aria-labelledby", activeTab.id);
  renderDirections(panel, activeTab.dataset.direction);
};

export const initDirectionTabs = (tablist) => {
  if (!tablist) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panel = document.getElementById(tabs[0]?.getAttribute("aria-controls"));
  const initialTab = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];
  if (!initialTab) return;
  activateTab(tabs, initialTab, panel);

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) activateTab(tabs, tab, panel);
  });

  tablist.addEventListener("keydown", (event) => {
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    activateTab(tabs, nextTab, panel);
    nextTab.focus();
  });
};
