import { MetadataRoute } from 'next';

const WAYONES_ORIGIN = 'https://wayones.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/'],
    },
    sitemap: `${WAYONES_ORIGIN}/sitemap.xml`,
    host: WAYONES_ORIGIN,
  };
}
