/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== "production";

const securityHeaders = (analyticsEnabled) => [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      `img-src 'self' data: blob:${analyticsEnabled ? " https://www.googletagmanager.com https://*.google-analytics.com" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}${analyticsEnabled ? " https://www.googletagmanager.com" : ""}`,
      `connect-src 'self'${isDevelopment ? " ws: wss:" : ""}${analyticsEnabled ? " https://www.googletagmanager.com https://*.google-analytics.com https://analytics.google.com" : ""}`,
    ].join("; "),
  },
];

const nextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    const analyticsEnabled = /^G-[A-Z0-9]{10}$/.test(
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "",
    );

    return [
      {
        source: "/(.*)",
        headers: securityHeaders(analyticsEnabled),
      },
    ];
  },
};

export default nextConfig;
