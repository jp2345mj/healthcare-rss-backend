// netlify/functions/trigger-github.js
// This function safely triggers your GitHub Actions

const https = require('https');

exports.handler = async (event, context) => {
  console.log('🔧 GitHub trigger function called');
  
  // CORS headers for Flutter web app
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ CORS preflight request handled');
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ message: 'CORS OK' }) 
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.log('❌ Invalid method:', event.httpMethod);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: 'Only POST requests allowed' 
      })
    };
  }

  try {
    // Parse request body
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (e) {
      console.log('❌ Invalid JSON in request body');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid JSON in request body' 
        })
      };
    }

    const { trigger_type, feed_id } = requestData;

    // Validate required fields
    if (!trigger_type) {
      console.log('❌ Missing trigger_type');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'trigger_type is required' 
        })
      };
    }

    // Get environment variables (set these in Netlify dashboard!)
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER;
    const GITHUB_REPO = process.env.GITHUB_REPO;

    // Validate environment variables exist
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      console.log('❌ Missing GitHub configuration in environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'GitHub configuration missing. Please set environment variables.' 
        })
      };
    }

    console.log(`🚀 Triggering GitHub Action: ${trigger_type}${feed_id ? ` for feed ${feed_id}` : ''}`);

    // Prepare GitHub API request
    const workflowInputs = {
      trigger_type,
      timestamp: new Date().toISOString(),
      source: 'netlify-function'
    };

    // Add feed_id if provided
    if (feed_id) {
      workflowInputs.feed_id = feed_id;
    }

    const postData = JSON.stringify({
      ref: 'main',
      inputs: workflowInputs
    });

    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/rss-scraper.yml/dispatches`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Healthcare-RSS-Manager-Netlify/1.0',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    // Make request to GitHub API
    const githubResponse = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: responseData
          });
        });
      });

      req.on('error', (error) => {
        console.error('❌ HTTPS request error:', error);
        reject(error);
      });

      req.on('timeout', () => {
        console.error('❌ Request timeout');
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // Set timeout
      req.setTimeout(10000);
      
      // Send the request
      req.write(postData);
      req.end();
    });

    // Handle GitHub API response
    if (githubResponse.statusCode === 204) {
      console.log('✅ GitHub Action triggered successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `GitHub Action triggered successfully for ${trigger_type}`,
          trigger_type,
          timestamp: new Date().toISOString()
        })
      };
    } else {
      console.log(`❌ GitHub API error: ${githubResponse.statusCode}`, githubResponse.data);
      
      // Try to parse error message
      let errorMessage = `GitHub API returned status ${githubResponse.statusCode}`;
      try {
        const errorData = JSON.parse(githubResponse.data);
        if (errorData.message) {
          errorMessage += `: ${errorData.message}`;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: errorMessage,
          github_status: githubResponse.statusCode
        })
      };
    }

  } catch (error) {
    console.error('❌ Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
