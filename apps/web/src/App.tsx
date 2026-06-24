import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Command,
  FileText,
  Inbox,
  KeyRound,
  Link2,
  Lock,
  Mail,
  MessageSquare,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, ReactNode, useMemo, useState } from "react";

type Route = "command" | "inbox" | "calendar" | "tasks" | "approvals" | "activity" | "connections";
type ApprovalKind = "email" | "calendar" | "task";
type ApprovalStatus = "pending" | "approved" | "rejected";
type ActivityLevel = "ok" | "info" | "warn";

type EmailItem = {
  id: string;
  from: string;
  subject: string;
  preview: string;
  age: string;
  priority: "high" | "medium" | "low";
  status: "needs-reply" | "waiting" | "handled";
  project: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  owner: string;
  status: "confirmed" | "proposed" | "hold";
};

type TaskItem = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: "today" | "queued" | "done";
};

type Approval = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  payload: Record<string, string>;
  reversible: boolean;
  status: ApprovalStatus;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  level: ActivityLevel;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Connection = {
  id: string;
  name: string;
  description: string;
  status: "connected" | "ready" | "locked";
  scopes: string[];
};

const navItems: Array<{ id: Route; label: string; icon: ReactNode }> = [
  { id: "command", label: "Command", icon: <Command size={18} /> },
  { id: "inbox", label: "Inbox", icon: <Inbox size={18} /> },
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={18} /> },
  { id: "tasks", label: "Tasks", icon: <SquareCheckBig size={18} /> },
  { id: "approvals", label: "Approvals", icon: <ShieldCheck size={18} /> },
  { id: "activity", label: "Activity", icon: <Activity size={18} /> },
  { id: "connections", label: "Connections", icon: <Link2 size={18} /> },
];

const initialEmails: EmailItem[] = [
  {
    id: "mail-1",
    from: "Maya Chen",
    subject: "Can we lock a shoot date next week?",
    preview: "Need a quick slot for the product shoot and a quote before Friday.",
    age: "18m",
    priority: "high",
    status: "needs-reply",
    project: "ChicagoShots",
  },
  {
    id: "mail-2",
    from: "Southside Elite",
    subject: "Roster updates and parent contact list",
    preview: "Three players changed teams and two forms are still missing.",
    age: "2h",
    priority: "medium",
    status: "waiting",
    project: "Sports Ops",
  },
  {
    id: "mail-3",
    from: "Air Authority",
    subject: "Follow-up after estimate",
    preview: "Customer asked whether Tuesday install is still possible.",
    age: "4h",
    priority: "medium",
    status: "needs-reply",
    project: "Service Pipeline",
  },
];

const initialEvents: CalendarEvent[] = [
  {
    id: "event-1",
    title: "Open production window",
    time: "Tue 10:30 AM",
    owner: "Jordan",
    status: "hold",
  },
  {
    id: "event-2",
    title: "Client approval call",
    time: "Wed 2:00 PM",
    owner: "Maya Chen",
    status: "confirmed",
  },
  {
    id: "event-3",
    title: "Roster review",
    time: "Thu 6:30 PM",
    owner: "Southside Elite",
    status: "proposed",
  },
];

const initialTasks: TaskItem[] = [
  {
    id: "task-1",
    title: "Reply to Maya with shoot options",
    owner: "PhantomForce",
    due: "Today",
    status: "today",
  },
  {
    id: "task-2",
    title: "Review missing sports forms",
    owner: "Ops",
    due: "Tomorrow",
    status: "queued",
  },
  {
    id: "task-3",
    title: "Draft Air Authority follow-up",
    owner: "Assistant",
    due: "Today",
    status: "today",
  },
];

const initialActivity: ActivityItem[] = [
  {
    id: "act-1",
    title: "Morning brief generated",
    detail: "3 emails need action, 2 calendar holds, 2 approval-ready workflows.",
    time: "9:02 AM",
    level: "ok",
  },
  {
    id: "act-2",
    title: "Google connectors checked",
    detail: "Gmail and Calendar are ready in demo mode. No external writes without approval.",
    time: "9:01 AM",
    level: "info",
  },
  {
    id: "act-3",
    title: "Falcon boundary locked",
    detail: "Raw commands, files, logs, and model settings are not exposed to clients.",
    time: "8:58 AM",
    level: "warn",
  },
];

const initialMessages: Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content:
      "PhantomForce is online. I found one urgent client follow-up, two scheduling opportunities, and one approval-ready action. Ask me to handle the day, schedule a call, draft replies, or clean up the inbox.",
  },
];

