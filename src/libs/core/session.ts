import {
  ClientSignal,
  SignalingService,
} from "./services/type";
import {
  EventHandler,
  MultiEventEmitter,
} from "../utils/event-emitter";
import { SessionMessage } from "./message";
import { waitChannel } from "./utils/channel";
import { appOptions } from "@/options";
import { catchErrorAsync, catchErrorSync } from "../catch";

export interface PeerSessionOptions {
  polite?: boolean;
  iceServers?: RTCIceServer[];
  relayOnly?: boolean;
}

export type PeerSessionEventMap = {
  channel: RTCDataChannel;
  message: SessionMessage;
  error: Error;
  messagechannelchange: "ready" | "closed";
  remotestreamchange: MediaStream | null;
  statuschange: Exclude<PeerSessionStatus, "init">;
  peerconnectioninit: RTCPeerConnection;
};

type PeerSessionStatus =
  | "created"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "closed"
  | "init";

const ConnectionTimeout = 10000;

export class PeerSession {
  private eventEmitter: MultiEventEmitter<PeerSessionEventMap> =
    new MultiEventEmitter();
  peerConnection: RTCPeerConnection | null = null;
  private makingOffer: boolean = false;
  private ignoreOffer: boolean = false;
  private connectable: boolean = false;
  private sender: SignalingService;
  private controller: AbortController | null = null;
  private channels: RTCDataChannel[] = [];
  private messageChannel: RTCDataChannel | null = null;
  private iceServers: RTCIceServer[] = [];
  private relayOnly: boolean;
  private signalCache: Array<ClientSignal> = [];
  readonly polite: boolean;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private status: PeerSessionStatus = "init";
  private listenController: AbortController | null = null;

  private applyPreferredCodecPreferences(
    pc: RTCPeerConnection,
  ) {
    if (typeof RTCRtpSender === "undefined") return;
    if (!("getCapabilities" in RTCRtpSender)) return;

    const orderCodecs = (
      codecs: any[],
      preferredMimeType: string,
    ) => {
      if (!preferredMimeType) return codecs;

      const normalizedPreferred = preferredMimeType
        .trim()
        .toLowerCase();
      const preferred = codecs.filter(
        (c) =>
          c.mimeType.trim().toLowerCase() ===
          normalizedPreferred,
      );
      if (preferred.length === 0) return codecs;

      const preferredPayloadTypes = new Set<number>();
      preferred.forEach((c) => {
        const pt = c.preferredPayloadType;
        if (typeof pt === "number")
          preferredPayloadTypes.add(pt);
      });
      const rtxForPreferred = codecs.filter((c) => {
        if (c.mimeType.trim().toLowerCase() !== "video/rtx")
          return false;
        const fmtp = c.sdpFmtpLine;
        if (!fmtp) return false;
        const match = fmtp.match(/\bapt=(\d+)\b/);
        if (!match) return false;
        const apt = Number(match[1]);
        if (Number.isNaN(apt)) return false;
        return preferredPayloadTypes.has(apt);
      });

      const preferredSet = new Set(preferred);
      const rtxSet = new Set(rtxForPreferred);
      const rest = codecs.filter(
        (c) => !preferredSet.has(c) && !rtxSet.has(c),
      );
      return [...preferred, ...rtxForPreferred, ...rest];
    };

    const applyForKind = (
      kind: "audio" | "video",
      preferredMimeType: string,
    ) => {
      if (!preferredMimeType) return;
      const capabilities =
        RTCRtpSender.getCapabilities(kind);
      const codecs = capabilities?.codecs;
      if (!codecs || codecs.length === 0) return;

      const ordered = orderCodecs(
        codecs,
        preferredMimeType,
      );
      pc.getTransceivers().forEach((transceiver) => {
        const transceiverKind =
          transceiver.sender.track?.kind ??
          transceiver.receiver.track?.kind;
        if (transceiverKind !== kind) return;
        if (!("setCodecPreferences" in transceiver)) return;
        try {
          transceiver.setCodecPreferences(ordered);
        } catch (e) {
          console.warn(
            `[PeerSession] setCodecPreferences failed for ${kind}:`,
            e,
          );
        }
      });
    };

    applyForKind(
      "video",
      appOptions.preferredVideoCodec ?? "",
    );
    applyForKind(
      "audio",
      appOptions.preferredAudioCodec ?? "",
    );
  }
  constructor(
    sender: SignalingService,
    {
      polite = true,
      iceServers,
      relayOnly = false,
    }: PeerSessionOptions = {},
  ) {
    this.sender = sender;
    this.polite = polite;
    this.iceServers = iceServers ?? [];
    this.relayOnly = relayOnly;

    window.addEventListener("beforeunload", () => {
      this.close();
    });

    document.addEventListener("resume", () => {
      if (
        this.peerConnection?.connectionState !== "connected"
      ) {
        this.disconnect();
      }
    });

    document.addEventListener("freeze", () => {
      this.disconnect();
    });
  }

