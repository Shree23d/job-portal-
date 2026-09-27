/**
 * Universal Job Aggregator & Auto-Apply Agent Client App
 */

let currentProfile = null;
let allJobs = [];
let ws = null;
let audioContext = null;

// Initialize Web Audio API Chime Synth
function playAudioChime() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    // Gentle dual-tone attention chime
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880.00, now + 0.12); // A5

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch (e) {
    console.warn('Audio chime could not play:', e.message);
  }
}

// === DOM READY ===
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupWebSocket();
  loadProfile();
  loadJobs();
  loadResumeInfo();
  loadMemoryData();
  setupResumeUploader();
  setupEventListeners();
});

// Setup Navigation Tabs
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.classList.add('active');
      if (targetId === 'memoryTab') loadMemoryData();
    });
  });
}

// Setup WebSocket for Live Telemetry
function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('wsIndicator').innerHTML = `
      <span class="pulse-ring"></span>
      <span>Connected</span>
    `;
    addConsoleLog('[SYSTEM] Connected to automation server telemetry stream.');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    document.getElementById('wsIndicator').innerHTML = `
      <span style="width:8px; height:8px; background:#ef4444; border-radius:50%; display:inline-block;"></span>
      <span>Disconnected</span>
    `;
    setTimeout(setupWebSocket, 3000);
  };
}

// Handle real-time automation events
function handleServerEvent(evt) {
  if (evt.type === 'LOG') {
    addConsoleLog(`[${evt.timestamp || ''}] ${evt.message}`);
  } else if (evt.type === 'QUESTION_SOLVED') {
    renderQuestionTelemetry(evt);
  } else if (evt.type === 'HITL_CHIME') {
    triggerHITLAlert(evt.question, evt.confidence);
  } else if (evt.type === 'DRY_RUN_PAUSE') {
    addConsoleLog(`[PAUSED] ${evt.message}`, 'warning');
    showNotification(`Dry-Run Safeguard: ${evt.message}`, 'warning');
  } else if (evt.type === 'APPLY_COMPLETED') {
    addConsoleLog(`[SUCCESS] ${evt.message}`, 'success');
    showNotification(evt.message, 'success');
    loadJobs();
  } else if (evt.type === 'APPLY_STARTED') {
    document.getElementById('monitorActiveDot').classList.add('active');
    addConsoleLog(`[START] Applying to ${evt.job.title} at ${evt.job.company}...`, 'system');
  } else if (evt.type === 'BATCH_FOUND') {
    addConsoleLog(`[BATCH] Found ${evt.count} jobs on search page! Starting queue...`, 'system');
    showNotification(`Found ${evt.count} jobs on search results page! Starting auto-apply...`, 'info');
  } else if (evt.type === 'BATCH_PROGRESS') {
    addConsoleLog(`[BATCH ${evt.current}/${evt.total}] Opening: ${evt.job.title} (${evt.job.company})`, 'normal');
  } else if (evt.type === 'BATCH_COMPLETED') {
    addConsoleLog(`[BATCH DONE] Finished batch! Applied/Paused: ${evt.applied}, Skipped: ${evt.skipped}`, 'success');
    showNotification(`Search batch completed! Applied: ${evt.applied}, Skipped: ${evt.skipped}`, 'success');
  } else if (evt.type === 'LIMIT_REACHED') {
    addConsoleLog(`[LIMIT REACHED] 🛑 ${evt.message}`, 'warning');
    showNotification(`🛑 Application limit reached (${evt.applied}/${evt.limit} applied). Automation stopped.`, 'warning');
    document.getElementById('monitorActiveDot').classList.remove('active');
  } else if (evt.type === 'AWAIT_FORM_ASSISTANCE') {
    addConsoleLog(`[PAUSED] ⚠️ ${evt.message}`, 'warning');
    showNotification('⚠️ Action Needed: Please locate the form in the open Chrome tab!', 'warning');
    showFormAssistanceModal();
  } else if (evt.type === 'FORM_ASSISTANCE_RESUMED') {
    hideFormAssistanceModal();
    addConsoleLog(`[RESUMED] ✅ ${evt.message}`, 'success');
  } else if (evt.type === 'APPLY_STOPPED' || evt.type === 'APPLY_FAILED') {
    hideFormAssistanceModal();
  }
}

function showFormAssistanceModal() {
  const modal = document.getElementById('formAssistanceModalOverlay');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }
}

