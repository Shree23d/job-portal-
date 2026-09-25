/**
 * Test AutonomousFormFiller and Max Applications Quota Limit
 * Simulates BlueBit Systems form (Name*, Email*, Position*, Phone*, Upload CV, Message)
 * and Accelaronix gateway button.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const AutonomousFormFiller = require('../handlers/autonomousFormFiller');
const QuestionSolver = require('../engine/questionSolver');
const SearchResultBatcher = require('../handlers/searchResultBatcher');

async function testExternalFormFilling() {
  console.log('--- Testing Autonomous Form Filler on Simulated BlueBit Career Page ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Load candidate profile
  const profilePath = path.resolve(__dirname, '../config/user_profile.json');
  const userProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const solver = new QuestionSolver(userProfile, {
    apiKey: process.env.GEMINI_API_KEY || 'test_key'
  });

  // Create mock HTML page reproducing bluebitsystems.com/career/
  const mockHtml = `
  <!DOCTYPE html>
  <html>
  <head><title>Career - BlueBit Systems</title></head>
  <body>
    <h1>CAREER</h1>
    <div class="apply-container">
      <h2>Apply Now</h2>
      <p>* Indicates a required field</p>
      <form id="career-form">
        <table>
          <tr>
            <td>Name* :</td>
            <td><input type="text" name="your-name" id="c_name"></td>
          </tr>
          <tr>
            <td>Email* :</td>
            <td><input type="email" name="your-email" id="c_email"></td>
          </tr>
          <tr>
            <td>Position* :</td>
            <td>
              <select name="your-position" id="c_position">
                <option value="">Please Select</option>
                <option value="seo">SEO Expert having 6 months to 2 yrs of experience.</option>
                <option value="wp">Wordpress Developer</option>
                <option value="writer">Freelance Content Writer</option>
              </select>
            </td>
          </tr>
          <tr>
            <td>Phone* :</td>
            <td><input type="tel" name="your-tel" id="c_phone"></td>
          </tr>
          <tr>
            <td>Upload CV:</td>
            <td><input type="file" name="your-cv" id="c_file"></td>
          </tr>
          <tr>
            <td>Message :</td>
            <td><textarea name="your-message" id="c_msg"></textarea></td>
          </tr>
          <tr>
            <td></td>
            <td><button type="submit" id="btn-submit">Submit Application</button></td>
          </tr>
        </table>
      </form>
    </div>
  </body>
  </html>
  `;

  await page.setContent(mockHtml);

  const HumanBrowser = require('../engine/humanBrowser');
  HumanBrowser.humanType = async (page, locator, text) => {
    await locator.fill(text);
  };
  HumanBrowser.smoothScroll = async () => {};

  const logs = [];
  const events = [];

  const formFiller = new AutonomousFormFiller(page, solver, {
    dryRun: true,
    onLog: (m) => logs.push(m),
    onEvent: (e) => events.push(e)
  });

  const result = await formFiller.handle();
  console.log('Result:', result);

  // Inspect filled values
  const nameVal = await page.inputValue('#c_name');
  const emailVal = await page.inputValue('#c_email');
  const positionVal = await page.inputValue('#c_position');
  const phoneVal = await page.inputValue('#c_phone');
  const msgVal = await page.inputValue('#c_msg');
  const hasFile = await page.$eval('#c_file', el => el.files.length > 0);

  console.log('Verified Fields:');
  console.log('- Name:', nameVal);
  console.log('- Email:', emailVal);
  console.log('- Position Selected (wp expected):', positionVal);
  console.log('- Phone:', phoneVal);
  console.log('- Message length:', msgVal.length);
  console.log('- Resume File attached:', hasFile);

  if (nameVal.includes('Shreyas') && emailVal.includes('@') && positionVal === 'wp' && hasFile && result.dryRunPaused) {
    console.log('✅ Form filler successfully handled BlueBit Systems form in Dry-Run mode!');
  } else {
    console.error('❌ Verification failed!');
    process.exit(1);
  }

  await browser.close();
}

async function testMaxApplicationsLimit() {
  console.log('\n--- Testing SearchResultBatcher Hard Limit Enforcer ---');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Mock search page with 5 jobs
  const searchHtml = `
  <!DOCTYPE html>
  <html>
  <body>
    <article class="jobTuple">
      <a class="title" href="https://example.com/job/1">WordPress Developer 1</a>
      <a class="subTitle">Company Alpha</a>
    </article>
    <article class="jobTuple">
      <a class="title" href="https://example.com/job/2">WordPress Developer 2</a>
      <a class="subTitle">Company Beta</a>
    </article>
    <article class="jobTuple">
      <a class="title" href="https://example.com/job/3">WordPress Developer 3</a>
      <a class="subTitle">Company Gamma</a>
    </article>
    <article class="jobTuple">
      <a class="title" href="https://example.com/job/4">WordPress Developer 4</a>
      <a class="subTitle">Company Delta</a>
    </article>
  </body>
  </html>
  `;
  await page.setContent(searchHtml);

  let appliedJobsCount = 0;
  const mockApplier = {
    isAborted: false,
    options: { dryRun: true },
    solver: {},
    userProfile: { settings: { maxApplicationsPerRun: 2 } }
  };

  const batchLogs = [];
  const batchEvents = [];

  const batcher = new SearchResultBatcher(page, mockApplier, {
    maxApplications: 2,
    dryRun: true,
    onLog: (msg) => { console.log(msg); batchLogs.push(msg); },
    onEvent: (evt) => batchEvents.push(evt)
  });

  // Override applyNaukriJob on individual job to count and return success
  batcher.applyNaukriJob = async (job) => {
    appliedJobsCount++;
    return { success: true };
  };

  // Stub page.goto and waitForTimeout to speed up test
  page.goto = async () => {};
  const origTimeout = page.waitForTimeout;
  page.waitForTimeout = async () => {};

  const batchResult = await batcher.handleSearchPage('naukri', mockApplier.userProfile);
  console.log('Batch Result:', batchResult);

  const limitEvent = batchEvents.find(e => e.type === 'LIMIT_REACHED');
  console.log('Found LIMIT_REACHED event:', !!limitEvent);
  console.log('Total jobs applied before stopping:', batchResult.appliedCount);

  if (batchResult.appliedCount === 2 && limitEvent) {
    console.log('✅ Max Applications Quota Limit enforced strictly at 2 jobs!');
  } else {
    console.error('❌ Limit enforcement failed! Applied:', batchResult.appliedCount);
    process.exit(1);
  }

  await browser.close();
}

async function run() {
  await testExternalFormFilling();
  await testMaxApplicationsLimit();
  console.log('\n🎉 ALL TESTS PASSED!');
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