  get clientId() {
    return this.sender.clientId;
  }

  get targetClientId() {
    return this.sender.targetClientId;
  }

  addEventListener<K extends keyof PeerSessionEventMap>(
    eventName: K,
    handler: EventHandler<PeerSessionEventMap[K]>,
    options?: boolean | AddEventListenerOptions,
  ): void {
    return this.eventEmitter.addEventListener(
      eventName,
      handler.bind(this),
      options,
    );
  }
  removeEventListener<K extends keyof PeerSessionEventMap>(
    eventName: K,
    handler: EventHandler<PeerSessionEventMap[K]>,
    options?: boolean | EventListenerOptions,
  ): void {
    return this.eventEmitter.removeEventListener(
      eventName,
      handler,
      options,
    );
  }

  private dispatchEvent<
    K extends keyof PeerSessionEventMap,
  >(eventName: K, event: PeerSessionEventMap[K]) {
    return this.eventEmitter.dispatchEvent(
      eventName,
      event,
    );
  }

  private setStatus(status: PeerSessionStatus) {
    if (this.status === status) return;
    this.status = status;
    if (status !== "init") {
      this.dispatchEvent("statuschange", status);
    }
  }

  private initializeConnection() {
    if (this.status === "closed") {
      throw new Error(
        `[PeerSession] can not initialize connection, session ${this.clientId} is closed`,
      );
    }
    if (this.peerConnection) {
      if (
        this.peerConnection.connectionState === "connected"
      ) {
        throw new Error(
          `[PeerSession] can not initialize connection, session ${this.clientId} already connected`,
        );
      }
      this.disconnect();
    }

    console.log(
      `[PeerSession] initialize connection, session ${this.clientId}`,
    );
    if (this.controller) {
      throw new Error(
        `[PeerSession] can not initialize connection, controller already exists`,
      );
    }

    const controller = new AbortController();
    this.controller = controller;
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.relayOnly ? "relay" : "all",
    });
    this.peerConnection = pc;

    pc.addEventListener(
      "icecandidate",
      async (ev: RTCPeerConnectionIceEvent) => {
        if (!ev.candidate) return;

        const [err] = await catchErrorAsync(
          this.sender.sendSignal({
            type: "candidate",
            data: JSON.stringify({
              candidate: ev.candidate.toJSON(),
            }),
          }),
        );
        if (err) {
          console.error(err);
        }
      },
      {
        signal: controller.signal,
      },
    );

    pc.addEventListener(
      "datachannel",
      (ev) => {
        this.channels.push(ev.channel);

        ev.channel.addEventListener(
          "close",
          () => {
            const index = this.channels.findIndex(
              (c) => c.id === ev.channel.id,
            );
            if (index !== -1) {
              this.channels.splice(index, 1);
            }
          },
          { once: true },
        );

        if (ev.channel.protocol === "message") {
          this.setupMessageChannel(ev.channel);
        }

        this.dispatchEvent("channel", ev.channel);
      },
      {
        signal: controller.signal,
      },
    );

    pc.addEventListener(
      "connectionstatechange",
      () => {
        switch (pc.connectionState) {
          case "new":
            break;
          case "connecting":
            this.setStatus("connecting");
            break;
          case "connected":
            this.connectable = true;
            this.setStatus("connected");
            break;
          case "closed":
          case "disconnected":
          case "failed":
            this.handleDisconnection();
            break;
          default:
            break;
        }
      },
      { signal: controller.signal },
    );

    pc.addEventListener(
      "track",
      (ev) => {
        const stream = ev.streams.at(0);
        if (!stream) {
          console.warn(
            `[PeerSession] client ${this.targetClientId} add track ${ev.track.id} stream is null`,
          );
          return;
        }

        console.log(
          `[PeerSession] client ${this.targetClientId} add track ${ev.track.id} stream ${stream.id}`,
        );

        const receiver = ev.receiver;

        if ("jitterBufferTarget" in receiver)
          receiver.jitterBufferTarget = 0;
        if ("playoutDelayHint" in receiver)
          receiver.playoutDelayHint = 0;

        const track = ev.track;
        track.addEventListener(
          "ended",
          () => {
            if (this.remoteStream) {
              this.remoteStream.removeTrack(track);
              this.dispatchEvent(
                "remotestreamchange",
                this.remoteStream,
              );
            }
          },
          { once: true },
        );

        if (this.remoteStream) {
          // if the stream is the same, add the track to the remote stream
          if (stream.id === this.remoteStream.id) {
            this.remoteStream.addTrack(track);
            this.dispatchEvent(
              "remotestreamchange",
              this.remoteStream,
            );
            return;
          }
          // if the stream is different, remove the old stream
          const remoteStream = this.remoteStream;
          remoteStream.getTracks().forEach((t) => {
            remoteStream.removeTrack(t);
            t.stop();
          });

          this.remoteStream = null;
        }
        stream.addEventListener(
          "removetrack",
          (ev) => {
            console.log(
              `[PeerSession] client ${this.targetClientId} removetrack`,
              ev.track.id,
            );
            if (stream.getTracks().length === 0) {
              this.remoteStream = null;
            }
            this.dispatchEvent(
              "remotestreamchange",
              this.remoteStream,
            );
          },
          { signal: controller.signal },
        );

        // set the new stream
        this.remoteStream = stream;
        this.dispatchEvent("remotestreamchange", stream);
      },
      { signal: controller.signal },
    );

    if (this.localStream) {
      const stream = this.localStream;
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    } else {
      pc.addTransceiver("video", {
        direction: "recvonly",
      });
      pc.addTransceiver("audio", {
        direction: "recvonly",
      });
    }

    this.applyPreferredCodecPreferences(pc);
    this.dispatchEvent("peerconnectioninit", pc);

    this.popSignalCache();

    return pc;
  }

  private popSignalCache() {
    let queue = Promise.resolve();
    function enqueueTask(task: () => Promise<void>) {
      queue = queue.then(() => task());
    }
    for (const signal of this.signalCache) {
      enqueueTask(() => this.handleSignal(signal));
    }
    this.signalCache.length = 0;
  }

  private setupAfterConnectedListeners() {
    const pc = this.peerConnection;
    if (!pc) {
      throw new Error(
        `[PeerSession] peer connection is null, can not set listeners`,
      );
    }
    const controller = this.controller;
    if (!controller) {
      throw new Error(
        `[PeerSession] controller is null, can not set listeners`,
      );
    }

    pc.addEventListener(
      "iceconnectionstatechange",
      async () => {
        const state = pc.iceConnectionState;
        switch (state) {
          case "connected":
          case "completed":
            break;
          case "disconnected":
          case "failed":
            break;
          default:
            break;
        }
      },
      {
        signal: controller.signal,
      },
    );

    pc.addEventListener(
      "signalingstatechange",
      () => {
        console.log(
          `[PeerSession] signalingstatechange, signalingState: ${pc.signalingState}`,
        );
      },
      {
        signal: controller.signal,
      },
    );

    pc.addEventListener(
      "negotiationneeded",
      async () => {
        console.log(
          `[PeerSession] client ${this.clientId} onNegotiationneeded`,
        );

        await this.renegotiate();
      },
      { signal: controller.signal },
    );
  }

  private async handleDisconnection() {
    if (this.status === "closed") {
      console.warn(
        `[PeerSession] session ${this.clientId} is closed, skip handle disconnection`,
      );
      return;
    }
    this.disconnect();
    let reconnectAttempts = 0;
    const attemptReconnect = async () => {
      if (this.sender.status === "closed") {
        console.warn(
          `[PeerSession] signaling service is closed, skip handle disconnection`,
        );
        this.close();
        return;
      }
      if (
        ["closed", "reconnecting"].includes(this.status)
      ) {
        console.warn(
          `[PeerSession] session ${this.clientId} is ${this.status}, skip handle connection error`,
        );
        return;
      }
      if (
        ["connected", "connecting"].includes(
          this.peerConnection?.connectionState ?? "",
        )
      ) {
        console.warn(
          `[PeerSession] connection error, session ${this.clientId} is already ${this.peerConnection?.connectionState}, skip handle connection error`,
        );
        return;
      }
      if (!this.connectable) {
        console.warn(
          `[PeerSession] connection error, session ${this.clientId} is not connectable, disconnect`,
        );
        return;
      }
      reconnectAttempts++;
      console.log(
        `[PeerSession] attempt reconnect, attempt ${reconnectAttempts}`,
      );

      const [err] = await catchErrorAsync(this.reconnect());
      if (err) {
        console.error(
          `[PeerSession] reconnect attempt ${reconnectAttempts} failed, error: `,
          err,
        );
        if (reconnectAttempts < 10) {
          window.setTimeout(
            () => attemptReconnect(),
            Math.random() * (500 + reconnectAttempts * 500),
          );
        } else {
          this.disconnect();
          console.error(
            `[PeerSession] reconnect failed, reach max reconnect attempts`,
          );
        }
      } else {
        console.log(
          `[PeerSession] reconnect success, session ${this.clientId}`,
        );
      }
    };
    attemptReconnect();
  }

  private async handleSignal(signal: ClientSignal) {
    const pc = this.peerConnection;
    if (!pc) {
      console.log(
        `[PeerSession] peer connection is null, skip handle signal`,
      );
      return;
    }
    let err: Error | undefined;
    if (signal.type === "offer") {
      const offerCollision =
        this.makingOffer || pc.signalingState !== "stable";
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) {
        console.warn(
          `[PeerSession] Offer ignored due to collision, signalingState: ${pc.signalingState}`,
        );
        return;
      }

      [err] = await catchErrorAsync(
        pc.setRemoteDescription(
          new RTCSessionDescription({
            type: "offer",
            sdp: signal.data.sdp,
          }),
        ),
      );

      if (err) {
        console.error(
          `[PeerSession] setRemoteDescription error: `,
          err,
        );
        return;
      }

      [err] = await catchErrorAsync(
        pc.setLocalDescription(),
      );

      if (err) {
        console.error(
          `[PeerSession] setLocalDescription error: `,
          err,
        );
        return;
      }

      if (!pc.localDescription) {
        console.warn(
          `[PeerSession] localDescription is null, signalingState: ${pc.signalingState}`,
        );
        return;
      }

      [err] = await catchErrorAsync(
        this.sender.sendSignal({
          type: pc.localDescription.type,
          data: JSON.stringify({
            sdp: pc.localDescription.sdp,
          }),
        }),
      );

      if (err) {
        console.error(
          `[PeerSession] sendSignal error: `,
          err,
        );
        return;
      }
    } else if (signal.type === "answer") {
      if (pc.signalingState !== "have-local-offer") {
        console.warn(
          `[PeerSession] answer ignored due to signalingState is ${pc.signalingState}`,
        );
        return;
      }

      [err] = await catchErrorAsync(
        pc.setRemoteDescription(
          new RTCSessionDescription({
            type: "answer",
            sdp: signal.data.sdp,
          }),
        ),
      );

      if (err) {
        console.error(
          `[PeerSession] setRemoteDescription error: `,
          err,
        );
        return;
      }
    } else if (signal.type === "candidate") {
      const candidate = new RTCIceCandidate(
        signal.data.candidate,
      );
      [err] = await catchErrorAsync(
        pc.addIceCandidate(candidate),
      );

      if (err) {
        if (!this.ignoreOffer) {
          console.error(
            `[PeerSession] addIceCandidate error: `,
            err,
          );
        }
      }
    }
  }

  async listen() {
    if (this.status === "closed") {
      throw new Error(
        `[PeerSession] session ${this.clientId} is closed, can not listen`,
      );
    }
    if (this.sender.status === "closed") {
      throw new Error(
        `[PeerSession] signaling service is closed, can not listen`,
      );
    }
    const [err] = catchErrorSync(() =>
      this.initializeConnection(),
    );
    if (err) {
      throw err;
    }

    const listenController = new AbortController();
    this.listenController = listenController;

    listenController.signal.addEventListener(
      "abort",
      () => {
        this.listenController = null;
      },
    );

    this.sender.addEventListener(
      "signal",
      async (ev) => {
        if (this.status === "closed") {
          console.log(
            `[PeerSession] session ${this.clientId} is closed, skip handle signal`,
          );
          listenController.abort();
          return;
        }
        console.log(
          `[PeerSession] client received signal ${ev.detail.type}`,
          ev.detail,
        );
        const pc = this.peerConnection;
        if (!pc) {
          console.log(
            `[PeerSession] peer connection is null, cache signal`,
          );
          this.signalCache.push(ev.detail);
          if (ev.detail.type === "candidate") {
            this.handleDisconnection();
          }
        } else {
          await this.handleSignal(ev.detail);
        }
      },
      { signal: listenController.signal },
    );

    this.sender.addEventListener(
      "statuschange",
      (ev) => {
        console.log(
          `[PeerSession] signaling service status change: ${ev.detail}`,
        );
        if (ev.detail === "closed") {
          console.log(
            `[PeerSession] signaling service is closed, abort listen`,
          );
          listenController.abort();
        }
      },
      { signal: listenController.signal },
    );
    this.setStatus("created");
  }

  private removeStream() {
    console.log(
      `[PeerSession] client ${this.targetClientId} removeStream`,
    );
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.localStream?.removeTrack(track);
        track.stop();
      });
      this.localStream = null;
    }
    const pc = this.peerConnection;
    if (!pc) {
      console.log(
        `[PeerSession] client ${this.targetClientId} peer connection is null, skip remove stream`,
      );
      return;
    }
    pc.getSenders().forEach((sender) => {
      if (sender.track) {
        pc.removeTrack(sender);
      }
    });
    this.renegotiate();
  }

  setStream(stream: MediaStream | null) {
    console.log(
      `[PeerSession] client ${this.targetClientId} setStream`,
      stream,
    );
    if (!stream) {
      this.removeStream();
      return;
    }

    if (this.localStream) {
      if (this.localStream.id === stream.id) {
        console.log(
          `[PeerSession] client ${this.targetClientId} stream is same, skip setStream`,
        );
        return;
      }

      this.removeStream();
    }

    this.localStream = stream;

    let senders: RTCRtpSender[] = [];

    stream.addEventListener("addtrack", (ev) => {
      const sender = this.peerConnection?.addTrack(
        ev.track,
        stream,
      );
      if (sender) {
        senders.push(sender);
      }
    });

    stream.addEventListener("removetrack", (ev) => {
      const index = senders.findIndex(
        (sender) => sender.track?.id === ev.track.id,
      );
      if (index === -1) return;
      senders.splice(index, 1);
      if (!this.peerConnection) return;
      this.peerConnection.removeTrack(senders[index]);
    });

    const pc = this.peerConnection;
    if (!pc) {
      console.log(
        `[PeerSession] client ${this.targetClientId} peer connection is null, skip add track`,
      );
      return;
    }

    senders.push(
      ...stream.getTracks().map((track) => {
        track.addEventListener("ended", () => {
          console.log(
            `[PeerSession] track ended, remove track from peer connection`,
            track.id,
          );
          const index = senders.findIndex(
            (sender) => sender.track?.id === track.id,
          );
          if (index !== -1) {
            pc.removeTrack(senders[index]);
            senders.splice(index, 1);
          }
        });
        console.log(
          `[PeerSession] client ${this.targetClientId} add track`,
          track.id,
        );
        return pc.addTrack(track, stream);
      }),
    );

    this.applyPreferredCodecPreferences(pc);

    this.renegotiate();
  }

  async createChannel(label: string, protocol: string) {
    if (!this.peerConnection) {
      throw new Error(
        `[PeerSession] failed to create channel, peer connection is null`,
      );
    }

    const existChannel = this.channels.find(
      (channel) =>
        channel.label === label &&
        channel.protocol === protocol,
    );
    if (
      existChannel &&
      existChannel.readyState === "open"
    ) {
      console.warn(
        `[PeerSession] channel ${label} with protocol ${protocol} already exists`,
      );
      return existChannel;
    }

    const channel = this.peerConnection.createDataChannel(
      label,
      {
        ordered: appOptions.ordered,
        protocol,
      },
    );

    this.channels.push(channel);

    channel.addEventListener(
      "close",
      () => {
        const index = this.channels.findIndex(
          (channel) => channel.id === channel.id,
        );
        if (index !== -1) {
          this.channels.splice(index, 1);
        }
      },
      { signal: this.controller?.signal },
    );

    if (channel.protocol === "message") {
      this.setupMessageChannel(channel);
    }

    await waitChannel(channel);
    return channel;
  }

  private setupMessageChannel(channel: RTCDataChannel) {
    if (this.messageChannel) {
      this.messageChannel.close();
      this.messageChannel = null;
      this.dispatchEvent("messagechannelchange", "closed");
    }
    this.messageChannel = channel;
    channel.addEventListener(
      "message",
      (ev) => {
        const [error, message] = catchErrorSync(
          () => JSON.parse(ev.data) as SessionMessage,
        );
        if (error) {
          console.error(error);
          return;
        }

        this.dispatchEvent("message", message);
      },
      { signal: this.controller?.signal },
    );
    channel.addEventListener(
      "open",
      () => {
        this.dispatchEvent("messagechannelchange", "ready");
      },
      { signal: this.controller?.signal },
    );
    channel.addEventListener(
      "error",
      (ev) => {
        console.error(ev.error);
      },
      { signal: this.controller?.signal },
    );
    channel.addEventListener(
      "close",
      () => {
        if (this.messageChannel !== channel) return;
        this.messageChannel = null;
        this.dispatchEvent(
          "messagechannelchange",
          "closed",
        );
      },
      { signal: this.controller?.signal },
    );
  }

  sendMessage(message: SessionMessage) {
    if (this.status === "closed") {
      throw new Error(
        `[PeerSession] session ${this.clientId} is closed, can not send message`,
      );
    }
    if (!this.messageChannel) {
      console.error(
        `[PeerSession] failed to send message, message channel is null`,
      );
      return;
    }

    this.messageChannel.send(JSON.stringify(message));
  }

  async renegotiate() {
    if (this.status === "closed") {
      throw new Error(
        `[PeerSession] session ${this.clientId} is closed, can not renegotiate`,
      );
    }
    if (!this.peerConnection) {
      console.warn(
        `[PeerSession] renegotiate failed, peer connection is not created`,
      );
      return;
    }

    if (this.peerConnection.signalingState !== "stable") {
      console.warn(
        `[PeerSession] renegotiate failed, signalingState is ${this.peerConnection.signalingState}`,
      );
      return;
    }
    if (!this.makingOffer) {
      this.makingOffer = true;
      const [err] = await catchErrorAsync(
        handleOffer(this.peerConnection, this.sender),
      );
      if (err) {
        console.error(
          `[PeerSession] Error during ICE restart:`,
          err,
        );
        return;
      }
      this.makingOffer = false;
    } else {
      console.warn(
        `[PeerSession] session ${this.clientId} already making offer`,
      );
    }
  }

  async reconnect() {
    if (this.status === "closed") {
      throw new Error(
        `[PeerSession] session ${this.clientId} is closed, can not reconnect`,
      );
    }

    console.log(
      `[PeerSession] peer connection ${this.targetClientId} is null, new connection`,
    );
    this.disconnect();
    let err: Error | undefined;
    this.listenController?.abort();
    [err] = catchErrorSync(() => this.listen());
    if (err) throw err;
    this.setStatus("reconnecting");
    [err] = await catchErrorAsync(this.connect());
    if (err) throw err;
  }

  async connect() {
    if (this.status === "closed") {
      throw new Error(
        `[PeerSession] session ${this.clientId} is closed, can not connect`,
      );
    }
    if (!this.listenController) {
      throw new Error(
        `[PeerSession] signaling service is not initialized, can not connect`,
      );
    }
    const pc = this.peerConnection;
    if (!pc) {
      console.warn(
        `[PeerSession] connect failed, peer connection is null`,
      );
      return;
    }

    if (
      ["connected", "connecting"].includes(
        pc.connectionState,
      )
    ) {
      console.warn(
        `[PeerSession] session ${this.clientId} already ${pc.connectionState}`,
      );
      return;
    }

    const connectAbortController = new AbortController();

    return new Promise<void>(async (resolve, reject) => {
      this.createChannel("message", "message").catch(
        (err) => {
          reject(err);
        },
      );

      const timer = window.setTimeout(() => {
        reject(
          new Error(
            `[PeerSession] connect timeout: after ${ConnectionTimeout}ms`,
          ),
        );
      }, ConnectionTimeout);

      this.controller?.signal.addEventListener(
        "abort",
        () => {
          reject(
            new Error(`[PeerSession] connect aborted`),
          );
        },
        { once: true },
      );

      connectAbortController.signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
        },
        { once: true },
      );

      this.sender.addEventListener(
        "statuschange",
        (ev) => {
          if (
            ["closed", "disconnected"].includes(ev.detail)
          ) {
            reject(
              new Error(
                `[PeerSession] connection failed, signaling service is ${ev.detail}`,
              ),
            );
          }
        },
        { signal: connectAbortController.signal },
      );

      pc.addEventListener(
        "connectionstatechange",
        () => {
          switch (pc.connectionState) {
            case "connected":
              console.log(
                `connection established, session ${this.clientId}, connectable: ${this.connectable}`,
              );
              this.connectable = true;
              resolve();
              break;
            case "failed":
            case "closed":
            case "disconnected":
              reject(
                new Error(
                  `[PeerSession] Connection failed with state: ${pc.connectionState}`,
                ),
              );
              break;
            default:
              break;
          }
        },
        { signal: connectAbortController.signal },
      );
      if (!this.makingOffer) {
        this.makingOffer = true;
        const [err] = await catchErrorAsync(
          handleOffer(pc, this.sender),
        );
        if (err) {
          reject(
            new Error(
              `[PeerSession] Failed to create and send offer: ${err.message}`,
            ),
          );
        }
        this.makingOffer = false;
      } else {
        reject(
          new Error(
            `[PeerSession] session ${this.clientId} already making offer`,
          ),
        );
      }
    })
      .then(() => {
        this.setupAfterConnectedListeners();
        this.setStatus("connected");
      })
      .catch((err) => {
        this.disconnect();
        throw err;
      })
      .finally(() => {
        connectAbortController.abort();
      });
  }

  private resetSession() {
    this.makingOffer = false;
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    this.channels.forEach((channel) => channel.close());
    this.channels.length = 0;
    if (this.messageChannel) {
      this.messageChannel.close();
      this.messageChannel = null;
      this.dispatchEvent("messagechannelchange", "closed");
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.remoteStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.setStatus("init");
  }

  private disconnect() {
    this.resetSession();
    this.setStatus("disconnected");
  }

  close() {
    this.resetSession();
    this.setStatus("closed");
  }
}

// this function is used to modify the offer
export async function handleOffer(
  pc: RTCPeerConnection,
  sender: SignalingService,
  options?: RTCOfferOptions,
) {
  const offer = await pc.createOffer(options);

  await pc.setLocalDescription(offer);
  await sender.sendSignal({
    type: offer.type,
    data: JSON.stringify({
      sdp: offer.sdp,
    }),
  });
}
