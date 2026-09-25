/**
 * Universal Job Aggregator & AI Filter Agent Engine
 * Aggregates postings from LinkedIn, Naukri, and Indeed.
 * Computes AI Fit / Match Scores against User Master Profile.
 * Manages auto-apply queues and dispatching.
 */

const fs = require('fs');
const path = require('path');

class JobAggregator {
  constructor(options = {}) {
    this.profilePath = options.profilePath || path.join(__dirname, '..', 'config', 'user_profile.json');
    this.jobs = this.loadSeedJobs();
    this.applications = [];
  }

  loadProfile() {
    try {
      if (fs.existsSync(this.profilePath)) {
        return JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading profile:', e.message);
    }
    return {};
  }

  loadSeedJobs() {
    return [
      {
        id: 'job-naukri-101',
        title: 'Senior WordPress & WooCommerce Developer',
        company: 'WebCraft Interactive',
        portal: 'Naukri',
        location: 'Pune, Maharashtra / Hybrid',
        experienceRequired: '3-5 years',
        minExp: 3,
        maxExp: 5,
        salaryRange: '8 - 14 LPA',
        skills: ['WordPress', 'PHP', 'WooCommerce', 'JavaScript', 'Custom Themes & Child Themes', 'REST APIs'],
        applicationType: 'chatbot',
        postedDate: '1 day ago',
        description: 'Looking for a Senior WordPress Developer with deep experience in custom child themes, plugin development, and WooCommerce performance tuning.',
        applyUrl: '/simulator/naukri?jobId=job-naukri-101'
      },
      {
        id: 'job-linkedin-202',
        title: 'Shopify (Liquid) & E-Commerce Theme Developer',
        company: 'BrandSphere Commerce',
        portal: 'LinkedIn',
        location: 'Pune / Remote',
        experienceRequired: '2-5 years',
        minExp: 2,
        maxExp: 5,
        salaryRange: '9 - 15 LPA',
        skills: ['Shopify', 'Liquid', 'JavaScript', 'HTML5', 'CSS3', 'Payment Gateway (Razorpay/Stripe/PayPal)'],
        applicationType: 'easy_apply',
        postedDate: 'Just now',
        description: 'Seeking a skilled Shopify Liquid developer to create custom storefronts, interactive video reels, and high-converting checkout integrations.',
        applyUrl: '/simulator/linkedin?jobId=job-linkedin-202'
      },
      {
        id: 'job-indeed-303',
        title: 'Web Developer - Custom PHP & WordPress Plugins',
        company: 'NexTech Solutions',
        portal: 'Indeed',
        location: 'Pune, Maharashtra',
        experienceRequired: '3-6 years',
        minExp: 3,
        maxExp: 6,
        salaryRange: '8 - 13 LPA',
        skills: ['PHP', 'WordPress', 'Plugin Development', 'JavaScript', 'jQuery', 'REST APIs'],
        applicationType: 'screening_form',
        postedDate: '2 days ago',
        description: 'Join our digital agency engineering bespoke plugins, QR-code platforms, and high-performance client sites without bloated builders.',
        applyUrl: '/simulator/indeed?jobId=job-indeed-303'
      },
      {
        id: 'job-naukri-104',
        title: 'Frontend & CMS Developer (WordPress / Shopify)',
        company: 'Veloce Digital Labs',
        portal: 'Naukri',
        location: 'Pune / Remote',
        experienceRequired: '3-5 years',
        minExp: 3,
        maxExp: 5,
        salaryRange: '7 - 12 LPA',
        skills: ['HTML5', 'CSS3', 'JavaScript', 'WordPress', 'Shopify', 'Core Web Vitals & Speed Optimization'],
        applicationType: 'chatbot',
        postedDate: '3 days ago',
        description: 'Seeking a frontend developer proficient in Core Web Vitals optimization, custom animations, and responsive CMS builds.',
        applyUrl: '/simulator/naukri?jobId=job-naukri-104'
      },
      {
        id: 'job-linkedin-205',
        title: 'Lead Shopify & E-Commerce Engineer',
        company: 'OmniRetail Global',
        portal: 'LinkedIn',
        location: 'Mumbai / Pune (Remote Available)',
        experienceRequired: '3-6 years',
        minExp: 3,
        maxExp: 6,
        salaryRange: '10 - 16 LPA',
        skills: ['Shopify', 'Liquid', 'WooCommerce', 'JavaScript', 'Payment Gateway (Razorpay/Stripe/PayPal)', 'Rank Math SEO & GA4'],
        applicationType: 'easy_apply',
        postedDate: '4 hours ago',
        description: 'Architect scalable international storefronts with custom Liquid sections, smart AI chat agents, and high mobile speed scores.',
        applyUrl: '/simulator/linkedin?jobId=job-linkedin-205'
      },
      {
        id: 'job-indeed-306',
        title: 'Full-Stack WordPress Developer',
        company: 'Apex Media Works',
        portal: 'Indeed',
        location: 'Remote, India',
        experienceRequired: '2-4 years',
        minExp: 2,
        maxExp: 4,
        salaryRange: '7 - 11 LPA',
        skills: ['WordPress', 'PHP', 'Elementor Pro', 'Custom Themes & Child Themes', 'Hosting (cPanel, hPanel, AWS)'],
        applicationType: 'screening_form',
        postedDate: '1 day ago',
        description: 'Manage staging, hosting deployments on cPanel/AWS, speed audits, and end-to-end migrations for high-traffic brands.',
        applyUrl: '/simulator/indeed?jobId=job-indeed-306'
      },
      {
        id: 'job-external-404',
        title: 'Senior WordPress & Shopify Liquid Architect',
        company: 'Nexus Digital Systems',
        portal: 'Company ATS',
        location: 'Pune, Maharashtra / Remote',
        experienceRequired: '3-5 years',
        minExp: 3,
        maxExp: 5,
        salaryRange: '9 - 14 LPA',
        skills: ['WordPress', 'Shopify', 'Liquid', 'PHP', 'Plugin Development', 'Core Web Vitals & Speed Optimization'],
        applicationType: 'external_ats',
        postedDate: 'Just now',
        description: 'External company career application testing the Autonomous Tiny Brain, resume attachment, and question solver.',
        applyUrl: '/simulator/external?jobId=job-external-404'
      }
    ];
  }

  /**
   * Computes AI Fit Score (0 - 100%) against User Master Profile
   */
  calculateMatchScore(job, profile) {
    if (!profile || !profile.career) return 75;

    let score = 50; // Base score
    const userSkills = Object.keys(profile.skills || {}).map(s => s.toLowerCase());
    const userExp = profile.career.totalExperienceYears || 0;

    // 1. Skill overlap (up to +35 pts)
    const requiredSkills = (job.skills || []).map(s => s.toLowerCase());
    if (requiredSkills.length > 0) {
      let matchedCount = 0;
      for (const req of requiredSkills) {
        if (userSkills.some(us => us.includes(req) || req.includes(us))) {
          matchedCount++;
        }
      }
      const skillRatio = matchedCount / requiredSkills.length;
      score += Math.round(skillRatio * 35);
    }

    // 2. Experience range fit (up to +15 pts)
    if (userExp >= job.minExp && userExp <= job.maxExp + 2) {
      score += 15;
    } else if (userExp >= job.minExp - 1) {
      score += 8;
    }

    return Math.min(100, Math.max(20, score));
  }

  getJobs(filters = {}) {
    const profile = this.loadProfile();
    let list = this.jobs.map(job => {
      const matchScore = this.calculateMatchScore(job, profile);
      const app = this.applications.find(a => a.jobId === job.id);
      return {
        ...job,
        matchScore,
        status: app ? app.status : 'Not Applied',
        appliedAt: app ? app.appliedAt : null,
        dryRunPaused: app ? app.dryRunPaused : false
      };
    });

    if (filters.portal && filters.portal !== 'all') {
      list = list.filter(j => j.portal.toLowerCase() === filters.portal.toLowerCase());
    }

    if (filters.minScore) {
      list = list.filter(j => j.matchScore >= Number(filters.minScore));
    }

    if (filters.search) {
      const term = filters.search.toLowerCase();
      list = list.filter(j =>
        j.title.toLowerCase().includes(term) ||
        j.company.toLowerCase().includes(term) ||
        (j.skills && j.skills.some(s => s.toLowerCase().includes(term)))
      );
    }

    // Sort by match score descending
    return list.sort((a, b) => b.matchScore - a.matchScore);
  }

  recordApplication(jobId, status, details = {}) {
    const existing = this.applications.find(a => a.jobId === jobId);
    if (existing) {
      existing.status = status;
      existing.details = details;
      existing.updatedAt = new Date().toISOString();
      if (details.dryRunPaused) existing.dryRunPaused = true;
    } else {
      this.applications.push({
        jobId,
        status,
        details,
        dryRunPaused: details.dryRunPaused || false,
        appliedAt: new Date().toISOString()
      });
    }
  }
}

module.exports = JobAggregator;
