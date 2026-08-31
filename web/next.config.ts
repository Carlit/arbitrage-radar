import path from "node:path";
import type { NextConfig } from "next";

// Le monorepo root (pas web/ lui-même) : packages/billing-stripe-kit vit en
// dehors de web/, et Turbopack refuse de résoudre un module dont le chemin
// réel (après symlink file:) tombe hors de la racine configurée.
const monorepoRoot = path.join(process.cwd(), "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  transpilePackages: ["billing-stripe-kit"],
};

export default nextConfig;
