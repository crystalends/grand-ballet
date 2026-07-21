const getStatusMessage = (form) => {
  const consent = form.elements.namedItem("consent");
  const name = form.elements.namedItem("name");
  const phone = form.elements.namedItem("phone");

  if (!name.value.trim() || !phone.value.trim()) return "Заполните имя и телефон.";
  if (!consent.checked) return "Подтвердите согласие на обработку данных.";
  return "Спасибо! Заявка принята.";
};

export const initTrialForm = (form) => {
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const status = form.querySelector(".trial-form__status");
    status.textContent = getStatusMessage(form);
  });
};
