export const getURL = () => {
  // Dynamically detect current host in browser runtime (e.g., http://localhost:3000, preview domain, or https://paxones.com)
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  let url =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://paxones.com';

  // Ensure path starts with http/https and remove trailing slash
  url = url.includes('http') ? url : `https://${url}`;
  url = url.charAt(url.length - 1) === '/' ? url.slice(0, -1) : url;
  
  return url;
};
