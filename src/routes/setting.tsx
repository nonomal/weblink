import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js";
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
import { reconcile } from "solid-js/store";
import { LocaleSelector, t } from "@/i18n";
import {
  TurnServerOptions,
  appOptions,
  setAppOptions,
  CompressionLevel,
  getDefaultAppOptions,
  backgroundImage,
  defaultWebsocketUrl,
  parseTurnServers,
  stringifyTurnServers,
} from "@/options";
import createAboutDialog from "@/components/about-dialog";
import { Button } from "@/components/ui/button";
import {
  IconClose,
  IconDelete,
  IconExpandAll,
  IconUploadFile,
  IconInfo,
} from "@/components/icons";
import { Separator } from "@/components/ui/seprartor";
import { createDialog } from "@/components/dialogs/dialog";
import { toast } from "solid-sonner";
import { Input } from "@/components/ui/input";
import { cacheManager } from "@/libs/services/cache-serivce";
import { v4 } from "uuid";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ComponentProps } from "solid-js";
import { checkIceServerAvailability } from "@/libs/core/utils/turn";
import { createElementSize } from "@solid-primitives/resize-observer";
import DropArea from "@/components/drop-area";
import { catchErrorAsync } from "@/libs/catch";
import { cn } from "@/libs/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Settings() {
  const { open, Component: AboutDialogComponent } =
    createAboutDialog();
  const {
    open: openResetOptionsDialog,
    Component: ResetOptionsDialogComponent,
  } = createResetOptionsDialog();
  const {
    open: openClearServiceWorkerCacheDialog,
    Component: ClearServiceWorkerCacheDialogComponent,
  } = createClearServiceWorkerCacheDialog();
  const [imageHole, setImageHole] =
    createSignal<HTMLElement | null>(null);
  const size = createElementSize(imageHole);

  const radius = createMemo(() => {
    return getComputedStyle(
      document.querySelector(":root") as Element,
    ).getPropertyValue("--radius");
  });

  const turnServersValue = createMemo(() => {
    return stringifyTurnServers(appOptions.servers.turns);
  });

  return (
    <>
      <AboutDialogComponent />
      <ResetOptionsDialogComponent />
      <ClearServiceWorkerCacheDialogComponent />
      <div
        class="bg-background/80 relative container px-4 backdrop-blur
          [mask:url(#bg-image-mask)]"
      >
        <svg width="0" height="0">
          <defs>
            <mask id="bg-image-mask">
              <rect
                x="0"
                y="0"
                width="100vw"
                height="10000000000000000"
                fill="white"
              />
              <Show when={backgroundImage()}>
                <rect
                  rx={radius()}
                  ry={radius()}
                  x={imageHole()?.offsetLeft ?? 0}
                  y={imageHole()?.offsetTop ?? 0}
                  width={size?.width ?? 0}
                  height={size?.height ?? 0}
                  fill="black"
                />
              </Show>
            </mask>
          </defs>
        </svg>
        <div
          class="columns-1 space-y-4 [column-gap:2rem] py-4
            [column-rule:1px_solid_hsl(var(--border))] lg:columns-2
            [&>*]:break-inside-avoid-column"
        >
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
              <DropArea
                ref={setImageHole}
                as="label"
                class="relative w-full hover:cursor-pointer"
                overlay={(event) => {
                  const isFile =
                    event?.dataTransfer?.types.includes(
                      "Files",
                    );

                  if (event) {
                    if (!isFile) {
                      event.dataTransfer!.dropEffect =
                        "none";
                    } else {
                      event.dataTransfer!.dropEffect =
                        "move";
                    }
                  }
                  return (
                    <div
                      class="text-muted-foreground/50 pointer-events-none absolute
                        inset-0 flex items-center justify-center text-sm"
                    >
                      {event ? (
                        isFile ? (
                          <IconUploadFile class="size-12" />
                        ) : (
                          <IconClose class="size-12" />
                        )
                      ) : (
                        t(
                          "setting.appearance.background_image.click_to_select",
                        )
                      )}
                    </div>
                  );
                }}
                onDrop={async (ev) => {
                  ev.preventDefault();
                  if (!ev.dataTransfer) return;
                  for (const file of ev.dataTransfer
                    .files) {
                    if (file.type.startsWith("image/")) {
                      const id = v4();
                      const cache =
                        await cacheManager.createCache(id);
                      cache.setInfo({
                        fileName: file.name,
                        fileSize: file.size,
                        mimetype: file.type,
                        lastModified: file.lastModified,
                        chunkSize: 1024 * 1024,
                        file: file,
                      });
                      setAppOptions("backgroundImage", id);
                      break;
                    }
                  }
                }}
              >
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

                <div
                  class="bg-muted h-24 content-center rounded-lg text-center text-sm
                    opacity-1 md:h-32"
                />
              </DropArea>

              <Button
                variant="destructive"
                class="gap-1 text-nowrap"
                disabled={!backgroundImage()}
                onClick={() => {
                  setAppOptions(
                    "backgroundImage",
                    undefined!,
                  );
                }}
              >
                <IconDelete class="size-4" />
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
            disabled={!backgroundImage()}
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

          <h3 id="connection" class="h3">
            {t("setting.connection.title")}
          </h3>

          <div class="flex flex-col gap-2">
            <Switch
              disabled={clientProfile.initalJoin}
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
              class="scrollbar-thin resize-none overflow-x-auto text-nowrap"
              placeholder="stun:stun.l.google.com:19302"
              ref={(ref) => {
                createEffect(() => {
                  textareaAutoResize(ref, () =>
                    appOptions.servers.stuns.toString(),
                  );
                });
              }}
              value={
                appOptions.servers.stuns.join("\n") +
                (appOptions.servers.stuns ? "\n" : "")
              }
              onChange={(ev) => {
                const value = ev.currentTarget.value
                  .trim()
                  .split("\n")
                  .filter((v) => v.trim() !== "");
                setAppOptions("servers", "stuns", value);
              }}
            />
            <p class="muted">
              {t(
                "setting.connection.stun_servers.description",
              )}
            </p>
            <div class="flex gap-2 self-end">
              <Show
                when={
                  import.meta.env.VITE_STUN_SERVERS &&
                  import.meta.env.VITE_STUN_SERVERS !==
                    appOptions.servers.stuns.join(",")
                }
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    setAppOptions(
                      "servers",
                      "stuns",
                      getDefaultAppOptions().servers.stuns,
                    );
                  }}
                >
                  {t("common.action.reset")}
                </Button>
              </Show>
              <Show
                when={
                  appOptions.servers.stuns.length > 0 &&
                  appOptions.servers.stuns
                }
              >
                {(stuns) => {
                  const [disabled, setDisabled] =
                    createSignal(false);
                  return (
                    <Button
                      variant="outline"
                      disabled={disabled()}
                      onClick={async () => {
                        setDisabled(true);
                        const results: {
                          server: string;
                          msg: string;
                        }[] = [];

                        const promises: Promise<void>[] =
                          [];

                        for (const stun of stuns()) {
                          promises.push(
                            checkIceServerAvailability(
                              {
                                urls: [stun],
                              },
                              {
                                iceTransportPolicy: "all",
                                candidateType: "srflx",
                              },
                            )
                              .then((isAvailable) => {
                                results.push({
                                  server: stun,
                                  msg: isAvailable
                                    ? "available"
                                    : "unavailable",
                                });
                              })
                              .catch((err) => {
                                results.push({
                                  server: stun,
                                  msg: err.message,
                                });
                              }),
                          );
                        }

                        await Promise.all(promises);
                        toast.info(
                          <div class="flex flex-col gap-2 text-xs">
                            <For each={results}>
                              {(result) => (
                                <p
                                  class={cn(
                                    "space-x-1",
                                    result.msg ===
                                      "available"
                                      ? "text-success-foreground"
                                      : "text-error-foreground",
                                  )}
                                >
                                  <span>
                                    {result.server}:
                                  </span>
                                  <span>{result.msg}</span>
                                </p>
                              )}
                            </For>
                          </div>,
                        );
                        setDisabled(false);
                      }}
                    >
                      {t(
                        "common.action.check_availability",
                      )}
                    </Button>
                  );
                }}
              </Show>
            </div>
          </label>
          <label class="flex flex-col gap-2">
            <Label>
              {t("setting.connection.turn_servers.title")}
            </Label>
            <Textarea
              class="scrollbar-thin resize-none overflow-x-auto text-nowrap"
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
                "turn:turn1.example.com:3478|user1|pass1|longterm\nturns:turn2.example.com:5349|user2|pass2|hmac\nname|TURN_TOKEN_ID|API_TOKEN|cloudflare"
              }
              value={
                turnServersValue() +
                (turnServersValue() ? "\n" : "")
              }
              onChange={(ev) => {
                try {
                  const turns = parseTurnServers(
                    ev.currentTarget.value.trim(),
                  );

                  setAppOptions(
                    "servers",
                    "turns",
                    reconcile(turns),
                  );
                } catch (error) {
                  if (error instanceof Error) {
                    toast.error(error.message);
                  } else {
                    toast.error("unknown error");
                  }
                }
              }}
            />
            <p class="muted">
              {t(
                "setting.connection.turn_servers.description",
              )}
            </p>
            <div class="flex gap-2 self-end">
              <Show
                when={
                  import.meta.env.VITE_TURN_SERVERS &&
                  import.meta.env.VITE_TURN_SERVERS !==
                    turnServersValue().split("\n").join(",")
                }
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    setAppOptions(
                      "servers",
                      "turns",
                      getDefaultAppOptions().servers.turns,
                    );
                  }}
                >
                  {t("common.action.reset")}
                </Button>
              </Show>
              <Show
                when={
                  appOptions.servers.turns.length > 0 &&
                  appOptions.servers.turns
                }
              >
                {(turns) => {
                  const [disabled, setDisabled] =
                    createSignal(false);
                  return (
                    <Show when={turns().length > 0}>
                      <Button
                        variant="outline"
                        disabled={disabled()}
                        onClick={async () => {
                          setDisabled(true);
                          const results: {
                            server: string;
                            msg: string;
                          }[] = [];

                          const promises: Promise<void>[] =
                            [];

                          for (const turn of turns()) {
                            const [error, server] =
                              await catchErrorAsync(
                                parseTurnServer(turn),
                              );
                            if (error) {
                              results.push({
                                server: turn.url,
                                msg: error.message,
                              });
                              continue;
                            }

                            promises.push(
                              checkIceServerAvailability(
                                server,
                                {
                                  iceTransportPolicy:
                                    "relay",
                                },
                              )
                                .then((isAvailable) => {
                                  results.push({
                                    server: turn.url,
                                    msg: isAvailable
                                      ? "available"
                                      : "unavailable",
                                  });
                                })
                                .catch((error) => {
                                  results.push({
                                    server: turn.url,
                                    msg: error.message,
                                  });
                                }),
                            );
                          }

                          await Promise.all(
                            promises,
                          ).finally(() => {
                            setDisabled(false);
                          });

                          toast.info(
                            <div class="flex flex-col gap-2 text-xs">
                              <For each={results}>
                                {(result) => (
                                  <p
                                    class={cn(
                                      "space-x-1",
                                      result.msg ===
                                        "available"
                                        ? "text-success-foreground"
                                        : "text-error-foreground",
                                    )}
                                  >
                                    <span>
                                      {result.server}:
                                    </span>
                                    <span>
                                      {result.msg}
                                    </span>
                                  </p>
                                )}
                              </For>
                            </div>,
                          );
                        }}
                      >
                        {t(
                          "common.action.check_availability",
                        )}
                      </Button>
                    </Show>
                  );
                }}
              </Show>
            </div>
          </label>
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
                  "setting.connection.share_servers_with_others.title",
                )}
              </SwitchLabel>
              <SwitchControl>
                <SwitchThumb />
              </SwitchControl>
            </Switch>
            <p class="muted">
              {t(
                "setting.connection.share_servers_with_others.description",
              )}
            </p>
          </div>
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
                  defaultWebsocketUrl
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
                            defaultWebsocketUrl,
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
              disabled={!navigator.clipboard}
              class="flex items-center justify-between"
              checked={appOptions.enableClipboard}
              onChange={(isChecked) =>
                setAppOptions("enableClipboard", isChecked)
              }
            >
              <SwitchLabel>
                {t("setting.sender.enable_clipboard.title")}
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
            <Show when={!navigator.clipboard}>
              <p class="text-destructive-foreground text-xs">
                {t(
                  "setting.sender.enable_clipboard.unsupported",
                )}
              </p>
            </Show>
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

          {/* <MediaSetting /> */}
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
              <h4 id="advanced-connection" class="h4">
                {t(
                  "setting.advanced_settings.advanced_connection.title",
                )}
              </h4>
              <div class="flex flex-col gap-2">
                <Switch
                  class="flex items-center justify-between"
                  checked={appOptions.relayOnly}
                  disabled={
                    appOptions.servers.turns.length === 0
                  }
                  onChange={(isChecked) =>
                    setAppOptions("relayOnly", isChecked)
                  }
                >
                  <SwitchLabel>
                    {t(
                      "setting.advanced_settings.advanced_connection.relay_only.title",
                    )}
                  </SwitchLabel>
                  <SwitchControl>
                    <SwitchThumb />
                  </SwitchControl>
                </Switch>
                <p class="muted">
                  {t(
                    "setting.advanced_settings.advanced_connection.relay_only.description",
                  )}
                </p>
              </div>
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
                minValue={Math.max(
                  appOptions.blockSize,
                  128 * 1024,
                )}
                maxValue={10 * 1024 * 1024}
                step={128 * 1024}
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
                maxValue={192 * 1024}
                step={16 * 1024}
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
                  minValue={128 * 1024}
                  maxValue={150 * 1024 * 1024}
                  step={128 * 1024}
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
                <Label>
                  {t(
                    "setting.advanced_settings.stream.degradation_preference.title",
                  )}
                </Label>
                <Select
                  value={appOptions.degradationPreference}
                  onChange={(value) => {
                    setAppOptions(
                      "degradationPreference",
                      value ?? "balanced",
                    );
                  }}
                  options={[
                    "balanced",
                    "maintain-framerate",
                    "maintain-resolution",
                  ]}
                  itemComponent={(props) => (
                    <SelectItem item={props.item}>
                      {props.item.rawValue}
                    </SelectItem>
                  )}
                >
                  <SelectTrigger>
                    <SelectValue<RTCDegradationPreference>>
                      {(state) => state.selectedOption()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>
                <p class="muted">
                  {t(
                    "setting.advanced_settings.stream.degradation_preference.description",
                  )}
                </p>
              </label>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
          <div class="flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                const { result } =
                  await openResetOptionsDialog();
                if (!result) {
                  return;
                }
                setAppOptions(getDefaultAppOptions());
                toast.success(
                  t(
                    "common.notification.reset_options_success",
                  ),
                );
              }}
              class="gap-1"
            >
              <IconDelete class="size-4" />
              {t("setting.about.reset_options")}
            </Button>

            <Show
              when={
                typeof window !== "undefined" &&
                "caches" in window &&
                "serviceWorker" in navigator
              }
            >
              <Button
                variant="destructive"
                class="gap-1"
                onClick={async () => {
                  const { result } =
                    await openClearServiceWorkerCacheDialog();
                  if (!result) {
                    return;
                  }

                  try {
                    await window.caches
                      .keys()
                      .then((keys) => {
                        return Promise.all(
                          keys.map((key) => {
                            return window.caches.delete(
                              key,
                            );
                          }),
                        );
                      });
                    await navigator.serviceWorker
                      .getRegistrations()
                      .then((registrations) => {
                        return Promise.all(
                          registrations.map(
                            (registration) => {
                              return registration.unregister();
                            },
                          ),
                        );
                      });
                    toast.success(
                      t(
                        "common.notification.clear_cache_success",
                      ),
                    );
                    if (result.reload) {
                      window.location.reload();
                    }
                  } catch (error) {
                    if (error instanceof Error) {
                      toast.error(
                        t(
                          "common.notification.clear_cache_failed",
                          { error: error.message },
                        ),
                      );
                    } else {
                      toast.error(
                        t(
                          "common.notification.unknown_error",
                        ),
                      );
                    }
                  }
                }}
              >
                <IconDelete class="size-4" />
                {t(
                  "setting.about.clear_service_worker_cache",
                )}
              </Button>
            </Show>

            <Button onClick={() => open()} class="gap-1">
              <IconInfo class="size-4" />
              {t("setting.about.title")}
            </Button>
          </div>
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

const createClearServiceWorkerCacheDialog = () => {
  const [reload, setReload] = createSignal(true);
  const { open, close, submit, Component } = createDialog<{
    reload: boolean;
  }>({
    title: () =>
      t("common.clear_service_worker_cache_dialog.title"),
    description: () =>
      t(
        "common.clear_service_worker_cache_dialog.description",
      ),
    content: () => (
      <>
        <p>
          {t(
            "common.clear_service_worker_cache_dialog.content",
          )}
        </p>
        <p>
          <Switch
            class="flex items-center justify-between text-sm"
            checked={reload()}
            onChange={(isChecked) => setReload(isChecked)}
          >
            <SwitchLabel>
              {t(
                "common.clear_service_worker_cache_dialog.reload",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </p>
      </>
    ),
    cancel: (
      <Button onClick={() => close()}>
        {t("common.action.cancel")}
      </Button>
    ),
    confirm: (
      <Button
        variant="destructive"
        onClick={() =>
          submit({
            reload: reload(),
          })
        }
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
