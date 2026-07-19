export const PHANTOMFORCE_DESKTOP_POLICY = {
  id: "phantomforce-desktop-native-live",
  version: "3.0-native-live",
  appName: "PhantomForce",
  defaultLiveUrl: "https://admin.phantomforce.online/app/",
  allowedOrigins: [
    "https://admin.phantomforce.online",
    "https://app.phantomforce.online",
    "https://phantomforce.online",
    "http://127.0.0.1:4321",
    "http://localhost:4321"
  ],
  gameRuntime: {
    allowedTypes: ["html5", "javascript", "webassembly", "webgl", "godot-web", "phantomplay-native-module"],
    blockedTypes: ["windows-exe", "macos-app", "linux-elf", "native-installer", "browser-extension"],
    maxWebBundleBytes: 52_428_800,
    maxNativeApprovedBundleBytes: 524_288_000,
    saveStateBytes: 1_048_576,
    localCache: true,
    signedManifestUpdates: true,
    serverEditableCatalog: true,
    requiresRedownloadForContentChanges: false
  },
  nativeCapabilities: {
    packagedShell: true,
    fullscreen: true,
    controllerInput: true,
    keyboardCapture: true,
    backgroundJobNotifications: true,
    offlineBuiltIns: true,
    localGameCache: true
  },
  security: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    externalNetworkingDefault: "blocked",
    localFileAccessDefault: "blocked",
    nativeModuleApprovalRequired: true,
    unsignedGameBundles: "reject"
  }
};

export function liveUrlFromEnv(env = process.env) {
  const raw = String(env.PHANTOMFORCE_DESKTOP_URL || PHANTOMFORCE_DESKTOP_POLICY.defaultLiveUrl).trim();
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return PHANTOMFORCE_DESKTOP_POLICY.defaultLiveUrl;
    return url.href;
  } catch {
    return PHANTOMFORCE_DESKTOP_POLICY.defaultLiveUrl;
  }
}

export function originAllowed(url, policy = PHANTOMFORCE_DESKTOP_POLICY) {
  try {
    return policy.allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