function hideFormAssistanceModal() {
  const modal = document.getElementById('formAssistanceModalOverlay');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

document.getElementById('resumeFormBtn')?.addEventListener('click', async () => {
  try {
    await fetch('/api/apply/resume-form', { method: 'POST' });
    hideFormAssistanceModal();
    showNotification('Resuming autonomous form filler...', 'info');
  } catch (e) {
    console.error('Failed to resume form assistance:', e);
  }
});

document.getElementById('skipFormBtn')?.addEventListener('click', async () => {
  try {
    await fetch('/api/apply/skip-form', { method: 'POST' });
    hideFormAssistanceModal();
    showNotification('Skipped current job.', 'info');
  } catch (e) {
    console.error('Failed to skip form assistance:', e);
  }
});

function addConsoleLog(text, level = 'normal') {
  const consoleEl = document.getElementById('logsConsole');
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerText = text;
  consoleEl.appendChild(entry);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function renderQuestionTelemetry(item) {
  const stream = document.getElementById('questionsStream');
  const empty = stream.querySelector('.empty-state');
  if (empty) empty.remove();

  const isLowConfidence = item.confidence < 85 || item.requires_manual_review;
  const card = document.createElement('div');
  card.className = `question-card-live ${isLowConfidence ? 'hitl-highlight' : ''}`;

  card.innerHTML = `
    <div class="question-card-header">
      <span class="q-text">${escapeHtml(item.question || 'Form Field')}</span>
      <span class="confidence-pill ${isLowConfidence ? 'low' : ''}">
        ${item.confidence}% Confidence
      </span>
    </div>
    <div class="solver-answer-box">
      <strong>Answer:</strong> ${escapeHtml(String(item.answer))}
    </div>
    ${isLowConfidence ? '<div style="color: #fbbf24; font-size: 11px; font-weight:600;">⚠️ Field highlighted for review / confirmation</div>' : ''}
  `;

  stream.insertBefore(card, stream.firstChild);
}

function triggerHITLAlert(question, confidence) {
  if (currentProfile?.settings?.audioChime !== false) {
    playAudioChime();
  }
  const modal = document.getElementById('hitlModalOverlay');
  document.getElementById('hitlQuestionText').innerText = `"${question}" (Confidence: ${confidence}%)`;
  modal.classList.add('active');
}

document.getElementById('hitlAcknowledgeBtn').addEventListener('click', () => {
  document.getElementById('hitlModalOverlay').classList.remove('active');
});

// Load and Render Jobs Feed
async function loadJobs() {
  try {
    const portal = document.getElementById('portalFilter').value;
    const minScore = document.getElementById('minScoreSlider').value;
    const search = document.getElementById('jobSearchInput').value;

    const res = await fetch(`/api/jobs?portal=${portal}&minScore=${minScore}&search=${encodeURIComponent(search)}`);
    const data = await res.json();
    if (data.success) {
      allJobs = data.jobs;
      renderJobs(allJobs);
      document.getElementById('jobCountBadge').innerText = data.jobs.length;
    }
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

function renderJobs(jobs) {
  const container = document.getElementById('jobsContainer');
  if (jobs.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No matching jobs found with current filters.</div>';
    return;
  }

  container.innerHTML = jobs.map(job => {
    const portalClass = job.portal.toLowerCase();
    const isHighMatch = job.matchScore >= 80;
    const isApplied = job.status === 'Submitted';
    const isPaused = job.dryRunPaused || job.status.includes('Paused');

    return `
      <div class="job-card glass-card" id="card-${job.id}">
        <div>
          <div class="job-card-header">
            <div>
              <h3 class="job-card-title">${escapeHtml(job.title)}</h3>
              <p class="job-card-company">${escapeHtml(job.company)}</p>
            </div>
            <div class="match-badge ${isHighMatch ? 'high' : ''}">
              ★ ${job.matchScore}% Match
            </div>
          </div>

          <div class="job-meta-row">
            <span class="job-meta-item">📍 ${escapeHtml(job.location)}</span>
            <span class="job-meta-item">⏱️ ${escapeHtml(job.experienceRequired)}</span>
            <span class="job-meta-item">💰 ${escapeHtml(job.salaryRange)}</span>
          </div>

          <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.4; margin-bottom: 12px;">
            ${escapeHtml(job.description)}
          </p>

          <div class="job-skills">
            ${(job.skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>

        <div class="job-card-footer">
          <span class="portal-tag ${portalClass}">${job.portal}</span>

          <div style="display: flex; gap: 8px; align-items: center;">
            ${isApplied ? `
              <span style="color: #10b981; font-weight: 700; font-size: 13px;">✓ Applied</span>
            ` : isPaused ? `
              <span style="color: #fbbf24; font-weight: 700; font-size: 13px;">⏸ Paused (Dry Run)</span>
              <button class="btn btn-sm btn-outline" onclick="triggerSimApply('${job.id}', false)">Final Submit</button>
            ` : `
              <button class="btn btn-sm btn-primary" onclick="triggerSimApply('${job.id}')">
                Auto-Apply
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Trigger Auto-Apply on a job
async function triggerSimApply(jobId, dryRun = null) {
  const dryRunSetting = dryRun !== null ? dryRun : (currentProfile?.settings?.dryRun ?? true);
  const maxLimit = Number(document.getElementById('headerApplyLimitInput')?.value) || currentProfile?.settings?.maxApplicationsPerRun || 3;

  // Switch to monitor tab so user can watch the stream
  document.querySelector('[data-tab="monitorTab"]').click();

  addConsoleLog(`[ACTION] Initiating auto-apply for job: ${jobId} (Dry Run: ${dryRunSetting}, Max Limit: ${maxLimit})`);

  try {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        dryRun: dryRunSetting,
        headless: true,
        maxApplications: maxLimit
      })
    });
    const result = await res.json();
    if (!result.success) {
      addConsoleLog(`Failed to start apply: ${result.error}`, 'error');
    }
  } catch (err) {
    addConsoleLog(`Error: ${err.message}`, 'error');
  }
}

// Trigger Live Job URL Apply
async function triggerLiveApply() {
  const url = document.getElementById('liveJobUrlInput').value.trim();
  if (!url) {
    alert('Please paste a valid live job URL from LinkedIn, Naukri, or Indeed.');
    return;
  }

  const dryRunSetting = currentProfile?.settings?.dryRun ?? true;
  const maxLimit = Number(document.getElementById('liveJobLimitInput')?.value) || Number(document.getElementById('headerApplyLimitInput')?.value) || currentProfile?.settings?.maxApplicationsPerRun || 3;

  document.querySelector('[data-tab="monitorTab"]').click();

  addConsoleLog(`[LIVE APPLY] Launching live automation session for: ${url} (Dry Run: ${dryRunSetting}, Limit: ${maxLimit} jobs)`);

  try {
    const res = await fetch('/api/apply/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        dryRun: dryRunSetting,
        headless: false, // Run headed so Shreyas can watch the live browser!
        maxApplications: maxLimit
      })
    });
    const result = await res.json();
    if (result.success) {
      showNotification(`Live apply session started with max limit of ${maxLimit} applications!`, 'success');
    } else {
      addConsoleLog(`Live apply error: ${result.error}`, 'error');
    }
  } catch (err) {
    addConsoleLog(`Error starting live apply: ${err.message}`, 'error');
  }
}

