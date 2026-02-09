import { useColorMode } from "@kobalte/core";
import { joinUrl } from "@/components/dialogs/join-dialog";
import { toast } from "solid-sonner";
import { createDialog } from "./dialog";
import { QRCode } from "@/components/common/qrcode";
import { t } from "@/i18n";
import { Input } from "@/components/ui/input";
import { appState } from "@/libs/state/app-state";

export const createQRCodeDialog = () => {
  const { colorMode } = useColorMode();
  const { open } = createDialog({
    title: () => t("common.scan_qrcode_dialog.title"),
    description: () => (
      <>
        <span class="text-lg font-bold">
          {appState.profile.name}&nbsp;
        </span>
        <span class="text-muted-foreground text-sm">
          {t("common.scan_qrcode_dialog.invite", {
            room: appState.profile.roomId,
          })}
        </span>
      </>
    ),
    content: () => {
      const url = joinUrl();
      return (
        <div class="flex flex-col items-center gap-2 select-none">
          <div
            onContextMenu={(e) => {
              e.preventDefault();
              navigator.clipboard
                .writeText(url)
                .then(() => {
                  toast.success(
                    t(
                      "common.notification.link_copy_success",
                    ),
                  );
                })
                .catch(() => {
                  toast.error(
                    t("common.notification.copy_failed"),
                  );
                });
            }}
          >
            <QRCode
              value={url}
              dark={
                colorMode() === "dark"
                  ? "#ffffff"
                  : "#000000"
              }
              light="#00000000"
              logo={appState.profile.avatar ?? undefined}
              logoShape="circle"
            />
          </div>
          <Input
            class="h-8 w-full max-w-sm text-xs break-all whitespace-pre-wrap
              select-all hover:underline"
            readOnly
            onContextMenu={async (e) => {
              e.preventDefault();
              navigator.clipboard
                .writeText(url)
                .then(() => {
                  toast.success(
                    t(
                      "common.notification.link_copy_success",
                    ),
                  );
                })
                .catch(() => {
                  toast.error(
                    t("common.notification.copy_failed"),
                  );
                });
            }}
            value={joinUrl()}
          />
          <p>{t("common.scan_qrcode_dialog.description")}</p>
          <p class="text-muted-foreground mt-2 text-sm">
            {t("common.scan_qrcode_dialog.tip")}
          </p>
        </div>
      );
    },
  });
  return { open };
};
