#!/usr/bin/env bash
set -e

# Deploy gossamer-cmux: publish the CLI to npm and keep the Claude Code plugin
# manifests in version-sync. cmux itself has no plugin registry — it consumes
# this via the `gossamer` CLI (npm) plus a cmux.json config — and the Claude Code
# plugin is distributed straight from this GitHub repo's marketplace.json, so
# "deploying" is: publish to npm, bump the manifest versions, and push.
#
# Usage: ./deploy.sh [patch|minor|major]   (default: patch)

BUMP=${1:-patch}
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

echo "→ Building..."
npm run build

echo "→ Bumping $BUMP version..."
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -e "console.log(require('./package.json').version)")

echo "→ Syncing version ${VERSION} into plugin manifests..."
node -e "
  const fs = require('fs');
  const v = '${VERSION}';
  const root = '${ROOT}';
  for (const f of [
    root + '/cmux/claude-plugin/.claude-plugin/plugin.json',
    root + '/.claude-plugin/marketplace.json',
  ]) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (j.version !== undefined) j.version = v;
    if (Array.isArray(j.plugins)) j.plugins.forEach(p => { if (p.name === 'gossamer-cmux') p.version = v; });
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log('  updated ' + f);
  }
"

echo "→ Publishing gossamer-cmux@${VERSION} to npm..."
npm publish --access public

echo "✓ Published gossamer-cmux@${VERSION}"
echo
echo "Next:"
echo "  git commit -am \"gossamer-cmux v${VERSION}\""
echo "  git push origin main --follow-tags"
echo
echo "Users install the cmux plugin with:"
echo "  /plugin marketplace add ashvinbondada/gossamer-preview"
echo "  /plugin install gossamer-cmux@gossamer"
