const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const AutonomousFormFiller = require('../handlers/autonomousFormFiller');
const QuestionSolver = require('../engine/questionSolver');

async function runLiveNewVariable() {
  console.log('🚀 Starting Live NewVariable Apply Test...');
  const profilePath = path.resolve(__dirname, '../config/user_profile.json');
  const userProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const solver = new QuestionSolver(userProfile, {
    apiKey: process.env.GEMINI_API_KEY
  });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 40
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 950 }
  });

  const page = await context.newPage();

  try {
    console.log('🌐 Navigating to https://newvariable.com/careers/apply-now/...');
    await page.goto('https://newvariable.com/careers/apply-now/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('⏳ Page loaded. Waiting 2 seconds...');
    await page.waitForTimeout(2000);

    const filler = new AutonomousFormFiller(page, solver, {
      dryRun: true,
      onLog: (msg) => console.log(`[FormFiller] ${msg}`)
    });

    console.log('🧠 Running AutonomousFormFiller handle()...');
    const result = await filler.handle();
    console.log('✅ Result of handle():', result);

    if (!page.isClosed()) {
      // Read back field values to report explicitly
      const fieldValues = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('#gform_3 input, #gform_3 textarea, #gform_3 select'));
        return inputs.map(el => {
          let label = '';
          if (el.id) {
            const l = document.querySelector(`label[for="${el.id}"]`);
            if (l) label = l.innerText;
          }
          if (!label && el.closest('.gfield')) {
            const l = el.closest('.gfield').querySelector('.gfield_label');
            if (l) label = l.innerText;
          }
          return {
            tag: el.tagName,
            name: el.name,
            id: el.id,
            type: el.type,
            label: (label || '').trim(),
            value: el.value ? el.value.substring(0, 120) : (el.checked ? '[CHECKED]' : '')
          };
        }).filter(item => item.value && item.type !== 'hidden');
      });

      console.log('\n--- 📋 Captured Filled Values ---');
      console.log(JSON.stringify(fieldValues, null, 2));

      // Save a verification screenshot of the filled page
      const screenshotPath = path.resolve(__dirname, 'newvariable_live_filled.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot saved to: ${screenshotPath}`);

      await page.waitForTimeout(3000);
    }
  } catch (err) {
    console.error('❌ Error during live run:', err);
  } finally {
    if (!page.isClosed()) {
      await browser.close();
    }
    console.log('🏁 Browser closed.');
  }
}

runLiveNewVariable();
