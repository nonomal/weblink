import { describe, expect, it, vi } from "vitest";
import {
  RtcProtocol,
  type RtcProtocolTransport,
} from "@/libs/services/rtc-protocol";
import type { PeerSession } from "@/libs/core/session";
import type {
  CheckMessage,
  SendTextMessage,
  SessionMessage,
} from "@/libs/core/message";
import type { ClientID } from "@/libs/core/type";

class FakeTransport implements RtcProtocolTransport {
  readonly sendCalls: Array<{
    session: PeerSession;
    message: SessionMessage;
  }> = [];

  private readonly anyHandlers = new Set<
    (ctx: { session: PeerSession; message: SessionMessage }) => unknown
  >();

  send(session: PeerSession, message: SessionMessage) {
    this.sendCalls.push({ session, message });
  }

  onAny(
    handler: (ctx: {
      session: PeerSession;
      message: SessionMessage;
    }) => unknown,
  ) {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  emit(session: PeerSession, message: SessionMessage) {
    for (const handler of this.anyHandlers) {
      handler({ session, message });
    }
  }
}

const makeSession = (local: ClientID, target: ClientID) =>
  ({
    clientId: local,
    targetClientId: target,
  }) as unknown as PeerSession;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("RtcProtocol", () => {
  it("auto-acks onRequest handlers", async () => {
    const transport = new FakeTransport();
    const protocol = new RtcProtocol(transport);

    const session = makeSession("a", "b");

    const handler = vi.fn();
    protocol.onRequest(
      "send-text",
      async ({ message }) => {
        handler(message.data);
      },
      { ackMode: "receive" },
    );

    const incoming = {
      id: "m1",
      type: "send-text",
      createdAt: 1,
      client: "b",
      target: "a",
      data: "hello",
    } satisfies SendTextMessage;

    transport.emit(session, incoming);

    expect(handler).toHaveBeenCalledWith("hello");
    await flush();
    expect(transport.sendCalls).toHaveLength(1);

    const ack = transport.sendCalls[0]!.message as CheckMessage;
    expect(ack.type).toBe("check-message");
    expect(ack.id).toBe("m1");
    expect(ack.mode).toBe("receive");
    expect(ack.client).toBe("a");
    expect(ack.target).toBe("b");
    expect(typeof ack.createdAt).toBe("number");
  });

  it("dedups duplicate requests but re-acks", async () => {
    const transport = new FakeTransport();
    const protocol = new RtcProtocol(transport);

    const session = makeSession("a", "b");

    const handler = vi.fn();
    protocol.onRequest(
      "send-text",
      ({ message }) => {
        handler(message.data);
      },
      { ackMode: "receive" },
    );

    const incoming = {
      id: "m1",
      type: "send-text",
      createdAt: 1,
      client: "b",
      target: "a",
      data: "hello",
    } satisfies SendTextMessage;

    transport.emit(session, incoming);
    await flush();
    transport.emit(session, incoming);

    expect(handler).toHaveBeenCalledTimes(1);
    await flush();
    expect(transport.sendCalls).toHaveLength(2);
    expect(transport.sendCalls[0]!.message.type).toBe(
      "check-message",
    );
    expect(transport.sendCalls[1]!.message.type).toBe(
      "check-message",
    );
  });

  it("dedups check-message by id (ignores createdAt)", async () => {
    const transport = new FakeTransport();
    const protocol = new RtcProtocol(transport);
    const session = makeSession("a", "b");

    const handler = vi.fn();
    protocol.on("check-message", ({ message }) => {
      handler(message.id);
    });

    const msg1 = {
      id: "m1",
      type: "check-message",
      createdAt: 1,
      client: "a",
      target: "b",
      mode: "receive",
    } satisfies CheckMessage;

    const msg2 = { ...msg1, createdAt: 2 };

    transport.emit(session, msg1);
    transport.emit(session, msg2);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("request() resolves when check-message arrives", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const protocol = new RtcProtocol(transport);

    const session = makeSession("a", "b");
    const request = {
      id: "m1",
      type: "send-text",
      createdAt: 1,
      client: "a",
      target: "b",
      data: "ping",
    } satisfies SendTextMessage;

    const promise = protocol.request(session, request, {
      timeoutMs: 1000,
    });

    expect(transport.sendCalls).toHaveLength(1);

    transport.emit(session, {
      id: "m1",
      type: "check-message",
      createdAt: 2,
      client: "a",
      target: "b",
      mode: "receive",
    } satisfies CheckMessage);

    await expect(promise).resolves.toMatchObject({
      type: "check-message",
      id: "m1",
    });

    vi.useRealTimers();
  });

  it("request() rejects on timeout", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const protocol = new RtcProtocol(transport);

    const session = makeSession("a", "b");
    const request = {
      id: "m1",
      type: "send-text",
      createdAt: 1,
      client: "a",
      target: "b",
      data: "ping",
    } satisfies SendTextMessage;

    const promise = protocol.request(session, request, {
      timeoutMs: 10,
    });

    vi.advanceTimersByTime(11);

    await expect(promise).rejects.toThrow(/timeout/i);
    vi.useRealTimers();
  });
});
