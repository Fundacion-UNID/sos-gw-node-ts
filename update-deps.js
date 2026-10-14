// update-deps.js

// eslint-disable-next-line no-undef, @typescript-eslint/no-var-requires
const { execSync } = require('child_process');

function runCommand(command) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    // eslint-disable-next-line no-undef
    process.exit(1);
  }
}

// Run the commands using yarn
runCommand('yarn global add npm-check-updates');
runCommand('ncu -u');
runCommand('yarn install');

// Only for reference: commands using npm
// runCommand('npm install -g npm-check-updates');
// runCommand('ncu -u');
// runCommand('npm install');
