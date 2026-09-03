import path from "node:path";
import type { NextConfig } from "next";

// billing-stripe-kit vit désormais dans son propre repo, cloné en frère du
// dossier racine de ce repo (pas dans packages/ depuis le 2026-09-03, cf.
// packages/billing-stripe-kit/README.md) — donc deux niveaux au-dessus de
// web/, pas un seul. Turbopack refuse de résoudre un module dont le chemin
// réel (après symlink file:) tombe hors de la racine configurée.
const workspaceRoot = path.join(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ["billing-stripe-kit"],
};

export default nextConfig;
