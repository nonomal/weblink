import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PeerSession } from "@/libs/core/session";
import type { SignalingService } from "@/libs/core/services/type";

if (typeof window === "undefined") {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
}

if (typeof document === "undefined") {
  (globalThis as any).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

const makeSender = (
  clientId: string,
  targetClientId: string,
): SignalingService =>
  ({
    clientId,
    targetClientId,
    get status() {
      return "connected";
    },
    sendSignal: async () => {},
    addEventListener: ((..._args: any[]) => {}) as any,
    removeEventListener: ((..._args: any[]) => {}) as any,
    close: () => {},
  }) as SignalingService;

const makeStream = (id: string) =>
  ({
    id,
    addEventListener: () => {},
    getTracks: () => [],
  }) as unknown as MediaStream;

describe("PeerSession default blank stream", () => {
  it("does not create fallback stream when local stream is null", () => {
    const session = new PeerSession(makeSender("a", "b"), {
      polite: false,
    });
    (session as any).localStream = makeStream("media-1");
    (session as any).lastLocalStreamState = "media";

    session.setStream(null);

    expect((session as any).localStream).toBeNull();
    expect((session as any).lastLocalStreamState).toBeNull();
    expect((session as any).outgoingQueue).toHaveLength(0);
  });

  it("syncs null stream to transceivers when pc exists", () => {
    const session = new PeerSession(makeSender("a", "b"), {
      polite: false,
    });
    const pc = {
      getSenders: () => [],
    } as unknown as RTCPeerConnection;
    (session as any).peerConnection = pc;
    (session as any).localStream = makeStream("media-2");

    const renegotiate = vi.fn();
    (session as any).renegotiate = renegotiate;

    session.setStream(null);

    expect((session as any).localStream).toBeNull();
    expect(renegotiate).toHaveBeenCalledTimes(1);
  });
});
