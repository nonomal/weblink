import { waitBufferedAmountLowThreshold } from "./utils/channel";
import {
  EventHandler,
  MultiEventEmitter,
} from "../utils/event-emitter";
import { catchErrorAsync } from "../catch";
import type { ChunkCache } from "../cache/chunk-cache";
import type { FileMetaData } from "../cache";
import type {
  FileTransfererEventMap,
  FileTransfererOptions,
  PauseMessage,
  TransferMode,
} from "./file-transferer";

export abstract class FileTransferBase {
  private eventEmitter: MultiEventEmitter<FileTransfererEventMap> =
    new MultiEventEmitter();

  channels: Array<RTCDataChannel> = [];
  protected bufferedAmountLowThreshold = 1024 * 1024; // 1MB

  readonly cache: ChunkCache;
  protected info: FileMetaData | null = null;

  protected controller: AbortController =
    new AbortController();
  protected closed = false;
  protected isComplete = false;
  protected timer?: number;
  protected unzipWorker?: Worker;
  protected compressWorker?: Worker;

  abstract readonly mode: TransferMode;

  get id() {
    return this.cache.id;
  }

  constructor(options: FileTransfererOptions) {
    this.cache = options.cache;
    this.bufferedAmountLowThreshold =
      options.bufferedAmountLowThreshold ??
      this.bufferedAmountLowThreshold;
    this.info = options.info ?? null;
  }

  addEventListener<K extends keyof FileTransfererEventMap>(
    eventName: K,
    handler: EventHandler<FileTransfererEventMap[K]>,
    options?: boolean | AddEventListenerOptions,
  ): void {
    return this.eventEmitter.addEventListener(
      eventName,
      handler,
      options,
    );
  }
  removeEventListener<
    K extends keyof FileTransfererEventMap,
  >(
    eventName: K,
    handler: EventHandler<FileTransfererEventMap[K]>,
    options?: boolean | EventListenerOptions,
  ): void {
    return this.eventEmitter.removeEventListener(
      eventName,
      handler,
      options,
    );
  }

  protected dispatchEvent<
    K extends keyof FileTransfererEventMap,
  >(eventName: K, event: FileTransfererEventMap[K]) {
    return this.eventEmitter.dispatchEvent(
      eventName,
      event,
    );
  }

  protected abstract handleReceiveMessage(
    data: string | ArrayBuffer | Blob,
  ): void;

  public addChannel(channel: RTCDataChannel) {
    const onClose = () => {
      channel.onmessage = null;
      const index = this.channels.findIndex(
        (c) => c.label === channel.label,
      );
      if (index !== -1) {
        this.channels.splice(index, 1);
      }
      if (!this.isComplete && this.channels.length === 0) {
        this.dispatchEvent(
          "error",
          Error(`connection is closed`),
        );
      }
    };
    channel.addEventListener("close", onClose, {
      signal: this.controller.signal,
      once: true,
    });

    channel.addEventListener("error", onClose, {
      signal: this.controller.signal,
      once: true,
    });

    channel.onmessage = (ev) =>
      this.handleReceiveMessage(ev.data);
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold =
      this.bufferedAmountLowThreshold;

    if (this.channels.length === 0) {
      if (channel.readyState === "open") {
        this.dispatchEvent("ready", undefined);
      } else {
        const controller = new AbortController();
        channel.addEventListener(
          "open",
          () => {
            controller.abort();
            this.dispatchEvent("ready", undefined);
          },
          {
            signal: controller.signal,
            once: true,
          },
        );
        channel.addEventListener(
          "close",
          () => {
            controller.abort();
            this.dispatchEvent(
              "error",
              new Error("connection is closed"),
            );
          },
          {
            signal: controller.signal,
            once: true,
          },
        );
      }
    }
    this.channels.push(channel);
  }

  protected async waitBufferedAmountLowThreshold(
    bufferedAmountLowThreshold: number = 0,
  ) {
    return Promise.all(
      this.channels.map((channel) =>
        waitBufferedAmountLowThreshold(
          channel,
          bufferedAmountLowThreshold,
        ),
      ),
    );
  }

  protected async getAnyAvailableChannel(
    bufferedAmountLowThreshold: number = this
      .bufferedAmountLowThreshold,
  ): Promise<RTCDataChannel> {
    if (this.channels.length === 0) {
      throw new Error("no channel");
    }
    const [error, channel] = await catchErrorAsync(
      Promise.any(
        this.channels.map((channel) =>
          waitBufferedAmountLowThreshold(
            channel,
            bufferedAmountLowThreshold,
          ),
        ),
      ).catch(() => {
        throw new Error(
          "Can not get any available channel",
        );
      }),
    );
    if (error) {
      this.dispatchEvent("error", error);
      throw error;
    }
    return channel;
  }

  public async pause(notify: boolean = false) {
    if (this.closed) return;
    if (notify) {
      const [error, channel] = await catchErrorAsync(
        this.getAnyAvailableChannel(),
      );
      if (error) {
        return this.close();
      }
      channel.send(
        JSON.stringify({
          type: "pause",
        } satisfies PauseMessage),
      );
      await waitBufferedAmountLowThreshold(channel, 0);
    }
    this.close();
  }

  public close() {
    if (this.closed) return;
    this.closed = true;

    if (this.isComplete) {
      this.dispatchEvent("complete", undefined);
    } else {
      this.dispatchEvent("close", undefined);
    }
    this.unzipWorker?.terminate();
    this.compressWorker?.terminate();
    this.timer && window.clearInterval(this.timer);
    this.controller.abort();
  }
}

