import { cn } from "@/libs/cn";
import {
  createSignal,
  JSX,
  ParentProps,
  splitProps,
  ValidComponent,
} from "solid-js";
import { Dynamic } from "solid-js/web";

interface DropAreaProps<T extends ValidComponent>
  extends ParentProps {
  overlay?: (event: DragEvent | null) => JSX.Element;
  onDrop?: (event: DragEvent) => void;
  as?: T;
  class?: string;
}

export default function DropArea<T extends ValidComponent>(
  props: DropAreaProps<T>,
) {
  const [local, other] = splitProps(props, [
    "class",
    "children",
    "overlay",
    "onDrop",
    "as",
  ]);

  const [eventInfo, setEventInfo] =
    createSignal<DragEvent | null>(null);

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    setEventInfo(event);
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setEventInfo(event);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    setEventInfo(null);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    local.onDrop?.(event);
    setEventInfo(null);
  };

  return (
    <Dynamic
      component={local.as ?? "div"}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      class={cn(local.class)}
      {...other}
    >
      {local.children}
      {local.overlay?.(eventInfo())}
    </Dynamic>
  );
}
