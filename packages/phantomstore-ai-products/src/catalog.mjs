const field = (id, label, type = "text", help = "", options = [], required = true) => ({ id, label, type, help, options, required });

export const PRODUCTS = Object.freeze([
  {
    id: "phantom-oracle", name: "PHANTOM ORACLE", category: "Decision Simulation & Strategy", accent: "#a986ff",
    tagline: "Turn consequential choices into transparent scenario simulations.",
    promise: "Model options, constraints, uncertainty, second-order effects, and measurable outcomes before committing resources.",
    primaryUsers: ["founders", "operators", "product leaders", "finance teams", "program managers", "consultants"],
    nonGoals: ["autonomous irreversible decisions", "presenting forecasts as facts", "regulated professional judgment"],
    modules: ["Decision Canvas", "Assumption Ledger", "Scenario Graph", "Monte Carlo Studio", "Constraint Engine", "Sensitivity Explorer", "Counterfactual Lab", "Trade-off Matrix", "Decision Journal", "Trigger Monitor", "Evidence Binder", "Executive Brief Builder"],
    primaryModule: "Decision Canvas", objectType: "decision_simulation", artifactLabel: "Decision simulation",
    fields: [field("decision", "Decision to make", "textarea"), field("objectives", "Objectives and weights", "textarea", "One per line: objective | weight"), field("options", "Options and scenario scores", "textarea", "One per line: option | optimistic | base | pessimistic"), field("uncertainty", "Uncertainty reserve (%)", "number"), field("constraints", "Constraints", "textarea", "One constraint per line", [], false), field("assumptions", "Assumption ledger", "textarea", "One per line: assumption ID | affected option | delta points | sensitivity 0-1", [], false), field("scenarioEdges", "Scenario relationships", "textarea", "One per line: upstream > downstream | relationship", [], false)],
    sample: { decision: "Choose a regional fulfillment strategy for the next twelve months.", objectives: "Continuity | 0.45\nMargin protection | 0.35\nSpeed to deploy | 0.20", options: "Single hub | 88 | 72 | 35\nDual source | 82 | 79 | 68\nDelay expansion | 58 | 61 | 80", uncertainty: "12", constraints: "Launch before peak season\nMaintain two-week safety stock", assumptions: "A1 | Single hub | -10 | 0.9\nA2 | Dual source | 4 | 0.8\nA3 | Delay expansion | -2 | 0.4", scenarioEdges: "Supplier disruption > Single hub downside | amplifies\nDual onboarding > Dual source upside | enables" },
    taskId: "oracle.scenario.rank.v1", metricName: "stability-adjusted option score", metricUnit: "points"
  },
  {
    id: "phantom-chronicle", name: "PHANTOM CHRONICLE", category: "Timeline Reconstruction & Evidence Intelligence", accent: "#ffb257",
    tagline: "Reconstruct what happened from scattered multimodal evidence.",
    promise: "Organize source-linked events into a chronology that distinguishes observations, inferences, contradictions, and gaps.",
    primaryUsers: ["journalists", "claims teams", "legal operations", "researchers", "incident reviewers", "documentary producers"],
    nonGoals: ["facial identification", "secret surveillance", "altering evidence", "asserting guilt or liability"],
    modules: ["Evidence Intake", "Metadata Inspector", "Timeline Builder", "Entity Resolver", "Contradiction Desk", "Source Provenance", "Confidence Layer", "Gap Finder", "Media Synchronizer", "Witness/Statement Matrix", "Chronology Report", "Redaction Studio"],
    primaryModule: "Evidence Intake", objectType: "source_linked_chronology", artifactLabel: "Chronology",
    fields: [field("matter", "Matter or investigation"), field("events", "Source-linked events", "textarea", "One per line: event ID | date/time or range | observed/inferred | event | source ID"), field("contradictions", "Known contradictions", "textarea", "One per line: source A | source B | issue"), field("gapThresholdDays", "Gap alert threshold (days)", "number")],
    sample: { matter: "Warehouse delivery review", events: "ARRIVAL | 2026-02-03T10:00:00Z | observed | Carrier scan records arrival | scan-14\nARRIVAL | 2026-02-03T16:00:00Z | observed | Supervisor note records arrival | note-22\nSTORAGE | 2026-02-04..2026-02-05 | inferred | Pallet moved to cold storage | note-22\nINTAKE | 2026-02-09 | observed | Receiver signed intake log | log-09", contradictions: "scan-14 | note-22 | Arrival time differs by six hours", gapThresholdDays: "3" },
    taskId: "chronicle.timeline.reconstruct.v1", metricName: "maximum chronology gap", metricUnit: "days"
  },
  {
    id: "phantom-foundry", name: "PHANTOM FOUNDRY", category: "Synthetic Data & AI Benchmark Factory", accent: "#42d9f5",
    tagline: "Manufacture high-quality synthetic datasets and benchmarks with traceable recipes.",
    promise: "Generate controlled evaluation fixtures, measure coverage, and publish versioned recipes without calling synthetic data ground truth.",
    primaryUsers: ["ML engineers", "AI product teams", "research labs", "QA teams", "data scientists", "model evaluators"],
    nonGoals: ["safeguard evasion", "claiming synthetic data is ground truth", "unauthorized model training"],
    modules: ["Schema Studio", "Scenario Recipe Builder", "Generator Fleet", "Coverage Matrix", "Deduplication Lab", "Quality Rater", "Bias Slice Explorer", "Adversarial Bench", "Dataset Versioning", "Lineage Graph", "Benchmark Runner", "Export Registry"],
    primaryModule: "Schema Studio", objectType: "benchmark_recipe", artifactLabel: "Benchmark recipe",
    fields: [field("dataset", "Dataset or benchmark name"), field("taxonomy", "Behavior taxonomy", "textarea", "One label per line"), field("examplesPerClass", "Examples per class", "number"), field("hardCasePercent", "Hard-case target (%)", "number"), field("seed", "Deterministic seed", "text", "Identical seed and recipe produce identical fixtures", [], false), field("schemaDefinition", "Schema definition", "textarea", "Explicit fields and types", [], false), field("scenarioRecipe", "Scenario recipe", "textarea", "Versioned local generation instructions", [], false)],
    sample: { dataset: "Support escalation intent benchmark", taxonomy: "routine_request\naccount_risk\nsafety_escalation\nambiguous_intent", examplesPerClass: "12", hardCasePercent: "25", seed: "support-v1-seed", schemaDefinition: "input:string\nexpected_label:string\nsynthetic:boolean", scenarioRecipe: "Create bounded label fixtures; preserve class balance; label every row synthetic." },
    taskId: "foundry.coverage.compile.v1", metricName: "planned taxonomy coverage", metricUnit: "%"
  },
  {
    id: "phantom-twin", name: "PHANTOM TWIN", category: "Operational Digital Twins", accent: "#42e6a4",
    tagline: "Build a living digital twin of how work actually flows.",
    promise: "Turn steps, resources, queues, demand, costs, and SLAs into an inspectable capacity and bottleneck model.",
    primaryUsers: ["operations leaders", "service businesses", "manufacturing planners", "support teams", "logistics coordinators", "process consultants"],
    nonGoals: ["physical machinery control", "employee surveillance", "autonomous employment decisions"],
    modules: ["Process Mapper", "Resource Catalog", "Queue Simulator", "Capacity Planner", "SLA Modeler", "Cost Flow", "Bottleneck Radar", "What-if Sandbox", "Shift Planner", "Variance Monitor", "Twin Calibration", "Scenario Export"],
    primaryModule: "Process Mapper", objectType: "operational_twin", artifactLabel: "Process twin",
    fields: [field("operation", "Operation name"), field("steps", "Process steps", "textarea", "One per line: step | minutes per item | parallel workers"), field("demandPerHour", "Demand (items/hour)", "number"), field("slaMinutes", "Target end-to-end SLA (minutes)", "number"), field("seed", "Deterministic simulation seed", "text", "Used to version repeatable scenarios", [], false), field("observedCalibration", "Observed calibration note", "textarea", "Keep modeled and observed evidence distinct", [], false)],
    sample: { operation: "Priority parts intake", steps: "Receive | 6 | 2\nInspect | 9 | 2\nCatalog | 5 | 1\nShelve | 4 | 1", demandPerHour: "10", slaMinutes: "30", seed: "priority-parts-v1", observedCalibration: "Observed median intake volume: 9.6 items/hour during the declared reference week." },
    taskId: "twin.capacity.simulate.v1", metricName: "bottleneck utilization", metricUnit: "%"
  },
  {
    id: "phantom-dealroom", name: "PHANTOM DEALROOM", category: "Negotiation Intelligence", accent: "#f3cb67",
    tagline: "Prepare, rehearse, and govern high-stakes negotiations.",
    promise: "Map interests, alternatives, concessions, packages, and commitments without coaching deception or coercion.",
    primaryUsers: ["sales teams", "procurement teams", "founders", "partnership leaders", "account executives", "agency owners"],
    nonGoals: ["coercion", "deception coaching", "unauthorized impersonation", "secret recording"],
    modules: ["Deal Map", "Interest Matrix", "BATNA Builder", "Concession Ladder", "Package Composer", "Counterpart Simulator", "Rehearsal Room", "Term Tracker", "Commitment Ledger", "Risk Flags", "Meeting Debrief", "Follow-up Composer"],
    primaryModule: "Deal Map", objectType: "negotiation_plan", artifactLabel: "Deal map",
    fields: [field("deal", "Negotiation name"), field("interests", "Interests", "textarea", "One per line: interest | our priority 1-5 | counterpart estimate 1-5"), field("packages", "Candidate packages", "textarea", "One per line: package | our value 0-100 | estimated counterpart value 0-100"), field("reservationScore", "Our minimum acceptable package score", "number"), field("parties", "Parties", "textarea", "One declared party per line", [], false), field("batna", "BATNA", "textarea", "One alternative per line", [], false), field("constraints", "Negotiation constraints", "textarea", "One constraint per line", [], false), field("concessionLadder", "Concession ladder", "textarea", "One per line: order | offer | condition", [], false), field("commitments", "Commitment ledger", "textarea", "One per line: proposed/confirmed | statement | owner | source ID", [], false)],
    sample: { deal: "Three-year logistics renewal", interests: "Delivery reliability | 5 | 5\nPayment timing | 3 | 4\nVolume flexibility | 4 | 3", packages: "Stable core | 82 | 76\nFlexible band | 74 | 84\nShort renewal | 68 | 61", reservationScore: "70", parties: "Our operations team\nDeclared logistics supplier", batna: "Run a six-month competitive bridge agreement", constraints: "No package below reservation score 70\nNo undisclosed recording or outreach", concessionLadder: "1 | Extend term to 30 months | Reliability SLA accepted\n2 | Extend payment timing by 10 days | Volume floor accepted", commitments: "proposed | Counterpart prefers 45-day payment timing | Supplier | meeting-note-1\nconfirmed | Our team will provide volume bands | Operations | signed-note-2" },
    taskId: "dealroom.package.compare.v1", metricName: "balanced package value", metricUnit: "points"
  },
  {
    id: "phantom-blueprint", name: "PHANTOM BLUEPRINT", category: "System Specification Compiler", accent: "#8ac8ff",
    tagline: "Compile an idea into a buildable technical system specification.",
    promise: "Turn requirements into traceable components, interfaces, data contracts, risks, tests, and implementation work packages.",
    primaryUsers: ["technical founders", "architects", "engineering managers", "agencies", "platform teams", "solution consultants"],
    nonGoals: ["general-purpose code editing", "silent infrastructure deployment", "replacing architecture review"],
    modules: ["Requirements Compiler", "Architecture Canvas", "Component Registry", "Data Contract Studio", "API Designer", "State Machine Builder", "Threat Boundary Map", "NFR Matrix", "Dependency Planner", "Test Blueprint", "Change Impact Graph", "Spec Exporter"],
    primaryModule: "Requirements Compiler", objectType: "traceable_system_spec", artifactLabel: "System specification",
    fields: [field("system", "System name"), field("requirements", "Testable requirements", "textarea", "One per line: REQ-ID | statement | component IDs"), field("components", "Components", "textarea", "One per line: component ID | responsibility"), field("threatBoundaries", "Threat boundaries", "textarea"), field("acceptanceCriteria", "Acceptance criteria", "textarea", "One per line: REQ-ID | criterion", [], false), field("dataContracts", "Data contracts", "textarea", "One contract per line", [], false), field("previousRequirements", "Previous requirement version", "textarea", "Used for change-impact comparison", [], false)],
    sample: { system: "Partner document exchange", requirements: "REQ-1 | Authorized partner uploads a document | API,STORE\nREQ-2 | Scanner quarantines unsafe content | SCAN,STORE\nREQ-3 | User can export an audit receipt | API,AUDIT", components: "API | validates identity and requests\nSTORE | encrypted object repository\nSCAN | asynchronous safety inspection\nAUDIT | immutable event writer", threatBoundaries: "Internet to API; API to object store; scanner quarantine to clean storage.", acceptanceCriteria: "REQ-1 | Given an entitled partner, a valid document is accepted once\nREQ-2 | Unsafe content is quarantined before availability\nREQ-3 | Export includes a stable audit receipt ID", dataContracts: "UploadRequest | partnerId:string, contentDigest:string\nAuditReceipt | id:string, occurredAt:date-time", previousRequirements: "REQ-1 | Authorized partner uploads a file | API,STORE\nREQ-2 | Scanner quarantines unsafe content | SCAN,STORE\nREQ-3 | User can export an audit receipt | API,AUDIT" },
    taskId: "blueprint.traceability.compile.v1", metricName: "requirement traceability", metricUnit: "%"
  },
  {
    id: "phantom-terrain", name: "PHANTOM TERRAIN", category: "Geospatial Site Intelligence", accent: "#64d9bd",
    tagline: "Explain places, constraints, and site trade-offs on one intelligent map.",
    promise: "Compare candidate sites with transparent weights, freshness, missing-data warnings, and reusable decision packages.",
    primaryUsers: ["retail planners", "event operators", "service businesses", "real-estate analysts", "field operations", "community planners"],
    nonGoals: ["military targeting", "individual tracking", "real-time personal surveillance", "presenting stale data as current"],
    modules: ["Layer Catalog", "Site Scorer", "Isochrone Studio", "Territory Builder", "Constraint Overlay", "Demand Surface", "Candidate Compare", "Weight Sensitivity", "Field Notes", "Map Story", "Data Freshness Monitor", "Export Composer"],
    primaryModule: "Layer Catalog", objectType: "site_comparison", artifactLabel: "Site comparison",
    fields: [field("question", "Site-selection question", "textarea"), field("criteria", "Criteria and weights", "textarea", "One per line: criterion | weight"), field("candidates", "Candidate scores", "textarea", "One per line: site | score for each criterion"), field("sourceDate", "Newest source date", "date"), field("constraints", "Candidate constraints", "textarea", "One per line: candidate | constraint | declared state", [], false), field("candidateCoordinates", "Candidate coordinates", "textarea", "One per line: candidate | longitude | latitude", [], false)],
    sample: { question: "Which service depot best balances access, resilience, and operating fit?", criteria: "Access | 0.45\nResilience | 0.30\nOperating fit | 0.25", candidates: "North yard | 82 | 74 | 88\nCentral lease | 91 | 61 | 70\nWest retrofit | 68 | 90 | 78", sourceDate: "2026-07-15", constraints: "Central lease | Flood review required | unresolved\nNorth yard | Night access limited | declared", candidateCoordinates: "North yard | -87.6400 | 41.8800\nCentral lease | -87.6298 | 41.8781\nWest retrofit | -87.7000 | 41.8810" },
    taskId: "terrain.site.score.v1", metricName: "transparent site score", metricUnit: "points"
  },
  {
    id: "phantom-proof", name: "PHANTOM PROOF", category: "Claim Verification & Provenance", accent: "#ff769b",
    tagline: "Turn important claims into inspectable evidence packets.",
    promise: "Decompose claims, compare supporting and opposing evidence, expose quality and freshness, and export caveated proof packets.",
    primaryUsers: ["analysts", "researchers", "policy teams", "journalists", "content teams", "executives"],
    nonGoals: ["declaring truth from model confidence", "fabricating citations", "bypassing access controls"],
    modules: ["Claim Decomposer", "Evidence Board", "Source Quality Lens", "Support/Oppose Matrix", "Citation Inspector", "Freshness Watch", "Circularity Detector", "Uncertainty Ledger", "Reviewer Workflow", "Proof Packet", "Change Log", "Export Studio"],
    primaryModule: "Claim Decomposer", objectType: "proof_packet", artifactLabel: "Proof packet",
    fields: [field("claim", "Claim under review", "textarea"), field("subclaims", "Atomic subclaims", "textarea", "One per line"), field("evidence", "Evidence records", "textarea", "One per line: support/oppose/context/uncertain | quality 0-1 | source ID | date"), field("uncertaintyNote", "Known uncertainty", "textarea"), field("sourceRegistry", "Source registry", "textarea", "One per line: source ID | reference | date | quality 0-1", [], false), field("citations", "Citation relationships", "textarea", "One per line: source ID > source ID", [], false)],
    sample: { claim: "The revised process reduced median response time during the pilot.", subclaims: "The revised process was used for all pilot cases.\nMedian response time was lower than the prior matched period.\nNo measurement definition changed between periods.", evidence: "support | 0.92 | metrics-pilot-7 | 2026-07-31\nsupport | 0.78 | methods-note-2 | 2026-07-29\noppose | 0.60 | staffing-change-4 | 2026-07-20", uncertaintyNote: "The pilot coincided with a temporary staffing increase.", sourceRegistry: "metrics-pilot-7 | urn:local:metrics-pilot-7 | 2026-07-31 | 0.92\nmethods-note-2 | urn:local:methods-note-2 | 2026-07-29 | 0.78\nstaffing-change-4 | urn:local:staffing-change-4 | 2026-07-20 | 0.60", citations: "methods-note-2 > metrics-pilot-7" },
    taskId: "proof.evidence.balance.v1", metricName: "weighted evidence balance", metricUnit: "points"
  },
  {
    id: "phantom-loom-dependency", name: "PHANTOM LOOM", category: "Dependency & Contradiction Intelligence", accent: "#b69cff",
    tagline: "Reveal the hidden dependency fabric across documents and plans.",
    promise: "Build a source-linked graph of commitments, dependencies, contradictions, ownership, deadlines, and change impact.",
    primaryUsers: ["program managers", "product organizations", "compliance teams", "construction planners", "research programs", "consulting teams"],
    nonGoals: ["editing source systems without action", "inventing owners or deadlines", "presenting inferred dependencies as facts"],
    modules: ["Corpus Intake", "Commitment Extractor", "Dependency Graph", "Contradiction Radar", "Owner Map", "Deadline Mesh", "Change Impact", "Source Trace", "Decision Registry", "Revision Diff", "Risk Threads", "Dependency Brief"],
    primaryModule: "Corpus Intake", objectType: "dependency_graph", artifactLabel: "Dependency graph",
    fields: [field("corpus", "Corpus or program name"), field("commitments", "Source-linked commitments", "textarea", "One per line: ID | owner | due date | source ID"), field("dependencies", "Dependencies", "textarea", "One per line: upstream ID > downstream ID | inferred/confirmed"), field("contradictions", "Known contradictions", "textarea", "One per line: ID | ID | reason"), field("sourceStatements", "Current source statements", "textarea", "One per line: source ID | revision | statement", [], false), field("previousSourceStatements", "Previous source statements", "textarea", "Used for revision-aware change impact", [], false)],
    sample: { corpus: "Regional launch plan", commitments: "C1 | Platform | 2026-09-10 | spec-4\nC2 | Operations | 2026-09-18 | plan-9\nC3 | Compliance | 2026-09-14 | policy-2", dependencies: "C1 > C2 | confirmed\nC3 > C2 | inferred", contradictions: "C1 | C3 | Retention periods disagree across source documents", sourceStatements: "spec-4 | 2 | Platform commits to C1 by 2026-09-10\nplan-9 | 1 | Operations commits to C2 by 2026-09-18\npolicy-2 | 1 | Compliance commits to C3 by 2026-09-14", previousSourceStatements: "spec-4 | 1 | Platform commits to C1 by 2026-09-08\nplan-9 | 1 | Operations commits to C2 by 2026-09-18\npolicy-2 | 1 | Compliance commits to C3 by 2026-09-14" },
    taskId: "loom.dependency.inspect.v1", metricName: "traceable commitment coverage", metricUnit: "%"
  },
  {
    id: "phantom-causal", name: "PHANTOM CAUSAL", category: "Experiment & Causal Analysis Workbench", accent: "#d1ef69",
    tagline: "Design better experiments and separate correlation from plausible causation.",
    promise: "Define hypotheses, confounders, treatments, metrics, thresholds, and uncertainty without overstating causal evidence.",
    primaryUsers: ["product teams", "growth teams", "researchers", "operations analysts", "marketing analysts", "data scientists"],
    nonGoals: ["causality claims from weak observation", "medical trial guidance", "automating consequential decisions from one experiment"],
    modules: ["Hypothesis Studio", "Causal DAG Builder", "Metric Registry", "Power Planner", "Assignment Designer", "Pre-registration", "Analysis Notebook", "Sensitivity Checks", "Segment Explorer", "Decision Thresholds", "Experiment Library", "Result Brief"],
    primaryModule: "Hypothesis Studio", objectType: "experiment_record", artifactLabel: "Experiment record",
    fields: [field("hypothesis", "Testable hypothesis", "textarea"), field("baselineRate", "Control conversion (%)", "number"), field("treatmentRate", "Treatment conversion (%)", "number"), field("sampleSizes", "Sample sizes", "text", "control N | treatment N"), field("confounders", "Known confounders", "textarea"), field("designType", "Design type", "select", "Observational evidence never proves causality", ["observational", "randomized"], false), field("variables", "Variable registry", "textarea", "One per line: variable | exposure/outcome/confounder", [], false), field("dagEdges", "Causal DAG edges", "textarea", "One per line: variable > variable", [], false)],
    sample: { hypothesis: "A guided intake checklist increases completed submissions.", baselineRate: "42", treatmentRate: "49", sampleSizes: "420 | 415", confounders: "Day-of-week mix\nReturning-user share\nOne mid-test copy clarification", designType: "observational", variables: "checklist_exposure | exposure\ncompleted_submission | outcome\nreturning_user | confounder\nday_of_week | confounder", dagEdges: "returning_user > checklist_exposure\nreturning_user > completed_submission\nday_of_week > checklist_exposure\nchecklist_exposure > completed_submission" },
    taskId: "causal.effect.inspect.v1", metricName: "observed absolute difference", metricUnit: "percentage points"
  }
]);

