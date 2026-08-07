const directionGroups = [
  {
    title: "Для детей",
    items: [
      ["Балет для детей", "service.html"],
      ["Мама и малыш", "service.html"],
      ["Начальная хореография", "service.html"],
      ["Классическая хореография", "service.html"],
      ["Современная хореография", "service.html"],
      ["Уличные танцы", "service.html"],
    ],
  },
  {
    title: "Для взрослых",
    items: [
      ["Балет для взрослых", "service.html"],
      ["Body ballet", "service.html"],
      ["Партерная гимнастика", "service.html"],
      ["Йога", "service.html"],
      ["Телесные практики", "service.html"],
    ],
  },
  {
    title: "Дополнительные форматы",
    items: [
      ["Подготовка к поступлению", "preparation.html"],
      ["Интенсивы", "index.html"],
      ["Индивидуальные занятия", "service.html"],
      ["Аренда залов", "halls.html"],
    ],
  },
];

const DIRECTIONS_ICON = `
  <svg class="site-header__directions-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M17 10H19C21 10 22 9 22 7V5C22 3 21 2 19 2H17C15 2 14 3 14 5V7C14 9 15 10 17 10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 22H7C9 22 10 21 10 19V17C10 15 9 14 7 14H5C3 14 2 15 2 17V19C2 21 3 22 5 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6 10C8.20914 10 10 8.20914 10 6C10 3.79086 8.20914 2 6 2C3.79086 2 2 3.79086 2 6C2 8.20914 3.79086 10 6 10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18 22C20.2091 22 22 20.2091 22 18C22 15.7909 20.2091 14 18 14C15.7909 14 14 15.7909 14 18C14 20.2091 15.7909 22 18 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const createDirectionGroup = ({ title, items }) => {
  const group = document.createElement("section");
  group.className = "site-header__directions-group";

  const heading = document.createElement("h3");
  heading.className = "site-header__directions-heading";
  heading.textContent = title;

  const list = document.createElement("ul");
  list.className = "site-header__directions-list";
  items.forEach(([label, href]) => {
    const item = document.createElement("li");
    item.className = "site-header__directions-item";
    const link = document.createElement("a");
    link.className = "site-header__directions-link";
    link.href = href;
    link.textContent = label;
    item.append(link);
    list.append(item);
  });

  group.append(heading, list);
  return group;
};

const createPanel = (id) => {
  const panel = document.createElement("div");
  panel.className = "site-header__directions-panel";
  panel.id = id;
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;

  const panelInner = document.createElement("div");
  panelInner.className = "site-header__directions-panel-inner";
  directionGroups.forEach((group) => panelInner.append(createDirectionGroup(group)));

  const pageLink = document.createElement("a");
  pageLink.className = "site-header__directions-page-link";
  pageLink.href = "directions.html";
  pageLink.textContent = "Все направления";
  panelInner.append(pageLink);
  panel.append(panelInner);
  return panel;
};

const createToggle = (panelId) => {
  const toggle = document.createElement("button");
  toggle.className = "site-header__directions-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-controls", panelId);
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `${DIRECTIONS_ICON}<span>Направления</span>`;
  return toggle;
};

export const createHeaderDirectionsMenu = (nav, menuIndex) => {
  const sourceLink = nav.querySelector('.site-header__nav-link[href="directions.html"]');
  if (!sourceLink) return null;

  const wrapper = document.createElement("div");
  const panelId = `site-header-directions-${menuIndex + 1}`;
  const toggle = createToggle(panelId);
  const panel = createPanel(panelId);
  wrapper.className = "site-header__directions";
  sourceLink.classList.add("site-header__directions-source-link");
  sourceLink.before(wrapper);
  wrapper.append(sourceLink, toggle, panel);

  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  const setOpen = (open, focusToggle = false) => {
    wrapper.classList.toggle("site-header__directions--open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    panel.inert = !open;
    if (focusToggle) toggle.focus();
  };

  toggle.addEventListener("click", () => setOpen(!isOpen()));

  return {
    close: (focusToggle = false) => setOpen(false, focusToggle),
    isOpen,
    toggle,
  };
};
