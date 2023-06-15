import main, { readConfig, getConverterBasePath } from '../main.js';
import { execSync } from 'node:child_process';
import * as utils from '../utils.js';
import * as path from 'node:path';

function hasDoneInitialCommit(compareOutPath: string): boolean {
  try {
    // this will fail if not in a git directory or no initial commit has been done
    execSync(`git rev-parse HEAD`, { stdio: 'pipe', cwd: compareOutPath });

    return true;
  } catch (err) {
    if (
      !/(?:fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree)|(?:fatal: not a git repository)/.test(
        err.message
      )
    ) {
      console.error('unexpected err', err);
    }

    return false;
  }
}

async function compareGen() {
  console.log('Running compare generation script\n'.green);

  // ensure git is installed before running anything else
  execSync(`git --version`, { stdio: 'inherit' });

  // read the config to get correct output paths
  await readConfig();

  const basePath = getConverterBasePath();

  const compareOutPath = path.join(basePath, 'compare');
  await utils.mkdir(compareOutPath);

  if (hasDoneInitialCommit(compareOutPath)) {
    // to make sure there are no changes before running everything else
    execSync(`git add -A`, { stdio: 'inherit', cwd: compareOutPath });
    execSync(`git stash push`, { stdio: 'inherit', cwd: compareOutPath });
  } else {
    // initialize the git repository in the compare path - is safe to run on a existing repository
    execSync(`git init`, { stdio: 'inherit', cwd: compareOutPath });
  }

  console.log('\nRunning Converter\n'.green);

  // set to output in debug format (no compression and prettified)
  process.env['DEBUG_OUTPUT'] = 'true';

  // actually run the converter
  await main({
    converterOutputPath: compareOutPath,
  });

  console.log('\nCommiting changes\n'.green);

  // get the current commit on this repository for the commit message
  const currentCommit = execSync(`git rev-parse HEAD`, { stdio: 'pipe' }).toString().trim();

  const commitMsg = `Generated on ${currentCommit}`;

  // commit the output
  execSync(`git add -A`, { stdio: 'inherit', cwd: compareOutPath });

  // ignore error if commit would be empty
  try {
    execSync(`git commit -m "${commitMsg}"`, { stdio: 'pipe', cwd: compareOutPath });
  } catch (err) {
    if (!/nothing to commit, working tree clean/.test(err.stdout.toString())) {
      console.error('unexpected err', err);
    }
  }

  console.log('\nDone'.green);
}

compareGen();
