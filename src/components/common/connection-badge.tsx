import { Component, Show } from "solid-js";
import { ClientInfo } from "@/libs/core/type";
import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";

export const ConnectionBadge: Component<{
  client?: ClientInfo;
}> = (props) => {
  return (
    <Badge class="text-xs" variant="secondary">
      <Show
        when={props.client?.onlineStatus}
        fallback={t("common.status.leave")}
      >
        {(status) => (
          <span>{t(`common.status.${status()}`)}</span>
        )}
      </Show>
    </Badge>
  );
};
