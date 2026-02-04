import {
  TransferMode,
  type FileTransferer,
} from "../core/file-transferer";
import { FileReceiver } from "../core/file-receiver";
import { FileSender } from "../core/file-sender";
import { FileID } from "../core/type";
import { ChunkCache } from "../cache/chunk-cache";
import { FileMetaData } from "../cache";
import { appState, setAppState } from "@/libs/state/app-state";

class TransfererFactory {
  readonly transferers: Record<FileID, FileTransferer> =
    appState.transfer.transferers;
  private channels: Record<FileID, RTCDataChannel[]> = {};

  getTransferer(id: FileID) {
    if (this.transferers[id]) {
      return this.transferers[id];
    }

    return null;
  }

  addChannel(fileId: FileID, channel: RTCDataChannel) {
    const transfer = this.transferers[fileId];
    if (transfer) {
      transfer.addChannel(channel);
    } else {
      this.channels[fileId] ??= [];
      this.channels[fileId].push(channel);
    }
  }

  destroyTransfer(id: FileID) {
    const transferer = this.transferers[id];
    if (!transferer) {
      console.log(`transferer ${id} not exist`);
      return;
    }

    transferer.close();
    setAppState("transfer", "transferers", id, undefined!);
  }

  createTransfer(cache: ChunkCache): FileReceiver;
  createTransfer(
    cache: ChunkCache,
    mode: TransferMode.Receive,
    info?: FileMetaData,
  ): FileReceiver;
  createTransfer(
    cache: ChunkCache,
    mode: TransferMode.Send,
    info?: FileMetaData,
  ): FileSender;
  createTransfer(
    cache: ChunkCache,
    mode: TransferMode = TransferMode.Receive,
    info?: FileMetaData,
  ) {
    const fileId = cache.id;
    const tf = this.getTransferer(fileId);
    if (tf) {
      this.destroyTransfer(tf.id);
    }

    const transferer =
      mode === TransferMode.Send
        ? new FileSender({
            cache,
            info,
            bufferedAmountLowThreshold:
              appState.options.bufferedAmountLowThreshold,
            blockSize: appState.options.blockSize,
            compressionLevel: appState.options.compressionLevel,
          })
        : new FileReceiver({
            cache,
            info,
            bufferedAmountLowThreshold:
              appState.options.bufferedAmountLowThreshold,
          });

    const flushInterval = setInterval(() => {
      cache.flush();
    }, 1000);

    const controller = new AbortController();

    transferer.addEventListener(
      "complete",
      async () => {
        clearInterval(flushInterval);
        if (transferer.mode === TransferMode.Receive) {
          await cache.flush();
          cache.getFile();
        } else {
          if (appState.options.automaticCacheDeletion)
            cache.cleanup();
        }
        this.destroyTransfer(transferer.id);

        controller.abort();
      },
      { once: true, signal: controller.signal },
    );

    transferer.addEventListener(
      "error",
      async (event) => {
        console.error(event.detail);
        clearInterval(flushInterval);
        this.destroyTransfer(transferer.id);
        if (transferer.mode === TransferMode.Receive) {
          cache.flush();
        }
      },
      {
        once: true,
        signal: controller.signal,
      },
    );

    transferer.addEventListener(
      "close",
      () => {
        controller.abort();
        clearInterval(flushInterval);
        for (const channel of transferer.channels) {
          channel.close();
        }
        this.destroyTransfer(transferer.id);
      },
      {
        once: true,
        signal: controller.signal,
      },
    );

    transferer.addEventListener(
      "ready",
      () => {
        const channels = this.channels[fileId];
        if (channels) {
          for (const channel of channels) {
            transferer.addChannel(channel);
          }
          this.channels[fileId] = [];
        }
      },
      {
        once: true,
        signal: controller.signal,
      },
    );

    setAppState(
      "transfer",
      "transferers",
      fileId,
      transferer,
    );
    return transferer;
  }
}

export let transferManager: TransfererFactory;

export function createTransferManager() {
  if (!transferManager) {
    transferManager = new TransfererFactory();
  }
  return transferManager;
}
