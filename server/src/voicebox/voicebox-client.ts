const DEFAULT_VOICEBOX_URLS = ["http://127.0.0.1:17600", "http://127.0.0.1:17493"];
const VOICEBOX_CLIENT_ID = "phantomforce-content-hub";

export type VoiceboxStatus = {
  configured: boolean;
  reachable: boolean;
  baseUrl: string;
  profiles: number;
  reason: string;
};

export type VoiceboxProfile = {
  id: string;
  name: string;
  description?: string | null;
  language?: string;
  voice_type?: string;
  default_engine?: string;
  preset_engine?: string;
  preset_voice_id?: string;
};

export type PhantomVoiceGenerationRequest = {
  text: string;
  profile?: string;
  profileId?: string;
  language?: string;
  engine?: string;
  instruct?: string;
  personality?: boolean;
};

export type PhantomVoiceGeneration = {
  id: string;
  status: string;
  text: string;
  profileId: string | null;
  profile: string | null;
  engine: string | null;
  audioUrl: string;
  statusUrl: string;
  voiceboxBaseUrl: string;
};

function configuredVoiceboxUrls() {
  const explicit = process.env.PHANTOMFORCE_VOICEBOX_URL || process.env.VOICEBOX_BASE_URL;
  if (explicit?.trim()) return [explicit.trim().replace(/\/$/, "")];
  return DEFAULT_VOICEBOX_URLS;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const errorData = data as { detail?: string; error?: string };
    const message = errorData.detail ?? errorData.error ?? `Voicebox request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

async function firstReachableBaseUrl() {
  const failures: string[] = [];

  for (const baseUrl of configuredVoiceboxUrls()) {
    try {
      await fetchJson<VoiceboxProfile[]>(`${baseUrl}/profiles`);
      return baseUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unreachable";
      failures.push(`${baseUrl}: ${message}`);
    }
  }

  throw new Error(failures.join("; ") || "Voicebox is not reachable.");
}

async function ensureDefaultVoiceboxProfile(baseUrl: string) {
  const profiles = await fetchJson<VoiceboxProfile[]>(`${baseUrl}/profiles`);
  if (profiles.length) return profiles;

  const profile = await fetchJson<VoiceboxProfile>(`${baseUrl}/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Voicebox-Client-Id": VOICEBOX_CLIENT_ID,
    },
    body: JSON.stringify({
      name: "PhantomForce Default",
      description: "Default preset voice for PhantomForce Content Hub voice generation",
      language: "en",
      voice_type: "preset",
      preset_engine: "kokoro",
      preset_voice_id: "af_nova",
      default_engine: "kokoro",
    }),
  });

  return [profile];
}

export async function getVoiceboxStatus(): Promise<VoiceboxStatus> {
  const baseUrls = configuredVoiceboxUrls();

  for (const baseUrl of baseUrls) {
    try {
      const profiles = await fetchJson<VoiceboxProfile[]>(`${baseUrl}/profiles`);
      return {
        configured: true,
        reachable: true,
        baseUrl,
        profiles: profiles.length,
        reason: "Voicebox API is reachable.",
      };
    } catch {
      // Try the next known base URL.
    }
  }

  return {
    configured: true,
    reachable: false,
    baseUrl: baseUrls[0] ?? DEFAULT_VOICEBOX_URLS[0],
    profiles: 0,
    reason: "Voicebox is installed under integrations/voicebox but its API is not running yet.",
  };
}

export async function listVoiceboxProfiles() {
  const baseUrl = await firstReachableBaseUrl();
  const profiles = await ensureDefaultVoiceboxProfile(baseUrl);
  return {
    baseUrl,
    profiles,
  };
}

export async function createVoiceboxSpeechJob(
  request: PhantomVoiceGenerationRequest,
): Promise<PhantomVoiceGeneration> {
  const baseUrl = await firstReachableBaseUrl();
  const text = request.text.trim();

  if (!text) {
    throw new Error("Voice generation needs text.");
  }

  const profiles = await fetchJson<VoiceboxProfile[]>(`${baseUrl}/profiles`);
  const requestedProfile = request.profileId
    ? profiles.find((profile) => profile.id === request.profileId)
    : request.profile
      ? profiles.find((profile) => profile.name.toLowerCase() === request.profile?.toLowerCase())
      : profiles[0];

  if (!requestedProfile) {
    throw new Error(
      profiles.length
        ? "Requested Voicebox profile was not found."
        : "Voicebox has no voice profiles yet. Create or import a profile in Voicebox first.",
    );
  }

  const generation = await fetchJson<{
    id: string;
    status: string;
    text: string;
    profile_id?: string;
    engine?: string;
  }>(`${baseUrl}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Voicebox-Client-Id": VOICEBOX_CLIENT_ID,
    },
    body: JSON.stringify({
      profile_id: requestedProfile.id,
      text,
      language: request.language ?? requestedProfile.language ?? "en",
      engine: request.engine ?? requestedProfile.default_engine ?? requestedProfile.preset_engine ?? "kokoro",
      instruct: request.instruct,
      personality: request.personality ?? false,
    }),
  });

  return {
    id: generation.id,
    status: generation.status,
    text: generation.text,
    profileId: generation.profile_id ?? requestedProfile.id,
    profile: requestedProfile.name,
    engine: generation.engine ?? request.engine ?? requestedProfile.default_engine ?? requestedProfile.preset_engine ?? null,
    audioUrl: `${baseUrl}/audio/${generation.id}`,
    statusUrl: `${baseUrl}/generate/${generation.id}/status`,
    voiceboxBaseUrl: baseUrl,
  };
}
