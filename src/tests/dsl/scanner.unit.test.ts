import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DslScanner } from "../../dsl/scanner.js";
import { DslParseError } from "../../dsl/types.js";

describe("DslScanner", () => {
  describe("lineNumber", () => {
    it("starts at 1", () => {
      const s = new DslScanner("hello\nworld");
      assert.equal(s.lineNumber, 1);
    });
  });

  describe("isEof", () => {
    it("is false for non-empty input", () => {
      const s = new DslScanner("content");
      assert.equal(s.isEof(), false);
    });

    it("becomes true after all lines consumed", () => {
      const s = new DslScanner("one\ntwo");
      s.consumeLine();
      s.consumeLine();
      assert.equal(s.isEof(), true);
    });
  });

  describe("peekLine", () => {
    it("returns current line without advancing", () => {
      const s = new DslScanner("first\nsecond");
      assert.equal(s.peekLine(), "first");
      assert.equal(s.peekLine(), "first");
      assert.equal(s.lineNumber, 1);
    });

    it("returns empty string when at EOF", () => {
      const s = new DslScanner("only");
      s.consumeLine();
      assert.equal(s.peekLine(), "");
    });
  });

  describe("consumeLine", () => {
    it("returns lines in order and advances position", () => {
      const s = new DslScanner("a\nb\nc");
      assert.equal(s.consumeLine(), "a");
      assert.equal(s.lineNumber, 2);
      assert.equal(s.consumeLine(), "b");
      assert.equal(s.lineNumber, 3);
      assert.equal(s.consumeLine(), "c");
      assert.equal(s.isEof(), true);
    });

    it("throws DslParseError at EOF", () => {
      const s = new DslScanner("only");
      s.consumeLine();
      assert.throws(
        () => s.consumeLine(),
        (err: unknown) =>
          err instanceof DslParseError &&
          /Unexpected end of input/.test(err.message),
      );
    });

    it("normalizes CRLF line endings", () => {
      const s = new DslScanner("line1\r\nline2\r\nline3");
      assert.equal(s.consumeLine(), "line1");
      assert.equal(s.consumeLine(), "line2");
      assert.equal(s.consumeLine(), "line3");
    });

    it("normalizes standalone CR line endings", () => {
      const s = new DslScanner("line1\rline2\rline3");
      assert.equal(s.consumeLine(), "line1");
      assert.equal(s.consumeLine(), "line2");
      assert.equal(s.consumeLine(), "line3");
    });
  });

  describe("skipBlanks", () => {
    it("advances past empty lines", () => {
      const s = new DslScanner("\n\n\nCONTENT");
      s.skipBlanks();
      assert.equal(s.peekLine(), "CONTENT");
      assert.equal(s.lineNumber, 4);
    });

    it("advances past comment lines", () => {
      const s = new DslScanner("# comment one\n# comment two\nCONTENT");
      s.skipBlanks();
      assert.equal(s.peekLine(), "CONTENT");
      assert.equal(s.lineNumber, 3);
    });

    it("advances past interleaved blanks and comments", () => {
      const s = new DslScanner("\n# comment\n\n# another\nACTUAL");
      s.skipBlanks();
      assert.equal(s.peekLine(), "ACTUAL");
      assert.equal(s.lineNumber, 5);
    });

    it("does nothing when already at meaningful content", () => {
      const s = new DslScanner("MEANINGFUL");
      s.skipBlanks();
      assert.equal(s.peekLine(), "MEANINGFUL");
      assert.equal(s.lineNumber, 1);
    });

    it("reaches EOF when only blanks and comments remain", () => {
      const s = new DslScanner("\n# comment\n");
      s.skipBlanks();
      assert.equal(s.isEof(), true);
    });
  });

  describe("consumeHeredoc", () => {
    it("collects lines until >>> marker", () => {
      const s = new DslScanner("line one\nline two\n>>>\nafter");
      const result = s.consumeHeredoc();
      assert.equal(result, "line one\nline two");
      assert.equal(s.peekLine(), "after");
    });

    it("returns empty string for immediate >>>", () => {
      const s = new DslScanner(">>>\nrest");
      const result = s.consumeHeredoc();
      assert.equal(result, "");
      assert.equal(s.peekLine(), "rest");
    });

    it("detects >>> with surrounding whitespace", () => {
      const s = new DslScanner("content\n   >>>   \nafter");
      const result = s.consumeHeredoc();
      assert.equal(result, "content");
    });

    it("preserves indentation in collected lines", () => {
      const s = new DslScanner("  indented\n    more\n>>>");
      const result = s.consumeHeredoc();
      assert.equal(result, "  indented\n    more");
    });

    it("normalizes triple braces to double", () => {
      const s = new DslScanner("{{{params.x}}}\n>>>");
      const result = s.consumeHeredoc();
      assert.equal(result, "{{params.x}}");
    });

    it("normalizes quadruple+ braces to double", () => {
      const s = new DslScanner("{{{{value}}}}\n>>>");
      const result = s.consumeHeredoc();
      assert.equal(result, "{{value}}");
    });

    it("leaves double braces untouched", () => {
      const s = new DslScanner("{{normal}}\n>>>");
      const result = s.consumeHeredoc();
      assert.equal(result, "{{normal}}");
    });

    it("removes CR characters from heredoc content with CRLF input", () => {
      const s = new DslScanner("hello world\r\nsecond line\r\n>>>\r\nafter");
      const result = s.consumeHeredoc();
      assert.equal(result, "hello world\nsecond line");
      assert.ok(!result.includes("\r"));
    });

    it("throws on unterminated input", () => {
      const s = new DslScanner("line one\nline two");
      assert.throws(
        () => s.consumeHeredoc(5),
        (err: unknown) =>
          err instanceof DslParseError &&
          err.line === 5 &&
          /Unterminated heredoc/.test(err.message),
      );
    });

    it("uses current lineNumber as default startLine", () => {
      const s = new DslScanner("filler\nline one\nline two");
      s.consumeLine();
      assert.throws(
        () => s.consumeHeredoc(),
        (err: unknown) => err instanceof DslParseError && err.line === 2,
      );
    });
  });

  describe("err", () => {
    it("throws DslParseError with current line number", () => {
      const s = new DslScanner("a\nb\nc");
      s.consumeLine();
      s.consumeLine();
      assert.throws(
        () => s.err("something went wrong"),
        (err: unknown) =>
          err instanceof DslParseError &&
          err.line === 3 &&
          /something went wrong/.test(err.message),
      );
    });
  });
});
