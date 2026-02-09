import {
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { MOBILE_BREAKPOINT_PX } from "@/constants";

export function createIsMobile() {
  const [isMobile, setIsMobile] = createSignal<boolean>(
    window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`,
    ).matches,
  );

  createEffect(() => {
    const mql = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`,
    );
    
    const onChange = () => {
      setIsMobile(
        window.innerWidth < MOBILE_BREAKPOINT_PX,
      );
    };

    mql.addEventListener("change", onChange);
    
    window.addEventListener("orientationchange", onChange);
    
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);

    onCleanup(() => {
      mql.removeEventListener("change", onChange);
      window.removeEventListener("orientationchange", onChange);
    });
  }, []);

  return isMobile;
}
