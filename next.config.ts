import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: '/room/:roomId',
          destination: '/',
        },
        {
          source: '/:roomId',
          destination: '/',
        },
      ],
    };
  },
};

export default nextConfig;
