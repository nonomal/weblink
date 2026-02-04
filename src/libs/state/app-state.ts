import { createStore } from "solid-js/store";
import type { FileMetaData } from "@/libs/cache";
import type { FileTransferer } from "@/libs/core/file-transferer";
import type {
  ClientID,
  ClientInfo,
  FileID,
  RoomStatus,
} from "@/libs/core/type";
import type { PeerSession } from "@/libs/core/session";
import type { ClientProfile } from "@/libs/core/profile";
import type { StoreMessage } from "@/libs/core/message";
import type { Client } from "@/libs/core/type";
import type { ChunkCache } from "@/libs/cache/chunk-cache";
import type { AppOption } from "@/libs/state/app-options";
import { getDefaultAppOptions } from "@/libs/state/app-options";

export type ClientServiceStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export type CacheStatus = "ready" | "loading";

export type AppState = {
  roomStatus: RoomStatus;
  profile: ClientProfile;
  options: AppOption;
  session: {
    sessions: Record<ClientID, PeerSession>;
    clientViewData: Record<ClientID, ClientInfo>;
    clientServiceStatus: ClientServiceStatus;
  };
  cache: {
    status: CacheStatus;
    caches: Record<FileID, ChunkCache>;
    cacheInfo: Record<FileID, FileMetaData>;
  };
  transfer: {
    transferers: Record<FileID, FileTransferer>;
  };
  message: {
    status: "initializing" | "ready";
    messages: StoreMessage[];
    clients: Client[];
  };
};

export const createInitialAppState = (): AppState => ({
  roomStatus: {
    roomId: null,
    profile: null,
  },
  profile: {
    roomId: "",
    password: null,
    autoJoin: false,
    initalJoin: true,
    clientId: "",
    name: "",
    avatar: null,
  },
  options: getDefaultAppOptions(),
  session: {
    sessions: {},
    clientViewData: {},
    clientServiceStatus: "disconnected",
  },
  cache: {
    status: "loading",
    caches: {},
    cacheInfo: {},
  },
  transfer: {
    transferers: {},
  },
  message: {
    status: "initializing",
    messages: [],
    clients: [],
  },
});

export const [appState, setAppState] =
  createStore<AppState>(createInitialAppState());
