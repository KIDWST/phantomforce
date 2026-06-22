const header = document.querySelector("[data-header]");
const syncHeader = () =>
  header?.classList.toggle("scrolled", window.scrollY > 12);
syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

const formatter = new Intl.NumberFormat("en-US");
const sliders = [...document.querySelectorAll('.sliders input[type="range"]')];
const updateCalculator = () => {
  const total = sliders.reduce((sum, slider) => sum + Number(slider.value), 0);
  const weekly = total * 0.75;
  sliders.forEach((slider) => {
    const output = document.querySelector(`[data-output-for="${slider.id}"]`);
    const value = Number(slider.value);
    output.textContent = `${value.toFixed(value % 1 ? 1 : 0)} hrs`;
  });
  document.querySelector("[data-weekly-hours]").textContent = weekly.toFixed(1);
  document.querySelector("[data-yearly-hours]").textContent = formatter.format(
    Math.round(weekly * 52),
  );
};
sliders.forEach((slider) => slider.addEventListener("input", updateCalculator));
updateCalculator();

const industries = {
  services: {
    kicker: "Service businesses",
    title: "Book the work. Keep the customer informed.",
    description:
      "Capture inquiries, schedule jobs, send reminders, and follow up after the work is done.",
    items: [
      "Capture every lead",
      "Schedule the right crew",
      "Send customer updates",
      "Follow up automatically",
    ],
  },
  sports: {
    kicker: "Sports organizations",
    title: "Run the season without living in your phone.",
    description:
      "Keep athletes, parents, coaches, registrations, and schedule changes moving together.",
    items: [
      "Track athletes and forms",
      "Schedule practices and games",
      "Notify parents and coaches",
      "Handle registrations",
    ],
  },
  media: {
    kicker: "Media companies",
    title: "Keep every shoot and client moving.",
    description:
      "Coordinate schedules, organize deliverables, and keep approvals from going quiet.",
    items: [
      "Track shoots and crews",
      "Manage client deadlines",
      "Organize deliverables",
      "Follow up on approvals",
    ],
  },
};
const industryButtons = [...document.querySelectorAll("[data-industry]")];
const renderIndustry = (key) => {
  const content = industries[key];
  document.querySelector("[data-industry-kicker]").textContent = content.kicker;
  document.querySelector("[data-industry-title]").textContent = content.title;
  document.querySelector("[data-industry-description]").textContent =
    content.description;
  document.querySelector("[data-industry-list]").innerHTML = content.items
    .map((item) => `<li><i class="ph ph-check"></i>${item}</li>`)
    .join("");
  industryButtons.forEach((button) =>
    button.classList.toggle("active", button.dataset.industry === key),
  );
};
industryButtons.forEach((button) =>
  button.addEventListener("click", () =>
    renderIndustry(button.dataset.industry),
  ),
);

const panel = document.querySelector("[data-specialist-panel]");
const launcher = document.querySelector("[data-specialist-launcher]");
const backdrop = document.querySelector("[data-panel-backdrop]");
const openPanel = () => {
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  launcher.setAttribute("aria-expanded", "true");
  backdrop.hidden = false;
  document.body.classList.add("panel-open");
  window.setTimeout(() => panel.querySelector("button")?.focus(), 50);
};
const closePanel = () => {
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  launcher.setAttribute("aria-expanded", "false");
  backdrop.hidden = true;
  document.body.classList.remove("panel-open");
  launcher.focus();
};
document
  .querySelectorAll("[data-open-specialist]")
  .forEach((button) => button.addEventListener("click", openPanel));
launcher.addEventListener("click", () =>
  panel.classList.contains("open") ? closePanel() : openPanel(),
);
document
  .querySelector("[data-close-specialist]")
  .addEventListener("click", closePanel);
backdrop.addEventListener("click", closePanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panel.classList.contains("open")) closePanel();
});

const questions = [
  {
    text: "About how many new leads or inquiries do you receive each month?",
    options: ["Under 25", "25–75", "76–200", "More than 200"],
  },
  {
    text: "What consumes the most time?",
    options: [
      "Scheduling",
      "Emails and updates",
      "Lead follow-up",
      "Data entry",
    ],
  },
  {
    text: "What would you want handled first?",
    options: [
      "Lead response",
      "Scheduling and reminders",
      "Customer communication",
      "Records and reporting",
    ],
  },
  {
    text: "Would you like a free operations assessment based on these answers?",
    options: ["Yes, build my plan", "Show my plan first"],
  },
];
const answers = [];
let questionIndex = 0;
const thread = document.querySelector("[data-specialist-thread]");
const options = document.querySelector("[data-specialist-options]");
const plan = document.querySelector("[data-specialist-plan]");

const addMessage = (text, visitor = false) => {
  const message = document.createElement("div");
  message.className = visitor ? "visitor-message" : "specialist-message";
  if (visitor) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    message.append(paragraph);
  } else {
    const label = document.createElement("span");
    label.textContent = "PhantomForce Specialist";
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    message.append(label, paragraph);
  }
  thread.append(message);
  thread.scrollTop = thread.scrollHeight;
};

const renderQuestion = () => {
  const question = questions[questionIndex - 1];
  addMessage(question.text);
  options.replaceChildren(
    ...question.options.map((text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.answer = text;
      button.textContent = text;
      return button;
    }),
  );
};

const showPlan = () => {
  options.hidden = true;
  thread.hidden = true;
  plan.hidden = false;
  const focus = answers[3] || answers[2] || "scheduling and follow-up";
  document.querySelector("[data-plan-title]").textContent =
    `Start with ${focus.toLowerCase()}.`;
  const priorities = [
    answers[2] || "Recover owner time",
    answers[3] || "Protect follow-up",
    "Create one daily priority brief",
  ];
  document.querySelector("[data-plan-list]").replaceChildren(
    ...priorities.map((text) => {
      const item = document.createElement("li");
      const icon = document.createElement("i");
      icon.className = "ph ph-check-circle";
      item.append(icon, document.createTextNode(text));
      return item;
    }),
  );
  const body = [
    `Business: ${answers[0] || "Not provided"}`,
    `Monthly inquiries: ${answers[1] || "Not provided"}`,
    `Biggest time drain: ${answers[2] || "Not provided"}`,
    `First priority: ${answers[3] || "Not provided"}`,
  ].join("\n");
  document.querySelector("[data-plan-link]").href =
    `mailto:demo@phantomforce.online?subject=${encodeURIComponent("My free PhantomForce operations plan")}&body=${encodeURIComponent(body)}`;
};

options.addEventListener("click", (event) => {
  const button = event.target.closest("[data-answer]");
  if (!button) return;
  addMessage(button.dataset.answer, true);
  answers.push(button.dataset.answer);
  questionIndex += 1;
  if (questionIndex >= 5) showPlan();
  else renderQuestion();
});

document.documentElement.dataset.siteReady = "true";
