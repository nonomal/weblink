import type { PeerSession } from "@/libs/core/session";
import type { SessionMessage } from "@/libs/core/message";
import type { ClientID } from "@/libs/core/type";

export type RtcMessageContext<T extends SessionMessage> = {
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

export let rtcService: RtcService;

export function createRtcService() {
  if (!rtcService) {
    rtcService = new RtcService();
  }

  return rtcService;
}
