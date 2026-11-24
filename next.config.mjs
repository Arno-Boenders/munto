/** @type {import('next').NextConfig} */
const nextConfig = {
  // The floating dev badge sits on top of the nav's theme button; errors still show in the overlay.
  devIndicators: false,
  // The desktop app builds into its own folder, so it never touches the one `npm run ui` is using.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Munto has no images to resize: this switches off the /_next/image endpoint altogether.
  images: { unoptimized: true },
  // The dev server's interface for coding agents; Munto doesn't use it (see scripts/dev-server.mjs).
  experimental: { mcpServer: false },
};

export default nextConfig;
