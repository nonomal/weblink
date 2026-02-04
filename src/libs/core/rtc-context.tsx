import {
  Component,
  createContext,
  createEffect,
  onCleanup,
  onMount,
  ParentProps,
  useContext,
} from "solid-js";
import { ClientID, FileID, RoomStatus } from "./type";
import type { SetStoreFunction } from "solid-js/store";
import { PeerSession } from "./session";
import {
  TRANSFER_CHANNEL_PREFIX,
  TransferMode,
} from "./file-transferer";
import { v4 } from "uuid";
import { clientProfile } from "./store";
import { cacheManager } from "../services/cache-serivce";
import { transferManager } from "../services/transfer-service";
import { getRangesLength } from "../utils/range";
import { appState, setAppState } from "@/libs/state/app-state";
import {
  ClientService,
  ClientServiceInitOptions,
} from "./services/type";

import {
  CheckMessage,
  ErrorMessage,
  FileTransferMessage,
  messageStores,
  RequestFileMessage,
  ResumeFileMessage,
  SendClipboardMessage,
  SendFileMessage,
  SendTextMessage,
  SessionMessage,
  StorageMessage,
} from "./message";
import { sessionService } from "../services/session-service";
import { toast } from "solid-sonner";
import { ChunkMetaData, FileMetaData } from "../cache";
import { catchErrorAsync } from "../catch";

async function getClientService(
  options: ClientServiceInitOptions,
): Promise<ClientService> {
  switch (import.meta.env.VITE_BACKEND) {
    case "FIREBASE":
      return import(
        "./services/client/firebase-client-service"
      ).then((m) => new m.FirebaseClientService(options));
    case "WEBSOCKET":
      options.websocketUrl =
        appState.options.websocketUrl ??
        import.meta.env.VITE_WEBSOCKET_URL;
      return import(
        "./services/client/ws-client-service"
      ).then((m) => new m.WebSocketClientService(options));
    default:
      throw Error("invalid backend type");
  }
}

export function getRandomUnsignedShort() {
  return Math.floor(Math.random() * 6553);
}

const WebRTCContext = createContext<
  WebRTCContextProps | undefined
>(undefined);

export const useWebRTC = (): WebRTCContextProps => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error(
      "useWebRTC must be used within a WebRTCProvider",
    );
  }
  return context;
};

export interface SendOptions {
  target?: string;
}

export interface WebRTCContextProps {
  joinRoom: () => Promise<void>;
  leaveRoom: () => void;
  requestFile(
    target: ClientID,
    info: ChunkMetaData,
    resume?: boolean,
  ): Promise<void>;
  sendText: (
    text: string,
    target: ClientID | ClientID[],
  ) => Promise<void>;
  sendFile: (
    file: File,
    target: ClientID | ClientID[],
  ) => Promise<void>;
  shareFile: (fileId: FileID, target: ClientID) => void;
  resumeFile: (fileId: FileID, target: ClientID) => void;
  pauseFile: (fileId: FileID, target: ClientID) => void;
  roomStatus: RoomStatus;
}

export interface WebRTCProviderProps extends ParentProps {
  localStream: MediaStream | null;
}

export const WebRTCProvider: Component<
  WebRTCProviderProps
