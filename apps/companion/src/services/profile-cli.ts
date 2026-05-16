import { execFileSync } from 'node:child_process';
import { getHermesRoot } from './hermes-paths.js';

let profileCommandRunner = (args: string[]) => {
  execFileSync('hermes', ['profile', ...args], {
    env: {
      ...process.env,
      HERMES_HOME: getHermesRoot(),
    },
    stdio: 'pipe',
  });
};

export function runHermesProfileCommand(args: string[]): void {
  profileCommandRunner(args);
}

export function setHermesProfileCommandRunnerForTests(runner: typeof profileCommandRunner): void {
  profileCommandRunner = runner;
}

export function resetHermesProfileCommandRunnerForTests(): void {
  profileCommandRunner = (args: string[]) => {
    execFileSync('hermes', ['profile', ...args], {
      env: {
        ...process.env,
        HERMES_HOME: getHermesRoot(),
      },
      stdio: 'pipe',
    });
  };
}
