import { Helmet } from "react-helmet-async";

const SITE_URL = "https://aicis-divine-core.lovable.app";

interface SEOProps {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
}

export function SEO({ title, description, path, type = "website" }: SEOProps) {
  const url = `${SITE_URL}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}
