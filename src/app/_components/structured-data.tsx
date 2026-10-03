// biome-ignore-all lint/security/noDangerouslySetInnerHtml: JSON-LD is serialized from server data and HTML delimiters are escaped before insertion.
import "server-only";

export function StructuredData({ value }: { value: Record<string, unknown> }) {
  const json = JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
