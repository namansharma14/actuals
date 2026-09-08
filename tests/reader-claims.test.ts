import { describe, expect, it } from "vitest";
import { deliveredFrom } from "../src/read/claude_code/index.js";

describe("report_delivered heuristic (D16): a deliverable asserted in chat, not backed by a Write", () => {
  it("names an unbacked path as delivered", () => {
    expect(deliveredFrom("I wrote the audit to docs/audit.md for you.", [])).toEqual(["docs/audit.md"]);
  });
  it("skips a path the owner actually wrote (that is file_written, not report_delivered)", () => {
    expect(deliveredFrom("I created src/parser.ts", ["/repo/src/parser.ts"])).toEqual([]);
    expect(deliveredFrom("Saved it to notes.md", ["notes.md"])).toEqual([]);
  });
  it("catches an in-chat deliverable only when nothing at all was written", () => {
    expect(deliveredFrom("Here is a summary of the findings for the team.", [])).toEqual(["(in chat)"]);
    expect(deliveredFrom("Here is a summary of the findings.", ["src/x.ts"])).toEqual([]); // wrote something -> not in-chat
  });
  it("stays silent on ambiguous prose and mentions with no delivery verb (undercount)", () => {
    expect(deliveredFrom("I looked at the code and it seems fine.", [])).toEqual([]);
    expect(deliveredFrom("The file config.yaml controls this behaviour.", [])).toEqual([]);
    expect(deliveredFrom("", [])).toEqual([]);
  });
});
