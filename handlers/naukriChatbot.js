/**
 * Naukri Chatbot Overlay Application Handler
 * Handles Naukri's interactive conversational chatbot popup (.chatbot-container),
 * question bubbles, quick-reply chip buttons, text inputs, and file upload.
 */

class NaukriChatbotHandler {
  constructor(page, questionSolver, options = {}) {
    this.page = page;
    this.solver = questionSolver;
    this.dryRun = options.dryRun ?? true;
    this.maxSteps = options.maxSteps || 25;
    this.onLog = options.onLog || ((msg) => console.log(`[NaukriChatbot] ${msg}`));
    this.onEvent = options.onEvent || (() => {});
  }

  /**
   * Main entrypoint to detect and solve Naukri chatbot popup
   */
  async handle() {
    this.onLog('Detecting Naukri chatbot container...');

    // Wait for chatbot container or overlay
    const containerSelector = '.chatbot-container, .chatbot-drawer, #chatbot-container, [data-testid="chatbot-wrapper"]';
    const container = await this.page.waitForSelector(containerSelector, { timeout: 10000 }).catch(() => null);

    if (!container) {
      this.onLog('Naukri chatbot container not found on current page.');
      return { success: false, reason: 'Chatbot container not detected' };
    }

    this.onLog('Naukri chatbot opened. Starting sequential prompt loop...');
    this.onEvent({ type: 'STATUS', message: 'Naukri chatbot detected. Solving questions...' });

    let stepCount = 0;
    let answeredQuestions = new Set();

    while (stepCount < this.maxSteps) {
      stepCount++;
      await this.page.waitForTimeout(1000);

      // 1. Check for Application Completed / Success state
      const successSelector = '.chatbot-success, .application-submitted, .applied-success, text="Application Submitted", text="Applied Successfully", text="Your application has been sent"';
      const isSuccess = await this.page.locator(successSelector).first().isVisible().catch(() => false);
      if (isSuccess) {
        this.onLog('Application successfully submitted via Naukri Chatbot!');
        this.onEvent({ type: 'SUCCESS', message: 'Naukri Application Submitted Successfully!' });
        return { success: true, steps: stepCount };
      }

      // 2. Check for File Upload prompt (Resume attachment)
      const fileInput = await this.page.locator('input[type="file"]').first();
      const isFileVisible = await fileInput.isVisible().catch(() => false);
      if (isFileVisible) {
        const resumePath = this.solver.userProfile?.documents?.defaultResumePath || './resumes/default_resume.pdf';
        this.onLog(`Attaching resume: ${resumePath}`);
        await fileInput.setInputFiles(resumePath);
        this.onEvent({ type: 'ACTION', action: 'UPLOAD_RESUME', file: resumePath });
        await this.page.waitForTimeout(1000);
        continue;
      }

      // 3. Extract the latest recruiter chatbot message / question
      const bubbleSelector = '.bot-msg, .bot-chat-bubble, .message-bot, [data-sender="bot"], .bot-bubble';
      const botBubbles = await this.page.locator(bubbleSelector).all();
      let latestQuestionText = '';

      if (botBubbles.length > 0) {
        const latestBubble = botBubbles[botBubbles.length - 1];
        latestQuestionText = (await latestBubble.innerText()).trim();
      }

      if (!latestQuestionText) {
        // Fallback: look for general prompt text inside container
        latestQuestionText = await this.page.locator('.chat-header-sub, .question-text').first().innerText().catch(() => '');
      }

      // 4. Check for quick-reply chip buttons (Naukri style)
      const chipsSelector = '.chip-item, .quick-reply-btn, .option-chip, .chatbot-chips button, .chip-group button';
      const chips = await this.page.locator(chipsSelector).all();

      if (chips.length > 0) {
        const chipOptions = [];
        for (const chip of chips) {
          const text = (await chip.innerText()).trim();
          if (text) chipOptions.push(text);
        }

        this.onLog(`Recruiter Prompt: "${latestQuestionText}" | Quick Reply Options: [${chipOptions.join(', ')}]`);

        // Solve using QuestionSolver
        const solution = await this.solver.solveQuestion(latestQuestionText, chipOptions, 'chip');
        this.onLog(`Solver Decision: Pick "${solution.selectedOption || solution.answer}" (Confidence: ${solution.confidence}%)`);

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: latestQuestionText,
          options: chipOptions,
          answer: solution.selectedOption || solution.answer,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });

        // Find and click the matching chip
        let clicked = false;
        for (const chip of chips) {
          const text = (await chip.innerText()).trim().toLowerCase();
          const target = (solution.selectedOption || solution.answer || '').trim().toLowerCase();
          if (text === target || text.includes(target) || target.includes(text)) {
            await chip.click();
            clicked = true;
            break;
          }
        }

        if (!clicked && chips.length > 0) {
          // Click first chip as fallback if no exact match
          await chips[0].click();
        }

        await this.page.waitForTimeout(1500);
        continue;
      }

      // 5. Check for Submit / Apply final button (before typing)
      const submitBtn = await this.page.locator('button:has-text("Submit Application"), .submit-application-btn, button:has-text("Submit")').first();
      const isSubmitVisible = await submitBtn.isVisible().catch(() => false);
      if (isSubmitVisible) {
        if (this.dryRun) {
          this.onLog('[DRY RUN] Final Submit button reached. Pausing before submission for user review.');
          this.onEvent({ type: 'DRY_RUN_PAUSE', message: 'Paused before final submit in Dry Run mode.' });
          return { success: true, dryRunPaused: true, step: 'final_submit' };
        } else {
          this.onLog('Submitting final application...');
          await submitBtn.click();
          await this.page.waitForTimeout(2000);
          return { success: true, steps: stepCount };
        }
      }

      // 6. Check for Chatbot Text Input field
      const chatInputSelector = '.chat-input, input[placeholder*="reply"], input[placeholder*="type"], .chatbot-input input, textarea.chat-textarea';
      const chatInput = await this.page.locator(chatInputSelector).first();
      const isInputVisible = await chatInput.isVisible().catch(() => false);

      if (isInputVisible) {
        const inputType = await chatInput.getAttribute('type').catch(() => 'text') || 'text';
        this.onLog(`Recruiter Question: "${latestQuestionText}"`);

        const solution = await this.solver.solveQuestion(latestQuestionText, [], inputType);
        this.onLog(`Solver Answer: "${solution.answer}" (Confidence: ${solution.confidence}%)`);

        this.onEvent({
          type: 'QUESTION_SOLVED',
          question: latestQuestionText,
          answer: solution.answer,
          confidence: solution.confidence,
          requires_manual_review: solution.requires_manual_review
        });

        if (solution.requires_manual_review) {
          this.onEvent({ type: 'HITL_CHIME', question: latestQuestionText, confidence: solution.confidence });
        }

        // Fill input
        await chatInput.fill('');
        await chatInput.pressSequentially(String(solution.answer), { delay: 35 });

        // Click Send button or press Enter
        const sendBtn = await this.page.locator('.send-btn, .chat-send, button[type="submit"], [aria-label="Send"]').first();
        if (await sendBtn.isVisible().catch(() => false)) {
          await sendBtn.click();
        } else {
          await chatInput.press('Enter');
        }

        await this.page.waitForTimeout(1500);
        continue;
      }

      // No new interactive elements detected; wait briefly
      await this.page.waitForTimeout(1500);
    }

    return { success: false, reason: 'Exceeded max steps without reaching completion' };
  }
}

module.exports = NaukriChatbotHandler;
