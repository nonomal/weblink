import { reconcile } from "solid-js/store";
import {
  createInitialAppState,
  setAppState,
} from "@/libs/state/app-state";
import { initializeProfile } from "@/libs/core/store";
import { initializeAppOptions } from "@/options";
import {
  createCacheManager,
  cacheManager,
} from "@/libs/services/cache-serivce";
import {
  createSessionService,
} from "@/libs/services/session-service";
import {
  createTransferManager,
} from "@/libs/services/transfer-service";
import {
  createMessageStores,
  messageStores,
} from "@/libs/core/message";

let initPromise: Promise<void> | null = null;

export function createInitialization() {
  if (initPromise) return initPromise;

  setAppState(reconcile(createInitialAppState()));

  initializeAppOptions();
  initializeProfile();

  createTransferManager();
  createSessionService();
  createMessageStores();
  createCacheManager();

  initPromise = cacheManager
    .initialize()
    .then(() => undefined);

  return initPromise;
}

export const services = {
  get cacheManager() {
    return createCacheManager();
  },
  get sessionService() {
    return createSessionService();
  },
  get transferManager() {
    return createTransferManager();
  },
  get messageStores() {
    return createMessageStores();
  },
};
