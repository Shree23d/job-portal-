/**
 * LinkedIn Easy Apply Multi-Step Modal Handler
 * Manages modal flow: Contact Info -> Resume Upload -> Additional Screening Questions -> Review -> Submit
 * Automatically attaches PDF resume, solves dynamic form inputs, handles Next/Review/Submit buttons,
 * and enforces Dry-Run review pauses.
 */

class LinkedInEasyApplyHandler {
  constructor(page, questionSolver, options = {}) {
    this.page = page;
    this.solver = questionSolver;
    this.dryRun = options.dryRun ?? true;
    this.maxSteps = options.maxSteps || 15;
    this.onLog = options.onLog || ((msg) => console.log(`[LinkedInEasyApply] ${msg}`));
    this.onEvent = options.onEvent || (() => {});
  }

  async handle() {
    this.onLog('Detecting LinkedIn Easy Apply modal...');

    // Locate modal container
    const modalSelector = '.jobs-easy-apply-modal, .artdeco-modal[role="dialog"], [data-test-modal], .easy-apply-modal';
    const modal = await this.page.waitForSelector(modalSelector, { timeout: 10000 }).catch(() => null);

    if (!modal) {
      this.onLog('LinkedIn Easy Apply modal not found.');
      return { success: false, reason: 'Modal not detected' };
    }

    this.onLog('Easy Apply modal detected. Beginning multi-step traversal...');
    this.onEvent({ type: 'STATUS', message: 'LinkedIn Easy Apply modal open. Solving form steps...' });

    let stepCount = 0;

    while (stepCount < this.maxSteps) {
      stepCount++;
      await this.page.waitForTimeout(1000);

      // 1. Solve all visible form controls on the current modal step
      await this.solveCurrentModalStep();

      // 2. Check for Submit Application button
      const submitBtnSelector = 'button[aria-label="Submit application"], button:has-text("Submit application"), button.artdeco-button--primary:has-text("Submit")';
      const submitBtn = await this.page.locator(submitBtnSelector).first();
      const isSubmitVisible = await submitBtn.isVisible().catch(() => false);

      if (isSubmitVisible) {
        if (this.dryRun) {
          this.onLog('[DRY RUN] Final Submit Application button reached. Pausing for human review.');
          this.onEvent({
            type: 'DRY_RUN_PAUSE',
            message: 'Application filled and validated. Paused on LinkedIn Review step.'
          });
          return { success: true, dryRunPaused: true, step: 'review_submit' };
        } else {
          this.onLog('Clicking Submit application button...');
          await submitBtn.click();
          await this.page.waitForTimeout(2000);
          this.onEvent({ type: 'SUCCESS', message: 'LinkedIn Easy Apply application submitted!' });
          return { success: true, submitted: true };
        }
      }

      // 3. Check for "Review" button
      const reviewBtnSelector = 'button[aria-label="Review your application"], button:has-text("Review")';
      const reviewBtn = await this.page.locator(reviewBtnSelector).first();
      const isReviewVisible = await reviewBtn.isVisible().catch(() => false);

      if (isReviewVisible) {
        this.onLog('Clicking Review button to advance to final step...');
        await reviewBtn.click();
        await this.page.waitForTimeout(1200);
        continue;
      }

      // 4. Check for "Next" button
      const nextBtnSelector = 'button[aria-label="Continue to next step"], button:has-text("Next")';
      const nextBtn = await this.page.locator(nextBtnSelector).first();
      const isNextVisible = await nextBtn.isVisible().catch(() => false);

      if (isNextVisible) {
        this.onLog(`Advancing from step ${stepCount} with Next button...`);
        await nextBtn.click();
        await this.page.waitForTimeout(1200);
        continue;
      }

      // 5. Check if success / application sent confirmation is shown
      const doneBtn = await this.page.locator('button:has-text("Done"), [data-control-name="dismiss_modal"]').first();
      if (await doneBtn.isVisible().catch(() => false)) {
        this.onLog('Application completed successfully.');
        this.onEvent({ type: 'SUCCESS', message: 'LinkedIn Easy Apply finished.' });
        return { success: true };
      }

      // If neither Next, Review, nor Submit is visible, sleep briefly
      await this.page.waitForTimeout(1000);
    }

    return { success: false, reason: 'Exceeded maximum modal navigation steps' };
  }

