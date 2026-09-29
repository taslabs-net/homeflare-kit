/**
 * An MCP tool result as the text a model reads.
 *
 * ★ ALWAYS A STRING. A result is a list of content blocks (text, image, audio, a resource, a
 *   link), and what goes into the model's context is one message. Text is passed through
 *   verbatim, joined by newlines; everything else becomes a one-line marker naming what it was.
 * ⛔ A BINARY BLOCK NEVER REACHES THE MODEL AS ITS BYTES. An image's base64 is tens of
 *   kilobytes of context that says nothing to a text model and costs every later round; the
 *   marker keeps its type and MIME type so the model knows something was there.
 * ⚠️ AN EMPTY RESULT IS NOT AN EMPTY STRING. Some providers refuse a tool message with empty
 *   content (not measured against cf-code), and a refused request ends the whole run over a
 *   tool that merely had nothing to say.
 */

/** What the model reads for a tool that returned no content blocks. */
export const EMPTY_RESULT = '(no content)';

type Block = Readonly<Record<string, unknown>>;

const isBlock = (value: unknown): value is Block => typeof value === 'object' && value !== null;
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** One block. The shapes are MCP's `TextContent`, `ImageContent`, `AudioContent`, `ResourceLink`, `EmbeddedResource`. */
function renderBlock(block: Block): string {
  const type = str(block['type']) ?? 'unknown';
  switch (type) {
    case 'text':
      return str(block['text']) ?? '';
    case 'image':
    case 'audio':
      return `[${type}: ${str(block['mimeType']) ?? 'unknown type'}, not shown]`;
    case 'resource_link':
      return `[resource link: ${str(block['uri']) ?? 'no uri'}]`;
    case 'resource': {
      const resource = isBlock(block['resource']) ? block['resource'] : {};
      // An embedded resource is either text (shown) or a base64 blob (not).
      return str(resource['text']) ?? `[resource: ${str(resource['uri']) ?? 'no uri'}, not shown]`;
    }
    default:
      return `[unsupported content block: ${type}]`;
  }
}

/** The text of a `CallToolResult.content`. Anything that is not a block list is JSON, not dropped. */
export function renderContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return content === undefined ? EMPTY_RESULT : JSON.stringify(content);
  }
  const lines = content.map((block: unknown) =>
    isBlock(block) ? renderBlock(block) : JSON.stringify(block),
  );
  return lines.length === 0 ? EMPTY_RESULT : lines.join('\n');
}

/**
 * The text of a whole `callTool` result. ★ The `content` blocks are what MCP asks a server to
 * always send; a server that sends only `structuredContent` (an `outputSchema` tool that skipped
 * the text copy) would otherwise read as empty, so its JSON is shown instead. The legacy
 * `toolResult` shape (the SDK's compatibility result) is read as content.
 */
export function renderResult(result: Readonly<Record<string, unknown>>): string {
  const content = 'content' in result ? result['content'] : result['toolResult'];
  if (Array.isArray(content) && content.length === 0 && result['structuredContent'] !== undefined) {
    return JSON.stringify(result['structuredContent']);
  }
  return renderContent(content);
}
