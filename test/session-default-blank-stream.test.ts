import { describe, expect, it } from "vitest";
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
  it("falls back to blank stream when local stream is null", () => {
    const session = new PeerSession(makeSender("a", "b"), {
      polite: false,
    });
    const blankStream = makeStream("blank-1");

    (session as any).createDefaultBlankStream =
      function () {
        this.defaultBlankStream = blankStream;
        return blankStream;
      };

    session.setStream(null);

    expect((session as any).localStream).toBe(blankStream);
    expect((session as any).defaultBlankStream).toBe(
      blankStream,
    );
    expect((session as any).outgoingQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "stream-state",
          mode: "placeholder",
        }),
      ]),
    );
  });

  it("keeps current blank stream on repeated null updates", () => {
    const session = new PeerSession(makeSender("a", "b"), {
      polite: false,
    });
    const blankStream = makeStream("blank-2");
    (session as any).defaultBlankStream = blankStream;
    (session as any).localStream = blankStream;
    (session as any).lastLocalStreamState = "placeholder";

    let createCalls = 0;
    (session as any).createDefaultBlankStream = () => {
      createCalls += 1;
      return makeStream(`blank-next-${createCalls}`);
    };

    session.setStream(null);

    expect(createCalls).toBe(0);
    expect((session as any).localStream).toBe(blankStream);
    expect((session as any).outgoingQueue).toHaveLength(0);
  });
});
