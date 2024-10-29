import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  Show,
} from "solid-js";

import { optional } from "@/libs/core/utils/optional";
import {
  Switch,
  SwitchControl,
  SwitchLabel,
  SwitchThumb,
} from "@/components/ui/switch";
import {
  clientProfile,
  parseTurnServer,
  setClientProfile,
} from "@/libs/core/store";
import {
  createCameras,
  createMicrophones,
  createSpeakers,
} from "@solid-primitives/devices";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  localStream,
  setDisplayStream,
} from "@/libs/stream";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Slider,
  SliderFill,
  SliderLabel,
  SliderThumb,
  SliderTrack,
  SliderValueLabel,
} from "@/components/ui/slider";
import {
  formatBitSize,
  formatBtyeSize,
} from "@/libs/utils/format-filesize";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { textareaAutoResize } from "@/libs/hooks/input-resize";
import { createStore, reconcile } from "solid-js/store";
import { LocaleSelector, t } from "@/i18n";
import {
  TurnServerOptions,
  appOptions,
  setAppOptions,
  CompressionLevel,
  getDefaultAppOptions,
  backgroundImage,
} from "@/options";
import createAboutDialog from "@/components/about-dialog";
import { Button } from "@/components/ui/button";
import {
  IconDelete,
  IconExpandAll,
  IconInfo,
} from "@/components/icons";
import { Separator } from "@/components/ui/seprartor";
import { createDialog } from "@/components/dialogs/dialog";
import { toast } from "solid-sonner";
import { Input } from "@/components/ui/input";
import { cacheManager } from "@/libs/services/cache-serivce";
import { v4 } from "uuid";
import { makePersisted } from "@solid-primitives/storage";
import { createPermission } from "@solid-primitives/permission";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ComponentProps } from "solid-js";
import { checkTurnServerAvailability } from "@/libs/core/utils/turn";
type MediaDeviceInfoType = Omit<MediaDeviceInfo, "toJSON">;

export const [devices, setDevices] = makePersisted(
  createStore<{
    camera: MediaDeviceInfoType | null;
    microphone: MediaDeviceInfoType | null;
    speaker: MediaDeviceInfoType | null;
  }>({
    camera: null,
    microphone: null,
    speaker: null,
  }),
  {
    storage: localStorage,
    name: "devices",
  },
);

function parseTurnServers(
  input: string,
): TurnServerOptions[] {
  const lines = input.split("\n");
  const turnServers = lines.map((line) => {
    const parts = line.split("|");
    if (parts.length !== 4)
      throw Error(`config error: ${line}`);
    const [url, username, password, authMethod] = parts.map(
      (part) => part.trim(),
    );
    if (!/^turns?:/.test(url)) {
      throw Error(`URL format error: ${url}`);
    }
    if (
      authMethod !== "longterm" &&
      authMethod !== "hmac"
    ) {
      throw Error(
        `auth method error, should be "longterm" or "hmac": ${authMethod}`,
      );
    }
    return {
      url,
      username,
      password,
      authMethod,
    } satisfies TurnServerOptions;
  });
  return turnServers;
}

function stringifyTurnServers(
  turnServers: TurnServerOptions[],
): string {
  return turnServers
    .map((turn) => {
      return `${turn.url}|${turn.username}|${turn.password}|${turn.authMethod}`;
    })
    .join("\n");
}

