/**
 * Supabase Cloud Adapter
 * Syncs Agent Memory, Resume Storage, and Application Logs with Supabase
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('⚡ [Supabase] Connected to project:', supabaseUrl);
  } catch (err) {
    console.error('⚠️ [Supabase] Failed to initialize client:', err.message);
  }
} else {
  console.log('ℹ️ [Supabase] No credentials configured. Operating in offline/local file mode.');
}

/**
 * Sync all local Q&A memories to Supabase
 */
async function syncLocalMemoryToCloud(qaBank = []) {
  if (!supabase || !qaBank || qaBank.length === 0) return { synced: 0 };
  
  try {
    const records = qaBank.map(item => ({
      id: item.id,
      question: item.question,
      answer: item.answer,
      category: item.category || 'general',
      confidence: typeof item.confidence === 'number' ? (item.confidence > 1 ? item.confidence / 100 : item.confidence) : 1.0,
      source: item.source || 'human_verified',
      user_verified: item.verified !== false && item.user_verified !== false,
      times_recalled: item.timesUsed || item.times_recalled || 0,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from('agent_memory')
      .upsert(records, { onConflict: 'id' });

    if (error) {
      console.error('⚠️ [Supabase] Error syncing memory to cloud:', error.message);
      return { error: error.message };
    }

    console.log(`☁️ [Supabase] Successfully backed up ${records.length} memories to cloud!`);
    return { synced: records.length };
  } catch (err) {
    console.error('⚠️ [Supabase] Sync exception:', err.message);
    return { error: err.message };
  }
}

/**
 * Fetch latest memory bank from Supabase
 */
async function fetchMemoryFromCloud() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('agent_memory')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('⚠️ [Supabase] Error fetching cloud memory:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('⚠️ [Supabase] Fetch exception:', err.message);
    return null;
  }
}

/**
 * Log an application to Supabase
 */
async function logApplicationToCloud(app) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('applications')
      .insert([{
        job_title: app.job_title || 'Unknown Role',
        company: app.company || 'Unknown Company',
        job_url: app.job_url || '',
        platform: app.platform || 'General',
        status: app.status || 'Submitted',
        applied_at: new Date().toISOString()
      }]);

    if (error) {
      console.warn('⚠️ [Supabase] Could not log application to cloud:', error.message);
    }
    return data;
  } catch (err) {
    console.warn('⚠️ [Supabase] Cloud app log error:', err.message);
    return null;
  }
}

module.exports = {
  supabase,
  syncLocalMemoryToCloud,
  fetchMemoryFromCloud,
  logApplicationToCloud
};
