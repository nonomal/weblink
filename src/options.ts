import { makePersisted } from "@solid-primitives/storage";
import { createStore } from "solid-js/store";
import { ClientID, FileID } from "./libs/core/type";
import { createEffect, createSignal } from "solid-js";
import { cacheManager } from "./libs/services/cache-serivce";
import languages from "@/assets/i18n/languages.json";
export type Locale = string;

export type TurnServerOptions = {
  url: string;
  username: string;
  password: string;
  authMethod: string;
};

type ConnectionOptions = {
  stuns: string[];
  turns: TurnServerOptions[];
};

export type CompressionLevel =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9;

// App options
export type AppOption = {
  // Receiver
  maxMomeryCacheSlices: number;
  automaticDownload: boolean;

  // Sender
  enableClipboard: boolean;
  automaticCacheDeletion: boolean;
  channelsNumber: number;
  chunkSize: number;
  ordered: boolean;
  bufferedAmountLowThreshold: number;
  compressionLevel: CompressionLevel;
  blockSize: number;
  maxFileSize: number;

  // Connection
  servers: ConnectionOptions;
  shareServersWithOthers: boolean;
  websocketUrl?: string;
  relayOnly: boolean;

  // Appearance
  wakeLock: boolean;
  locale: Locale;
  backgroundImage?: FileID;
  backgroundImageOpacity: number;
  redirectToClient?: ClientID;

  // Stream
  videoMaxBitrate: number;
  degradationPreference: RTCDegradationPreference;
  preferredVideoCodec: string | null;
  preferredAudioCodec: string | null;
};

export function parseTurnServers(
  input: string,
): TurnServerOptions[] {
  if (input.trim() === "") return [];

  return input
    .split("\n")
    .map((line, index) => {
      if (line.trim() === "") return null;
      const parts = line.split("|");
      if (parts.length !== 4)
        throw Error(
          `config error, line ${index + 1} should be 4 parts`,
        );
      const [url, username, password, authMethod] =
        parts.map((part) => part.trim());
      const validAuthMethods = [
        "longterm",
        "hmac",
        "cloudflare",
      ];
      if (!validAuthMethods.includes(authMethod)) {
        throw Error(
          `auth method error, line ${index + 1} given ${authMethod} expected ${validAuthMethods.join(
            " or ",
          )}`,
        );
      }
      return {
        url,
        username,
        password,
        authMethod,
      } satisfies TurnServerOptions;
    })
    .filter((turn) => turn !== null);
}

export function stringifyTurnServers(
  turnServers: TurnServerOptions[],
): string {
  return turnServers
    .map((turn) => {
      return `${turn.url}|${turn.username}|${turn.password}|${turn.authMethod}`;
    })
    .join("\n");
}

export const defaultWebsocketUrl =
  import.meta.env.VITE_WEBSOCKET_URL ??
  window.env.VITE_WEBSOCKET_URL;

export const localeOptionsMap = languages as Record<
  Locale,
  string
>;

export function localFromLanguage(
  language: string,
): Locale {
  return (
    Object.keys(localeOptionsMap).find((locale) =>
      locale.toLowerCase().includes(language.toLowerCase()),
    ) ?? "en-us"
  );
}

export const getDefaultAppOptions = () => {
  return {
    channelsNumber: 1,
    chunkSize: 512 * 1024,
    blockSize: 32 * 1024,
    ordered: false,
    enableClipboard: navigator.clipboard !== undefined,
    automaticCacheDeletion: false,
    bufferedAmountLowThreshold: 32 * 1024,
    maxMomeryCacheSlices: 12,
    videoMaxBitrate: 25 * 1024 * 1024,
    servers: {
      stuns:
        import.meta.env.VITE_STUN_SERVERS?.split(",") ?? [],
      turns: parseTurnServers(
        import.meta.env.VITE_TURN_SERVERS ?? "",
      ),
    },
    relayOnly: false,
    wakeLock: true,
    compressionLevel: 6,
    locale: localFromLanguage(navigator.language),
    shareServersWithOthers: true,
    backgroundImageOpacity: 0.5,
    automaticDownload: false,
    websocketUrl: defaultWebsocketUrl,
    // todo: add dialog to prompt user the file size
    maxFileSize: 1024 * 1024 * 1024, // 1GB
    degradationPreference: "balanced",
    preferredVideoCodec: null,
    preferredAudioCodec: null,
  } satisfies AppOption;
};

export const [appInitialized, setAppInitialized] =
  makePersisted(createSignal(false), {
    name: "app_initialized",
    storage: localStorage,
  });

export const [starterMessageSent, setStarterMessageSent] =
  makePersisted(createSignal(false), {
    name: "starter_message_sent",
    storage: localStorage,
  });

export const [appOptions, setAppOptions] = makePersisted(
  createStore<AppOption>(getDefaultAppOptions()),
  {
    name: "app_options",
    storage: localStorage,
  },
);

export const [backgroundImage, setBackgroundImage] =
  createSignal<string | undefined>(undefined);

createEffect(async () => {
  if (!appOptions.backgroundImage) {
    setBackgroundImage(undefined);
    return;
  }
  if (cacheManager.status() === "loading") {
    return;
  }
  const backgroundImage =
    cacheManager.caches[appOptions.backgroundImage];
  if (!backgroundImage) return;
  const file = await backgroundImage.getFile();
  if (!file) return;
  const url = URL.createObjectURL(file);
  setBackgroundImage(url);
});

createEffect(() => {
  if (
    import.meta.env.VITE_STUN_SERVERS &&
    appOptions.servers.stuns.length === 0
  ) {
    const servers = import.meta.env.VITE_STUN_SERVERS.split(
      ",",
    );
    setAppOptions("servers", "stuns", servers);
  }
});

createEffect(() => {
  if (
    import.meta.env.VITE_TURN_SERVERS &&
    appOptions.servers.turns.length === 0
  ) {
    const serverValue =
      import.meta.env.VITE_TURN_SERVERS.split(",").join(
        "\n",
      );
    const servers = parseTurnServers(serverValue);
    setAppOptions("servers", "turns", servers);
  }
});

createEffect(() => {
  document
    .querySelector("html")
    ?.setAttribute("lang", appOptions.locale);
});
