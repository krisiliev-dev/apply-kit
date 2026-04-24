import { describe, it, expect, beforeEach } from "vitest";
import {
  allComments,
  commentsByNodeId,
  unresolvedComments,
  unresolvedCommentCount,
  useEditor,
} from "@/lib/doc/store";
import { defaultTheme, A4, type CvDocument } from "@/lib/doc/types";

// ————————————————————————————————————————————
// Covers the additive comment actions on the doc store. Each test seeds a
// minimal document with one text node so we can exercise comment anchors
// without pulling in the seed-demo content.
// ————————————————————————————————————————————

const seedDoc = (): CvDocument => ({
  slug: "test",
  targetRole: "Test",
  pages: [
    {
      id: "p1",
      width: A4.width,
      height: A4.height,
      nodes: [
        {
          id: "n1",
          type: "text",
          x: 20,
          y: 20,
          w: 100,
          h: 10,
          z: 1,
          content: "Hello",
          style: { fontSize: 12, fontWeight: 400, color: "#111" },
        },
        {
          id: "n2",
          type: "text",
          x: 20,
          y: 40,
          w: 100,
          h: 10,
          z: 2,
          content: "World",
          style: { fontSize: 12, fontWeight: 400, color: "#111" },
        },
      ],
    },
  ],
  theme: defaultTheme,
  updatedAt: 1,
});

beforeEach(() => {
  useEditor.getState().loadDoc(seedDoc());
});

describe("doc comments — store", () => {
  it("treats a doc without `comments` as an empty list", () => {
    const { doc } = useEditor.getState();
    expect(doc.comments).toBeUndefined();
    expect(allComments(doc)).toEqual([]);
    expect(unresolvedCommentCount(doc)).toBe(0);
  });

  it("adds a comment and returns the new id", () => {
    const id = useEditor.getState().addComment({
      nodeId: "n1",
      body: "tighten this bullet",
      author: "user",
    });
    expect(typeof id).toBe("string");
    const list = allComments(useEditor.getState().doc);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].body).toBe("tighten this bullet");
    expect(list[0].author).toBe("user");
    expect(list[0].createdAt).toBeGreaterThan(0);
    expect(list[0].resolvedAt).toBeUndefined();
  });

  it("honors an explicit id/createdAt when provided", () => {
    const id = useEditor.getState().addComment({
      id: "fixed-id",
      nodeId: "n1",
      body: "seeded",
      author: "ai",
      createdAt: 1234,
    });
    expect(id).toBe("fixed-id");
    const c = allComments(useEditor.getState().doc)[0];
    expect(c.id).toBe("fixed-id");
    expect(c.createdAt).toBe(1234);
    expect(c.author).toBe("ai");
  });

  it("patches a comment via updateComment", () => {
    const id = useEditor
      .getState()
      .addComment({ nodeId: "n1", body: "draft", author: "user" });
    useEditor.getState().updateComment(id, { body: "finalised" });
    const c = allComments(useEditor.getState().doc)[0];
    expect(c.body).toBe("finalised");
  });

  it("resolveComment sets resolvedAt; reopenComment clears it", () => {
    const id = useEditor
      .getState()
      .addComment({ nodeId: "n1", body: "fix", author: "user" });
    useEditor.getState().resolveComment(id);
    let c = allComments(useEditor.getState().doc)[0];
    expect(c.resolvedAt).toBeTypeOf("number");

    useEditor.getState().reopenComment(id);
    c = allComments(useEditor.getState().doc)[0];
    expect(c.resolvedAt).toBeUndefined();
  });

  it("deleteComment drops the comment", () => {
    const a = useEditor
      .getState()
      .addComment({ nodeId: "n1", body: "a", author: "user" });
    useEditor
      .getState()
      .addComment({ nodeId: "n2", body: "b", author: "user" });
    useEditor.getState().deleteComment(a);
    const list = allComments(useEditor.getState().doc);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("b");
  });

  it("commentsByNodeId filters by anchor and unresolvedCommentCount ignores resolved", () => {
    const one = useEditor
      .getState()
      .addComment({ nodeId: "n1", body: "one", author: "user" });
    useEditor
      .getState()
      .addComment({ nodeId: "n1", body: "two", author: "ai" });
    useEditor
      .getState()
      .addComment({ nodeId: "n2", body: "three", author: "user" });

    const doc = useEditor.getState().doc;
    expect(commentsByNodeId(doc, "n1")).toHaveLength(2);
    expect(commentsByNodeId(doc, "n2")).toHaveLength(1);
    expect(unresolvedCommentCount(doc)).toBe(3);

    useEditor.getState().resolveComment(one);
    expect(unresolvedCommentCount(useEditor.getState().doc)).toBe(2);
    expect(
      unresolvedComments(useEditor.getState().doc).map((c) => c.body).sort(),
    ).toEqual(["three", "two"]);
  });

  it("comment mutations bump updatedAt so zundo registers a step", () => {
    const before = useEditor.getState().doc.updatedAt;
    // Ensure Date.now() differs — tests run fast so force a tick.
    const originalNow = Date.now;
    Date.now = () => before + 1000;
    try {
      useEditor
        .getState()
        .addComment({ nodeId: "n1", body: "x", author: "user" });
    } finally {
      Date.now = originalNow;
    }
    expect(useEditor.getState().doc.updatedAt).toBeGreaterThan(before);
  });
});
