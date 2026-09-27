# Autonomous Job Seeking & AI Auto-Apply Agent

An autonomous job application agent with a human-like visual browsing engine ("Tiny Brain"), screening questionnaire solver powered by Google Gemini, automated resume PDF attacher, and full support for external company ATS portals (Workday, Greenhouse, Lever, Gravity Forms, Contact Form 7).

---

## 🌟 Key Features

1. **Autonomous "Tiny Brain" Form Solver**:
   - Automatically navigates external company career pages and company website redirections.
   - Detects fields (text, email, tel, address, city, state, zip, radios, dropdowns, and checkboxes).
   - Solves complex recruiter screening and narrative questions ("Tell Us About Yourself", "Why should we hire you?") using Google Gemini.
   - Accurately links online resumes/LinkedIn URLs and enters CTC / notice period / availability.

2. **Human-Like Browsing**:
   - Animated visual cursor shows live thoughts and actions.
   - Smooth natural scrolling and realistic keyboard typing cadence to respect anti-bot protections.

3. **Master Resume Hub**:
   - In-dashboard drag-and-drop resume uploader.
   - Automatically attaches the authentic resume PDF to career site file dropzones.

4. **Safety Safeguards**:
   - **Dry-Run Review**: Pauses before final submission and highlights the submit button in green for human verification.
   - **Hard Application Quota**: Configurable limit per run (e.g., max 3 applications) to prevent wasted applications.
   - **Emergency Stop**: One-click killswitch halts active browser sessions immediately.

5. **Built-in Simulators**:
   - Practice and test against simulated Naukri Chatbots, LinkedIn Easy Apply modals, Indeed screening forms, and company ATS portals.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+)
- Playwright browsers: `npx playwright install chromium`

### 2. Installation
```bash
git clone <your-repo-url>
cd "job seeking"
npm install
```

### 3. Environment Configuration
Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```
Add your Google Gemini API key:
```env
GEMINI_API_KEY="your-gemini-api-key"
PORT=3000
DRY_RUN_DEFAULT=true
```

### 4. Running the Dashboard
```bash
npm start
```
Open **`http://localhost:3000`** in your browser.

---

## 🎯 How to Use

### Direct Live Application
1. Paste any job posting URL or job search result page into the top **"Direct Live Job Apply"** bar.
2. Set your desired application limit (e.g. `3`).
3. Click **"Start Live Apply"**.
4. Watch the agent navigate the page, fill the form, and pause for your review before final submission.

### Managing Your Profile & Resume
- **Resume Manager**: Upload or preview your PDF resume under the *Resume Manager* tab.
- **Candidate Profile**: Edit your skills, CTC expectations, and experience under *Safety & Profile*.
# job-portal
