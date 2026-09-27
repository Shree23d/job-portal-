/**
 * Autonomous External Form Filler ("Tiny Brain")
 * Navigates external company career pages, ATS portals (Greenhouse, Lever, Workday, etc.),
 * and custom WordPress/agency application forms (e.g. Contact Form 7, BlueBit Systems, Accelaronix).
 * Auto-attaches authentic resume PDF, selects matching job roles from dropdowns,
 * fills contact/experience/compensation details, and respects dry-run limits.
 */

const path = require('path');
const fs = require('fs');
const HumanBrowser = require('../engine/humanBrowser');

class AutonomousFormFiller {
  constructor(page, questionSolver, options = {}) {
    this.page = page;
    this.solver = questionSolver;
    this.applier = options.applier || null;
    this.dryRun = options.dryRun ?? true;
    this.maxSteps = options.maxSteps || 10;
    this.onLog = options.onLog || ((msg) => console.log(`[AutonomousFormFiller] ${msg}`));
    this.onEvent = options.onEvent || (() => {});
    this.userProfile = questionSolver.userProfile || {};
  }

  /**
   * Resolves the user's authentic original resume PDF file path.
   */
  resolveOriginalResumePath() {
    const candidatePaths = [
      path.resolve(process.cwd(), 'orignal resume/Shreyas Jadhav resume.pdf'),
      path.resolve(process.cwd(), 'resumes/shreyas_jadhav_resume.pdf'),
      path.resolve(process.cwd(), 'resumes/original_resume.pdf'),
      path.resolve(process.cwd(), this.userProfile.documents?.defaultResumePath || 'resumes/default_resume.pdf')
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return candidatePaths[1];
  }

  /**
   * Scans page and frames to determine if any interactive form inputs exist.
   */
  async detectAnyFormElements(targets = [this.page, ...this.page.frames()]) {
    for (const target of targets) {
      try {
        const inputs = await target.locator('input:not([type="hidden"]), textarea, select, [contenteditable="true"]').all().catch(() => []);
        for (const input of inputs) {
          if (await input.isVisible().catch(() => false)) {
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  /**
   * Injects an on-page interactive assistance banner asking the user to locate the form.
   */
  async injectAssistanceBanner() {
    try {
      await this.page.evaluate(() => {
        if (document.getElementById('agent-assistance-banner')) return;
        window.__userFormAction = null;

        const banner = document.createElement('div');
        banner.id = 'agent-assistance-banner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
          color: #ffffff;
          padding: 12px 24px;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          border-bottom: 3px solid #6366f1;
          box-sizing: border-box;
        `;

        banner.innerHTML = `
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="font-size: 24px;">⏸️</div>
            <div>
              <div style="font-weight: 700; font-size: 15px; color: #fbbf24; letter-spacing: 0.3px;">
                PAUSED: Please Help Locate the Application Form!
              </div>
              <div style="font-size: 13px; color: #cbd5e1; margin-top: 2px;">
                I could not detect the form automatically. Please click "Apply", open the job form, or scroll to it. Then click Continue!
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <button id="banner-skip-btn" style="
              background: #ef4444;
              color: #ffffff;
              border: none;
              padding: 8px 16px;
              border-radius: 6px;
              font-weight: 600;
              font-size: 13px;
              cursor: pointer;
              transition: all 0.2s;
            ">⏭️ Skip Job</button>
            <button id="banner-resume-btn" style="
              background: #10b981;
              color: #ffffff;
              border: none;
              padding: 9px 20px;
              border-radius: 6px;
              font-weight: 700;
              font-size: 13px;
              cursor: pointer;
              box-shadow: 0 2px 10px rgba(16,185,129,0.4);
              transition: all 0.2s;
            ">✅ I Found the Form - Continue</button>
          </div>
        `;

        document.body.prepend(banner);

        document.getElementById('banner-resume-btn')?.addEventListener('click', () => {
          window.__userFormAction = 'resume';
        });

        document.getElementById('banner-skip-btn')?.addEventListener('click', () => {
          window.__userFormAction = 'skip';
        });
      });
    } catch (e) {}
  }

  /**
   * Removes the on-page assistance banner.
   */
  async removeAssistanceBanner() {
    try {
      await this.page.evaluate(() => {
        const b = document.getElementById('agent-assistance-banner');
        if (b) b.remove();
      });
    } catch (e) {}
  }

  /**
   * Pauses execution and waits for the user to navigate/click to the form.
   */
  async promptUserToLocateForm() {
    this.onLog('⏸️ [PAUSE] Form not detected automatically. Pausing bot to allow user to locate the form...');
    this.onEvent({
      type: 'AWAIT_FORM_ASSISTANCE',
      url: this.page.url(),
      message: '⚠️ Application form not detected automatically. Please find and click the form in the browser!'
    });

    await HumanBrowser.updateStatus(this.page, '⏸️ Paused: Please open the form, then click Continue!');

    // Inject on-page banner in browser
    await this.injectAssistanceBanner();

    const action = await new Promise((resolve) => {
      // Connect to autoApplier resolver for dashboard UI buttons
      if (this.applier) {
        this.applier.activeFormAssistanceResolver = resolve;
      }

      // Check for on-page button click every 500ms
      const poll = setInterval(async () => {
        try {
          const clicked = await this.page.evaluate(() => window.__userFormAction).catch(() => null);
          if (clicked) {
            clearInterval(poll);
            resolve({ action: clicked });
          }
        } catch (e) {}
      }, 500);

      // Auto-timeout after 3 minutes (180s)
      setTimeout(() => {
        clearInterval(poll);
        resolve({ action: 'timeout' });
      }, 180000);
    });

    await this.removeAssistanceBanner();

    if (action && action.action === 'resume') {
      this.onLog('✅ [USER RESUMED] User signaled form located! Resuming autonomous solver...');
      this.onEvent({
        type: 'FORM_ASSISTANCE_RESUMED',
        message: 'Resuming autonomous form filler!'
      });
      await this.page.waitForTimeout(1500);
      await HumanBrowser.injectVisualCursor(this.page);
      return { resumed: true };
    }

    return { resumed: false, reason: action ? action.action : 'cancelled' };
  }

  /**
   * Main autonomous orchestration on the external page
   */
  async handle() {
    const currentUrl = this.page.url();
    this.onLog(`🧠 [TINY BRAIN] Initiating autonomous application solver on: ${currentUrl}`);
    this.onEvent({ type: 'STATUS', message: `Autonomous solver active on ${new URL(currentUrl).hostname}...` });

    // Step 1: Inject visual cursor
    await HumanBrowser.injectVisualCursor(this.page);
    await HumanBrowser.updateStatus(this.page, '🔍 Scanning Page & Job Details...');
    await this.page.waitForTimeout(1000);

    // Step 2: Natural exploration - scroll down to inspect job overview & find application gateway
    await HumanBrowser.smoothScroll(this.page, 450, '📜 Scanning Job Requirements...');
    await this.page.waitForTimeout(600);

    // Step 3: Check if page has an initial "Apply for this role" / "Apply Now" gateway button
    await this.checkAndClickApplyGateway();

    // Step 3.5: Check if any form fields exist. If not, pause and ask the user to locate the form!
    let initialTargets = [this.page, ...this.page.frames()];
    let hasForm = await this.detectAnyFormElements(initialTargets);

    if (!hasForm) {
      this.onLog('⚠️ [TINY BRAIN] No visible form elements found on initial scan. Asking user for assistance...');
      const assistanceResult = await this.promptUserToLocateForm();
      if (!assistanceResult.resumed) {
        this.onLog(`⏭️ Skipping job because form could not be located (${assistanceResult.reason}).`);
        return { success: false, skipped: true, reason: 'Form not located' };
      }
      // Re-scan after user navigated to form
      await HumanBrowser.smoothScroll(this.page, 200, '🔍 Scanning newly located form...');
      await this.page.waitForTimeout(800);
    }

    // Step 4: Multi-step form solving loop (supporting top page and any embedded iframes)
    let currentStep = 0;
    let completed = false;

    while (currentStep < this.maxSteps && !completed) {
      currentStep++;
      this.onLog(`🧠 [TINY BRAIN] Analyzing form fields for Step ${currentStep}...`);
      await HumanBrowser.updateStatus(this.page, `🧠 Analyzing Form Fields (Step ${currentStep})...`);

      // 4A: Check for success / confirmation
      const isSuccess = await this.detectSuccessConfirmation();
      if (isSuccess) {
        this.onLog('🎉 Application successfully submitted on external site!');
        this.onEvent({ type: 'SUCCESS', message: 'Application Successfully Submitted on External Site!' });
        return { success: true, steps: currentStep };
      }

      // Collect all targets: main page + any child frames (if form is in an iframe)
      const targets = [this.page, ...this.page.frames()];

      for (const target of targets) {
        // 4B: Attach authentic resume if file input is present
        await this.handleResumeAttachment(target);

        // 4C: Handle Select dropdowns (especially Position / Role dropdowns)
        await this.handleSelectsAndOptions(target);

        // 4D: Fill text, email, tel, and textarea inputs
        await this.fillAllVisibleFormInputs(target);
      }

      // 4E: Check for Submit / Next buttons
      const navigationAction = await this.handleFormNavigation();
      if (navigationAction.done) {
        completed = true;
        if (navigationAction.dryRunPaused) {
          return { success: true, dryRunPaused: true, steps: currentStep };
        }
        return { success: true, steps: currentStep };
      }

      await this.page.waitForTimeout(2000);
    }

    return { success: true, message: 'Autonomous flow completed.' };
  }

  /**
   * If landing on an external job description page before the form, click "Apply for this role" / "Apply Now"
   */
  async checkAndClickApplyGateway() {
    try {
      const applyBtnSelectors = [
        'a:has-text("Apply for this role")',
        'button:has-text("Apply for this role")',
        'a:has-text("Apply for role")',
        'button:has-text("Apply for role")',
        'a:has-text("Apply for this job")',
        'button:has-text("Apply for this job")',
        'a:has-text("Apply Now")',
        'button:has-text("Apply Now")',
        'button:has-text("Start Application")',
        'a:has-text("Apply Online")',
        'button:has-text("Apply Online")',
        'a[href*="#apply"]',
        'a[href*="application"]',
        '.postings-btn:has-text("Apply")',
        '#apply-button',
        '.apply-button'
      ];

      for (const sel of applyBtnSelectors) {
        const btn = await this.page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          this.onLog(`Located external application trigger button: "${sel}". Moving cursor and clicking...`);
          await HumanBrowser.humanClick(this.page, btn, '🎯 Clicking "Apply" Gateway...');
          await this.page.waitForTimeout(2000);
          break;
        }
      }
    } catch (e) {
      // Form might already be visible on page
    }
  }

  /**
   * Finds file inputs (Upload CV / Resume) and attaches the authentic resume PDF
   */
  async handleResumeAttachment(contextTarget = this.page) {
    try {
      const fileInputs = await contextTarget.locator('input[type="file"]').all().catch(() => []);
      if (fileInputs.length > 0) {
        const resumePath = this.resolveOriginalResumePath();
        const resumeName = path.basename(resumePath);

        for (const input of fileInputs) {
          const isAttached = await input.evaluate((el) => el.files && el.files.length > 0).catch(() => false);
          if (!isAttached) {
            this.onLog(`📄 Attaching authentic resume: "${resumeName}" (${resumePath})`);
            await HumanBrowser.updateStatus(this.page, `📄 Attaching CV/Resume: ${resumeName}...`);
            await input.setInputFiles(resumePath).catch(async () => {
              // hidden/styled file input fallback
              await input.evaluate((el, p) => {}, resumePath).catch(() => {});
            });
            this.onEvent({
              type: 'ACTION',
              action: 'UPLOAD_RESUME',
              file: resumeName,
              fullPath: resumePath
            });
            await this.page.waitForTimeout(800);
          }
        }
      }
    } catch (e) {
      this.onLog(`Resume attachment note: ${e.message}`);
    }
  }

  /**
   * Handles Select dropdowns, specifically Position / Job Role dropdowns and legal questions
   */
  async handleSelectsAndOptions(contextTarget = this.page) {
    try {
      const selects = await contextTarget.locator('select').all().catch(() => []);
      for (const sel of selects) {
        const isVisible = await sel.isVisible().catch(() => false);
        if (!isVisible) continue;

        const meta = await sel.evaluate((el) => {
          const id = el.id || '';
          const name = el.name || '';
          let labelText = '';
          if (id) {
            const l = document.querySelector(`label[for="${id}"]`);
            if (l) labelText = l.innerText;
          }
          if (!labelText && el.previousElementSibling) {
            labelText = el.previousElementSibling.innerText || '';
          }
          if (!labelText && el.parentElement?.previousElementSibling) {
            labelText = el.parentElement.previousElementSibling.innerText || '';
          }
          if (!labelText) {
            labelText = el.closest('tr, .form-group, p, div')?.innerText || '';
          }

          const options = Array.from(el.options).map(o => ({
            value: o.value,
            text: (o.text || o.innerText || '').trim(),
            index: o.index
          }));

          return {
            id: id.toLowerCase(),
            name: name.toLowerCase(),
            labelText: labelText.toLowerCase(),
            options,
            selectedIndex: el.selectedIndex
          };
        }).catch(() => null);

        if (!meta) continue;

        const fullContext = `${meta.labelText} ${meta.name} ${meta.id}`;

        // 1. Position / Role / Job Applying For (e.g. BlueBit Systems "Position* : Please Select")
        if (fullContext.includes('position') || fullContext.includes('role') || fullContext.includes('job') || fullContext.includes('apply') || fullContext.includes('profile')) {
          // If currently unselected or on "Please Select"
          if (meta.selectedIndex <= 0 || (meta.options[meta.selectedIndex]?.text.toLowerCase().includes('select'))) {
            const targetKeywords = ['wordpress', 'shopify', 'liquid', 'php', 'web developer', 'developer', 'frontend', 'software'];
            let matchedOption = null;

            for (const kw of targetKeywords) {
              matchedOption = meta.options.find(o => o.text.toLowerCase().includes(kw));
              if (matchedOption) break;
            }

            if (matchedOption) {
              this.onLog(`🎯 Selecting Position in dropdown [${matchedOption.text}]`);
              await sel.selectOption({ index: matchedOption.index }).catch(() => {});
              await this.page.waitForTimeout(400);
              continue;
            } else if (meta.options.length > 1) {
              // Default to first real option (skipping placeholder at index 0)
              const firstValid = meta.options.find(o => o.index > 0 && o.text.length > 2);
              if (firstValid) {
                this.onLog(`🎯 Selecting Role option [${firstValid.text}]`);
                await sel.selectOption({ index: firstValid.index }).catch(() => {});
                await this.page.waitForTimeout(400);
                continue;
              }
            }
          }
        }
        // 2. Work Authorization / Legal Questions
        else if (fullContext.includes('authorized') || fullContext.includes('eligible') || fullContext.includes('relocate') || fullContext.includes('hybrid')) {
          await sel.selectOption({ label: 'Yes' }).catch(() => sel.selectOption({ index: 1 }));
        } else if (fullContext.includes('sponsorship') || fullContext.includes('visa')) {
          await sel.selectOption({ label: 'No' }).catch(() => sel.selectOption({ index: 1 }));
        } else if (fullContext.includes('gender')) {
          await sel.selectOption({ label: 'Male' }).catch(() => sel.selectOption({ index: 1 }));
        }
        // 3. Availability / Working Hours (e.g. NewVariable "Hours You Are Available for Work")
        else if (fullContext.includes('availab') || fullContext.includes('hours') || fullContext.includes('working hours') || fullContext.includes('per week')) {
          const availOption = meta.options.find(o => {
            const txt = o.text.toLowerCase();
            return txt.includes('full') || txt.includes('40') || txt.includes('flexible') || txt.includes('immediate') || txt.includes('more than 30');
          }) || meta.options.find(o => o.index > 0);
          if (availOption) {
            this.onLog(`🎯 Selecting Availability in dropdown [${availOption.text}]`);
            await sel.selectOption({ index: availOption.index }).catch(() => {});
            await this.page.waitForTimeout(400);
            continue;
          }
        }
        // 4. Any other custom dropdown: Let QuestionSolver evaluate choices
        else if (meta.options.length > 1 && (meta.selectedIndex <= 0 || meta.options[meta.selectedIndex]?.text.toLowerCase().includes('select'))) {
          const solution = await this.solver.solveQuestion(meta.labelText || meta.name, meta.options.map(o => o.text), 'select');
          if (solution && (solution.selectedOption || solution.answer)) {
            const targetChoice = (solution.selectedOption || solution.answer).toLowerCase();
            const matchedOpt = meta.options.find(o => o.text.toLowerCase().includes(targetChoice) || targetChoice.includes(o.text.toLowerCase()));
            if (matchedOpt) {
              this.onLog(`🎯 AI selected dropdown option [${matchedOpt.text}] (${solution.confidence}% confidence)`);
              await sel.selectOption({ index: matchedOpt.index }).catch(() => {});
              await this.page.waitForTimeout(400);
            }
          }
        }
      }

      // Checkboxes (Terms, Agreements)
      const checkboxes = await contextTarget.locator('input[type="checkbox"]').all().catch(() => []);
      for (const cb of checkboxes) {
        const isVisible = await cb.isVisible().catch(() => false);
        if (isVisible) {
          const isChecked = await cb.isChecked().catch(() => false);
          if (!isChecked) {
            await cb.check().catch(() => {});
          }
        }
      }

      // Radio Button Groups (e.g. Position, Work Authorization, Gender)
      const radios = await contextTarget.locator('input[type="radio"]').all().catch(() => []);
      const groups = new Map();
      for (const r of radios) {
        const isVisible = await r.isVisible().catch(() => false);
        if (!isVisible) continue;
        const name = await r.getAttribute('name').catch(() => '');
        if (!name) continue;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(r);
      }

      for (const [groupName, radioList] of groups.entries()) {
        let anyChecked = false;
        for (const r of radioList) {
          if (await r.isChecked().catch(() => false)) {
            anyChecked = true;
            break;
          }
        }
        if (anyChecked) continue; // Already answered

        // Discover options and labels for this radio group
        const radioOptions = [];
        let groupTitle = '';
        for (const r of radioList) {
          const meta = await r.evaluate((el) => {
            let label = '';
            if (el.id) {
              const l = document.querySelector(`label[for="${el.id}"]`);
              if (l) label = l.innerText;
            }
            if (!label && el.parentElement) {
              label = el.parentElement.innerText;
            }
            const container = el.closest('.gfield, .form-group, fieldset');
            let legend = '';
            if (container) {
              const lg = container.querySelector('.gfield_label, legend, label');
              if (lg) legend = lg.innerText;
            }
            return { label: (label || el.value || '').trim(), legend: (legend || '').trim(), val: el.value };
          }).catch(() => null);

          if (meta) {
            radioOptions.push({ locator: r, label: meta.label, val: meta.val });
            if (meta.legend && !groupTitle) groupTitle = meta.legend;
          }
        }

        if (radioOptions.length > 0) {
          const promptQuestion = groupTitle || groupName;
          const choiceLabels = radioOptions.map(o => o.label);
          const solution = await this.solver.solveQuestion(promptQuestion, choiceLabels, 'radio');

          let targetRadio = null;
          if (solution && solution.selectedOption) {
            targetRadio = radioOptions.find(o => o.label.toLowerCase().includes(solution.selectedOption.toLowerCase()) || solution.selectedOption.toLowerCase().includes(o.label.toLowerCase()));
          }
          if (!targetRadio) {
            // Priority match for engineering / tech if position question
            targetRadio = radioOptions.find(o => {
              const t = o.label.toLowerCase();
              return t.includes('engineering') || t.includes('developer') || t.includes('technical') || t.includes('web');
            }) || radioOptions[0];
          }

          if (targetRadio) {
            this.onLog(`🎯 AI selected radio option [${targetRadio.label}] for group "${promptQuestion}"`);
            await targetRadio.locator.check().catch(() => targetRadio.locator.click().catch(() => {}));
            await this.page.waitForTimeout(300);
          }
        }
      }
    } catch (e) {
      this.onLog(`Dropdown/Options note: ${e.message}`);
    }
  }

  /**
   * Scans and fills text, email, tel, and textarea inputs with robust label detection
   */
  async fillAllVisibleFormInputs(contextTarget = this.page) {
    const inputs = await contextTarget.locator('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="radio"]):not([type="checkbox"]), textarea').all().catch(() => []);

    for (const input of inputs) {
      const isVisible = await input.isVisible().catch(() => false);
      if (!isVisible) continue;

      const currentValue = await input.inputValue().catch(() => '');
      if (currentValue && currentValue.trim().length > 0) continue; // Already filled

      // Extract comprehensive field metadata using multi-strategy label discovery
      const meta = await input.evaluate((el) => {
        const id = el.id || '';
        const name = el.name || '';
        const placeholder = el.placeholder || '';
        const type = el.type || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';

        let labelText = '';
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) labelText = labelEl.innerText;
        }
        if (!labelText) {
          const parentLabel = el.closest('label');
          if (parentLabel) labelText = parentLabel.innerText;
        }
        // Preceding siblings (label, h3, h4, h5, p, span, strong)
        if (!labelText) {
          let prev = el.previousElementSibling;
          while (prev) {
            if (['LABEL', 'H3', 'H4', 'H5', 'P', 'SPAN', 'STRONG', 'B'].includes(prev.tagName)) {
              const txt = (prev.innerText || '').trim();
              if (txt && txt.length > 1 && txt.length < 250) {
                labelText = txt;
                break;
              }
            }
            prev = prev.previousElementSibling;
          }
        }
        // Parent's preceding sibling
        if (!labelText && el.parentElement?.previousElementSibling) {
          const txt = (el.parentElement.previousElementSibling.innerText || '').trim();
          if (txt && txt.length > 1 && txt.length < 250) {
            labelText = txt;
          }
        }
        // Table cell / row check
        if (!labelText) {
          const tr = el.closest('tr');
          if (tr) {
            const firstCell = tr.querySelector('td:first-child, th:first-child');
            if (firstCell && firstCell !== el.closest('td')) {
              labelText = (firstCell.innerText || '').trim();
            }
          }
        }
        // Specific form field container (NEVER generic div)
        if (!labelText) {
          const container = el.closest('.form-group, .form-field, .form-row, .wpcf7-form-control-wrap, .field-wrapper, .input-wrap');
          if (container) {
            const clone = container.cloneNode(true);
            clone.querySelectorAll('input, select, textarea, button').forEach(n => n.remove());
            labelText = (clone.innerText || '').trim();
          }
        }
        if (!labelText && el.parentElement) {
          const pTxt = (el.parentElement.innerText || '').trim();
          if (pTxt.length < 150) labelText = pTxt;
        }

        return {
          id: id.toLowerCase(),
          name: name.toLowerCase(),
          placeholder: placeholder.toLowerCase(),
          type: type.toLowerCase(),
          ariaLabel: ariaLabel.toLowerCase(),
          title: title.toLowerCase(),
          labelText: labelText.trim().toLowerCase(),
          fullLabel: labelText.trim()
        };
      }).catch(() => null);

      if (!meta) continue;

      const combinedText = `${meta.labelText} ${meta.placeholder} ${meta.name} ${meta.ariaLabel} ${meta.title} ${meta.id}`;
      const questionText = meta.fullLabel || meta.placeholder || meta.name;

      // Determine if this is an essay, narrative, or open-ended question requiring LLM thinking
      const isComplexOrEssay = meta.type === 'textarea' ||
        meta.labelText.includes('about yourself') ||
        meta.labelText.includes('tell us') ||
        meta.labelText.includes('why should') ||
        meta.labelText.includes('why are you') ||
        meta.labelText.includes('describe') ||
        meta.labelText.includes('link') ||
        meta.labelText.includes('rate') ||
        meta.labelText.includes('salary') ||
        meta.labelText.includes('available') ||
        meta.labelText.includes('hours') ||
        questionText.includes('?');

      let val = null;
      if (!isComplexOrEssay) {
        val = this.matchProfileValue(combinedText, meta.type, meta.fullLabel);
      }

      if (val !== null && val !== undefined) {
        this.onLog(`✍️ Auto-filling standard field [${meta.fullLabel || meta.name || meta.placeholder}]: "${val.length > 50 ? val.substring(0, 47) + '...' : val}"`);
        await HumanBrowser.humanType(
          this.page,
          input,
          val,
          `✍️ Typing: ${meta.fullLabel || meta.name || 'field'}...`
        );
      } else {
        // "Think then fill": Send question to QuestionSolver (Gemini LLM / Smart Semantic Engine)
        if (questionText && questionText.length > 2) {
          this.onLog(`🧠 [THINKING] Scanning and evaluating question for field: "${questionText}"...`);
          await HumanBrowser.updateStatus(this.page, `🧠 Solving: "${questionText.substring(0, 30)}..."`);
          const solution = await this.solver.solveQuestion(
            questionText,
            [],
            meta.type === 'textarea' ? 'textarea' : (meta.type || 'text'),
            { placeholder: meta.placeholder, name: meta.name }
          );
          if (solution && solution.answer) {
            this.onLog(`💡 AI Thought: "${solution.answer.substring(0, 60)}..." (${solution.confidence}% confidence via ${solution.reasoning || solution.source || 'LLM'})`);
            await HumanBrowser.humanType(this.page, input, solution.answer);
          }
        }
      }
    }
  }

  /**
   * Matches field context against Shreyas Jadhav's user profile for direct identity fields
   */
  matchProfileValue(text, type, rawLabel) {
    const p = this.userProfile.personal || {};
    const c = this.userProfile.career || {};
    const t = text.toLowerCase();

    // Textareas are NEVER direct simple values (they go to QuestionSolver)
    if (type === 'textarea') return null;

    // 1. Email (NEVER textarea)
    if (type === 'email' || t.includes('email') || t.includes('e-mail') || t.includes('your-email')) {
      return p.email || 'shreyasmjadhav23@gmail.com';
    }

    // 2. Phone / Mobile / Contact Number (STRICT: Never match words like 'tell us' or 'about')
    const isPhoneWord = /\b(phone|mobile|cellphone|telephone|contact\s*no|contact\s*num|contact\s*number)\b/i.test(t);
    const isPhoneAttr = type === 'tel' || /your[-_]tel/i.test(t) || /your[-_]phone/i.test(t);
    if ((isPhoneWord || isPhoneAttr) && !t.includes('about yourself') && !t.includes('tell us') && !t.includes('about you')) {
      return p.phone?.replace('+91', '').trim() || '9175068149';
    }

    // 3. Name: First Name, Last Name, Full Name
    if (t.includes('first name') || t.includes('given name') || t.includes('fname')) {
      return 'Shreyas';
    }
    if (t.includes('last name') || t.includes('surname') || t.includes('family name') || t.includes('lname')) {
      return 'Jadhav';
    }
    if (t.includes('name') && !t.includes('company') && !t.includes('user') && !t.includes('file') && !t.includes('username')) {
      return p.fullName || 'Shreyas Jadhav';
    }

    // 4. Resume Link / Online Document URL
    if (t.includes('link your resume') || t.includes('resume link') || t.includes('resume url') || t.includes('link resume')) {
      return p.linkedInUrl || 'https://www.linkedin.com/in/shreyas-jadhav';
    }

    // 5. LinkedIn URL
    if (t.includes('linkedin') || t.includes('linked in')) {
      return p.linkedInUrl || 'https://www.linkedin.com/in/shreyas-jadhav';
    }

    // 6. Portfolio / Website / GitHub
    if (t.includes('portfolio') || t.includes('website') || t.includes('personal site') || t.includes('github') || type === 'url') {
      return p.portfolioUrl || 'https://digidaftar.com';
    }

    // 7. Location / City / Address / Street / Unit / Suite / Zip
    if (t.includes('unit') || t.includes('suite') || t.includes('apt') || t.includes('apartment') || t.includes('address line 2') || t.includes('address 2')) {
      return '';
    }
    if (t.includes('zip') || t.includes('postal') || t.includes('pin code') || t.includes('pincode')) {
      return p.postalCode || '411001';
    }
    if ((t.includes('street') || t.includes('address line 1') || t.includes('address 1')) && !t.includes('email')) {
      return p.streetAddress || 'Pune, Maharashtra';
    }
    if (t.includes('city') || t.includes('current location')) {
      return p.city || 'Pune';
    }
    if (t.includes('state')) {
      return p.state || 'Maharashtra';
    }
    if (t.includes('country')) {
      return p.country || 'India';
    }

    // 8. Total Experience (Only for short numeric fields)
    if ((t.includes('total exp') || t.includes('years of exp') || t.includes('total experience')) && !t.includes('describe') && !t.includes('tell')) {
      return String(c.totalExperienceYears || '3.5');
    }

    // 9. Notice Period
    if ((t.includes('notice period') || t.includes('serving notice')) && !t.includes('describe')) {
      return String(c.noticePeriodDays || '0');
    }

    // 10. Education
    if ((t.includes('highest qualification') || t.includes('degree')) && !t.includes('describe')) {
      return c.highestEducation || 'Bachelor of Engineering in Information Technology';
    }

    return null;
  }

  /**
   * Handles multi-step Next / Review / Submit navigation
   */
  async handleFormNavigation() {
    // 1. Detect Final Submit Button
    const submitBtnSelectors = [
      'button[type="submit"]:has-text("Submit")',
      'button:has-text("Submit Application")',
      'button:has-text("Submit application")',
      'input[type="submit"][value*="Submit"]',
      'input[type="submit"][value*="Send"]',
      'input[type="submit"]',
      'button:has-text("Send Message")',
      'button:has-text("Send Application")',
      'button:has-text("Finish Application")',
      'button:has-text("Apply Now")',
      'button:has-text("Submit")',
      '#submit-application',
      '.btn-submit'
    ];

    for (const sel of submitBtnSelectors) {
      const btn = await this.page.locator(sel).first();
      const isVisible = await btn.isVisible().catch(() => false);

      if (isVisible) {
        if (this.dryRun) {
          this.onLog(`🛡️ [DRY RUN SAFEGUARD] Form completely filled on external company site! Pausing for review.`);
          await HumanBrowser.highlightElement(this.page, btn, '#22c55e');
          await HumanBrowser.updateStatus(this.page, '🛡️ Dry-Run Review: Form Completed & Ready for User Submission');
          this.onEvent({
            type: 'APPLY_PAUSED',
            message: 'External application form completely filled! Paused before final submission for your review.'
          });
          return { done: true, dryRunPaused: true };
        } else {
          this.onLog(`🚀 Submitting application on external portal...`);
          await HumanBrowser.humanClick(this.page, btn, '🚀 Submitting Application...');
          await this.page.waitForTimeout(3000);
          return { done: true, success: true };
        }
      }
    }

    // 2. Detect "Next" / "Continue" step button
    const nextBtnSelectors = [
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Save & Continue")',
      'button:has-text("Proceed")',
      'a:has-text("Next Step")'
    ];

    for (const sel of nextBtnSelectors) {
      const nextBtn = await this.page.locator(sel).first();
      if (await nextBtn.isVisible().catch(() => false)) {
        this.onLog(`Proceeding to next step in multi-page application form...`);
        await HumanBrowser.humanClick(this.page, nextBtn, '⏩ Moving to Next Step...');
        await this.page.waitForTimeout(2000);
        return { done: false };
      }
    }

    return { done: true };
  }

  /**
   * Checks if confirmation text exists on page
   */
  async detectSuccessConfirmation() {
    const successKeywords = [
      'Application Submitted',
      'Application Received',
      'Thank you for applying',
      'Your application has been submitted',
      'Thanks for your interest',
      'Your message was sent successfully'
    ];

    for (const kw of successKeywords) {
      const el = await this.page.locator(`text="${kw}"`).first();
      if (await el.isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  }
}

module.exports = AutonomousFormFiller;
