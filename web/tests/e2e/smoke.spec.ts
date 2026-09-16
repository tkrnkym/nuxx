import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("the repo browser loads with Nuxx branding", async ({ page }) => {
  // Was the top page until chat took `/`; it lives at `/repos` now.
  await page.goto("/repos");
  await expect(
    page.getByRole("main").getByRole("img", { name: "Nuxx" }),
  ).toBeVisible();
});

test("the repo browser shows its repositories section", async ({ page }) => {
  await page.goto("/repos");
  await expect(page.getByRole("main").getByText("Repositories")).toBeVisible();
});

test("invite requires age and legal consent before opening Nuxx", async ({
  page,
}) => {
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        policy: {
          terms_markdown: "# Terms",
          privacy_markdown: "# Privacy",
          age_attestation_required: true,
          version: "policy-v1",
        },
      }),
    });
  });
  await page.goto("/invite/demo-code");

  const ageConfirmation = page.getByLabel("I am 18 years of age or older.");
  const agreementConfirmation = page.getByLabel(
    "I agree to the channels.nuxx.ai Terms of Service and Privacy Policy.",
  );
  const acceptInvite = page.getByRole("button", {
    name: "Accept invite in Nuxx",
  });

  await expect(ageConfirmation).toBeVisible();
  await expect(agreementConfirmation).toBeVisible();
  await expect(acceptInvite).toBeDisabled();

  const termsLink = page.getByRole("button", { name: "Terms of Service" });
  const privacyLink = page.getByRole("button", { name: "Privacy Policy" });
  await expect(termsLink).toHaveCSS("text-decoration-line", "none");
  await expect(privacyLink).toHaveCSS("text-decoration-line", "none");
  await termsLink.hover();
  await expect(termsLink).toHaveCSS("text-decoration-line", "underline");
  await page.mouse.move(0, 0);
  await privacyLink.hover();
  await expect(privacyLink).toHaveCSS("text-decoration-line", "underline");

  await page
    .locator("label")
    .filter({ hasText: "I am 18 years of age or older." })
    .click();
  await expect(ageConfirmation).toBeChecked();
  await expect(acceptInvite).toBeDisabled();
  await page
    .locator("label")
    .filter({
      hasText:
        "I agree to the channels.nuxx.ai Terms of Service and Privacy Policy.",
    })
    .click({ position: { x: 8, y: 8 } });
  await expect(agreementConfirmation).toBeChecked();
  await expect(acceptInvite).toBeEnabled();

  const consentBox = await page
    .getByTestId("invite-join-policy-notice")
    .boundingBox();
  const acceptButtonBox = await acceptInvite.boundingBox();
  expect(consentBox?.y).toBeLessThan(acceptButtonBox?.y ?? 0);
  expect(consentBox?.width).toBe(acceptButtonBox?.width);
});

test("invite can enroll a NIP-07 identity for browser access", async ({
  page,
}) => {
  const pubkey = "ab".repeat(32);
  await page.addInitScript((extensionPubkey) => {
    (
      window as Window & {
        nostr?: {
          getPublicKey(): Promise<string>;
          signEvent(
            event: Record<string, unknown>,
          ): Promise<Record<string, unknown>>;
        };
      }
    ).nostr = {
      async getPublicKey() {
        return extensionPubkey;
      },
      async signEvent(event) {
        return {
          ...event,
          id: "cd".repeat(32),
          pubkey: extensionPubkey,
          sig: "ef".repeat(64),
        };
      },
    };
  }, pubkey);
  await page.route("**/api/join-policy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: null }),
    });
  });

  let claimObserved = false;
  await page.route("**/api/invites/claim", async (route) => {
    claimObserved = true;
    const request = route.request();
    const body = request.postData() ?? "";
    expect(JSON.parse(body)).toEqual({
      code: "browser-code",
    });

    const authorization = request.headers().authorization;
    expect(authorization).toMatch(/^Nostr /);
    const event = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    ) as {
      pubkey: string;
      tags: string[][];
    };
    expect(event.pubkey).toBe(pubkey);
    expect(event.tags).toContainEqual(["u", request.url()]);
    expect(event.tags).toContainEqual(["method", "POST"]);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "joined",
        community_id: "community-id",
        host: "127.0.0.1",
        role: "member",
      }),
    });
  });

  await page.goto("/invite/browser-code");
  await page.getByRole("button", { name: "Join in browser" }).click();
  await expect(page).toHaveURL("/");
  expect(claimObserved).toBe(true);
});

interface QueryFilter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  limit?: number;
  before_id?: string;
  search?: string;
  page?: number;
  "#h"?: string[];
}

function mockRelay(
  page: import("@playwright/test").Page,
  options: {
    extraMessages?: unknown[];
    auxEvents?: unknown[];
    /**
     * Channel id -> last-activity unix seconds, served as kind:39007 activity
     * snapshots. Delivered both to the initial `POST /query` and live over the
     * subscription, which is how the relay serves them.
     */
    channelActivity?: Record<string, number>;
    /** Served to the kind:20001 presence read over `POST /query`. */
    presenceEvents?: unknown[];
    /** Extra kind:39000 metadata, for rooms beyond the default one. */
    extraChannels?: unknown[];
    /** Served to the kind:30078 read-state read. */
    readStateEvents?: unknown[];
    /** Served to the kind:20002 typing subscription. */
    typingEvents?: unknown[];
    /** Served to a `POST /query` carrying a scrollback cursor. */
    olderMessages?: unknown[];
    /** Served to a NIP-50 search, by page number (1-based). */
    searchPages?: Record<number, unknown[]>;
    /**
     * Hold back the OK for a read-state write, so a spec can advance a second
     * cursor while the first publish is still in flight.
     */
    delayReadStateOkMs?: number;
    /** kind:0 metadata served for a profile lookup. */
    profileEvents?: unknown[];
    /** kind:39002 member lists, from which the directory is built. */
    memberEvents?: unknown[];
    /** kind:30030 emoji sets, from which the palette is built. */
    emojiEvents?: unknown[];
    /** Rows served for `GET /moderation/restricted`. */
    restrictedRows?: unknown[];
    /**
     * Refuse every kind:9 with this message, verbatim.
     *
     * The only way to exercise a community timeout: the relay tells a member
     * they are blocked by rejecting a write, and nothing else announces it.
     */
    rejectSendWith?: string;
  } = {},
) {
  const published: unknown[][] = [];
  /** Every REQ filter the client opened, so a spec can assert what it did not. */
  const subscriptions: QueryFilter[] = [];
  /** Every `POST /query` body, as an array of filters per request. */
  const queries: QueryFilter[][] = [];
  /** Cursors the client paged with, in order. */
  const historyRequests: { until: number; beforeId: string }[] = [];
  /** Search filters the client sent, in order. */
  const searchRequests: QueryFilter[] = [];
  /** How many WebSockets the page opened, so a spec can assert reuse. */
  let socketsOpened = 0;
  /**
   * Open message subscriptions, by id and channel.
   *
   * A publish is echoed to whichever subscription actually asked for that
   * channel's messages, the way a relay fans out. This used to be a hardcoded
   * `s1`, which quietly depended on the timeline being the first subscription
   * the client opened — so it broke the moment the app shell opened one first.
   */
  const messageSubs: { subId: string; channelId: string }[] = [];

  const channelMetadata = {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind: 39000,
    created_at: 1_700_000_000,
    tags: [
      ["d", "11111111-1111-1111-1111-111111111111"],
      ["name", "general"],
      ["about", "Everything else"],
      ["public"],
      ["closed"],
      ["t", "stream"],
      ["topic", "ship it"],
    ],
    content: "",
    sig: "c".repeat(128),
  };

  const message = {
    id: "d".repeat(64),
    pubkey: "e".repeat(64),
    kind: 9,
    created_at: 1_700_000_100,
    tags: [["h", "11111111-1111-1111-1111-111111111111"]],
    content: "hello from the mocked relay",
    sig: "f".repeat(128),
  };

  /**
   * Build the kind:39007 snapshots for the seeded activity.
   *
   * Sharded the way the relay shards, so a spec that seeds two channels
   * exercises the merge across shards rather than a single event — replacing
   * instead of merging would pass a one-shard test and lose badges in real use.
   */
  const activitySnapshots = () => {
    const byShard = new Map<number, Record<string, number>>();
    for (const [channelId, at] of Object.entries(
      options.channelActivity ?? {},
    )) {
      // Same rule as `shard_of` in nuxx-core: the UUID's last bytes, mod the
      // shard count.
      const shard =
        Number.parseInt(channelId.replace(/-/g, "").slice(-8), 16) % 16;
      byShard.set(shard, { ...(byShard.get(shard) ?? {}), [channelId]: at });
    }
    return [...byShard].map(([shard, channels]) => ({
      id: `39007${shard}`.padEnd(64, "0"),
      pubkey: "b".repeat(64),
      kind: 39007,
      created_at: 1_900_000_000,
      tags: [["d", `activity:${shard}`]],
      content: JSON.stringify({ shard, channels }),
      sig: "f".repeat(128),
    }));
  };

  return {
    published,
    subscriptions,
    queries,
    historyRequests,
    searchRequests,
    socketCount: () => socketsOpened,
    install: async () => {
      // The moderator reads are HTTP because the relay derives them from its own
      // state — there is no kind to subscribe to. Answered here so a spec can
      // assert the moderator surface without the client falling back to the
      // preview server and getting a 404.
      await page.route("**/moderation/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const rows = path.endsWith("/restricted")
          ? (options.restrictedRows ?? [])
          : [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(rows),
        });
      });

      await page.route("**/query", async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as {
          filters?: QueryFilter[];
        };
        const filters = body.filters ?? [];
        queries.push(filters);

        const events: unknown[] = [];
        for (const filter of filters) {
          if (filter.kinds?.includes(30315)) {
            // Parameterized-replaceable: the newest published event on the
            // coordinate is the whole answer, which is also how a clear works.
            const statuses = published.filter(
              (event) => (event as { kind: number }).kind === 30315,
            );
            const newest = statuses.at(-1);
            if (newest) events.push(newest);
          } else if (filter.kinds?.includes(0)) {
            // Plus anything published this session, so a profile the spec saves
            // is the one the timeline then names the author by.
            events.push(
              ...(options.profileEvents ?? []),
              ...published.filter(
                (event) => (event as { kind: number }).kind === 0,
              ),
            );
          } else if (filter.kinds?.includes(30030)) {
            // Plus anything published this session, so a set the spec saves is
            // the one the picker then offers.
            events.push(
              ...(options.emojiEvents ?? []),
              ...published.filter(
                (event) => (event as { kind: number }).kind === 30030,
              ),
            );
          } else if (filter.kinds?.includes(10000)) {
            // Replaceable, and the only source is the reader themselves — so a
            // mute published this session is what the timeline then filters on.
            events.push(
              ...published.filter(
                (event) => (event as { kind: number }).kind === 10000,
              ),
            );
          } else if (filter.kinds?.includes(39002)) {
            events.push(...(options.memberEvents ?? []));
          } else if (filter.kinds?.includes(20001)) {
            events.push(...(options.presenceEvents ?? []));
          } else if (filter.kinds?.includes(39007)) {
            events.push(...activitySnapshots());
          } else if (filter.search) {
            searchRequests.push(filter);
            // The relay's p-gate rejects a search that names no kinds, so the
            // mock does too — a client that stopped sending them would pass
            // here and 403 in production.
            if (!filter.kinds || filter.kinds.length === 0) {
              await route.fulfill({
                status: 403,
                body: "restricted: kinds required",
              });
              return;
            }
            events.push(...(options.searchPages?.[filter.page ?? 1] ?? []));
          } else if (filter.before_id) {
            // A scrollback page. The relay requires `until` alongside
            // `before_id` and rejects one without the other, so the mock does
            // too — a client that sent a half cursor would pass otherwise.
            if (filter.until === undefined) {
              await route.fulfill({
                status: 400,
                body: "before_id requires until",
              });
              return;
            }
            historyRequests.push({
              until: filter.until,
              beforeId: filter.before_id,
            });
            events.push(...(options.olderMessages ?? []));
          }
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(events),
        });
      });

      await page.routeWebSocket(
        (url) => url.protocol === "ws:" || url.protocol === "wss:",
        (ws) => {
          socketsOpened += 1;
          // Nuxx relays always challenge before serving anything.
          ws.send(JSON.stringify(["AUTH", "challenge-from-mock"]));

          ws.onMessage((raw) => {
            const frame = JSON.parse(String(raw));
            const [verb] = frame;

            if (verb === "AUTH") {
              ws.send(JSON.stringify(["OK", frame[1].id, true, ""]));
              return;
            }

            if (verb === "EVENT") {
              published.push(frame[1]);
              if (options.rejectSendWith && frame[1].kind === 9) {
                ws.send(
                  JSON.stringify([
                    "OK",
                    frame[1].id,
                    false,
                    options.rejectSendWith,
                  ]),
                );
                return;
              }
              const delay =
                frame[1].kind === 30078 ? (options.delayReadStateOkMs ?? 0) : 0;
              if (delay > 0) {
                setTimeout(
                  () => ws.send(JSON.stringify(["OK", frame[1].id, true, ""])),
                  delay,
                );
                return;
              }
              ws.send(JSON.stringify(["OK", frame[1].id, true, ""]));
              // Echo it back to every subscription that covers it, as a relay
              // would. Reactions and deletions carry an `e` tag rather than an
              // `h` tag, so they go to all open message subscriptions.
              const hTag = (frame[1].tags as string[][]).find(
                (tag) => tag[0] === "h",
              )?.[1];
              for (const sub of messageSubs) {
                if (hTag === undefined || sub.channelId === hTag) {
                  ws.send(JSON.stringify(["EVENT", sub.subId, frame[1]]));
                }
              }
              return;
            }

            if (verb === "REQ") {
              const [, subId, filter] = frame;
              subscriptions.push(filter);
              if (filter.kinds.includes(39000)) {
                ws.send(JSON.stringify(["EVENT", subId, channelMetadata]));
                for (const extra of options.extraChannels ?? []) {
                  ws.send(JSON.stringify(["EVENT", subId, extra]));
                }
              } else if (filter.kinds.includes(30078)) {
                for (const readState of options.readStateEvents ?? []) {
                  ws.send(JSON.stringify(["EVENT", subId, readState]));
                }
              } else if (filter.kinds.includes(9) && filter["#p"]) {
                // The notification subscriptions. Scoped by tag rather than by
                // channel, so they need their own branches — the `#h` one below
                // would inject its synthetic channel message under a filter that
                // never asked for a room.
                for (const extra of options.extraMessages ?? []) {
                  const tags = (extra as { tags: string[][] }).tags;
                  if (
                    tags.some(
                      (tag) => tag[0] === "p" && filter["#p"].includes(tag[1]),
                    )
                  ) {
                    ws.send(JSON.stringify(["EVENT", subId, extra]));
                  }
                }
              } else if (filter.kinds.includes(9) && filter["#e"]) {
                for (const extra of options.extraMessages ?? []) {
                  const tags = (extra as { tags: string[][] }).tags;
                  if (
                    tags.some(
                      (tag) => tag[0] === "e" && filter["#e"].includes(tag[1]),
                    )
                  ) {
                    ws.send(JSON.stringify(["EVENT", subId, extra]));
                  }
                }
              } else if (filter.kinds.includes(9) && filter.authors) {
                for (const extra of options.extraMessages ?? []) {
                  if (
                    filter.authors.includes(
                      (extra as { pubkey: string }).pubkey,
                    )
                  ) {
                    ws.send(JSON.stringify(["EVENT", subId, extra]));
                  }
                }
              } else if (filter.kinds.includes(9) && filter["#h"]) {
                messageSubs.push({ subId, channelId: filter["#h"][0] });
                /**
                 * Serve a fixture only if the filter actually named its kind.
                 *
                 * A relay would. The mock did not, which meant a client that
                 * forgot to subscribe to edits or tombstones still saw them here
                 * and failed only in production — which is exactly what happened
                 * with kinds 40003 and 9005.
                 */
                const wanted = (event: unknown) =>
                  filter.kinds.includes((event as { kind: number }).kind);
                // Echo the requested channel back on the `h` tag so a spec that
                // opens two rooms sees each one's own timeline.
                ws.send(
                  JSON.stringify([
                    "EVENT",
                    subId,
                    {
                      ...message,
                      // Real event ids are 64 hex chars; the channel UUID's
                      // dashes would make this an id no relay could emit, and a
                      // spec asserting on cursor shape would fail on the
                      // fixture rather than on the client.
                      id: `${filter["#h"][0]}`
                        .replace(/-/g, "")
                        .padEnd(64, "0")
                        .slice(0, 64),
                      tags: [["h", filter["#h"][0]]],
                    },
                  ]),
                );
                for (const extra of options.extraMessages ?? []) {
                  if (wanted(extra)) {
                    ws.send(JSON.stringify(["EVENT", subId, extra]));
                  }
                }
              } else if (filter.kinds.includes(39007)) {
                // Live badge updates. The relay never stores these, so a real
                // subscription only carries what happens after it opens — the
                // initial picture comes from `POST /query`. The mock replays the
                // seeded state here anyway, so a spec that breaks the query path
                // cannot be rescued by the socket without the query assertions
                // noticing.
                for (const snapshot of activitySnapshots()) {
                  ws.send(JSON.stringify(["EVENT", subId, snapshot]));
                }
              } else if (filter.kinds.includes(20002)) {
                for (const typing of options.typingEvents ?? []) {
                  ws.send(JSON.stringify(["EVENT", subId, typing]));
                }
              } else if (filter.kinds.includes(7)) {
                // The reaction subscription is keyed on `e`, not `h`, so it has
                // no channel of its own — it takes every echo.
                messageSubs.push({ subId, channelId: "" });
                // The #e-keyed auxiliary read: reactions and NIP-09 deletes,
                // neither of which carries an `h` tag.
                for (const aux of options.auxEvents ?? []) {
                  ws.send(JSON.stringify(["EVENT", subId, aux]));
                }
              }
              ws.send(JSON.stringify(["EOSE", subId]));
            }
          });
        },
      );
    },
  };
}

