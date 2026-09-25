/**
 * Automated Verification & Test Suite
 * Tests QuestionSolver, user profile integration, and platform handlers.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { chromium } = require('playwright');

const QuestionSolver = require('../engine/questionSolver');
const NaukriChatbotHandler = require('../handlers/naukriChatbot');
const LinkedInEasyApplyHandler = require('../handlers/linkedinEasyApply');
const IndeedScreeningHandler = require('../handlers/indeedScreening');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Auto-Apply & Questionnaire Solver Test Suite');
  console.log('====================================================\n');

  // Test 1: User Profile Validation
  console.log('▶ [Test 1] Validating config/user_profile.json schema...');
  const profilePath = path.join(__dirname, '..', 'config', 'user_profile.json');
  assert(fs.existsSync(profilePath), 'user_profile.json must exist');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  assert(profile.personal && profile.personal.fullName, 'Profile must have personal.fullName');
  assert(profile.career && profile.career.totalExperienceYears, 'Profile must have career.totalExperienceYears');
  assert(profile.skills && (profile.skills.WordPress !== undefined || profile.skills.React !== undefined), 'Profile must have primary skills');
  assert(profile.standardAnswers && profile.standardAnswers.workAuthorization, 'Profile must have standardAnswers');
  console.log('✔ Master Candidate Profile is valid.\n');

  // Test 2: QuestionSolver Resolution Accuracy
  console.log('▶ [Test 2] Testing QuestionSolver question resolution...');
  const solver = new QuestionSolver({ profilePath });

  // 2a. WordPress experience
  const wpSol = await solver.solveQuestion('How many years of experience do you have with WordPress?', [], 'number');
  console.log('   Question: "WordPress Experience" -> Answer:', wpSol.answer, '| Conf:', wpSol.confidence + '%');
  assert.strictEqual(String(wpSol.answer), '3.5', 'WordPress experience should match profile (3.5 years)');
  assert(wpSol.confidence >= 85, 'Confidence should be >= 85%');

  // 2b. Notice period
  const noticeSol = await solver.solveQuestion('What is your notice period in days?', ['Immediate', '15 days', '30 days', '60 days'], 'select');
  console.log('   Question: "Notice Period" -> Answer:', noticeSol.selectedOption || noticeSol.answer, '| Conf:', noticeSol.confidence + '%');
  assert(noticeSol.selectedOption || noticeSol.answer, 'Notice period should return valid answer');

  // 2c. Work Authorization
  const authSol = await solver.solveQuestion('Are you legally authorized to work in India?', ['Yes', 'No'], 'radio');
  console.log('   Question: "Work Auth" -> Answer:', authSol.selectedOption || authSol.answer, '| Conf:', authSol.confidence + '%');
  assert.strictEqual(authSol.selectedOption || authSol.answer, 'Yes', 'Work authorization should be Yes');

  // 2d. Current CTC numeric
  const ctcSol = await solver.solveQuestion('Current CTC in LPA?', [], 'number');
  console.log('   Question: "Current CTC" -> Answer:', ctcSol.answer, '| Conf:', ctcSol.confidence + '%');
  assert.strictEqual(String(ctcSol.answer), '4.2', 'Numeric CTC should be clean 4.2');

  // 2e. Low Confidence / Custom essay question triggering HITL
  const unknownSol = await solver.solveQuestion('Describe your favorite childhood cartoon and why?', [], 'text');
  console.log('   Question: "Unknown Essay" -> Requires Review:', unknownSol.requires_manual_review, '| Conf:', unknownSol.confidence + '%');
  assert(unknownSol.requires_manual_review === true || unknownSol.confidence < 85, 'Unfamiliar question must trigger manual review');
  console.log('✔ QuestionSolver resolution passed all unit checks.\n');

  // Test 3: Playwright Mock Portal Integration Tests
  console.log('▶ [Test 3] Launching temporary test server and Playwright browser...');
  const testApp = express();
  testApp.use(express.static(path.join(__dirname, '..', 'public')));
  testApp.use('/simulator/naukri', (req, res) => res.sendFile(path.join(__dirname, '..', 'simulators', 'naukri.html')));
  testApp.use('/simulator/linkedin', (req, res) => res.sendFile(path.join(__dirname, '..', 'simulators', 'linkedin.html')));
  testApp.use('/simulator/indeed', (req, res) => res.sendFile(path.join(__dirname, '..', 'simulators', 'indeed.html')));

  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(3099, resolve));
  console.log('   Temporary test server running on port 3099.');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    // 3a. Test Naukri Chatbot Handler
    console.log('   Testing Naukri Chatbot Handler...');
    const pageNaukri = await context.newPage();
    await pageNaukri.goto('http://localhost:3099/simulator/naukri');

    const naukriHandler = new NaukriChatbotHandler(pageNaukri, solver, { dryRun: true });
    const naukriRes = await naukriHandler.handle();
    console.log('   Naukri Chatbot Result:', naukriRes);
    assert(naukriRes.success === true, 'Naukri chatbot should execute successfully');
    assert(naukriRes.dryRunPaused === true, 'Dry Run should pause before final submission');
    await pageNaukri.close();
    console.log('✔ Naukri Chatbot Handler verified successfully.\n');

    // 3b. Test LinkedIn Easy Apply Handler
    console.log('   Testing LinkedIn Easy Apply Handler...');
    const pageLinkedIn = await context.newPage();
    await pageLinkedIn.goto('http://localhost:3099/simulator/linkedin');

    const linkedInHandler = new LinkedInEasyApplyHandler(pageLinkedIn, solver, { dryRun: true });
    const linkedInRes = await linkedInHandler.handle();
    console.log('   LinkedIn Easy Apply Result:', linkedInRes);
    assert(linkedInRes.success === true, 'LinkedIn Easy Apply should execute successfully');
    assert(linkedInRes.dryRunPaused === true, 'Dry Run should pause before final submission');
    await pageLinkedIn.close();
    console.log('✔ LinkedIn Easy Apply Handler verified successfully.\n');

    // 3c. Test Indeed Screening Handler
    console.log('   Testing Indeed Screening Handler...');
    const pageIndeed = await context.newPage();
    await pageIndeed.goto('http://localhost:3099/simulator/indeed');

    const indeedHandler = new IndeedScreeningHandler(pageIndeed, solver, { dryRun: true });
    const indeedRes = await indeedHandler.handle();
    console.log('   Indeed Screening Result:', indeedRes);
    assert(indeedRes.success === true, 'Indeed Screening should execute successfully');
    assert(indeedRes.dryRunPaused === true, 'Dry Run should pause before final submission');
    await pageIndeed.close();
    console.log('✔ Indeed Screening Handler verified successfully.\n');

  } finally {
    await browser.close();
    server.close();
  }

  console.log('====================================================');
  console.log('🎉 ALL TESTS PASSED! Full Auto-Apply suite verified.');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
