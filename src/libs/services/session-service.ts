import {
  produce,
  reconcile,
} from "solid-js/store";
import { PeerSession } from "../core/session";
import { ClientID, ClientInfo } from "../core/type";
import {
  ClientService,
  TransferClient,
} from "../core/services/type";
import { Accessor, createEffect } from "solid-js";
import {
  SendClipboardMessage,
  StorageMessage,
} from "@/libs/core/message";
import { v4 } from "uuid";
import { getIceServers } from "@/libs/core/store";
import { catchErrorAsync, catchErrorSync } from "../catch";
import { appState, setAppState } from "@/libs/state/app-state";

export class SessionService {
  readonly sessions: Record<ClientID, PeerSession> =
    appState.session.sessions;
  readonly clientViewData: Record<ClientID, ClientInfo> =
    appState.session.clientViewData;
  private service?: ClientService;

  get clientService() {
    return this.service;
  }

  clientServiceStatus: Accessor<
    "connecting" | "connected" | "disconnected"
  > = () => appState.session.clientServiceStatus;

  iceServers: Promise<RTCIceServer[]>;

  constructor() {
    this.iceServers = getIceServers();
  }

  updateIceServers() {
    this.iceServers = getIceServers();
  }

  setClipboard(message: SendClipboardMessage) {
    setAppState(
      "session",
      "clientViewData",
      message.client,
      produce((state) => {
        state.clipboard = [
          ...(state.clipboard ?? []),
          message,
        ];
      }),
    );
  }

  setStorage(message: StorageMessage) {
    setAppState(
      "session",
      "clientViewData",
      message.client,
      produce((state) => {
        state.storage = [...(message.data ?? [])];
      }),
    );
  }

  setClientService(cs: ClientService) {
    if (this.service) {
      console.warn(
        `client service already set, destory old service`,
      );
      this.removeService();
    }
    this.service = cs;

    cs.addEventListener("statuschange", (ev) => {
      setAppState("session", "clientServiceStatus", ev.detail);
    });
  }

  removeService() {
    this.service?.close();
    this.service = undefined;
    setAppState(
      "session",
      "clientServiceStatus",
      "disconnected",
    );
  }

  removeSession(target: ClientID) {
    const session = this.sessions[target];
    if (!session) {
      console.log(
        `can not destory session, session ${target} not found`,
      );
      return;
    }
    session.close();
    this.service?.removeSender(target);
    setAppState(
      "session",
      "clientViewData",
      target,
      undefined!,
    );
    setAppState(
      "session",
      "sessions",
      target,
      undefined!,
    );
  }

  requestStorage(client: ClientID) {
    const session = this.sessions[client];
    if (!session) {
      console.warn(
        `[SessionService] request storage, session ${client} not found`,
      );
      return;
    }
    session.sendMessage({
      type: "request-storage",
      id: v4(),
      createdAt: Date.now(),
      client: session.clientId,
      target: session.targetClientId,
    });
  }

