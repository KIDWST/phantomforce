/* session-restore.js — reconnects to still-running terminal sessions on
   boot instead of always starting clean, so a reload or app restart never
   orphans a live PTY. Shared by app.js (Basic mode) and superuser.js
   (Superuser mode); loaded after app.js so it can use its globals. */

async function restoreSessions() {
  let data;
  try {
    const res = await api("/api/profiles");
    data = await res.json();
  } catch {
    return [];
  }
  if (!data.ok || !Array.isArray(data.sessions)) return [];

  const saved = loadWorkspace();
  const restored = [];

  for (const s of data.sessions) {
    // Only reconnect sessions with a live process. "exited"/"error"
    // sessions linger in the server's map until explicitly stopped, but
    // there's nothing running to reattach to.
    if (s.status !== "running") continue;

    const savedCard = saved?.cards?.find((c) => c.sessionId === s.id);
    const card = addCard(
      {
        profileId: s.profileId,
        name: savedCard?.name ?? "",
        color: savedCard?.color ?? undefined,
        // Model the live session was actually launched with (server-side
        // truth), falling back to the saved per-tab override.
        model: s.model ?? savedCard?.model ?? null,
      },
      { save: false },
    );
    card.startedAt = new Date(s.startedAt).getTime();
    renderRuntime(card);
    openTerminal(card, s.id);
    restored.push(card);
  }
  return restored;
}