// Open Headed Browser for Manual Portal Login
async function openLoginBrowser(portal) {
  addConsoleLog(`[LOGIN] Opening browser for ${portal} login session...`);
  showNotification(`Opening browser for ${portal} login. Log in and close when done!`, 'info');

  try {
    await fetch('/api/browser/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portal })
    });
  } catch (err) {
    console.error('Login session error:', err);
  }
}

// Load Candidate Profile into Form
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    currentProfile = await res.json();
    populateProfileForm(currentProfile);
    updateSafetyBadge();
  } catch (err) {
    console.error('Error fetching profile:', err);
  }
}

function populateProfileForm(p) {
  if (!p) return;
  const pers = p.personal || {};
  const car = p.career || {};
  const std = p.standardAnswers || {};
  const doc = p.documents || {};
  const set = p.settings || {};

  document.getElementById('profFullName').value = pers.fullName || '';
  document.getElementById('profEmail').value = pers.email || '';
  document.getElementById('profPhone').value = pers.phone || '';
  document.getElementById('profLocation').value = pers.currentLocation || '';

  document.getElementById('profTotalExp').value = car.totalExperienceYears || 5;
  document.getElementById('profCurrentRole').value = car.currentRole || '';
  document.getElementById('profNoticeDays').value = car.noticePeriodDays || 30;
  document.getElementById('profCurrentCTC').value = car.currentCTC || '';
  document.getElementById('profExpectedCTC').value = car.expectedCTC || '';
  document.getElementById('profServingNotice').value = car.servingNoticePeriod || 'No';

  document.getElementById('stdWorkAuth').value = std.workAuthorization || 'Yes';
  document.getElementById('stdVisa').value = std.requireVisaSponsorship || 'No';
  document.getElementById('stdHybrid').value = std.comfortableWithHybrid || 'Yes';
  document.getElementById('stdRelocate').value = std.willingToRelocate || 'Yes';

  document.getElementById('profResumePath').value = doc.defaultResumePath || './resumes/default_resume.pdf';
  document.getElementById('profModel').value = set.preferredModel || 'gemini-1.5-flash';
  document.getElementById('profConfidence').value = set.confidenceThreshold || 85;
  document.getElementById('profDryRun').checked = set.dryRun !== false;
  document.getElementById('profAudioChime').checked = set.audioChime !== false;
  
  const limit = set.maxApplicationsPerRun || 3;
  if (document.getElementById('profMaxApplications')) {
    document.getElementById('profMaxApplications').value = limit;
  }
  if (document.getElementById('headerApplyLimitInput')) {
    document.getElementById('headerApplyLimitInput').value = limit;
  }
  if (document.getElementById('liveJobLimitInput')) {
    document.getElementById('liveJobLimitInput').value = limit;
  }

  renderSkillsMatrix(p.skills || {});
}

