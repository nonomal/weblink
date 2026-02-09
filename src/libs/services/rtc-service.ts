import type { PeerSession } from "@/libs/core/session";
import type { ClientID } from "@/libs/core/type";
import type {
  AckMessage,
  ErrorMessage,
  MessageID,
  SessionMessage,
} from "@/libs/services/rtc-protocol";
import {
  RTC_PROTOCOL_DEDUP_CLEANUP_INTERVAL_MS,
  RTC_PROTOCOL_DEDUP_TTL_MS,
} from "@/constants";

export type RtcMessageContext<
  T extends SessionMessage = SessionMessage,
> = {
  session: PeerSession;
  message: T;
};

export type RtcMessageHandler<
  T extends SessionMessage["type"],
> = (
  ctx: RtcMessageContext<Extract<SessionMessage, { type: T }>>,
) => void | Promise<void>;

export type RtcAnyMessageHandler = (
  ctx: RtcMessageContext<SessionMessage>,
) => void | Promise<void>;

export type RtcChannelHandler = (ctx: {
  session: PeerSession;
  channel: RTCDataChannel;
}) => void | Promise<void>;

export type RtcServiceRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
};

export type RtcServiceRequestHandlerOptions = {
  ackMode: AckMessage["mode"];
};

export type RtcServiceRequestErrorCode =
  | "already-pending"
  | "timeout"
  | "aborted"
  | "remote-error"
  | "send-failed"
  | "unknown";

export type RtcServiceRequestError = {
  code: RtcServiceRequestErrorCode;
  message: string;
};

export type RtcServiceRequestResult =
  | {
      ok: true;
      ackMessage: AckMessage;
    }
  | {
      ok: false;
      error: RtcServiceRequestError;
    };

export type RtcServiceTransport = {
  send: (session: PeerSession, message: SessionMessage) => void;
  onAny: (handler: RtcAnyMessageHandler) => () => void;
};

export class RtcService {
  private readonly sessionControllers = new Map<
    ClientID,
    AbortController
  >();
  private readonly messageHandlersByType = new Map<
    SessionMessage["type"],
    Set<(ctx: RtcMessageContext<any>) => unknown>
  >();
  private readonly anyMessageHandlers =
    new Set<RtcAnyMessageHandler>();
  private readonly channelHandlers =
    new Set<RtcChannelHandler>();

  bindSession(session: PeerSession) {
    const sessionKey = session.targetClientId;
    if (this.sessionControllers.has(sessionKey)) {
      return;
    }

    const controller = new AbortController();
    this.sessionControllers.set(sessionKey, controller);
    controller.signal.addEventListener(
      "abort",
      () => {
        this.sessionControllers.delete(sessionKey);
      },
      { once: true },
    );

    session.addEventListener(
      "message",
      (ev) => {
        this.dispatchMessage(session, ev.detail);
      },
      { signal: controller.signal },
    );

    session.addEventListener(
      "channel",
      (ev) => {
        this.dispatchChannel(session, ev.detail);
      },
      { signal: controller.signal },
    );

    session.addEventListener(
      "statuschange",
      (ev) => {
        if (ev.detail !== "closed") return;
        controller.abort();
      },
      { signal: controller.signal },
    );
  }

  unbindSession(clientId: ClientID) {
    this.sessionControllers.get(clientId)?.abort();
  }

  unbindAllSessions() {
    for (const controller of this.sessionControllers.values()) {
      controller.abort();
    }
    this.sessionControllers.clear();
  }

  send(session: PeerSession, message: SessionMessage) {
    session.sendMessage(message);
  }

  on<T extends SessionMessage["type"]>(
    type: T,
    handler: RtcMessageHandler<T>,
  ) {
    let handlers = this.messageHandlersByType.get(type);
    if (!handlers) {
      handlers = new Set();
      this.messageHandlersByType.set(type, handlers);
    }

    const wrapped = handler as unknown as (
      ctx: RtcMessageContext<any>,
    ) => unknown;
    handlers.add(wrapped);

    return () => {
      handlers?.delete(wrapped);
      if (handlers && handlers.size === 0) {
        this.messageHandlersByType.delete(type);
      }
    };
  }

