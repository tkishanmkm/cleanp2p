import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/'], // Protect private backend endpoints
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
