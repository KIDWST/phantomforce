/* One extensible business registry. Profiles describe experiences, never access grants.
   Membership and server authorization remain the authority for every record. */
const commonRoutes = ["business-templates", "business-assets", "business-channels", "business-social"];
const nav = (id, label, icon = "grid") => ({ id, label, icon, ws: id, businessRoute: true });
const workflow = (kind, label, plural, stages, detail) => ({ kind, label, plural, stages, detail });
const template = (id, title, kind, description, checklist, notes) => ({ id, title, kind, description, checklist, notes });

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const BUSINESS_PROFILES = freeze({
  phantomforce: {
    id: "phantomforce", name: "PhantomForce", initials: "PF", kind: "Business operations",
    tagline: "A clear plan. Controlled execution.", eyebrow: "Your operating command center",
    description: "Turn client opportunities into websites, repeatable workflows, and work you can verify.",
    accent: "#a9e5bf", background: "#111716", logo: "PF", supportEmail: "",
    assistantName: "PhantomBot", assistantPlaceholder: "What should we move forward in PhantomForce?",
    nouns: { customer: "Client", customers: "Clients", work: "Projects", assets: "Brand & website assets" },
    labels: { dashboard: "Overview", leads: "CRM", sites: "Websites & stores", automation: "Approval-gated automation", content: "Client content", media: "Creative studio", phantomai: "PhantomBot" },
    primaryRoutes: ["dashboard", "business-social", "business-projects", "leads", "sites", "automation", "content", "money"],
    navigation: [nav("business-social", "Social accounts", "users"), nav("business-projects", "Projects", "site"), nav("business-templates", "Templates", "spark"), nav("business-assets", "Files", "media"), nav("business-channels", "Channels", "shield")],
    sections: [{ id: "overview", label: "Overview" }, { id: "projects", label: "Projects" }, { id: "templates", label: "Templates" }, { id: "assets", label: "Files" }, { id: "channels", label: "Channels" }],
    workflows: [
      workflow("project", "Website project", "Website projects", ["draft", "scoping", "building", "review", "complete"], "Scope, build, review, and hand off a website."),
      workflow("automation", "Automation plan", "Automation plans", ["draft", "scoping", "review", "ready"], "Map the trigger, safeguards, approval, and verification before any run."),
    ],
    templates: [
      template("website-launch", "Website launch", "project", "From a focused brief to an approved handoff.", ["Confirm business goals and audience", "Gather approved copy and assets", "Review desktop and mobile", "Get explicit launch approval"], "Outcome:\nAudience:\nPages:\nLead capture:\nSuccess measure:"),
      template("lead-followup", "Lead follow-up workflow", "automation", "Plan a useful follow-up with a human approval gate.", ["Confirm source and contact permission", "Draft the message", "Review recipient and channel", "Approve sending in Automations"], "Trigger:\nAudience:\nDraft message:\nApproval owner:\nStop condition:"),
      template("client-onboarding", "Client onboarding", "project", "Collect the essentials before work begins.", ["Agree on scope and deliverables", "Confirm client contact", "Request assets through approved channels", "Set review milestones"], "Client goal:\nDeliverables:\nTimeline:\nDependencies:"),
    ],
    channels: [{ id: "website", name: "Websites", detail: "Client sites and approved lead forms", route: "sites" }, { id: "email", name: "Email", detail: "Business inbox and approved outreach", route: "phantomhunter" }, { id: "social", name: "Social", detail: "Organization-specific social accounts", route: "business-social" }],
    prompts: ["Help me scope a new client website", "Review the approval gates in my automation plan", "Find the next step for my active projects"],
    assistantContext: "You are the PhantomForce business operations assistant. Focus on AI-assisted business operations, websites, leads, client delivery, and approval-gated automation. Drafting does not authorize sending, publishing, spending, or deployment. Use only records, credentials, assets, and notifications from this business.",
  },
  "client-chicagoshots": {
    id: "client-chicagoshots", name: "ChicagoShots", initials: "CS", kind: "Sports film & media days",
    tagline: "Capture the moment. Build the story.", eyebrow: "The production desk",
    description: "One place for teams, shoot dates, edits, delivery, and the content that keeps the season moving.",
    accent: "#c5fb62", background: "#111c35", logo: "CS", supportEmail: "",
    assistantName: "Studio assistant", assistantPlaceholder: "Plan a shoot, organize an edit, or draft a ChicagoShots caption…",
    nouns: { customer: "Team / client", customers: "Teams & clients", work: "Productions", assets: "Footage & deliverables" },
    labels: { dashboard: "Overview", leads: "CRM", bookings: "Shoot calendar", media: "Editing room", content: "Deliverables library", analytics: "Analytics", sites: "Portfolio & booking site", money: "Invoices", phantomai: "Studio assistant", automation: "Studio approvals", comms: "Client conversations" },
    primaryRoutes: ["dashboard", "business-social", "leads", "business-bookings", "business-calendar", "business-projects", "business-deliverables", "money", "business-gear", "chicagoshots", "analytics"],
    sharedRoutes: ["dashboard", "leads", "money", "media", "content", "sites", "analytics", "comms", "phantomai", "automation", "settings", "notifications", "memory", "phantomhunter"],
    navigation: [nav("business-social", "Social accounts", "users"), nav("business-bookings", "Bookings", "clock"), nav("business-calendar", "Calendar", "calendar"), nav("business-projects", "Projects", "site"), nav("business-deliverables", "Deliverables", "film"), nav("business-gear", "Gear", "grid"), nav("chicagoshots", "Marketing", "spark"), nav("business-templates", "Templates", "grid"), nav("business-assets", "Files", "media"), nav("business-channels", "Channels", "shield")],
    sections: [{ id: "overview", label: "Overview" }, { id: "bookings", label: "Bookings" }, { id: "calendar", label: "Calendar" }, { id: "projects", label: "Projects" }, { id: "deliverables", label: "Deliverables" }, { id: "gear", label: "Gear" }, { id: "templates", label: "Templates" }, { id: "assets", label: "Files" }, { id: "channels", label: "Channels" }],
    workflows: [
      workflow("shoot", "Shoot plan", "Shoot plans", ["draft", "briefing", "scheduled", "captured", "complete"], "Prepare a media day or game-day shoot with the team."),
      workflow("project", "Media project", "Media projects", ["draft", "briefing", "production", "editing", "review", "complete"], "Keep the client brief, shoot, edits, and final handoff together."),
      workflow("gear", "Gear item", "Gear", ["draft", "available", "reserved", "checked-out", "maintenance", "retired"], "Record equipment, its condition, and the shoot or person responsible for it."),
      workflow("edit", "Edit brief", "Edits", ["draft", "editing", "review", "ready", "complete"], "Track a cut through client review and approved delivery."),
      workflow("delivery", "Delivery plan", "Deliveries", ["draft", "preparing", "review", "ready", "complete"], "Check formats, names, and client approvals before handoff."),
      workflow("social", "Social draft", "Social drafts", ["draft", "editing", "review", "ready"], "Prepare a caption and asset package for an approved post."),
    ],
    templates: [
      template("media-day", "Team media day", "shoot", "Build a call sheet and shot list before the lights go on.", ["Confirm team, location, date, and roster", "Confirm athlete and venue permissions", "Plan lighting and shot stations", "Agree on deliverables and review date"], "Team:\nLocation:\nCall time:\nRoster / athlete count:\nShot list:\nDeliverables:"),
      template("highlight-reel", "Game-day highlight reel", "edit", "An edit brief for the moments that matter.", ["Select approved footage", "Confirm music rights", "Build the first cut", "Collect client notes", "Export agreed aspect ratios"], "Game / event:\nStory / key moments:\nTarget length:\nAspect ratios:\nReview deadline:"),
      template("delivery-package", "Client delivery package", "delivery", "Keep every promised file and version together.", ["Match files to agreed package", "Check audio and export quality", "Verify download permissions", "Record client approval"], "Client:\nPackage:\nFile naming:\nDelivery location:\nRevision allowance:"),
      template("social-rollout", "Season social rollout", "social", "A caption and release plan tied to approved footage.", ["Confirm approved assets", "Draft team-specific caption", "Check tags and credits", "Get publishing approval"], "Team:\nPlatform:\nCaption:\nTags / credits:\nRelease window:"),
    ],
    channels: [{ id: "instagram", name: "Instagram", detail: "Team reels, athlete portraits, and media-day galleries", route: "business-social" }, { id: "tiktok", name: "TikTok", detail: "Behind the scenes and sports edits", route: "business-social" }, { id: "youtube", name: "YouTube", detail: "Longer highlights and delivered films", route: "business-social" }, { id: "booking", name: "Booking website", detail: "Portfolio and team inquiry forms", route: "sites" }],
    prompts: ["Create a media-day shot list for a team", "Help me plan an edit and client review", "Draft captions for an approved highlight reel"],
    assistantContext: "You are the ChicagoShots studio assistant. This business provides sports videography, team media-day shoots, client booking, editing, deliverables, and social content. Use production terminology, call sheets, shot lists, review rounds, and delivery formats. Confirm athlete/venue permissions and music rights where relevant. Drafts never mean a booking is confirmed or a post is published. Use only this business's clients, footage, credentials, and history.",
  },
  "occasionally-odd": {
    id: "occasionally-odd", name: "Occasionally Odd", initials: "OO", kind: "Seasonal decor & custom goods",
    tagline: "A little strange. Made just for you.", eyebrow: "The maker's workroom",
    description: "Move seasonal ideas and custom requests from the order book to the workbench, one thoughtful detail at a time.",
    accent: "#edb78e", background: "#271e25", logo: "OO", supportEmail: "occasionallyoddsupport@gmail.com",
    assistantName: "Workroom assistant", assistantPlaceholder: "Plan a seasonal collection, custom order, or production batch…",
    nouns: { customer: "Customer", customers: "Customers & bulk buyers", work: "Orders", assets: "Product photos & designs" },
    labels: { dashboard: "Overview", leads: "Customers & bulk buyers", content: "Product photo library", media: "Product creative studio", analytics: "Shop & social performance", sites: "Storefront & listings", money: "Quotes & order costs", phantomai: "Workroom assistant", automation: "Order approvals", comms: "Customer conversations", bookings: "Order deadlines" },
    primaryRoutes: ["dashboard", "business-social", "business-orders", "business-products", "business-production", "business-inventory", "business-customers", "business-channels", "business-shipping", "business-marketing", "business-finance", "business-analytics"],
    sharedRoutes: ["dashboard", "media", "content", "sites", "comms", "phantomai", "automation", "settings", "notifications", "memory", "phantomhunter"],
    navigation: [nav("business-social", "Social accounts", "users"), nav("business-orders", "Orders", "users"), nav("business-products", "Products", "grid"), nav("business-production", "Production", "grid"), nav("business-inventory", "Inventory", "grid"), nav("business-customers", "Customers", "users"), nav("business-channels", "Channels", "shield"), nav("business-shipping", "Shipping", "site"), nav("business-marketing", "Marketing", "spark"), nav("business-finance", "Finance", "dollar"), nav("business-analytics", "Analytics", "chart"), nav("business-campaigns", "Campaign plans", "spark"), nav("business-licensing", "Licensing desk", "shield"), nav("business-templates", "Templates", "site"), nav("business-assets", "Files", "media")],
    sections: [{ id: "overview", label: "Overview" }, { id: "orders", label: "Orders" }, { id: "products", label: "Products" }, { id: "production", label: "Production" }, { id: "inventory", label: "Inventory" }, { id: "customers", label: "Customers" }, { id: "channels", label: "Channels" }, { id: "shipping", label: "Shipping" }, { id: "marketing", label: "Marketing" }, { id: "finance", label: "Finance" }, { id: "analytics", label: "Analytics" }, { id: "campaigns", label: "Campaign plans" }, { id: "licensing", label: "Licensing" }, { id: "templates", label: "Templates" }, { id: "assets", label: "Files" }],
    workflows: [
      workflow("order", "Custom / bulk order", "Orders", ["draft", "quoted", "confirmed", "production", "quality-check", "ready", "complete"], "Record requirements, quantity, deadline, and production progress."),
      workflow("product", "Seasonal product plan", "Product plans", ["draft", "design", "review", "production", "quality-check", "ready"], "Develop an original or authorized design into made-to-order goods."),
      workflow("campaign", "Special campaign", "Campaigns", ["draft", "planning", "review", "ready", "complete"], "Plan a seasonal release or an occasional special freebie with a clear budget."),
      workflow("licensing", "Licensing request", "Licensing requests", ["draft", "research", "review", "awaiting-response", "complete"], "Track the rights holder, requested use, and written authorization."),
    ],
    templates: [
      template("custom-order", "Made-to-order request", "order", "Capture the details that make an order personal.", ["Confirm dimensions, colors, and personalization", "Agree on quote and quantity", "Confirm deadline and delivery method", "Review quality before packing"], "Item / design:\nDimensions:\nColors:\nPersonalization:\nMaterials:\nDelivery method:"),
      template("bulk-order", "Bulk order brief", "order", "Plan quantities, samples, and a realistic production batch.", ["Confirm quantity and unit specifications", "Approve sample and quote", "Plan materials and batch capacity", "Check every unit before fulfillment"], "Buyer / event:\nQuantity:\nUnit specifications:\nSample approval:\nUnit cost estimate:\nDelivery window:"),
      template("seasonal-drop", "Seasonal collection", "product", "Original seasonal decor with a production plan.", ["Define the original design", "Confirm materials and costs", "Photograph an approved sample", "Prepare marketplace copy"], "Season / occasion:\nOriginal design concept:\nMaterials:\nMade-to-order lead time:\nListing draft:"),
      template("special-freebie", "Special freebie campaign", "campaign", "An occasional surprise with an intentional limit.", ["Set quantity and total budget", "Write eligibility and campaign terms", "Confirm shipping coverage", "Review announcement before posting"], "Occasion:\nFreebie item:\nQuantity cap:\nBudget cap:\nEligibility / terms:\nShipping responsibility:\nAnnouncement draft:"),
      template("horror-license", "Horror merchandise permission", "licensing", "Prepare a rights-holder inquiry without assuming permission.", ["Identify the rights holder", "Describe products, territories, and channels", "Record written permission and expiry", "Review terms before production or listing"], "Property / character:\nRights holder:\nProposed merchandise:\nTerritory / sales channels:\nRequested term:\nPermission reference:\nContact: occasionallyoddsupport@gmail.com"),
    ],
    channels: [{ id: "marketplace", name: "Marketplaces", detail: "Made-to-order listings and shop connections", route: "phantomhunter" }, { id: "storefront", name: "Storefront", detail: "Seasonal goods and custom-order requests", route: "sites" }, { id: "social", name: "Social channels", detail: "Product stories and occasional special campaigns", route: "business-social" }, { id: "email", name: "Customer support", detail: "occasionallyoddsupport@gmail.com", route: "phantomhunter" }],
    prompts: ["Help me quote a custom or bulk order", "Plan an original seasonal decor collection", "Draft a horror merchandise licensing inquiry", "Plan a small special freebie campaign"],
    assistantContext: "You are the Occasionally Odd workroom assistant. Focus on seasonal made-to-order decor, custom and bulk orders, production queues, marketplace channels, and occasional special freebie campaigns. Horror merchandise may use protected characters or brands only when written licensing authorization covers the proposed use; never assume a licensing inquiry grants permission. Support email: occasionallyoddsupport@gmail.com. Track quantities, materials, lead times, quality checks, and campaign limits. Never send, publish, purchase, or promise delivery without approval. Use only this business's customers, designs, channels, credentials, and history.",
  },
});

