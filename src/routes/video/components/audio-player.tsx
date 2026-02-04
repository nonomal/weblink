import { catchErrorAsync } from "@/libs/catch";
import { appState } from "@/libs/state/app-state";
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  ParentProps,
  Show,
  useContext,
} from "solid-js";

const AudioPlayerContext = createContext<{
  hasAudio: Accessor<boolean>;
  playState: Accessor<boolean>;
  setPlay: (state: boolean) => void;
}>();

export const useAudioPlayer = () => {
  const context = useContext(AudioPlayerContext);
  if (!context) {
    throw new Error("Audio player context not found");
  }
  return context;
};

export const AudioPlayerProvider = (props: ParentProps) => {
  const [audioStream, setAudioStream] =
    createSignal<MediaStream | null>(null);

  const [tracks, setTracks] = createSignal<
    MediaStreamTrack[]
  >([]);

  createEffect(() => {
    const tracks = Object.values(
      appState.session.clientViewData,
    )
      .flatMap((client) => {
        client.stream?.addEventListener(
          "addtrack",
          (event) => {
            setTracks((prev) => [...prev, event.track]);
          },
        );
        client.stream?.addEventListener(
          "removetrack",
          (event) => {
            setTracks((prev) =>
              prev.filter((track) => track !== event.track),
            );
          },
        );
        return client.stream
          ?.getAudioTracks()
          .map((track) => {
            track.addEventListener("ended", () => {
              setTracks((prev) =>
                prev.filter((t) => t !== track),
              );
            });
            return track;
          });
      })
      .filter(
        (track): track is MediaStreamTrack =>
          track !== undefined,
      );
    setTracks(tracks);
  });

  const [playState, setPlayState] = createSignal(false);

  createEffect(() => {
    if (tracks().length === 0) {
      setAudioStream(null);
      return;
    }

    const stream = new MediaStream();
    tracks().forEach((track) => {
      stream.addTrack(track);
    });
    setAudioStream(stream);
  });

  let audioRef: HTMLAudioElement | undefined;

  createEffect(() => {
    const stream = audioStream();
    if (!stream) return;
    if (audioRef) {
      audioRef.srcObject = stream;
      audioRef
        .play()
        .then(() => {
          setPlayState(true);
        })
        .catch((error) => {
          console.error(error);
          setPlayState(false);
        });
    }
  });

  const setPlay = async (state: boolean) => {
    if (!audioRef)
      throw new Error("Audio player not initialized");
    if (state) {
      const [error] = await catchErrorAsync(
        audioRef.play(),
      );
      if (error) {
        console.error(error);
        setPlayState(false);
      }
    } else {
      audioRef.pause();
    }
    setPlayState(state);
  };

  const hasAudio = createMemo(() => {
    return tracks().length > 0;
  });

  return (
    <>
      <AudioPlayerContext.Provider
        value={{ hasAudio, playState, setPlay }}
      >
        <Show when={audioStream()}>
          <audio
            autoplay
            onPlaying={() => {
              setPlayState(true);
            }}
            onPause={() => {
              setPlayState(false);
            }}
            ref={audioRef}
          />
        </Show>
        {props.children}
      </AudioPlayerContext.Provider>
    </>
  );
};
