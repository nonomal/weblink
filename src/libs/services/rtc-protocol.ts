import type { PeerSession } from "@/libs/core/session";
import type {
  CheckMessage,
  ErrorMessage,
  MessageID,
  SessionMessage,
} from "@/libs/core/message";
import type { ClientID } from "@/libs/core/type";
import { createRtcService } from "@/libs/services/rtc-service";
import {
  RTC_PROTOCOL_DEDUP_CLEANUP_INTERVAL_MS,
  RTC_PROTOCOL_DEDUP_TTL_MS,
} from "@/constants";

export type RtcProtocolMessageContext<
  T extends SessionMessage = SessionMessage,
> = {
  session: PeerSession;
  message: T;
};

export type RtcProtocolMessageHandler<
  T extends SessionMessage["type"],
> = (
  ctx: RtcProtocolMessageContext<
    Extract<SessionMessage, { type: T }>
  >,
) => void | Promise<void>;

export type RtcProtocolRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
};

export type RtcProtocolRequestHandlerOptions = {
  ackMode: CheckMessage["mode"];
};

export type RtcProtocolTransport = {
  send: (session: PeerSession, message: SessionMessage) => void;
  onAny: (
    handler: (
      ctx: RtcProtocolMessageContext<SessionMessage>,
    ) => void | Promise<void>,
  ) => () => void;
};

type RequestHandlerEntry<T extends SessionMessage["type"]> =
  {
    ackMode: CheckMessage["mode"];
    handler: RtcProtocolMessageHandler<T>;
  };

