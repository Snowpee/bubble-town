#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const desktopPackagePath = path.join(rootDir, 'apps', 'desktop', 'package.json');
const releaseDir = path.join(rootDir, 'apps', 'desktop', 'release');

function parseArgs(argv) {
  const options = {
    dryRun: false,
    skipBuild: false,
    draft: false,
    prerelease: false,
    clobber: true,
    generateNotes: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--version':
        options.version = next();
        break;
      case '--tag':
        options.tag = next();
        break;
      case '--title':
        options.title = next();
        break;
      case '--notes':
        options.notes = next();
        options.generateNotes = false;
        break;
      case '--notes-file':
        options.notesFile = next();
        options.generateNotes = false;
        break;
      case '--repo':
        options.repo = next();
        break;
      case '--target':
        options.target = next();
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--draft':
        options.draft = true;
        break;
      case '--prerelease':
        options.prerelease = true;
        break;
      case '--no-clobber':
        options.clobber = false;
        break;
      case '--no-generate-notes':
        options.generateNotes = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Release Bubble Town desktop artifacts to GitHub.

Usage:
  npm run release:desktop -- [options]

Prerequisite:
  Push the release tag first, for example: git push origin v1.0.3

Options:
  --version <version>       Desktop version. Defaults to apps/desktop/package.json.
  --tag <tag>               Git tag. Defaults to v<version>.
  --title <title>           Release title. Defaults to "Desktop <version>".
  --notes <text>            Inline release notes.
  --notes-file <path>       Release notes file.
  --repo <owner/repo>       GitHub repository for gh.
  --target <branch|sha>     Target commit when creating the tag via gh.
  --skip-build              Upload existing files from apps/desktop/release.
  --dry-run                 Print commands and selected assets without running them.
  --draft                   Create the release as a draft.
  --prerelease              Mark the release as a prerelease.
  --no-clobber              Do not overwrite assets when updating an existing release.
  --no-generate-notes       Do not ask GitHub to generate release notes.
`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function run(command, args, options) {
  const display = [command, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');
  if (options.dryRun) {
    console.log(`[dry-run] ${display}`);
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${display}`);
  }

  return result;
}

function ensureCommand(command, options) {
  if (options.dryRun) {
    return;
  }

  const result = spawnSync(command, ['--version'], {
    cwd: rootDir,
    stdio: 'ignore',
  });

  if (result.status !== 0) {
    throw new Error(`Required command not found or not working: ${command}`);
  }
}

function releaseExists(tag, options) {
  if (options.dryRun) {
    return false;
  }

  const args = ['release', 'view', tag];
  if (options.repo) {
    args.push('--repo', options.repo);
  }

  const result = spawnSync('gh', args, {
    cwd: rootDir,
    stdio: 'ignore',
  });

  return result.status === 0;
}

function getDesktopVersion(options) {
  return options.version ?? readJson(desktopPackagePath).version;
}

function getReleaseAssets(version) {
  if (!existsSync(releaseDir)) {
    throw new Error(`Release directory does not exist: ${path.relative(rootDir, releaseDir)}`);
  }

  const allowedExtensions = new Set(['.dmg', '.zip', '.blockmap', '.yml', '.yaml']);
  const ignoredNames = new Set(['builder-debug.yml', 'builder-effective-config.yaml']);

  return readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.includes(version))
    .filter((name) => allowedExtensions.has(path.extname(name)))
    .filter((name) => !ignoredNames.has(name))
    .map((name) => path.join(releaseDir, name))
    .sort();
}

function buildRelease(options) {
  if (options.skipBuild) {
    console.log('Skipping desktop build; using existing release artifacts.');
    return;
  }

  run('npm', ['run', 'package:desktop'], options);
}

function createRelease(tag, title, assets, options) {
  const args = ['release', 'create', tag, ...assets, '--title', title, '--verify-tag'];

  if (options.notes) {
    args.push('--notes', options.notes);
  } else if (options.notesFile) {
    args.push('--notes-file', path.resolve(rootDir, options.notesFile));
  } else if (options.generateNotes) {
    args.push('--generate-notes');
  }

  if (options.draft) {
    args.push('--draft');
  }

  if (options.prerelease) {
    args.push('--prerelease');
  }

  if (options.repo) {
    args.push('--repo', options.repo);
  }

  if (options.target) {
    args.push('--target', options.target);
  }

  run('gh', args, options);
}

function uploadAssets(tag, assets, options) {
  const args = ['release', 'upload', tag, ...assets];

  if (options.clobber) {
    args.push('--clobber');
  }

  if (options.repo) {
    args.push('--repo', options.repo);
  }

  run('gh', args, options);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const version = getDesktopVersion(options);
  const tag = options.tag ?? `v${version}`;
  const title = options.title ?? `Desktop ${version}`;

  ensureCommand('gh', options);
  buildRelease(options);

  const assets = getReleaseAssets(version);
  if (assets.length === 0) {
    if (options.dryRun) {
      console.log(`Release: ${title} (${tag})`);
      console.log(`No release assets found for version ${version} in ${path.relative(rootDir, releaseDir)}.`);
      console.log('Run without --dry-run to build assets before publishing, or build first and pass --skip-build.');
      return;
    }

    throw new Error(`No release assets found for version ${version} in ${path.relative(rootDir, releaseDir)}`);
  }

  console.log(`Release: ${title} (${tag})`);
  console.log('Assets:');
  for (const asset of assets) {
    console.log(`  - ${path.relative(rootDir, asset)}`);
  }

  if (releaseExists(tag, options)) {
    console.log(`GitHub release ${tag} already exists; uploading assets.`);
    uploadAssets(tag, assets, options);
  } else {
    console.log(`Creating GitHub release ${tag}.`);
    createRelease(tag, title, assets, options);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
