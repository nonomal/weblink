import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Component,
  For,
  createMemo,
  Switch,
  Match,
  createEffect,
  Show,
  createSignal,
  ComponentProps,
  splitProps,
  Suspense,
} from "solid-js";
import { cn } from "@/libs/cn";

import {
  A,
  RouteSectionProps,
  useCurrentMatches,
} from "@solidjs/router";
import { ClientID, ClientInfo } from "@/libs/core/type";

import {
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@/components/ui/resizable";

import { createMediaQuery } from "@solid-primitives/media";
import { makePersisted } from "@solid-primitives/storage";
import {
  IconFilterList,
  IconPerson,
} from "@/components/icons";
import { UserItem } from "@/components/chat/clientlist";
import { messageStores } from "@/libs/core/messge";
import { t } from "@/i18n";
import { sessionService } from "@/libs/services/session-service";
import { Button } from "@/components/ui/button";

export interface UserItemProps
  extends ComponentProps<"li"> {
  client: ClientInfo;
  collapsed: boolean;
}

export default function Home(props: RouteSectionProps) {
  const isMobile = createMediaQuery("(max-width: 768px)");

  const matches = useCurrentMatches();
  const [size, setSize] = makePersisted(
    createSignal<number[]>(),
    {
      storage: sessionStorage,
      name: "resizable-sizes",
    },
  );
  createEffect(() => {
    if (isMobile()) {
      if (matches()[matches().length - 1].path === "/") {
        setSize([1, 0]);
      } else {
        setSize([0, 1]);
      }
    } else {
    }
  });

  const getLastMessage = (clientId: ClientID) =>
    messageStores.messages.findLast(
      (message) =>
        message.client === clientId ||
        message.target === clientId,
    );

  const clntWithLastMsg = createMemo(() => {
    return messageStores.clients
      .map((client) => {
        return {
          client,
          message: getLastMessage(client.clientId),
          clientInfo: sessionService.clientInfo[
            client.clientId
          ] as ClientInfo | undefined,
        };
      })
      .toSorted((c1, c2) => {
        const c1Online =
          c1.clientInfo?.onlineStatus === "online";
        const c2Online =
          c2.clientInfo?.onlineStatus === "online";
        if (c1Online && !c2Online) return -1;
        if (!c1Online && c2Online) return 1;

        return (
          (c2.message?.createdAt ?? 0) -
          (c1.message?.createdAt ?? 0)
        );
      });
  });

  return (
    <Resizable
      sizes={size()}
      onSizesChange={(sizes) => setSize(sizes)}
      class="size-auto min-h-[calc(100%-3rem)] w-full"
    >
      <ResizablePanel
        class={cn(
          `relative data-[collapsed]:transition-all
          data-[collapsed]:ease-in-out`,
          isMobile() &&
            matches()[matches().length - 1].path !== "/" &&
            "hidden",
        )}
        collapsible
        initialSize={0.2}
        maxSize={0.4}
        minSize={0.1}
      >
        {(props) => {
          createEffect(() => {
            if (
              props.collapsed &&
              matches()[matches().length - 1].path === "/"
            ) {
              props.expand();
            }
          });
          return (
            <>
              <div
                class="flex h-full w-full flex-col overflow-x-hidden
                  bg-background/80 md:sticky md:top-[calc(3rem)]
                  md:h-[calc(100vh_-_3rem)] md:overflow-y-auto"
              >
                <Show when={!props.collapsed}>
                  <div
                    class="sticky top-0 z-10 flex items-center justify-between p-2
                      backdrop-blur"
                  >
                    <h4 class="h4">
                      {t("chat.index.title")}
                    </h4>
                    <Button variant="outline" size="icon">
                      <IconFilterList class="size-4" />
                    </Button>
                  </div>
                </Show>
                <ul
                  class={cn(
                    "flex h-full w-full flex-col [&>li]:py-1",
                    props.collapsed
                      ? ""
                      : "divide-y divide-muted",
                  )}
                >
                  <For
                    each={clntWithLastMsg()}
                    fallback={
                      <div class="relative h-full w-full overflow-hidden">
                        <div
                          class="absolute left-1/2 top-1/2 flex w-1/2 -translate-x-1/2
                            -translate-y-1/2 flex-col items-center"
                        >
                          <IconPerson class="text-muted/50" />
                          <Show
                            when={
                              sessionService.clientServiceStatus() ===
                              "disconnected"
                            }
                          >
                            <p class="muted sm:hidden">
                              {t(
                                "chat.index.guide_description",
                              )}
                            </p>
                          </Show>
                        </div>
                      </div>
                    }
                  >
                    {({ client, message }) => (
                      <UserItem
                        message={message}
                        client={client}
                        collapsed={props.collapsed}
                      />
                    )}
                  </For>
                </ul>
              </div>
              <div class="absolute inset-0 z-[-1] backdrop-blur"></div>
            </>
          );
        }}
      </ResizablePanel>

      <ResizableHandle
        withHandle
        class={cn(isMobile() && "hidden")}
      />

      <ResizablePanel
        class={cn(
          isMobile() &&
            matches()[matches().length - 1].path === "/" &&
            "hidden",
        )}
        minSize={0.6}
        initialSize={0.8}
      >
        {(resizeProps) => {
          createEffect(() => {
            if (!isMobile() && (size()?.[1] ?? 0) < 0.6) {
              resizeProps.resize(0.6);
            }
          });
          return props.children;
        }}
      </ResizablePanel>
    </Resizable>
  );
}
