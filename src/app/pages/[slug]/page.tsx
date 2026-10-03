import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { publicMetadata } from "@/modules/public-site/metadata";
import {
  getInformationPage,
  listSiteEntries,
} from "@/modules/public-site/content";
import { SafeRichText } from "@/app/_components/safe-rich-text";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { tenant, profile, origin } = await publicPageContext();
    const page = await getInformationPage(tenant, (await params).slug);
    return publicMetadata(
      tenant,
      profile,
      origin,
      `/pages/${page.slug}`,
      page.seoTitle || page.title,
      page.metaDescription,
    );
  } catch {
    return { robots: { index: false } };
  }
}
export default async function InformationPage({ params }: Props) {
  const { tenant, profile } = await publicPageContext();
  const page = await getInformationPage(tenant, (await params).slug).catch(() =>
    notFound(),
  );
  const faqs = page.blocks.some((block) => block.type === "faqGroup")
    ? await listSiteEntries(tenant, "FAQ")
    : [];
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <article className="public-information-page">
        <header className="public-page-header">
          <h1>{page.title}</h1>
        </header>
        {page.blocks.map((block) => {
          switch (block.type) {
            case "heading":
              return <h2 key={block.id}>{block.text}</h2>;
            case "text":
              return (
                <p key={block.id}>
                  <SafeRichText text={block.text} />
                </p>
              );
            case "list":
              return block.ordered ? (
                <ol key={block.id}>
                  {block.items.map((item) => (
                    <li key={item}>
                      <SafeRichText text={item} />
                    </li>
                  ))}
                </ol>
              ) : (
                <ul key={block.id}>
                  {block.items.map((item) => (
                    <li key={item}>
                      <SafeRichText text={item} />
                    </li>
                  ))}
                </ul>
              );
            case "image":
              return block.imageUrl ? (
                <figure key={block.id}>
                  <img src={block.imageUrl} alt={block.alt} loading="lazy" />
                  <figcaption>{block.caption}</figcaption>
                </figure>
              ) : null;
            case "imageText":
              return (
                <div className="public-image-text" key={block.id}>
                  {block.imageUrl && (
                    <img src={block.imageUrl} alt={block.alt} loading="lazy" />
                  )}
                  <p>{block.text}</p>
                </div>
              );
            case "callout":
              return (
                <aside className="public-callout" key={block.id}>
                  {block.text}
                </aside>
              );
            case "cta":
              return (
                <Link
                  className="public-button"
                  key={block.id}
                  href={block.href}
                >
                  {block.text}
                </Link>
              );
            case "faqGroup":
              return (
                <div className="public-faq-list" key={block.id}>
                  {faqs.map(
                    (entry) =>
                      entry.content.kind === "FAQ" && (
                        <details key={entry.id}>
                          <summary>{entry.content.question}</summary>
                          <p>{entry.content.answer}</p>
                        </details>
                      ),
                  )}
                </div>
              );
          }
          return null;
        })}
      </article>
    </PublicSiteShell>
  );
}
