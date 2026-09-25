const fs = require('fs');
const path = require('path');
require('dotenv').config();

class QuestionSolver {
  constructor(options = {}) {
    this.profilePath = options.profilePath || path.join(__dirname, '..', 'config', 'user_profile.json');
    this.userProfile = this.loadProfile();
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = options.model || (this.userProfile.settings && this.userProfile.settings.preferredModel) || 'gemini-3.6-flash';
    this.confidenceThreshold = options.confidenceThreshold || (this.userProfile.settings && this.userProfile.settings.confidenceThreshold) || 85;
    this.onLog = options.onLog || ((msg) => console.log(`[QuestionSolver] ${msg}`));
  }

  loadProfile() {
    try {
      if (fs.existsSync(this.profilePath)) {
        const data = fs.readFileSync(this.profilePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('Failed to load user profile:', err.message);
    }
    return {
      personal: {},
      career: {},
      skills: {},
      standardAnswers: {},
      settings: { dryRun: true, confidenceThreshold: 85 }
    };
  }

  reloadProfile() {
    this.userProfile = this.loadProfile();
  }

  /**
   * Core Prompt Builder adhering strictly to instructions:
   * "Match the recruiter question strictly against the user's profile. Return the exact value to type or the exact option label to select. If uncertain about numbers (e.g., CTC), use profile fallback. Keep numeric inputs clean."
   */
  buildPrompt(questionText, options = [], inputType = 'text', fieldMetadata = {}) {
    const profileJson = JSON.stringify(this.userProfile, null, 2);
    const optionsStr = options && options.length > 0
      ? `Available Options / Choices: ${JSON.stringify(options)}`
      : 'No predefined choices. Requires direct typed input.';

    return `You are an automated Job Application Questionnaire Solver.
Your goal is to answer recruiter screening questions, form fields, and chatbot prompts on behalf of the job applicant based STRICTLY on their Master User Profile.

=== MASTER USER PROFILE ===
${profileJson}

=== QUESTION CONTEXT ===
Recruiter Question: "${questionText}"
Expected Field Type: ${inputType}
${optionsStr}
Field Hints / Placeholder: ${JSON.stringify(fieldMetadata)}

=== INSTRUCTIONS & RULES ===
1. Match the recruiter question strictly against the user's profile.
2. Return the exact value to type or the exact option label to select.
3. If uncertain about numbers (e.g., CTC, experience years, notice period), use profile fallback.
4. Keep numeric inputs clean. For example:
   - If asked for years of experience and field is numeric, output "4" (NOT "4 years").
   - If asked for Current CTC in LPA / Lakhs, output "18" (or exact numeric expectation).
   - If asked Notice Period in days, output "30" (NOT "30 days").
5. For options (dropdown select, radio group, or quick-reply chip buttons):
   - You MUST pick the option label from the provided choices that best represents the profile answer.
   - Set "selectedOption" to the exact string matching one of the choices.
6. Specific Guidelines for Common Recruiter Prompts:
   - "Tell Us About Yourself" / "About You" / Introduction / Summary / Cover Letter:
     * Provide a polished, professional 2-3 sentence summary of Shreyas Jadhav's background: 3.5+ years experience delivering 50+ websites with WordPress, WooCommerce, custom Liquid themes, and PHP plugins.
     * NEVER output phone numbers or contact details in an introduction or essay field.
   - "Link Your Resume" / "Resume Link" / "Resume URL" / Portfolio / Website:
     * Output the candidate's verified URL: "https://www.linkedin.com/in/shreyas-jadhav" or "https://digidaftar.com".
     * NEVER output evasive text like "Please refer to my attached resume".
   - "Rate / Salary" / "Hourly Rate" / "Compensation":
     * Output "5,00,000 INR per year (or ₹40,000 INR / month)" or "5 LPA INR".
   - "Hours available" / "Availability":
     * Output "40 hours/week (Full Time)" or select full-time availability.
7. Calculate your confidence score (0 to 100).
8. If confidence is below 85% or if this is an open-ended essay question without an answer in the profile, set "requires_manual_review" to true.

Respond ONLY with a valid JSON object in this exact schema (no markdown fencing, no extraneous commentary):
{
  "answer": "string containing clean typed answer or option value",
  "selectedOption": "string matching choice label, or null if typed",
  "confidence": 95,
  "reasoning": "brief explanation referencing profile",
  "requires_manual_review": false
}`;
  }

  /**
   * Solves a question using LLM (Gemini) with fallback to deterministic heuristic matcher.
   */
  async solveQuestion(questionText, options = [], inputType = 'text', fieldMetadata = {}) {
    this.reloadProfile();
    const prompt = this.buildPrompt(questionText, options, inputType, fieldMetadata);

    let result = null;

    // 1. Try Gemini LLM if API Key is available
    if (this.apiKey && this.apiKey.trim().length > 0) {
      try {
        result = await this.callGemini(prompt);
      } catch (geminiErr) {
        this.onLog(`Gemini API call failed (${geminiErr.message}). Switching to heuristic solver.`);
      }
    }

    // 2. Fallback to Local Deterministic Semantic Heuristic only if no result or answer is undefined/null
    if (!result || (result.answer === undefined || result.answer === null)) {
      result = this.solveHeuristic(questionText, options, inputType, fieldMetadata);
    }

    // 3. Apply Confidence & Safety Safeguards
    if (result.confidence < this.confidenceThreshold) {
      result.requires_manual_review = true;
    }

    return result;
  }

  /**
   * Calls Google Gemini API
   */
  async callGemini(prompt) {
    const modelsToTry = Array.from(new Set([
      this.model,
      'gemini-3.5-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest'
    ])).filter(Boolean);
    let lastErr = null;

    for (const m of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${this.apiKey}`;
        const payload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) {
          const errBody = await res.text();
          if (res.status === 503 || res.status === 429) {
            await new Promise(r => setTimeout(r, 600));
          }
          throw new Error(`HTTP ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error('Empty response from Gemini');

        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        return {
          answer: String(parsed.answer ?? ''),
          selectedOption: parsed.selectedOption ?? null,
          confidence: Number(parsed.confidence ?? 95),
          reasoning: parsed.reasoning || `Gemini (${m}) inference`,
          requires_manual_review: Boolean(parsed.requires_manual_review)
        };
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('All Gemini model calls failed');
  }

  /**
   * Deterministic semantic matcher as fallback and instant offline solver.
   * Accurately parses questions regarding:
   * - CTC / Salary (Current & Expected)
   * - Experience years (Total or per technology like React, Node, TypeScript)
   * - Notice period in days
   * - Standard yes/no questions (Relocation, Sponsorship, Work authorization, Remote)
   * - Contact details (Phone, Email, Location)
   */
  solveHeuristic(questionText, options = [], inputType = 'text', fieldMetadata = {}) {
    const q = (questionText || '').toLowerCase();
    const p = this.userProfile;
    const std = p.standardAnswers || {};
    const career = p.career || {};
    const personal = p.personal || {};
    const skills = p.skills || {};

    let answer = '';
    let selectedOption = null;
    let confidence = 95;
    let reasoning = 'Matched from user profile';
    let requires_manual_review = false;

    // 1. Resume Link / Online Portfolio / Website URL
    if (q.includes('link') && (q.includes('resume') || q.includes('cv') || q.includes('profile') || q.includes('portfolio'))) {
      answer = personal.linkedInUrl || personal.portfolioUrl || 'https://www.linkedin.com/in/shreyas-jadhav';
      reasoning = 'Matched verified online resume / LinkedIn URL';
    } else if (q.includes('portfolio') || q.includes('website') || q.includes('github') || inputType === 'url') {
      answer = personal.portfolioUrl || 'https://digidaftar.com';
      reasoning = 'Matched portfolio website URL';
    }
    // 2. Tell Us About Yourself / Professional Introduction / Summary / Cover Letter / Any Textarea
    else if (
      q.includes('about yourself') ||
      q.includes('tell us') ||
      q.includes('introduce') ||
      q.includes('summary') ||
      q.includes('cover letter') ||
      q.includes('why should') ||
      q.includes('describe yourself') ||
      inputType === 'textarea'
    ) {
      answer = this.userProfile.documents?.coverLetter || 
        "Experienced Web Developer specializing in WordPress and Shopify with 3.5+ years of experience delivering 50+ high-performance client websites end-to-end. Specialized in custom Shopify Liquid themes, lightweight PHP templates, custom WordPress plugins (Revisit Plugin, Menu Manager), WooCommerce, REST APIs, and front-end speed optimization.";
      confidence = 90;
      reasoning = 'Generated tailored professional introduction from candidate profile';
    }
    // 3. Notice Period
    else if (q.includes('notice period') || q.includes('how soon can you join') || q.includes('serving notice')) {
      if (q.includes('serving')) {
        answer = career.servingNoticePeriod || 'No';
      } else {
        answer = String(career.noticePeriodDays || 30);
      }
      reasoning = `Profile notice period is ${answer}`;
    }
    // 4. Rate / Salary / Hourly Rate / CTC
    else if (q.includes('rate') || q.includes('salary') || q.includes('ctc') || q.includes('compensation') || q.includes('hourly')) {
      if (q.includes('current')) {
        answer = (inputType === 'number' || q.includes('lpa') || q.includes('in lakhs')) ? '4.2' : (career.currentCTC || '4,20,000 INR (4.2 LPA)');
      } else if (q.includes('hourly') || q.includes('rate')) {
        answer = '5,00,000 INR per year (or ₹40,000 INR / month)';
      } else {
        answer = (inputType === 'number' || q.includes('lpa') || q.includes('in lakhs')) ? '5' : (career.expectedCTC || '5,00,000 INR (5 LPA)');
      }
      reasoning = 'Matched compensation expectations from profile';
    }
    // 5. Working Hours / Availability
    else if (q.includes('hour') || q.includes('availab') || q.includes('per week') || q.includes('working hour')) {
      answer = '40 hours/week (Full Time)';
      reasoning = 'Full-time working availability';
    }
    // 6. Total Years of Experience
    else if ((q.includes('total') && (q.includes('experience') || q.includes('years'))) || q.includes('overall experience')) {
      answer = String(career.totalExperienceYears || 3.5);
      reasoning = `Total experience is ${answer} years`;
    }
    // 7. Skill-Specific Experience (WordPress, Shopify, Liquid, PHP, etc.)
    else if (q.includes('experience') || q.includes('how many years')) {
      let matchedSkill = null;
      for (const [skillName, years] of Object.entries(skills)) {
        const sLower = skillName.toLowerCase();
        if (q.includes(sLower) || (sLower === 'react' && q.includes('reactjs')) || (sLower === 'node.js' && (q.includes('nodejs') || q.includes('node')))) {
          matchedSkill = { name: skillName, years };
          break;
        }
      }
      if (matchedSkill) {
        answer = String(matchedSkill.years);
        reasoning = `Matched skill "${matchedSkill.name}" with ${matchedSkill.years} years experience`;
      } else {
        answer = String(career.totalExperienceYears || 3.5);
        confidence = 80;
        reasoning = 'Defaulted to general total experience';
      }
    }
    // 8. Work Authorization / Legal authorization
    else if (q.includes('authorized to work') || q.includes('legally authorized') || q.includes('work permit')) {
      answer = std.workAuthorization || 'Yes';
      reasoning = 'Standard work authorization answer';
    }
    // 9. Visa sponsorship
    else if (q.includes('sponsorship') || q.includes('visa')) {
      answer = std.requireVisaSponsorship || 'No';
      reasoning = 'Standard visa sponsorship answer';
    }
    // 10. Relocation
    else if (q.includes('relocate') || q.includes('relocation')) {
      answer = personal.willingToRelocate || std.willingToRelocate || 'Yes';
      reasoning = 'Standard relocation answer';
    }
    // 11. Remote / Hybrid / Onsite
    else if (q.includes('remote') || q.includes('hybrid') || q.includes('work from home')) {
      answer = std.comfortableWithHybrid || 'Yes';
      reasoning = 'Standard workplace preference';
    }
    // 12. Location / City
    else if (q.includes('current location') || q.includes('city') || q.includes('where are you located')) {
      answer = personal.currentLocation || 'Pune, Maharashtra, India';
      reasoning = 'Profile current location';
    }
    // 13. Phone / Mobile (Strict: NEVER for textareas, NEVER if question says 'tell us' or 'about')
    else if (inputType !== 'textarea' && !q.includes('about yourself') && !q.includes('tell us') && (q.includes('phone') || q.includes('mobile') || q.includes('contact number'))) {
      answer = personal.phone?.replace('+91', '').trim() || '9175068149';
      reasoning = 'Profile phone number';
    }
    // 14. Email
    else if (q.includes('email') && inputType !== 'textarea') {
      answer = personal.email || 'shreyasmjadhav23@gmail.com';
      reasoning = 'Profile email address';
    }
    // 15. Name
    else if (q.includes('full name') || q.includes('your name')) {
      answer = personal.fullName || 'Shreyas Jadhav';
      reasoning = 'Profile full name';
    }
    // 16. LinkedIn
    else if (q.includes('linkedin')) {
      answer = personal.linkedInUrl || 'https://www.linkedin.com/in/shreyas-jadhav';
      reasoning = 'Profile LinkedIn URL';
    }
    // 17. Education / Degree
    else if (q.includes('degree') || q.includes('education') || q.includes('highest qualification')) {
      answer = career.highestEducation || 'Bachelor of Engineering in Information Technology';
      reasoning = 'Profile education details';
    }
    // 18. Address Details (Unit/Suite, Zip/Postal, Street)
    else if (q.includes('unit') || q.includes('suite') || q.includes('apt') || q.includes('apartment') || q.includes('address line 2') || q.includes('address 2')) {
      answer = personal.unitSuite || '';
      reasoning = 'Profile unit / suite number (optional)';
    }
    else if (q.includes('zip') || q.includes('postal') || q.includes('pincode') || q.includes('pin code')) {
      answer = personal.postalCode || '411001';
      reasoning = 'Profile postal / zip code';
    }
    else if ((q.includes('street') || q.includes('address line 1') || q.includes('address 1')) && !q.includes('email')) {
      answer = personal.streetAddress || 'Pune, Maharashtra';
      reasoning = 'Profile street address';
    }
    // 19. Thoughtful fallback (Never biographical essays for short single-line fields)
    else {
      if (inputType === 'textarea' || q.includes('tell us') || q.includes('about') || q.includes('describe') || q.includes('summary')) {
        answer = "Experienced Web Developer with 3.5+ years of experience delivering 50+ websites with WordPress, WooCommerce, and Shopify.";
        confidence = 80;
        requires_manual_review = true;
        reasoning = 'General professional profile summary applied';
      } else {
        answer = "";
        confidence = 70;
        requires_manual_review = true;
        reasoning = 'Optional or unmapped single-line field left blank';
      }
    }

    // Match with available options if dropdown/radio/chip
    if (options && options.length > 0) {
      const match = this.matchOption(answer, options);
      if (match) {
        selectedOption = match;
        answer = match;
      } else {
        const best = options.find(o => {
          const oStr = String(o).toLowerCase();
          return oStr.includes('full') || oStr.includes('40') || oStr.includes('yes') || oStr.includes('immediate') || oStr.includes('developer');
        }) || options[0];
        selectedOption = best;
        answer = best;
      }
    }

    return {
      answer,
      selectedOption,
      confidence,
      reasoning,
      requires_manual_review
    };
  }

  /**
   * Matches an answer string against an array of options (strings or objects with label/value)
   */
  matchOption(targetAnswer, options = []) {
    if (!options || options.length === 0) return null;
    const target = String(targetAnswer).trim().toLowerCase();

    for (const opt of options) {
      const label = typeof opt === 'string' ? opt : (opt.label || opt.text || opt.value || '');
      const val = typeof opt === 'string' ? opt : (opt.value || '');
      const lLower = label.trim().toLowerCase();
      const vLower = String(val).trim().toLowerCase();

      // Exact match
      if (lLower === target || vLower === target) return label;

      // Yes / No boolean matches
      if (target === 'yes' && (lLower.startsWith('yes') || vLower === 'true' || vLower === '1')) return label;
      if (target === 'no' && (lLower.startsWith('no') || vLower === 'false' || vLower === '0')) return label;

      // Numeric matches (e.g. "4" matches "4-5 years" or "4 years")
      if (!isNaN(target) && (lLower.includes(target) || vLower.includes(target))) return label;
    }

    // Substring partial match
    for (const opt of options) {
      const label = typeof opt === 'string' ? opt : (opt.label || opt.text || opt.value || '');
      if (label.toLowerCase().includes(target) || target.includes(label.toLowerCase())) {
        return label;
      }
    }

    return null;
  }

  /**
   * Playwright Automation Action:
   * Inspects and fills any interactive element based on solver resolution.
   */
  async fillPlaywrightElement(page, locator, questionData, solution) {
    if (!locator) return { success: false, error: 'No locator provided' };

    const { answer, selectedOption, confidence, requires_manual_review } = solution;

    // Check if field requires manual review or low confidence
    if (requires_manual_review || confidence < this.confidenceThreshold) {
      await locator.evaluate((el) => {
        el.style.outline = '3px solid #f59e0b';
        el.style.boxShadow = '0 0 14px rgba(245, 158, 11, 0.6)';
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(() => {});

      this.onLog(`[HITL Alert] Field "${questionData.text}" requires manual verification (Confidence: ${confidence}%).`);
    }

    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
    const inputType = await locator.getAttribute('type').catch(() => 'text') || 'text';

    try {
      if (tagName === 'select') {
        // Select Dropdown
        const optToSelect = selectedOption || answer;
        await locator.selectOption({ label: optToSelect }).catch(async () => {
          await locator.selectOption({ value: optToSelect }).catch(async () => {
            // Fuzzy text match in options
            await locator.selectOption({ index: 1 });
          });
        });
        return { success: true, action: 'select', value: optToSelect };
      } else if (inputType === 'radio' || inputType === 'checkbox') {
        // Radio / Checkbox
        await locator.check({ force: true });
        return { success: true, action: 'check', value: answer };
      } else if (tagName === 'textarea' || ['text', 'number', 'tel', 'email', 'url', 'search'].includes(inputType)) {
        // Text / Number / Tel Input: simulate natural typing
        await locator.fill('');
        await locator.pressSequentially(String(answer), { delay: 35 });
        await locator.dispatchEvent('input');
        await locator.dispatchEvent('change');
        return { success: true, action: 'type', value: answer };
      } else {
        // Click action (e.g. Chatbot quick-reply chip button)
        await locator.click();
        return { success: true, action: 'click', value: answer };
      }
    } catch (err) {
      this.onLog(`Failed to fill element: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = QuestionSolver;
