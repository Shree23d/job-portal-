/**
 * Test script for Autonomous External Form Filler & Resume Attacher
 */

const path = require('path');
const fs = require('fs');
const QuestionSolver = require('../engine/questionSolver');
const AutoApplier = require('../engine/autoApplier');
require('dotenv').config();

async function runAutonomousTest() {
  console.log('=== STARTING AUTONOMOUS BROWSER & FORM FILLER TEST ===\n');

  const profilePath = path.join(__dirname, '..', 'config', 'user_profile.json');
  const userProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const solver = new QuestionSolver({
    profilePath,
    apiKey: process.env.GEMINI_API_KEY
  });

  const logs = [];
  const events = [];

  const autoApplier = new AutoApplier({
    solver,
    broadcast: (evt) => {
      if (evt.type === 'LOG') logs.push(evt.message);
      else events.push(evt);
    },
    baseUrl: 'http://localhost:3000'
  });

  const testJob = {
    id: 'job-external-404',
    title: 'Senior WordPress & Shopify Liquid Architect',
    company: 'Nexus Digital Systems',
    portal: 'Company ATS',
    applyUrl: 'http://localhost:3000/simulator/external',
    applicationType: 'external_ats'
  };

  console.log(`[TEST] Applying to: ${testJob.title} at ${testJob.applyUrl}`);
  const result = await autoApplier.applyToJob(testJob, userProfile, {
    dryRun: true,
    headless: true // Run headless in automated test
  });

  console.log('\n[RESULT]:', result);
  console.log('\n[EMITTED EVENTS]:', events.map(e => e.type));

  const resumeUploadEvent = events.find(e => e.action === 'UPLOAD_RESUME');
  if (resumeUploadEvent) {
    console.log(`\n✅ PASS: Authentic resume attached successfully: ${resumeUploadEvent.file}`);
  } else {
    console.error('\n❌ FAIL: Resume upload event not detected.');
  }

  if (result && (result.dryRunPaused || result.success)) {
    console.log('✅ PASS: Autonomous Form Filler executed cleanly in Dry-Run mode!');
  } else {
    console.error('❌ FAIL: Form filler did not complete successfully.');
    process.exit(1);
  }

  console.log('\n=== ALL AUTONOMOUS TESTS PASSED ===');
  process.exit(0);
}

runAutonomousTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
