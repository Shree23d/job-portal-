const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const multer = require('multer');
require('dotenv').config();

const QuestionSolver = require('./engine/questionSolver');
const JobAggregator = require('./engine/aggregator');
const AutoApplier = require('./engine/autoApplier');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const profilePath = path.join(__dirname, 'config', 'user_profile.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/resumes', express.static(path.join(__dirname, 'resumes')));

// Multer storage for Resume PDF uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const resumesDir = path.join(__dirname, 'resumes');
    if (!fs.existsSync(resumesDir)) fs.mkdirSync(resumesDir, { recursive: true });
    cb(null, resumesDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Serve simulators
app.get('/simulator/naukri', (req, res) => {
  res.sendFile(path.join(__dirname, 'simulators', 'naukri.html'));
});
app.get('/simulator/linkedin', (req, res) => {
  res.sendFile(path.join(__dirname, 'simulators', 'linkedin.html'));
});
app.get('/simulator/indeed', (req, res) => {
  res.sendFile(path.join(__dirname, 'simulators', 'indeed.html'));
});
app.get('/simulator/external', (req, res) => {
  res.sendFile(path.join(__dirname, 'simulators', 'external_company.html'));
});

// Broadcast helper for WebSocket
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Instantiate core engines
const solver = new QuestionSolver({
  profilePath,
  apiKey: process.env.GEMINI_API_KEY,
  onLog: (msg) => broadcast({ type: 'LOG', message: msg, timestamp: new Date().toLocaleTimeString() })
});

const aggregator = new JobAggregator({ profilePath });

const autoApplier = new AutoApplier({
  solver,
  broadcast,
  baseUrl: `http://localhost:${PORT}`
});

// === API ROUTES ===

// 1. Get Master Profile
app.get('/api/profile', (req, res) => {
  try {
    if (fs.existsSync(profilePath)) {
      const data = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      return res.json(data);
    }
    return res.status(404).json({ error: 'Profile not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Save / Update Master Profile
app.post('/api/profile', (req, res) => {
  try {
    const updatedProfile = req.body;
    fs.writeFileSync(profilePath, JSON.stringify(updatedProfile, null, 2), 'utf8');
    solver.reloadProfile();
    broadcast({ type: 'PROFILE_UPDATED', profile: updatedProfile });
    return res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Resume File Upload
app.post('/api/resume/upload', upload.single('resume'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file received' });
    }

    const uploadedRelativePath = `./resumes/${req.file.filename}`;
    const targetOriginal = path.join(__dirname, 'resumes', 'original_resume.pdf');
    fs.copyFileSync(req.file.path, targetOriginal);

    // Also update config/user_profile.json defaultResumePath
    if (fs.existsSync(profilePath)) {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      if (!profile.documents) profile.documents = {};
      profile.documents.defaultResumePath = uploadedRelativePath;
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
      solver.reloadProfile();
    }

    broadcast({
      type: 'RESUME_UPDATED',
      filename: req.file.originalname,
      size: req.file.size
    });

    return res.json({
      success: true,
      message: 'Resume uploaded and set as active application file!',
      file: {
        originalName: req.file.originalname,
        storedName: req.file.filename,
        sizeKb: Math.round(req.file.size / 1024),
        path: uploadedRelativePath
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. Get Active Resume Information
app.get('/api/resume/info', (req, res) => {
  try {
    const candidates = [
      path.join(__dirname, 'orignal resume', 'Shreyas Jadhav resume.pdf'),
      path.join(__dirname, 'resumes', 'original_resume.pdf'),
      path.join(__dirname, 'resumes', 'shreyas_jadhav_resume.pdf')
    ];

    let foundFile = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        foundFile = c;
        break;
      }
    }

    if (!foundFile) {
      return res.json({ active: false, message: 'No resume file currently found' });
    }

    const stat = fs.statSync(foundFile);
    return res.json({
      active: true,
      filename: path.basename(foundFile),
      path: foundFile,
      sizeKb: Math.round(stat.size / 1024),
      lastModified: stat.mtime
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. Download / View Active Resume PDF
app.get('/api/resume/download', (req, res) => {
  try {
    const candidates = [
      path.join(__dirname, 'orignal resume', 'Shreyas Jadhav resume.pdf'),
      path.join(__dirname, 'resumes', 'original_resume.pdf'),
      path.join(__dirname, 'resumes', 'shreyas_jadhav_resume.pdf')
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        res.setHeader('Content-Type', 'application/pdf');
        return res.sendFile(c);
      }
    }
    return res.status(404).send('No resume PDF found');
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

// 6. Get Aggregated Jobs with AI Match Score
app.get('/api/jobs', (req, res) => {
  try {
    const { portal, minScore, search } = req.query;
    const jobs = aggregator.getJobs({ portal, minScore, search });
    return res.json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. Test Question Solver Sandbox (Direct LLM inference)
app.post('/api/solve', async (req, res) => {
  try {
    const { question, options, inputType } = req.body;
    if (!question) return res.status(400).json({ error: 'Question text is required' });

    const solution = await solver.solveQuestion(question, options || [], inputType || 'text');
    return res.json({ success: true, solution });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 8. Trigger Auto-Apply on a Job
app.post('/api/apply', async (req, res) => {
  const { jobId, dryRun, headless, maxApplications } = req.body;
  const profile = solver.loadProfile();
  const jobs = aggregator.getJobs();
  const job = jobs.find(j => j.id === jobId);

  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Asynchronously execute Playwright application
  res.json({ success: true, message: `Auto-apply started for ${job.title}`, jobId });

  aggregator.recordApplication(job.id, 'In Progress');
  const result = await autoApplier.applyToJob(job, profile, {
    dryRun: dryRun ?? profile.settings?.dryRun ?? true,
    maxApplications: maxApplications || profile.settings?.maxApplicationsPerRun || 3,
    headless: headless ?? false // Headed so user can watch cursor!
  });

  const finalStatus = (result && result.dryRunPaused)
    ? 'Paused (Dry Run)'
    : (result && result.success ? 'Submitted' : 'Failed');

  aggregator.recordApplication(job.id, finalStatus, result);
});

// 9. Direct Live Job URL Auto-Apply
app.post('/api/apply/live', async (req, res) => {
  const { url, portal, dryRun, headless, maxApplications } = req.body;
  if (!url) return res.status(400).json({ error: 'Job URL is required' });

  let cleanUrl = String(url).trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `https://${cleanUrl}`;
  }

  let detectedPortal = portal;
  if (!detectedPortal) {
    if (cleanUrl.includes('linkedin.com')) detectedPortal = 'LinkedIn';
    else if (cleanUrl.includes('naukri.com')) detectedPortal = 'Naukri';
    else if (cleanUrl.includes('indeed.com')) detectedPortal = 'Indeed';
    else detectedPortal = 'Generic';
  }

  const liveJob = {
    id: `live-${Date.now()}`,
    title: 'Live Job Posting',
    company: 'Live Recruiter',
    portal: detectedPortal,
    applyUrl: url,
    applicationType: detectedPortal === 'Naukri' ? 'chatbot' : (detectedPortal === 'LinkedIn' ? 'easy_apply' : 'screening_form')
  };

  res.json({ success: true, message: `Live auto-apply triggered for ${url}`, job: liveJob });

  const profile = solver.loadProfile();
  await autoApplier.applyToJob(liveJob, profile, {
    dryRun: dryRun ?? profile.settings?.dryRun ?? true,
    maxApplications: maxApplications || profile.settings?.maxApplicationsPerRun || 3,
    headless: headless ?? false, // Default to headed so user can watch!
    usePersistentSession: true
  });
});

// 10. Emergency Stop / Cancel Automation Run
app.post('/api/apply/stop', (req, res) => {
  autoApplier.stopCurrentRun();
  return res.json({ success: true, message: 'Automation run stopped successfully.' });
});

// 11. Launch Browser Session for Manual Portal Login
app.post('/api/browser/login', (req, res) => {
  const { portal } = req.body;
  try {
    autoApplier.openLoginSession(portal || 'linkedin').catch((err) => {
      console.warn(`[LoginSession note]: ${err.message}`);
    });
    res.json({ success: true, message: `Opened browser for ${portal || 'linkedin'} login` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Brain & Memory Management APIs ---

// 12. Get All Learned Questions & Answers
app.get('/api/memory/qa', (req, res) => {
  try {
    const { search, filter } = req.query;
    const items = solver.memory.getAllQA(search, filter);
    const stats = solver.memory.getStats();
    return res.json({ success: true, items, stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 13. Add Custom Question & Answer
app.post('/api/memory/qa', (req, res) => {
  try {
    const { question, answer, category } = req.body;
    if (!question || answer === undefined) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }
    const created = solver.memory.addQA(question, answer, category || 'Custom');
    return res.json({ success: true, item: created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 14. Update / Edit Question & Answer (Certifies as User-Verified)
app.put('/api/memory/qa/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category } = req.body;
    const updated = solver.memory.updateQA(id, { question, answer, category });
    if (!updated) return res.status(404).json({ error: 'Memory item not found' });
    return res.json({ success: true, item: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 15. Delete Q&A Memory Item
app.delete('/api/memory/qa/:id', (req, res) => {
  try {
    const { id } = req.params;
    const success = solver.memory.deleteQA(id);
    if (!success) return res.status(404).json({ error: 'Memory item not found' });
    return res.json({ success: true, message: 'Memory item deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 16. Get Episodic Memory (Application History)
app.get('/api/memory/history', (req, res) => {
  try {
    const history = solver.memory.memory.applicationHistory || [];
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 17. Get Brain Statistics
app.get('/api/memory/stats', (req, res) => {
  try {
    const stats = solver.memory.getStats();
    return res.json({ success: true, stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Process-level guards against unexpected browser disconnect crashes
process.on('uncaughtException', (err) => {
  console.warn('[Process Uncaught Warning]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Process Unhandled Warning]:', reason?.message || reason);
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    message: 'Connected to Universal Job Aggregator & Auto-Apply Telemetry stream'
  }));
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Universal Job Aggregator & AI Filter Agent running!`);
  console.log(`📡 Local Dashboard: http://localhost:${PORT}`);
  console.log(`🤖 Recruiter Chatbot Simulators:`);
  console.log(`   - Naukri Chatbot:   http://localhost:${PORT}/simulator/naukri`);
  console.log(`   - LinkedIn Modal:   http://localhost:${PORT}/simulator/linkedin`);
  console.log(`   - Indeed Screening: http://localhost:${PORT}/simulator/indeed`);
  console.log(`=======================================================`);
});
