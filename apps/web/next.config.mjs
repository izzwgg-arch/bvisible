import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standalone output is gated on NEXT_BUILD_STANDALONE=1. The deploy queue
// exports that env var before `pnpm run build`; local Windows dev builds
// leave it unset because Next standalone uses symlinks that hit EPERM on
// Windows. See server-scripts/deploy-queue/deploy-once.sh.
const isStandalone = process.env.NEXT_BUILD_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  serverExternalPackages: ['sharp', 'pdf-parse'],
  experimental: {
    // PO attachments accept up to 25 MB (see apps/web/lib/po/uploads.ts:
    // MAX_UPLOAD_BYTES). The Server Actions default body limit is 1 MB,
    // which would reject every realistic PDF/JPEG before it reached our
    // own size check.
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  ...(isStandalone
    ? {
        output: 'standalone',
        // Trace from the workspace root so `@bvisible/db` and other
        // workspace packages get bundled into .next/standalone/node_modules.
        // Without this, Next traces only relative to apps/web and the
        // standalone server crashes at boot resolving workspace deps.
        outputFileTracingRoot: path.join(__dirname, '../../'),
      }
    : {}),
};

export default nextConfig;
