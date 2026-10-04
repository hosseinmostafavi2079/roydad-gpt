"use client";

import { useState } from "react";

export function PublicEventArtwork({
  src,
  title,
  category,
  type,
  eager = false,
  className = "",
}: {
  src: string | null;
  title: string;
  category: string;
  type: string;
  eager?: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={`public-event-artwork ${className}`}>
      <div className="public-event-artwork-fallback" aria-hidden="true">
        <span>
          {category || (type === "COURSE" ? "دوره آموزشی" : "رویداد")}
        </span>
        <strong>{title}</strong>
        <i />
      </div>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className={loaded ? "is-loaded" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
