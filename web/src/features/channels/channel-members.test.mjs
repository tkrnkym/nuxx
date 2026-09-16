import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChannelMemberFilter,
  buildChannelRoster,
  channelRoleRank,
  membersOfChannel,
} from "./channel-members.ts";

const KIND_MEMBERS = 39002;
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const memberList = (channelId, members) => ({
  id: `members:${channelId}`,
  kind: KIND_MEMBERS,
  pubkey: "f".repeat(64),
  created_at: 1,
  content: "",
  tags: [
    ["d", channelId],
    ...members.map(([pubkey, role]) => ["p", pubkey, "", role]),
  ],
});

const agent = (overrides) => ({
  id: "agent",
  pubkey: C,
  name: "レビュー係",
  purpose: "",
  harness: "sprig",
  model: "claude-opus-5",
  status: "working",
  channels: [],
  activity: null,
  lastActiveAt: 100,
  ownerPubkey: A,
  turnsToday: 0,
  ...overrides,
});

test("a filter asks for one channel's member list", () => {
  assert.deepEqual(buildChannelMemberFilter("ch-1"), {
    kinds: [KIND_MEMBERS],
    "#d": ["ch-1"],
  });
  assert.equal(buildChannelMemberFilter(""), null);
});

test("only the named channel's members are listed", () => {
  const members = membersOfChannel(
    [memberList("ch-1", [[A, "owner"]]), memberList("ch-2", [[B, "member"]])],
    "ch-1",
  );
  assert.deepEqual(members, [{ pubkey: A, role: "owner" }]);
});

test("a member named twice keeps the stronger role", () => {
  const members = membersOfChannel(
    [memberList("ch-1", [[A, "member"]]), memberList("ch-1", [[A, "admin"]])],
    "ch-1",
  );
  assert.deepEqual(members, [{ pubkey: A, role: "admin" }]);
});

test("members sort by seniority, and a pubkey is normalised", () => {
  const members = membersOfChannel(
    [
      memberList("ch-1", [
        [B.toUpperCase(), "member"],
        [A, "owner"],
      ]),
    ],
    "ch-1",
  );
  assert.deepEqual(
    members.map((member) => member.role),
    ["owner", "member"],
  );
  assert.equal(members[1].pubkey, B);
});

test("an unknown role is kept, and sorts last", () => {
  assert.ok(channelRoleRank("visitor") > channelRoleRank("member"));
  const members = membersOfChannel(
    [memberList("ch-1", [[A, "visitor"]])],
    "ch-1",
  );
  assert.deepEqual(members, [{ pubkey: A, role: "visitor" }]);
});

test("a `p` tag with no role defaults to member", () => {
  const list = memberList("ch-1", []);
  list.tags.push(["p", A]);
  assert.deepEqual(membersOfChannel([list], "ch-1"), [
    { pubkey: A, role: "member" },
  ]);
});

test("the roster splits agents out of the member list", () => {
  const roster = buildChannelRoster({
    agents: [agent({ channels: ["dev"] })],
    channelName: "dev",
    members: [
      { pubkey: A, role: "owner" },
      { pubkey: C, role: "member" },
    ],
  });
  assert.deepEqual(roster.people, [{ pubkey: A, role: "owner" }]);
  assert.deepEqual(roster.agents, [
    { pubkey: C, name: "レビュー係", status: "working", activity: null },
  ]);
});

test("an agent in another channel is not in this roster", () => {
  const roster = buildChannelRoster({
    agents: [agent({ channels: ["announcements"] })],
    channelName: "dev",
    members: [{ pubkey: A, role: "owner" }],
  });
  assert.deepEqual(roster.agents, []);
  assert.deepEqual(roster.people, [{ pubkey: A, role: "owner" }]);
});

test("an agent on the member list is listed even without the channel name", () => {
  const roster = buildChannelRoster({
    agents: [agent({ channels: [] })],
    channelName: null,
    members: [{ pubkey: C, role: "member" }],
  });
  assert.equal(roster.agents.length, 1);
  assert.deepEqual(roster.people, []);
});

test("with no agents the roster is the member list", () => {
  const roster = buildChannelRoster({
    channelName: "dev",
    members: [{ pubkey: A, role: "owner" }],
  });
  assert.deepEqual(roster, {
    people: [{ pubkey: A, role: "owner" }],
    agents: [],
  });
});