function renderSkillsMatrix(skills) {
  const container = document.getElementById('skillsMatrixContainer');
  container.innerHTML = Object.entries(skills).map(([skill, yrs]) => `
    <div class="skill-row">
      <span>${escapeHtml(skill)}</span>
      <div style="display:flex; align-items:center; gap:6px;">
        <input type="number" min="0" max="30" value="${yrs}" data-skill="${escapeHtml(skill)}" class="skill-yrs-input">
        <span style="font-size: 11px; color: var(--text-muted);">yrs</span>
        <button type="button" style="background:transparent; border:none; color:#ef4444; cursor:pointer;" onclick="removeSkill('${escapeHtml(skill)}')">×</button>
      </div>
    </div>
  `).join('');
}

function removeSkill(skillName) {
  if (currentProfile?.skills) {
    delete currentProfile.skills[skillName];
    renderSkillsMatrix(currentProfile.skills);
  }
}

// Save Profile
document.getElementById('saveProfileBtn').addEventListener('click', async (e) => {
  e.preventDefault();

  // Gather skills
  const skillsObj = {};
  document.querySelectorAll('.skill-yrs-input').forEach(inp => {
    const s = inp.getAttribute('data-skill');
    skillsObj[s] = Number(inp.value);
  });

  const updated = {
    personal: {
      fullName: document.getElementById('profFullName').value,
      email: document.getElementById('profEmail').value,
      phone: document.getElementById('profPhone').value,
      currentLocation: document.getElementById('profLocation').value,
      willingToRelocate: document.getElementById('stdRelocate').value,
      linkedInUrl: currentProfile?.personal?.linkedInUrl || '',
      portfolioUrl: currentProfile?.personal?.portfolioUrl || ''
    },
    career: {
      totalExperienceYears: Number(document.getElementById('profTotalExp').value),
      currentRole: document.getElementById('profCurrentRole').value,
      noticePeriodDays: Number(document.getElementById('profNoticeDays').value),
      currentCTC: document.getElementById('profCurrentCTC').value,
      expectedCTC: document.getElementById('profExpectedCTC').value,
      servingNoticePeriod: document.getElementById('profServingNotice').value,
      highestEducation: currentProfile?.career?.highestEducation || 'B.Tech in Computer Science'
    },
    skills: skillsObj,
    standardAnswers: {
      workAuthorization: document.getElementById('stdWorkAuth').value,
      requireVisaSponsorship: document.getElementById('stdVisa').value,
      comfortableWithHybrid: document.getElementById('stdHybrid').value,
      willingToRelocate: document.getElementById('stdRelocate').value
    },
    documents: {
      defaultResumePath: document.getElementById('profResumePath').value,
      coverLetter: currentProfile?.documents?.coverLetter || ''
    },
    settings: {
      dryRun: document.getElementById('profDryRun').checked,
      confidenceThreshold: Number(document.getElementById('profConfidence').value),
      audioChime: document.getElementById('profAudioChime').checked,
      preferredModel: document.getElementById('profModel').value,
      maxApplicationsPerRun: Number(document.getElementById('profMaxApplications')?.value || document.getElementById('headerApplyLimitInput')?.value || 3)
    }
  };

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    const data = await res.json();
    if (data.success) {
      currentProfile = updated;
      updateSafetyBadge();
      showNotification('Profile updated successfully!', 'success');
      loadJobs(); // recompute AI fit scores
    }
  } catch (err) {
    showNotification(`Error saving profile: ${err.message}`, 'error');
  }
});

