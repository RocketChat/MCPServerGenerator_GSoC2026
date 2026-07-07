/**
 * Neutralize DSL-controlled text before it is embedded into generated source.
 *
 * Generated files interpolate workflow names, descriptions, and step ids that
 * originate from user-authored DSL. Left raw, a value such as a DESCRIPTION
 * containing a comment terminator could close a block comment and turn the
 * remainder of the file into executable generated code. These helpers make
 * such text inert for the context it lands in.
 */

/**
 * Make `text` safe to embed inside a block comment: break any comment-closing
 * sequence and collapse newlines so the text stays on its comment line. The
 * transformation only affects otherwise-inert comment text.
 */
export function escapeBlockComment(text: string): string {
  return String(text ?? "")
    .replace(/\*\//g, "*\\/")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * Make `text` safe inside a Markdown table cell: escape the pipe delimiter and
 * drop newlines so a user-supplied value cannot break the table layout.
 */
export function escapeMarkdownCell(text: string): string {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}