const PRODUCT_EXPERIENCE = Object.freeze({
  "phantom-oracle": {
    storeProductId: "product-ai-oracle", priceUsd: 39, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-oracle-cover-v3.png?v=20260817",
    cockpitLabel: "Scenario command table", actionLabel: "Simulate decision",
    useCases: [
      { id: "market-entry", title: "Market entry decision", audience: "Founders + strategy", summary: "Compare launch paths under downside, delay, and capital constraints.", outcome: "A ranked option set with assumptions, sensitivity, and trigger conditions." },
      { id: "vendor-selection", title: "Vendor selection", audience: "Operations + procurement", summary: "Score competing vendors without hiding trade-offs or uncertainty.", outcome: "A reviewable selection brief and assumption ledger." },
      { id: "capital-allocation", title: "Capital allocation", audience: "Finance + operators", summary: "Stress-test where limited budget creates the strongest resilient return.", outcome: "An uncertainty-adjusted allocation recommendation." },
    ],
  },
  "phantom-chronicle": {
    storeProductId: "product-ai-chronicle", priceUsd: 29, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-chronicle-cover-v3.png?v=20260817",
    cockpitLabel: "Evidence timeline desk", actionLabel: "Reconstruct timeline",
    useCases: [
      { id: "incident-review", title: "Incident reconstruction", audience: "Risk + operations", summary: "Align logs, statements, media, and gaps into one source-linked chronology.", outcome: "A defensible timeline that separates observation from inference." },
      { id: "claims-file", title: "Claims file review", audience: "Claims + legal ops", summary: "Expose conflicting dates and missing evidence before a case moves forward.", outcome: "A contradiction register and gap-focused chronology." },
      { id: "documentary-research", title: "Documentary research", audience: "Journalists + producers", summary: "Turn a scattered research corpus into an inspectable story timeline.", outcome: "A provenance-preserving chronology ready for editorial review." },
    ],
  },
  "phantom-foundry": {
    storeProductId: "product-ai-foundry", priceUsd: 49, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-foundry-cover-v3.png?v=20260817",
    cockpitLabel: "Benchmark fabrication line", actionLabel: "Forge benchmark",
    useCases: [
      { id: "intent-eval", title: "Intent-classification eval", audience: "AI product teams", summary: "Build balanced, seeded fixtures for routine, ambiguous, and high-risk intents.", outcome: "A versioned benchmark recipe with coverage and hard-case targets." },
      { id: "regression-suite", title: "Model regression suite", audience: "ML + QA", summary: "Freeze representative behaviors before a prompt or model migration.", outcome: "A reproducible regression pack with an immutable digest." },
      { id: "safety-slices", title: "Safety slice factory", audience: "Trust + safety", summary: "Plan difficult evaluation slices without calling synthetic data ground truth.", outcome: "A traceable adversarial fixture plan and bias-slice matrix." },
    ],
  },
  "phantom-twin": {
    storeProductId: "product-ai-twin", priceUsd: 49, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-twin-cover-v3.png?v=20260817",
    cockpitLabel: "Operations twin floor", actionLabel: "Run capacity twin",
    useCases: [
      { id: "service-capacity", title: "Service capacity planning", audience: "Service operators", summary: "Model queues, staffing, throughput, and SLA pressure before changing shifts.", outcome: "A bottleneck map and quantified capacity scenario." },
      { id: "warehouse-flow", title: "Warehouse flow", audience: "Logistics teams", summary: "Locate the step that limits intake, inspection, cataloging, or fulfillment.", outcome: "A throughput model with explicit units and constraints." },
      { id: "support-queues", title: "Support queue design", audience: "Support leaders", summary: "Test routing and staffing changes against real demand assumptions.", outcome: "A reviewable what-if plan with modeled-versus-observed calibration." },
    ],
  },
  "phantom-dealroom": {
    storeProductId: "product-ai-dealroom", priceUsd: 39, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-dealroom-cover-v3.png?v=20260817",
    cockpitLabel: "Negotiation strategy room", actionLabel: "Compare packages",
    useCases: [
      { id: "enterprise-renewal", title: "Enterprise renewal", audience: "Sales + account teams", summary: "Prepare packages, reservation points, concessions, and commitment boundaries.", outcome: "A balanced package strategy and rehearsal brief." },
      { id: "supplier-negotiation", title: "Supplier negotiation", audience: "Procurement", summary: "Map interests and trade terms without covert inference or coercion.", outcome: "A governed concession ladder and BATNA plan." },
      { id: "partnership-terms", title: "Partnership terms", audience: "Founders + partnerships", summary: "Compare structures that trade economics, control, speed, and risk.", outcome: "A decision-ready package matrix and commitment ledger." },
    ],
  },
  "phantom-blueprint": {
    storeProductId: "product-ai-blueprint", priceUsd: 39, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-blueprint-cover-v3.png?v=20260817",
    cockpitLabel: "System architecture compiler", actionLabel: "Compile specification",
    useCases: [
      { id: "saas-mvp", title: "SaaS MVP architecture", audience: "Technical founders", summary: "Turn a product brief into traceable components, contracts, risks, and tests.", outcome: "A buildable system specification with stable requirement IDs." },
      { id: "integration-design", title: "Integration design", audience: "Platform teams", summary: "Define API boundaries, data contracts, failure modes, and acceptance tests.", outcome: "An inspectable integration blueprint and change-impact graph." },
      { id: "agency-handoff", title: "Agency build handoff", audience: "Agencies + clients", summary: "Convert ambiguous scope into testable work packages before development begins.", outcome: "A shared source of truth for scope, architecture, and acceptance." },
    ],
  },
  "phantom-terrain": {
    storeProductId: "product-ai-terrain", priceUsd: 39, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-terrain-cover-v3.png?v=20260817",
    cockpitLabel: "Geospatial decision map", actionLabel: "Score candidate sites",
    useCases: [
      { id: "retail-site", title: "Retail site comparison", audience: "Retail planners", summary: "Balance access, demand, operating fit, and constraint freshness across candidates.", outcome: "A transparent site ranking with sensitivity and GeoJSON." },
      { id: "field-depot", title: "Field depot placement", audience: "Field operations", summary: "Compare response coverage and resilience without tracking individuals.", outcome: "A weighted location package with declared constraints." },
      { id: "event-location", title: "Event location planning", audience: "Event operators", summary: "Inspect access, capacity, neighborhood constraints, and contingency fit.", outcome: "A reusable site brief and constraint overlay." },
    ],
  },
  "phantom-proof": {
    storeProductId: "product-ai-proof", priceUsd: 29, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-proof-cover-v3.png?v=20260817",
    cockpitLabel: "Evidence verification chamber", actionLabel: "Build proof packet",
    useCases: [
      { id: "executive-claim", title: "Executive claim check", audience: "Leadership + analysts", summary: "Test a consequential claim against supporting, opposing, and contextual evidence.", outcome: "A caveated proof packet without a manufactured truth verdict." },
      { id: "content-fact-check", title: "Content fact-check", audience: "Editorial + content", summary: "Decompose copy into atomic claims and expose citation weakness before publishing.", outcome: "A reviewer-ready evidence board and source-quality ledger." },
      { id: "policy-research", title: "Policy evidence review", audience: "Research + policy", summary: "Preserve disagreement, freshness, and circular citations across a source set.", outcome: "An inspectable support/oppose matrix with uncertainty intact." },
    ],
  },
  "phantom-loom-dependency": {
    storeProductId: "product-ai-loom", priceUsd: 39, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-loom-cover-v3.png?v=20260817",
    cockpitLabel: "Dependency intelligence loom", actionLabel: "Weave dependency graph",
    useCases: [
      { id: "program-plan", title: "Cross-team program plan", audience: "Program leaders", summary: "Reveal commitments, owners, deadlines, blockers, and conflicting source statements.", outcome: "A revision-aware dependency graph and risk-thread brief." },
      { id: "compliance-change", title: "Compliance change impact", audience: "Compliance + product", summary: "Trace which systems and commitments move when a policy source changes.", outcome: "A source-linked impact map with confirmed and inferred edges separated." },
      { id: "construction-deps", title: "Construction dependencies", audience: "Project planners", summary: "Connect approvals, materials, crews, milestones, and contradictory plan revisions.", outcome: "A deadline mesh and contradiction register." },
    ],
  },
  "phantom-causal": {
    storeProductId: "product-ai-causal", priceUsd: 39, imageUrl: "/app/assets/phantomstore/ai-workspaces/phantom-causal-cover-v3.png?v=20260817",
    cockpitLabel: "Experiment design laboratory", actionLabel: "Inspect causal effect",
    useCases: [
      { id: "conversion-test", title: "Conversion experiment", audience: "Growth + product", summary: "Register a hypothesis, treatment, outcome, sample, and known confounders.", outcome: "A power-aware experiment brief with bounded conclusions." },
      { id: "operations-pilot", title: "Operations pilot", audience: "Operations analysts", summary: "Separate observed improvement from staffing, seasonality, and selection effects.", outcome: "A causal DAG and reviewer-ready effect estimate." },
      { id: "feature-rollout", title: "Feature rollout analysis", audience: "Product analytics", summary: "Audit whether a measured lift survives exposure bias and confounding.", outcome: "A transparent causal analysis plan without false certainty." },
    ],
  },
});

export const PRODUCT_IDS = Object.freeze(PRODUCTS.map((product) => product.id));
export const productById = (id) => PRODUCTS.find((product) => product.id === id) || null;

export function publicProduct(product) {
  const experience = PRODUCT_EXPERIENCE[product.id] || {};
  return {
    ...product,
    ...experience,
    store: { state: "paid_account_product", productId: experience.storeProductId || null, route: `/app/index.html#phantomstore/${product.id}`, priceUsd: experience.priceUsd || null, currency: "USD", ownership: "account", commerceActive: true, portabilityDays: 30 },
    analysisContract: {
      taskId: product.taskId,
      inputSchema: product.fields.map(({ id, type, required }) => ({ id, type, required })),
      outputSchemaVersion: 1,
      activePath: "deterministic-domain-v1",
      fallbackPath: "deterministic-conservative-v1",
      externalModelsActive: false,
      sourceReferencesRequired: true,
      humanReviewRequired: true,
      costCeilingUsd: 0,
      maxContextChars: 12000,
      rollbackVersion: "v1"
    }
  };
}

if (PRODUCTS.length !== 10 || new Set(PRODUCT_IDS).size !== 10) throw new Error("The PHANTOMStore AI portfolio must contain exactly ten unique SKUs.");
