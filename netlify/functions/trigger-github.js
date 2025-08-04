// netlify/functions/trigger-github.js
// Secure function to trigger GitHub Actions workflows

const https = require('https');

exports.handler = async (event, context) => {
  console.log('🔧 GitHub trigger function called');
  console.log('Origin:', event.headers.origin);
  console.log('Method:', event.httpMethod);
  
  // Enhanced CORS headers for FlutterFlow
  const headers = {
    'Access-Control-Allow-Origin': '*', // Allow all origins during development
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
    'Content-Type': 'application/json'
  };

  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ CORS preflight request handled');
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ message: 'CORS preflight OK' }) 
    };
  }

  // Only allow POST requests for the actual function
  if (event.httpMethod !== 'POST') {
    console.log('❌ Invalid method:', event.httpMethod);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: 'Only POST requests allowed',
        method: event.httpMethod
      })
    };
  }

  try {
    // Parse request body safely
    let requestData;
    try {
      requestData = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
      console.log('❌ Invalid JSON in request body:', event.body);
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
    if (!trigger_type || typeof trigger_type !== 'string') {
      console.log('❌ Missing or invalid trigger_type:', trigger_type);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'trigger_type is required and must be a string' 
        })
      };
    }

    // Validate trigger_type values
    const validTriggers = ['new_feed', 'full_refresh', 'scheduled', 'cleanup_only'];
    if (!validTriggers.includes(trigger_type)) {
      console.log('❌ Invalid trigger_type:', trigger_type);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: `trigger_type must be one of: ${validTriggers.join(', ')}` 
        })
      };
    }

    // Get environment variables
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = process.env.GITHUB_OWNER;
    const GITHUB_REPO = process.env.GITHUB_REPO;

    // Validate environment variables
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      console.log('❌ Missing GitHub configuration');
      console.log('GITHUB_TOKEN exists:', !!GITHUB_TOKEN);
      console.log('GITHUB_OWNER exists:', !!GITHUB_OWNER);
      console.log('GITHUB_REPO exists:', !!GITHUB_REPO);
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'GitHub configuration missing. Please check environment variables.' 
        })
      };
    }

    console.log(`🚀 Triggering GitHub Action: ${trigger_type}${feed_id ? ` for feed ${feed_id}` : ''}`);
    console.log(`📍 Repository: ${GITHUB_OWNER}/${GITHUB_REPO}`);

    // Prepare GitHub API request - ONLY send expected inputs
    const workflowInputs = {
      trigger_type
    };

    // Add feed_id if provided
    if (feed_id) {
      workflowInputs.feed_id = feed_id;
    }

    console.log('📋 Workflow inputs:', workflowInputs);

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

    console.log('📡 Making GitHub API request...');

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
        reject(new Error('Request timeout after 15 seconds'));
      });

      // Set timeout
      req.setTimeout(15000);
      
      // Send the request
      req.write(postData);
      req.end();
    });

    console.log(`📨 GitHub API response status: ${githubResponse.statusCode}`);

    // Handle GitHub API response
    if (githubResponse.statusCode === 204) {
      console.log('✅ GitHub Action triggered successfully!');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `GitHub Action triggered successfully for ${trigger_type}`,
          trigger_type,
          feed_id: feed_id || null,
          repository: `${GITHUB_OWNER}/${GITHUB_REPO}`,
          workflow: 'rss-scraper.yml',
          timestamp: new Date().toISOString()
        })
      };
    } else {
      console.log(`❌ GitHub API error: ${githubResponse.statusCode}`);
      console.log('Response body:', githubResponse.data);
      
      // Try to parse error message
      let errorMessage = `GitHub API returned status ${githubResponse.statusCode}`;
      let errorDetails = null;
      
      try {
        const errorData = JSON.parse(githubResponse.data);
        if (errorData.message) {
          errorMessage += `: ${errorData.message}`;
        }
        if (errorData.errors) {
          errorDetails = errorData.errors;
        }
        if (errorData.documentation_url) {
          console.log('GitHub docs:', errorData.documentation_url);
        }
      } catch (e) {
        // Ignore JSON parse errors
        if (githubResponse.data) {
          console.log('Raw response:', githubResponse.data);
        }
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: errorMessage,
          github_status: githubResponse.statusCode,
          github_response: githubResponse.data,
          trigger_type,
          details: errorDetails,
          timestamp: new Date().toISOString()
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
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      })
    };
  }
};
