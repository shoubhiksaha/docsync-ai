import path from 'path';
import { fileURLToPath } from 'url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing to this project so a stray lockfile in a parent folder can't change what ships.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // The Cloud Run container (Dockerfile) builds a self-contained server (.next/standalone). It runs
  // only after CI's lint and type checks passed on the same commit, so it skips repeating them;
  // the type check alone needs more memory than the build. Local builds keep `next start` working.
  ...(process.env.CONTAINER_BUILD === '1' && {
    output: 'standalone',
    eslint: { ignoreDuringBuilds: true },
    typescript: { ignoreBuildErrors: true },
  }),
  serverExternalPackages: ['firebase-admin', 'googleapis', 'jwks-rsa', 'jose'],
  env: {
    // Git SHA of this build, reported by /api/health so post-deploy checks can confirm
    // the expected commit is live. The deploy passes it to `docker build` as APP_BUILD_SHA.
    APP_BUILD_SHA: process.env.APP_BUILD_SHA || process.env.GITHUB_SHA || 'dev',
  },
};

export default nextConfig;