const aliases = Object.freeze({ chicagoshots: "client-chicagoshots", occasionallyodd: "occasionally-odd" });
export const BUSINESS_IDS = Object.freeze(Object.keys(BUSINESS_PROFILES));

/** Unknown companies receive their own neutral identity, never another company's content. */
export function getBusinessProfile(workspaceOrId = "phantomforce") {
  const workspace = typeof workspaceOrId === "object" && workspaceOrId ? workspaceOrId : { id: workspaceOrId };
  const id = String(workspace.businessProfileId || workspace.id || "");
  const registered = BUSINESS_PROFILES[aliases[id] || id];
  if (registered) return registered;
  const name = String(workspace.name || "Business workspace");
  return {
    id: String(workspace.id || ""), name, initials: name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
    kind: "Business workspace", tagline: "Your business. Your workspace.", eyebrow: "Business overview", description: "Organize the work, assets, and channels belonging to this business.",
    accent: "#c3cbd3", background: "#1a1e24", supportEmail: "", assistantName: "Business assistant", assistantPlaceholder: `What should we work on for ${name}?`,
    nouns: { customer: "Customer", customers: "Customers", work: "Projects", assets: "Business assets" }, labels: {}, primaryRoutes: ["dashboard", "business-social", "leads", "content", "sites"],
    navigation: commonRoutes.map((route) => nav(route, ({ "business-templates": "Templates", "business-assets": "Assets", "business-channels": "Channels", "business-social": "Social accounts" })[route])),
    sections: [{ id: "overview", label: "Overview" }, { id: "templates", label: "Templates" }, { id: "assets", label: "Assets" }, { id: "channels", label: "Channels" }], workflows: [], templates: [], channels: [], prompts: [],
    assistantContext: `You are the assistant for ${name}. Use only this business's authorized data, assets, history, and credentials. Ask for its operating preferences before adopting another company's workflow.`,
  };
}

