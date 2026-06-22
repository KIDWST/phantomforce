const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");

const syncHeader = () =>
  header?.classList.toggle("scrolled", window.scrollY > 12);
syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  nav?.classList.toggle("open", open);
  document.body.classList.toggle("menu-open", open);
  menuToggle.querySelector("i").className = open ? "ph ph-x" : "ph ph-list";
});

nav?.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    menuToggle?.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
    document.body.classList.remove("menu-open");
    menuToggle.querySelector("i").className = "ph ph-list";
  }),
);

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const revealObserver = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    }),
  { threshold: 0.1 },
);
document
  .querySelectorAll(".reveal")
  .forEach((element) => revealObserver.observe(element));

const numberFormatter = new Intl.NumberFormat("en-US");
const counterObserver = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      const target = Number(element.dataset.counter);
      const start = performance.now();
      const duration = reducedMotion ? 0 : 1200;
      const tick = (time) => {
        const progress =
          duration === 0 ? 1 : Math.min((time - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = numberFormatter.format(
          Math.round(target * eased),
        );
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      counterObserver.unobserve(element);
    }),
  { threshold: 0.4 },
);
document
  .querySelectorAll("[data-counter]")
  .forEach((counter) => counterObserver.observe(counter));

const setActivePanel = (buttons, panels, button, panelId) => {
  buttons.forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  panels.forEach((panel) => {
    const active = panel.id === panelId;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
};

const calcTabs = [...document.querySelectorAll("[data-calc-tab]")];
const calcPanels = [...document.querySelectorAll("[data-calc-panel]")];
calcTabs.forEach((button) =>
  button.addEventListener("click", () =>
    setActivePanel(calcTabs, calcPanels, button, button.dataset.calcTab),
  ),
);

const timeInputs = [
  ...document.querySelectorAll('[data-time-form] input[type="range"]'),
];
const updateTimeCalculator = () => {
  const total = timeInputs.reduce((sum, input) => sum + Number(input.value), 0);
  const weekly = total * 0.75;
  const yearly = Math.round(weekly * 52);
  timeInputs.forEach((input) => {
    const output = document.querySelector(`[data-output-for="${input.id}"]`);
    if (output)
      output.textContent = `${Number(input.value).toFixed(Number(input.value) % 1 ? 1 : 0)} hrs`;
  });
  document.querySelector("[data-weekly-hours]").textContent = weekly.toFixed(1);
  document.querySelector("[data-yearly-hours]").textContent =
    numberFormatter.format(yearly);
  document.querySelector("[data-workdays]").textContent =
    numberFormatter.format(Math.round(yearly / 8));
};
timeInputs.forEach((input) =>
  input.addEventListener("input", updateTimeCalculator),
);
updateTimeCalculator();

const revenueInputs = [
  ...document.querySelectorAll(
    "[data-revenue-form] input, [data-revenue-form] select",
  ),
];
const updateRevenueCalculator = () => {
  const leads = Math.max(
    0,
    Number(document.querySelector("#monthly-leads").value) || 0,
  );
  const value = Math.max(
    0,
    Number(document.querySelector("#customer-value").value) || 0,
  );
  const risk = Number(document.querySelector("#response-time").value);
  const leadsAtRisk = Math.round(leads * risk);
  const leakage = Math.round(leads * risk * value * 12);
  document.querySelector("[data-leads-risk]").textContent =
    numberFormatter.format(leadsAtRisk);
  document.querySelector("[data-leakage]").textContent =
    numberFormatter.format(leakage);
};
revenueInputs.forEach((input) =>
  input.addEventListener("input", updateRevenueCalculator),
);
updateRevenueCalculator();

const industryContent = {
  sports: {
    kicker: "Sports organizations",
    title: "Run the season without living in your phone.",
    description:
      "Keep athletes, parents, coaches, registrations, and schedule changes moving from one reliable operating rhythm.",
    steps: [
      [
        "ph-identification-card",
        "Track athletes",
        "Keep rosters, forms, and eligibility current.",
      ],
      [
        "ph-calendar-check",
        "Schedule practices",
        "Coordinate fields, coaches, and changes.",
      ],
      [
        "ph-users-three",
        "Manage parents",
        "Send the right updates to the right group.",
      ],
      [
        "ph-bell-ringing",
        "Automate reminders",
        "Reduce no-shows and repeated questions.",
      ],
      [
        "ph-clipboard-text",
        "Handle registrations",
        "Track payment, forms, and follow-up.",
      ],
    ],
  },
  media: {
    kicker: "Media companies",
    title: "Keep every shoot, client, and deliverable moving.",
    description:
      "Turn scattered production details into a clear schedule with dependable client communication.",
    steps: [
      [
        "ph-video-camera",
        "Track shoots",
        "Keep crews, locations, and shot details together.",
      ],
      [
        "ph-calendar-dots",
        "Manage production",
        "Coordinate dates, deadlines, and dependencies.",
      ],
      ["ph-users", "Update clients", "Send progress without chasing status."],
      [
        "ph-folders",
        "Organize content",
        "File work by client, campaign, and stage.",
      ],
      [
        "ph-paper-plane-tilt",
        "Automate follow-up",
        "Keep approvals and next steps moving.",
      ],
    ],
  },
  services: {
    kicker: "Service businesses",
    title: "Book more work without adding office chaos.",
    description:
      "Capture every inquiry, schedule the right crew, and keep customers informed from quote to completion.",
    steps: [
      [
        "ph-phone-incoming",
        "Capture leads",
        "Record every call, form, and referral.",
      ],
      [
        "ph-calendar-check",
        "Schedule jobs",
        "Match availability, location, and capacity.",
      ],
      [
        "ph-address-book",
        "Track customers",
        "Keep history and next steps current.",
      ],
      [
        "ph-chat-circle-dots",
        "Send updates",
        "Confirm appointments and communicate delays.",
      ],
      [
        "ph-arrow-counter-clockwise",
        "Follow up",
        "Request reviews and reopen opportunities.",
      ],
    ],
  },
  professional: {
    kicker: "Professional teams",
    title:
      "Give clients a responsive experience without constant interruption.",
    description:
      "Organize intake, deadlines, documents, and communication so experts can stay focused on valuable work.",
    steps: [
      ["ph-tray", "Manage intake", "Collect the right details from the start."],
      [
        "ph-calendar",
        "Coordinate schedules",
        "Protect focus time and client commitments.",
      ],
      [
        "ph-file-text",
        "Track documents",
        "Know what is missing and who owns it.",
      ],
      [
        "ph-bell",
        "Prompt next steps",
        "Keep clients and staff ahead of deadlines.",
      ],
      [
        "ph-chart-line-up",
        "Report progress",
        "Surface status, risk, and capacity clearly.",
      ],
    ],
  },
};

const industryButtons = [...document.querySelectorAll("[data-industry]")];
const renderIndustry = (key) => {
  const content = industryContent[key];
  document.querySelector("[data-industry-kicker]").textContent = content.kicker;
  document.querySelector("[data-industry-title]").textContent = content.title;
  document.querySelector("[data-industry-description]").textContent =
    content.description;
  document.querySelector("[data-industry-steps]").innerHTML = content.steps
    .map(
      ([icon, title, text]) =>
        `<li><i class="ph ${icon}" aria-hidden="true"></i><span><b>${title}</b>${text}</span></li>`,
    )
    .join("");
  industryButtons.forEach((button) => {
    const active = button.dataset.industry === key;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
};
industryButtons.forEach((button) =>
  button.addEventListener("click", () =>
    renderIndustry(button.dataset.industry),
  ),
);

const approvalCard = document.querySelector("[data-approval-card]");
document.querySelector("[data-review]")?.addEventListener("click", () => {
  approvalCard?.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
  });
  approvalCard?.classList.add("attention");
  window.setTimeout(() => approvalCard?.classList.remove("attention"), 1200);
});
document.querySelector("[data-approve-all]")?.addEventListener("click", () => {
  document.querySelector("[data-pending-count]").textContent = "0";
  document
    .querySelectorAll(".approval-item")
    .forEach((item) => (item.hidden = true));
  document.querySelector("[data-approval-status]").textContent =
    "Three decisions approved. Today’s work can keep moving.";
});
document.querySelector("[data-view-queue]")?.addEventListener("click", () => {
  document.querySelector("[data-approval-status]").textContent =
    "Context preview is shown above. Live records connect during setup.";
});

const assessmentQuestions = [
  {
    question:
      "How many leads or new inquiries do you receive in a typical month?",
    options: ["Under 25", "25–75", "76–200", "More than 200"],
  },
  {
    question: "What consumes the most time right now?",
    options: [
      "Scheduling",
      "Emails and updates",
      "Client follow-up",
      "Data entry and reporting",
    ],
  },
  {
    question: "What would you most like handled first?",
    options: [
      "Lead response",
      "Scheduling and reminders",
      "Customer communication",
      "Records and reporting",
    ],
  },
  {
    question:
      "Would you like a free operations assessment built around these answers?",
    options: ["Yes, build my plan", "Not yet—show my plan"],
  },
];
const assessmentAnswers = [];
let assessmentStep = 0;
const assessmentThread = document.querySelector("[data-assessment-thread]");
const assessmentOptions = document.querySelector("[data-assessment-options]");
const assessmentProgress = document.querySelector("[data-assessment-progress]");
const assessmentForm = document.querySelector("[data-assessment-form]");
const planResult = document.querySelector("[data-plan-result]");

const appendAssessmentMessage = (text, visitor = false) => {
  const message = document.createElement("div");
  message.className = visitor ? "visitor-message" : "specialist-message";
  message.innerHTML = visitor
    ? `<p>${text}</p>`
    : `<span>Operations Specialist</span><p>${text}</p>`;
  assessmentThread.append(message);
  assessmentThread.scrollTop = assessmentThread.scrollHeight;
};

const renderAssessmentQuestion = () => {
  const next = assessmentQuestions[assessmentStep - 1];
  assessmentProgress.textContent = `Question ${assessmentStep + 1} of 5`;
  appendAssessmentMessage(next.question);
  assessmentOptions.innerHTML = next.options
    .map(
      (option) =>
        `<button type="button" data-answer="${option}">${option}</button>`,
    )
    .join("");
};

const finishAssessment = () => {
  assessmentForm.hidden = true;
  assessmentProgress.textContent = "Plan ready";
  const focus =
    assessmentAnswers[3] || assessmentAnswers[2] || "follow-up and scheduling";
  document.querySelector("[data-plan-title]").textContent =
    `Start by fixing ${focus.toLowerCase()}.`;
  const priorities = [
    assessmentAnswers[2] || "Recover owner time",
    assessmentAnswers[3] || "Protect follow-up",
    "Create a daily attention brief",
  ];
  document.querySelector("[data-plan-priorities]").innerHTML = priorities
    .map(
      (item, index) =>
        `<span><i class="ph ${["ph-clock", "ph-calendar-check", "ph-list-checks"][index]}"></i>${item}</span>`,
    )
    .join("");
  planResult.hidden = false;
};

const handleAssessmentAnswer = (answer) => {
  if (!answer) return;
  appendAssessmentMessage(answer, true);
  assessmentAnswers.push(answer);
  assessmentStep += 1;
  if (assessmentStep >= 5) finishAssessment();
  else renderAssessmentQuestion();
};

assessmentOptions?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-answer]");
  if (button) handleAssessmentAnswer(button.dataset.answer);
});
assessmentForm?.addEventListener("submit", (event) => event.preventDefault());

const consultationLink = document.querySelector("[data-consultation-link]");
const updateConsultationLink = () => {
  const name =
    document.querySelector("[data-lead-name]")?.value.trim() || "Not provided";
  const email =
    document.querySelector("[data-lead-email]")?.value.trim() || "Not provided";
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Business: ${assessmentAnswers[0] || "Not provided"}`,
    `Monthly leads: ${assessmentAnswers[1] || "Not provided"}`,
    `Biggest time drain: ${assessmentAnswers[2] || "Not provided"}`,
    `First priority: ${assessmentAnswers[3] || "Not provided"}`,
  ].join("\n");
  consultationLink.href = `mailto:demo@phantomforce.online?subject=${encodeURIComponent("My free PhantomForce operations assessment")}&body=${encodeURIComponent(body)}`;
};
document
  .querySelectorAll("[data-lead-name], [data-lead-email]")
  .forEach((input) => input.addEventListener("input", updateConsultationLink));
consultationLink?.addEventListener("click", updateConsultationLink);
