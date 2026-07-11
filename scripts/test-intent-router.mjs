/* Intent router behavior contract — run with: node scripts/test-intent-router.mjs
   Guards the core chat promise: casual talk and venting stay conversation,
   questions stay questions, website requests create REAL Websites projects
   (never orphaned build packets), and risky actions always route to approval. */
import { classifyPhantomIntent } from "../app/js/intent-router.js";

const CASES = [
  // conversation stays conversation
  ["what's up", "greeting"],
  ["hey phantom", "greeting"],
  ["thanks", "gratitude"],
  ["I'm overwhelmed by everything today", "vent"],
  ["im so stressed with the business", "vent"],
  ["I have an idea for a video", "chat"],
  // questions stay questions
  ["how do I make a website?", "question"],
  ["what should my website say?", "question"],
  ["how do I make a campaign?", "question"],
  ["what's the weather today", "question"],
  // websites are real projects, chat and builder share them
  ["build me a website for ChicagoShots sports media", "create_website"],
  ["make a website for Air Authority", "create_website"],
  ["Create a premium sports media website for ChicagoShots. Focus on recruitment videos.", "create_website"],
  ["create a landing page for the gym launch", "create_website"],
  ["can you make the site more premium?", "website_update"],
  ["change the headline to Premium Shots", "website_update"],
  // explicit records
  ["create a task to update the pricing page", "create_task"],
  ["build me a campaign for next week", "looper_build"],
  // server agent runs — explicit "run a …" only, questions stay questions
  ["run a business snapshot", "run_agent"],
  ["can you run a provider health check", "run_agent"],
  ["run an ai health check", "run_agent"],
  ["how do I run a business snapshot?", "question"],
  // risk always gates
  ["publish the site now", "approval_request"],
  ["send the invoice", "approval_request"],
  // status needs status phrasing
  ["what's today's plan", "status_check"],
  ["catch me up", "status_check"],
];

let failures = 0;
for (const [text, want] of CASES) {
  const got = classifyPhantomIntent(text).primaryIntent;
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  "${text}" -> ${got}${ok ? "" : ` (wanted ${want})`}`);
}
console.log(failures ? `${failures} FAILURES` : `ALL ${CASES.length} PASS`);
process.exit(failures ? 1 : 0);
