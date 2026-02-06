import { t } from "@/i18n";
import { catchError } from "@/libs/catch";
import {
  createMemo,
  createEffect,
  Show,
  createSignal,
} from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "solid-sonner";
import {
  Switch,
  SwitchLabel,
  SwitchControl,
  SwitchThumb,
} from "../../../components/ui/switch";
import { Label } from "../../../components/ui/label";
import { createDialog } from "../../../components/dialogs/dialog";
import { makePersisted } from "@solid-primitives/storage";
import {
  Slider,
  SliderFill,
  SliderLabel,
  SliderThumb,
  SliderTrack,
  SliderValueLabel,
} from "../../../components/ui/slider";
import { createDebounceAsync } from "@/libs/hooks/debounce";

const getSupportedConstraints = () => {
  return "mediaDevices" in navigator
    ? navigator.mediaDevices.getSupportedConstraints()
    : {};
};

const constraints = getSupportedConstraints();

type AudioConstraints = MediaTrackConstraintSet & {
  suppressLocalAudioPlayback?: boolean;
  latency?: ConstrainDouble;
};

type VideoConstraints = MediaTrackConstraintSet & {};

export const [
  microphoneConstraints,
  setMicrophoneConstraints,
] = makePersisted(
  createStore({
    autoGainControl:
      "autoGainControl" in constraints ? true : undefined,
    echoCancellation:
      "echoCancellation" in constraints ? true : undefined,
    noiseSuppression:
      "noiseSuppression" in constraints ? true : undefined,
    voiceIsolation:
      "voiceIsolation" in constraints ? true : undefined,
  }),
  {
    name: "microphoneConstraints",
    storage: sessionStorage,
  },
);

export const [speakerConstraints, setSpeakerConstraints] =
  makePersisted(
    createStore<AudioConstraints>({
      suppressLocalAudioPlayback:
        "suppressLocalAudioPlayback" in constraints
          ? false
          : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      latency: { ideal: 0, max: 0.01 },
    }),
    {
      name: "speakerConstraints",
      storage: sessionStorage,
    },
  );

export const [videoConstraints, setVideoConstraints] =
  makePersisted(
    createStore<VideoConstraints>({
      frameRate: { max: 60 },
    }),
    {
      name: "videoConstraints",
      storage: sessionStorage,
    },
  );

export const createApplyConstraintsDialog = () => {
  const [mediaStream, setMediaStream] =
    createSignal<MediaStream | null>(null);

  createEffect(() => {
    const stream = mediaStream();
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.getConstraints();
      });
    }
  });

  const audioTracks = () => {
    return mediaStream()?.getAudioTracks();
  };

  const videoTrack = () => {
    return mediaStream()?.getVideoTracks()[0];
  };

  const microphoneAudioTrack = () => {
    return audioTracks()?.find(
      (track) => track.contentHint === "speech",
    );
  };

  const speakerAudioTrack = () => {
    return audioTracks()?.find(
      (track) => track.contentHint === "music",
    );
  };

  const {
    open: openDialog,
    close,
    Component,
  } = createDialog({
    title: () =>
      t("common.media_selection_dialog.apply_constraints"),
    description: () =>
      t(
        "common.media_selection_dialog.apply_constraints_description",
      ),
    content: () => (
      <div class="flex flex-col gap-2">
        <Show when={microphoneAudioTrack()}>
          {(track) => (
            <div class="border-border flex flex-col gap-2 rounded-md border p-2">
              <Label class="font-bold">
                {t(
                  "common.media_selection_dialog.microphone_constraints",
                )}
              </Label>
              <MicrophoneTrackConstraints track={track()} />
            </div>
          )}
        </Show>
        <Show when={speakerAudioTrack()}>
          {(track) => (
            <div class="border-border flex flex-col gap-2 rounded-md border p-2">
              <Label class="font-bold">
                {t(
                  "common.media_selection_dialog.speaker_constraints",
                )}
              </Label>
              <SpeakerTrackConstraints track={track()} />
            </div>
          )}
        </Show>
        <Show when={videoTrack()}>
          {(track) => (
            <div class="border-border flex flex-col gap-2 rounded-md border p-2">
              <Label class="font-bold">
                {t(
                  "common.media_selection_dialog.video_constraints",
                )}
              </Label>
              <VideoTrackConstraints track={track()} />
            </div>
          )}
        </Show>
      </div>
    ),
  });

  const open = (stream: MediaStream) => {
    setMediaStream(stream);
    openDialog();
  };

  return { open, close, Component };
};

