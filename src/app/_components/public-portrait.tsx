"use client";

import { useState } from "react";

export function PublicPortrait({
  src,
  name,
  className = "",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={`public-portrait ${className}`}>
      <span aria-hidden="true">{name.slice(0, 1)}</span>
      {src && !failed && (
        <img
          src={src}
          alt={`تصویر ${name}`}
          loading="lazy"
          decoding="async"
          className={loaded ? "is-loaded" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
