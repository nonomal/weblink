import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js";
import { createDialog } from "@/components/dialogs/dialog";
import {
  IconMonitor,
  IconSettings,
  IconVideoCam,
} from "@/components/icons";
import {
  Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { createStore } from "solid-js/store";
import { Button } from "@/components/ui/button";
import {
  createSpeakers,
  createMicrophones,
  createCameras,
} from "@/libs/utils/devices";
import { catchErrorAsync } from "@/libs/catch";
import { toast } from "solid-sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createPermission } from "@solid-primitives/permission";
import {
  Switch,
  SwitchControl,
  SwitchLabel,
  SwitchThumb,
} from "@/components/ui/switch";
import { t } from "@/i18n";
import { localStream } from "@/libs/stream";
import { cn } from "@/libs/cn";
import {
  createPresetMicrophoneConstraintsDialog,
  createPresetSpeakerTrackConstraintsDialog,
  createPresetVideoConstraintsDialog,
  microphoneConstraints,
  speakerConstraints,
  videoConstraints,
} from "./track-constaints";
import { makePersisted } from "@solid-primitives/storage";
import { VideoDisplay } from "./video-display";
import { clientProfile } from "@/libs/core/store";

export type MediaDeviceInfoType = {
  label: string;
  deviceId: string;
};

const [devices, setDevices] = createStore<{
  camera: MediaDeviceInfoType | null;
  microphone: MediaDeviceInfoType | null;
  speaker: MediaDeviceInfoType | null;
}>({
  camera: null,
  microphone: null,
  speaker: null,
});

const canGetDisplayMedia =
  "mediaDevices" in navigator &&
  "getDisplayMedia" in navigator.mediaDevices;

const canGetUserMedia =
  "mediaDevices" in navigator &&
  "getUserMedia" in navigator.mediaDevices;

const [enableScreenSpeaker, setEnableScreenSpeaker] =
  makePersisted(createSignal(true), {
    name: "enableScreenSpeaker",
    storage: sessionStorage,
  });
const [enableScreenMicrophone, setEnableScreenMicrophone] =
  makePersisted(createSignal(false), {
    name: "enableScreenMicrophone",
    storage: sessionStorage,
  });

const [enableUserMicrophone, setEnableUserMicrophone] =
  makePersisted(createSignal(true), {
    name: "enableUserMicrophone",
    storage: sessionStorage,
  });
const [enableUserCamera, setEnableUserCamera] =
  makePersisted(createSignal(true), {
    name: "enableUserCamera",
    storage: sessionStorage,
  });

export const createMediaSelectionDialog = () => {
  const cameras = createCameras();
  const microphones = createMicrophones();
  const speakers = createSpeakers();

  const availableCameras = createMemo(() => {
    const cams = cameras()
      .filter((cam) => cam.deviceId !== "")
      .map((cam) => ({
        label: cam.label,
        deviceId: cam.deviceId,
      }));
    return cams;
  });

  const availableSpeakers = createMemo(() => {
    const spks = speakers()
      .filter((spk) => spk.deviceId !== "")
      .map((spk) => ({
        label: spk.label,
        deviceId: spk.deviceId,
      }));

    return spks;
  });

  const availableMicrophones = createMemo(() => {
    const mics = microphones()
      .filter((mic) => mic.deviceId !== "")
      .map((mic) => ({
        label: mic.label,
        deviceId: mic.deviceId,
      }));
    return mics;
  });
  const [selectedTab, setSelectedTab] = createSignal(
    canGetDisplayMedia ? "screen" : "user",
  );

  const [stream, setStream] =
    createSignal<MediaStream | null>(null);

  const cameraPermission = createPermission("camera");
  const microphonePermission =
    createPermission("microphone");

  const canUseScreenSpeaker = createMemo(() => {
    return (
      enableScreenSpeaker() &&
      availableSpeakers().length !== 0
    );
  });
  const canUseScreenMicrophone = createMemo(() => {
    return (
      enableScreenMicrophone() &&
      availableMicrophones().length !== 0 &&
      microphonePermission() === "granted"
    );
  });

  const canUseUserMicrophone = createMemo(() => {
    return (
      enableUserMicrophone() &&
      availableMicrophones().length !== 0 &&
      microphonePermission() === "granted"
    );
  });

  const canUseUserCamera = createMemo(() => {
    return (
      enableUserCamera() &&
      availableCameras().length !== 0 &&
      cameraPermission() === "granted"
    );
  });

  const closeStream = () => {
    stream()
      ?.getTracks()
      .forEach((track) => {
        stream()?.removeTrack(track);
        track.stop();
      });
    setStream(null);
  };
  const openScreen = async (
    enableSpeaker: boolean = true,
    enableMicrophone: boolean = false,
  ) => {
    const [err, local] = await catchErrorAsync(
      navigator.mediaDevices.getDisplayMedia({
        video: {
          deviceId: devices.camera?.deviceId,
          displaySurface: "monitor",
          ...videoConstraints,
        },
        audio:
          enableSpeaker && speakers().length !== 0
            ? {
                deviceId: devices.speaker?.deviceId,
                ...speakerConstraints,
              }
            : false,
      }),
    );
    if (err) {
      toast.error(err.message);
      return;
    }

    local.getAudioTracks().forEach((track) => {
      track.contentHint = "music";
    });

    local.getVideoTracks().forEach((track) => {
      track.contentHint = "motion";
    });

    if (enableMicrophone) {
      const [err, microphoneMedia] = await catchErrorAsync(
        navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: devices.microphone?.deviceId,
            ...microphoneConstraints,
          },
        }),
      );
      if (err) {
        toast.error(err.message);
      } else {
        const microphoneTrack =
          microphoneMedia.getAudioTracks()[0];
        microphoneTrack.contentHint = "speech";
        local.addTrack(microphoneTrack);
      }
    }
    setStream(local);
  };
  const openCamera = async (
    enableCamera: boolean = true,
    enableMicrophone: boolean = true,
  ) => {
    const [err, local] = await catchErrorAsync(
      navigator.mediaDevices.getUserMedia({
        video:
          enableCamera && availableCameras().length !== 0
            ? {
                deviceId: devices.camera?.deviceId,
                ...videoConstraints,
              }
            : undefined,
        audio:
          enableMicrophone &&
          availableMicrophones().length !== 0
            ? {
                deviceId: devices.microphone?.deviceId,
                ...microphoneConstraints,
              }
            : undefined,
      }),
    );
    if (err) {
      toast.error(err.message);
      return;
    }

    local.getAudioTracks().forEach((track) => {
      track.contentHint = "speech";
    });

    local.getVideoTracks().forEach((track) => {
      track.contentHint = "motion";
    });
    setStream(local);
  };

  createEffect(() => {
    stream()
      ?.getTracks()
      .forEach((track) => {
        track.addEventListener("ended", () => {
          track.stop();
          stream()?.removeTrack(track);
          if (stream()?.getTracks().length === 0) {
            setStream(null);
          }
        });
      });
  });

  const {
    open: openMicrophoneConstraintsDialog,
    Component: MicrophoneConstraintsDialog,
  } = createPresetMicrophoneConstraintsDialog();

  const {
    open: openSpeakerConstraintsDialog,
    Component: SpeakerConstraintsDialog,
  } = createPresetSpeakerTrackConstraintsDialog();

  const {
    open: openVideoConstraintsDialog,
    Component: VideoConstraintsDialog,
  } = createPresetVideoConstraintsDialog();

  const requestMicrophonePermission = async () => {
    if (!("mediaDevices" in navigator)) {
      toast.error(
        "Your browser does not support media devices",
      );
      return;
    }
    const [err, local] = await catchErrorAsync(
      navigator.mediaDevices.getUserMedia({
        audio: true,
      }),
    );
    if (err) {
      toast.error(err.message);
      return;
    }
    local.getTracks().forEach((track) => {
      track.stop();
      local?.removeTrack(track);
    });
  };

  const requestCameraPermission = async () => {
    if (!("mediaDevices" in navigator)) {
      toast.error(
        "Your browser does not support media devices",
      );
      return;
    }
    const [err, local] = await catchErrorAsync(
      navigator.mediaDevices.getUserMedia({
        video: true,
      }),
    );
    if (err) {
      toast.error(err.message);
      return;
    }
    local.getTracks().forEach((track) => {
      track.stop();
      local?.removeTrack(track);
    });
  };

  const { open, close, Component, submit } =
    createDialog<MediaStream>({
      title: () => t("common.media_selection_dialog.title"),
      content: () => (
        <Tabs
          value={selectedTab()}
          onChange={(value) => setSelectedTab(value)}
          class="flex flex-col gap-2 overflow-y-auto"
        >
          <MicrophoneConstraintsDialog />
          <SpeakerConstraintsDialog />
          <VideoConstraintsDialog />
          <TabsList>
            <TabsTrigger value="screen" class="gap-1">
              <IconMonitor class="size-4" />
              <span>
                {t("common.media_selection_dialog.screen")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="user" class="gap-1">
              <IconVideoCam class="size-4" />
              <span>
                {t(
                  "common.media_selection_dialog.media_device",
                )}
              </span>
            </TabsTrigger>
            <TabsIndicator />
          </TabsList>
          <Show
            when={stream()}
            fallback={
              <VideoDisplay
                class="bg-muted aspect-video w-full rounded-lg"
                stream={localStream()}
                name={t(
                  "common.media_selection_dialog.current",
                )}
                avatar={clientProfile.avatar ?? undefined}
              />
            }
          >
            <VideoDisplay
              class="bg-muted aspect-video w-full rounded-lg"
              stream={stream()}
              muted={true}
              name={t(
                "common.media_selection_dialog.preview",
              )}
              avatar={clientProfile.avatar ?? undefined}
            />
          </Show>
          <TabsContent
            value="screen"
            class="flex flex-col gap-2"
          >
            <div class="flex gap-2">
              <Show
                when={
                  microphones().length !== 0 &&
                  microphonePermission() === "prompt"
                }
              >
                <Button
                  size="sm"
                  class="w-full"
                  onClick={requestMicrophonePermission}
                >
                  {t(
                    "common.media_selection_dialog.request_microphone_permission",
                  )}
                </Button>
              </Show>
            </div>
            <Show when={canGetDisplayMedia}>
              <label class="flex items-center justify-between gap-2 p-2">
                <p class="text-muted-foreground text-sm">
                  {t(
                    "common.media_selection_dialog.video_constraints",
                  )}
                </p>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={openVideoConstraintsDialog}
                >
                  <IconSettings class="size-6" />
                </Button>
              </label>
            </Show>
            <div
              class={cn(
                "flex flex-col gap-2 rounded-lg px-2",
                canUseScreenSpeaker() &&
                  "border-border border py-2",
              )}
            >
              <Switch
                class="flex items-center justify-between gap-2"
                checked={enableScreenSpeaker()}
                onChange={(value) =>
                  setEnableScreenSpeaker(value)
                }
              >
                <SwitchLabel>
                  {t(
                    "common.media_selection_dialog.enable_speaker",
                  )}
                </SwitchLabel>
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
              <Show when={canUseScreenSpeaker()}>
                <div class="flex w-full gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={openSpeakerConstraintsDialog}
                  >
                    <IconSettings class="size-6" />
                  </Button>
                  <Select<MediaDeviceInfoType>
                    class="flex-1"
                    value={devices.speaker}
                    placeholder={t(
                      "common.media_selection_dialog.select_speaker",
                    )}
                    onChange={(value) =>
                      setDevices("speaker", value)
                    }
                    optionTextValue="label"
                    optionValue="deviceId"
                    options={availableSpeakers()}
                    itemComponent={(props) => (
                      <SelectItem item={props.item}>
                        {props.item.rawValue.label}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger
                      aria-label="Select speaker"
                      class="hover:bg-muted/80 border-none transition-colors"
                    >
                      <SelectValue<MediaDeviceInfoType>>
                        {(state) =>
                          state.selectedOption().label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </Show>
            </div>
            <div
              class={cn(
                "flex flex-col gap-2 rounded-lg px-2",
                canUseScreenMicrophone() &&
                  "border-border border py-2",
              )}
            >
              <Switch
                class="flex items-center justify-between gap-2"
                disabled={
                  availableMicrophones().length === 0 ||
                  microphonePermission() !== "granted"
                }
                checked={enableScreenMicrophone()}
                onChange={(value) =>
                  setEnableScreenMicrophone(value)
                }
              >
                <SwitchLabel>
                  {t(
                    "common.media_selection_dialog.enable_microphone",
                  )}
                </SwitchLabel>
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
              <Show when={canUseScreenMicrophone()}>
                <div class="flex w-full gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={
                      openMicrophoneConstraintsDialog
                    }
                  >
                    <IconSettings class="size-6" />
                  </Button>
                  <Select<MediaDeviceInfoType>
                    class="flex-1"
                    value={devices.microphone}
                    placeholder={t(
                      "common.media_selection_dialog.select_microphone",
                    )}
                    onChange={(value) => {
                      setDevices("microphone", value);
                    }}
                    optionTextValue="label"
                    optionValue="deviceId"
                    options={availableMicrophones()}
                    itemComponent={(props) => (
                      <SelectItem item={props.item}>
                        {props.item.rawValue.label}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger
                      aria-label="Select speaker"
                      class="hover:bg-muted/80 border-none transition-colors"
                    >
                      <SelectValue<MediaDeviceInfoType>>
                        {(state) =>
                          state.selectedOption().label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </Show>
            </div>
            <div class="flex items-stretch gap-2">
              <Show
                when={stream()}
                fallback={
                  <Show
                    when={canGetDisplayMedia}
                    fallback={
                      <p class="text-muted-foreground text-sm">
                        {t(
                          "common.media_selection_dialog.not_support_display_media",
                        )}
                      </p>
                    }
                  >
                    <Button
                      size="sm"
                      onClick={() =>
                        openScreen(
                          enableScreenSpeaker(),
                          enableScreenMicrophone(),
                        )
                      }
                      class="w-full"
                    >
                      {t(
                        "common.media_selection_dialog.open_screen",
                      )}
                    </Button>
                  </Show>
                }
              >
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={closeStream}
                  class="flex-1"
                >
                  {t("common.action.close")}
                </Button>
                <Show when={canGetDisplayMedia}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      closeStream();
                      openScreen(
                        enableScreenSpeaker(),
                        enableScreenMicrophone(),
                      );
                    }}
                    class="flex-1"
                  >
                    {t("common.action.change")}
                  </Button>
                </Show>
              </Show>
            </div>
          </TabsContent>
          <TabsContent
            value="user"
            class="flex flex-col gap-2"
          >
            <div class="flex gap-2">
              <Show
                when={
                  cameras().length !== 0 &&
                  cameraPermission() === "prompt"
                }
              >
                <Button
                  size="sm"
                  class="w-full"
                  onClick={requestCameraPermission}
                >
                  {t(
                    "common.media_selection_dialog.request_camera_permission",
                  )}
                </Button>
              </Show>
              <Show
                when={
                  microphones().length !== 0 &&
                  microphonePermission() === "prompt"
                }
              >
                <Button
                  size="sm"
                  class="w-full"
                  onClick={requestMicrophonePermission}
                >
                  {t(
                    "common.media_selection_dialog.request_microphone_permission",
                  )}
                </Button>
              </Show>
            </div>
            <div
              class={cn(
                "flex flex-col gap-2 rounded-lg px-2",
                canUseUserCamera() &&
                  "border-border border py-2",
              )}
            >
              <Switch
                disabled={
                  availableCameras().length === 0 ||
                  cameraPermission() !== "granted"
                }
                class="flex items-center justify-between gap-2"
                checked={enableUserCamera()}
                onChange={(value) =>
                  setEnableUserCamera(value)
                }
              >
                <SwitchLabel>
                  {t(
                    "common.media_selection_dialog.enable_camera",
                  )}
                </SwitchLabel>
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>

              <Show when={canUseUserCamera()}>
                <div class="flex w-full gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={openVideoConstraintsDialog}
                  >
                    <IconSettings class="size-6" />
                  </Button>
                  <Select<MediaDeviceInfoType>
                    class="flex-1"
                    value={devices.camera}
                    placeholder={t(
                      "common.media_selection_dialog.select_camera",
                    )}
                    onChange={(value) => {
                      setDevices("camera", value);
                    }}
                    optionTextValue="label"
                    optionValue="deviceId"
                    options={availableCameras()}
                    itemComponent={(props) => (
                      <SelectItem item={props.item}>
                        {props.item.rawValue.label}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger
                      aria-label="Select camera"
                      class="hover:bg-muted/80 border-none transition-colors"
                    >
                      <SelectValue<MediaDeviceInfoType>>
                        {(state) =>
                          state.selectedOption().label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </Show>
            </div>
            <div
              class={cn(
                "flex flex-col gap-2 rounded-lg px-2",
                canUseUserMicrophone() &&
                  "border-border border py-2",
              )}
            >
              <Switch
                disabled={
                  availableMicrophones().length === 0 ||
                  microphonePermission() !== "granted"
                }
                class="flex items-center justify-between gap-2"
                checked={enableUserMicrophone()}
                onChange={(value) =>
                  setEnableUserMicrophone(value)
                }
              >
                <SwitchLabel>
                  {t(
                    "common.media_selection_dialog.enable_microphone",
                  )}
                </SwitchLabel>
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>

              <Show when={canUseUserMicrophone()}>
                <div class="flex w-full gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={
                      openMicrophoneConstraintsDialog
                    }
                  >
                    <IconSettings class="size-6" />
                  </Button>
                  <Select<MediaDeviceInfoType>
                    class="flex-1"
                    value={devices.microphone}
                    placeholder={t(
                      "common.media_selection_dialog.select_microphone",
                    )}
                    onChange={(value) => {
                      setDevices("microphone", value);
                    }}
                    optionTextValue="label"
                    optionValue="deviceId"
                    options={availableMicrophones()}
                    itemComponent={(props) => (
                      <SelectItem item={props.item}>
                        {props.item.rawValue.label}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger
                      aria-label="Select microphone"
                      class="hover:bg-muted/80 border-none transition-colors"
                    >
                      <SelectValue<MediaDeviceInfoType>>
                        {(state) =>
                          state.selectedOption().label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </Show>
            </div>
            <div class="flex gap-2">
              <Show
                when={
                  (availableCameras().length !== 0 &&
                    cameraPermission() === "granted") ||
                  (availableMicrophones().length !== 0 &&
                    microphonePermission() === "granted")
                }
              >
                <Show
                  when={stream()}
                  fallback={
                    <Show
                      when={canGetUserMedia}
                      fallback={
                        <p class="text-muted-foreground text-sm">
                          {t(
                            "common.media_selection_dialog.not_support_user_media",
                          )}
                        </p>
                      }
                    >
                      <Button
                        size="sm"
                        class="w-full"
                        onClick={() =>
                          openCamera(
                            enableUserCamera(),
                            enableUserMicrophone(),
                          )
                        }
                      >
                        {t(
                          "common.media_selection_dialog.open_media_device",
                        )}
                      </Button>
                    </Show>
                  }
                >
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={closeStream}
                    class="w-full"
                  >
                    {t("common.action.close")}
                  </Button>
                </Show>
              </Show>
            </div>
          </TabsContent>
        </Tabs>
      ),
      confirm: (
        <Button
          disabled={!stream()}
          onClick={() => submit(stream()!)}
        >
          {t("common.action.confirm")}
        </Button>
      ),
      cancel: (
        <Button variant="secondary" onClick={() => close()}>
          {t("common.action.cancel")}
        </Button>
      ),
      onCancel: () => {
        closeStream();
      },
      onSubmit: () => {
        setStream(null);
      },
    });

  return { open, close, Component };
};