  /**
   * Identifies all input fields, radio groups, dropdowns, and file uploaders
   * in the active step and populates them using questionSolver.
   */
  async solveCurrentModalStep() {
    // A. Handle file upload (Resume attachment)
    const fileInputs = await this.page.locator('input[type="file"]').all();
    for (const fileInput of fileInputs) {
      if (await fileInput.isVisible().catch(() => true)) {
        const resumePath = this.solver.userProfile?.documents?.defaultResumePath || './resumes/default_resume.pdf';
        try {
          this.onLog(`Uploading resume to LinkedIn modal: ${resumePath}`);
          await fileInput.setInputFiles(resumePath);
          this.onEvent({ type: 'ACTION', action: 'UPLOAD_RESUME', file: resumePath });
        } catch (fileErr) {
          this.onLog(`Resume upload note: ${fileErr.message}`);
        }
      }
    }

    // B. Handle text & numeric inputs
    const textInputs = await this.page.locator('.jobs-easy-apply-modal input[type="text"], .jobs-easy-apply-modal input[type="number"], .jobs-easy-apply-modal input[type="tel"], .jobs-easy-apply-modal input:not([type]), .easy-apply-modal input[type="text"], .easy-apply-modal input[type="number"], .easy-apply-modal input[type="tel"]').all();

    for (const input of textInputs) {
      const isVis = await input.isVisible().catch(() => false);
      if (!isVis) continue;

      const currentVal = await input.inputValue().catch(() => '');
      if (currentVal && currentVal.trim().length > 0) {
        // Skip already pre-filled contact fields unless empty
        continue;
      }

      // Find associated label text
      const id = await input.getAttribute('id').catch(() => null);
      let labelText = '';
      if (id) {
        labelText = await this.page.locator(`label[for="${id}"]`).innerText().catch(() => '');
      }
      if (!labelText) {
        // Search parent container label
        labelText = await input.evaluate((el) => {
          const formGroup = el.closest('.fb-dash-form-element, .form-group, .jobs-easy-apply-form-section, div');
          const lbl = formGroup ? formGroup.querySelector('label, .fb-dash-form-element__label') : null;
          return lbl ? lbl.innerText : '';
        }).catch(() => '');
      }

      const inputType = await input.getAttribute('type').catch(() => 'text') || 'text';
      if (labelText) {
        this.onLog(`LinkedIn Question: "${labelText.trim()}"`);
        const solution = await this.solver.solveQuestion(labelText, [], inputType);

        await this.solver.fillPlaywrightElement(this.page, input, { text: labelText }, solution);

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: labelText.trim(),
          answer: solution.answer,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });

        if (solution.requires_manual_review) {
          this.onEvent({ type: 'HITL_CHIME', question: labelText, confidence: solution.confidence });
        }
      }
    }

    // C. Handle Select Dropdowns
    const selects = await this.page.locator('.jobs-easy-apply-modal select, .easy-apply-modal select').all();
    for (const select of selects) {
      const isVis = await select.isVisible().catch(() => false);
      if (!isVis) continue;

      const id = await select.getAttribute('id').catch(() => null);
      let labelText = '';
      if (id) {
        labelText = await this.page.locator(`label[for="${id}"]`).innerText().catch(() => '');
      }
      if (!labelText) {
        labelText = await select.evaluate((el) => {
          const group = el.closest('fieldset, div, .fb-dash-form-element');
          const lbl = group ? group.querySelector('label, legend') : null;
          return lbl ? lbl.innerText : '';
        }).catch(() => '');
      }

      // Extract option labels
      const options = await select.evaluate((el) => {
        return Array.from(el.options).map(o => o.text.trim()).filter(t => t && !t.includes('Select an option'));
      }).catch(() => []);

      this.onLog(`LinkedIn Select Question: "${labelText.trim()}" with [${options.join(', ')}]`);
      const solution = await this.solver.solveQuestion(labelText, options, 'select');
      await this.solver.fillPlaywrightElement(this.page, select, { text: labelText }, solution);

      this.onEvent({
        type: 'QUESTION_SOLVED',
        question: labelText.trim(),
        options,
        answer: solution.selectedOption || solution.answer,
        confidence: solution.confidence,
        requires_manual_review: solution.requires_manual_review
      });
    }

    // D. Handle Radio Fieldsets (Yes/No questions or choices)
    const fieldsets = await this.page.locator('.jobs-easy-apply-modal fieldset, .easy-apply-modal fieldset').all();
    for (const fieldset of fieldsets) {
      const isVis = await fieldset.isVisible().catch(() => false);
      if (!isVis) continue;
      const legend = await fieldset.locator('legend').innerText().catch(() => '');
      const radios = await fieldset.locator('input[type="radio"]').all();

      if (radios.length > 0 && legend) {
        // Collect radio option labels
        const radioOptions = [];
        for (const r of radios) {
          const rId = await r.getAttribute('id').catch(() => null);
          let rLabel = '';
          if (rId) {
            rLabel = await this.page.locator(`label[for="${rId}"]`).innerText().catch(() => '');
          }
          if (rLabel) radioOptions.push({ locator: r, label: rLabel.trim() });
        }

        const optionLabels = radioOptions.map(o => o.label);
        this.onLog(`LinkedIn Radio Question: "${legend.trim()}" with [${optionLabels.join(', ')}]`);

        const solution = await this.solver.solveQuestion(legend, optionLabels, 'radio');
        const chosen = solution.selectedOption || solution.answer;

        for (const item of radioOptions) {
          if (item.label.toLowerCase() === chosen.toLowerCase() || item.label.toLowerCase().includes(chosen.toLowerCase())) {
            await item.locator.check({ force: true });
            break;
          }
        }

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: legend.trim(),
          options: optionLabels,
          answer: chosen,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });
      }
    }
  }
}

module.exports = LinkedInEasyApplyHandler;