export default function Settings() {
  const { open, Component: AboutDialogComponent } =
    createAboutDialog();
  const {
    open: openResetOptionsDialog,
    Component: ResetOptionsDialogComponent,
  } = createResetOptionsDialog();
  return (
    <>
      <AboutDialogComponent />
      <ResetOptionsDialogComponent />
      <div class="container bg-background/80 backdrop-blur">
        <div class="grid gap-4 py-4">
          <h3 id="appearance" class="h3">
            {t("setting.appearance.title")}
          </h3>

          <label class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <Label>
                {t("setting.appearance.theme.title")}
              </Label>

              <div class="ml-auto">
                <ThemeToggle />
              </div>
            </div>
            <p class="muted">
              {t("setting.appearance.theme.description")}
            </p>
          </label>

          <label class="flex flex-col gap-2">
            <Label>
              {t("setting.appearance.language.title")}
            </Label>
            <LocaleSelector />
            <p class="muted">
              {t("setting.appearance.language.description")}
            </p>
          </label>

          <div class="flex flex-col gap-2">
            <Label>
              {t(
                "setting.appearance.background_image.title",
              )}
            </Label>
            <div class="flex w-full flex-col items-end gap-4">
              <label class="w-full hover:cursor-pointer">
                <Input
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={async (ev) => {
                    const file =
                      ev.currentTarget.files?.[0];
                    if (file) {
                      const id = v4();
                      const cache =
                        await cacheManager.createCache(id);
                      cache.setInfo({
                        id,
                        fileName: file.name,
                        fileSize: file.size,
                        mimetype: file.type,
                        lastModified: file.lastModified,
                        chunkSize: 1024 * 1024,
                        file: file,
                      });

                      setAppOptions("backgroundImage", id);
                    }
                  }}
                />
                <Show
                  when={backgroundImage()}
                  fallback={
                    <div
                      class="h-24 place-content-center rounded-md bg-muted text-center
                        text-xs text-muted-foreground md:h-32"
                    >
                      {t(
                        "setting.appearance.background_image.click_to_select",
                      )}
                    </div>
                  }
                >
                  <div class="bg-image h-24 rounded-md md:h-32" />
                </Show>
              </label>
              <Button
                variant="destructive"
                class="text-nowrap"
                disabled={!backgroundImage()}
                onClick={() => {
                  setAppOptions(
                    "backgroundImage",
                    undefined!,
                  );
                }}
              >
                <IconDelete class="mr-2 size-4" />
                {t("common.action.delete")}
              </Button>
            </div>
            <p class="muted">
              {t(
                "setting.appearance.background_image.description",
              )}
            </p>
          </div>

          <Slider
            minValue={0}
            maxValue={1}
            step={0.01}
            defaultValue={[
              1 - appOptions.backgroundImageOpacity,
            ]}
            class="gap-2"
            getValueLabel={({ values }) =>
              `${(values[0] * 100).toFixed(0)}%`
            }
            value={[1 - appOptions.backgroundImageOpacity]}
            onChange={(value) => {
              setAppOptions(
                "backgroundImageOpacity",
                1 - value[0],
              );
            }}
          >
            <div class="flex w-full justify-between">
              <SliderLabel>
                {t(
                  "setting.appearance.background_image_opacity.title",
                )}
              </SliderLabel>
              <SliderValueLabel />
            </div>
            <SliderTrack>
              <SliderFill />
              <SliderThumb />
              <SliderThumb />
            </SliderTrack>
          </Slider>

          <div class="flex flex-col gap-2">
            <Switch
              class="flex items-center justify-between"
              checked={appOptions.shareServersWithOthers}
              onChange={(isChecked) =>
                setAppOptions(
                  "shareServersWithOthers",
                  isChecked,
                )
              }
            >
              <SwitchLabel>
                {t(
                  "setting.appearance.share_servers_with_others.title",
                )}
              </SwitchLabel>
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
            <p class="muted">
              {t(
                "setting.appearance.share_servers_with_others.description",
              )}
            </p>
          </div>

          <h3 id="connection" class="h3">
            {t("setting.connection.title")}
          </h3>
          <div class="flex flex-col gap-2">
            <Switch
              disabled={clientProfile.firstTime}
              class="flex items-center justify-between"
              checked={clientProfile.autoJoin}
              onChange={(isChecked) =>
                setClientProfile("autoJoin", isChecked)
              }
            >
              <SwitchLabel>
                {t("setting.connection.auto_join.title")}
              </SwitchLabel>
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
            <p class="muted">
              {t(
                "setting.connection.auto_join.description",
              )}
            </p>
          </div>
          <label class="flex flex-col gap-2">
            <Label>
              {t("setting.connection.stun_servers.title")}
            </Label>
            <Textarea
              placeholder="stun.l.google.com:19302"
              ref={(ref) => {
                createEffect(() => {
                  textareaAutoResize(ref, () =>
                    appOptions.servers.stuns.toString(),
                  );
                });
              }}
              value={appOptions.servers.stuns.join("\n")}
              onInput={(ev) =>
                setAppOptions(
                  "servers",
                  "stuns",
                  optional(ev.currentTarget.value)?.split(
                    "\n",
                  ) ?? [],
                )
              }
            />
            <p class="muted">
              {t(
                "setting.connection.stun_servers.description",
              )}
            </p>
          </label>
          <label class="flex flex-col gap-2">
            <Label>
              {t("setting.connection.turn_servers.title")}
            </Label>
            <Textarea
              ref={(ref) => {
                createEffect(() => {
                  textareaAutoResize(
                    ref,
                    () =>
                      appOptions.servers.turns?.toString() ??
                      "",
                  );
                });
              }}
              placeholder={
                "turn:turn1.example.com:3478|user1|pass1|longterm\nturns:turn2.example.com:5349|user2|pass2|hmac"
              }
              value={stringifyTurnServers(
                appOptions.servers.turns ?? [],
              )}
              onInput={(ev) =>
                setAppOptions(
                  "servers",
                  "turns",
                  reconcile(
                    parseTurnServers(
                      ev.currentTarget.value,
                    ),
                  ),
                )
              }
            />
            <p class="muted">
              {t(
                "setting.connection.turn_servers.description",
              )}
            </p>
            <Show when={appOptions.servers.turns}>
              {(turns) => {
                const [disabled, setDisabled] =
                  createSignal(false);
                return (
                  <div class="self-end">
                    <Button
                      variant="outline"
                      disabled={disabled()}
                      onClick={async () => {
                        setDisabled(true);
                        const results: {
                          server: string;
                          isAvailable: string;
                        }[] = [];

                        const promises: Promise<void>[] =
                          [];

                        for (const turn of turns()) {
                          const server =
                            await parseTurnServer(turn);
                          if (!server) {
                            results.push({
                              server: turn.url,
                              isAvailable:
                                "invalid turn server",
                            });
                            continue;
                          }
                          promises.push(
                            checkTurnServerAvailability(
                              server,
                            )
                              .then((isAvailable) => {
                                results.push({
                                  server: turn.url,
                                  isAvailable: isAvailable
                                    ? "available"
                                    : "unavailable",
                                });
                              })
                              .catch((error) => {
                                results.push({
                                  server: turn.url,
                                  isAvailable:
                                    error.message,
                                });
                              }),
                          );
                        }

                        await Promise.all(promises).finally(
                          () => {
                            setDisabled(false);
                          },
                        );

                        const resultMessage = results
                          .map(
                            (result) =>
                              `${result.server}: ${result.isAvailable}`,
                          )
                          .join("\n");

                        toast.info(resultMessage);
                      }}
                    >
                      {t(
                        "setting.connection.turn_servers.check_availability",
                      )}
                    </Button>
                  </div>
                );
              }}
            </Show>
          </label>

          <Show
            when={
              import.meta.env.VITE_BACKEND === "WEBSOCKET"
            }
          >
            <label class="flex flex-col gap-2">
              <Label>
                {t(
                  "setting.connection.websocket_url.title",
                )}
              </Label>
              <Input
                value={appOptions.websocketUrl ?? ""}
                onInput={(ev) => {
                  setAppOptions(
                    "websocketUrl",
                    ev.currentTarget.value,
                  );
                }}
              />
              <p class="muted">
                {t(
                  "setting.connection.websocket_url.description",
                )}
              </p>

              <Show
                when={
                  appOptions.websocketUrl !==
                  import.meta.env.VITE_WEBSOCKET_URL
                }
              >
                {(_) => {
                  const [disabled, setDisabled] =
                    createSignal(false);
                  return (
                    <div class="flex gap-2 self-end">
                      <Button
                        variant="destructive"
                        disabled={disabled()}
                        onClick={() => {
                          setAppOptions(
                            "websocketUrl",
                            import.meta.env
                              .VITE_WEBSOCKET_URL,
                          );
                        }}
                      >
                        {t("common.action.reset")}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disabled()}
                        onClick={async () => {
                          setDisabled(true);
                          // change ws:// or wss:// to http:// or https://
                          let message = "";
                          try {
                            const ws = new WebSocket(
                              appOptions.websocketUrl!,
                            );
                            message = await new Promise(
                              (resolve, reject) => {
                                ws.onopen = () =>
                                  resolve("success");
                                ws.onerror = () =>
                                  reject(
                                    new Error("failed"),
                                  );
                              },
                            );
                            ws.close();
                          } catch (error) {
                            if (error instanceof Error) {
                              message = error.message;
                            } else {
                              message = "unknown error";
                            }
                          } finally {
                            setDisabled(false);
                          }
                          toast.info(message);
                        }}
                      >
                        {t("common.action.test")}
                      </Button>
                    </div>
                  );
                }}
              </Show>
            </label>
          </Show>

          <h3 id="sender" class="h3">
            {t("setting.sender.title")}
          </h3>
          <div class="flex flex-col gap-2">
            <Switch
              class="flex items-center justify-between"
              checked={appOptions.enableClipboard}
              onChange={(isChecked) =>
                setAppOptions(
                  "enableClipboard",
                  isChecked,
                )
              }
            >
              <SwitchLabel>
                {t(
                  "setting.sender.enable_clipboard.title",
                )}
              </SwitchLabel>
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
            <p class="muted">
              {t(
                "setting.sender.enable_clipboard.description",
              )}
            </p>
          </div>
          <div class="flex flex-col gap-2">
            <Switch
              class="flex items-center justify-between"
              checked={appOptions.automaticCacheDeletion}
              onChange={(isChecked) =>
                setAppOptions(
                  "automaticCacheDeletion",
                  isChecked,
                )
              }
            >
              <SwitchLabel>
                {t(
                  "setting.sender.automatic_cache_deletion.title",
                )}
              </SwitchLabel>
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
            <p class="muted">
              {t(
                "setting.sender.automatic_cache_deletion.description",
              )}
            </p>
          </div>
          <label class="flex flex-col gap-2">
            <Slider
              minValue={0}
              maxValue={9}
              step={1}
              defaultValue={[appOptions.compressionLevel]}
              getValueLabel={({ values }) =>
                values[0] === 0
                  ? t(
                      "setting.sender.compression_level.no_compression",
                    )
                  : `${values[0]}`
              }
              class="gap-2"
              onChange={(value) => {
                setAppOptions(
                  "compressionLevel",
                  value[0] as CompressionLevel,
                );
              }}
            >
              <div class="flex w-full justify-between">
                <SliderLabel>
                  {t(
                    "setting.sender.compression_level.title",
                  )}
                </SliderLabel>
                <SliderValueLabel />
              </div>
              <SliderTrack>
                <SliderFill />
                <SliderThumb />
                <SliderThumb />
              </SliderTrack>
            </Slider>
            <p class="muted">
              {t(
                "setting.sender.compression_level.description",
              )}
            </p>
          </label>

          <h3 id="receiver" class="h3">
            {t("setting.receiver.title")}
          </h3>
          <div class="flex flex-col gap-2">
            <Switch
              class="flex items-center justify-between"
              checked={appOptions.automaticDownload}
              onChange={(isChecked) =>
                setAppOptions(
                  "automaticDownload",
                  isChecked,
                )
              }
            >
              <SwitchLabel>
                {t(
                  "setting.receiver.automatic_download.title",
                )}
              </SwitchLabel>
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
            <p class="muted">
              {t(
                "setting.receiver.automatic_download.description",
              )}
            </p>
          </div>

          <MediaSetting />
          <Collapsible>
            <CollapsibleTrigger
              as={(props: ComponentProps<"div">) => (
                <div
                  class="flex items-center gap-4 p-2"
                  {...props}
                >
                  <h3 class="h3" id="advanced">
                    {t("setting.advanced_settings.title")}
                  </h3>
                  <Button variant="outline">
                    <IconExpandAll class="size-4" />
                    <span></span>
                  </Button>
                </div>
              )}
            ></CollapsibleTrigger>
            <CollapsibleContent class="flex flex-col gap-2 rounded-md border p-4">
              <h4 id="advanced-sender" class="h4">
                {t(
                  "setting.advanced_settings.advanced_sender.title",
                )}
              </h4>
              <label class="flex flex-col gap-2">
                <Slider
                  minValue={1}
                  maxValue={8}
                  defaultValue={[appOptions.channelsNumber]}
                  class="gap-2"
                  onChange={(value) => {
                    setAppOptions(
                      "channelsNumber",
                      value[0],
                    );
                  }}
                >
                  <div class="flex w-full justify-between">
                    <SliderLabel>
                      {t(
                        "setting.sender.num_channels.title",
                      )}
                    </SliderLabel>
                    <SliderValueLabel />
                  </div>
                  <SliderTrack>
                    <SliderFill />
                    <SliderThumb />
                    <SliderThumb />
                  </SliderTrack>
                </Slider>
                <p class="muted">
                  {t(
                    "setting.sender.num_channels.description",
                  )}
                </p>
              </label>

              <Slider
                minValue={appOptions.blockSize}
                maxValue={1024 * 1024 * 10}
                step={appOptions.blockSize}
                defaultValue={[appOptions.chunkSize]}
                class="gap-2"
                getValueLabel={({ values }) =>
                  formatBtyeSize(values[0], 2)
                }
                onChange={(value) => {
                  setAppOptions("chunkSize", value[0]);
                }}
              >
                <div class="flex w-full justify-between">
                  <SliderLabel>
                    {t("setting.sender.chunk_size.title")}
                  </SliderLabel>
                  <SliderValueLabel />
                </div>
                <SliderTrack>
                  <SliderFill />
                  <SliderThumb />
                  <SliderThumb />
                </SliderTrack>
              </Slider>
              <Slider
                minValue={16 * 1024}
                maxValue={200 * 1024}
                step={1024}
                defaultValue={[appOptions.blockSize]}
                class="gap-2"
                getValueLabel={({ values }) =>
                  formatBtyeSize(values[0], 0)
                }
                onChange={(value) => {
                  setAppOptions("blockSize", value[0]);
                }}
              >
                <div class="flex w-full justify-between">
                  <SliderLabel>
                    {t("setting.sender.block_size.title")}
                  </SliderLabel>
                  <SliderValueLabel />
                </div>
                <SliderTrack>
                  <SliderFill />
                  <SliderThumb />
                  <SliderThumb />
                </SliderTrack>
              </Slider>
              <Slider
                minValue={1024}
                maxValue={1024 * 1024}
                step={1024}
                defaultValue={[
                  appOptions.bufferedAmountLowThreshold,
                ]}
                getValueLabel={({ values }) =>
                  formatBtyeSize(values[0], 2)
                }
                class="gap-2"
                onChange={(value) => {
                  setAppOptions(
                    "bufferedAmountLowThreshold",
                    value[0],
                  );
                }}
              >
                <div class="flex w-full justify-between">
                  <SliderLabel>
                    {t(
                      "setting.sender.max_buffer_amount.title",
                    )}
                  </SliderLabel>
                  <SliderValueLabel />
                </div>
                <SliderTrack>
                  <SliderFill />
                  <SliderThumb />
                  <SliderThumb />
                </SliderTrack>
              </Slider>

              <div class="flex flex-col gap-2">
                <Switch
                  class="flex items-center justify-between"
                  checked={appOptions.ordered}
                  onChange={(isChecked) =>
                    setAppOptions("ordered", isChecked)
                  }
                >
                  <SwitchLabel>
                    {t("setting.sender.ordered.title")}
                  </SwitchLabel>
                  <SwitchControl>
                    <SwitchThumb />
                  </SwitchControl>
                </Switch>
                <p class="muted">
                  {t("setting.sender.ordered.description")}
                </p>
              </div>
              <h4 id="advanced-receiver" class="h4">
                {t(
                  "setting.advanced_settings.advanced_receiver.title",
                )}
              </h4>
              <label class="flex flex-col gap-2">
                <Slider
                  minValue={1}
                  maxValue={128}
                  step={1}
                  defaultValue={[
                    appOptions.maxMomeryCacheSlices,
                  ]}
                  getValueLabel={({ values }) =>
                    `${values[0]} (${formatBtyeSize(values[0] * appOptions.chunkSize, 0)})`
                  }
                  class="gap-2"
                  onChange={(value) => {
                    setAppOptions(
                      "maxMomeryCacheSlices",
                      value[0],
                    );
                  }}
                >
                  <div class="flex w-full justify-between">
                    <SliderLabel>
                      {t(
                        "setting.receiver.max_cached_chunks.title",
                      )}
                    </SliderLabel>
                    <SliderValueLabel />
                  </div>
                  <SliderTrack>
                    <SliderFill />
                    <SliderThumb />
                    <SliderThumb />
                  </SliderTrack>
                </Slider>
                <p class="muted">
                  {t(
                    "setting.receiver.max_cached_chunks.description",
                  )}
                </p>
              </label>
              <h4 id="stream" class="h4">
                {t(
                  "setting.advanced_settings.stream.title",
                )}
              </h4>
              <label class="flex flex-col gap-2">
                <Slider
                  minValue={512 * 1024}
                  maxValue={200 * 1024 * 1024}
                  step={512 * 1024}
                  defaultValue={[
                    appOptions.videoMaxBitrate,
                  ]}
                  getValueLabel={({ values }) =>
                    `${formatBitSize(values[0], 0)}ps`
                  }
                  class="gap-2"
                  onChange={(value) => {
                    setAppOptions(
                      "videoMaxBitrate",
                      value[0],
                    );
                  }}
                >
                  <div class="flex w-full justify-between">
                    <SliderLabel>
                      {t(
                        "setting.advanced_settings.stream.video_max_bitrate.title",
                      )}
                    </SliderLabel>
                    <SliderValueLabel />
                  </div>
                  <SliderTrack>
                    <SliderFill />
                    <SliderThumb />
                    <SliderThumb />
                  </SliderTrack>
                </Slider>
                <p class="muted">
                  {t(
                    "setting.advanced_settings.stream.video_max_bitrate.description",
                  )}
                </p>
              </label>
              <label class="flex flex-col gap-2">
                <Slider
                  minValue={1024}
                  maxValue={512 * 1024}
                  step={1024}
                  defaultValue={[
                    appOptions.audioMaxBitrate,
                  ]}
                  getValueLabel={({ values }) =>
                    `${formatBitSize(values[0], 0)}ps`
                  }
                  class="gap-2"
                  onChange={(value) => {
                    setAppOptions(
                      "audioMaxBitrate",
                      value[0],
                    );
                  }}
                >
                  <div class="flex w-full justify-between">
                    <SliderLabel>
                      {t(
                        "setting.advanced_settings.stream.audio_max_bitrate.title",
                      )}
                    </SliderLabel>
                    <SliderValueLabel />
                  </div>
                  <SliderTrack>
                    <SliderFill />
                    <SliderThumb />
                    <SliderThumb />
                  </SliderTrack>
                </Slider>
                <p class="muted">
                  {t(
                    "setting.advanced_settings.stream.audio_max_bitrate.description",
                  )}
                </p>
              </label>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
          <label class="flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                if (
                  (await openResetOptionsDialog()).result
                ) {
                  setAppOptions(getDefaultAppOptions());
                  toast.success(
                    t(
                      "common.notification.reset_options_success",
                    ),
                  );
                }
              }}
              class="gap-2"
            >
              <IconDelete class="size-4" />
              {t("setting.about.reset_options")}
            </Button>
          </label>

          <label class="flex flex-col gap-2">
            <Button onClick={() => open()} class="gap-2">
              <IconInfo class="size-4" />
              {t("setting.about.title")}
            </Button>
          </label>
        </div>
      </div>
    </>
  );
}

