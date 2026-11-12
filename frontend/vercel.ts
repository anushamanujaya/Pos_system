// Each frontend project proxies to its own API origin, preserving same-origin cookies.
const demo = process.env.VITE_DEMO_MODE === 'true';
const origin = demo ? process.env.DEMO_API_ORIGIN : 'https://pos-system-mu-wine.vercel.app';
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
  throw new Error('DEMO_API_ORIGIN must be an HTTPS origin without a path');
}

export const config = {
  rewrites: [
    { source: '/api/:path*', destination: `${origin}/api/:path*` },
    { source: '/uploads/:path*', destination: `${origin}/uploads/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