export function businessAssistantContext(workspaceOrId) {
  const profile = getBusinessProfile(workspaceOrId);
  return `Active business: ${profile.name} (${profile.id}). ${profile.assistantContext}`;
}

export function businessCanOpenRoute(workspaceOrId, route) {
  const profile = getBusinessProfile(workspaceOrId);
  if (route === "chicagoshots") return profile.id === "client-chicagoshots";
  if (route === "business-crm") return profile.id === "client-chicagoshots";
  if (!String(route).startsWith("business-")) return true;
  return route === "business-overview" || profile.navigation.some((item) => item.id === route);
}

/** Preserve shared capabilities and permission flags; prioritize each business's work. */
export function businessNavigation(workspaceOrId, baseNavigation = []) {
  const profile = getBusinessProfile(workspaceOrId);
  const duplicateRelationships = new Set(baseNavigation.some((item) => item.id === "leads") ? ["clients", "followup", "business-crm"] : []);
  const supplied = [...baseNavigation.filter((item) => !duplicateRelationships.has(item.id) && businessCanOpenRoute(profile.id, item.id)
    && (!profile.sharedRoutes || profile.sharedRoutes.includes(item.id) || profile.navigation.some((route) => route.id === item.id)))];
  for (const item of profile.navigation) if (!supplied.some((existing) => existing.id === item.id)) supplied.push({ ...item });
  return supplied.map((item) => ({ ...item, label: profile.labels[item.id] || item.label }))
    .sort((a, b) => {
      const rank = (item) => { const index = profile.primaryRoutes.indexOf(item.id); return index < 0 ? profile.primaryRoutes.length : index; };
      return rank(a) - rank(b);
    });
}
