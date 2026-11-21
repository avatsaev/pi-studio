import { describe, expect, it } from "vitest";
import { type DaemonEntryView, type HostDaemons } from "../../host/types.js";
import { createTestDaemons, type TestDaemons } from "../../test/test-daemons.js";
import { daemonErrorView } from "./daemon-presentation.js";
import { submitAdd, submitEdit } from "./daemon-form-actions.js";
import {
  ADDRESS_BLANK,
  ADDRESS_IS_LINK,
  LINK_BLANK,
  NAME_BLANK,
  SAVE_FAILED,
  buildNewDaemon,
  buildPatch,
  formView,
  initialAddFields,
  initialEditFields,
  linkReplaced,
  needsReconnect,
  refusalErrors,
  withoutError,
  type FormFields,
} from "./daemon-form.js";

const LINK = "https://app.pi-studio.sh/#offer=AAAA&relay=relay.example.com&relayTls=1";
const SECRET_LINK = "https://app.pi-studio.sh/#offer=BBBB&relay=relay.example.com&relayTls=1";

function registry(): TestDaemons {
  return createTestDaemons({
    entries: [
      { id: "b", kind: "direct", name: "Build box", address: "ws://10.0.0.2:6767", password: "pw" },
      { id: "c", kind: "relay", name: "Office", pairingLink: SECRET_LINK },
      { id: "d", kind: "direct", name: "Plain", address: "ws://10.0.0.3:6767" },
    ],
    currentId: "b",
    localPassword: "local-secret",
  });
}

