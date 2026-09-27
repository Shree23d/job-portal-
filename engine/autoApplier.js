/**
 * Playwright Automation Worker & Auto-Applier Orchestrator
 * Coordinates browser sessions, attaches questionSolver, routes to platform handlers,
 * and streams real-time telemetry to the dashboard.
 * Supports persistent login sessions, autonomous external form solving, and live production URLs.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const QuestionSolver = require('./questionSolver');
const HumanBrowser = require('./humanBrowser');
const NaukriChatbotHandler = require('../handlers/naukriChatbot');
const LinkedInEasyApplyHandler = require('../handlers/linkedinEasyApply');
const IndeedScreeningHandler = require('../handlers/indeedScreening');
const AutonomousFormFiller = require('../handlers/autonomousFormFiller');
const SearchResultBatcher = require('../handlers/searchResultBatcher');

class AutoApplier {
  constructor(options = {}) {
    this.solver = options.solver || new QuestionSolver();
    this.broadcast = options.broadcast || (() => {});
    this.baseUrl = options.baseUrl || 'http://localhost:3000';
    this.userDataDir = path.join(__dirname, '..', 'data', 'browser_profile');
    this.activeSession = null;
    this.activeLoginContext = null;
    this.currentActiveContext = null;
    this.isAborted = false;

    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }
  }

  stopCurrentRun() {
    this.isAborted = true;
    this.log('🛑 [STOP] Emergency halt triggered! Stopping all automation...');
    this.emitEvent({
      type: 'APPLY_STOPPED',
      message: 'Automation manually stopped by user.'
    });
    if (this.activeFormAssistanceResolver) {
      this.activeFormAssistanceResolver({ action: 'skip' });
      this.activeFormAssistanceResolver = null;
    }
    if (this.currentActiveContext) {
      try {
        this.currentActiveContext.close().catch(() => {});
      } catch (e) {}
      this.currentActiveContext = null;
    }
  }

  resumeFormAssistance() {
    if (this.activeFormAssistanceResolver) {
      this.log('▶️ [USER ASSISTANCE] User signaled form located. Resuming autonomous solver...');
      this.activeFormAssistanceResolver({ action: 'resume' });
      this.activeFormAssistanceResolver = null;
      return true;
    }
    return false;
  }

  skipFormAssistance() {
    if (this.activeFormAssistanceResolver) {
      this.log('⏭️ [USER ASSISTANCE] User chose to skip job with missing form.');
      this.activeFormAssistanceResolver({ action: 'skip' });
      this.activeFormAssistanceResolver = null;
      return true;
    }
    return false;
  }

  cleanStaleLocks() {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const file of lockFiles) {
      const p = path.join(this.userDataDir, file);
      try {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      } catch (e) {
        // file locked or inaccessible
      }
    }
  }

  log(message, data = {}) {
    console.log(`[AutoApplier] ${message}`);
    this.broadcast({
      type: 'LOG',
      timestamp: new Date().toLocaleTimeString(),
      message,
      data
    });
  }

  emitEvent(event) {
    this.broadcast({
      ...event,
      timestamp: new Date().toLocaleTimeString()
    });
  }

  /**
   * Launch a persistent headed browser window so the user can manually log in
   * to LinkedIn, Naukri, or Indeed. Cookies and session tokens remain saved forever.
   */
  async openLoginSession(targetPortal = 'linkedin') {
    const urls = {
      linkedin: 'https://www.linkedin.com/login',
      naukri: 'https://www.naukri.com/nlogin/login',
      indeed: 'https://secure.indeed.com/auth'
    };
    const targetUrl = urls[targetPortal.toLowerCase()] || urls.linkedin;

    // If already open, navigate existing window
    if (this.activeLoginContext) {
      try {
        this.log(`Reusing active browser window for ${targetPortal}...`);
        const pages = this.activeLoginContext.pages();
        const page = pages.length > 0 ? pages[0] : await this.activeLoginContext.newPage();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.bringToFront().catch(() => {});
        return { success: true, message: `Navigated existing browser to ${targetPortal}` };
      } catch (e) {
        this.activeLoginContext = null;
      }
    }

    this.cleanStaleLocks();

    this.log(`Opening headed browser for ${targetPortal} login at: ${targetUrl}`);
    this.log(`Session cookies will be stored persistently in data/browser_profile.`);

    try {
      const context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 850 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        args: ['--disable-blink-features=AutomationControlled']
      });

      this.activeLoginContext = context;
      context.on('close', () => {
        this.activeLoginContext = null;
        this.cleanStaleLocks();
      });

      const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

      return { success: true, message: `Opened ${targetPortal} in browser. Log in and close when done.` };
    } catch (err) {
      this.activeLoginContext = null;
      this.cleanStaleLocks();
      this.log(`Note on browser launch: ${err.message}`);
      throw err;
    }
  }

  /**
   * Applies to a specific job (either simulator URL or live URL)
   */
  async applyToJob(job, userProfile, options = {}) {
    const dryRun = options.dryRun ?? (userProfile.settings?.dryRun ?? true);
    const isLinuxHeadless = process.platform === 'linux' && !process.env.DISPLAY;
    const isCloudEnv = process.env.HEADLESS === 'true' || process.env.NODE_ENV === 'production' || isLinuxHeadless;
    const headless = isLinuxHeadless ? true : (options.headless !== undefined ? options.headless : isCloudEnv);
    const usePersistentSession = options.usePersistentSession ?? true;

    this.log(`Starting auto-apply session for "${job.title}" at ${job.company} [${job.portal}]...`);
    this.emitEvent({
      type: 'APPLY_STARTED',
      job,
      dryRun
    });

    let context = null;
    let browser = null;
    try {
      if (usePersistentSession) {
        this.cleanStaleLocks();
        context = await chromium.launchPersistentContext(this.userDataDir, {
          headless,
          viewport: { width: 1280, height: 850 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
        });
      } else {
        browser = await chromium.launch({
          headless,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        context = await browser.newContext({
          viewport: { width: 1280, height: 850 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
      }

      this.isAborted = false;
      this.currentActiveContext = context;

      const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
      let result = null;

      // Configure QuestionSolver event hooks
      this.solver.onLog = (msg) => this.log(msg);

      // Determine Target URL
      let targetUrl = (job.applyUrl || '').trim();
      if (targetUrl.startsWith('/')) {
        targetUrl = `${this.baseUrl}${targetUrl}`;
      } else if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `https://${targetUrl}`;
      }

      // Check Episodic Memory for recent applications to prevent duplicate submissions
      if (this.solver?.memory && !options.forceReapply && !targetUrl.includes('simulator') && !targetUrl.includes('localhost')) {
        const recentApp = this.solver.memory.hasAppliedRecently(targetUrl || job.company);
        if (recentApp) {
          this.log(`⚠️ [EPISODIC MEMORY] You recently applied to "${recentApp.company}" for "${recentApp.title}" on ${new Date(recentApp.appliedAt).toLocaleDateString()} (Status: ${recentApp.status}). Skipping duplicate application.`);
          this.emitEvent({
            type: 'APPLY_SKIPPED',
            jobId: job.id,
            reason: `Already applied on ${new Date(recentApp.appliedAt).toLocaleDateString()}`
          });
          return { skipped: true, reason: `Already applied to ${recentApp.company}`, recentApp };
        }
      }

      this.log(`Navigating to application page: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);

      // Inject autonomous visual cursor
      await HumanBrowser.injectVisualCursor(page);

      const portalLower = (job.portal || '').toLowerCase();
      const appType = job.applicationType || '';
      const isLiveUrl = targetUrl.startsWith('http') && !targetUrl.includes('localhost');

      const maxApplications = options.maxApplications || userProfile.settings?.maxApplicationsPerRun || 3;

      const handlerOptions = {
        dryRun,
        maxApplications,
        applier: this,
        onLog: (msg) => this.log(msg),
        onEvent: (evt) => this.emitEvent(evt)
      };

      // 1. Detect if the user pasted a search result / job listings page
      const isSearchPage = SearchResultBatcher.isSearchUrl(targetUrl);
      if (isSearchPage) {
        this.log(`Detected search results page: ${targetUrl}. Starting batch crawler with limit of ${maxApplications} applications...`);
        const batcher = new SearchResultBatcher(page, this, handlerOptions);
        result = await batcher.handleSearchPage(portalLower, userProfile);
        return result;
      }

      // 2. Natural human browsing: smoothly scroll down to read the job posting
      await HumanBrowser.smoothScroll(page, 400, '📜 Scanning Job Requirements...');
      await page.waitForTimeout(600);

      // 3. If it's a single live job posting URL, trigger apply button while listening for popup tab
      let targetPage = page;
      if (isLiveUrl) {
        const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
        await this.triggerLiveApplyButton(page, portalLower);
        const newTab = await popupPromise;

        // Catch newest page if opened in background or redirected
        const allPages = context.pages();
        if (newTab) {
          targetPage = newTab;
        } else if (allPages.length > 1) {
          targetPage = allPages[allPages.length - 1];
        }

        if (targetPage !== page) {
          this.log(`🌐 [AUTONOMOUS BROWSER] Redirect to target application page detected: ${targetPage.url()}`);
          await targetPage.bringToFront().catch(() => {});
          await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
          await HumanBrowser.injectVisualCursor(targetPage);
        }
      }

      // Check if current target page is an external company / ATS page
      const targetPageUrl = targetPage.url();
      const isExternalUrl = targetPage !== page || (
        !targetPageUrl.includes('naukri.com') &&
        !targetPageUrl.includes('linkedin.com') &&
        !targetPageUrl.includes('indeed.com') &&
        !targetPageUrl.includes('localhost')
      );

      if (isExternalUrl) {
        this.log(`🌐 Application page is on external company website / ATS portal (${targetPageUrl}).`);
        this.log(`🤖 Deploying Autonomous Form Filler ("Tiny Brain") to solve form and attach original resume...`);
        const externalFiller = new AutonomousFormFiller(targetPage, this.solver, handlerOptions);
        result = await externalFiller.handle();
      } else {
        // Try portal-specific handler
        if (portalLower.includes('naukri') || appType === 'chatbot') {
          const handler = new NaukriChatbotHandler(targetPage, this.solver, handlerOptions);
          result = await handler.handle();
        } else if (portalLower.includes('linkedin') || appType === 'easy_apply') {
          const handler = new LinkedInEasyApplyHandler(targetPage, this.solver, handlerOptions);
          result = await handler.handle();
        } else if (portalLower.includes('indeed') || appType === 'screening_form') {
          const handler = new IndeedScreeningHandler(targetPage, this.solver, handlerOptions);
          result = await handler.handle();
        } else {
          const handler = new LinkedInEasyApplyHandler(targetPage, this.solver, handlerOptions);
          result = await handler.handle();
        }

        // If portal-specific container was not detected, fall back to Autonomous Tiny Brain form filler!
        if (!result || !result.success) {
          this.log(`In-portal modal/chatbot not detected. Switching to Autonomous Form Filler to inspect page & external links...`);
          const externalFiller = new AutonomousFormFiller(targetPage, this.solver, handlerOptions);
          result = await externalFiller.handle();
        }
      }

      // Check result
      if (result && result.dryRunPaused) {
        this.log(`[DRY RUN SAFEGUARD] Form successfully solved and verified! Paused before final submission.`);
        this.emitEvent({
          type: 'APPLY_PAUSED',
          jobId: job.id,
          message: 'Paused before submission in Dry Run mode. Ready for review!'
        });
      } else if (result && result.success) {
        this.log(`Application completed successfully for ${job.title}!`);
        this.emitEvent({
          type: 'APPLY_COMPLETED',
          jobId: job.id,
          message: 'Application Submitted Successfully!'
        });
      } else {
        this.log(`Application stopped: ${result ? result.reason || result.message : 'Unknown reason'}`);
        this.emitEvent({
          type: 'APPLY_FAILED',
          jobId: job.id,
          reason: result ? result.reason || result.message : 'Application could not complete'
        });
      }

      // Save application event to Agent Memory (Episodic Memory)
      if (this.solver?.memory) {
        const finalStatus = result?.dryRunPaused ? 'Paused (Dry Run)' : (result?.success ? 'Submitted' : 'Failed');
        this.solver.memory.recordApplication({
          company: job.company,
          title: job.title,
          portal: job.portal,
          applyUrl: targetPageUrl || targetUrl,
          status: finalStatus,
          dryRun
        });
      }

      if (!headless) {
        await targetPage.waitForTimeout(3000);
      }

      return result;
    } catch (err) {
      this.log(`Error during auto-apply execution: ${err.message}`);
      this.emitEvent({
        type: 'APPLY_ERROR',
        jobId: job.id,
        error: err.message
      });
      return { success: false, error: err.message };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /**
   * Clicks the initial "Easy Apply" / "Apply" button on live job pages using human-like visual movement
   */
  async triggerLiveApplyButton(page, portal) {
    this.log(`Detecting live application trigger button for ${portal}...`);
    try {
      const applySelectors = [
        // LinkedIn
        '.jobs-apply-button',
        'button:has-text("Easy Apply")',
        'button.jobs-apply-button--top-card',
        'button:has-text("Apply on company website")',
        'a:has-text("Apply on company website")',
        // Naukri
        '.apply-button',
        '#apply-button',
        'button:has-text("Apply")',
        'a:has-text("Apply on company site")',
        'button:has-text("Apply on company site")',
        'a:has-text("Apply on Company Website")',
        'button:has-text("Apply on Company Website")',
        // Indeed
        '#indeedApplyButton',
        'button:has-text("Apply now")',
        '.ia-ApplyButton',
        'a:has-text("Apply on employer site")',
        'button:has-text("Apply on employer site")',
        // Generic & External Company Sites (e.g. Accelaronix, Lever, Greenhouse)
        'a:has-text("Apply for this role")',
        'button:has-text("Apply for this role")',
        'a:has-text("Apply for role")',
        'button:has-text("Apply for role")',
        'button:has-text("Apply for this job")',
        'a:has-text("Apply for this job")',
        'button:has-text("Apply Now")',
        'a:has-text("Apply Now")',
        'button:has-text("Apply Online")',
        'a:has-text("Apply Online")',
        'a:has-text("Apply")'
      ];

      for (const sel of applySelectors) {
        const btn = await page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          this.log(`Found trigger button: "${sel}". Moving cursor and clicking...`);
          await HumanBrowser.humanClick(page, btn, '🎯 Clicking "Apply" Button...');
          await page.waitForTimeout(2500);
          return true;
        }
      }
      this.log(`No initial trigger button matched. Checking page directly...`);
      return false;
    } catch (err) {
      this.log(`Live button click note: ${err.message}`);
      return false;
    }
  }
}

module.exports = AutoApplier;