> = (props) => {
  let clipboardCacheData: SendClipboardMessage[] = [];

  onMount(() => {
    const onFocus = () => {
      if (clipboardCacheData.length === 0) return;
      const data = clipboardCacheData
        .map((msg) => msg.data)
        .join("\n");
      navigator.clipboard
        .writeText(data)
        .then(() => {
          toast.success(data);
        })
        .catch((err) => {
          toast.error(err.message);
        })
        .finally(() => {
          clipboardCacheData.length = 0;
        });
    };
    window.addEventListener("focus", onFocus);

    onCleanup(() => {
      window.removeEventListener("focus", onFocus);
    });
  });

  const roomStatus = appState.roomStatus;
  const setRoomStatus: SetStoreFunction<RoomStatus> =
    ((...args: any[]) =>
      (setAppState as any)("roomStatus", ...args)) as any;

  async function handleReceiveMessage(
    session: PeerSession,
    message: SessionMessage,
  ) {
    try {
      console.log(`handle receive message`, message);

      if (message.type === "send-text") {
        messageStores.setReceiveMessage(message);
        const replyMessage = {
          type: "check-message",
          id: message.id,
          createdAt: Date.now(),
          client: message.target,
          target: message.client,
          mode: "receive",
        } satisfies CheckMessage;
        session.sendMessage(replyMessage);
      } else if (message.type === "send-clipboard") {
        sessionService.setClipboard(message);
        window.focus();
        if (navigator.clipboard) {
          navigator.clipboard
            .writeText(message.data)
            .then(() => {
              toast.success(message.data);
            })
            .catch((err) => {
              clipboardCacheData.push(message);
              if (err instanceof Error) {
                console.warn(
                  `can not write ${message.data} to clipboard, ${err.message}`,
                );
              }
            });
        }
      } else if (message.type === "send-file") {
        if (cacheManager.getCache(message.fid)) {
          throw new Error(
            `cache ${message.fid} already exists`,
          );
        }
        messageStores.setReceiveMessage(message);

        const cache = await cacheManager.createCache(
          message.fid,
        );

        const receiveInfo = {
          fileName: message.fileName,
          fileSize: message.fileSize,
          mimetype: message.mimeType,
          lastModified: message.lastModified,
          chunkSize: message.chunkSize,
          createdAt: message.createdAt,
          id: message.fid,
        } satisfies FileMetaData;

        const transferer = transferManager.createTransfer(
          cache,
          TransferMode.Receive,
          receiveInfo,
        );

        messageStores.addTransfer(transferer);
        await transferer.initialize();

        const replyMessage = {
          type: "check-message",
          id: message.id,
          createdAt: Date.now(),
          client: message.target,
          target: message.client,
          mode: "receive",
        } satisfies CheckMessage;

        session.sendMessage(replyMessage);
      } else if (message.type === "request-file") {
        const cache = cacheManager.getCache(message.fid);
        if (!cache) {
          throw new Error(`cache ${message.fid} not found`);
        }

        const info = await cache.getInfo();
        if (!info) {
          throw new Error(
            `cache ${message.fid} info not found`,
          );
        }

        if (!info.isComplete) {
          throw new Error(
            `cache ${message.fid} is not complete`,
          );
        }
        messageStores.setReceiveMessage(message);
        const transferer = transferManager.createTransfer(
          cache,
          TransferMode.Send,
        );
        messageStores.addTransfer(transferer);

        transferer.addEventListener("ready", async () => {
          const [error] = await catchErrorAsync(
            transferer.sendFile(message.ranges),
          );
          if (error) {
            console.error(error);
            toast.error(error.message);
          }
        });

        await transferer.initialize();
        transferer.setSendStatus(message);

        const replyMessage = {
          type: "check-message",
          id: message.id,
          createdAt: Date.now(),
          client: message.target,
          target: message.client,
          mode: "send",
        } satisfies CheckMessage;

        session.sendMessage(replyMessage);
      } else if (message.type === "check-message") {
        messageStores.setReceiveMessage(message);
        const index = messageStores.messages.findLastIndex(
          (msg) => msg.id === message.id,
        );
        if (index === -1) {
          console.warn(
            `check message ${message.id} not found`,
          );
          throw new Error(
            `check message ${message.id} not found`,
          );
        }
        const storeMessage = messageStores.messages[index];
        if (storeMessage.type === "file") {
          if (!storeMessage.fid) {
            throw new Error(
              `file transfer message ${message.id} fid is undefined`,
            );
          }
          const cache = cacheManager.getCache(
            storeMessage.fid,
          );
          if (!cache) {
            console.warn(
              `cache ${storeMessage.fid} not found`,
            );
            throw new Error(
              `cache ${storeMessage.fid} not found`,
            );
          }
          if (message.mode === "send") {
            const transferer =
              transferManager.createTransfer(
                cache,
                TransferMode.Receive,
              );
            messageStores.addTransfer(transferer);
            await transferer.initialize();
            for (
              let i = 0;
              i < appState.options.channelsNumber;
              i++
            ) {
              const [err, channel] = await catchErrorAsync(
                session.createChannel(
                  `${transferer.id}-${i}`,
                  "transfer",
                ),
              );
              if (err) {
                console.error(err);
                throw err;
              }

              if (channel) {
                transferManager.addChannel(
                  cache.id,
                  channel,
                );
              }
            }
          } else if (message.mode === "receive") {
            const transferer =
              transferManager.createTransfer(
                cache,
                TransferMode.Send,
              );

            messageStores.addTransfer(transferer);
            transferer.addEventListener(
              "ready",
              async () => {
                const [error] = await catchErrorAsync(
                  transferer.sendFile(),
                );
                if (error) {
                  console.error(error);
                  toast.error(error.message);
                }
              },
            );
            await transferer.initialize();

            for (
              let i = 0;
              i < appState.options.channelsNumber;
              i++
            ) {
              const [err, channel] = await catchErrorAsync(
                session.createChannel(
                  `${transferer.id}-${i}`,
                  "transfer",
                ),
              );
              if (err) {
                console.error(err);
                throw err;
              }

              if (!channel) continue;

              transferManager.addChannel(
                storeMessage.fid,
                channel,
              );
            }
          }
        }
      } else if (message.type === "resume-file") {
        const cache = cacheManager.getCache(message.fid);
        if (!cache) {
          throw new Error(`cache ${message.fid} not found`);
        }
        const info = await cache.getInfo();
        if (!info) {
          throw new Error(
            `cache ${message.fid} info not found`,
          );
        }
        requestFile(message.client, info, true);
      } else if (message.type === "storage") {
        sessionService.setStorage(message);
      } else if (message.type === "request-storage") {
        const replyMessage = {
          type: "storage",
          data: (await cacheManager.getStorages()) ?? [],
          createdAt: Date.now(),
          client: message.target,
          target: message.client,
          id: message.id,
        } satisfies StorageMessage;

        session.sendMessage(replyMessage);
      } else if (message.type === "error") {
        messageStores.setReceiveMessage(message);
        console.warn(message.error);
      }
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        const errorMessage = {
          type: "error",
          id: message.id,
          client: message.target,
          target: message.client,
          createdAt: Date.now(),
          error: err.message,
        } satisfies ErrorMessage;
        session.sendMessage(errorMessage);
      }
    }
  }

  const joinRoom = async (): Promise<void> => {
    console.log(
      `join ${clientProfile.roomId} with profile`,
      clientProfile,
    );

    let cs: ClientService;
    if (sessionService.clientService) {
      cs = sessionService.clientService;
    } else {
      cs = await getClientService({
        roomId: clientProfile.roomId,
        password: clientProfile.password,
        client: {
          clientId: clientProfile.clientId,
          name: clientProfile.name,
          avatar: clientProfile.avatar,
        },
      });

      sessionService.setClientService(cs);
    }

    await cs.createClient().catch((err) => {
      sessionService.removeService();
      throw err;
    });

    setRoomStatus("profile", cs.info);

    cs.listenForJoin(async (targetClient) => {
      console.log(`new client join in `, targetClient);

      const [err, session] = await catchErrorAsync(
        sessionService.addClient(targetClient),
      );
      if (err) {
        console.error(err);
        return;
      }

      session.setStream(props.localStream);

      session.addEventListener("message", async (ev) => {
        const message = ev.detail;
        handleReceiveMessage(session, message);
      });

      session.addEventListener("channel", (ev) => {
        const channel = ev.detail;

        if (channel.protocol === "transfer") {
          console.log(`datachannel event`, channel);

          const fileIdWithChannelId = channel.label.replace(
            TRANSFER_CHANNEL_PREFIX,
            "",
          );

          const index =
            fileIdWithChannelId.lastIndexOf("-");
          const fileId = fileIdWithChannelId.slice(
            0,
            index,
          );

          console.log(`receive channel for file ${fileId}`);

          transferManager.addChannel(fileId, channel);
        }
      });

      await session.listen();
      messageStores.setClient(targetClient);

      if (!session.polite) {
        const [err] = await catchErrorAsync(
          session.connect(),
        );
        if (err) {
          console.error(err);
          if (
            Object.values(sessionService.sessions)
              .length === 0
          ) {
            leaveRoom();
            throw err;
          }
        }
      }
    });

    cs.listenForLeave((client) => {
      console.log(`client ${client.clientId} leave`);
      sessionService.removeSession(client.clientId);
    });

    setRoomStatus("roomId", clientProfile.roomId);
  };

  const leaveRoom = async () => {
    const room = roomStatus.roomId;
    if (room) {
      console.log(`on leave room ${room}`);
    }

    sessionService.destoryAllSession();
    setRoomStatus("roomId", null);
    setRoomStatus("profile", null);
  };

  onCleanup(() => {
    leaveRoom();
  });

  createEffect(() => {
    for (const session of Object.values(
      sessionService.sessions,
    )) {
      session.setStream(props.localStream);
    }
  });

  const getTargetSessions = (
    target: ClientID | ClientID[],
  ) => {
    const sessions = target
      ? Array.isArray(target)
        ? target.map((t) => sessionService.sessions[t])
        : [sessionService.sessions[target]]
      : Object.values(sessionService.sessions);
    return sessions.filter((s) => s);
  };

  const sendText = async (
    text: string,
    target: ClientID | ClientID[],
  ) => {
    const sessions = getTargetSessions(target);
    if (sessions.length === 0) return;

    for (const session of sessions) {
      const message = {
        id: v4(),
        type: "send-text",
        client: session.clientId,
        target: session.targetClientId,
        data: text,
        createdAt: Date.now(),
      } as SendTextMessage;
      session.sendMessage(message);
      messageStores.setSendMessage(message);
      console.log(`send text message`, message);
    }
  };

  const sendFile = async (
    file: File,
    target: ClientID | ClientID[],
  ) => {
    const sessions = getTargetSessions(target);
    if (sessions.length === 0) return;

    for (const session of sessions) {
      const fid = v4();
      const target = session.targetClientId;
      const client = session.clientId;
      const message = {
        id: v4(),
        type: "send-file",
        client: client,
        target: target,
        fid: fid,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        lastModified: file.lastModified,
        createdAt: Date.now(),
        chunkSize: appState.options.chunkSize,
      } satisfies SendFileMessage;

      const cache = await cacheManager.createCache(
        message.fid,
      );
      cache.setInfo({
        fileName: message.fileName,
        fileSize: message.fileSize,
        mimetype: message.mimeType,
        lastModified: message.lastModified,
        chunkSize: message.chunkSize,
        createdAt: message.createdAt,
        file: file,
      });

      console.log(`send file message`, message);
      messageStores.setSendMessage(message);
      session.sendMessage(message);
    }
  };

  const shareFile = async (
    fileId: FileID,
    target: ClientID,
  ) => {
    const cache = cacheManager.getCache(fileId);
    if (!cache) {
      console.warn(`cache ${fileId} not exist`);
      return;
    }
    const session = sessionService.sessions[target];
    if (!session) {
      console.warn(`session ${target} not exist`);
      return;
    }
    const info = await cache.getInfo();
    if (!info) {
      console.warn(`cache ${fileId} info not exist`);
      return;
    }

    if (!info.file) {
      console.warn(`cache ${fileId} file not exist`);
      return;
    }

    const message = {
      id: v4(),
      type: "send-file",
      client: session.clientId,
      target: session.targetClientId,
      fid: fileId,
      fileName: info.fileName,
      fileSize: info.fileSize,
      mimeType: info.mimetype,
      lastModified: info.lastModified,
      createdAt: Date.now(),
      chunkSize: appState.options.chunkSize,
    } satisfies SendFileMessage;
    messageStores.setSendMessage(message);
    session.sendMessage(message);
  };

  const requestFile = async (
    target: ClientID,
    info: ChunkMetaData,
    resume: boolean = false,
  ) => {
    const session = sessionService.sessions[target];
    if (!session) {
      console.warn(
        `can not request file from target: ${target}, target not exist`,
      );
      return;
    }
    const client = sessionService.clientViewData[target];
    if (client.onlineStatus !== "online") {
      console.warn(
        `can not request file from target: ${target}, client status is ${client.onlineStatus}`,
      );
      return;
    }

    let cache = cacheManager.getCache(info.id);
    console.log(`get local cache`, cache);
    if (!cache) {
      cache = await cacheManager.createCache(info.id);
      await cache.setInfo({
        ...info,
        file: undefined,
      });
      console.log(`create cache`, await cache.getInfo());
    } else {
      console.log(`get local cache`, cache);
    }

    const ranges = await cache.getReqRanges();

    if (ranges && getRangesLength(ranges) === 0) {
      messageStores.addCache(cache);
      await cache.getFile();
      return;
    }

    let index = messageStores.messages.findIndex(
      (msg) => msg.type === "file" && msg.fid === info.id,
    );

    let id;
    if (resume && index !== -1) {
      id = messageStores.messages[index].id;
    } else {
      id = v4();
    }

    const message = {
      id,
      type: "request-file",
      fid: info.id,
      client: session.clientId,
      target: session.targetClientId,
      ranges: ranges ?? undefined,
      fileName: info.fileName,
      fileSize: info.fileSize,
      mimeType: info.mimetype,
      lastModified: info.lastModified,
      chunkSize:
        info.chunkSize ?? appState.options.chunkSize,
      createdAt: Date.now(),
      resume,
    } satisfies RequestFileMessage;

    messageStores.setSendMessage(message);
    session.sendMessage(message);
  };

  const resumeFile = async (
    fileId: FileID,
    target: ClientID,
  ) => {
    const session = sessionService.sessions[target];
    if (!session) return;
    const cache = cacheManager.getCache(fileId);
    if (!cache) return;
    const info = await cache.getInfo();
    if (!info) return;
    if (!info.file) return;

    const transferMessage = messageStores.messages.findLast(
      (msg) => msg.type === "file" && msg.fid === fileId,
    ) as FileTransferMessage | undefined;
    if (!transferMessage) return;
    if (transferMessage.transferStatus === "complete")
      return;

    const message = {
      id: transferMessage.id,
      type: "resume-file",
      fid: fileId,
      client: session.clientId,
      target: session.targetClientId,
      createdAt: Date.now(),
    } satisfies ResumeFileMessage;

    messageStores.setSendMessage(message);
    session.sendMessage(message);
  };

  const pauseFile = async (
    fileId: FileID,
    target: ClientID,
  ) => {
    const session = sessionService.sessions[target];
    if (!session) return;
    const transferer =
      transferManager.getTransferer(fileId);
    if (!transferer) return;
    await transferer.pause(true);
  };

  return (
    <WebRTCContext.Provider
      value={{
        joinRoom,
        leaveRoom,
        shareFile,
        sendText,
        sendFile,
        requestFile,
        resumeFile,
        pauseFile,
        roomStatus,
      }}
    >
      {props.children}
    </WebRTCContext.Provider>
  );
};
