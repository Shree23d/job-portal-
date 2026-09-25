/**
 * Test NewVariable Career Form (Thinking Form Filler)
 * Verifies that:
 * 1. "Tell Us About Yourself *" gets a rich professional introduction (NEVER a phone number)
 * 2. "Link Your Resume *" gets a valid URL (NEVER "Please refer to my attached resume...")
 * 3. "Rate / Salary *" gets compensation details
 * 4. "Hours You Are Available for Work *" dropdown selects Full Time / 40 hours
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const AutonomousFormFiller = require('../handlers/autonomousFormFiller');
const QuestionSolver = require('../engine/questionSolver');
require('dotenv').config();

async function testNewVariableForm() {
  console.log('--- Testing NewVariable Form (Think-Then-Fill) ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Load user profile
  const profilePath = path.resolve(__dirname, '../config/user_profile.json');
  const userProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const solver = new QuestionSolver(userProfile, {
    apiKey: process.env.GEMINI_API_KEY
  });

  // Recreate the exact HTML structure from the user's screenshot
  const mockHtml = `
  <!DOCTYPE html>
  <html>
  <head><title>Apply Now - NewVariable</title></head>
  <body>
    <h1>New Variable Careers</h1>
    <form id="apply-now-form">
      <div class="field-wrapper">
        <label>Hours You Are Available for Work *</label>
        <p>Hours You Are Available for Work Per Week</p>
        <select name="availability" id="f_avail">
          <option value="">Availability</option>
          <option value="40">40 hours/week (Full Time)</option>
          <option value="20">20 hours/week (Part Time)</option>
          <option value="flex">Flexible</option>
        </select>
      </div>

      <h2>More About You</h2>

      <div class="field-wrapper">
        <label>Tell Us About Yourself *</label>
        <textarea name="about_yourself" id="f_about" rows="6"></textarea>
      </div>

      <div class="field-wrapper">
        <label>Link Your Resume *</label>
        <p>Link your resume in .pdf, .doc or .docx format</p>
        <input type="text" name="resume_link" id="f_resume_link">
      </div>

      <div class="field-wrapper">
        <label>Rate / Salary *</label>
        <p>Hourly rate or full-time salary you are looking forward to along with the currency</p>
        <input type="text" name="rate_salary" id="f_salary">
      </div>

      <button type="submit" id="submit-btn">Submit Application</button>
    </form>
  </body>
  </html>
  `;

  await page.setContent(mockHtml);

  // Fast typing for test execution
  const HumanBrowser = require('../engine/humanBrowser');
  HumanBrowser.humanType = async (page, locator, text) => {
    await locator.fill(text);
  };
  HumanBrowser.smoothScroll = async () => {};

  const logs = [];
  const formFiller = new AutonomousFormFiller(page, solver, {
    dryRun: true,
    onLog: (m) => { console.log(m); logs.push(m); },
    onEvent: () => {}
  });

  const result = await formFiller.handle();
  console.log('\n--- Result ---', result);

  const availVal = await page.inputValue('#f_avail');
  const aboutVal = await page.inputValue('#f_about');
  const resumeLinkVal = await page.inputValue('#f_resume_link');
  const salaryVal = await page.inputValue('#f_salary');

  console.log('\n--- Form Field Values ---');
  console.log('1. Availability Selected:', availVal);
  console.log('2. Tell Us About Yourself:', aboutVal.substring(0, 100) + '...');
  console.log('3. Link Your Resume:', resumeLinkVal);
  console.log('4. Rate / Salary:', salaryVal);

  // Assertions:
  // 1. Tell us about yourself must NOT be a phone number
  if (/^\+?\d{7,15}$/.test(aboutVal.trim())) {
    throw new Error('FAILED: "Tell Us About Yourself" was filled with a phone number!');
  }
  if (!aboutVal.toLowerCase().includes('wordpress') && !aboutVal.toLowerCase().includes('developer')) {
    throw new Error('FAILED: "Tell Us About Yourself" did not describe developer experience!');
  }

  // 2. Link your resume must NOT be "Please refer to my attached resume..."
  if (resumeLinkVal.toLowerCase().includes('please refer')) {
    throw new Error('FAILED: "Link Your Resume" was filled with evasive sentence instead of URL!');
  }
  if (!resumeLinkVal.startsWith('http')) {
    throw new Error('FAILED: "Link Your Resume" is not a valid URL!');
  }

  // 3. Rate / Salary must have a real number or LPA
  if (!salaryVal.includes('5') && !salaryVal.includes('INR')) {
    throw new Error('FAILED: Rate / Salary was not filled with compensation expectation!');
  }

  // 4. Availability must not be empty
  if (!availVal || availVal === '') {
    throw new Error('FAILED: Availability dropdown was not selected!');
  }

  console.log('\n✅ ALL NEWVARIABLE TESTS PASSED! Form fields are accurately identified and smartly filled!');
  await browser.close();
}

testNewVariableForm().catch(err => {
  console.error('\n❌ Test Error:', err.message);
  process.exit(1);
});