type PendingRequest = {
  session: PeerSession;
  request: SessionMessage;
  resolve: (message: CheckMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  retryDelayMs: number;
};

type DedupStrategy = "id" | "createdAt";

type ProcessedEntry = {
  seenAt: number;
  strategy: DedupStrategy;
  createdAt?: number;
};

const dedupStrategyByType: Partial<
  Record<SessionMessage["type"], DedupStrategy>
> = {
  "check-message": "id",
  error: "id",
  storage: "id",
};

export class RtcProtocol {
  private readonly transport: RtcProtocolTransport;
  private readonly handlersByType = new Map<
    SessionMessage["type"],
    Set<(ctx: RtcProtocolMessageContext<any>) => unknown>
  >();
  private readonly requestHandlersByType = new Map<
    SessionMessage["type"],
    RequestHandlerEntry<any>[]
  >();
  private readonly pending = new Map<MessageID, PendingRequest>();
  private readonly processed = new Map<string, ProcessedEntry>();
  private readonly inFlight = new Map<string, number>();

  private lastCleanupAt = 0;

  constructor(transport: RtcProtocolTransport) {
    this.transport = transport;
    this.transport.onAny(({ session, message }) => {
      void this.handleIncoming(session, message);
    });
  }

  send(session: PeerSession, message: SessionMessage) {
    this.transport.send(session, message);
  }

  request(
    session: PeerSession,
    message: SessionMessage,
    options: RtcProtocolRequestOptions = {},
  ) {
    const timeoutMs = options.timeoutMs ?? 5000;
    const retries = options.retries ?? 0;
    const retryDelayMs = options.retryDelayMs ?? 250;

    if (this.pending.has(message.id)) {
      return Promise.reject(
        new Error(
          `[RtcProtocol] request already pending: ${message.id}`,
        ),
      );
    }

    return new Promise<CheckMessage>((resolve, reject) => {
      const pending: PendingRequest = {
        session,
        request: message,
        resolve,
        reject,
        timer: null,
        attempt: 0,
        maxAttempts: 1 + Math.max(0, retries),
        timeoutMs,
        retryDelayMs,
      };
      this.pending.set(message.id, pending);

      const controller = new AbortController();
      const signal = options.signal;

      const cleanup = () => {
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        this.pending.delete(message.id);
        controller.abort();
      };

      controller.signal.addEventListener(
        "abort",
        () => {
          // no-op, just ensures listeners are released
        },
        { once: true },
      );

      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(new Error(`[RtcProtocol] request aborted`));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            cleanup();
            reject(
              new Error(`[RtcProtocol] request aborted`),
            );
          },
          { once: true, signal: controller.signal },
        );
      }

      const onTimeout = () => {
        const current = this.pending.get(message.id);
        if (!current) return;

        current.attempt++;
        if (current.attempt >= current.maxAttempts) {
          cleanup();
          reject(
            new Error(`[RtcProtocol] request timeout`),
          );
          return;
        }

        setTimeout(() => {
          const next = this.pending.get(message.id);
          if (!next) return;
          this.safeSend(next.session, next.request);
          next.timer = setTimeout(
            onTimeout,
            next.timeoutMs,
          );
        }, current.retryDelayMs);
      };

      this.safeSend(session, message);
      pending.timer = setTimeout(onTimeout, timeoutMs);

      const originalResolve = resolve;
      const originalReject = reject;
      pending.resolve = (msg) => {
        cleanup();
        originalResolve(msg);
      };
      pending.reject = (err) => {
        cleanup();
        originalReject(err);
      };
    });
  }

  on<T extends SessionMessage["type"]>(
    type: T,
    handler: RtcProtocolMessageHandler<T>,
  ) {
    let handlers = this.handlersByType.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlersByType.set(type, handlers);
    }

    const wrapped = handler as unknown as (
      ctx: RtcProtocolMessageContext<any>,
    ) => unknown;
    handlers.add(wrapped);

    return () => {
      handlers?.delete(wrapped);
      if (handlers && handlers.size === 0) {
        this.handlersByType.delete(type);
      }
    };
  }

  onRequest<T extends SessionMessage["type"]>(
    type: T,
    handler: RtcProtocolMessageHandler<T>,
    options: RtcProtocolRequestHandlerOptions,
  ) {
    const entries =
      this.requestHandlersByType.get(type) ?? [];
    entries.push({
      ackMode: options.ackMode,
      handler: handler as any,
    });
    this.requestHandlersByType.set(type, entries);

    return () => {
      const next = this.requestHandlersByType.get(type);
      if (!next) return;
      const index = next.findIndex(
        (e) => e.handler === handler,
      );
      if (index !== -1) next.splice(index, 1);
      if (next.length === 0) {
        this.requestHandlersByType.delete(type);
      } else {
        this.requestHandlersByType.set(type, next);
      }
    };
  }

  private safeSend(session: PeerSession, message: SessionMessage) {
    try {
      this.transport.send(session, message);
    } catch (err) {
      console.error(err);
    }
  }

  private makeDedupKey(message: SessionMessage) {
    return `${message.type}:${message.id}`;
  }

  private isDuplicate(message: SessionMessage) {
    const key = this.makeDedupKey(message);
    const entry = this.processed.get(key);
    if (!entry) return false;

    entry.seenAt = Date.now();
    if (entry.strategy === "id") return true;
    return entry.createdAt === message.createdAt;
  }

  private markProcessed(message: SessionMessage) {
    const strategy =
      dedupStrategyByType[message.type] ?? "createdAt";
    const entry: ProcessedEntry = {
      seenAt: Date.now(),
      strategy,
      createdAt:
        strategy === "createdAt"
          ? message.createdAt
          : undefined,
    };
    this.processed.set(this.makeDedupKey(message), entry);
  }

  private cleanupProcessed() {
    const now = Date.now();
    if (
      now - this.lastCleanupAt <
      RTC_PROTOCOL_DEDUP_CLEANUP_INTERVAL_MS
    ) {
      return;
    }
    this.lastCleanupAt = now;

    for (const [key, entry] of this.processed) {
      if (now - entry.seenAt > RTC_PROTOCOL_DEDUP_TTL_MS) {
        this.processed.delete(key);
      }
    }
  }

  private async handleIncoming(
    session: PeerSession,
    message: SessionMessage,
  ) {
    this.cleanupProcessed();

    if (message.type === "check-message") {
      const shouldDispatch =
        this.handleCheckMessage(message);
      if (!shouldDispatch) return;
      await this.dispatchHandlers(session, message);
      return;
    }

    if (message.type === "error") {
      const shouldDispatch =
        this.handleErrorMessage(message);
      if (!shouldDispatch) return;
      await this.dispatchHandlers(session, message);
      return;
    }

    if (
      (dedupStrategyByType[message.type] ?? "createdAt") ===
        "id" &&
      this.isDuplicate(message)
    ) {
      return;
    }

    const requestEntries = this.requestHandlersByType.get(
      message.type,
    );
    if (requestEntries && requestEntries.length > 0) {
      await this.handleRequest(
        session,
        message,
        requestEntries,
      );
      await this.dispatchHandlers(session, message);
      return;
    }

    await this.dispatchHandlers(session, message);
  }

  private handleCheckMessage(message: CheckMessage) {
    const pending = this.pending.get(message.id);
    const duplicate = this.isDuplicate(message);
    if (duplicate && !pending) return false;
    if (!duplicate) this.markProcessed(message);
    if (pending) pending.resolve(message);
    return true;
  }

  private handleErrorMessage(message: ErrorMessage) {
    const pending = this.pending.get(message.id);
    const duplicate = this.isDuplicate(message);
    if (duplicate && !pending) return false;
    if (!duplicate) this.markProcessed(message);
    if (pending) pending.reject(new Error(message.error));
    return true;
  }

  private async handleRequest(
    session: PeerSession,
    message: SessionMessage,
    entries: RequestHandlerEntry<any>[],
  ) {
    const duplicate = this.isDuplicate(message);
    const ackMode = entries[0]?.ackMode ?? "receive";

    if (duplicate) {
      this.safeSend(
        session,
        this.createCheckMessage(message, ackMode),
      );
      return;
    }

    const key = this.makeDedupKey(message);
    if (this.inFlight.get(key) === message.createdAt) {
      return;
    }
    this.inFlight.set(key, message.createdAt);

    try {
      for (const entry of entries) {
        await entry.handler({ session, message });
      }

      this.markProcessed(message);

      this.safeSend(
        session,
        this.createCheckMessage(message, ackMode),
      );
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        this.safeSend(
          session,
          this.createErrorMessage(message, err.message),
        );
      } else {
        this.safeSend(
          session,
          this.createErrorMessage(message, String(err)),
        );
      }
    } finally {
      if (this.inFlight.get(key) === message.createdAt) {
        this.inFlight.delete(key);
      }
    }
  }

  private async dispatchHandlers(
    session: PeerSession,
    message: SessionMessage,
  ) {
    const handlers = this.handlersByType.get(message.type);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        await handler({ session, message });
      } catch (err) {
        console.error(err);
        if (
          message.type !== "error" &&
          err instanceof Error
        ) {
          this.safeSend(
            session,
            this.createErrorMessage(message, err.message),
          );
        }
        return;
      }
    }
  }

  private createCheckMessage(
    message: SessionMessage,
    mode: CheckMessage["mode"],
  ): CheckMessage {
    return {
      type: "check-message",
      id: message.id,
      createdAt: Date.now(),
      client: message.target,
      target: message.client,
      mode,
    };
  }

  private createErrorMessage(
    message: SessionMessage,
    error: string,
  ): ErrorMessage {
    return {
      type: "error",
      id: message.id,
      client: message.target,
      target: message.client,
      createdAt: Date.now(),
      error,
    };
  }
}

export let rtcProtocol: RtcProtocol;

export function createRtcProtocol() {
  if (!rtcProtocol) {
    rtcProtocol = new RtcProtocol(createRtcService());
  }
  return rtcProtocol;
}

export function getRtcProtocolTarget(
  ctx: RtcProtocolMessageContext,
): ClientID {
  return ctx.session.targetClientId;
}