  onAny(handler: RtcAnyMessageHandler) {
    this.anyMessageHandlers.add(handler);
    return () => {
      this.anyMessageHandlers.delete(handler);
    };
  }

  onChannel(handler: RtcChannelHandler) {
    this.channelHandlers.add(handler);
    return () => {
      this.channelHandlers.delete(handler);
    };
  }

  private dispatchMessage(
    session: PeerSession,
    message: SessionMessage,
  ) {
    const handlers = this.messageHandlersByType.get(
      message.type,
    );
    if (handlers) {
      for (const handler of handlers) {
        this.runHandler(() =>
          handler({ session, message }),
        );
      }
    }

    for (const handler of this.anyMessageHandlers) {
      this.runHandler(() => handler({ session, message }));
    }
  }

  private dispatchChannel(
    session: PeerSession,
    channel: RTCDataChannel,
  ) {
    for (const handler of this.channelHandlers) {
      this.runHandler(() => handler({ session, channel }));
    }
  }

  private runHandler(fn: () => unknown) {
    try {
      const result = fn();
      if (
        result &&
        typeof (result as Promise<unknown>).catch ===
          "function"
      ) {
        (result as Promise<unknown>).catch((err) => {
          console.error(err);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }
}

type RequestHandlerEntry<T extends SessionMessage["type"]> =
  {
    ackMode: AckMessage["mode"];
    handler: RtcMessageHandler<T>;
  };

type PendingRequest = {
  session: PeerSession;
  request: SessionMessage;
  resolve: (message: AckMessage) => void;
  reject: (error: RtcServiceRequestFailure) => void;
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

class RtcServiceRequestFailure extends Error {
  readonly code: RtcServiceRequestErrorCode;

  constructor(
    code: RtcServiceRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "RtcServiceRequestFailure";
  }
}

/**
 * Message lifecycle state machine for RTC transport:
 * request timeout/retry, dedup, duplicate re-ack and
 * protocol-level error reply.
 */
export class RtcMessageStateMachine {
  private static readonly dedupStrategyByType: Partial<
    Record<SessionMessage["type"], DedupStrategy>
  > = {
    ack: "id",
    error: "id",
    storage: "id",
  };

  private readonly transport: RtcServiceTransport;
  private readonly handlersByType = new Map<
    SessionMessage["type"],
    Set<(ctx: RtcMessageContext<any>) => unknown>
  >();
  private readonly requestHandlersByType = new Map<
    SessionMessage["type"],
    RequestHandlerEntry<any>[]
  >();
  private readonly pending = new Map<MessageID, PendingRequest>();
  private readonly processed = new Map<string, ProcessedEntry>();
  private readonly inFlight = new Map<string, number>();
  private lastCleanupAt = 0;

  constructor(transport: RtcServiceTransport) {
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
    options: RtcServiceRequestOptions = {},
  ) {
    const timeoutMs = options.timeoutMs ?? 5000;
    const retries = options.retries ?? 0;
    const retryDelayMs = options.retryDelayMs ?? 250;

    if (this.pending.has(message.id)) {
      return Promise.reject(
        new RtcServiceRequestFailure(
          "already-pending",
          `[RtcService] request already pending: ${message.id}`,
        ),
      );
    }

    return new Promise<AckMessage>((resolve, reject) => {
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

      const rejectWith = (
        code: RtcServiceRequestErrorCode,
        errMessage: string,
      ) => {
        cleanup();
        reject(new RtcServiceRequestFailure(code, errMessage));
      };

      if (signal) {
        if (signal.aborted) {
          rejectWith("aborted", `[RtcService] request aborted`);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            rejectWith(
              "aborted",
              `[RtcService] request aborted`,
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
          rejectWith("timeout", `[RtcService] request timeout`);
          return;
        }

        setTimeout(() => {
          const next = this.pending.get(message.id);
          if (!next) return;
          const sendOk = this.safeSend(
            next.session,
            next.request,
          );
          if (!sendOk) {
            rejectWith(
              "send-failed",
              `[RtcService] request send failed`,
            );
            return;
          }
          next.timer = setTimeout(
            onTimeout,
            next.timeoutMs,
          );
        }, current.retryDelayMs);
      };

      const sendOk = this.safeSend(session, message);
      if (!sendOk) {
        rejectWith(
          "send-failed",
          `[RtcService] request send failed`,
        );
        return;
      }

      pending.timer = setTimeout(onTimeout, timeoutMs);

      const originalResolve = resolve;
      const originalReject = reject;
      pending.resolve = (ackMessage) => {
        cleanup();
        originalResolve(ackMessage);
      };
      pending.reject = (error) => {
        cleanup();
        originalReject(error);
      };
    });
  }

  async requestWithResult(
    session: PeerSession,
    message: SessionMessage,
    options: RtcServiceRequestOptions = {},
  ): Promise<RtcServiceRequestResult> {
    try {
      const ackMessage = await this.request(
        session,
        message,
        options,
      );
      return {
        ok: true,
        ackMessage,
      };
    } catch (err) {
      return {
        ok: false,
        error: this.normalizeRequestError(err),
      };
    }
  }

  on<T extends SessionMessage["type"]>(
    type: T,
    handler: RtcMessageHandler<T>,
  ) {
    let handlers = this.handlersByType.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlersByType.set(type, handlers);
    }

    const wrapped = handler as unknown as (
      ctx: RtcMessageContext<any>,
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
    handler: RtcMessageHandler<T>,
    options: RtcServiceRequestHandlerOptions,
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
        (entry) => entry.handler === handler,
      );
      if (index !== -1) next.splice(index, 1);
      if (next.length === 0) {
        this.requestHandlersByType.delete(type);
      } else {
        this.requestHandlersByType.set(type, next);
      }
    };
  }

  private normalizeRequestError(
    err: unknown,
  ): RtcServiceRequestError {
    if (err instanceof RtcServiceRequestFailure) {
      return {
        code: err.code,
        message: err.message,
      };
    }

    if (err instanceof Error) {
      return {
        code: "unknown",
        message: err.message,
      };
    }

    return {
      code: "unknown",
      message: String(err),
    };
  }

  private safeSend(
    session: PeerSession,
    message: SessionMessage,
  ) {
    try {
      this.transport.send(session, message);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  private makeDedupKey(message: SessionMessage) {
    return `${message.type}:${message.id}`;
  }

  private getDedupStrategy(message: SessionMessage) {
    return (
      RtcMessageStateMachine.dedupStrategyByType[message.type] ??
      "createdAt"
    );
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
    const strategy = this.getDedupStrategy(message);
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

    if (message.type === "ack") {
      const shouldDispatch = this.handleAckMessage(message);
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
      this.getDedupStrategy(message) === "id" &&
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

  private handleAckMessage(message: AckMessage) {
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
    if (pending) {
      pending.reject(
        new RtcServiceRequestFailure(
          "remote-error",
          message.error,
        ),
      );
    }
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
        this.createAckMessage(message, ackMode),
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
        this.createAckMessage(message, ackMode),
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

  private createAckMessage(
    message: SessionMessage,
    mode: AckMessage["mode"],
  ): AckMessage {
    return {
      type: "ack",
      id: message.id,
      mode,
      createdAt: Date.now(),
      client: message.target,
      target: message.client,
    };
  }

  private createErrorMessage(
    message: SessionMessage,
    error: string,
  ): ErrorMessage {
    return {
      type: "error",
      id: message.id,
      error,
      createdAt: Date.now(),
      client: message.target,
      target: message.client,
    };
  }
}

export let rtcService: RtcService;

export function createRtcService() {
  if (!rtcService) {
    rtcService = new RtcService();
  }

  return rtcService;
}
