import { DslParseError } from "./types.js";

export class DslScanner {
  private readonly lines: string[];
  private pos = 0;

  constructor(dsl: string) {
    this.lines = dsl.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }

  get lineNumber(): number {
    return this.pos + 1;
  }

  isEof(): boolean {
    return this.pos >= this.lines.length;
  }

  peekLine(): string {
    return this.lines[this.pos] ?? "";
  }

  consumeLine(): string {
    if (this.pos >= this.lines.length) {
      throw new DslParseError(this.lines.length, "Unexpected end of input");
    }
    return this.lines[this.pos++];
  }

  skipBlanks(): void {
    while (this.pos < this.lines.length) {
      const trimmed = this.lines[this.pos].trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        this.pos++;
        continue;
      }
      return;
    }
  }

  consumeHeredoc(startLine = this.lineNumber): string {
    const collected: string[] = [];

    while (!this.isEof()) {
      const line = this.consumeLine();
      if (line.trim() === ">>>") {
        return (
          collected
            .join("\n")
            // Normalize extra braces to {{value}} templates.
            .replace(/\{{3,}([^}]+)\}{3,}/g, "{{$1}}")
        );
      }
      collected.push(line);
    }

    throw new DslParseError(startLine, "Unterminated heredoc (missing >>>)");
  }

  err(message: string): never {
    throw new DslParseError(this.lineNumber, message);
  }
}