export const SpeakerTrackConstraints = (props: {
  track: MediaStreamTrack;
}) => {
  const capabilities = createMemo(() => {
    const capabilities = props.track.getCapabilities();
    return {
      suppressLocalAudioPlayback:
        "suppressLocalAudioPlayback" in capabilities,
    };
  });
  const [enableConstraints, setEnableConstraints] =
    createStore({
      suppressLocalAudioPlayback: false,
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
    });
  createEffect(() => {
    const track = props.track;
    const constraints = track.getConstraints();
    setEnableConstraints(
      "suppressLocalAudioPlayback",
      !!(constraints as any)?.suppressLocalAudioPlayback,
    );
    setEnableConstraints(
      "noiseSuppression",
      !!constraints.noiseSuppression,
    );
    setEnableConstraints(
      "echoCancellation",
      !!constraints.echoCancellation,
    );
    setEnableConstraints(
      "autoGainControl",
      !!constraints.autoGainControl,
    );
  });
  const applyConstraints = async (
    name: keyof typeof enableConstraints,
    value: boolean,
  ) => {
    setEnableConstraints(name, value);
    const constraints = props.track.getConstraints() as any;
    const newConstraints = {
      ...constraints,
      [name]: value,
    };
    const [err] = await catchError(
      props.track.applyConstraints(newConstraints),
    );
    if (err) {
      console.error(err);
      toast.error(
        `Error applying ${name} constraint: ${err.message}`,
      );
      setEnableConstraints(name, !!constraints[name]);
    }
  };
  return (
    <>
      <Switch
        class="flex items-center justify-between gap-2"
        disabled={
          !capabilities().suppressLocalAudioPlayback
        }
        checked={
          enableConstraints.suppressLocalAudioPlayback
        }
        onChange={(value) => {
          applyConstraints(
            "suppressLocalAudioPlayback",
            value,
          );
        }}
      >
        <SwitchLabel>
          {t(
            "common.media_selection_dialog.constraints.suppress_local_audio_playback",
          )}
        </SwitchLabel>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
    </>
  );
};

export const MicrophoneTrackConstraints = (props: {
  track: MediaStreamTrack;
}) => {
  const capabilities = createMemo(() => {
    const capabilities = props.track.getCapabilities();
    return {
      noiseSuppression: "noiseSuppression" in capabilities,
      echoCancellation: "echoCancellation" in capabilities,
      autoGainControl: "autoGainControl" in capabilities,
      voiceIsolation: "voiceIsolation" in capabilities,
    };
  });

  const [enableConstraints, setEnableConstraints] =
    createStore({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
      voiceIsolation: false,
    });

  createEffect(() => {
    const track = props.track;
    const constraints = track.getConstraints();
    setEnableConstraints(
      "noiseSuppression",
      !!constraints.noiseSuppression,
    );
    setEnableConstraints(
      "echoCancellation",
      !!constraints.echoCancellation,
    );
    setEnableConstraints(
      "autoGainControl",
      !!constraints.autoGainControl,
    );
    setEnableConstraints(
      "voiceIsolation",
      !!(constraints as any)?.voiceIsolation,
    );
  });

  const applyConstraints = async (
    name: keyof typeof enableConstraints,
    value: boolean,
  ) => {
    setEnableConstraints(name, value);
    const constraints = props.track.getConstraints() as any;
    const newConstraints = {
      ...constraints,
      [name]: value,
    };
    const [err] = await catchError(
      props.track.applyConstraints(newConstraints),
    );
    if (err) {
      console.error(err);
      toast.error(
        `Error applying ${name} constraint: ${err.message}`,
      );
      setEnableConstraints(name, !!constraints[name]);
    }
  };

  return (
    <>
      <Switch
        class="flex items-center justify-between gap-2"
        disabled={!capabilities().autoGainControl}
        checked={enableConstraints.autoGainControl}
        onChange={(value) => {
          applyConstraints("autoGainControl", value);
        }}
      >
        <SwitchLabel>
          {t(
            "common.media_selection_dialog.constraints.auto_gain_control",
          )}
        </SwitchLabel>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
      <Switch
        class="flex items-center justify-between gap-2"
        disabled={!capabilities().echoCancellation}
        checked={enableConstraints.echoCancellation}
        onChange={(value) => {
          applyConstraints("echoCancellation", value);
        }}
      >
        <SwitchLabel>
          {t(
            "common.media_selection_dialog.constraints.echo_cancellation",
          )}
        </SwitchLabel>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
      <Switch
        class="flex items-center justify-between gap-2"
        disabled={!capabilities().noiseSuppression}
        checked={enableConstraints.noiseSuppression}
        onChange={(value) => {
          applyConstraints("noiseSuppression", value);
        }}
      >
        <SwitchLabel>
          {t(
            "common.media_selection_dialog.constraints.noise_suppression",
          )}
        </SwitchLabel>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
      <Switch
        class="flex items-center justify-between gap-2"
        disabled={!capabilities().voiceIsolation}
        checked={enableConstraints.voiceIsolation}
        onChange={(value) => {
          applyConstraints("voiceIsolation", value);
        }}
      >
        <SwitchLabel>
          {t(
            "common.media_selection_dialog.constraints.voice_isolation",
          )}
        </SwitchLabel>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
    </>
  );
};

