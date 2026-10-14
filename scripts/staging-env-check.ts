import { buildGwDeploymentProfileStagingReport } from '../src/deployment/GwDeploymentProfileStaging.js';

const report = buildGwDeploymentProfileStagingReport(process.env);

console.log('[staging-env-check] normalized profile');
console.log(JSON.stringify(report.normalized, null, 2));

if (report.warnings.length) {
  console.log('[staging-env-check] warnings');
  for (const warning of report.warnings) {
    console.log(`- ${warning}`);
  }
}

if (report.errors.length) {
  console.error('[staging-env-check] errors');
  for (const error of report.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('[staging-env-check] profile is valid for staging/prod deployment.');