const createResetOptionsDialog = () => {
  const { open, close, submit, Component } = createDialog({
    title: () => t("common.reset_options_dialog.title"),
    description: () =>
      t("common.reset_options_dialog.description"),
    content: () => (
      <p>{t("common.reset_options_dialog.content")}</p>
    ),
    cancel: (
      <Button onClick={() => close()}>
        {t("common.action.cancel")}
      </Button>
    ),
    confirm: (
      <Button
        variant="destructive"
        onClick={() => submit(true)}
      >
        {t("common.action.confirm")}
      </Button>
    ),
  });
  return {
    open,
    Component,
  };
};

const MediaSetting: Component = () => {
  if (!navigator.mediaDevices) {
    return <></>;
  }
  const cameras = createCameras();
  const microphones = createMicrophones();
  const speakers = createSpeakers();

  const availableCameras = createMemo(() =>
    cameras().filter((cam) => cam.deviceId !== ""),
  );
  const availableMicrophones = createMemo(() =>
    microphones().filter((mic) => mic.deviceId !== ""),
  );
  const availableSpeakers = createMemo(() =>
    speakers().filter((speaker) => speaker.deviceId !== ""),
  );

  // const availableDevices = createMemo(() => {
  //   return [
  //     ...availableCameras(),
  //     ...availableMicrophones(),
  //     ...availableSpeakers(),
  //   ];
  // });

  createEffect(() => {
    if (
      !availableCameras().find(
        (cam) => cam.deviceId === devices.camera?.deviceId,
      )
    ) {
      setDevices("camera", availableCameras()[0] ?? null);
    }
    if (
      !availableMicrophones().find(
        (mic) =>
          mic.deviceId === devices.microphone?.deviceId,
      )
    ) {
      setDevices(
        "microphone",
        availableMicrophones()[0] ?? null,
      );
    }
    if (
      !availableSpeakers().find(
        (speaker) =>
          speaker.deviceId === devices.speaker?.deviceId,
      )
    ) {
      setDevices("speaker", availableSpeakers()[0] ?? null);
    }
  });
  const cameraPermission = createPermission("camera");
  const microphonePermission =
    createPermission("microphone");

  return (
    <>
      <h3 id="media" class="h3">
        {t("setting.media.title")}
      </h3>
      <div class="flex flex-col gap-2">
        <Show
          when={
            cameraPermission() === "prompt" ||
            microphonePermission() === "prompt"
          }
          fallback={
            <Show
              when={
                cameraPermission() === "denied" ||
                microphonePermission() === "denied"
              }
            >
              <p class="text-sm text-destructive">
                {t(
                  "setting.media.request_permission.fallback_description",
                )}
              </p>
            </Show>
          }
        >
          <Button
            onClick={() => {
              navigator.mediaDevices
                .getUserMedia({
                  video: true,
                  audio: true,
                })
                .then((stream) => {
                  setDisplayStream(stream);
                })
                .catch((error) => {
                  console.error(error);
                  toast.error(error.message);
                });
            }}
          >
            {t("setting.media.request_permission.title")}
          </Button>
          <p class="muted">
            {t(
              "setting.media.request_permission.description",
            )}
          </p>
        </Show>
      </div>
      <Show when={availableCameras().length !== 0}>
        <label class="flex flex-col gap-2">
          <Label>{t("setting.media.camera.title")}</Label>
          <Select
            defaultValue={devices.camera}
            value={devices.camera}
            onChange={(value) => {
              setDevices("camera", value);
            }}
            options={cameras()}
            optionTextValue="label"
            optionValue="deviceId"
            itemComponent={(props) => (
              <SelectItem
                item={props.item}
                value={props.item.rawValue?.deviceId}
              >
                {props.item.rawValue?.label}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue<MediaDeviceInfoType>>
                {(state) => state.selectedOption().label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </label>
      </Show>
      <Show when={availableMicrophones().length !== 0}>
        <label class="flex flex-col gap-2">
          <Label>
            {t("setting.media.microphone.title")}
          </Label>
          <Select
            value={devices.microphone}
            onChange={(value) => {
              setDevices("microphone", value);
            }}
            options={microphones()}
            optionTextValue="label"
            optionValue="deviceId"
            itemComponent={(props) => (
              <SelectItem item={props.item}>
                {props.item.rawValue?.label}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue<MediaDeviceInfoType>>
                {(state) => state.selectedOption().label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </label>
      </Show>
      <Show when={availableSpeakers().length !== 0}>
        <label class="flex flex-col gap-2">
          <Label>{t("setting.media.speaker.title")}</Label>
          <Select
            value={devices.speaker}
            onChange={(value) => {
              setDevices("speaker", value);
            }}
            options={speakers()}
            optionTextValue="label"
            optionValue="deviceId"
            itemComponent={(props) => (
              <SelectItem item={props.item}>
                {props.item.rawValue?.label}
              </SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue<MediaDeviceInfoType>>
                {(state) => state.selectedOption().label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </label>
      </Show>
      <Show when={localStream()}>
        <video
          class="max-h-64 w-full object-contain"
          muted
          autoplay
          controls
          ref={(ref) => {
            createEffect(() => {
              ref.srcObject = localStream();
            });
          }}
        />
      </Show>
    </>
  );
};