// Add new skill to matrix
document.getElementById('addSkillBtn').addEventListener('click', () => {
  const name = document.getElementById('newSkillName').value.trim();
  const yrs = Number(document.getElementById('newSkillYears').value || 1);
  if (name) {
    if (!currentProfile.skills) currentProfile.skills = {};
    currentProfile.skills[name] = yrs;
    renderSkillsMatrix(currentProfile.skills);
    document.getElementById('newSkillName').value = '';
    document.getElementById('newSkillYears').value = '';
  }
});

// Sandbox Question Solver
document.getElementById('runSandboxSolveBtn').addEventListener('click', async () => {
  const question = document.getElementById('sandboxQuestion').value.trim();
  const optionsRaw = document.getElementById('sandboxOptions').value.trim();
  const inputType = document.getElementById('sandboxInputType').value;
  const options = optionsRaw ? optionsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (!question) return;

  const btn = document.getElementById('runSandboxSolveBtn');
  btn.innerText = 'Analyzing with LLM...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, options, inputType })
    });
    const data = await res.json();

    if (data.success && data.solution) {
      const sol = data.solution;
      const resBox = document.getElementById('sandboxResultBox');
      resBox.style.display = 'block';

      document.getElementById('sandboxAnswerValue').innerText = sol.selectedOption || sol.answer;
      document.getElementById('sandboxConfidenceBadge').innerText = `${sol.confidence}% Confidence`;
      document.getElementById('sandboxReasoning').innerText = `Reasoning: ${sol.reasoning}`;

      const reviewNotice = document.getElementById('sandboxReviewNotice');
      if (sol.requires_manual_review || sol.confidence < 85) {
        reviewNotice.style.display = 'block';
        if (currentProfile?.settings?.audioChime !== false) playAudioChime();
      } else {
        reviewNotice.style.display = 'none';
      }
    }
  } catch (err) {
    alert('Solve error: ' + err.message);
  } finally {
    btn.innerText = 'Run LLM Solver';
    btn.disabled = false;
  }
});

function updateSafetyBadge() {
  const isDryRun = currentProfile?.settings?.dryRun !== false;
  const text = document.getElementById('safetyStatusText');
  const badge = document.getElementById('safetyBadge');

  if (isDryRun) {
    text.innerText = 'Dry-Run Safeguard: Active (Manual Submit)';
    badge.style.background = 'rgba(16, 185, 129, 0.1)';
    badge.style.color = '#34d399';
  } else {
    text.innerText = 'Live Auto-Submit: Armed (Direct Submit)';
    badge.style.background = 'rgba(239, 68, 68, 0.15)';
    badge.style.color = '#f87171';
  }
}

function setupEventListeners() {
  document.getElementById('portalFilter').addEventListener('change', loadJobs);
  document.getElementById('minScoreSlider').addEventListener('input', (e) => {
    document.getElementById('minScoreVal').innerText = `${e.target.value}%`;
    loadJobs();
  });
  document.getElementById('jobSearchInput').addEventListener('input', debounce(loadJobs, 250));
  document.getElementById('refreshJobsBtn').addEventListener('click', loadJobs);
  document.getElementById('triggerLiveApplyBtn').addEventListener('click', triggerLiveApply);
  document.getElementById('stopAutomationHeaderBtn').addEventListener('click', stopAutomation);
  document.getElementById('stopAutomationPanelBtn').addEventListener('click', stopAutomation);
  document.getElementById('clearLogsBtn').addEventListener('click', () => {
    document.getElementById('logsConsole').innerHTML = '';
  });

  // Sync Limit inputs
  const headerLimit = document.getElementById('headerApplyLimitInput');
  const liveLimit = document.getElementById('liveJobLimitInput');
  const profLimit = document.getElementById('profMaxApplications');
  
  if (headerLimit) {
    headerLimit.addEventListener('input', (e) => {
      if (liveLimit) liveLimit.value = e.target.value;
      if (profLimit) profLimit.value = e.target.value;
    });
  }
  if (liveLimit) {
    liveLimit.addEventListener('input', (e) => {
      if (headerLimit) headerLimit.value = e.target.value;
      if (profLimit) profLimit.value = e.target.value;
    });
  }
  if (profLimit) {
    profLimit.addEventListener('input', (e) => {
      if (headerLimit) headerLimit.value = e.target.value;
      if (liveLimit) liveLimit.value = e.target.value;
    });
  }
}