  async addClient(client: TransferClient) {
    if (!this.service) {
      throw new Error(
        `can not add client: ${client.clientId}, client service not found`,
      );
    }
    if (this.sessions[client.clientId]) {
      throw new Error(
        `client ${client.clientId} has already created`,
      );
    }
    const polite =
      this.service.info.createdAt < client.createdAt;
    const sender = this.service.createSender(
      client.clientId,
    );
    if (!sender) {
      throw new Error(
        `can not create sender for client: ${client.clientId}`,
      );
    }
    const session = new PeerSession(sender, {
      polite,
      iceServers: await this.iceServers,
      relayOnly:
        appState.options.servers.turns.length > 0 &&
        appState.options.relayOnly,
    });

    setAppState("session", "clientViewData", client.clientId, {
      ...client,
      onlineStatus: "offline",
      messageChannel: false,
    } satisfies ClientInfo);
    setAppState("session", "sessions", client.clientId, session);

    const controller = new AbortController();

    session.addEventListener("peerconnectioninit", (ev) => {
      const pc = ev.detail;
      pc.getSenders().forEach((sender) => {
        switch (sender.track?.kind) {
          case "audio": {
            const audioParameters = changeAudioEncoding(
              sender.getParameters(),
            );
            if (audioParameters) {
              sender
                .setParameters(audioParameters)
                .catch((e) => {
                  console.error(
                    `set audio parameters error: ${e}`,
                  );
                });
            }
            break;
          }
          case "video": {
            const videoParameters = changeVideoEncoding(
              sender.getParameters(),
            );
            if (videoParameters) {
              sender
                .setParameters(videoParameters)
                .catch((e) => {
                  console.error(
                    `set video parameters error: ${e}`,
                  );
                });
            }
            break;
          }
        }
      });
    });

    session.addEventListener(
      "statuschange",
      (ev) => {
        console.log(`session status change`, ev.detail);
        switch (ev.detail) {
          case "created":
            break;
          case "connecting":
            setAppState(
              "session",
              "clientViewData",
              client.clientId,
              "onlineStatus",
              "connecting",
            );
            break;
          case "connected":
            setAppState(
              "session",
              "clientViewData",
              client.clientId,
              "onlineStatus",
              "online",
            );
            break;
          case "reconnecting":
            setAppState(
              "session",
              "clientViewData",
              client.clientId,
              "onlineStatus",
              "reconnecting",
            );
            break;
          case "disconnected":
            setAppState(
              "session",
              "clientViewData",
              client.clientId,
              "onlineStatus",
              "offline",
            );
            break;
          case "closed":
            setAppState(
              "session",
              "clientViewData",
              client.clientId,
              "onlineStatus",
              "offline",
            );
            controller.abort();
            this.removeSession(session.clientId);
            break;
        }
      },
      { signal: controller.signal },
    );

    session.addEventListener(
      "error",
      (ev) => {
        console.error(
          `session ${client.clientId} error`,
          ev.detail,
        );
      },
      { signal: controller.signal },
    );

    session.addEventListener(
      "remotestreamchange",
      (ev) => {
        setAppState(
          "session",
          "clientViewData",
          client.clientId,
          "stream",
          reconcile(ev.detail ?? undefined),
        );
      },
      { signal: controller.signal },
    );

    session.addEventListener(
      "messagechannelchange",
      (ev) => {
        if (this.clientViewData[client.clientId]) {
          setAppState(
            "session",
            "clientViewData",
            client.clientId,
            "messageChannel",
            ev.detail === "ready",
          );
        }
      },
    );

    return session;
  }

  destoryAllSession() {
    Object.values(this.sessions).forEach((session) =>
      session.close(),
    );
    setAppState("session", "sessions", reconcile({}));
    setAppState("session", "clientViewData", reconcile({}));

    this.service?.close();
    this.service = undefined;
    setAppState(
      "session",
      "clientServiceStatus",
      "disconnected",
    );
  }
}

export let sessionService: SessionService;

export function createSessionService() {
  if (!sessionService) {
    sessionService = new SessionService();

    createEffect(() => {
      appState.options.servers.turns.length;
      sessionService.updateIceServers();
    });

    createEffect(() => {
      appState.options.videoMaxBitrate;
      appState.options.degradationPreference;
      Object.values(sessionService.sessions).forEach(
        (session) => {
          session.peerConnection
            ?.getSenders()
            .forEach((sender) => {
              switch (sender.track?.kind) {
                case "audio":
                  const audioParameters =
                    changeAudioEncoding(
                      sender.getParameters(),
                    );
                  if (audioParameters) {
                    sender
                      .setParameters(audioParameters)
                      .then(() => {
                        console.log(
                          `set audio parameters success, encoding:`,
                          audioParameters.encodings?.[0],
                        );
                      })
                      .catch((e) => {
                        console.error(
                          `set audio parameters error: ${e}`,
                        );
                      });
                  }
                  break;
                case "video":
                  const videoParameters =
                    changeVideoEncoding(
                      sender.getParameters(),
                    );
                  if (videoParameters) {
                    sender
                      .setParameters(videoParameters)
                      .then(() => {
                        console.log(
                          `set video parameters success, encoding:`,
                          videoParameters.encodings?.[0],
                        );
                      })
                      .catch((e) => {
                        console.error(
                          `set video parameters error: ${e}`,
                        );
                      });
                  }
                  break;
              }
            });
        },
      );
    });
  }

  return sessionService;
}

function changeAudioEncoding(
  parameters: RTCRtpSendParameters,
): RTCRtpSendParameters | null {
  if (!parameters.encodings) {
    parameters.encodings = [{ active: true }];
  }
  const encoding = parameters.encodings[0] ?? {};
  encoding.active = true;
  // encoding.maxBitrate = appState.options.audioMaxBitrate;
  encoding.priority = "high";
  encoding.networkPriority = "high";
  return parameters;
}

function changeVideoEncoding(
  parameters: RTCRtpSendParameters,
): RTCRtpSendParameters | null {
  parameters.degradationPreference =
    appState.options.degradationPreference ?? "balanced";
  if (!parameters.encodings) {
    parameters.encodings = [{ active: true }];
  }
  const encoding = parameters.encodings[0] ?? {};
  encoding.active = true;
  encoding.maxBitrate = appState.options.videoMaxBitrate;
  encoding.priority = "high";
  encoding.networkPriority = "high";
  return parameters;
}