export const VideoTrackConstraints = (props: {
  track: MediaStreamTrack;
}) => {
  const capabilities = createMemo(() => {
    return props.track.getCapabilities();
  });

  const [enableConstraints, setEnableConstraints] =
    createStore<VideoConstraints>({
      frameRate: { max: 60 },
    });

  createEffect(() => {
    const track = props.track;
    const constraints = track.getConstraints();
    setEnableConstraints(
      "frameRate",
      constraints.frameRate,
    );
  });

  const { debouncedFn: applyConstraints } =
    createDebounceAsync(
      async (
        name: keyof typeof videoConstraints,
        value: MediaTrackConstraintSet[keyof typeof videoConstraints],
      ) => {
        const constraints =
          props.track.getConstraints() as any;
        const newConstraints = {
          ...constraints,
          [name]: value,
        };
        const [err] = await catchError(
          props.track.applyConstraints(newConstraints),
        );
        if (err) {
          console.error(err);
          toast.error(
            `Error applying ${name} constraint: ${err.message}`,
          );
          setVideoConstraints(name, constraints[name]);
          return;
        }
      },
    );

  return (
    <div class="flex flex-col gap-2">
      <Show when={capabilities().frameRate}>
        <Slider
          minValue={1}
          maxValue={120}
          value={[
            typeof enableConstraints.frameRate === "number"
              ? enableConstraints.frameRate
              : (enableConstraints.frameRate?.max ?? 60),
          ]}
          onChange={(value) => {
            setEnableConstraints("frameRate", value[0]);
            applyConstraints("frameRate", {
              max: value[0],
            });
          }}
          getValueLabel={({ values }) => `${values[0]} FPS`}
          class="gap-2"
        >
          <div class="flex w-full justify-between">
            <SliderLabel>
              {t(
                "common.media_selection_dialog.constraints.max_frame_rate",
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
      </Show>
    </div>
  );
};

export const createPresetSpeakerTrackConstraintsDialog =
  () => {
    return createDialog({
      title: () => t("common.action.settings"),
      content: () => (
        <div class="flex flex-col gap-2">
          <Switch
            disabled={
              speakerConstraints.suppressLocalAudioPlayback ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={
              speakerConstraints.suppressLocalAudioPlayback ===
              true
            }
            onChange={(value) =>
              setSpeakerConstraints(
                "suppressLocalAudioPlayback",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.suppress_local_audio_playback",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
          <Switch
            disabled={
              speakerConstraints.autoGainControl ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={
              speakerConstraints.autoGainControl === true
            }
            onChange={(value) =>
              setSpeakerConstraints(
                "autoGainControl",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.auto_gain_control",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
          <Switch
            disabled={
              speakerConstraints.echoCancellation ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={
              speakerConstraints.echoCancellation === true
            }
            onChange={(value) =>
              setSpeakerConstraints(
                "echoCancellation",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.echo_cancellation",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
          <Switch
            disabled={
              speakerConstraints.noiseSuppression ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={
              speakerConstraints.noiseSuppression === true
            }
            onChange={(value) =>
              setSpeakerConstraints(
                "noiseSuppression",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.noise_suppression",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>
      ),
    });
  };

export const createPresetMicrophoneConstraintsDialog =
  () => {
    return createDialog({
      title: () => t("common.action.settings"),
      content: () => (
        <div class="flex flex-col gap-2">
          <Switch
            disabled={
              microphoneConstraints.autoGainControl ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={microphoneConstraints.autoGainControl}
            onChange={(value) =>
              setMicrophoneConstraints(
                "autoGainControl",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.auto_gain_control",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
          <Switch
            disabled={
              microphoneConstraints.echoCancellation ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={microphoneConstraints.echoCancellation}
            onChange={(value) =>
              setMicrophoneConstraints(
                "echoCancellation",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.echo_cancellation",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
          <Switch
            disabled={
              microphoneConstraints.noiseSuppression ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={microphoneConstraints.noiseSuppression}
            onChange={(value) =>
              setMicrophoneConstraints(
                "noiseSuppression",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.noise_suppression",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
          <Switch
            disabled={
              microphoneConstraints.voiceIsolation ===
              undefined
            }
            class="flex items-center justify-between gap-2"
            checked={microphoneConstraints.voiceIsolation}
            onChange={(value) =>
              setMicrophoneConstraints(
                "voiceIsolation",
                value,
              )
            }
          >
            <SwitchLabel>
              {t(
                "common.media_selection_dialog.constraints.voice_isolation",
              )}
            </SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>
      ),
    });
  };

export const createPresetVideoConstraintsDialog = () => {
  return createDialog({
    title: () => t("common.action.settings"),
    content: () => (
      <div class="flex flex-col gap-2">
        <Slider
          minValue={1}
          maxValue={120}
          value={[
            typeof videoConstraints.frameRate === "number"
              ? videoConstraints.frameRate
              : (videoConstraints.frameRate?.max ?? 30),
          ]}
          onChange={(value) =>
            setVideoConstraints("frameRate", {
              max: value[0],
            })
          }
          getValueLabel={({ values }) => `${values[0]} FPS`}
          class="gap-2"
        >
          <div class="flex w-full justify-between">
            <SliderLabel>
              {t(
                "common.media_selection_dialog.constraints.max_frame_rate",
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
      </div>
    ),
  });
};
