// netlify/functions/test-rss.js
// This function safely tests RSS feed URLs

const https = require('https');
const http = require('http');
const { URL } = require('url');

exports.handler = async (event, context) => {
  console.log('🧪 RSS test function called');
  
  // CORS headers
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

    const { url } = requestData;

    // Validate URL is provided
    if (!url || typeof url !== 'string') {
      console.log('❌ Missing or invalid URL');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Valid URL is required' 
        })
      };
    }

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      console.log('❌ Invalid URL format:', url);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid URL format' 
        })
      };
    }

    // Only allow HTTP and HTTPS
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      console.log('❌ Invalid protocol:', parsedUrl.protocol);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Only HTTP and HTTPS URLs are allowed' 
        })
      };
    }

    // Block local/private IPs for security
    const hostname = parsedUrl.hostname;
    if (isLocalOrPrivateIP(hostname)) {
      console.log('❌ Local/private IP blocked:', hostname);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Local and private URLs are not allowed for security reasons' 
        })
      };
    }

    console.log(`🔍 Testing RSS feed: ${url}`);

    // Make HTTP request to test the feed
    const response = await makeHttpRequest(parsedUrl);

    // Check if response looks like RSS/XML
    const contentType = response.headers['content-type'] || '';
    const isXMLContentType = contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom');
    
    const bodyPreview = response.data.substring(0, 1000).toLowerCase();
    const hasRSSElements = bodyPreview.includes('<rss') || 
                          bodyPreview.includes('<feed') || 
                          bodyPreview.includes('<?xml') ||
                          bodyPreview.includes('<channel') ||
                          bodyPreview.includes('<atom');

    const isValidRSS = isXMLContentType || hasRSSElements;

    let message;
    if (isValidRSS) {
      message = '✅ Feed looks valid! Ready to save.';
    } else if (response.statusCode === 200) {
      message = '⚠️ URL accessible but doesn\'t appear to be an RSS feed';
    } else {
      message = `⚠️ HTTP ${response.statusCode} - Server responded but may not be a valid feed`;
    }

    console.log(`✅ RSS test completed: ${message}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        valid: isValidRSS,
        status: response.statusCode,
        message: message,
        contentType: contentType,
        url: url,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ RSS test error:', error);
    
    let errorMessage = 'Error testing feed';
    if (error.code === 'ENOTFOUND') {
      errorMessage = 'Domain not found - please check the URL';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - server may be down';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Request timeout - server took too long to respond';
    } else if (error.message) {
      errorMessage += `: ${error.message}`;
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// Helper function to make HTTP requests
function makeHttpRequest(parsedUrl) {
  return new Promise((resolve, reject) => {
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Healthcare RSS Manager/1.0 (Feed Validator)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Encoding': 'identity', // Don't request compressed responses
      },
      timeout: 15000 // 15 second timeout
    };

    const req = client.request(options, (res) => {
      let data = '';
      let chunks = 0;
      const maxChunks = 50; // Limit response size
      
      res.on('data', (chunk) => {
        chunks++;
        if (chunks <= maxChunks) {
          data += chunk;
        }
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Helper function to check for local/private IPs
function isLocalOrPrivateIP(hostname) {
  // Block localhost variations
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return true;
  }
  
  // Block private IP ranges (simplified check)
  if (hostname.startsWith('192.168.') || 
      hostname.startsWith('10.') || 
      hostname.startsWith('172.')) {
    return true;
  }
  
  return false;
}
