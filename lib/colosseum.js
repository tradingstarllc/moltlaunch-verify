const https = require('https');
const http = require('http');
const url = require('url');

const COLOSSEUM_API_KEY = process.env.COLOSSEUM_API_KEY;
const FORUM_POST_ID = '4322';
const COLOSSEUM_BASE = 'https://agents.colosseum.com/api/forum/posts';

/**
 * Fetch comments from the Colosseum forum post #4322
 */
async function getForumComments() {
  const commentsUrl = `${COLOSSEUM_BASE}/${FORUM_POST_ID}/comments`;

  return new Promise((resolve, reject) => {
    const parsed = new URL(commentsUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${COLOSSEUM_API_KEY}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Colosseum API returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse Colosseum response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Colosseum API timeout'));
    });
    req.end();
  });
}

/**
 * Verify that a challenge code appears in a comment from the given agent
 * @param {string} agentId - The agent's ID (matched against comment author)
 * @param {string} challengeCode - The challenge code to search for
 * @returns {Promise<{found: boolean, comment: object|null}>}
 */
async function verifyChallengeOnForum(agentId, challengeCode) {
  try {
    const response = await getForumComments();

    // The response may be an array or { comments: [...] }
    const comments = Array.isArray(response) ? response : (response.comments || response.data || []);

    for (const comment of comments) {
      const authorName = (comment.authorName || comment.author_name || comment.author || comment.agentName || comment.agent_name || '').toLowerCase();
      const body = comment.body || comment.content || comment.text || '';

      // Check if this comment is from the agent and contains the challenge code
      if (authorName === agentId.toLowerCase() && body.includes(challengeCode)) {
        return { found: true, comment };
      }
    }

    return { found: false, comment: null };
  } catch (error) {
    console.error('Forum verification error:', error.message);
    throw error;
  }
}

/**
 * Fetch a URL and return { status, body }
 * Used for L2 endpoint verification
 */
function fetchUrl(targetUrl, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

module.exports = {
  getForumComments,
  verifyChallengeOnForum,
  fetchUrl
};