function entryOf(daemons: HostDaemons, id: string): DaemonEntryView {
  const entry = daemons.snapshot().entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry ${id}`);
  return entry;
}

function fields(over: Partial<FormFields>): FormFields {
  return { ...initialAddFields(), ...over };
}

describe("initial fields", () => {
  it("never carry a stored secret into an edit form", () => {
    const daemons = registry();
    for (const id of ["local", "b", "c", "d"]) {
      const initial = initialEditFields(entryOf(daemons, id));
      expect(initial.password).toBe("");
      expect(initial.pairingLink).toBe("");
      expect(initial.clearPassword).toBe(false);
      expect(JSON.stringify(initial)).not.toMatch(/pw|local-secret|BBBB/);
    }
  });

  it("starts an edit with the saved name and address", () => {
    expect(initialEditFields(entryOf(registry(), "b"))).toMatchObject({
      kind: "direct",
      name: "Build box",
      address: "ws://10.0.0.2:6767",
    });
    expect(initialEditFields(entryOf(registry(), "c")).kind).toBe("relay");
  });
});

describe("formView", () => {
  const daemons = registry();

  it("adds with a kind choice; direct has an address and a password, relay a link", () => {
    const direct = formView({ type: "add" }, initialAddFields("direct"));
    expect(direct).toMatchObject({
      showKind: true,
      showAddress: true,
      showPassword: true,
      showLink: false,
      submitLabel: "Add",
    });
    const relay = formView({ type: "add" }, initialAddFields("relay"));
    expect(relay).toMatchObject({ showAddress: false, showPassword: false, showLink: true });
    expect(relay.linkLabel).toBe("Pairing link");
  });

  it("edits local with name and password, no address and no link", () => {
    const local = entryOf(daemons, "local");
    expect(formView({ type: "edit", entry: local }, initialEditFields(local))).toMatchObject({
      showKind: false,
      showAddress: false,
      showPassword: true,
      showLink: false,
      title: "Edit This machine",
    });
  });

  it("edits relay with a 'Replace link' field and no password", () => {
    const relay = entryOf(daemons, "c");
    expect(formView({ type: "edit", entry: relay }, initialEditFields(relay))).toMatchObject({
      showAddress: false,
      showPassword: false,
      showLink: true,
      linkLabel: "Replace link",
    });
  });

  it("marks a saved password, and a pending clear, without showing it", () => {
    const direct = entryOf(daemons, "b");
    const mode = { type: "edit", entry: direct } as const;
    const base = initialEditFields(direct);
    expect(formView(mode, base).password).toMatchObject({
      saved: true,
      marker: "Saved",
      canClear: true,
      canUndoClear: false,
    });
    expect(formView(mode, { ...base, clearPassword: true }).password).toMatchObject({
      saved: false,
      marker: "Will be removed",
      canClear: false,
      canUndoClear: true,
    });
    const plain = entryOf(daemons, "d");
    expect(
      formView({ type: "edit", entry: plain }, initialEditFields(plain)).password,
    ).toMatchObject({ saved: false, marker: null, canClear: false });
    expect(formView({ type: "add" }, initialAddFields()).password.canClear).toBe(false);
  });
});

describe("buildNewDaemon", () => {
  it("stops a blank name", () => {
    const built = buildNewDaemon(fields({ name: "  ", address: "ws://10.0.0.9:6767" }));
    expect(built).toEqual({ ok: false, errors: { name: NAME_BLANK } });
  });

  it("stops a blank address", () => {
    const built = buildNewDaemon(fields({ name: "X", address: "" }));
    expect(built).toEqual({ ok: false, errors: { address: ADDRESS_BLANK } });
  });

  it("stops an address that is a pairing link", () => {
    const built = buildNewDaemon(fields({ name: "X", address: LINK }));
    expect(built).toEqual({ ok: false, errors: { address: ADDRESS_IS_LINK } });
  });

  it("stops an undialable address", () => {
    const built = buildNewDaemon(fields({ name: "X", address: "http://" }));
    expect(built).toEqual({
      ok: false,
      errors: { address: daemonErrorView("invalid_address").message },
    });
  });

  it("reports the name and the address together", () => {
    const built = buildNewDaemon(fields({ name: "", address: "" }));
    expect(built.ok === false && Object.keys(built.errors).toSorted()).toEqual(["address", "name"]);
  });

  it("builds a direct entry with the address as typed and the password only when typed", () => {
    expect(buildNewDaemon(fields({ name: " Box ", address: "10.0.0.9:6767" }))).toEqual({
      ok: true,
      value: { kind: "direct", name: "Box", address: "10.0.0.9:6767" },
    });
    expect(
      buildNewDaemon(fields({ name: "Box", address: "ws://10.0.0.9:6767", password: "s" })),
    ).toEqual({
      ok: true,
      value: { kind: "direct", name: "Box", address: "ws://10.0.0.9:6767", password: "s" },
    });
  });

  it("stops relay text that is not a pairing link, and a blank one", () => {
    expect(buildNewDaemon(fields({ kind: "relay", name: "R", pairingLink: "hello" }))).toEqual({
      ok: false,
      errors: { link: daemonErrorView("invalid_link").message },
    });
    expect(buildNewDaemon(fields({ kind: "relay", name: "R", pairingLink: " " }))).toEqual({
      ok: false,
      errors: { link: LINK_BLANK },
    });
  });

  it("builds a relay entry, ignoring address and password typed before switching kind", () => {
    expect(
      buildNewDaemon(
        fields({
          kind: "relay",
          name: "R",
          pairingLink: ` ${LINK}\n`,
          address: "junk",
          password: "junk",
        }),
      ),
    ).toEqual({ ok: true, value: { kind: "relay", name: "R", pairingLink: LINK } });
  });
});

function patchOf(entry: DaemonEntryView, over: Partial<FormFields>) {
  return buildPatch(entry, { ...initialEditFields(entry), ...over });
}

describe("buildPatch", () => {
  const daemons = registry();
  const direct = entryOf(daemons, "b");
  const relay = entryOf(daemons, "c");
  const local = entryOf(daemons, "local");

  it("sends nothing for an untouched form", () => {
    expect(patchOf(direct, {})).toEqual({ ok: true, value: {} });
  });

  it("sends only the name when only the name changed, and the password stays", () => {
    expect(patchOf(direct, { name: "Renamed" })).toEqual({ ok: true, value: { name: "Renamed" } });
  });

  it("sends the address only when it changed", () => {
    expect(patchOf(direct, { address: "ws://10.0.0.8:6767" })).toEqual({
      ok: true,
      value: { address: "ws://10.0.0.8:6767" },
    });
  });

  it("checks a changed address like an added one", () => {
    expect(patchOf(direct, { address: LINK })).toEqual({
      ok: false,
      errors: { address: ADDRESS_IS_LINK },
    });
    expect(patchOf(direct, { address: "" })).toEqual({
      ok: false,
      errors: { address: ADDRESS_BLANK },
    });
  });

  it("checks a blank name", () => {
    expect(patchOf(direct, { name: " " })).toEqual({ ok: false, errors: { name: NAME_BLANK } });
  });

  it("sends a typed password, and none when the field is empty", () => {
    expect(patchOf(direct, { password: "new" })).toEqual({ ok: true, value: { password: "new" } });
    expect(patchOf(direct, { password: "" })).toEqual({ ok: true, value: {} });
  });

  it("sends null for Clear, but a typed password wins", () => {
    expect(patchOf(direct, { clearPassword: true })).toEqual({
      ok: true,
      value: { password: null },
    });
    expect(patchOf(direct, { clearPassword: true, password: "new" })).toEqual({
      ok: true,
      value: { password: "new" },
    });
  });

  it("does not send a clear for an entry without a password", () => {
    const plain = entryOf(daemons, "d");
    expect(patchOf(plain, { clearPassword: true })).toEqual({ ok: true, value: {} });
  });

  it("edits local's name and password only", () => {
    expect(patchOf(local, { name: "Mine", password: "p", address: "junk" })).toEqual({
      ok: true,
      value: { name: "Mine", password: "p" },
    });
  });

  it("sends a new link and keeps the name; an empty field sends none", () => {
    expect(patchOf(relay, { pairingLink: LINK })).toEqual({
      ok: true,
      value: { pairingLink: LINK },
    });
    expect(patchOf(relay, { pairingLink: "  " })).toEqual({ ok: true, value: {} });
  });

  it("stops a replacement that is not a pairing link, and never sends a password for a relay", () => {
    expect(patchOf(relay, { pairingLink: "nope" })).toEqual({
      ok: false,
      errors: { link: daemonErrorView("invalid_link").message },
    });
    expect(patchOf(relay, { password: "x", clearPassword: true })).toEqual({
      ok: true,
      value: {},
    });
  });
});

describe("refusalErrors", () => {
  it("lands each code where the spec says", () => {
    expect(Object.keys(refusalErrors("name_taken"))).toEqual(["name"]);
    expect(Object.keys(refusalErrors("invalid_name"))).toEqual(["name"]);
    expect(Object.keys(refusalErrors("invalid_address"))).toEqual(["address"]);
    expect(Object.keys(refusalErrors("invalid_link"))).toEqual(["link"]);
    expect(refusalErrors("too_many")).toEqual({ form: daemonErrorView("too_many").message });
    expect(refusalErrors("not_found")).toEqual({ form: daemonErrorView("not_found").message });
  });

  it("words an unknown failure as a save failure", () => {
    expect(refusalErrors("unexpected")).toEqual({ form: SAVE_FAILED });
  });
});

describe("withoutError", () => {
  it("drops the field's message and the form's, keeping the others", () => {
    expect(withoutError({ name: "a", address: "b", form: "c" }, "name")).toEqual({ address: "b" });
  });

  it("returns the same object when nothing applies", () => {
    const errors = { address: "b" };
    expect(withoutError(errors, "name")).toBe(errors);
  });
});

describe("needsReconnect", () => {
  it("is for the current entry's address, password or link, not a rename", () => {
    expect(needsReconnect({ id: "b" }, "b", { address: "x" })).toBe(true);
    expect(needsReconnect({ id: "b" }, "b", { password: null })).toBe(true);
    expect(needsReconnect({ id: "b" }, "b", { pairingLink: "x" })).toBe(true);
    expect(needsReconnect({ id: "b" }, "b", { name: "x" })).toBe(false);
    expect(needsReconnect({ id: "b" }, "c", { address: "x" })).toBe(false);
    expect(needsReconnect({ id: "b" }, null, { address: "x" })).toBe(false);
  });
});

describe("submitAdd", () => {
  it("does not call the host when the form is refused", async () => {
    const daemons = registry();
    let calls = 0;
    const spied: HostDaemons = {
      ...daemons,
      add: (input) => {
        calls++;
        return daemons.add(input);
      },
    };
    const outcome = await submitAdd(spied, fields({ name: "", address: "ws://10.0.0.9:6767" }));
    expect(outcome).toEqual({ status: "refused", errors: { name: NAME_BLANK } });
    expect(await submitAdd(spied, fields({ name: "X", address: LINK }))).toMatchObject({
      status: "refused",
    });
    expect(calls).toBe(0);
    expect(daemons.snapshot().entries).toHaveLength(4);
  });

  it("adds the entry without opening it", async () => {
    const daemons = registry();
    const outcome = await submitAdd(
      daemons,
      fields({ name: "New", address: "ws://10.0.0.9:6767" }),
    );
    expect(outcome).toEqual({ status: "saved", reconnect: false });
    const snapshot = daemons.snapshot();
    expect(snapshot.entries.map((e) => e.name)).toContain("New");
    expect(snapshot.currentId).toBe("b");
    expect(daemons.switches).toEqual([]);
  });

  it("adds a relay entry", async () => {
    const daemons = registry();
    await submitAdd(daemons, fields({ kind: "relay", name: "Remote", pairingLink: LINK }));
    expect(daemons.snapshot().entries.at(-1)).toMatchObject({ kind: "relay", name: "Remote" });
  });

  it("shows the host's name_taken at the name field", async () => {
    const daemons = registry();
    const outcome = await submitAdd(
      daemons,
      fields({ name: "build BOX", address: "ws://10.0.0.9:6767" }),
    );
    expect(outcome).toEqual({
      status: "refused",
      errors: { name: daemonErrorView("name_taken").message },
    });
  });

  it("shows too_many at the form", async () => {
    const daemons = createTestDaemons({
      entries: Array.from({ length: 63 }, (_, i) => ({
        kind: "direct" as const,
        name: `D${i}`,
        address: "ws://10.0.0.1:1",
      })),
    });
    const outcome = await submitAdd(daemons, fields({ name: "One more", address: "ws://h:1" }));
    expect(outcome).toEqual({
      status: "refused",
      errors: { form: daemonErrorView("too_many").message },
    });
  });
});

describe("submitEdit", () => {
  it("sends only the name and keeps the saved password", async () => {
    const daemons = registry();
    const patches: unknown[] = [];
    const spied: HostDaemons = {
      ...daemons,
      update: (id, patch) => {
        patches.push(patch);
        return daemons.update(id, patch);
      },
    };
    const entry = entryOf(daemons, "b");

    const outcome = await submitEdit(spied, entry, {
      ...initialEditFields(entry),
      name: "Renamed",
    });

    expect(outcome).toEqual({ status: "saved", reconnect: false });
    expect(patches).toEqual([{ name: "Renamed" }]);
    expect(entryOf(daemons, "b")).toMatchObject({ name: "Renamed", hasPassword: true });
    expect((await daemons.resolveCurrent()).password).toBe("pw");
  });

  it("does not call the host when nothing changed", async () => {
    const daemons = registry();
    let calls = 0;
    const spied: HostDaemons = {
      ...daemons,
      update: (id, patch) => {
        calls++;
        return daemons.update(id, patch);
      },
    };
    const entry = entryOf(daemons, "b");
    expect(await submitEdit(spied, entry, initialEditFields(entry))).toEqual({
      status: "saved",
      reconnect: false,
    });
    expect(calls).toBe(0);
  });

  it("clears the password", async () => {
    const daemons = registry();
    const entry = entryOf(daemons, "b");
    await submitEdit(daemons, entry, { ...initialEditFields(entry), clearPassword: true });
    expect(entryOf(daemons, "b").hasPassword).toBe(false);
  });

  it("replaces a relay link, keeping the name", async () => {
    const daemons = registry();
    const entry = entryOf(daemons, "c");
    const outcome = await submitEdit(daemons, entry, {
      ...initialEditFields(entry),
      pairingLink: LINK,
    });
    expect(outcome).toEqual({ status: "saved", reconnect: false });
    expect(entryOf(daemons, "c").name).toBe("Office");
  });

  it("offers a reconnect after changing the current entry's address, not another's", async () => {
    const daemons = registry();
    const current = entryOf(daemons, "b");
    expect(
      await submitEdit(daemons, current, {
        ...initialEditFields(current),
        address: "ws://10.0.0.8:6767",
      }),
    ).toEqual({ status: "saved", reconnect: true });

    const other = entryOf(daemons, "d");
    expect(
      await submitEdit(daemons, other, {
        ...initialEditFields(other),
        address: "ws://10.0.0.7:6767",
      }),
    ).toEqual({ status: "saved", reconnect: false });
  });

  it("offers a reconnect after changing the current local password", async () => {
    const daemons = registry();
    void daemons.switchTo("local");
    const local = entryOf(daemons, "local");
    expect(
      await submitEdit(daemons, local, { ...initialEditFields(local), password: "new" }),
    ).toEqual({ status: "saved", reconnect: true });
  });

  it("shows name_taken at the name and keeps the entry", async () => {
    const daemons = registry();
    const entry = entryOf(daemons, "d");
    const outcome = await submitEdit(daemons, entry, {
      ...initialEditFields(entry),
      name: "Office",
    });
    expect(outcome).toEqual({
      status: "refused",
      errors: { name: daemonErrorView("name_taken").message },
    });
    expect(entryOf(daemons, "d").name).toBe("Plain");
  });

  it("shows not_found at the form when the entry vanished", async () => {
    const daemons = registry();
    const entry = entryOf(daemons, "d");
    await daemons.remove("d");
    const outcome = await submitEdit(daemons, entry, { ...initialEditFields(entry), name: "Zed" });
    expect(outcome).toEqual({
      status: "refused",
      errors: { form: daemonErrorView("not_found").message },
    });
  });
});

describe("linkReplaced", () => {
  const relay: DaemonEntryView = { id: "r", kind: "relay", name: "R", hasPassword: false };
  const direct: DaemonEntryView = { id: "d", kind: "direct", name: "D", hasPassword: false };

  it("is true when a link was typed for a relay entry", () => {
    expect(
      linkReplaced(relay, { ...initialEditFields(relay), pairingLink: " https://x/#offer=a " }),
    ).toBe(true);
  });

  it("is false for an empty link or an entry that has none", () => {
    expect(linkReplaced(relay, initialEditFields(relay))).toBe(false);
    expect(linkReplaced(direct, { ...initialEditFields(direct), pairingLink: "x" })).toBe(false);
  });
});