test("the top page is chat, with the app shell around it", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");

  // The shell: community rail, channel list, and the identity card at its foot.
  await expect(
    page.getByRole("navigation", { name: "Communities" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Channels" }).getByText("general"),
  ).toBeVisible();
  await expect(page.getByTestId("sidebar-profile-card")).toBeVisible();
  // No channel chosen yet, so the content pane offers the rooms instead of
  // pointing at a sidebar that may be collapsed.
  await expect(
    page.getByRole("heading", { name: "Welcome to nuxx" }),
  ).toBeVisible();
});

test("the legacy /c link still lands on chat", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  // Shared links and bookmarks from before chat moved to `/` must not 404.
  await page.goto("/c?q=ship");
  await expect(page).toHaveURL(/\/\?q=ship$/);
});

test("the sidebar survives channel navigation without reconnecting", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await expect(page.getByText("Connected")).toBeVisible();
  const socketsAfterLoad = relay.socketCount();

  await page
    .getByRole("navigation", { name: "Channels" })
    .getByText("general")
    .click();
  await expect(page.getByRole("heading", { name: "#general" })).toBeVisible();

  // The shell is a layout route, so the authenticated socket is reused. A
  // per-page provider would have opened a second one here.
  expect(relay.socketCount()).toBe(socketsAfterLoad);
});

test("starring a channel moves it under Starred", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  // The heading does not exist until something is starred, so an empty Starred
  // section never takes up room.
  await expect(page.getByTestId("sidebar-group-starred")).toBeHidden();

  // Starring lives in the row's action menu, alongside mute and leave.
  await page.getByTestId("channel-menu-general").click();
  await page.getByTestId("menu-toggle-star").click();
  const starred = page.getByTestId("sidebar-group-starred");
  await expect(starred.getByText("general")).toBeVisible();
  // Only under Starred: listing it twice would double the unread badge and make
  // the room count look wrong.
  await expect(
    page.getByTestId("sidebar-group-channels").getByText("general"),
  ).toHaveCount(0);
});

test("a star survives a reload for a durable identity", async ({ page }) => {
  // Stars are stored locally, keyed by pubkey — a private view preference should
  // not be published to the community. That key is what makes this test need a
  // NIP-07 identity: without an extension the signer mints a fresh key per page
  // load, so there is no identity for a preference to belong to.
  await page.addInitScript(() => {
    (
      window as Window & {
        nostr?: {
          getPublicKey(): Promise<string>;
          signEvent(
            event: Record<string, unknown>,
          ): Promise<Record<string, unknown>>;
        };
      }
    ).nostr = {
      async getPublicKey() {
        return "ab".repeat(32);
      },
      async signEvent(event) {
        return { ...event, id: "cd".repeat(32), sig: "ef".repeat(64) };
      },
    };
  });
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("channel-menu-general").click();
  await page.getByTestId("menu-toggle-star").click();
  await expect(
    page.getByTestId("sidebar-group-starred").getByText("general"),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByTestId("sidebar-group-starred").getByText("general"),
  ).toBeVisible();
});

test("chat lists channels from kind:39000 metadata", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/c");

  await expect(
    page.getByRole("navigation", { name: "Channels" }).getByText("general"),
  ).toBeVisible();
  // No NIP-07 extension in a plain browser, so custody must be shown as
  // disposable rather than silently assumed durable.
  await expect(page.getByText("temporary identity")).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible();
});

test("opening a channel renders its timeline", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/c");
  await page
    .getByRole("navigation", { name: "Channels" })
    .getByText("general")
    .click();

  await expect(page.getByRole("heading", { name: "#general" })).toBeVisible();
  await expect(page.getByText("ship it")).toBeVisible();
  await expect(page.getByText("hello from the mocked relay")).toBeVisible();
});

test("sending a message publishes kind:9 with the channel h tag", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/c/11111111-1111-1111-1111-111111111111");

  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.fill("sent from the browser");
  await page.getByRole("button", { name: "Send" }).click();

  // The composer clears only after the relay OKs the event.
  await expect(composer).toHaveText("");
  await expect(page.getByText("sent from the browser")).toBeVisible();

  // Read state publishes on the same stream, so scope to the message kind.
  const messages = relay.published.filter(
    (published) => (published as { kind: number }).kind === 9,
  );
  expect(messages).toHaveLength(1);
  const event = messages[0] as {
    kind: number;
    tags: string[][];
    content: string;
  };
  expect(event.kind).toBe(9);
  expect(event.tags).toContainEqual([
    "h",
    "11111111-1111-1111-1111-111111111111",
  ]);
  expect(event.content).toBe("sent from the browser");
});

const CHANNEL_UUID = "11111111-1111-1111-1111-111111111111";

/**
 * A DM's group metadata, as the relay emits it: hidden, `t:dm`, and carrying the
 * participants as `p` tags so a client can label it without a second fetch.
 */
function dmChannel(channelId: string) {
  return {
    id: channelId.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
    pubkey: "b".repeat(64),
    kind: 39000,
    created_at: 1_700_000_500,
    tags: [
      ["d", channelId],
      ["name", "dm"],
      ["hidden"],
      ["closed"],
      ["t", "dm"],
      ["p", MY_PUBKEY],
      ["p", "e".repeat(64)],
    ],
    content: "",
    sig: "c".repeat(128),
  };
}

function markdownMessage(id: string, content: string, tags: string[][] = []) {
  return {
    id: id.repeat(64).slice(0, 64),
    pubkey: "e".repeat(64),
    kind: 9,
    created_at: 1_700_000_200,
    tags: [["h", CHANNEL_UUID], ...tags],
    content,
    sig: "f".repeat(128),
  };
}

test("Enter sends and Shift+Enter is a line break", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.click();
  await composer.pressSequentially("first");
  await page.keyboard.press("Shift+Enter");
  await composer.pressSequentially("second");
  // Still unsent: Shift+Enter is a line break, not a send.
  expect(
    relay.published.filter((event) => (event as { kind: number }).kind === 9),
  ).toEqual([]);

  await page.keyboard.press("Enter");

  await expect
    .poll(() =>
      relay.published.some((event) => (event as { kind: number }).kind === 9),
    )
    .toBe(true);
  const sent = relay.published.find(
    (event) => (event as { kind: number }).kind === 9,
  ) as { content: string };
  // One newline, which the renderer turns into a line break — not a paragraph
  // split, and not two separate messages.
  expect(sent.content).toBe("first\nsecond");
});

test("markdown shorthand becomes markup and serializes back", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.click();
  // Typed as shorthand, applied as marks by the editor's input rules.
  await composer.pressSequentially("**bold** and `code`");
  await expect(composer.locator("strong")).toHaveText("bold");
  await expect(composer.locator("code")).toHaveText("code");

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      relay.published.some((event) => (event as { kind: number }).kind === 9),
    )
    .toBe(true);
  const sent = relay.published.find(
    (event) => (event as { kind: number }).kind === 9,
  ) as { content: string };
  // The event carries markdown, because that is what every other client reads.
  expect(sent.content).toBe("**bold** and `code`");
});

