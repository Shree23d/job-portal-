/**
 * Indeed Screening Form Application Handler
 * Handles Indeed Apply modal and multi-page screening questionnaires:
 * - Skill experience questions (e.g. "How many years of work experience do you have with React?")
 * - Radio groups (Yes/No work authorization, relocation, commute)
 * - Select dropdowns & checkboxes
 * - Resume file selection
 * - Dry-run pause before final "Submit your application" button
 */

class IndeedScreeningHandler {
  constructor(page, questionSolver, options = {}) {
    this.page = page;
    this.solver = questionSolver;
    this.dryRun = options.dryRun ?? true;
    this.maxSteps = options.maxSteps || 10;
    this.onLog = options.onLog || ((msg) => console.log(`[IndeedScreening] ${msg}`));
    this.onEvent = options.onEvent || (() => {});
  }

  async handle() {
    this.onLog('Detecting Indeed screening interface...');

    // Detect Indeed application container
    const containerSelector = '#ia-container, .ia-BasePage, .ia-Questions, [data-testid="ia-container"], .indeed-apply-widget';
    const container = await this.page.waitForSelector(containerSelector, { timeout: 10000 }).catch(() => null);

    if (!container) {
      this.onLog('Indeed screening container not found.');
      return { success: false, reason: 'Indeed application container not detected' };
    }

    this.onLog('Indeed screening form active. Beginning questionnaire resolution...');
    this.onEvent({ type: 'STATUS', message: 'Indeed screening questions detected. Answering questions...' });

    let stepCount = 0;

    while (stepCount < this.maxSteps) {
      stepCount++;
      await this.page.waitForTimeout(1000);

      // 1. Solve all visible questions on this page/step
      await this.solveScreeningItems();

      // 2. Check for Submit Application button
      const submitBtnSelector = 'button:has-text("Submit your application"), button:has-text("Apply now"), button[type="submit"]:has-text("Submit"), .ia-SubmitButton';
      const submitBtn = await this.page.locator(submitBtnSelector).first();
      const isSubmitVisible = await submitBtn.isVisible().catch(() => false);

      if (isSubmitVisible) {
        if (this.dryRun) {
          this.onLog('[DRY RUN] Final Indeed Submit button reached. Pausing for user verification.');
          this.onEvent({
            type: 'DRY_RUN_PAUSE',
            message: 'All questions filled. Paused before final submission on Indeed.'
          });
          return { success: true, dryRunPaused: true, step: 'indeed_submit' };
        } else {
          this.onLog('Submitting Indeed application...');
          await submitBtn.click();
          await this.page.waitForTimeout(2000);
          this.onEvent({ type: 'SUCCESS', message: 'Indeed application submitted successfully!' });
          return { success: true, submitted: true };
        }
      }

      // 3. Check for "Continue" button
      const continueBtnSelector = 'button:has-text("Continue"), button.ia-ContinueButton, button[aria-label="Continue"]';
      const continueBtn = await this.page.locator(continueBtnSelector).first();
      const isContinueVisible = await continueBtn.isVisible().catch(() => false);

      if (isContinueVisible) {
        this.onLog('Clicking Continue to move to next screening page...');
        await continueBtn.click();
        await this.page.waitForTimeout(1500);
        continue;
      }

      // 4. Check for success page
      const successSelector = '.ia-ApplicationSubmitted, text="Your application has been submitted", text="Application submitted"';
      if (await this.page.locator(successSelector).first().isVisible().catch(() => false)) {
        this.onLog('Indeed application submitted confirmed.');
        this.onEvent({ type: 'SUCCESS', message: 'Indeed Application Confirmed.' });
        return { success: true };
      }

      await this.page.waitForTimeout(1000);
    }

    return { success: false, reason: 'Exceeded maximum Indeed navigation steps' };
  }

  async solveScreeningItems() {
    // 1. Check for file upload (Resume)
    const fileInputs = await this.page.locator('input[type="file"]').all();
    for (const f of fileInputs) {
      if (await f.isVisible().catch(() => true)) {
        const resumePath = this.solver.userProfile?.documents?.defaultResumePath || './resumes/default_resume.pdf';
        try {
          this.onLog(`Attaching resume for Indeed: ${resumePath}`);
          await f.setInputFiles(resumePath);
          this.onEvent({ type: 'ACTION', action: 'UPLOAD_RESUME', file: resumePath });
        } catch (err) {
          this.onLog(`File attachment note: ${err.message}`);
        }
      }
    }

    // 2. Question blocks
    const questionBlocks = await this.page.locator('.ia-Questions-item, .ia-BasePage-item, fieldset, .question-card').all();

    for (const block of questionBlocks) {
      const isBlockVis = await block.isVisible().catch(() => false);
      if (!isBlockVis) continue;

      // Find question text
      const questionText = await block.evaluate((el) => {
        const header = el.querySelector('label, legend, .ia-Questions-itemLabel, h3, .heading');
        return header ? header.innerText.trim() : '';
      }).catch(() => '');

      if (!questionText) continue;

      // Check for radio inputs
      const radios = await block.locator('input[type="radio"]').all();
      if (radios.length > 0) {
        const radioOptions = [];
        for (const r of radios) {
          const id = await r.getAttribute('id').catch(() => null);
          let label = '';
          if (id) label = await this.page.locator(`label[for="${id}"]`).innerText().catch(() => '');
          if (!label) {
            label = await r.evaluate(el => el.parentElement ? el.parentElement.innerText.trim() : '').catch(() => '');
          }
          if (label) radioOptions.push({ locator: r, label: label.trim() });
        }

        const labels = radioOptions.map(r => r.label);
        this.onLog(`Indeed Question: "${questionText}" with [${labels.join(', ')}]`);

        const solution = await this.solver.solveQuestion(questionText, labels, 'radio');
        const picked = solution.selectedOption || solution.answer;

        for (const r of radioOptions) {
          if (r.label.toLowerCase() === picked.toLowerCase() || r.label.toLowerCase().includes(picked.toLowerCase())) {
            await r.locator.check({ force: true });
            break;
          }
        }

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: questionText,
          options: labels,
          answer: picked,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });
        continue;
      }

      // Check for select dropdown
      const select = await block.locator('select').first();
      if (await select.isVisible().catch(() => false)) {
        const options = await select.evaluate(el => Array.from(el.options).map(o => o.text.trim()).filter(Boolean)).catch(() => []);
        this.onLog(`Indeed Select Question: "${questionText}"`);

        const solution = await this.solver.solveQuestion(questionText, options, 'select');
        await this.solver.fillPlaywrightElement(this.page, select, { text: questionText }, solution);

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: questionText,
          options,
          answer: solution.selectedOption || solution.answer,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });
        continue;
      }

      // Check for text/number/textarea input
      const textInput = await block.locator('input[type="text"], input[type="number"], input[type="tel"], textarea').first();
      if (await textInput.isVisible().catch(() => false)) {
        const inputType = await textInput.getAttribute('type').catch(() => 'text') || 'text';
        this.onLog(`Indeed Input Question: "${questionText}" (${inputType})`);

        const solution = await this.solver.solveQuestion(questionText, [], inputType);
        await this.solver.fillPlaywrightElement(this.page, textInput, { text: questionText }, solution);

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: questionText,
          answer: solution.answer,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });

        if (solution.requires_manual_review) {
          this.onEvent({ type: 'HITL_CHIME', question: questionText, confidence: solution.confidence });
        }
      }
    }
  }
}

module.exports = IndeedScreeningHandler;
