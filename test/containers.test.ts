// @vitest-environment jsdom
import { LoroDoc, LoroText, UndoManager } from "loro-crdt";
import { afterEach, describe, expect, test } from "vitest";
import { LoroExtensions, undo } from "../src/index.ts";
import { makeView, peerOf, sync, tick, type } from "./helpers.ts";

afterEach(() => {
    document.body.innerHTML = "";
});

// A doc's events arrive parents first, then in the order the doc first
// registered each container, whatever order the edits were made in.
type Layout = {
    name: string;
    setup: (doc: LoroDoc) => void;
    text: (doc: LoroDoc) => LoroText;
    /** Changes the bound text's parent, so the parent's event comes first. */
    editParent?: (doc: LoroDoc) => void;
};

const layouts: Layout[] = [
    {
        name: "bound text registered first",
        setup: (doc) => {
            doc.getText("codemirror").insert(0, "note");
            doc.getMap("meta").set("title", "a");
            doc.getText("other").insert(0, "x");
        },
        text: (doc) => doc.getText("codemirror"),
    },
    {
        name: "map registered first",
        setup: (doc) => {
            doc.getMap("meta").set("title", "a");
            doc.getText("codemirror").insert(0, "note");
            doc.getText("other").insert(0, "x");
        },
        text: (doc) => doc.getText("codemirror"),
    },
    {
        name: "second text registered first",
        setup: (doc) => {
            doc.getText("other").insert(0, "x");
            doc.getText("codemirror").insert(0, "note");
            doc.getMap("meta").set("title", "a");
        },
        text: (doc) => doc.getText("codemirror"),
    },
    {
        name: "bound text inside a map",
        setup: (doc) => {
            const text = doc
                .getMap("files")
                .setContainer("a.md", new LoroText());
            text.insert(0, "note");
            doc.getText("other").insert(0, "x");
        },
        text: (doc) => doc.getMap("files").get("a.md") as LoroText,
        editParent: (doc) => doc.getMap("files").set("title", "b"),
    },
];

const editOrders: [string, (doc: LoroDoc, text: LoroText) => void][] = [
    [
        "text, map, other",
        (doc, text) => {
            text.insert(0, "remote ");
            doc.getMap("meta").set("title", "b");
            doc.getText("other").insert(0, "y");
        },
    ],
    [
        "other, map, text",
        (doc, text) => {
            doc.getText("other").insert(0, "y");
            doc.getMap("meta").set("title", "b");
            text.insert(0, "remote ");
        },
    ],
];

describe.each(layouts)("a doc with several containers: $name", (layout) => {
    test.each(editOrders)(
        "a remote change in one commit (%s) reaches the editor",
        async (_, edit) => {
            const doc = new LoroDoc();
            doc.setPeerId(1n);
            layout.setup(doc);
            doc.commit();
            const view = makeView(
                "",
                LoroExtensions(doc, undefined, undefined, layout.text)
            );
            await tick();
            expect(view.state.doc.toString()).toBe("note");

            const remote = peerOf(doc, 2n);
            edit(remote, layout.text(remote));
            layout.editParent?.(remote);
            remote.commit();
            sync(remote, doc);

            expect(layout.text(doc).toString()).toBe("remote note");
            expect(view.state.doc.toString()).toBe("remote note");

            // Later edits from both sides still line up.
            type(view, view.state.doc.length, "!");
            layout.text(remote).insert(0, ">");
            remote.commit();
            sync(remote, doc);
            sync(doc, remote);
            expect(layout.text(doc).toString()).toBe(">remote note!");
            expect(view.state.doc.toString()).toBe(">remote note!");
        }
    );

    test("undoing a commit that touched other containers reaches the editor", async () => {
        const doc = new LoroDoc();
        doc.setPeerId(1n);
        layout.setup(doc);
        doc.commit();
        const undoManager = new UndoManager(doc, { mergeInterval: 60_000 });
        const view = makeView(
            "",
            LoroExtensions(doc, undefined, undoManager, layout.text)
        );
        await tick();

        // Typing, then the app updating other containers: within the merge
        // interval, so one undo step covers all of them.
        type(view, 4, " more");
        doc.getMap("meta").set("title", "c");
        doc.getText("other").insert(0, "z");
        doc.commit();
        expect(layout.text(doc).toString()).toBe("note more");

        undo(view);
        await tick();
        expect(layout.text(doc).toString()).toBe("note");
        expect(view.state.doc.toString()).toBe("note");
    });
});
