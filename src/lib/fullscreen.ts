import { useCallback, useEffect, useState } from "react";

type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDoc;
const current = () => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

/**
 * Real full screen (hides Safari's bars and the iPad status band). Supported by iPad Safari; some iPadOS
 * versions don't allow it inside Home Screen apps, in which case `supported` is false and the button hides.
 */
export function useFullscreen() {
  const supported =
    typeof document !== "undefined" &&
    Boolean(doc().fullscreenEnabled || doc().webkitFullscreenEnabled) &&
    Boolean((document.documentElement as FsEl).requestFullscreen || (document.documentElement as FsEl).webkitRequestFullscreen);
  const [active, setActive] = useState(() => (typeof document !== "undefined" ? !!current() : false));

  useEffect(() => {
    const on = () => setActive(!!current());
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (current()) {
        await (document.exitFullscreen ? document.exitFullscreen() : doc().webkitExitFullscreen?.());
      } else {
        const el = document.documentElement as FsEl;
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.());
      }
    } catch {
      /* the iPad refused (e.g. not allowed here); nothing to do */
    }
  }, []);

  return { supported, active, toggle };
}
