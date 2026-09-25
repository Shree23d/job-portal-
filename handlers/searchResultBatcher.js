/**
 * Search Result Page Batch Auto-Applier
 * Detects search result pages on Naukri, LinkedIn, and Indeed.
 * Extracts individual job posting links, iterates through them with application limits,
 * and routes external company redirects (e.g. Accelaronix, BlueBit) to AutonomousFormFiller.
 */

const AutonomousFormFiller = require('./autonomousFormFiller');
const NaukriChatbotHandler = require('./naukriChatbot');
const LinkedInEasyApplyHandler = require('./linkedinEasyApply');
const IndeedScreeningHandler = require('./indeedScreening');

class SearchResultBatcher {
  constructor(page, autoApplier, options = {}) {
    this.page = page;
    this.applier = autoApplier;
    this.solver = autoApplier.solver;
    this.dryRun = options.dryRun ?? true;
    this.maxApplications = options.maxApplications || options.maxJobsPerSearch || 3;
    this.onLog = options.onLog || ((msg) => console.log(`[SearchBatcher] ${msg}`));
    this.onEvent = options.onEvent || (() => {});
  }

  /**
   * Check if a given URL is a search results page
   */
  static isSearchUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return (
      u.includes('-jobs') ||
      u.includes('jobs/search') ||
      u.includes('/jobsearch') ||
      u.includes('?k=') ||
      u.includes('&k=') ||
      u.includes('/jobs?') ||
      u.includes('search?') ||
      u.includes('viewjob=false') ||
      (u.includes('indeed.com') && (u.includes('/jobs?') || u.includes('/q-')))
    );
  }

  /**
   * Main entrypoint to extract job cards from search result page and apply to each
   */
  async handleSearchPage(portal, userProfile) {
    // Read application limit from options or profile
    const profileLimit = userProfile?.settings?.maxApplicationsPerRun;
    if (profileLimit && !this.maxApplications) {
      this.maxApplications = profileLimit;
    }

    this.onLog(`Search results page detected for ${portal}. Application limit set to: ${this.maxApplications} jobs.`);
    this.onEvent({
      type: 'STATUS',
      message: `Scanning ${portal} search results (Limit: max ${this.maxApplications} applications)...`
    });

    // Dismiss any modal/banner if present
    const closeBtn = await this.page.locator('.crossIcon, .drawer-wrapper .close, [aria-label="Close"], .close, #deny').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click().catch(() => {});
    }

    // Scroll slightly to trigger dynamic render
    await this.page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await this.page.waitForTimeout(2000);

    let jobsToApply = [];

    if (portal.toLowerCase().includes('naukri')) {
      jobsToApply = await this.extractNaukriJobs();
    } else if (portal.toLowerCase().includes('linkedin')) {
      jobsToApply = await this.extractLinkedInJobs();
    } else if (portal.toLowerCase().includes('indeed')) {
      jobsToApply = await this.extractIndeedJobs();
    }

    if (jobsToApply.length === 0) {
      this.onLog('Could not find any job cards on the search results page.');
      return { success: false, reason: 'No job cards found on search page' };
    }

    this.onLog(`Found ${jobsToApply.length} jobs on search page. Will process up to limit of ${this.maxApplications}...`);
    this.onEvent({
      type: 'BATCH_FOUND',
      count: jobsToApply.length,
      limit: this.maxApplications,
      jobs: jobsToApply
    });

    let appliedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < jobsToApply.length; i++) {
      // Check user abort
      if (this.applier.isAborted) {
        this.onLog('🛑 [ABORT] Batch run halted by user.');
        break;
      }

      // Check application limit quota
      if (appliedCount >= this.maxApplications) {
        this.onLog(`🛑 [LIMIT REACHED] Application limit of ${this.maxApplications} reached! Stopping batch to save your applications.`);
        this.onEvent({
          type: 'LIMIT_REACHED',
          applied: appliedCount,
          limit: this.maxApplications,
          message: `Reached application limit of ${this.maxApplications} jobs.`
        });
        break;
      }

      const job = jobsToApply[i];
      const indexStr = `[${i + 1}/${jobsToApply.length} | Applied: ${appliedCount}/${this.maxApplications}]`;
      this.onLog(`${indexStr} Processing: "${job.title}" at "${job.company}"`);
      this.onEvent({
        type: 'BATCH_PROGRESS',
        current: i + 1,
        total: jobsToApply.length,
        applied: appliedCount,
        limit: this.maxApplications,
        job
      });

      try {
        // Navigate to individual job posting
        this.onLog(`${indexStr} Navigating to: ${job.applyUrl}`);
        await this.page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(2000);

        // Check if already applied
        const alreadyApplied = await this.page.locator('.already-applied, button:has-text("Already Applied")').first().isVisible().catch(() => false);
        if (alreadyApplied) {
          this.onLog(`${indexStr} Already applied to this job. Skipping.`);
          skippedCount++;
          continue;
        }

        // Trigger Live Apply Button on the job page with external redirect handling
        let res = null;
        if (portal.toLowerCase().includes('naukri')) {
          res = await this.applyNaukriJob(job);
        } else if (portal.toLowerCase().includes('linkedin')) {
          res = await this.applyLinkedInJob(job);
        } else {
          res = await this.applyIndeedJob(job);
        }

        if (res && (res.success || res.dryRunPaused)) {
          appliedCount++;
          this.onLog(`${indexStr} Successfully processed application for "${job.title}"! (Total applied: ${appliedCount}/${this.maxApplications})`);
        } else {
          skippedCount++;
        }

        // Pacing delay between jobs to stay safe
        this.onLog(`${indexStr} Waiting 3 seconds before next job...`);
        await this.page.waitForTimeout(3000);

      } catch (err) {
        this.onLog(`${indexStr} Error applying to ${job.title}: ${err.message}`);
        skippedCount++;
      }
    }

    this.onLog(`Search batch completed! Applied/Paused: ${appliedCount}, Skipped: ${skippedCount}, Limit: ${this.maxApplications}`);
    this.onEvent({
      type: 'BATCH_COMPLETED',
      applied: appliedCount,
      skipped: skippedCount,
      limit: this.maxApplications
    });

    return { success: true, appliedCount, skippedCount, total: jobsToApply.length };
  }

  /**
   * Extract jobs from Naukri search results page
   */
  async extractNaukriJobs() {
    const tupleSelectors = [
      '.srp-jobtuple-wrapper',
      '.cust-job-tuple',
      'article.jobTuple',
      'div[data-job-id]'
    ];

    let tuples = [];
    for (const sel of tupleSelectors) {
      const found = await this.page.locator(sel).all();
      if (found.length > 0) {
        tuples = found;
        break;
      }
    }

    const results = [];
    const limit = Math.min(tuples.length, 25);

    for (let i = 0; i < limit; i++) {
      const tuple = tuples[i];
      try {
        const titleEl = tuple.locator('a.title, a[class*="title"]').first();
        const title = (await titleEl.innerText({ timeout: 1500 }).catch(() => '')) || `Job #${i + 1}`;
        const href = await titleEl.getAttribute('href', { timeout: 1500 }).catch(() => null);

        const compEl = tuple.locator('a.comp-name, .company-name, [class*="comp-name"], a.subTitle, .subTitle').first();
        const company = (await compEl.innerText({ timeout: 1500 }).catch(() => '')) || 'Company';

        if (href) {
          const fullUrl = href.startsWith('http') ? href : `https://www.naukri.com${href}`;
          results.push({
            id: `naukri-job-${i + 1}`,
            title: title.trim(),
            company: company.trim(),
            portal: 'Naukri',
            applyUrl: fullUrl,
            applicationType: 'chatbot'
          });
        }
      } catch (e) {}
    }

    return results;
  }

  /**
   * Apply to single Naukri job posting with external redirect handling
   */
  async applyNaukriJob(job) {
    const applySelectors = [
      '#apply-button',
      '.apply-button',
      'button:has-text("Apply")',
      'a:has-text("Apply on company site")',
      'button:has-text("Apply on company site")',
      'button:has-text("Apply on Company Website")',
      'a:has-text("Apply on Company Website")'
    ];

    let applyBtn = null;
    for (const sel of applySelectors) {
      const btn = await this.page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        applyBtn = btn;
        break;
      }
    }

    if (!applyBtn) {
      this.onLog(`No direct apply button found on ${job.title}. Checking if already external.`);
      const externalFiller = new AutonomousFormFiller(this.page, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      return await externalFiller.handle();
    }

    this.onLog(`Clicking Apply button for: "${job.title}"...`);
    const context = this.page.context();
    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await applyBtn.click().catch(() => {});
    const newTab = await popupPromise;

    let targetPage = newTab || this.page;
    if (newTab) {
      this.onLog(`🌐 New tab opened for external application: ${newTab.url()}`);
      await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
    }

    const currentUrl = targetPage.url();
    const isExternal = targetPage !== this.page || (!currentUrl.includes('naukri.com') && !currentUrl.includes('localhost'));

    if (isExternal) {
      this.onLog(`🌐 External company application detected (${currentUrl}). Deploying Autonomous Tiny Brain form filler...`);
      const externalFiller = new AutonomousFormFiller(targetPage, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      const res = await externalFiller.handle();
      if (targetPage !== this.page) {
        await targetPage.close().catch(() => {});
      }
      return res;
    }

    // Try in-portal Naukri Chatbot
    const handler = new NaukriChatbotHandler(this.page, this.solver, {
      dryRun: this.dryRun,
      onLog: (msg) => this.onLog(msg),
      onEvent: (evt) => this.onEvent(evt)
    });

    const result = await handler.handle();
    if (!result || !result.success) {
      this.onLog(`Naukri chatbot not found. Checking for standard external form on page...`);
      const externalFiller = new AutonomousFormFiller(this.page, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      return await externalFiller.handle();
    }

    return result;
  }

  /**
   * Extract jobs from LinkedIn search results page
   */
  async extractLinkedInJobs() {
    const cards = await this.page.locator('.jobs-search-results__list-item, .job-card-container').all();
    const results = [];
    const limit = Math.min(cards.length, 25);

    for (let i = 0; i < limit; i++) {
      const card = cards[i];
      try {
        const titleLink = card.locator('a.job-card-list__title, a[href*="/jobs/view/"]').first();
        const title = await titleLink.innerText({ timeout: 1500 }).catch(() => `LinkedIn Job #${i + 1}`);
        const href = await titleLink.getAttribute('href', { timeout: 1500 }).catch(() => null);
        const compEl = card.locator('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle').first();
        const company = await compEl.innerText({ timeout: 1500 }).catch(() => 'LinkedIn Company');

        if (href) {
          const fullUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
          results.push({
            id: `linkedin-job-${i + 1}`,
            title: title.trim(),
            company: company.trim(),
            portal: 'LinkedIn',
            applyUrl: fullUrl,
            applicationType: 'easy_apply'
          });
        }
      } catch (e) {}
    }

    return results;
  }

  async applyLinkedInJob(job) {
    const applySelectors = [
      '.jobs-apply-button',
      'button:has-text("Easy Apply")',
      'button.jobs-apply-button--top-card',
      'button:has-text("Apply on company website")',
      'a:has-text("Apply on company website")'
    ];

    let applyBtn = null;
    for (const sel of applySelectors) {
      const btn = await this.page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        applyBtn = btn;
        break;
      }
    }

    if (!applyBtn) {
      this.onLog(`No apply button visible for "${job.title}".`);
      return { success: false, reason: 'No apply button found' };
    }

    this.onLog(`Clicking Apply for: "${job.title}"...`);
    const context = this.page.context();
    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await applyBtn.click().catch(() => {});
    const newTab = await popupPromise;

    let targetPage = newTab || this.page;
    if (newTab) {
      this.onLog(`🌐 LinkedIn redirected to company portal in new tab: ${newTab.url()}`);
      await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
    }

    const currentUrl = targetPage.url();
    const isExternal = targetPage !== this.page || (!currentUrl.includes('linkedin.com') && !currentUrl.includes('localhost'));

    if (isExternal) {
      this.onLog(`Deploying Autonomous Form Filler on external company site: ${currentUrl}...`);
      const externalFiller = new AutonomousFormFiller(targetPage, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      const res = await externalFiller.handle();
      if (targetPage !== this.page) await targetPage.close().catch(() => {});
      return res;
    }

    const handler = new LinkedInEasyApplyHandler(this.page, this.solver, {
      dryRun: this.dryRun,
      onLog: (msg) => this.onLog(msg),
      onEvent: (evt) => this.onEvent(evt)
    });

    return await handler.handle();
  }

  /**
   * Extract jobs from Indeed search results page
   */
  async extractIndeedJobs() {
    const links = await this.page.locator('a.jcs-JobTitle, .job_seen_beacon a[data-jk]').all();
    const results = [];
    const limit = Math.min(links.length, 25);

    for (let i = 0; i < limit; i++) {
      const a = links[i];
      try {
        const title = await a.innerText({ timeout: 1500 }).catch(() => `Indeed Job #${i + 1}`);
        const href = await a.getAttribute('href', { timeout: 1500 }).catch(() => null);
        if (href) {
          const fullUrl = href.startsWith('http') ? href : `https://in.indeed.com${href}`;
          results.push({
            id: `indeed-job-${i + 1}`,
            title: title.trim(),
            company: 'Indeed Employer',
            portal: 'Indeed',
            applyUrl: fullUrl,
            applicationType: 'screening_form'
          });
        }
      } catch (e) {}
    }

    return results;
  }

  async applyIndeedJob(job) {
    const applySelectors = [
      '#indeedApplyButton',
      'button:has-text("Apply now")',
      '.ia-ApplyButton',
      'a:has-text("Apply on company site")',
      'button:has-text("Apply on company site")',
      'a:has-text("Apply on employer site")',
      'button:has-text("Apply on employer site")'
    ];

    let indeedBtn = null;
    for (const sel of applySelectors) {
      const btn = await this.page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        indeedBtn = btn;
        break;
      }
    }

    if (!indeedBtn) {
      this.onLog(`No direct Indeed Apply button on "${job.title}". Checking external form...`);
      const externalFiller = new AutonomousFormFiller(this.page, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      return await externalFiller.handle();
    }

    this.onLog(`Clicking Indeed Apply for: "${job.title}"...`);
    const context = this.page.context();
    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await indeedBtn.click().catch(() => {});
    const newTab = await popupPromise;

    let targetPage = newTab || this.page;
    if (newTab) {
      this.onLog(`🌐 Indeed opened new tab: ${newTab.url()}`);
      await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
    }

    const currentUrl = targetPage.url();
    const isExternal = targetPage !== this.page || (!currentUrl.includes('indeed.com') && !currentUrl.includes('localhost'));

    if (isExternal) {
      this.onLog(`Deploying Autonomous Form Filler on external company site: ${currentUrl}...`);
      const externalFiller = new AutonomousFormFiller(targetPage, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      const res = await externalFiller.handle();
      if (targetPage !== this.page) await targetPage.close().catch(() => {});
      return res;
    }

    const handler = new IndeedScreeningHandler(targetPage, this.solver, {
      dryRun: this.dryRun,
      onLog: (msg) => this.onLog(msg),
      onEvent: (evt) => this.onEvent(evt)
    });

    const res = await handler.handle();
    if (!res || !res.success) {
      this.onLog(`Indeed screening container not found. Running Autonomous Form Filler on page...`);
      const externalFiller = new AutonomousFormFiller(targetPage, this.solver, {
        dryRun: this.dryRun,
        onLog: (msg) => this.onLog(msg),
        onEvent: (evt) => this.onEvent(evt)
      });
      return await externalFiller.handle();
    }

    return res;
  }
}

module.exports = SearchResultBatcher;
