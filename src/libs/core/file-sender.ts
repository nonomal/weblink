import { FileTransferBase } from "./file-transfer-base";
import {
  TransferMode,
  type CompleteMessage,
  type FileTransfererOptions,
  type TransferMessage,
} from "./file-transferer";
import type { FileMetaData } from "../cache";
import { getTotalChunkCount } from "../cache/chunk-cache";
import {
  type ChunkRange,
  getLastIndex,
  getRangesLength,
  getSubRanges,
  mergeRanges,
  rangesIterator,
} from "../utils/range";
import type { RequestFileMessage } from "./message";
import { buildPacket } from "./utils/packet";

import CompressWorker from "@/libs/workers/chunk-compress?worker";
import type { CompressionLevel } from "@/options";
import { catchError, catchErrorSync } from "../catch";

interface SendData {
  indexes: Set<number>;
}

export class FileSender extends FileTransferBase {
  readonly mode: TransferMode = TransferMode.Send;
  private sendData?: SendData;
  private initialized: boolean = false;
  private blockSize = 128 * 1024;
  private compressionLevel: CompressionLevel = 6;

  constructor(options: FileTransfererOptions) {
    super(options);
    this.blockSize = options.blockSize ?? this.blockSize;
    this.compressionLevel =
      options.compressionLevel ?? this.compressionLevel;
  }

  private updateProgress() {
    const info = this.info;
    if (!info) {
      return;
    }
    if (!this.sendData) {
      console.error(
        `can not update progress, sendData is null`,
      );
      return;
    }
    const sendIndexes = Array.from(this.sendData.indexes);

    const ranges = mergeRanges(sendIndexes);

    this.dispatchEvent("progress", {
      total: info.fileSize,
      received: getRequestContentSize(info, ranges),
    });
  }

  public async initialize() {
    if (this.initialized) {
      console.warn(
        `transfer ${this.cache.id} is already initialized`,
      );
    }
    this.initialized = true;

    if (!this.info) {
      this.info = await this.cache.getInfo();
    } else {
      this.cache.setInfo(this.info);
    }

    if (!this.info) {
      throw Error(
        "transfer file info is not set correctly",
      );
    }

    this.sendData = {
      indexes: new Set(),
    };

    this.updateProgress();
    if (this.channels.length > 0) {
      this.dispatchEvent("ready", undefined);
    }
  }

  public async setSendStatus(message: RequestFileMessage) {
    if (!this.sendData) {
      console.error(
        `can not set send status, sendData is null`,
      );
      return;
    }
    const info = this.info;
    if (!info) {
      console.error(
        `can not set send status, info is null`,
      );
      return;
    }
    const chunkLength = getTotalChunkCount(info);
    if (message.ranges) {
      for (const index of rangesIterator(
        getSubRanges(chunkLength, message.ranges),
      )) {
        this.sendData.indexes.add(index);
      }
    }

    this.updateProgress();
  }

  public async sendFile(ranges?: ChunkRange[]): Promise<void> {
    if (this.closed) {
      throw new Error("transferer is closed");
    }

    if (!this.sendData) {
      throw new Error(
        "file transferer is not initialized, can not send file",
      );
    }

    const info = this.info;
    if (!info) {
      throw new Error(
        "cache data is incomplete, can not send file",
      );
    }

    const totalChunks = getTotalChunkCount(info);

    let transferRange = ranges;
    console.log(`sended ranges`, transferRange);
    if (!transferRange) {
      if (totalChunks !== 0) {
        transferRange = [[0, totalChunks - 1]];
      } else {
        transferRange = [];
      }
    }
    console.log(
      `staring to send ${info.fileName}, size: ${info.fileSize}, range:`,
      transferRange,
    );

    const spliteToBlock = async (
      chunkIndex: number,
      compressedChunk: Uint8Array,
    ) => {
      const totalBlocks = Math.ceil(
        compressedChunk.byteLength / this.blockSize,
      );

      for (
        let blockIndex = 0;
        blockIndex < totalBlocks;
        blockIndex++
      ) {
        const offset = blockIndex * this.blockSize;
        const isLastBlock = blockIndex === totalBlocks - 1;
        const end = Math.min(
          offset + this.blockSize,
          compressedChunk.byteLength,
        );
        const blockData = compressedChunk.slice(offset, end);

        const packet = buildPacket(
          chunkIndex,
          blockIndex,
          isLastBlock,
          blockData.buffer,
        );

        const [error, channel] = await catchError(
          this.getAnyAvailableChannel(),
        );
        if (error) {
          return this.close();
        }

        const [err] = catchErrorSync(() => channel.send(packet));
        if (err) {
          if (this.closed) return;
          console.error(err);
          this.close();
        }
      }

      this.sendData?.indexes.add(chunkIndex);

      this.updateProgress();
    };
    let queue = Promise.resolve();
    function enqueueTask(task: () => Promise<void>) {
      queue = queue.then(() => task());
    }

    const compressWorker = new CompressWorker();

    compressWorker.onmessage = (ev) => {
      const { data, error, context } = ev.data;
      if (error) {
        console.error(error);
        return;
      }
      const chunkIndex = context?.chunkIndex;
      if (chunkIndex === undefined) {
        console.error(
          `can not store chunk, chunkIndex is null`,
        );
        return;
      }
      enqueueTask(() => spliteToBlock(chunkIndex, data));
    };

    this.compressWorker = compressWorker;

    for (const chunkIndex of rangesIterator(transferRange)) {
      const chunk = await this.cache.getChunk(chunkIndex);
      if (chunk) {
        compressWorker.postMessage({
          data: new Uint8Array(chunk),
          option: {
            level: this.compressionLevel,
          },
          context: {
            chunkIndex,
          },
        });
      } else {
        console.warn(`can not get chunk ${chunkIndex}`);
      }
    }
    await queue;

    const [waitError] = await catchError(
      this.waitBufferedAmountLowThreshold(0),
    );
    if (waitError) {
      return this.close();
    }
    const [error, channel] = await catchError(
      this.getAnyAvailableChannel(),
    );
    if (error) {
      return this.close();
    }
    channel.send(
      JSON.stringify({
        type: "complete",
      } satisfies CompleteMessage),
    );
  }

  protected handleReceiveMessage(data: string | ArrayBuffer | Blob) {
    try {
      console.log(`sender get message`, data);
      if (typeof data !== "string") return;
      const message = JSON.parse(data) as TransferMessage;

      if (message.type === "request-content") {
        if (this.sendData) {
          for (const index of rangesIterator(message.ranges)) {
            this.sendData.indexes.delete(index);
          }

          this.updateProgress();
        }
        this.sendFile(message.ranges);
      } else if (message.type === "complete") {
        this.isComplete = true;
        this.close();
      } else if (message.type === "pause") {
        this.pause(false);
      }
    } catch (error) {
      if (error instanceof Error)
        this.dispatchEvent("error", error as Error);
      console.error(error);
    }
  }
}

function getRequestContentSize(
  info: FileMetaData,
  ranges: ChunkRange[],
) {
  if (!info.chunkSize) {
    throw new Error("chunkSize is not found");
  }
  let requestBytes = getRangesLength(ranges) * info.chunkSize;
  const lastRangeIndex = getLastIndex(ranges);
  const lastChunkIndex = getTotalChunkCount(info) - 1;
  if (lastRangeIndex === lastChunkIndex) {
    requestBytes =
      requestBytes -
      info.chunkSize +
      (info.fileSize % info.chunkSize);
  }
  return requestBytes;
}
