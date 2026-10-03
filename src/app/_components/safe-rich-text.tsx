import Link from "next/link";
import type { ReactNode } from "react";

const marks =
  /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((\/[a-z0-9][a-z0-9/-]*)\)/g;

export function SafeRichText({ text }: { text: string }) {
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(marks)) {
    const index = match.index;
    if (index > cursor) output.push(text.slice(cursor, index));
    if (match[1]) output.push(<strong key={index}>{match[1]}</strong>);
    else if (match[2]) output.push(<em key={index}>{match[2]}</em>);
    else if (match[3] && match[4])
      output.push(
        <Link key={index} href={match[4]}>
          {match[3]}
        </Link>,
      );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return <>{output}</>;
}
