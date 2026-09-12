import { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://paxones.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/adminnarayan/',
          '/admin/',
          '/dashboard/',
          '/wallets/',
          '/trades/',
          '/settings/',
          '/my-ads/',
          '/my-tickets/',
          '/notifications/',
          '/trade/initiate/',
          '/api/',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
