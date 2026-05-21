import { describe, expect, it } from "bun:test";

import { isSubtypeStr, parseType } from "../src/index.js";

describe("structural type system", () => {
  it("parses nested types", () => {
    const t = parseType("Dict[str, List[CRMRecord]]");
    expect(t.head).toBe("Dict");
    expect(t.args[0].head).toBe("str");
    expect(t.args[1].head).toBe("List");
    expect(t.args[1].args[0].head).toBe("CRMRecord");
    expect(t.toString()).toBe("Dict[str, List[CRMRecord]]");
  });

  it("nominal types are subtypes only of themselves", () => {
    expect(isSubtypeStr("URL", "URL")).toBe(true);
    expect(isSubtypeStr("URL", "LeadId")).toBe(false);
  });

  it("Any is top", () => {
    expect(isSubtypeStr("CRMRecord", "Any")).toBe(true);
    expect(isSubtypeStr("List[int]", "Any")).toBe(true);
  });

  it("Optional and null", () => {
    expect(isSubtypeStr("URL", "Optional[URL]")).toBe(true);
    expect(isSubtypeStr("null", "Optional[URL]")).toBe(true);
    expect(isSubtypeStr("Optional[URL]", "URL")).toBe(false);
  });

  it("containers are covariant", () => {
    expect(isSubtypeStr("List[URL]", "List[URL]")).toBe(true);
    expect(isSubtypeStr("List[URL]", "List[LeadId]")).toBe(false);
  });

  it("structural arity is enforced", () => {
    expect(() => parseType("Dict[str]")).toThrow();
  });
});
