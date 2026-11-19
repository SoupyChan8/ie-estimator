import { useEffect } from "react";

/** Colours of the top edge of each screen, so the iPad's status bar band blends in. */
export const BAR = {
  welcome: "#3a2d22", // the shaded top of the welcome photo
  dark: "#1b1511", // sign-in page
  light: "#eae4d8", // estimator / studio header
} as const;

/**
 * Since iPadOS 26.1, Home Screen web apps get a solid status bar band instead of drawing behind it
 * (WebKit bug 301994). Depending on the version, iPadOS colours that band from the page's theme-color
 * or from its background, so we set both to match the screen underneath.
 */
export function useStatusBarColor(color: string) {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
    document.documentElement.style.backgroundColor = color;
  }, [color]);
}