const connections: Connection[] = [
  {
    id: "gmail",
    name: "Google Gmail",
    description: "Read inbox, identify follow-ups, draft replies, and send only after approval.",
    status: "connected",
    scopes: ["Read mail", "Draft mail", "Send with approval"],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Check availability, propose meeting times, and create events after approval.",
    status: "connected",
    scopes: ["Read calendar", "Create with approval"],
  },
  {
    id: "falcon",
    name: "Falcon private worker",
    description: "Future typed backend jobs. No raw command execution in the client app.",
    status: "locked",
    scopes: ["Typed jobs only", "Staff diagnostics", "Kill switch"],
  },
];

const modules = [
  "AI Command",
  "Email",
  "Calendar",
  "Tasks",
  "Approvals",
  "Activity",
  "Contacts",
  "Documents",
  "Falcon Worker",
];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function App() {
  const [route, setRoute] = useState<Route>("command");
  const [signedIn, setSignedIn] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emails, setEmails] = useState(initialEmails);
  const [events, setEvents] = useState(initialEvents);
  const [tasks, setTasks] = useState(initialTasks);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activity, setActivity] = useState(initialActivity);
  const [selectedOrg, setSelectedOrg] = useState("PhantomForce Pilot");

  const stats = useMemo(() => {
    return {
      urgent: emails.filter((email) => email.status === "needs-reply").length,
      pending: approvals.filter((approval) => approval.status === "pending").length,
      today: tasks.filter((task) => task.status === "today").length,
      events: events.length,
    };
  }, [emails, approvals, tasks, events]);

  function addActivity(title: string, detail: string, level: ActivityLevel = "info") {
    setActivity((current) => [
      {
        id: makeId("act"),
        title,
        detail,
        time: "Just now",
        level,
      },
      ...current,
    ]);
  }

  function createFollowUpPlan(source = "command") {
    const targetEmail = emails.find((email) => email.status === "needs-reply") || emails[0];
    const emailApproval: Approval = {
      id: makeId("approval-email"),
      kind: "email",
      title: `Send reply to ${targetEmail.from}`,
      summary: "Confirm next-week availability, offer two call windows, and ask for final shoot details.",
      payload: {
        recipient: targetEmail.from,
        subject: `Re: ${targetEmail.subject}`,
        body:
          "Thanks for the details. I can hold Tuesday at 10:30 AM or Wednesday at 2:00 PM for a quick planning call. Send the final shoot requirements and I will lock the path from there.",
      },
      reversible: false,
      status: "pending",
    };
    const calendarApproval: Approval = {
      id: makeId("approval-calendar"),
      kind: "calendar",
      title: "Create planning call",
      summary: "Place a tentative call on the calendar after the client confirms the preferred slot.",
      payload: {
        title: `Planning call with ${targetEmail.from}`,
        time: "Next Tue 10:30 AM",
        participants: targetEmail.from,
      },
      reversible: true,
      status: "pending",
    };

    setApprovals((current) => [emailApproval, calendarApproval, ...current]);
    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          source === "demo"
            ? "Demo flow ready: I found Maya's follow-up, drafted the reply, checked the calendar, and created two approval cards. Nothing external happens until you approve."
            : "I found the best next action: reply to Maya and reserve a call window. I prepared an email and a calendar event for approval. No external action has been taken.",
      },
    ]);
    addActivity("Approval cards created", "Email and calendar actions are waiting for review.", "ok");
    setRoute("command");
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const text = commandText.trim();
    if (!text) return;
    setCommandText("");
    setMessages((current) => [...current, { id: makeId("msg-user"), role: "user", content: text }]);

    const lower = text.toLowerCase();
    if (lower.includes("schedule") || lower.includes("follow") || lower.includes("handle") || lower.includes("email")) {
      createFollowUpPlan();
      return;
    }

    if (lower.includes("brief") || lower.includes("today")) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("msg-assistant"),
          role: "assistant",
          content:
            "Today needs focus on 2 replies, 3 active tasks, and 1 calendar hold. The fastest win is approving the client follow-up package, then clearing the Air Authority reply.",
        },
      ]);
      addActivity("Brief requested", "Assistant summarized the current operational load.", "info");
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: makeId("msg-assistant"),
        role: "assistant",
        content:
          "I can help with that. For this first build, I can brief the day, find follow-ups, create approval cards, organize tasks, and prepare email/calendar actions for review.",
      },
    ]);
  }

  function approveAction(id: string) {
    const approval = approvals.find((item) => item.id === id);
    if (!approval) return;

    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "approved" } : item)),
    );

    if (approval.kind === "email") {
      setEmails((current) =>
        current.map((email) =>
          approval.payload.recipient === email.from ? { ...email, status: "handled" } : email,
        ),
      );
    }

    if (approval.kind === "calendar") {
      setEvents((current) => [
        {
          id: makeId("event"),
          title: approval.payload.title,
          time: approval.payload.time,
          owner: approval.payload.participants,
          status: "confirmed",
        },
        ...current,
      ]);
    }

    if (approval.kind === "task") {
      setTasks((current) => [
        {
          id: makeId("task"),
          title: approval.payload.title,
          owner: "PhantomForce",
          due: approval.payload.due,
          status: "queued",
        },
        ...current,
      ]);
    }

    addActivity("Approved action executed", approval.title, "ok");
  }

  function rejectAction(id: string) {
    const approval = approvals.find((item) => item.id === id);
    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "rejected" } : item)),
    );
    if (approval) addActivity("Action rejected", approval.title, "warn");
  }

  function completeTask(id: string) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, status: "done" } : task)),
    );
    addActivity("Task completed", "A task was marked complete from the PhantomForce app.", "ok");
  }

  if (!signedIn) {
    return <LoginScreen onSignIn={() => setSignedIn(true)} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>PhantomForce</strong>
            <span>AI operations app</span>
          </div>
        </div>

        <div className="org-switcher">
          <span>Organization</span>
          <select value={selectedOrg} onChange={(event) => setSelectedOrg(event.target.value)}>
            <option>PhantomForce Pilot</option>
            <option>ChicagoShots</option>
            <option>Sports Ops Demo</option>
          </select>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={route === item.id ? "active" : ""}
              type="button"
              onClick={() => setRoute(item.id)}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "approvals" && stats.pending > 0 ? <b>{stats.pending}</b> : null}
            </button>
          ))}
        </nav>

        <div className="engine-card">
          <div>
            <span className="status-dot locked" />
            <p>Falcon worker</p>
          </div>
          <strong>Private boundary</strong>
          <small>Typed jobs later. No raw console, files, logs, or shell access in the client app.</small>
        </div>
      </aside>

      <main className="workspace">
        <Topbar selectedOrg={selectedOrg} pending={stats.pending} />
        {route === "command" ? (
          <CommandCenter
            messages={messages}
            commandText={commandText}
            setCommandText={setCommandText}
            submitCommand={submitCommand}
            createFollowUpPlan={() => createFollowUpPlan("demo")}
            stats={stats}
            approvals={approvals}
            approveAction={approveAction}
            rejectAction={rejectAction}
            emails={emails}
            events={events}
          />
        ) : null}
        {route === "inbox" ? <InboxView emails={emails} createFollowUpPlan={createFollowUpPlan} /> : null}
        {route === "calendar" ? <CalendarView events={events} /> : null}
        {route === "tasks" ? <TasksView tasks={tasks} completeTask={completeTask} /> : null}
        {route === "approvals" ? (
          <ApprovalsView approvals={approvals} approveAction={approveAction} rejectAction={rejectAction} />
        ) : null}
        {route === "activity" ? <ActivityView activity={activity} /> : null}
        {route === "connections" ? <ConnectionsView /> : null}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 5).map((item) => (
          <button
            key={item.id}
            className={route === item.id ? "active" : ""}
            type="button"
            onClick={() => setRoute(item.id)}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function LoginScreen({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand-row large">
          <div className="brand-mark">
            <Sparkles size={24} />
          </div>
          <div>
            <strong>PhantomForce AI</strong>
            <span>Business command app</span>
          </div>
        </div>
        <h1>Run the business from one command center.</h1>
        <p>
          Email, scheduling, approvals, tasks, activity history, and AI-assisted operations in one mobile-ready product.
        </p>
        <div className="hero-asset">
          <img src="/assets/operator-core.png" alt="PhantomForce operator interface preview" />
        </div>
      </section>
      <section className="login-panel">
        <span className="panel-label">Pilot access</span>
        <h2>One login. One business brain.</h2>
        <label>
          Email
          <input defaultValue="jordan@phantomforce.online" />
        </label>
        <label>
          Password
          <input type="password" defaultValue="phantomforce" />
        </label>
        <button className="primary-action" type="button" onClick={onSignIn}>
          <KeyRound size={18} />
          Enter PhantomForce
        </button>
        <div className="login-rails">
          <p>
            <Lock size={16} />
            External sends and calendar writes require explicit approval.
          </p>
          <p>
            <ShieldCheck size={16} />
            Organization isolation is part of the foundation.
          </p>
        </div>
      </section>
    </main>
  );
}

function Topbar({ selectedOrg, pending }: { selectedOrg: string; pending: number }) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Live workspace</span>
        <h1>{selectedOrg}</h1>
      </div>
      <div className="topbar-actions">
        <button type="button" title="Search">
          <Search size={18} />
        </button>
        <button type="button" title="Notifications">
          <Bell size={18} />
          {pending > 0 ? <b>{pending}</b> : null}
        </button>
        <button type="button" title="Settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

function CommandCenter({
  messages,
  commandText,
  setCommandText,
  submitCommand,
  createFollowUpPlan,
  stats,
  approvals,
  approveAction,
  rejectAction,
  emails,
  events,
}: {
  messages: Message[];
  commandText: string;
  setCommandText: (value: string) => void;
  submitCommand: (event: FormEvent) => void;
  createFollowUpPlan: () => void;
  stats: { urgent: number; pending: number; today: number; events: number };
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  emails: EmailItem[];
  events: CalendarEvent[];
}) {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  return (
    <div className="command-layout">
      <section className="command-main">
        <div className="hero-command">
          <div>
            <span className="eyebrow">AI command center</span>
            <h2>Ask. Review. Approve. Move the business.</h2>
            <p>
              PhantomForce turns inbox pressure, calendar gaps, and scattered tasks into approved business actions.
            </p>
          </div>
          <button className="demo-button" type="button" onClick={createFollowUpPlan}>
            <Play size={18} />
            Run first gold demo
          </button>
        </div>

        <div className="metric-grid">
          <Metric icon={<Mail size={18} />} label="Follow-ups" value={stats.urgent} tone="danger" />
          <Metric icon={<ShieldCheck size={18} />} label="Approvals" value={stats.pending} tone="gold" />
          <Metric icon={<SquareCheckBig size={18} />} label="Today tasks" value={stats.today} tone="green" />
          <Metric icon={<CalendarDays size={18} />} label="Calendar items" value={stats.events} tone="blue" />
        </div>

        <section className="chat-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">Business assistant</span>
              <h3>Command thread</h3>
            </div>
            <span className="safe-pill">
              <ShieldCheck size={15} />
              Approval gated
            </span>
          </div>
          <div className="messages" aria-live="polite">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar">{message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}</div>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
          <form className="command-form" onSubmit={submitCommand}>
            <input
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="Ask PhantomForce to brief, reply, schedule, or handle a follow-up..."
            />
            <button type="submit" title="Send command">
              <Send size={18} />
            </button>
          </form>
        </section>
      </section>

      <aside className="command-side">
        <section className="panel asset-panel">
          <img src="/assets/falcon-stream.png" alt="Falcon powered workflow stream" />
          <div>
            <span className="eyebrow">Backend power</span>
            <h3>Falcon stays behind the glass.</h3>
            <p>Clients get safe typed outcomes, not raw execution controls.</p>
          </div>
        </section>

        <section className="panel">
          <div className="section-head compact">
            <h3>Action stack</h3>
            <span>{pendingApprovals.length} pending</span>
          </div>
          {pendingApprovals.length ? (
            <div className="stack-list">
              {pendingApprovals.slice(0, 2).map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  approveAction={approveAction}
                  rejectAction={rejectAction}
                  compact
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={<ShieldCheck size={20} />} title="No pending approvals" detail="Run the demo or ask for a follow-up to create reviewable actions." />
          )}
        </section>

        <section className="panel">
          <div className="section-head compact">
            <h3>Live context</h3>
            <span>Read only</span>
          </div>
          <div className="context-list">
            <ContextRow icon={<Inbox size={17} />} title={emails[0].subject} detail={`${emails[0].from} - ${emails[0].age}`} />
            <ContextRow icon={<CalendarDays size={17} />} title={events[0].title} detail={`${events[0].time} - ${events[0].status}`} />
          </div>
        </section>
      </aside>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </article>
  );
}

function InboxView({ emails, createFollowUpPlan }: { emails: EmailItem[]; createFollowUpPlan: () => void }) {
  return (
    <Page title="Inbox intelligence" kicker="Gmail" action={<button className="primary-small" onClick={createFollowUpPlan}><Sparkles size={16} /> Prepare follow-up</button>}>
      <div className="list-grid">
        {emails.map((email) => (
          <article className="record-card" key={email.id}>
            <div className="record-top">
              <span className={`priority ${email.priority}`}>{email.priority}</span>
              <small>{email.age}</small>
            </div>
            <h3>{email.subject}</h3>
            <p>{email.preview}</p>
            <div className="record-footer">
              <span>{email.from}</span>
              <b>{email.status}</b>
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}

function CalendarView({ events }: { events: CalendarEvent[] }) {
  return (
    <Page title="Scheduling command" kicker="Calendar">
      <div className="timeline">
        {events.map((event) => (
          <article className="timeline-item" key={event.id}>
            <Clock3 size={18} />
            <div>
              <h3>{event.title}</h3>
              <p>{event.time}</p>
            </div>
            <span className={`status-badge ${event.status}`}>{event.status}</span>
          </article>
        ))}
      </div>
    </Page>
  );
}

function TasksView({ tasks, completeTask }: { tasks: TaskItem[]; completeTask: (id: string) => void }) {
  return (
    <Page title="Task operations" kicker="Execution queue" action={<button className="ghost-small"><Plus size={16} /> New task</button>}>
      <div className="task-list">
        {tasks.map((task) => (
          <article className={`task-row ${task.status}`} key={task.id}>
            <button type="button" onClick={() => completeTask(task.id)} title="Complete task">
              <Check size={17} />
            </button>
            <div>
              <h3>{task.title}</h3>
              <p>{task.owner} - due {task.due}</p>
            </div>
            <span>{task.status}</span>
          </article>
        ))}
      </div>
    </Page>
  );
}

function ApprovalsView({
  approvals,
  approveAction,
  rejectAction,
}: {
  approvals: Approval[];
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
}) {
  return (
    <Page title="Approval cockpit" kicker="Human oversight">
      {approvals.length ? (
        <div className="approval-grid">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              approveAction={approveAction}
              rejectAction={rejectAction}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={<ShieldCheck size={22} />} title="No approval cards yet" detail="Approval cards appear when PhantomForce proposes an external or sensitive action." />
      )}
    </Page>
  );
}

function ActivityView({ activity }: { activity: ActivityItem[] }) {
  return (
    <Page title="Activity and audit" kicker="Traceability">
      <div className="activity-feed">
        {activity.map((item) => (
          <article className={`activity-item ${item.level}`} key={item.id}>
            <span />
            <div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </div>
            <time>{item.time}</time>
          </article>
        ))}
      </div>
    </Page>
  );
}

function ConnectionsView() {
  return (
    <Page title="Connections and modules" kicker="Backend power">
      <div className="connection-grid">
        {connections.map((connection) => (
          <article className={`connection-card ${connection.status}`} key={connection.id}>
            <div className="record-top">
              <h3>{connection.name}</h3>
              <span className={`status-badge ${connection.status}`}>{connection.status}</span>
            </div>
            <p>{connection.description}</p>
            <div className="scope-list">
              {connection.scopes.map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <section className="module-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Module registry</span>
            <h3>One app, business-specific tools.</h3>
          </div>
        </div>
        <div className="module-list">
          {modules.map((module) => (
            <span key={module}>{module}</span>
          ))}
        </div>
      </section>
    </Page>
  );
}

function Page({ title, kicker, action, children }: { title: string; kicker: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ApprovalCard({
  approval,
  approveAction,
  rejectAction,
  compact = false,
}: {
  approval: Approval;
  approveAction: (id: string) => void;
  rejectAction: (id: string) => void;
  compact?: boolean;
}) {
  const Icon = approval.kind === "email" ? Mail : approval.kind === "calendar" ? CalendarDays : SquareCheckBig;
  return (
    <article className={`approval-card ${compact ? "compact" : ""} ${approval.status}`}>
      <div className="approval-title">
        <span>
          <Icon size={18} />
        </span>
        <div>
          <h3>{approval.title}</h3>
          <p>{approval.summary}</p>
        </div>
      </div>
      {!compact ? (
        <dl className="payload">
          {Object.entries(approval.payload).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="approval-meta">
        <span>{approval.reversible ? "Reversible" : "External final action"}</span>
        <b>{approval.status}</b>
      </div>
      {approval.status === "pending" ? (
        <div className="approval-actions">
          <button type="button" className="approve" onClick={() => approveAction(approval.id)}>
            <Check size={16} />
            Approve
          </button>
          <button type="button" className="reject" onClick={() => rejectAction(approval.id)}>
            <X size={16} />
            Reject
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ContextRow({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="context-row">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export default App;
