/* PhantomForce page worker prompts.
   Lightweight, local-first intake that makes every major page feel like a
   worker can take the request. This does not execute external actions; it
   explains the next steps in plain English and leaves execution to the page's
   existing controls. */

const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const PAGE_WORKERS = {
  automation: {
    eyebrow: "Automation worker",
    title: "Tell Phantom what should repeat.",
    placeholder: "Enter your automation here and we’ll go through what we can do for you...",
    helper: "Example: every weekday, find new leads, draft follow-ups, and put anything risky in Approvals.",
    steps: [
      "Find the trigger: when this should start.",
      "Check the apps, files, or data it needs.",
      "Draft the workflow in simple steps.",
      "Mark sends, posts, deletes, spending, and client messages for approval.",
      "Save it as an automation you can turn on when it looks right.",
    ],
  },
  sites: {
    eyebrow: "Website worker",
    title: "Tell Phantom what to build or change.",
    placeholder: "Describe the page, store, section, form, or offer you want...",
    helper: "Use this for site edits, store ideas, checkout plans, or landing pages.",
    steps: [
      "Turn your request into a page or store plan.",
      "Check the current site structure before changing anything.",
      "Draft the new section, copy, layout, or product block.",
      "Preview the change so you can review it first.",
      "Keep publishing behind the existing approval controls.",
    ],
  },
  content: {
    eyebrow: "Content worker",
    title: "Tell Phantom what content you need.",
    placeholder: "Ask for posts, ideas, captions, a schedule, or a campaign plan...",
    helper: "Finished content moves through Content Hub instead of scattered notes.",
    steps: [
      "Turn the ask into a post, campaign, or content plan.",
      "Match it to the right platform and format.",
      "Draft the copy, creative angle, and publish notes.",
      "Place it in drafts, calendar, or review.",
      "Leave posting gated until the account is connected and approved.",
    ],
  },
  assets: {
    eyebrow: "Asset worker",
    title: "Tell Phantom what to find or organize.",
    placeholder: "Ask to sort files, find a logo, tag assets, or clean up a folder...",
    helper: "Use this when you want your files easier to use.",
    steps: [
      "Identify the file type and business it belongs to.",
      "Group related files together.",
      "Add useful tags and plain names.",
      "Flag missing, duplicate, or low-quality assets.",
      "Keep originals safe while preparing working copies.",
    ],
  },
  intelligence: {
    eyebrow: "Research worker",
    title: "Tell Phantom who or what to watch.",
    placeholder: "Name a competitor, offer, market, or customer question...",
    helper: "This uses public signals only and labels guesses as guesses.",
    steps: [
      "Collect public signals that are safe to review.",
      "Group repeated customer questions and complaints.",
      "Separate confirmed facts from estimates.",
      "Create original response ideas, not copied content.",
      "Show sources and safe next moves.",
    ],
  },
  analytics: {
    eyebrow: "Analytics worker",
    title: "Ask what is working.",
    placeholder: "Ask why a post worked, what changed, or what to do next...",
    helper: "Plain-English answers first, numbers second.",
    steps: [
      "Find the metric or content you care about.",
      "Compare it against recent activity.",
      "Call out the simple reason it may be up or down.",
      "Suggest one clear next move.",
      "Keep deeper reporting available when you need it.",
    ],
  },
  vacation: {
    eyebrow: "Away worker",
    title: "Tell Phantom what to cover while you’re away.",
    placeholder: "Describe what should keep moving while you’re gone...",
    helper: "Away Mode is for coverage, follow-ups, drafts, and urgent alerts.",
    steps: [
      "List the work that should continue.",
      "Check what can be handled automatically.",
      "Queue risky sends, posts, money, or client moves for review.",
      "Track what happened in the activity feed.",
      "Surface urgent items first.",
    ],
  },
  phantomplay: {
    eyebrow: "Play worker",
    title: "Ask PhantomPlay for the right break.",
    placeholder: "Ask for a quick focus game, saved progress, or a game type...",
    helper: "Intentional downtime stays separate from business work.",
    steps: [
      "Pick the right game length and category.",
      "Load the safe play surface.",
      "Save score and progress when supported.",
      "Keep developer submissions in review.",
      "Return you to work cleanly.",
    ],
  },
};

const DEFAULT_WORKER = {
  eyebrow: "Page worker",
  title: "Tell Phantom what you need here.",
  placeholder: "Ask for the outcome you want on this page...",
  helper: "Phantom turns the ask into clear next steps before anything risky happens.",
  steps: [
    "Understand the outcome you want.",
    "Check the current workspace context.",
    "Draft the cleanest next steps.",
    "Use the right page tools instead of making you hunt.",
    "Bring risky actions back for review first.",
  ],
};

const SKIP_PAGES = new Set(["media", "settings", "developer", "activity", "promptlibrary", "account"]);

function workerFor(pageId) {
  return PAGE_WORKERS[pageId] || DEFAULT_WORKER;
}

export function pageWorkerHtml(pageId, def = {}) {
  if (SKIP_PAGES.has(pageId) || def.ownerOnly) return "";
  const worker = workerFor(pageId);
  return `
    <section class="page-worker" data-page-worker="${esc(pageId)}">
      <div class="page-worker-copy">
        <p>${esc(worker.eyebrow)}</p>
        <h3>${esc(worker.title)}</h3>
        <span>${esc(worker.helper)}</span>
      </div>
      <form class="page-worker-form" data-page-worker-form>
        <textarea data-page-worker-input rows="1" placeholder="${esc(worker.placeholder)}" aria-label="${esc(worker.title)}"></textarea>
        <button type="submit" aria-label="Plan this request">Plan</button>
      </form>
      <div class="page-worker-output" data-page-worker-output hidden></div>
    </section>`;
}

function stepsFor(pageId, prompt) {
  const worker = workerFor(pageId);
  const text = prompt.trim();
  const actionLine = text
    ? `You asked: “${text.slice(0, 160)}${text.length > 160 ? "…" : ""}”`
    : "Tell Phantom the outcome and it will shape the work.";
  return { actionLine, steps: worker.steps };
}

function renderPlan(card, pageId, prompt) {
  const out = card.querySelector("[data-page-worker-output]");
  if (!out) return;
  const { actionLine, steps } = stepsFor(pageId, prompt);
  out.hidden = false;
  out.innerHTML = `
    <b>${esc(actionLine)}</b>
    <ul>
      ${steps.map((step) => `<li>${esc(step)}</li>`).join("")}
    </ul>`;
}

export function mountPageWorkers(root = document, opts = {}) {
  root.querySelectorAll("[data-page-worker-form]").forEach((form) => {
    if (form.dataset.pageWorkerBound) return;
    form.dataset.pageWorkerBound = "1";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const card = form.closest("[data-page-worker]");
      const pageId = card?.dataset.pageWorker || "page";
      const input = form.querySelector("[data-page-worker-input]");
      const prompt = input?.value || "";
      renderPlan(card, pageId, prompt);
      opts.notify?.("Phantom", pageId === "automation"
        ? "I mapped the automation request into plain-English steps."
        : "I mapped the request into plain-English steps.");
    });
  });
  root.querySelectorAll("[data-page-worker-input]").forEach((input) => {
    if (input.dataset.pageWorkerAutosize) return;
    input.dataset.pageWorkerAutosize = "1";
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(120, Math.max(40, input.scrollHeight))}px`;
    });
  });
}

