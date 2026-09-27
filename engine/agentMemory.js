/**
 * Agent Brain & Persistent Memory Engine
 * 
 * Manages 4 memory tiers:
 * 1. Semantic Memory: Q&A Knowledge Bank with fuzzy matching & user verified overrides.
 * 2. Episodic Memory: Application History & Deduplication log.
 * 3. Procedural Memory: Site-specific strategies and layout quirks.
 * 4. Self-Learning Loop: Tracks confidence, usage count, and user revisions.
 */

const fs = require('fs');
const path = require('path');

class AgentMemory {
  constructor(options = {}) {
    this.memoryPath = options.memoryPath || path.resolve(process.cwd(), 'data', 'agent_memory.json');
    this.userProfilePath = options.userProfilePath || path.resolve(process.cwd(), 'config', 'user_profile.json');
    this.onLog = options.onLog || ((msg) => console.log(`[AgentMemory] ${msg}`));
    this.memory = this.loadMemory();
  }

  /**
   * Loads memory from disk or seeds a smart default memory bank.
   */
  loadMemory() {
    try {
      const dir = path.dirname(this.memoryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.memoryPath)) {
        const raw = fs.readFileSync(this.memoryPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.qaBank)) {
          return parsed;
        }
      }
    } catch (err) {
      this.onLog(`Warning loading memory: ${err.message}. Initializing fresh memory.`);
    }

    // Default Seed Memory
    const seed = this.createDefaultSeedMemory();
    this.persistMemory(seed);
    return seed;
  }

  /**
   * Persists memory state to JSON file safely.
   */
  persistMemory(data = this.memory) {
    try {
      const dir = path.dirname(this.memoryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.memoryPath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (err) {
      this.onLog(`Error saving memory: ${err.message}`);
      return false;
    }
  }

  /**
   * Creates initial knowledge bank seeded from the user's master profile.
   */
  createDefaultSeedMemory() {
    let profile = {};
    try {
      if (fs.existsSync(this.userProfilePath)) {
        profile = JSON.parse(fs.readFileSync(this.userProfilePath, 'utf8'));
      }
    } catch (e) {}

    const p = profile.personal || {};
    const c = profile.career || {};

    return {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      stats: {
        totalQueriesRecalled: 0,
        totalLearnedAnswers: 12
      },
      qaBank: [
        {
          id: 'qa-seed-1',
          question: 'Tell Us About Yourself',
          answer: profile.documents?.coverLetter || 'I am an experienced Web Developer with over 3.5 years of expertise specializing in WordPress, Shopify, PHP, and JavaScript. I have successfully delivered 50+ high-performance client websites end-to-end, focusing on custom Shopify Liquid themes, lightweight PHP templates, custom plugin development, and Core Web Vitals optimization.',
          confidence: 98,
          source: 'user_verified',
          verified: true,
          inputType: 'textarea',
          category: 'Introduction',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Curated professional introduction highlighting 3.5+ years experience and 50+ projects'
        },
        {
          id: 'qa-seed-2',
          question: 'Link Your Resume / Portfolio URL',
          answer: p.linkedInUrl || 'https://www.linkedin.com/in/shreyas-jadhav',
          confidence: 100,
          source: 'user_verified',
          verified: true,
          inputType: 'url',
          category: 'Links',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Verified online professional profile link'
        },
        {
          id: 'qa-seed-3',
          question: 'Portfolio / Website URL',
          answer: p.portfolioUrl || 'https://digidaftar.com',
          confidence: 100,
          source: 'user_verified',
          verified: true,
          inputType: 'url',
          category: 'Links',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Authentic digital portfolio URL'
        },
        {
          id: 'qa-seed-4',
          question: 'Rate / Salary / Expected CTC',
          answer: c.expectedCTC || '5,00,000 INR (5 LPA)',
          confidence: 95,
          source: 'user_verified',
          verified: true,
          inputType: 'text',
          category: 'Compensation',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Standard candidate expected compensation'
        },
        {
          id: 'qa-seed-5',
          question: 'Current CTC / Current Salary',
          answer: c.currentCTC || '4,20,000 INR (4.2 LPA)',
          confidence: 95,
          source: 'user_verified',
          verified: true,
          inputType: 'text',
          category: 'Compensation',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Current compensation from profile'
        },
        {
          id: 'qa-seed-6',
          question: 'Notice Period / How soon can you join',
          answer: String(c.noticePeriodDays || 30),
          confidence: 95,
          source: 'user_verified',
          verified: true,
          inputType: 'text',
          category: 'Availability',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Standard 30-day notice period'
        },
        {
          id: 'qa-seed-7',
          question: 'Hours You Are Available for Work Per Week',
          answer: '40 hours/week (Full Time)',
          selectedOption: '30-40',
          confidence: 95,
          source: 'user_verified',
          verified: true,
          inputType: 'select',
          category: 'Availability',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Full-time capacity commitment'
        },
        {
          id: 'qa-seed-8',
          question: 'Total Years of Experience',
          answer: String(c.totalExperienceYears || 3.5),
          confidence: 100,
          source: 'user_verified',
          verified: true,
          inputType: 'number',
          category: 'Experience',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: '3.5 years verified industry experience'
        },
        {
          id: 'qa-seed-9',
          question: 'Comfortable with Remote or Hybrid Work?',
          answer: 'Yes',
          confidence: 100,
          source: 'user_verified',
          verified: true,
          inputType: 'select',
          category: 'Preferences',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Comfortable with both remote and hybrid arrangements'
        },
        {
          id: 'qa-seed-10',
          question: 'Willing to Relocate?',
          answer: 'Yes',
          confidence: 100,
          source: 'user_verified',
          verified: true,
          inputType: 'select',
          category: 'Preferences',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Open to relocation for the right opportunity'
        },
        {
          id: 'qa-seed-11',
          question: 'Legally authorized to work in India without sponsorship?',
          answer: 'Yes',
          confidence: 100,
          source: 'user_verified',
          verified: true,
          inputType: 'select',
          category: 'Legal',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Citizen authorized to work in India'
        },
        {
          id: 'qa-seed-12',
          question: 'Unit / Suite / Apartment Number',
          answer: '',
          confidence: 90,
          source: 'user_verified',
          verified: true,
          inputType: 'text',
          category: 'Address',
          timesUsed: 1,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          reasoning: 'Optional secondary address field left cleanly blank'
        }
      ],
      applicationHistory: [],
      siteStrategies: {
        'newvariable.com': {
          domain: 'newvariable.com',
          formType: 'Gravity Forms',
          notes: 'Position is a radio group: pick Engineering. Unit/Suite is optional. Terms checkbox is required.',
          lastApplied: '2026-09-25T13:47:06.000Z'
        }
      },
      customFacts: [
        'Expert in WordPress custom plugins, hooks, WP REST API, and Child Theme architecture.',
        'Over 3 years building custom Shopify themes using Liquid, JSON templates, and App Embeds.',
        'Located in Pune, Maharashtra, India. Open to Bangalore, Mumbai, NCR or remote.'
      ]
    };
  }

  /**
   * Normalizes question text for robust semantic comparison.
   */
  normalizeQuestion(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[*\-_:?.,/\\()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Computes word token overlap similarity (Jaccard similarity).
   */
  calculateSimilarity(str1, str2) {
    const s1 = new Set(this.normalizeQuestion(str1).split(' ').filter(w => w.length > 2));
    const s2 = new Set(this.normalizeQuestion(str2).split(' ').filter(w => w.length > 2));
    if (s1.size === 0 || s2.size === 0) return 0;

    let intersection = 0;
    for (const word of s1) {
      if (s2.has(word)) intersection++;
    }
    const union = new Set([...s1, ...s2]).size;
    return intersection / union;
  }

  /**
   * Recalls an answer from memory if a close match exists.
   * User-verified answers take top priority.
   */
  recallAnswer(questionText, inputType = 'text', options = []) {
    const cleanQ = this.normalizeQuestion(questionText);
    if (!cleanQ) return null;

    let bestMatch = null;
    let highestScore = 0;

    for (const item of this.memory.qaBank) {
      const itemClean = this.normalizeQuestion(item.question);

      // 1. Exact match (case & punctuation insensitive)
      if (cleanQ === itemClean) {
        this.trackUsage(item);
        return {
          answer: item.answer,
          selectedOption: item.selectedOption || null,
          confidence: item.verified ? 100 : item.confidence,
          reasoning: `Recalled from Agent Memory [${item.source || 'ai'}]: "${item.question}"`,
          fromMemory: true,
          memoryId: item.id,
          verified: Boolean(item.verified)
        };
      }

      // 2. Specific strong keyword patterns
      const isIntroMatch = (cleanQ.includes('about yourself') || cleanQ.includes('tell us') || cleanQ.includes('introduce')) &&
        (itemClean.includes('about yourself') || itemClean.includes('tell us'));

      const isLinkMatch = (cleanQ.includes('link') && (cleanQ.includes('resume') || cleanQ.includes('cv'))) &&
        (itemClean.includes('link') && itemClean.includes('resume'));

      const isSalaryMatch = (cleanQ.includes('salary') || cleanQ.includes('ctc') || cleanQ.includes('rate')) &&
        (itemClean.includes('salary') || itemClean.includes('ctc') || itemClean.includes('rate')) &&
        !(cleanQ.includes('current') && !itemClean.includes('current')) &&
        !(cleanQ.includes('expected') && !itemClean.includes('expected'));

      const isNoticeMatch = (cleanQ.includes('notice') || cleanQ.includes('how soon')) &&
        (itemClean.includes('notice') || itemClean.includes('how soon'));

      const isHoursMatch = (cleanQ.includes('hours') || cleanQ.includes('available for work')) &&
        (itemClean.includes('hours') || itemClean.includes('available for work'));

      const isUnitSuite = (cleanQ.includes('unit') || cleanQ.includes('suite') || cleanQ.includes('apt') || cleanQ.includes('apartment')) &&
        (itemClean.includes('unit') || itemClean.includes('suite'));

      if (isIntroMatch || isLinkMatch || isSalaryMatch || isNoticeMatch || isHoursMatch || isUnitSuite) {
        this.trackUsage(item);
        return {
          answer: item.answer,
          selectedOption: item.selectedOption || null,
          confidence: item.verified ? 100 : item.confidence,
          reasoning: `Matched core semantic pattern in Agent Memory: "${item.question}"`,
          fromMemory: true,
          memoryId: item.id,
          verified: Boolean(item.verified)
        };
      }

      // 3. Token similarity calculation
      const score = this.calculateSimilarity(cleanQ, itemClean);
      // Give bonus to user_verified answers
      const weightedScore = item.verified ? score * 1.25 : score;

      if (weightedScore > highestScore) {
        highestScore = weightedScore;
        bestMatch = item;
      }
    }

    // High confidence fuzzy match (> 0.65 similarity)
    if (bestMatch && highestScore >= 0.65) {
      this.trackUsage(bestMatch);
      return {
        answer: bestMatch.answer,
        selectedOption: bestMatch.selectedOption || null,
        confidence: bestMatch.verified ? 100 : Math.round(highestScore * 100),
        reasoning: `Fuzzy recalled (${Math.round(highestScore * 100)}% match) from memory: "${bestMatch.question}"`,
        fromMemory: true,
        memoryId: bestMatch.id,
        verified: Boolean(bestMatch.verified)
      };
    }

    return null;
  }

  /**
   * Tracks usage count and updates lastUsed timestamp.
   */
  trackUsage(item) {
    item.timesUsed = (item.timesUsed || 0) + 1;
    item.lastUsed = new Date().toISOString();
    this.memory.stats.totalQueriesRecalled = (this.memory.stats.totalQueriesRecalled || 0) + 1;
    this.persistMemory();
  }

  /**
   * Saves a newly learned Q&A pair to memory.
   * If question already exists, updates it unless the existing one is user_verified.
   */
  rememberAnswer(questionText, answer, confidence = 90, source = 'ai', inputType = 'text', options = [], reasoning = '') {
    if (!questionText || answer === undefined || answer === null) return null;
    const cleanQ = this.normalizeQuestion(questionText);

    // Look for existing match
    const existing = this.memory.qaBank.find(item => this.normalizeQuestion(item.question) === cleanQ);

    if (existing) {
      // Don't overwrite human-verified answers with autonomous AI inference
      if (existing.verified && source !== 'user_verified') {
        this.trackUsage(existing);
        return existing;
      }

      existing.answer = answer;
      existing.confidence = confidence;
      existing.source = source;
      existing.verified = source === 'user_verified' || existing.verified;
      existing.lastUsed = new Date().toISOString();
      if (reasoning) existing.reasoning = reasoning;
      this.persistMemory();
      return existing;
    }

    const newId = `qa-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newItem = {
      id: newId,
      question: questionText.trim(),
      answer: String(answer),
      confidence: Number(confidence) || 90,
      source: source || 'ai',
      verified: source === 'user_verified',
      inputType: inputType || 'text',
      options: options || [],
      timesUsed: 1,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      reasoning: reasoning || 'Learned during autonomous application run'
    };

    this.memory.qaBank.unshift(newItem);
    this.memory.stats.totalLearnedAnswers = this.memory.qaBank.length;
    this.memory.lastUpdated = new Date().toISOString();
    this.persistMemory();
    this.onLog(`🧠 [NEW MEMORY COMMITTED] Learned answer for "${questionText}": "${answer.length > 50 ? answer.substring(0, 47) + '...' : answer}"`);
    return newItem;
  }

  /**
   * Update an existing memory entry (e.g. from user edit on Dashboard).
   */
  updateQA(id, fields = {}) {
    const item = this.memory.qaBank.find(q => q.id === id);
    if (!item) return null;

    if (fields.question !== undefined) item.question = fields.question.trim();
    if (fields.answer !== undefined) item.answer = String(fields.answer);
    if (fields.category !== undefined) item.category = fields.category;

    // Any manual edit automatically certifies the answer
    item.verified = true;
    item.source = 'user_verified';
    item.confidence = 100;
    item.lastModified = new Date().toISOString();

    this.memory.lastUpdated = new Date().toISOString();
    this.persistMemory();
    this.onLog(`✅ [MEMORY VERIFIED] User updated and verified Q&A #${id}: "${item.question}"`);
    return item;
  }

  /**
   * Delete a Q&A from memory.
   */
  deleteQA(id) {
    const idx = this.memory.qaBank.findIndex(q => q.id === id);
    if (idx === -1) return false;
    const removed = this.memory.qaBank.splice(idx, 1)[0];
    this.memory.stats.totalLearnedAnswers = this.memory.qaBank.length;
    this.persistMemory();
    this.onLog(`🗑️ [MEMORY DELETED] Removed Q&A "${removed.question}"`);
    return true;
  }

  /**
   * Add a custom Q&A item directly from the Dashboard.
   */
  addQA(question, answer, category = 'Custom') {
    return this.rememberAnswer(question, answer, 100, 'user_verified', 'text', [], `User created custom entry (${category})`);
  }

  /**
   * Episodic Memory: Records an application event.
   */
  recordApplication(jobData) {
    const entry = {
      id: `app-${Date.now()}`,
      company: jobData.company || 'Unknown Company',
      title: jobData.title || 'Role',
      portal: jobData.portal || 'Direct/External',
      url: jobData.applyUrl || jobData.url || '',
      status: jobData.status || 'Submitted',
      appliedAt: new Date().toISOString(),
      dryRun: Boolean(jobData.dryRun),
      fieldsCount: jobData.fieldsFilled ? Object.keys(jobData.fieldsFilled).length : 0
    };

    if (!Array.isArray(this.memory.applicationHistory)) {
      this.memory.applicationHistory = [];
    }

    this.memory.applicationHistory.unshift(entry);
    // Keep max 200 history entries
    if (this.memory.applicationHistory.length > 200) {
      this.memory.applicationHistory = this.memory.applicationHistory.slice(0, 200);
    }

    this.persistMemory();
    return entry;
  }

  /**
   * Checks if candidate applied to this URL or company recently (within 30 days).
   */
  hasAppliedRecently(urlOrCompany) {
    if (!urlOrCompany) return null;
    const target = urlOrCompany.toLowerCase().trim();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const match = (this.memory.applicationHistory || []).find(item => {
      const matchUrl = item.url && item.url.toLowerCase().includes(target);
      const matchComp = item.company && item.company.toLowerCase().includes(target);
      const isRecent = new Date(item.appliedAt).getTime() > thirtyDaysAgo;
      return (matchUrl || matchComp) && isRecent;
    });

    return match || null;
  }

  /**
   * Procedural Memory: Remembers site-specific quirks.
   */
  rememberSiteQuirk(domain, quirkData) {
    if (!domain) return;
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    if (!this.memory.siteStrategies) this.memory.siteStrategies = {};

    this.memory.siteStrategies[cleanDomain] = {
      domain: cleanDomain,
      ...quirkData,
      lastUpdated: new Date().toISOString()
    };
    this.persistMemory();
  }

  /**
   * Get all Q&A items with optional query search & category filtering.
   */
  getAllQA(query = '', filter = 'all') {
    let list = [...(this.memory.qaBank || [])];

    if (filter === 'verified') {
      list = list.filter(item => item.verified);
    } else if (filter === 'ai') {
      list = list.filter(item => !item.verified);
    } else if (filter === 'needs_review') {
      list = list.filter(item => item.confidence < 85 && !item.verified);
    }

    if (query && query.trim().length > 0) {
      const q = query.toLowerCase().trim();
      list = list.filter(item =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q))
      );
    }

    return list;
  }

  /**
   * Returns dashboard overview statistics.
   */
  getStats() {
    const bank = this.memory.qaBank || [];
    const verifiedCount = bank.filter(b => b.verified).length;
    const aiCount = bank.length - verifiedCount;
    const reviewCount = bank.filter(b => b.confidence < 85 && !b.verified).length;
    const history = this.memory.applicationHistory || [];

    return {
      totalQuestions: bank.length,
      verifiedCount,
      aiCount,
      reviewCount,
      totalApplications: history.length,
      totalRecalled: this.memory.stats?.totalQueriesRecalled || 0,
      lastUpdated: this.memory.lastUpdated
    };
  }
}

module.exports = AgentMemory;
