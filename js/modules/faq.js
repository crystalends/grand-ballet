const setItemState = (item, isOpen) => {
  const button = item.querySelector(".faq-item__button");
  const answer = item.querySelector(".faq-item__answer");
  const symbol = item.querySelector(".faq-item__symbol");

  item.classList.toggle("faq-item--open", isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
  answer.hidden = !isOpen;
  symbol.textContent = isOpen ? "−" : "+";
};

export const initFaq = (list) => {
  if (!list) return;

  list.addEventListener("click", (event) => {
    const button = event.target.closest(".faq-item__button");
    if (!button) return;

    const selectedItem = button.closest(".faq-item");
    const shouldOpen = button.getAttribute("aria-expanded") !== "true";

    list.querySelectorAll(".faq-item").forEach((item) => setItemState(item, item === selectedItem && shouldOpen));
  });
};