test("message content renders markdown", async ({ page }) => {
  const relay = mockRelay(page, {
    extraMessages: [
      markdownMessage(
        "1",
        "**bold** and `inline code`\n\n```\nconst x = 1;\n```\n\n- first\n- second",
      ),
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  await expect(page.getByText("bold", { exact: true })).toHaveJSProperty(
    "tagName",
    "STRONG",
  );
  await expect(page.getByText("inline code")).toBeVisible();
  await expect(page.locator("pre code")).toContainText("const x = 1;");
  // Anchored: a timeline row is itself an <li>, so a substring match would also
  // hit the row wrapping this markdown list.
  await expect(
    page.getByRole("listitem").filter({ hasText: /^first$/ }),
  ).toBeVisible();
});

test("external links open safely and unsafe schemes are not clickable", async ({
  page,
}) => {
  const relay = mockRelay(page, {
    extraMessages: [
      markdownMessage(
        "2",
        "[docs](https://example.com/docs) and [do not click](javascript:alert(1))",
      ),
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  const external = page.getByRole("link", { name: "docs" });
  await expect(external).toHaveAttribute("target", "_blank");
  // `noopener` denies the opened page window.opener; `noreferrer` withholds the
  // relay host from its Referer.
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");

  // A javascript: URL must never become an activatable anchor.
  await expect(page.getByText("do not click")).toBeVisible();
  await expect(page.getByRole("link", { name: "do not click" })).toHaveCount(0);
});

test("a nuxx://message autolink becomes in-app navigation", async ({
  page,
}) => {
  const target = "a".repeat(64);
  const relay = mockRelay(page, {
    extraMessages: [
      markdownMessage(
        "3",
        `see <nuxx://message?channel=${CHANNEL_UUID}&id=${target}>`,
      ),
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  // An autolink has no author-written label, so it renders as a compact pill
  // rather than the raw URL.
  const pill = page.getByRole("link", { name: "message" });
  await expect(pill).toHaveAttribute("href", `/c/${CHANNEL_UUID}?m=${target}`);
});

test("an image is sized from its NIP-92 imeta dim before it loads", async ({
  page,
}) => {
  const url = "https://media.example.invalid/shot.png";
  const relay = mockRelay(page, {
    extraMessages: [
      markdownMessage("4", `![shot](${url})`, [
        ["imeta", `url ${url}`, "m image/png", "dim 800x600"],
      ]),
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  // Explicit intrinsic dimensions let the browser reserve aspect-correct space,
  // so a late decode cannot shove the timeline down.
  const image = page.locator('img[alt="shot"]');
  await expect(image).toHaveAttribute("width", "800");
  await expect(image).toHaveAttribute("height", "600");
});

test("reactions render from #e-keyed events and toggle", async ({ page }) => {
  const target = markdownMessage("7", "react to me");
  const relay = mockRelay(page, {
    extraMessages: [target],
    auxEvents: [
      {
        id: "aa".repeat(32),
        pubkey: "cc".repeat(32),
        kind: 7,
        created_at: 1_700_000_300,
        // A reaction carries only an `e` tag — no `h` — so it is only reachable
        // through the #e subscription.
        tags: [["e", target.id]],
        content: "🎉",
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  const pill = page.getByRole("button", { name: "🎉 1" });
  await expect(pill).toBeVisible();
  // Not the reader's own reaction, so it is not shown as pressed.
  await expect(pill).toHaveAttribute("aria-pressed", "false");

  await pill.click();
  await expect(page.getByRole("button", { name: "🎉 2" })).toBeVisible();

  const reaction = relay.published.find(
    (event) => (event as { kind: number }).kind === 7,
  ) as { kind: number; tags: string[][]; content: string };
  expect(reaction.content).toBe("🎉");
  expect(reaction.tags).toEqual([["e", target.id]]);
});

test("a quick reaction publishes kind:7 against the message", async ({
  page,
}) => {
  const target = markdownMessage("8", "quick react");
  const relay = mockRelay(page, { extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  await page.getByRole("button", { name: "React with 👍" }).first().click();
  await expect(page.getByRole("button", { name: "👍 1" })).toBeVisible();
  // The reader's own reaction reads as pressed, so a second click withdraws it.
  await expect(page.getByRole("button", { name: "👍 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("replying publishes thread tags and shows the reply count", async ({
  page,
}) => {
  const root = markdownMessage("9", "the original");
  const relay = mockRelay(page, { extraMessages: [root] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  // Scope to the intended row: the mock also serves a baseline message, and a
  // bare `.first()` would reply to that instead.
  const rootRow = page
    .getByRole("listitem")
    .filter({ hasText: "the original" });
  await rootRow.getByRole("button", { name: "Reply in thread" }).click();
  await expect(page.getByText(/Replying to/)).toBeVisible();

  const composer = page.getByRole("textbox", { name: /^Reply to/ });
  await composer.fill("a threaded answer");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(rootRow.getByText("1 reply")).toBeVisible();

  // Scoped to kind 9: a typing announcement carries the same thread tags, so a
  // tag-only match would find the indicator instead of the message.
  const reply = relay.published.find(
    (event) =>
      (event as { kind: number }).kind === 9 &&
      (event as { tags: string[][] }).tags.some((tag) => tag[3] === "reply"),
  ) as { kind: number; tags: string[][] };
  expect(reply.kind).toBe(9);
  // Root === parent for a direct reply, which nuxx-sdk collapses to one tag.
  expect(reply.tags).toContainEqual(["e", root.id, "", "reply"]);
  expect(reply.tags).toContainEqual(["h", CHANNEL_UUID]);
});

test("creating a channel publishes kind:9007 and opens the room", async ({
  page,
}) => {
  // A NIP-29 command: the relay validates it and publishes the group metadata,
  // which is why nothing is inserted optimistically.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("open-create-channel").click();
  await page.getByTestId("create-channel-name").fill("#Design Review");

  // The preview shows what the relay's own canonicalization will produce —
  // leading `#` stripped, nothing else touched.
  await expect(page.getByTestId("create-channel-name-preview")).toContainText(
    "Design Review",
  );

  // Type and visibility are value rows: the row shows the current answer and
  // opens a menu of the alternatives.
  await page.getByTestId("create-channel-visibility").click();
  await page.getByTestId("create-channel-visibility-private").click();
  await expect(page.getByTestId("create-channel-visibility")).toContainText(
    "Private",
  );
  await page.getByTestId("create-channel-type").click();
  await page.getByTestId("create-channel-type-forum").click();
  await expect(page.getByTestId("create-channel-type")).toContainText("Forum");
  await page.getByTestId("create-channel-about").fill("weekly");
  await page.getByTestId("create-channel-submit").click();

  const created = relay.published.find(
    (event) => (event as { kind: number }).kind === 9007,
  ) as { tags: string[][] };
  expect(created.tags).toContainEqual(["name", "Design Review"]);
  expect(created.tags).toContainEqual(["visibility", "private"]);
  expect(created.tags).toContainEqual(["channel_type", "forum"]);
  expect(created.tags).toContainEqual(["about", "weekly"]);
  // The client picks the id, because the `h` tag has to exist before the relay
  // can scope anything to it.
  const hTag = created.tags.find((tag) => tag[0] === "h");
  expect(hTag?.[1]).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page).toHaveURL(new RegExp(`/c/${hTag?.[1]}$`));
});

test("muting a channel dims it but keeps an unread room legible", async ({
  page,
}) => {
  // The one time a reader who muted a room still asked to be told.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("channel-menu-general").click();
  await page.getByTestId("menu-toggle-mute").click();

  // A standalone `opacity-50`, not the base variant's `disabled:opacity-50` —
  // a loose match here would pass whether or not the row was ever dimmed.
  const dimmed = /(^|\s)opacity-50(\s|$)/;
  const row = page.getByTestId("channel-general");
  await expect(row).toHaveClass(dimmed);
  await expect(page.getByLabel("Muted")).toBeVisible();

  // Unmuting is the same menu item, now inverted.
  // Reopening the same menu after acting in it is the case that broke: a closing
  // panel whose exit animation was interrupted by its own action stayed mounted
  // and dismissed every later open. See `shared/ui/dropdown-menu.tsx`.
  await page.getByTestId("channel-menu-general").click();
  await page.getByTestId("menu-toggle-mute").click();
  await expect(row).not.toHaveClass(dimmed);
  await expect(page.getByLabel("Muted")).toHaveCount(0);
});

test("right-click reaches the same channel actions as the button", async ({
  page,
}) => {
  // The button appears on hover, so it is a mouse-only path. Right-click is the
  // one the desktop client had, and both menus are built from the same item list.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("channel-general").click({ button: "right" });
  await expect(page.getByTestId("context-toggle-mute")).toBeVisible();
  await expect(page.getByTestId("context-toggle-star")).toBeVisible();
  await expect(page.getByTestId("context-leave-channel")).toBeVisible();

  await page.getByTestId("context-toggle-mute").click();
  await expect(page.getByLabel("Muted")).toBeVisible();

  // And it reopens, for the same reason the button's menu has to.
  await page.getByTestId("channel-general").click({ button: "right" });
  await page.getByTestId("context-toggle-mute").click();
  await expect(page.getByLabel("Muted")).toHaveCount(0);
});

test("leaving a channel publishes kind:9022 and leaves the room", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId("channel-menu-general").click();
  await page.getByTestId("menu-leave-channel").click();

  const left = relay.published.find(
    (event) => (event as { kind: number }).kind === 9022,
  ) as { tags: string[][] };
  expect(left.tags).toEqual([["h", CHANNEL_UUID]]);
  // Staying would leave the reader looking at a timeline they can no longer load.
  await expect(page).toHaveURL(/\/$/);
});

test("a DM is listed and titled by who is in it", async ({ page }) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    extraChannels: [dmChannel("22222222-2222-2222-2222-222222222222")],
    profileEvents: [
      {
        id: "0b".repeat(32),
        pubkey: "e".repeat(64),
        kind: 0,
        created_at: 1_700_000_000,
        tags: [],
        content: JSON.stringify({ display_name: "Erin Example" }),
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto("/");
  // Not under Channels: the relay marks a DM hidden, and it is read as a
  // conversation rather than as a room.
  const dms = page.getByTestId("sidebar-group-dms");
  await expect(dms.getByText("Erin Example")).toBeVisible();
  await expect(
    page.getByTestId("sidebar-group-channels").getByText("Erin Example"),
  ).toHaveCount(0);

  await dms.getByText("Erin Example").click();
  // No hash: it is a person, and "#Erin Example" reads as a channel that does
  // not exist.
  await expect(
    page.getByRole("heading", { name: "Erin Example", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Erin Example" }),
  ).toBeVisible();
});

test("opening a DM publishes kind:41010 with only p tags", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("open-new-dm").click();
  // The pasted-key path stays first-class: someone who shares no channel with
  // the reader is not in the directory and cannot be searched for.
  for (const key of ["a".repeat(64), "b".repeat(64)]) {
    await page.getByTestId("new-dm-search").fill(key);
    await page.getByTestId("new-dm-add-pubkey").click();
  }
  await page.getByTestId("new-dm-submit").click();

  const opened = relay.published.find(
    (event) => (event as { kind: number }).kind === 41010,
  ) as { tags: string[][] };
  expect(opened.tags).toEqual([
    ["p", "a".repeat(64)],
    ["p", "b".repeat(64)],
  ]);
  // No `h` tag: the relay allocates the channel, so this client never derives an
  // id for a set of people.
  expect(opened.tags.every((tag) => tag[0] !== "h")).toBe(true);
});

test("a DM cannot be opened without a whole public key", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("open-new-dm").click();
  await page.getByTestId("new-dm-search").fill("alice");
  // Not a whole key and not anyone in the directory: nothing to add, so there is
  // nobody to open a conversation with.
  await expect(page.getByTestId("new-dm-add-pubkey")).toHaveCount(0);
  await expect(page.getByTestId("new-dm-submit")).toBeDisabled();
  expect(
    relay.published.filter(
      (event) => (event as { kind: number }).kind === 41010,
    ),
  ).toEqual([]);
});

/** A kind:39002 member list, which is where the directory comes from. */
function memberList(channelId: string, members: [string, string][]) {
  return {
    id: `39002${channelId.replace(/-/g, "")}`.padEnd(64, "0").slice(0, 64),
    pubkey: "b".repeat(64),
    kind: 39002,
    created_at: 1_700_000_000,
    tags: [
      ["d", channelId],
      ...members.map(([pubkey, role]) => ["p", pubkey, "", role]),
    ],
    content: "",
    sig: "f".repeat(128),
  };
}

const MENTIONABLE = "e".repeat(64);

/** Directory fixtures: one member with a profile, in the default channel. */
function directoryOptions() {
  return {
    memberEvents: [
      memberList(CHANNEL_UUID, [
        [MENTIONABLE, "admin"],
        [MY_PUBKEY, "member"],
      ]),
    ],
    profileEvents: [
      {
        id: "0c".repeat(32),
        pubkey: MENTIONABLE,
        kind: 0,
        created_at: 1_700_000_000,
        tags: [],
        content: JSON.stringify({ display_name: "Erin Example", name: "erin" }),
        sig: "f".repeat(128),
      },
    ],
  };
}

test("a mention completes from the directory and publishes a p tag", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, directoryOptions());
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  // The handle finds the display name: an author types what they remember.
  await composer.fill("@eri");
  await page.getByTestId("user-picker-Erin Example").click();
  await expect(composer).toHaveText("@Erin Example");

  await composer.fill("@Erin Example please look");
  await page.getByRole("button", { name: "Send" }).click();

  const sent = relay.published.find(
    (event) =>
      (event as { kind: number }).kind === 9 &&
      (event as { content: string }).content.includes("please look"),
  ) as { tags: string[][] };
  // The `p` tag is what notifies, and it carries the pubkey the author chose
  // rather than a name parsed back out of the text.
  expect(sent.tags).toContainEqual(["p", MENTIONABLE]);
});

test("a mention deleted before sending notifies nobody", async ({ page }) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, directoryOptions());
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.fill("@eri");
  await page.getByTestId("user-picker-Erin Example").click();
  // The author thinks better of it and removes the name.
  await composer.fill("never mind");
  await page.getByRole("button", { name: "Send" }).click();

  const sent = relay.published.find(
    (event) =>
      (event as { kind: number }).kind === 9 &&
      (event as { content: string }).content === "never mind",
  ) as { tags: string[][] };
  expect(sent.tags.every((tag) => tag[0] !== "p")).toBe(true);
});

test("a known name renders as a mention chip, an unknown one does not", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...directoryOptions(),
    extraMessages: [
      markdownMessage("b", "@Erin Example and @Nobody Here", [
        ["p", MENTIONABLE],
      ]),
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.locator("[data-mention]")).toHaveCount(1);
  await expect(page.locator("[data-mention]")).toHaveText("@Erin Example");
  // A chip asserts this client resolved a person; an unknown handle stays text.
  await expect(page.getByText("@Nobody Here")).toBeVisible();
});

/** A kind:30030 emoji set, which is where the palette comes from. */
function emojiSet(pubkey: string, entries: [string, string][]) {
  return {
    id: `30030${pubkey}`.padEnd(64, "0").slice(0, 64),
    pubkey,
    kind: 30030,
    created_at: 1_700_000_000,
    tags: [
      ["d", "nuxx"],
      ...entries.map(([code, url]) => ["emoji", code, url]),
    ],
    content: "",
    sig: "f".repeat(128),
  };
}

const SHIPIT_URL = "https://example.com/shipit.png";

test("a custom emoji completes in the composer and travels with the message", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...directoryOptions(),
    emojiEvents: [emojiSet(MENTIONABLE, [["shipit", SHIPIT_URL]])],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.fill("ready :shi");
  await page.getByTestId("emoji-shipit").click();
  await expect(composer).toHaveText("ready :shipit:");
  await page.getByRole("button", { name: "Send" }).click();

  const sent = relay.published.find(
    (event) =>
      (event as { kind: number }).kind === 9 &&
      (event as { content: string }).content.includes(":shipit:"),
  ) as { tags: string[][] };
  // NIP-30: the definition travels with the event, or a client that has never
  // seen the author's set renders the literal text.
  expect(sent.tags).toContainEqual(["emoji", "shipit", SHIPIT_URL]);
});

test("a defined shortcode renders as an image, an undefined one as text", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    extraMessages: [
      markdownMessage("c", "shipping :shipit: not :nope:", [
        ["emoji", "shipit", SHIPIT_URL],
      ]),
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const emoji = page.locator("img[data-emoji]");
  await expect(emoji).toHaveCount(1);
  await expect(emoji).toHaveAttribute("src", SHIPIT_URL);
  // An undefined shortcode is left exactly as the author typed it.
  await expect(page.getByText(":nope:")).toBeVisible();
});

test("a custom reaction carries its definition", async ({ page }) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...directoryOptions(),
    emojiEvents: [emojiSet(MENTIONABLE, [["shipit", SHIPIT_URL]])],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByText("hello from the mocked relay").hover();
  await page.getByTestId("open-reaction-picker").click();
  await page.getByTestId("emoji-shipit").click();

  const reaction = relay.published.find(
    (event) => (event as { kind: number }).kind === 7,
  ) as { content: string; tags: string[][] };
  expect(reaction.content).toBe(":shipit:");
  // A kind:7 whose content is a shortcode and which carries no `emoji` tag is a
  // pill every other client draws as literal text.
  expect(reaction.tags).toContainEqual(["emoji", "shipit", SHIPIT_URL]);
});

test("the reaction picker is portalled, and reopens after being used", async ({
  page,
}) => {
  // It used to be positioned with `absolute` inside the action bar, which clipped
  // it in the scrolling timeline and needed the bar lifted above the next row's.
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...directoryOptions(),
    emojiEvents: [emojiSet(MENTIONABLE, [["shipit", SHIPIT_URL]])],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const message = page.getByText("hello from the mocked relay");
  await message.hover();
  await page.getByTestId("open-reaction-picker").click();
  await expect(page.getByTestId("emoji-picker")).toBeVisible();

  // Outside the action bar entirely, which is what stops it being clipped.
  expect(
    await page
      .getByTestId("emoji-picker")
      .evaluate((node) =>
        Boolean(node.closest('[data-testid="message-action-bar"]')),
      ),
  ).toBe(false);

  // Picking an emoji re-renders the timeline, which is the interruption that used
  // to strand a closing panel and leave the picker unopenable afterwards.
  await page.getByTestId("emoji-shipit").click();
  await expect(page.getByTestId("emoji-picker")).toHaveCount(0);
  await message.hover();
  await page.getByTestId("open-reaction-picker").click();
  await expect(page.getByTestId("emoji-picker")).toBeVisible();
});

test("adding a custom emoji publishes the whole kind:30030 set", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    emojiEvents: [emojiSet(MY_PUBKEY, [["wave", "https://example.com/w.png"]])],
  });
  await relay.install();

  await page.goto("/settings");
  // Custom emoji moved under the Channels panel when Settings became a left nav.
  await page.getByTestId("settings-nav-channels").click();
  await page.getByTestId("emoji-shortcode").fill("shipit");
  await page.getByTestId("emoji-url").fill(SHIPIT_URL);
  await page.getByTestId("add-emoji").click();

  const set = relay.published.find(
    (event) => (event as { kind: number }).kind === 30030,
  ) as { tags: string[][] };
  // The set is addressable, so the published event is the whole new state —
  // the existing emoji has to be republished alongside the new one.
  expect(set.tags).toEqual([
    ["d", "nuxx"],
    ["emoji", "wave", "https://example.com/w.png"],
    ["emoji", "shipit", SHIPIT_URL],
  ]);
});

test("a DM addresses its participants even when the text names nobody", async ({
  page,
}) => {
  const DM_UUID = "22222222-2222-2222-2222-222222222222";
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { extraChannels: [dmChannel(DM_UUID)] });
  await relay.install();

  await page.goto(`/c/${DM_UUID}`);
  await page
    .getByRole("textbox", { name: /^Message / })
    .fill("just between us");
  await page.getByRole("button", { name: "Send" }).click();

  const sent = relay.published.find(
    (event) =>
      (event as { kind: number }).kind === 9 &&
      (event as { content: string }).content === "just between us",
  ) as { tags: string[][] };
  // The other participant, and not the sender: a client that tagged its own
  // author would badge every conversation the moment it spoke in one.
  expect(sent.tags).toContainEqual(["p", MENTIONABLE]);
  expect(sent.tags).not.toContainEqual(["p", MY_PUBKEY]);
});

test("the channel browser lists open rooms this reader is not in", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const openId = "33333333-3333-3333-3333-333333333333";
  const secretId = "44444444-4444-4444-4444-444444444444";
  const browsable = (id: string, name: string, extra: string[][] = []) => ({
    id: id.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
    pubkey: "b".repeat(64),
    kind: 39000,
    created_at: 1_700_000_600,
    tags: [
      ["d", id],
      ["name", name],
      ["about", `${name} room`],
      ["closed"],
      ["t", "stream"],
      ...extra,
    ],
    content: "",
    sig: "c".repeat(128),
  });
  const relay = mockRelay(page, {
    extraChannels: [
      browsable(openId, "release", [["public"]]),
      browsable(secretId, "secret", [["private"]]),
    ],
    // The reader is in #general only.
    memberEvents: [memberList(CHANNEL_UUID, [[MY_PUBKEY, "member"]])],
  });
  await relay.install();

  await page.goto("/browse");
  await expect(page.getByTestId("browse-channel-release")).toBeVisible();
  // Already joined, so it is not on offer.
  await expect(
    page.getByTestId("browse-available").getByText("general"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("browse-joined").getByText("general"),
  ).toBeVisible();
  // Private: its metadata is visible but the relay would refuse the join, and a
  // button that fails is worse than no button.
  await expect(page.getByTestId("browse-channel-secret")).toHaveCount(0);

  await page.getByTestId("browse-search").fill("release");
  await expect(page.getByTestId("browse-channel-release")).toBeVisible();
  await page.getByTestId("browse-search").fill("nothing matches this");
  await expect(page.getByTestId("browse-available-empty")).toBeVisible();
});

test("joining from the browser publishes kind:9021", async ({ page }) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const openId = "33333333-3333-3333-3333-333333333333";
  const relay = mockRelay(page, {
    extraChannels: [
      {
        id: openId.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        pubkey: "b".repeat(64),
        kind: 39000,
        created_at: 1_700_000_600,
        tags: [
          ["d", openId],
          ["name", "release"],
          ["public"],
          ["closed"],
          ["t", "stream"],
        ],
        content: "",
        sig: "c".repeat(128),
      },
    ],
    memberEvents: [memberList(CHANNEL_UUID, [[MY_PUBKEY, "member"]])],
  });
  await relay.install();

  await page.goto("/browse");
  await page.getByTestId("browse-join-release").click();

  const join = relay.published.find(
    (event) => (event as { kind: number }).kind === 9021,
  ) as { tags: string[][] };
  expect(join.tags).toEqual([["h", openId]]);
});

test("an unsent draft survives a channel switch and a reload", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const other = "22222222-2222-2222-2222-222222222222";
  const relay = mockRelay(page, {
    extraChannels: [
      {
        ...dmChannel(other),
        tags: [
          ["d", other],
          ["name", "random"],
          ["public"],
          ["closed"],
          ["t", "stream"],
        ],
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page
    .getByRole("textbox", { name: "Message #general" })
    .fill("half a thought");
  // The sidebar says where unsent text is — a reader who wandered off needs to
  // find it again without opening every room.
  await expect(page.getByTestId("channel-draft-general")).toBeHidden();

  await page.getByTestId("channel-random").click();
  const otherComposer = page.getByRole("textbox", { name: "Message #random" });
  // Each room's draft is its own: the text does not follow the reader.
  await expect(otherComposer).toHaveText("");
  await expect(page.getByTestId("channel-draft-general")).toBeVisible();

  await page.reload();
  await page.getByTestId("channel-general").click();
  await expect(
    page.getByRole("textbox", { name: "Message #general" }),
  ).toHaveText("half a thought");

  // Nothing was published: a draft is not a message, and half-written text is
  // the last thing that should reach an event store other clients read.
  expect(
    relay.published.filter((event) => (event as { kind: number }).kind === 9),
  ).toEqual([]);
});

test("sending clears the draft, and a failed send keeps it", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.fill("this one goes out");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(composer).toHaveText("");

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message #general" }),
  ).toHaveText("");
});

test("an edit and a tombstone from the relay both reach the timeline", async ({
  page,
}) => {
  // Both carry an `h` tag, so both belong on the channel subscription. Naming
  // only the content kinds renders a timeline that looks complete and silently
  // ignores every edit and every removal — which is what this client did.
  const target = markdownMessage("1", "before the edit");
  const doomed = markdownMessage("2", "about to go");
  const relay = mockRelay(page, {
    extraMessages: [
      target,
      doomed,
      {
        id: "ed".repeat(32),
        pubkey: target.pubkey,
        kind: 40003,
        created_at: 1_700_000_400,
        tags: [
          ["h", CHANNEL_UUID],
          ["e", target.id],
        ],
        content: "after the edit",
        sig: "f".repeat(128),
      },
      {
        id: "de".repeat(32),
        pubkey: doomed.pubkey,
        kind: 9005,
        created_at: 1_700_000_500,
        tags: [
          ["h", CHANNEL_UUID],
          ["e", doomed.id],
        ],
        content: "",
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  await expect(page.getByText("after the edit")).toBeVisible();
  await expect(page.getByText("before the edit")).toHaveCount(0);
  await expect(page.getByText("(edited)").first()).toBeVisible();

  await expect(page.getByText("Message deleted")).toBeVisible();
  await expect(page.getByText("about to go")).toHaveCount(0);

  // And the subscription that carried them named its kinds, as the relay's
  // p-gate requires.
  const channelSubs = relay.subscriptions.filter(
    (filter) => filter.kinds?.includes(9) && filter["#h"],
  );
  expect(channelSubs.length).toBeGreaterThan(0);
  for (const filter of channelSubs) {
    expect(filter.kinds).toContain(40003);
    expect(filter.kinds).toContain(9005);
  }
});

test("each day heading is scoped to its own day", async ({ page }) => {
  // Flat sticky siblings all pin at the same offset, so a second day's heading
  // covers the first instead of pushing it away.
  const yesterday = Math.floor(Date.now() / 1000) - 26 * 60 * 60;
  const relay = mockRelay(page, {
    extraMessages: [
      { ...markdownMessage("1", "older day"), created_at: yesterday },
      {
        ...markdownMessage("2", "newer day"),
        created_at: Math.floor(Date.now() / 1000) - 60,
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("newer day")).toBeVisible();

  const headings = page.getByTestId("message-timeline-day-divider");
  const labels = await headings.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-day-label")),
  );
  // Distinct days, each with its own heading — not one heading repeated.
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels).toContain("Today");
});

test("a message is attributed to its author's display name", async ({
  page,
}) => {
  // Everything that names a person goes through one resolver, so a kind:0
  // display name has to replace the truncated pubkey everywhere at once.
  const relay = mockRelay(page, {
    profileEvents: [
      {
        id: "0a".repeat(32),
        pubkey: "e".repeat(64),
        kind: 0,
        created_at: 1_700_000_000,
        tags: [],
        content: JSON.stringify({
          display_name: "Erin Example",
          name: "erin",
        }),
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("Erin Example").first()).toBeVisible();
  await expect(page.getByText("eeeeeeee…eeee")).toHaveCount(0);
});

test("an author with no profile still has a name to show", async ({ page }) => {
  // The truncated pubkey is the last resort, not an error state: a community
  // where nobody has published kind:0 must still be readable.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("eeeeeeee…eeee").first()).toBeVisible();
});

test("profiles are fetched once per identity, not once per row", async ({
  page,
}) => {
  // The store exists to stop a per-viewport refetch. Four messages from one
  // author must produce one lookup for that author, coalesced into one request.
  const relay = mockRelay(page, {
    extraMessages: [
      { ...markdownMessage("1", "first"), created_at: 1_700_000_300 },
      { ...markdownMessage("2", "second"), created_at: 1_700_000_330 },
      { ...markdownMessage("3", "third"), created_at: 1_700_000_360 },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("third")).toBeVisible();

  const profileRequests = relay.queries.filter((filters) =>
    filters.some((filter) => filter.kinds?.includes(0)),
  );
  expect(profileRequests.length).toBeLessThanOrEqual(2);
  // And each one names its kind, which the relay's p-gate requires.
  for (const filters of profileRequests) {
    for (const filter of filters) {
      expect(filter.kinds).toEqual([0]);
    }
  }
});

test("saving a profile publishes kind:0 and renames the reader", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { extraMessages: [myMessage("1", "mine")] });
  await relay.install();

  await page.goto("/settings");
  await page.getByTestId("settings-display-name").fill("Dana Dev");
  await page.getByTestId("settings-name").fill("dana");
  await page.getByTestId("save-profile").click();

  const saved = relay.published.find(
    (event) => (event as { kind: number }).kind === 0,
  ) as { content: string; tags: string[][] };
  expect(JSON.parse(saved.content)).toEqual({
    display_name: "Dana Dev",
    name: "dana",
  });
  // kind:0 carries no tags — it is replaceable by author, not addressable.
  expect(saved.tags).toEqual([]);

  // The reader's own edit shows without waiting for the relay to echo it back.
  await expect(page.getByTestId("sidebar-profile-name")).toHaveText("Dana Dev");
  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("Dana Dev").first()).toBeVisible();
});

test("the theme choice survives a reload", async ({ page }) => {
  // A setting that resets on reload is worse than not offering it.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/settings");
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("theme-dark")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the palette is derived from the theme, not read from the stylesheet", async ({
  page,
}) => {
  // This is the whole point of the theme engine, and it is invisible to every
  // other assertion in this file: if `ThemeProvider` stopped applying derived
  // vars, the app would still render — just in the fallback palette nobody
  // chose. So assert the mechanism, not a color.
  const relay = mockRelay(page);
  await relay.install();
  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--background").trim(),
      ),
    )
    .not.toBe("");

  const applied = await page.evaluate(() => ({
    // An inline value on :root can only have come from the theme engine.
    inlineBackground: document.documentElement.style
      .getPropertyValue("--background")
      .trim(),
    nuxxTheme: document.documentElement.getAttribute("data-nuxx-theme"),
  }));

  // The pre-hydration fallback in globals.css. Seeing it here means the derived
  // vars never landed.
  expect(applied.inlineBackground).not.toBe("220 23.08% 94.9%");
  expect(applied.inlineBackground).not.toBe("232 23.4% 18.43%");
  // The default theme is the branded one, which is what carries the gradient.
  expect(applied.nuxxTheme).toBe("nuxx");
});

test("the branded theme paints its gradient, and other themes do not", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();
  await page.goto("/");

  const lightLayer = page.locator('[data-nuxx-gradient="light"]');
  await expect(lightLayer).toHaveCSS("opacity", "1");
  await expect(lightLayer).not.toHaveCSS("background-image", "none");

  // The layer sits at a negative z-index, so it needs the shell root to be a
  // stacking context — without one it paints behind the root's own background
  // and disappears while staying fully opaque. Opacity alone cannot see that,
  // which is why the precondition is asserted directly.
  await expect(page.getByTestId("app-surface")).toHaveCSS(
    "isolation",
    "isolate",
  );

  // A theme outside the Nuxx pair has no gradient of its own: both layers stay
  // transparent rather than one bleeding through the wrong palette.
  await page.evaluate(() => {
    localStorage.setItem("nuxx-theme", "vitesse-dark");
    localStorage.setItem("nuxx-follow-system", "false");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-nuxx-sidebar",
    /.*/,
  );
  await expect(lightLayer).toHaveCSS("opacity", "0");
  await expect(page.locator('[data-nuxx-gradient="dark"]')).toHaveCSS(
    "opacity",
    "0",
  );
});

test("a chosen theme brings its own palette, and the accent is separate", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();
  await page.goto("/settings");

  await page.getByTestId("theme-name").selectOption("vitesse-dark");
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Vitesse Dark is cream on near-black: a warm hue on the foreground is the
  // cheapest way to assert the palette actually came from the theme JSON rather
  // than from a hardcoded dark mode.
  const foregroundHue = await page.evaluate(() =>
    Number(
      document.documentElement.style
        .getPropertyValue("--foreground")
        .trim()
        .split(" ")[0],
    ),
  );
  expect(foregroundHue).toBeGreaterThan(20);
  expect(foregroundHue).toBeLessThan(70);

  // The accent is chosen, not derived, so it survives the theme deciding
  // everything else.
  await page.getByTestId("accent-6366f1").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--primary").trim(),
      ),
    )
    .toMatch(/^238/);
});

test("settings names the key custody honestly", async ({ page }) => {
  // Everything else on the page is worthless if it is signed by a key that
  // disappears, so the page has to say which case the reader is in.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/settings");
  await expect(page.getByTestId("settings-custody")).toContainText(
    /minted for this page load only/,
  );
});

test("presence and a status are published from the profile menu", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("sidebar-profile-card").click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();

  await page.getByTestId("set-presence-away").click();
  // The newest, not the first: the shell heartbeats the current status on mount,
  // so an "online" beat precedes the choice.
  await expect
    .poll(() =>
      relay.published
        .filter((event) => (event as { kind: number }).kind === 20001)
        .at(-1),
    )
    .toMatchObject({ content: "away", tags: [["status", "away"]] });

  await page.getByTestId("sidebar-profile-card").click();
  await page.getByTestId("status-preset-In a meeting").click();
  const status = relay.published.find(
    (event) => (event as { kind: number }).kind === 30315,
  ) as { content: string; tags: string[][] };
  expect(status.content).toBe("In a meeting");
  expect(status.tags).toContainEqual(["d", "general"]);
  expect(status.tags).toContainEqual(["emoji", "📅"]);

  await expect(page.getByTestId("sidebar-profile-secondary")).toContainText(
    "In a meeting",
  );
});

test("clearing a status publishes an empty replaceable event", async ({
  page,
}) => {
  // kind 30315 is parameterized-replaceable, so publishing nothing on the
  // coordinate *is* the removal. There is no delete to issue.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("sidebar-profile-card").click();
  await page.getByTestId("status-preset-Focusing").click();
  await expect(page.getByTestId("sidebar-profile-secondary")).toContainText(
    "Focusing",
  );

  await page.getByTestId("sidebar-profile-card").click();
  await page.getByTestId("clear-user-status").click();

  const cleared = relay.published
    .filter((event) => (event as { kind: number }).kind === 30315)
    .at(-1) as { content: string; tags: string[][] };
  expect(cleared.content).toBe("");
  expect(cleared.tags).toEqual([["d", "general"]]);
});

test("a burst from one author renders as one block", async ({ page }) => {
  // Grouping is what makes the timeline read as conversation rather than as a
  // log. The structural decision is unit-tested in `timeline-items`; this checks
  // it actually reaches the DOM.
  const relay = mockRelay(page, {
    extraMessages: [
      { ...markdownMessage("1", "first"), created_at: 1_700_000_300 },
      { ...markdownMessage("2", "second"), created_at: 1_700_000_330 },
      { ...markdownMessage("3", "third"), created_at: 1_700_000_360 },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("third")).toBeVisible();

  // Four messages from one author (the mock's baseline plus these three), and
  // the author line appears once — the continuations show only a time.
  const authorLines = page.getByText("eeeeeeee…eeee", { exact: true });
  await expect(authorLines).toHaveCount(1);
});

test("the timeline is dated", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(
    page.getByTestId("message-timeline-day-divider").first(),
  ).toBeVisible();
});

test("a reply lands in the thread panel, not in the channel", async ({
  page,
}) => {
  // The trade that keeps a channel readable when one thread gets busy: replies
  // are reached through the panel, and the channel keeps a summary row.
  const root = markdownMessage("9", "the original");
  const relay = mockRelay(page, { extraMessages: [root] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const rootRow = page
    .getByRole("listitem")
    .filter({ hasText: "the original" });
  await rootRow.getByRole("button", { name: "Reply in thread" }).click();

  // Replying opens the thread, because the reply would otherwise be sent
  // somewhere the reader cannot see.
  const panel = page.getByTestId("thread-panel");
  await expect(panel).toBeVisible();

  const composer = page.getByRole("textbox", { name: /^Reply to/ });
  await composer.fill("a threaded answer");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(panel.getByText("a threaded answer")).toBeVisible();
  await expect(rootRow.getByText("1 reply")).toBeVisible();
  // Still in the thread after sending: a reader mid-conversation should not have
  // to re-open it, and their next message must not land in the channel.
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toBeVisible();

  await panel.getByTestId("close-thread").click();
  await expect(panel).toBeHidden();
  // Closing returns the composer to the channel: leaving it aimed at a thread
  // the reader can no longer see is how a reply goes missing.
  await expect(
    page.getByRole("textbox", { name: "Message #general" }),
  ).toBeVisible();
  // Closed, the reply is nowhere in the channel — only its summary row is.
  await expect(page.getByText("a threaded answer")).toHaveCount(0);
  await expect(rootRow.getByText("1 reply")).toBeVisible();
});

/**
 * Author pubkey for the manage-my-own-messages specs.
 *
 * Edit and delete are offered only on the reader's own messages, so these need a
 * stable identity: without a NIP-07 extension the signer mints a fresh key per
 * page load and nothing in a fixture can belong to it.
 */
const MY_PUBKEY = "1a".repeat(32);

/** A fixture message authored by the reader rather than the mock's stranger. */
function myMessage(id: string, content: string) {
  return { ...markdownMessage(id, content), pubkey: MY_PUBKEY };
}

test("opening a thread aims the composer at it", async ({ page }) => {
  // A panel open with the composer still aimed at the channel is the trap: the
  // reader is looking at a thread, types, and the message lands in the room.
  const root = markdownMessage("9", "the subject");
  const reply = {
    ...markdownMessage("a", "an existing answer"),
    created_at: 1_700_000_300,
    tags: [
      ["h", CHANNEL_UUID],
      ["e", markdownMessage("9", "the subject").id, "", "reply"],
    ],
  };
  const relay = mockRelay(page, { extraMessages: [root, reply] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const rootRow = page.getByRole("listitem").filter({ hasText: "the subject" });
  await rootRow.getByText("1 reply").click();

  await expect(page.getByTestId("thread-panel")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Reply to/ })).toBeVisible();

  await page.getByRole("textbox", { name: /^Reply to/ }).fill("me too");
  await page.getByRole("button", { name: "Send" }).click();

  const sent = relay.published.find(
    (event) =>
      (event as { kind: number; content: string }).kind === 9 &&
      (event as { content: string }).content === "me too",
  ) as { tags: string[][] };
  expect(sent.tags).toContainEqual(["e", root.id, "", "reply"]);
});

test("editing a message publishes kind:40003 against the original", async ({
  page,
}) => {
  // A signed event cannot be rewritten, so an edit is a separate event the
  // timeline overlays. The `h` tag is what makes it visible to everyone already
  // subscribed.
  await installNip07WithNip44(page, MY_PUBKEY);
  const target = myMessage("1", "typo here");
  const relay = mockRelay(page, { extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const row = page.getByRole("listitem").filter({ hasText: "typo here" });
  await row.getByTestId("edit-message").click();

  await page.getByTestId("message-editor").fill("fixed now");
  await page.getByTestId("save-edit").click();

  await expect(page.getByText("fixed now")).toBeVisible();
  await expect(page.getByText("(edited)").first()).toBeVisible();

  const edit = relay.published.find(
    (event) => (event as { kind: number }).kind === 40003,
  ) as { tags: string[][]; content: string };
  expect(edit.content).toBe("fixed now");
  expect(edit.tags).toContainEqual(["h", CHANNEL_UUID]);
  expect(edit.tags).toContainEqual(["e", target.id]);
});

test("an unchanged edit publishes nothing", async ({ page }) => {
  // Publishing it would stamp the message "(edited)" for everyone over a change
  // that was never made.
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    extraMessages: [myMessage("1", "leave me alone")],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const row = page.getByRole("listitem").filter({ hasText: "leave me alone" });
  await row.getByTestId("edit-message").click();
  await page.getByTestId("save-edit").click();

  await expect(page.getByTestId("message-editor")).toBeHidden();
  expect(
    relay.published.filter(
      (event) => (event as { kind: number }).kind === 40003,
    ),
  ).toEqual([]);
});

test("deleting a message publishes the channel-scoped tombstone", async ({
  page,
}) => {
  // Kind 9005, not NIP-09's kind:5 — the Nuxx tombstone carries the `h` tag, so
  // readers with the timeline open see the removal.
  await installNip07WithNip44(page, MY_PUBKEY);
  const target = myMessage("1", "delete me");
  const relay = mockRelay(page, { extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const row = page.getByRole("listitem").filter({ hasText: "delete me" });
  await row.getByTestId("delete-message").click();

  await expect(page.getByText("Message deleted")).toBeVisible();
  await expect(page.getByText("delete me")).toHaveCount(0);

  const tombstone = relay.published.find(
    (event) => (event as { kind: number }).kind === 9005,
  ) as { tags: string[][] };
  expect(tombstone.tags).toContainEqual(["h", CHANNEL_UUID]);
  expect(tombstone.tags).toContainEqual(["e", target.id]);
});

test("someone else's message offers no edit or delete", async ({ page }) => {
  // The relay refuses it too, but offering a button that is going to be refused
  // is worse than not offering it. Same identity as the specs above, so the
  // contrast is authorship and nothing else.
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    extraMessages: [markdownMessage("1", "not yours")],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const row = page.getByRole("listitem").filter({ hasText: "not yours" });
  await expect(row.getByTestId("reply-in-thread")).toHaveCount(1);
  await expect(row.getByTestId("edit-message")).toHaveCount(0);
  await expect(row.getByTestId("delete-message")).toHaveCount(0);
});

test("a deleted message renders as a tombstone", async ({ page }) => {
  const target = markdownMessage("a", "will be removed");
  const relay = mockRelay(page, {
    extraMessages: [
      target,
      {
        id: "bb".repeat(32),
        pubkey: "e".repeat(64),
        kind: 9005,
        created_at: 1_700_000_400,
        tags: [
          ["h", CHANNEL_UUID],
          ["e", target.id],
          ["public_reason", "Removed as spam"],
        ],
        content: "",
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  // The row survives as a tombstone so a reader following a reply can see the
  // parent existed and was removed.
  await expect(
    page.getByText("Message deleted — Removed as spam"),
  ).toBeVisible();
  await expect(page.getByText("will be removed")).toHaveCount(0);
});

/**
 * Install a NIP-07 extension stub that also implements NIP-44.
 *
 * The reversible transform stands in for real encryption: the point under test
 * is that the client stores read state as ciphertext on the relay and can read
 * it back, not the cipher itself.
 */
async function installNip07WithNip44(
  page: import("@playwright/test").Page,
  pubkey: string,
) {
  await page.addInitScript((extensionPubkey) => {
    const encode = (value: string) =>
      `enc:${btoa(unescape(encodeURIComponent(value)))}`;
    (
      window as Window & {
        nostr?: Record<string, unknown>;
      }
    ).nostr = {
      async getPublicKey() {
        return extensionPubkey;
      },
      async signEvent(event: Record<string, unknown>) {
        return {
          ...event,
          id: `ab${Math.random().toString(16).slice(2)}`
            .padEnd(64, "0")
            .slice(0, 64),
          pubkey: extensionPubkey,
          sig: "ef".repeat(64),
        };
      },
      nip44: {
        async encrypt(_peer: string, plaintext: string) {
          return encode(plaintext);
        },
        async decrypt(_peer: string, ciphertext: string) {
          return decodeURIComponent(
            escape(atob(ciphertext.replace(/^enc:/, ""))),
          );
        },
      },
    };
  }, pubkey);
}

test("read state is published to the relay, not kept in the browser", async ({
  page,
}) => {
  await installNip07WithNip44(page, "ab".repeat(32));
  const relay = mockRelay(page, {
    extraMessages: [markdownMessage("b", "something to read")],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("something to read")).toBeVisible();

  await expect
    .poll(() =>
      relay.published.some(
        (event) => (event as { kind: number }).kind === 30078,
      ),
    )
    .toBe(true);

  // Exactly one write for one channel opened once. An earlier cut re-resolved
  // the signer every render, which changed the identity of the load effect's
  // dependencies and turned this into a republish loop.
  const writes = relay.published.filter(
    (event) => (event as { kind: number }).kind === 30078,
  );
  expect(writes).toHaveLength(1);

  const readState = writes[0] as { tags: string[][]; content: string };

  // The relay's watermark trigger rejects anything that does not match these.
  const dTag = readState.tags.find((tag) => tag[0] === "d");
  expect(dTag?.[1]).toMatch(/^read-state:[0-9a-f]{32}$/);
  expect(readState.tags).toContainEqual(["t", "read-state"]);

  // Stored as ciphertext: the relay operator holds a blob, not a record of what
  // this person has read.
  expect(readState.content).toMatch(/^enc:/);
  const blob = JSON.parse(
    Buffer.from(readState.content.replace(/^enc:/, ""), "base64").toString(
      "utf8",
    ),
  ) as { v: number; contexts: Record<string, number> };
  expect(blob.v).toBe(1);
  expect(blob.contexts[CHANNEL_UUID]).toBeGreaterThan(0);
});

test("a channel with activity past its cursor shows as unread", async ({
  page,
}) => {
  await installNip07WithNip44(page, "ab".repeat(32));

  const otherChannel = "22222222-2222-2222-2222-222222222222";
  const relay = mockRelay(page, {
    extraChannels: [
      {
        id: "ee".repeat(32),
        pubkey: "b".repeat(64),
        kind: 39000,
        created_at: 1_700_000_000,
        tags: [
          ["d", otherChannel],
          ["name", "elsewhere"],
          ["public"],
          ["t", "stream"],
        ],
        content: "",
        sig: "c".repeat(128),
      },
    ],
    // Newer than the cursor seeded below, so that room is unread.
    channelActivity: { [otherChannel]: 1_900_000_000 },
    readStateEvents: [
      {
        id: "dd".repeat(32),
        pubkey: "ab".repeat(32),
        kind: 30078,
        created_at: 1_700_000_000,
        tags: [
          ["d", `read-state:${"0".repeat(32)}`],
          ["t", "read-state"],
        ],
        // Cursor sits before the activity above, so that room is unread.
        content: `enc:${Buffer.from(
          JSON.stringify({
            v: 1,
            client_id: "desktop",
            contexts: { [otherChannel]: 1_800_000_000 },
          }),
        ).toString("base64")}`,
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  // The badge is on the other room; the open one is being read right now.
  const nav = page.getByRole("navigation", { name: "Channels" });
  await expect(nav.getByText("unread", { exact: true })).toHaveCount(1);

  // No subscription may carry message bodies for a channel the reader is not
  // looking at. A channel-less content filter is exactly that firehose, so its
  // absence is the guarantee.
  const firehose = relay.subscriptions.filter(
    (filter) => filter.kinds?.includes(9) && !filter["#h"],
  );
  expect(firehose).toEqual([]);

  // Nor may badges cost one request per channel. Every read that mentions a
  // specific channel is the content subscription for the room on screen; the
  // badge path must never name a channel at all.
  const perChannelBadgeWork = relay.queries
    .flat()
    .filter((filter) => filter["#h"]);
  expect(perChannelBadgeWork).toEqual([]);

  // What replaced both: one unscoped subscription for the snapshot kind. The
  // relay decides which shards this reader may see and addresses them, so the
  // client neither names channels nor names itself.
  const badgeSubs = relay.subscriptions.filter((filter) =>
    filter.kinds?.includes(39007),
  );
  expect(badgeSubs).toHaveLength(1);
  expect(badgeSubs[0].kinds).toEqual([39007]);
  expect(badgeSubs[0]["#h"]).toBeUndefined();
  expect(badgeSubs[0].authors).toBeUndefined();
});

test("a channel read past its newest message shows no badge", async ({
  page,
}) => {
  await installNip07WithNip44(page, "ab".repeat(32));

  const otherChannel = "22222222-2222-2222-2222-222222222222";
  const relay = mockRelay(page, {
    extraChannels: [
      {
        id: "ee".repeat(32),
        pubkey: "b".repeat(64),
        kind: 39000,
        created_at: 1_700_000_000,
        tags: [
          ["d", otherChannel],
          ["name", "elsewhere"],
          ["public"],
          ["t", "stream"],
        ],
        content: "",
        sig: "c".repeat(128),
      },
    ],
    // Exactly the cursor seeded below: that message has been read.
    channelActivity: { [otherChannel]: 1_800_000_000 },
    readStateEvents: [
      {
        id: "dd".repeat(32),
        pubkey: "ab".repeat(32),
        kind: 30078,
        created_at: 1_700_000_000,
        tags: [
          ["d", `read-state:${"0".repeat(32)}`],
          ["t", "read-state"],
        ],
        // Cursor sits on the activity above — it has been read.
        content: `enc:${Buffer.from(
          JSON.stringify({
            v: 1,
            client_id: "desktop",
            contexts: { [otherChannel]: 1_800_000_000 },
          }),
        ).toString("base64")}`,
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  // Wait for the badge data to have actually arrived before asserting on the
  // absence of a badge, so the assertion cannot pass merely because nothing has
  // run yet.
  await expect
    .poll(() =>
      relay.queries.some((filters) =>
        filters.some((filter) => filter.kinds?.includes(39007)),
      ),
    )
    .toBe(true);

  const nav = page.getByRole("navigation", { name: "Channels" });
  await expect(nav.getByText("unread", { exact: true })).toHaveCount(0);
});

test("searching puts the query in the URL and lists ranked hits", async ({
  page,
}) => {
  // Deliberately not in timestamp order: the relay returns FTS relevance order
  // and the client must not re-sort it.
  const relay = mockRelay(page, {
    searchPages: {
      1: [
        {
          id: "11".repeat(32),
          pubkey: "e".repeat(64),
          kind: 9,
          created_at: 1_600_000_000,
          tags: [["h", CHANNEL_UUID]],
          content: "the deploy pipeline is green",
          sig: "f".repeat(128),
        },
        {
          id: "22".repeat(32),
          pubkey: "e".repeat(64),
          kind: 9,
          created_at: 1_700_000_000,
          tags: [["h", CHANNEL_UUID]],
          content: "deploy notes for the release",
          sig: "f".repeat(128),
        },
      ],
    },
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByRole("searchbox", { name: /^Search/ }).fill("deploy");
  await page.getByRole("searchbox", { name: /^Search/ }).press("Enter");

  // In the URL, so the result set is linkable and survives a reload.
  await expect(page).toHaveURL(/[?&]q=deploy/);

  await expect(page.getByText("the deploy pipeline is green")).toBeVisible();
  await expect(page.getByText("deploy notes for the release")).toBeVisible();

  // Server ranking preserved: the older hit ranked first and stays first.
  const rendered = await page.getByRole("listitem").allTextContents();
  const first = rendered.findIndex((text) =>
    text.includes("pipeline is green"),
  );
  const second = rendered.findIndex((text) => text.includes("notes for the"));
  expect(first).toBeLessThan(second);

  // Kinds are mandatory — an open-ended search 403s at the relay's p-gate.
  expect(relay.searchRequests).not.toHaveLength(0);
  expect(relay.searchRequests[0].kinds?.length ?? 0).toBeGreaterThan(0);
  expect(relay.searchRequests[0].search).toBe("deploy");
});

test("a search inside a channel is narrowed on the server", async ({
  page,
}) => {
  const relay = mockRelay(page, { searchPages: { 1: [] } });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByRole("searchbox", { name: /^Search/ }).fill("deploy");
  await page.getByRole("searchbox", { name: /^Search/ }).press("Enter");

  await expect(page.getByText(/No messages match/)).toBeVisible();
  // Narrowing client-side would fill each page with hits from other channels
  // and then discard most of them.
  expect(relay.searchRequests[0]["#h"]).toEqual([CHANNEL_UUID]);
});

test("a result opens the message it points at", async ({ page }) => {
  // A realistic id: 64 hex chars including letters. An all-digit id would parse
  // as a JSON number, and the router quotes such a value so it round-trips —
  // correct, but not the shape a reader would copy out of the address bar.
  const HIT_ID = "3a".repeat(32);

  const relay = mockRelay(page, {
    searchPages: {
      1: [
        {
          id: HIT_ID,
          pubkey: "e".repeat(64),
          kind: 9,
          created_at: 1_700_000_000,
          tags: [["h", CHANNEL_UUID]],
          content: "the thing you were looking for",
          sig: "f".repeat(128),
        },
      ],
    },
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}?q=looking`);
  // The href a reader could copy, before any client-side navigation.
  await expect(
    page.getByRole("link", { name: /the thing you were looking for/ }),
  ).toHaveAttribute("href", `/c/${CHANNEL_UUID}?m=${HIT_ID}`);

  await page.getByText("the thing you were looking for").click();

  // Anchors the timeline on that message and drops `q`, so the URL does not
  // claim to be both a search and a message view.
  await expect(page).toHaveURL(new RegExp(`m=${HIT_ID}`));
  await expect(page).not.toHaveURL(/[?&]q=/);
});

test("clearing the search returns to the timeline", async ({ page }) => {
  const relay = mockRelay(page, { searchPages: { 1: [] } });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}?q=deploy`);
  await expect(page.getByText(/No messages match/)).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click();

  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByText("hello from the mocked relay")).toBeVisible();
});

test("older history is paged in with a composite cursor", async ({ page }) => {
  const older = Array.from({ length: 3 }, (_unused, index) => ({
    id: `0${index}`.padEnd(64, "a"),
    pubkey: "e".repeat(64),
    kind: 9,
    created_at: 1_600_000_000 + index,
    tags: [["h", CHANNEL_UUID]],
    content: `older message ${index}`,
    sig: "f".repeat(128),
  }));

  const relay = mockRelay(page, { olderMessages: older });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("hello from the mocked relay")).toBeVisible();
  await expect(page.getByText("older message 0")).toHaveCount(0);

  await page.getByRole("button", { name: "Load older messages" }).click();

  await expect(page.getByText("older message 0")).toBeVisible();
  await expect(page.getByText("older message 2")).toBeVisible();
  // The live tail is still there: a page of history must extend the timeline,
  // not replace it.
  await expect(page.getByText("hello from the mocked relay")).toBeVisible();

  // The cursor is the oldest row that was on screen, sent as both halves. A
  // timestamp alone would drop or repeat rows sharing that second.
  expect(relay.historyRequests).toHaveLength(1);
  expect(relay.historyRequests[0].beforeId).toMatch(/^[0-9a-f]{64}$/);
  expect(relay.historyRequests[0].until).toBeGreaterThan(0);
});

test("a short page ends the scrollback", async ({ page }) => {
  // The general query path has no `kind:39006` bounds overlay, so a short page
  // is the only exhaustion signal available. It must actually stop the control.
  const relay = mockRelay(page, {
    olderMessages: [
      {
        id: "0a".padEnd(64, "b"),
        pubkey: "e".repeat(64),
        kind: 9,
        created_at: 1_600_000_000,
        tags: [["h", CHANNEL_UUID]],
        content: "the first thing anyone said",
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByRole("button", { name: "Load older messages" }).click();

  await expect(page.getByText("the first thing anyone said")).toBeVisible();
  await expect(page.getByText("Beginning of the channel")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load older messages" }),
  ).toHaveCount(0);
});

test("paging in history keeps the reader where they were", async ({ page }) => {
  // Prepending rows pushes everything down. Following the tail on row count —
  // which is what the timeline did before scrollback existed — would throw the
  // reader to the bottom, out of the history they just asked for.
  const older = Array.from({ length: 40 }, (_unused, index) => ({
    id: `${index}`.padStart(2, "0").padEnd(64, "c"),
    pubkey: "e".repeat(64),
    kind: 9,
    created_at: 1_600_000_000 + index,
    tags: [["h", CHANNEL_UUID]],
    content: `older message ${index}`,
    sig: "f".repeat(128),
  }));

  const relay = mockRelay(page, {
    olderMessages: older,
    // Enough live rows that the viewport actually scrolls.
    extraMessages: Array.from({ length: 40 }, (_unused, index) => ({
      id: `${index}`.padStart(2, "0").padEnd(64, "d"),
      pubkey: "e".repeat(64),
      kind: 9,
      created_at: 1_700_000_200 + index,
      tags: [["h", CHANNEL_UUID]],
      content: `recent message ${index}`,
      sig: "f".repeat(128),
    })),
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("recent message 39")).toBeVisible();

  const scroller = page.getByTestId("message-timeline");
  const loadOlder = page.getByRole("button", {
    name: "Load older messages",
  });
  // The row the reader is on. Asserting on `scrollHeight - scrollTop` would be
  // asserting on an estimate: with a virtualized list the scroll height is
  // derived from the sizes measured so far and moves as more are measured.
  const anchor = page.getByText("recent message 0");

  // Scroll up and click in one retried step. Separating them is racy: the
  // timeline lands on the newest message by measuring as it goes, so a scroll
  // issued mid-settle is corrected back and the button leaves the viewport
  // between the check and the click.
  await expect
    .poll(
      async () => {
        await scroller.evaluate((el) => {
          el.scrollTop = 0;
        });
        if (!(await loadOlder.isVisible())) return false;
        await loadOlder.click({ timeout: 1_000 }).catch(() => {});
        return page.getByText("older message 39").isVisible();
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Still on screen: forty rows were pushed in above it without moving it.
  await expect(anchor).toBeInViewport();
  // And demonstrably not at the bottom, which is the failure this guards
  // against — following the tail on row count would land there.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("an uploaded picture fills the profile field and is saved with it", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.route("**/upload", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://relay.test/media/face.png",
        sha256: "a".repeat(64),
        size: 5,
        type: "image/png",
        uploaded: 1_700_000_000,
      }),
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Upload a picture" }).setInputFiles({
    name: "face.png",
    mimeType: "image/png",
    buffer: Buffer.from("hello"),
  });

  // The upload only fills the field. kind:0 carries every field in one event,
  // so publishing here would save a half-finished profile.
  await expect(page.getByTestId("settings-avatar-url")).toHaveValue(
    "https://relay.test/media/face.png",
  );
  expect(
    relay.published.filter((event) => (event as { kind: number }).kind === 0),
  ).toEqual([]);

  await page.getByTestId("settings-display-name").fill("Picture Person");
  await page.getByTestId("save-profile").click();

  await expect
    .poll(() =>
      relay.published.some((event) => (event as { kind: number }).kind === 0),
    )
    .toBe(true);
  const profile = relay.published.find(
    (event) => (event as { kind: number }).kind === 0,
  ) as { content: string };
  expect(JSON.parse(profile.content).picture).toBe(
    "https://relay.test/media/face.png",
  );
});

test("a picture the relay will not store is refused before the upload", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  let uploaded = false;
  await page.route("**/upload", async (route) => {
    uploaded = true;
    await route.fulfill({ status: 500, body: "should not be reached" });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Upload a picture" }).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });

  await expect(
    page.getByText("That is not an image the relay will store."),
  ).toBeVisible();
  // Rejected locally: sending it only to be refused would cost the transfer.
  expect(uploaded).toBe(false);
});

test("attaching a file uploads it and publishes its imeta", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  // The relay authorizes an upload for one exact file: the X-SHA-256 header and
  // the kind:24242 auth event's `x` tag must agree, or it is rejected. The mock
  // enforces that, so a client that signs for different bytes than it sends
  // fails here rather than in production.
  let uploadRequest: { sha256: string | undefined; authX: string | undefined } =
    { sha256: undefined, authX: undefined };
  await page.route("**/upload", async (route) => {
    const headers = route.request().headers();
    const auth = headers.authorization ?? "";
    const authEvent = JSON.parse(
      Buffer.from(auth.replace(/^Nostr /, ""), "base64").toString("utf8"),
    ) as { kind: number; tags: string[][]; content: string };

    uploadRequest = {
      sha256: headers["x-sha-256"],
      authX: authEvent.tags.find((tag) => tag[0] === "x")?.[1],
    };

    expect(route.request().method()).toBe("PUT");
    expect(authEvent.kind).toBe(24242);
    expect(authEvent.tags).toContainEqual(["t", "upload"]);
    // BUD-11 requires a non-empty reason and the relay rejects a blank one.
    expect(authEvent.content.trim().length).toBeGreaterThan(0);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://relay.test/media/cat.png",
        sha256: uploadRequest.sha256,
        size: 5,
        type: "image/png",
        uploaded: 1_700_000_000,
        dim: "800x600",
      }),
    });
  });

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page
    .getByRole("textbox", { name: /^Message #/ })
    .waitFor({ state: "visible" });

  await page.locator('input[type="file"]').setInputFiles({
    name: "cat.png",
    mimeType: "image/png",
    buffer: Buffer.from("hello"),
  });

  // The attachment is uploaded on pick, not on send: a send that had to upload
  // first would fail the message along with the transfer.
  await expect(
    page.getByRole("button", { name: "Remove cat.png" }),
  ).toBeVisible();
  expect(uploadRequest.sha256).toBe(uploadRequest.authX);
  expect(uploadRequest.sha256).toMatch(/^[0-9a-f]{64}$/);

  await page.getByRole("button", { name: "Send" }).click();

  await expect
    .poll(() => relay.published.some((e) => (e as { kind: number }).kind === 9))
    .toBe(true);
  const message = relay.published.find(
    (e) => (e as { kind: number }).kind === 9,
  ) as { tags: string[][]; content: string };

  const imeta = message.tags.find((tag) => tag[0] === "imeta");
  expect(imeta).toBeDefined();
  expect(imeta).toContain("url https://relay.test/media/cat.png");
  // Without `dim` the timeline jumps when the image decodes.
  expect(imeta).toContain("dim 800x600");
  // And the URL must reach the body, because the renderer keys imeta off the
  // URL it finds there — a tag alone renders nothing.
  expect(message.content).toContain("https://relay.test/media/cat.png");
});

test("a refused upload keeps the message and says why", async ({ page }) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.route("**/upload", async (route) => {
    await route.fulfill({ status: 413, body: "too big" });
  });

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: /^Message #/ });
  await composer.fill("look at this");

  await page.locator('input[type="file"]').setInputFiles({
    name: "big.png",
    mimeType: "image/png",
    buffer: Buffer.from("x"),
  });

  // Actionable, not a status code.
  await expect(page.getByText(/too large/i)).toBeVisible();
  // The typed text survives, and nothing half-attached is left behind to be
  // published as a broken link.
  await expect(composer).toHaveText("look at this");
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});

test("a typing indicator appears and clears when the message lands", async ({
  page,
}) => {
  const typist = "cc".repeat(32);
  const relay = mockRelay(page, {
    typingEvents: [
      {
        id: "11".repeat(32),
        pubkey: typist,
        kind: 20002,
        // Within the 8s TTL of "now", so the indicator is live on arrival.
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", CHANNEL_UUID]],
        content: "",
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText(/is typing…/)).toBeVisible();

  // Sending clears the reader's own row; the typist's clears when their message
  // arrives, which the mock echoes back on the live subscription.
  const composer = page.getByRole("textbox", { name: /^Message #/ });
  await composer.fill("done");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("done")).toBeVisible();
});

test("typing while composing publishes kind:20002 scoped to the channel", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByRole("textbox", { name: /^Message #/ }).fill("half a thou");

  await expect
    .poll(() =>
      relay.published.some(
        (event) => (event as { kind: number }).kind === 20002,
      ),
    )
    .toBe(true);

  const typing = relay.published.find(
    (event) => (event as { kind: number }).kind === 20002,
  ) as { tags: string[][]; content: string };
  expect(typing.tags).toContainEqual(["h", CHANNEL_UUID]);
  // Content is empty: the indicator says "someone is composing", never what.
  expect(typing.content).toBe("");
});

test("presence comes from the HTTP snapshot, which is the only path that has it", async ({
  page,
}) => {
  // Ephemeral events are never stored, so a WebSocket REQ has nothing to
  // return; `POST /query` is where the relay synthesizes status out of Redis.
  const relay = mockRelay(page, {
    presenceEvents: [
      {
        id: "22".repeat(32),
        pubkey: "e".repeat(64),
        kind: 20001,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "online",
        sig: "f".repeat(128),
      },
    ],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("hello from the mocked relay")).toBeVisible();

  // The dot's accessible name, not sr-only text: it is a `role="img"` badge on
  // the author avatar, so its name is what a screen reader announces.
  await expect(
    page.getByRole("img", { name: "Status: online" }),
  ).toBeAttached();

  const presence = relay.queries
    .flat()
    .find((filter) => filter.kinds?.includes(20001));
  expect(presence?.kinds).toEqual([20001]);
  // The relay only synthesizes for filters that name authors explicitly.
  expect(presence?.authors?.length).toBeGreaterThan(0);
  // Presence and unread share the endpoint but never the request: mixing them
  // would tie a status refresh to the badge poll's cadence and vice versa.
  for (const filters of relay.queries) {
    const kinds = new Set(filters.flatMap((filter) => filter.kinds ?? []));
    expect(kinds.has(20001) && kinds.has(9)).toBe(false);
  }
});

test("read cursors advanced during a publish are not lost", async ({
  page,
}) => {
  await installNip07WithNip44(page, "ab".repeat(32));

  const otherChannel = "33333333-3333-3333-3333-333333333333";
  const relay = mockRelay(page, {
    // Hold the first write open so the second cursor advances mid-publish —
    // without this the two never overlap and the race is not exercised.
    delayReadStateOkMs: 1_500,
    extraChannels: [
      {
        id: "77".repeat(32),
        pubkey: "b".repeat(64),
        kind: 39000,
        created_at: 1_700_000_000,
        tags: [
          ["d", otherChannel],
          ["name", "second"],
          ["public"],
          ["t", "stream"],
        ],
        content: "",
        sig: "c".repeat(128),
      },
    ],
  });
  await relay.install();

  // Read one room and immediately switch to another, so the second cursor
  // advances while the first publish is still in flight.
  await page.goto(`/c/${CHANNEL_UUID}`);
  await page
    .getByRole("navigation", { name: "Channels" })
    .getByText("second")
    .click();
  await expect(page.getByRole("heading", { name: "#second" })).toBeVisible();

  const cursorsOf = (event: unknown) =>
    (
      JSON.parse(
        Buffer.from(
          (event as { content: string }).content.replace(/^enc:/, ""),
          "base64",
        ).toString("utf8"),
      ) as { contexts: Record<string, number> }
    ).contexts;

  // The newest write must carry both rooms: dropping the second would leave a
  // cursor that only ever existed in this tab, and the badge returns on reload.
  await expect
    .poll(() => {
      const writes = relay.published.filter(
        (event) => (event as { kind: number }).kind === 30078,
      );
      if (writes.length === 0) return null;
      return Object.keys(cursorsOf(writes[writes.length - 1])).sort();
    })
    .toEqual([CHANNEL_UUID, otherChannel].sort());
});

test("a signer without NIP-44 is told unread sync is unavailable", async ({
  page,
}) => {
  // NIP-44 is optional in NIP-07 and some extensions omit it. Marking a channel
  // read must not look like it worked when nothing can be persisted.
  await page.addInitScript((extensionPubkey) => {
    (window as Window & { nostr?: Record<string, unknown> }).nostr = {
      async getPublicKey() {
        return extensionPubkey;
      },
      async signEvent(event: Record<string, unknown>) {
        return {
          ...event,
          id: "ab".repeat(32),
          pubkey: extensionPubkey,
          sig: "ef".repeat(64),
        };
      },
      // No nip44 member at all.
    };
  }, "ab".repeat(32));

  const relay = mockRelay(page);
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);

  await expect(page.getByText("unread sync off")).toBeVisible();
  // And nothing is written, rather than a write that silently fails.
  await expect
    .poll(
      () =>
        relay.published.filter(
          (event) => (event as { kind: number }).kind === 30078,
        ).length,
    )
    .toBe(0);
});

/**
 * The mock-up screens.
 *
 * These have no relay data path yet, so the real build shows an honest "not
 * connected" panel. That is the behaviour worth guarding: the failure mode is
 * shipping invented projects and agents to someone pointed at a real relay.
 */
const SHOWCASE_ROUTES = [
  ["/agents", "エージェント"],
  ["/projects", "プロジェクト"],
  ["/workflows", "ワークフロー"],
  ["/pulse", "Pulse"],
  ["/reminders", "リマインダー"],
  ["/forum", "フォーラム"],
] as const;

for (const [path, what] of SHOWCASE_ROUTES) {
  test(`${path} says it is not connected rather than showing invented data`, async ({
    page,
  }) => {
    const relay = mockRelay(page);
    await relay.install();

    await page.goto(path);
    await expect(page.getByTestId("showcase-not-wired")).toBeVisible();
    await expect(
      page.getByText(`${what}はまだ接続されていません`),
    ).toBeVisible();
  });
}

test("the sidebar reaches every section, and lights only the current one", async ({
  page,
}) => {
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/agents");
  // The old `startsWith` chain defaulted to "chat", so every new section lit
  // the Channels item up as if the reader were in a room.
  await expect(
    page
      .getByRole("link", { name: "Agents" })
      .and(page.locator("[data-active=true]")),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "Channels" })
      .and(page.locator("[data-active=true]")),
  ).toHaveCount(0);

  for (const name of ["Pulse", "Projects", "Workflows", "Forum", "Reminders"]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
});

// --- Moderation ------------------------------------------------------------
//
// The identity is `MY_PUBKEY` throughout, and the message under test is always
// someone else's — there is nothing on this menu that applies to your own
// message, and the component returns null for it.

/** Membership where the reader is an ordinary member. */
function asMember() {
  return {
    memberEvents: [
      memberList(CHANNEL_UUID, [
        [MY_PUBKEY, "member"],
        ["e".repeat(64), "member"],
      ]),
    ],
  };
}

/** Membership where the reader may issue moderation commands. */
function asAdmin(restrictedRows: unknown[] = []) {
  return {
    memberEvents: [
      memberList(CHANNEL_UUID, [
        [MY_PUBKEY, "admin"],
        ["e".repeat(64), "member"],
      ]),
    ],
    restrictedRows,
  };
}

test("reporting a message publishes kind:1984 with the category on the e tag", async ({
  page,
}) => {
  const target = markdownMessage("1", "報告される投稿");
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { ...asMember(), extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId(`message-moderation-${target.id}`).click();
  await page.getByTestId(`report-message-${target.id}`).click();
  await page.getByTestId("report-category-spam").click();
  await page.getByTestId("report-note").fill("同じリンクの連投です");
  await page.getByTestId("submit-report").click();

  const report = relay.published.find(
    (event) => (event as { kind: number }).kind === 1984,
  ) as { tags: string[][]; content: string };
  expect(report.tags).toContainEqual(["p", target.pubkey]);
  // The category rides the e tag's third element, which is where the relay's
  // triage reads it — not the content, which is prose for a human.
  expect(report.tags).toContainEqual(["e", target.id, "spam"]);
  expect(report.content).toBe("同じリンクの連投です");
  // The dialog closes only once the relay has accepted it.
  await expect(page.getByTestId("report-message-dialog")).toHaveCount(0);
});

test("a report cannot be submitted without a category", async ({ page }) => {
  const target = markdownMessage("1", "理由なしの通報");
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { ...asMember(), extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId(`message-moderation-${target.id}`).click();
  await page.getByTestId(`report-message-${target.id}`).click();
  // A category is what makes a report sortable, so it is the one required field.
  await expect(page.getByTestId("submit-report")).toBeDisabled();
  await page.getByTestId("report-category-other").click();
  await expect(page.getByTestId("submit-report")).toBeEnabled();
});

test("muting an author publishes the whole list and hides their messages", async ({
  page,
}) => {
  const theirs = markdownMessage("1", "消えるべき発言");
  const mine = myMessage("2", "残るべき発言");
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...asMember(),
    extraMessages: [theirs, mine],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await expect(page.getByText("消えるべき発言")).toBeVisible();

  await page.getByTestId(`message-moderation-${theirs.id}`).click();
  await page.getByTestId(`mute-author-${theirs.id}`).click();

  const list = relay.published.find(
    (event) => (event as { kind: number }).kind === 10000,
  ) as { tags: string[][] };
  // kind 10000 is replaceable, so the event is the complete list — publishing a
  // delta would unmute everyone already on it.
  expect(list.tags).toEqual([["p", theirs.pubkey]]);

  // The person is hidden, not the message annotated: a row saying someone spoke
  // is the thing a mute is for.
  await expect(page.getByText("消えるべき発言")).toHaveCount(0);
  await expect(page.getByText("残るべき発言")).toBeVisible();
});

test("a member is offered reporting and muting, but not moderation", async ({
  page,
}) => {
  const target = markdownMessage("1", "誰かの発言");
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { ...asMember(), extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId(`message-moderation-${target.id}`).click();
  await expect(page.getByTestId(`report-message-${target.id}`)).toBeVisible();
  await expect(page.getByTestId(`mute-author-${target.id}`)).toBeVisible();
  // The relay refuses these from a member anyway; offering them would be a
  // button that exists to fail.
  await expect(page.getByTestId(`ban-author-${target.id}`)).toHaveCount(0);
  await expect(
    page.getByTestId(`timeout-author-3600-${target.id}`),
  ).toHaveCount(0);
});

test("an admin can time out an author, and the command carries no channel", async ({
  page,
}) => {
  const target = markdownMessage("1", "度を越えた発言");
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { ...asAdmin(), extraMessages: [target] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId(`message-moderation-${target.id}`).click();
  await page.getByTestId(`timeout-author-3600-${target.id}`).click();

  const command = relay.published.find(
    (event) => (event as { kind: number }).kind === 9042,
  ) as { tags: string[][] };
  expect(command.tags).toContainEqual(["p", target.pubkey]);
  // The community comes from the connection host. An `h` tag here does not
  // narrow the timeout to one room — the relay rejects the command outright.
  expect(command.tags.every((tag) => tag[0] !== "h")).toBe(true);
  const expiration = command.tags.find((tag) => tag[0] === "expiration");
  expect(Number(expiration?.[1])).toBeGreaterThan(Date.now() / 1000);
});

test("an author already timed out is offered the lift, not another timeout", async ({
  page,
}) => {
  const target = markdownMessage("1", "すでに制限中の人");
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...asAdmin([
      {
        pubkey: target.pubkey,
        banned: false,
        banExpiresAt: null,
        banReason: null,
        mutedUntil: new Date(Date.now() + 3_600_000).toISOString(),
        muteReason: null,
        actorPubkey: MY_PUBKEY,
        updatedAt: new Date().toISOString(),
      },
    ]),
    extraMessages: [target],
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId(`message-moderation-${target.id}`).click();
  await expect(page.getByTestId(`untimeout-author-${target.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`timeout-author-3600-${target.id}`),
  ).toHaveCount(0);
});

test("a timeout refusal becomes a banner rather than the relay's raw message", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    ...asMember(),
    // A member learns they are timed out by being refused a send — the relay
    // exposes no self-restriction read.
    rejectSendWith: `restricted: you are timed out until ${
      Math.floor(Date.now() / 1000) + 3600
    }`,
  });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  const composer = page.getByRole("textbox", { name: "Message #general" });
  await composer.fill("送れるはずの一言");
  await page.getByRole("button", { name: "Send" }).click();

  const banner = page.getByTestId("composer-timeout-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("タイムアウト中");
  // The relay's wire message is a parse contract, not a sentence for a reader.
  await expect(page.getByText("restricted: you are timed out")).toHaveCount(0);
  // The text survives, because a refused send must not cost the author their
  // message.
  await expect(composer).toHaveText("送れるはずの一言");
});

// --- Notifications ---------------------------------------------------------
//
// The Inbox's upper half. Built from real filters rather than the activity
// snapshots the room list below it uses — see `notifications-model` for the four
// and why a reply needs two of them.

test("the inbox lists mentions and DMs addressed to the reader", async ({
  page,
}) => {
  const mention = {
    ...markdownMessage("1", "レビューお願いします"),
    tags: [
      ["h", CHANNEL_UUID],
      ["p", MY_PUBKEY],
    ],
  };
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { extraMessages: [mention] });
  await relay.install();

  await page.goto("/home");
  const rows = page.getByTestId("notification-rows");
  await expect(rows.getByText("レビューお願いします")).toBeVisible();
  // Labelled as a mention, and the room is named — that pair is what decides
  // whether the reader opens it.
  await expect(rows.getByText("メンション")).toBeVisible();
  await expect(rows.getByText("#general")).toBeVisible();

  // A `#p` filter, not a scan of the community.
  const filter = relay.subscriptions.find(
    (candidate) => candidate["#p"] !== undefined,
  );
  expect(filter?.["#p"]).toEqual([MY_PUBKEY]);
  expect(filter?.kinds).toEqual([9, 40002]);
});

test("an ordinary channel message is not a notification", async ({ page }) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, {
    extraMessages: [markdownMessage("1", "誰にも宛てていない発言")],
  });
  await relay.install();

  await page.goto("/home");
  // The room list may well show the channel moved; this half is only for what
  // was addressed to the reader.
  await expect(page.getByTestId("notifications-empty")).toBeVisible();
});

test("a notification links to the message, not just the room", async ({
  page,
}) => {
  const mention = {
    ...markdownMessage("1", "ここを見てください"),
    tags: [
      ["h", CHANNEL_UUID],
      ["p", MY_PUBKEY],
    ],
  };
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { extraMessages: [mention] });
  await relay.install();

  await page.goto("/home");
  await page.getByTestId(`notification-${mention.id}`).click();
  // `m` anchors the view on the message, so following one lands on what was said
  // rather than at the bottom of a busy channel. The router JSON-encodes search
  // values, so the id arrives quoted — asserted on the parsed value rather than
  // the raw string, which is what the route actually reads.
  await expect(page).toHaveURL(new RegExp(`/c/${CHANNEL_UUID}\\?m=`));
  const anchored = await page.evaluate(() => {
    const raw = new URL(window.location.href).searchParams.get("m");
    try {
      return JSON.parse(raw ?? "");
    } catch {
      return raw;
    }
  });
  expect(anchored).toBe(mention.id);
});

test("muting an author also silences their notifications", async ({ page }) => {
  const mention = {
    ...markdownMessage("1", "ミュート後は出ないはず"),
    tags: [
      ["h", CHANNEL_UUID],
      ["p", MY_PUBKEY],
    ],
  };
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page, { ...asMember(), extraMessages: [mention] });
  await relay.install();

  await page.goto(`/c/${CHANNEL_UUID}`);
  await page.getByTestId(`message-moderation-${mention.id}`).click();
  await page.getByTestId(`mute-author-${mention.id}`).click();

  await page.getByRole("link", { name: "Inbox" }).click();
  // A mute that left the notification standing would be worse than useless.
  await expect(page.getByTestId("notifications-empty")).toBeVisible();
});

test("notification settings are per-browser and survive navigation", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/settings");
  await page.getByTestId("settings-nav-notifications").click();
  const settings = page.getByTestId("notification-settings");
  // Quiet by default: a client that announced without being asked would start
  // making noise on a machine nobody chose.
  await expect(page.getByTestId("notify-sound")).not.toBeChecked();
  await expect(settings.getByTestId("notify-only-hidden")).toBeChecked();
  // Desktop notifications need a permission the headless browser has not given,
  // so the request button stands in for the toggle.
  await expect(page.getByTestId("notify-request-permission")).toBeVisible();

  await page.getByTestId("notify-sound").check();
  await expect(page.getByTestId("notify-test-sound")).toBeVisible();

  await page.goto("/home");
  await page.goto("/settings");
  await page.getByTestId("settings-nav-notifications").click();
  await expect(page.getByTestId("notify-sound")).toBeChecked();
  // Nothing about this was published — it describes the machine, not the account.
  expect(
    relay.published.some((event) => (event as { kind: number }).kind === 30078),
  ).toBe(false);
});

// --- Settings panels, harness, templates, feedback -------------------------
//
// Settings became a left nav when it grew past a dozen sections; see
// `settings-nav.ts`. These assert the nav reaches each panel and that the two
// surfaces with real behaviour behind them work.

test("settings reaches every panel, and only one at a time", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/settings");
  // Account is the landing panel: everyone touches it.
  await expect(page.getByTestId("settings-display-name")).toBeVisible();

  for (const panel of [
    "notifications",
    "community",
    "agents",
    "channels",
    "advanced",
  ]) {
    await page.getByTestId(`settings-nav-${panel}`).click();
    await expect(
      page
        .getByTestId(`settings-nav-${panel}`)
        .and(page.locator('[aria-current="page"]')),
    ).toBeVisible();
  }
  // Switching away really unmounts: a nav that only scrolled would leave the
  // profile form on screen.
  await expect(page.getByTestId("settings-display-name")).toHaveCount(0);
});

test("the mock-backed settings panels say they are not connected", async ({
  page,
}) => {
  // The seam that matters more than any of their contents: `useShowcase()` hands
  // back nothing outside the demo build, and each panel then says so. Showing a
  // reader pointed at a real relay an invented harness list, or a template they
  // never made, would be a lie the UI tells on every load.
  //
  // What those panels render *with* data is verified against the demo build in a
  // browser, which is the only place the data exists.
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/settings");

  await page.getByTestId("settings-nav-agents").click();
  await expect(page.getByText("ハーネスの一覧はまだ")).toBeVisible();
  await expect(page.getByTestId("harness-claude-code")).toHaveCount(0);
  await expect(page.getByText("エージェントの既定値はまだ")).toBeVisible();

  await page.getByTestId("settings-nav-channels").click();
  await expect(page.getByText("テンプレートはまだリレーから")).toBeVisible();
  await expect(page.getByTestId("add-template")).toHaveCount(0);

  await page.getByTestId("settings-nav-advanced").click();
  await expect(page.getByText("共有計算の状態はまだ")).toBeVisible();
  await expect(page.getByText("アーカイブの状態はまだ")).toBeVisible();
});

test("feedback publishes kind:42000 with its category on a tag", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/settings");
  await page.getByTestId("settings-nav-advanced").click();
  await page.getByTestId("open-feedback").click();

  // An empty body is refused at ingest, so the button stays disabled rather than
  // producing a rejection the reader has to decode.
  await expect(page.getByTestId("submit-feedback")).toBeDisabled();
  await page.getByTestId("feedback-category-bug").click();
  await expect(page.getByTestId("submit-feedback")).toBeDisabled();
  await page.getByTestId("feedback-body").fill("通知の音が大きい");
  await page.getByTestId("submit-feedback").click();

  const sent = relay.published.find(
    (event) => (event as { kind: number }).kind === 42000,
  ) as { tags: string[][]; content: string };
  // At most one category tag — two is a rejection, not a last-one-wins.
  expect(sent.tags).toEqual([["category", "bug"]]);
  expect(sent.content).toBe("通知の音が大きい");
});

// --- Agent memory ----------------------------------------------------------

test("an agent's memory section says it is not connected either", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/agents");
  // The whole Agents screen is behind the same seam, so it never reaches the
  // memory viewer here — asserted so a regression that started inventing agents
  // fails on this rather than in front of a reader.
  await expect(
    page.getByText("エージェントはまだ接続されていません"),
  ).toBeVisible();
  await expect(page.getByTestId("memory-section")).toHaveCount(0);
});

// --- Communities -----------------------------------------------------------

test("adding a community offers three doors and normalizes what is typed", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/");
  await page.getByTestId("add-community").click();
  await expect(page.getByTestId("choose-join")).toBeVisible();

  await page.getByTestId("choose-connect").click();
  // A bare host becomes wss://, and the reader is shown that before connecting —
  // guessing ws:// would silently downgrade them.
  await page.getByTestId("relay-url-input").fill("relay.example.jp/");
  await expect(page.getByTestId("add-community-dialog")).toContainText(
    "wss://relay.example.jp",
  );

  await page.getByTestId("add-community-back").click();
  await page.getByTestId("choose-create").click();
  await page.getByTestId("hosted-name-input").fill("My-Team");
  // Case is normalized rather than refused: the name becomes a hostname label.
  await expect(page.getByTestId("add-community-dialog")).toContainText(
    "wss://my-team.nuxx.host",
  );
});

// --- Onboarding ------------------------------------------------------------

test("onboarding says plainly that a browser key does not survive a reload", async ({
  page,
}) => {
  // No NIP-07 extension installed, which is the case the desktop client never
  // had to describe.
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/welcome");
  await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-ephemeral-warning")).toBeVisible();
  // Skippable: a reader with no extension to hand must not be trapped here.
  await expect(page.getByTestId("onboarding-skip")).toBeVisible();
});

test("onboarding confirms custody when an extension holds the key", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/welcome");
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-pubkey")).toContainText(MY_PUBKEY);
  await expect(page.getByTestId("onboarding-ephemeral-warning")).toHaveCount(0);
});

test("the profile typed during onboarding is published on the way out", async ({
  page,
}) => {
  await installNip07WithNip44(page, MY_PUBKEY);
  const relay = mockRelay(page);
  await relay.install();

  await page.goto("/welcome");
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-display-name").fill("テスト太郎");
  await page.getByTestId("onboarding-next").click();

  // Published leaving the profile step, not at the end: a reader who closes the
  // tab on a later step should still have the name they typed.
  const profile = relay.published.find(
    (event) => (event as { kind: number }).kind === 0,
  ) as { content: string };
  expect(JSON.parse(profile.content).display_name).toBe("テスト太郎");

  await expect(page.getByTestId("onboarding-done")).toBeVisible();
  await page.getByTestId("onboarding-next").click();
  await expect(page).toHaveURL(/\/$/);
});

/**
 * The private-beta waitlist.
 *
 * The form's value is in the interaction — one question at a time, Enter to
 * advance, a choice that advances itself — and none of that is reachable from
 * the pure step machine its unit tests cover. Deliberately says nothing about
 * whether a submission is delivered: that depends on build-time configuration,
 * and a test asserting either way would break the moment the key is set.
 */
test.describe("private-beta waitlist", () => {
  /** Open the popup and get past the intro to the first question. */
  async function openForm(page: import("@playwright/test").Page) {
    await page.goto("/waitlist");
    const dialog = page.getByTestId("waitlist-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("waitlist-start").click();
    return dialog;
  }

  test("asks the six questions one at a time, in the order specified", async ({
    page,
  }) => {
    const dialog = await openForm(page);
    const heading = (name: string) => dialog.getByRole("heading", { name });

    await expect(heading("メールアドレス")).toBeVisible();
    await expect(dialog.getByText("1 / 6")).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "メールアドレス" })
      .fill("taro@example.co.jp");
    await page.getByTestId("waitlist-next").click();

    await expect(heading("担当者名")).toBeVisible();
    await dialog.getByLabel("ファーストネーム").fill("太郎");
    await dialog.getByLabel("ラストネーム").fill("山田");
    await page.getByTestId("waitlist-next").click();

    await expect(heading("企業名")).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "企業名" })
      .fill("株式会社ヌックス");
    await page.getByTestId("waitlist-next").click();

    await expect(heading("社員数")).toBeVisible();
    await dialog.getByText("11〜50名", { exact: true }).click();

    await expect(heading("現時点で利用しているAI予算")).toBeVisible();
    await dialog.getByText("10〜50万円 / 月", { exact: true }).click();

    await expect(heading("ご不明点や相談")).toBeVisible();
    await expect(dialog.getByText("6 / 6")).toBeVisible();
    // Focused like every other step, including this one — it is a textarea
    // rather than an input, and arriving here from a choice means the control
    // that had focus was just unmounted.
    await page.keyboard.type("相談したいことがあります。");
    await expect(
      dialog.getByRole("textbox", { name: "ご不明点や相談" }),
    ).toHaveValue("相談したいことがあります。");
    // The last question is the optional one, so the submit is already live.
    await expect(page.getByTestId("waitlist-next")).toBeEnabled();
  });

  test("a required answer left empty holds the form on its question", async ({
    page,
  }) => {
    const dialog = await openForm(page);
    await page.getByTestId("waitlist-next").click();

    await expect(dialog.getByRole("alert")).toHaveText("この項目は必須です。");
    await expect(dialog.getByText("1 / 6")).toBeVisible();
  });

  test("a malformed address is caught before the form moves on", async ({
    page,
  }) => {
    const dialog = await openForm(page);
    await dialog.getByRole("textbox", { name: "メールアドレス" }).fill("taro@");
    await page.getByTestId("waitlist-next").click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "メールアドレスの形式をご確認ください。",
    );
    await expect(dialog.getByText("1 / 6")).toBeVisible();
  });

  test("Enter advances the form, so the keyboard never leaves the field", async ({
    page,
  }) => {
    const dialog = await openForm(page);
    // Typed without clicking first: entering a question focuses its field.
    await page.keyboard.type("taro@example.co.jp");
    await page.keyboard.press("Enter");

    await expect(
      dialog.getByRole("heading", { name: "担当者名" }),
    ).toBeVisible();
  });

  test("the thank-you screen has a URL of its own", async ({ page }) => {
    // Reachable directly, which is the point: it survives the reload people
    // perform when they are unsure a form went through.
    await page.goto("/waitlist/thanks");
    await expect(
      page.getByRole("heading", { name: "ご登録ありがとうございました。" }),
    ).toBeVisible();
  });
});
