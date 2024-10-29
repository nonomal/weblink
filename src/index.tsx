/* @refresh reload */
import "@/index.css";
import { render } from "solid-js/web";
import App from "@/app";

import { Router } from "@solidjs/router";

import routes from "@/routes";
import {
  checkBrowserSupport,
  isWebRTCAvailable,
} from "@/libs/utils/browser-compatibility";
import { t } from "@/i18n";

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  );
}

render(() => {
  let reasons = [];

  if (!checkBrowserSupport()) {
    reasons.push(() =>
      t(
        "browser_unsupported.reasons.browser_version_too_low",
      ),
    );
  }
  if (!isWebRTCAvailable()) {
    reasons.push(() =>
      t(
        "browser_unsupported.reasons.browser_does_not_support_webrtc",
      ),
    );
  }

  if (reasons.length > 0) {
    return (
      <div class="flex h-screen flex-col px-2">
        <h2 class="p-2 font-mono text-xl font-bold">
          Weblink
        </h2>
        <div class="flex h-screen flex-col items-center justify-center gap-4 text-center">
          <h1 class="text-4xl font-bold">
            {t("browser_unsupported.title")}
          </h1>
          <ul>
            {reasons.map((reason) => (
              <li>{reason()}</li>
            ))}
          </ul>
          <p class="text-sm text-muted-foreground">
            {t("browser_unsupported.description")}
          </p>
        </div>
      </div>
    );
  }

  return <Router root={App}>{routes}</Router>;
}, root!);
