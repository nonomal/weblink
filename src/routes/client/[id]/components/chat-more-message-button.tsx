import { IconArrowUpward } from "@/components/icons";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { onMount, Show } from "solid-js";

import { onCleanup } from "solid-js";

export type ChatMoreMessageButtonProps = {
  onIntersect: () => void;
};

export const ChatMoreMessageButton = (
  props: ChatMoreMessageButtonProps,
) => {
  let ref: HTMLButtonElement | undefined;
  let enabled = false;
  onMount(() => {
    setTimeout(() => {
      enabled = true;
    }, 500);
    if (!ref) return;
    const observer = new IntersectionObserver(
      () => {
        if (enabled) {
          props.onIntersect();
        }
      },
      {
        threshold: 0,
      },
    );
    observer.observe(ref);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      class="rounded-full"
    >
      <Spinner />
    </Button>
  );
};