async function stopAutomation() {
  addConsoleLog('🛑 [USER ACTION] Sending stop signal...', 'warning');
  try {
    const res = await fetch('/api/apply/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification('Automation stopped.', 'warning');
      document.getElementById('monitorActiveDot').classList.remove('active');
    }
  } catch (err) {
    console.error('Stop error:', err);
  }
}

function showNotification(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.right = '24px';
  toast.style.background = type === 'success' ? '#065f46' : type === 'warning' ? '#78350f' : '#1e293b';
  toast.style.color = '#fff';
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '8px';
  toast.style.border = '1px solid rgba(255,255,255,0.1)';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.4)';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '14px';
  toast.style.fontWeight = '500';
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadResumeInfo() {
  try {
    const res = await fetch('/api/resume/info');
    const data = await res.json();
    if (data.active) {
      const nameEl = document.getElementById('activeResumeName');
      const detEl = document.getElementById('activeResumeDetails');
      if (nameEl) nameEl.innerText = data.filename;
      if (detEl) detEl.innerText = `Size: ${data.sizeKb} KB • Last Updated: ${new Date(data.lastModified).toLocaleDateString()} • Authentic Verified PDF`;
    }
  } catch (err) {
    console.warn('Could not load resume info:', err);
  }
}

function setupResumeUploader() {
  const dropzone = document.getElementById('resumeDropzone');
  const fileInput = document.getElementById('resumeFileInput');
  const feedback = document.getElementById('uploadFeedback');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  async function handleFileUpload(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && !file.name.toLowerCase().endsWith('.docx')) {
      showUploadFeedback('Please upload a PDF document (.pdf)', 'error');
      return;
    }

    showUploadFeedback(`Uploading ${file.name}...`, 'info');

    const formData = new FormData();
    formData.append('resume', file);

    try {
      const res = await fetch('/api/resume/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        showUploadFeedback(`✅ ${data.message} (${data.file.originalName})`, 'success');
        showNotification(`Resume updated: ${data.file.originalName}`, 'success');
        loadResumeInfo();
        loadProfile();
      } else {
        showUploadFeedback(`❌ Upload failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showUploadFeedback(`❌ Upload error: ${err.message}`, 'error');
    }
  }

  function showUploadFeedback(msg, type) {
    if (!feedback) return;
    feedback.style.display = 'block';
    feedback.innerText = msg;
    if (type === 'success') {
      feedback.style.background = 'rgba(16, 185, 129, 0.15)';
      feedback.style.border = '1px solid #10b981';
      feedback.style.color = '#34d399';
    } else if (type === 'error') {
      feedback.style.background = 'rgba(239, 68, 68, 0.15)';
      feedback.style.border = '1px solid #ef4444';
      feedback.style.color = '#f87171';
    } else {
      feedback.style.background = 'rgba(99, 102, 241, 0.15)';
      feedback.style.border = '1px solid #6366f1';
      feedback.style.color = '#a5b4fc';
    }
  }
}

// ======================================================================
// 🧠 AGENT BRAIN & LONG-TERM MEMORY CONTROLLER
// ======================================================================

let memoryItemsCache = [];
let currentMemoryFilter = 'all';
let currentMemorySearch = '';

async function loadMemoryData() {
  try {
    const params = new URLSearchParams();
    if (currentMemorySearch) params.append('search', currentMemorySearch);
    if (currentMemoryFilter !== 'all') params.append('filter', currentMemoryFilter);

    const res = await fetch(`/api/memory/qa?${params.toString()}`);
    const data = await res.json();

    if (data.success) {
      memoryItemsCache = data.items || [];
      renderMemoryCards(memoryItemsCache);
      renderMemoryStats(data.stats);
    }

    loadApplicationHistory();
  } catch (err) {
    console.error('Failed to load memory data:', err);
  }
}

function renderMemoryStats(stats) {
  if (!stats) return;
  const statTotal = document.getElementById('memStatTotal');
  const statVerified = document.getElementById('memStatVerified');
  const statAi = document.getElementById('memStatAi');
  const statRecalled = document.getElementById('memStatRecalled');
  const badge = document.getElementById('memoryCountBadge');

  if (statTotal) statTotal.innerText = stats.totalQuestions || 0;
  if (statVerified) statVerified.innerText = stats.verifiedCount || 0;
  if (statAi) statAi.innerText = stats.aiCount || 0;
  if (statRecalled) statRecalled.innerText = stats.totalRecalled || 0;
  if (badge) badge.innerText = stats.totalQuestions || 0;
}

function handleMemorySearch(query) {
  currentMemorySearch = query;
  loadMemoryData();
}

function handleMemoryFilter(filter) {
  currentMemoryFilter = filter;
  loadMemoryData();
}

function renderMemoryCards(items) {
  const container = document.getElementById('memoryQaContainer');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
        <div style="font-size: 32px; margin-bottom: 10px;">🔍</div>
        <h4 style="color: #fff; font-size: 15px; margin-bottom: 6px;">No Memories Match Your Filter</h4>
        <p style="font-size: 13px; margin: 0;">Try adjusting your search query or click "Teach New Question &amp; Answer" above.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => {
    const isVerified = item.verified;
    const badgeColor = isVerified ? '#34d399' : '#a78bfa';
    const badgeBg = isVerified ? 'rgba(16, 185, 129, 0.15)' : 'rgba(167, 139, 250, 0.15)';
    const badgeBorder = isVerified ? 'rgba(16, 185, 129, 0.35)' : 'rgba(167, 139, 250, 0.35)';
    const badgeText = isVerified ? '✅ User Verified (100%)' : '🤖 AI Autonomous';
    const timesUsed = item.timesUsed || 1;
    const category = item.category || 'General';

    return `
      <div class="glass-card memory-card" id="mem-card-${item.id}" style="padding: 18px 22px; border-left: 4px solid ${isVerified ? '#10b981' : '#6366f1'}; transition: all 0.2s ease;">
        <!-- Header row -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1; font-size: 11px;">📂 ${escapeHtml(category)}</span>
            <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-size: 11px; font-weight: 700;">${badgeText}</span>
            <span style="font-size: 11px; color: var(--text-muted);">Used ${timesUsed} ${timesUsed === 1 ? 'time' : 'times'}</span>
          </div>
          <div style="display: flex; gap: 6px;" class="card-actions">
            <button class="btn btn-sm btn-outline" onclick="startEditMemory('${item.id}')" title="Edit this answer" style="padding: 4px 10px; font-size: 12px;">✏️ Edit Answer</button>
            <button class="btn btn-sm btn-outline" onclick="deleteMemoryItem('${item.id}')" title="Delete from memory" style="padding: 4px 8px; font-size: 12px; color: #f87171; border-color: rgba(239, 68, 68, 0.3);">🗑️</button>
          </div>
        </div>

        <!-- Question Title -->
        <h4 style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 10px; line-height: 1.4;">
          ${escapeHtml(item.question)}
        </h4>

        <!-- Read-only Answer View -->
        <div id="view-ans-${item.id}" style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 16px; margin-bottom: 10px;">
          <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Recruiter Field Response:</div>
          <div style="font-size: 13.5px; color: #e2e8f0; line-height: 1.5; white-space: pre-wrap; font-family: ${item.answer.length < 50 && !item.answer.includes(' ') ? 'monospace' : 'inherit'};">
            ${item.answer === '' ? '<em style="color: var(--text-muted);">(Left empty for optional field)</em>' : escapeHtml(item.answer)}
          </div>
        </div>

        <!-- Inline Edit Form (Hidden by default) -->
        <div id="edit-form-${item.id}" style="display: none; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; padding: 14px; margin-bottom: 10px;">
          <label style="display: block; font-size: 12px; color: #38bdf8; font-weight: 600; margin-bottom: 6px;">Update Answer for this Question:</label>
          <textarea id="edit-input-${item.id}" rows="3" style="width: 100%; background: #0f172a; border: 1px solid var(--border-color); color: #fff; padding: 10px 12px; border-radius: 6px; font-size: 13px; resize: vertical; outline: none; margin-bottom: 10px;">${escapeHtml(item.answer)}</textarea>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn btn-sm btn-outline" onclick="cancelEditMemory('${item.id}')">Cancel</button>
            <button class="btn btn-sm btn-primary" onclick="saveEditMemory('${item.id}')">✅ Save &amp; Certify Answer</button>
          </div>
        </div>

        <!-- Footer meta & reasoning -->
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--text-muted); flex-wrap: wrap; gap: 8px;">
          <span>💡 <em>${escapeHtml(item.reasoning || 'Standard answer profile')}</em></span>
          <span>Last referenced: ${item.lastUsed ? new Date(item.lastUsed).toLocaleDateString() : 'Recently'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function startEditMemory(id) {
  const viewEl = document.getElementById(`view-ans-${id}`);
  const editEl = document.getElementById(`edit-form-${id}`);
  if (viewEl && editEl) {
    viewEl.style.display = 'none';
    editEl.style.display = 'block';
    const input = document.getElementById(`edit-input-${id}`);
    if (input) input.focus();
  }
}

function cancelEditMemory(id) {
  const viewEl = document.getElementById(`view-ans-${id}`);
  const editEl = document.getElementById(`edit-form-${id}`);
  if (viewEl && editEl) {
    viewEl.style.display = 'block';
    editEl.style.display = 'none';
  }
}

async function saveEditMemory(id) {
  const input = document.getElementById(`edit-input-${id}`);
  if (!input) return;
  const newAnswer = input.value;

  try {
    const res = await fetch(`/api/memory/qa/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: newAnswer })
    });
    const data = await res.json();
    if (data.success) {
      showNotification('Answer updated and verified! Agent will use this exact answer.', 'success');
      loadMemoryData();
    } else {
      showNotification(`Update failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function deleteMemoryItem(id) {
  if (!confirm('Are you sure you want to remove this learned answer from memory?')) return;
  try {
    const res = await fetch(`/api/memory/qa/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showNotification('Memory removed successfully.', 'info');
      loadMemoryData();
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

function openTeachMemoryModal() {
  const modal = document.getElementById('teachMemoryModal');
  if (modal) modal.style.display = 'flex';
}

function closeTeachMemoryModal() {
  const modal = document.getElementById('teachMemoryModal');
  if (modal) modal.style.display = 'none';
}

async function handleTeachMemorySubmit(e) {
  e.preventDefault();
  const qInput = document.getElementById('teachQuestionInput');
  const aInput = document.getElementById('teachAnswerInput');
  const catInput = document.getElementById('teachCategorySelect');

  if (!qInput || !aInput) return;

  try {
    const res = await fetch('/api/memory/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: qInput.value,
        answer: aInput.value,
        category: catInput?.value || 'Custom'
      })
    });
    const data = await res.json();
    if (data.success) {
      showNotification('New memory learned and committed to agent brain!', 'success');
      closeTeachMemoryModal();
      qInput.value = '';
      aInput.value = '';
      loadMemoryData();
    } else {
      showNotification(`Failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function loadApplicationHistory() {
  const listEl = document.getElementById('memoryHistoryList');
  const badgeEl = document.getElementById('appHistoryCountBadge');
  if (!listEl) return;

  try {
    const res = await fetch('/api/memory/history');
    const data = await res.json();

    if (data.success && Array.isArray(data.history)) {
      if (badgeEl) badgeEl.innerText = `${data.history.length} Applications`;

      if (data.history.length === 0) {
        listEl.innerHTML = `
          <div style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 18px;">
            No applications logged in episodic memory yet. As you run auto-apply, every company application will be recorded here.
          </div>
        `;
        return;
      }

      listEl.innerHTML = data.history.slice(0, 15).map(app => {
        const isSuccess = app.status === 'Submitted' || app.status.includes('Paused');
        const statusColor = isSuccess ? '#34d399' : '#f87171';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px;">
            <div>
              <strong style="color: #fff;">${escapeHtml(app.company)}</strong>
              <span style="color: var(--text-secondary); margin-left: 8px;">${escapeHtml(app.title)}</span>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
                ${new Date(app.appliedAt).toLocaleString()} &bull; <a href="${escapeHtml(app.url)}" target="_blank" style="color: #38bdf8; text-decoration: none;">View Posting &rarr;</a>
              </div>
            </div>
            <span class="badge" style="background: rgba(255,255,255,0.06); color: ${statusColor}; font-weight: 700;">
              ${escapeHtml(app.status)}
            </span>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.warn('Failed loading app history:', e);
  }
}


