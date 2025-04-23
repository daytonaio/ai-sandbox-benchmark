require('dotenv').config();
// Force disable SSL certificate validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const https = require('https');
const { CodeSandbox } = require('@codesandbox/sdk');

// Create a custom HTTPS agent that ignores certificate errors
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Add timestamp to logs
const log = (message, type = 'info') => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    switch(type) {
        case 'error':
            console.error(logMessage);
            break;
        case 'warn':
            console.warn(logMessage);
            break;
        default:
            console.log(logMessage);
    }
};

const app = express();
app.use(express.json());

// Enhanced environment validation
const requiredEnvVars = ['CSB_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    log(`Missing required environment variables: ${missingVars.join(', ')}`, 'error');
    process.exit(1);
}

// Validate API key format
if (process.env.CSB_API_KEY && !(process.env.CSB_API_KEY.startsWith('csb_') || process.env.CSB_API_KEY.startsWith('csb_v1_'))) {
    log(`WARNING: CSB_API_KEY does not have the expected format (should start with 'csb_' or 'csb_v1_')`, 'warn');
}

log(`Using CodeSandbox API Key: ${process.env.CSB_API_KEY.substring(0, 10)}...`, 'info');

// CRITICAL NOTICE FOR API KEY ISSUES
log(`
====================================================================
IMPORTANT: If you're seeing 403 errors, your API key may have expired.
Please regenerate your API key at:
https://codesandbox.io/dashboard/settings/tokens

Then update your .env file with the new key.
====================================================================
`, 'info');

// Log SDK version to help with debugging
try {
    // Alternative method to get package version that works with ESM exports
    const { execSync } = require('child_process');
    const npmList = execSync('npm list @codesandbox/sdk --json').toString();
    const parsedList = JSON.parse(npmList);
    
    if (parsedList.dependencies && parsedList.dependencies['@codesandbox/sdk']) {
        const version = parsedList.dependencies['@codesandbox/sdk'].version;
        log(`Using @codesandbox/sdk version ${version}`);
        
        // Warn about potential issues with recent versions
        if (version === '0.11.2') {
            log(`WARNING: You are using SDK version 0.11.2 which has known issues with 403 errors`, 'warn');
            log(`Consider downgrading to 0.11.1 if you experience authorization problems`, 'warn');
        }
    } else {
        log(`Could not find @codesandbox/sdk in npm list output`, 'warn');
    }
} catch (e) {
    log(`Could not determine SDK version: ${e.message}`, 'warn');
}

log('Initializing CodeSandbox SDK with SSL certificate validation disabled...');

// Add a basic API key validity check
const apiKey = process.env.CSB_API_KEY;
if (!apiKey || apiKey.length < 20) { // Most API keys are at least 20 chars
    log('ERROR: API key appears to be invalid or too short', 'error');
    log('Please check your .env file and update the CSB_API_KEY value', 'error');
    process.exit(1);
}

// Pass the custom HTTPS agent via httpClient config
const sdk = new CodeSandbox(apiKey, {
    httpClient: {
        agent: httpsAgent,
        timeout: 60000, // Increase timeout to 60 seconds
        retry: {
            retries: 5, // Increased from 3 to 5
            minTimeout: 1000,
            maxTimeout: 8000  // Increased from 5000 to 8000
        }
    }
});
log('CodeSandbox SDK initialized successfully');

// Test the API connection before handling requests
(async function testApiConnection() {
    try {
        log('Testing API connection...');
        // Create a dummy sandbox to test authentication - but don't wait for it
        // This is just to trigger an auth check without blocking server startup
        sdk.sandbox.create().then(sandbox => {
            log('API connection test successful!', 'info');
            // Cleanup test sandbox immediately
            sandbox.hibernate().catch(e => {
                log(`Failed to cleanup test sandbox: ${e.message}`, 'warn');
            });
        }).catch(error => {
            log(`API connection test failed: ${error.message}`, 'error');
            if (error.message.includes('403') || error.message.includes('Forbidden')) {
                log(`
====================================================================
CRITICAL ERROR: Authentication failed with valid API key format.
Your API key has likely expired or been revoked.

Please regenerate your API key at:
https://codesandbox.io/dashboard/settings/tokens

Then update your .env file with the new key.
====================================================================
`, 'error');
            }
        });
    } catch (error) {
        log(`API connection test setup failed: ${error.message}`, 'error');
    }
})();

// Add request logging middleware
app.use((req, res, next) => {
    log(`Incoming ${req.method} request to ${req.path}`);
    next();
});

// Status endpoint for health checks
app.get('/status', async (req, res) => {
    // We'll do a lightweight check when the status endpoint is hit
    let apiKeyStatus = 'unknown';
    let testInProgress = false;
    
    try {
        // Only attempt one test at a time to avoid multiple sandbox creations
        if (!testInProgress) {
            testInProgress = true;
            
            // Create a very small timeout to avoid blocking the response
            setTimeout(async () => {
                try {
                    // Try to create a sandbox as a key validity test
                    const sandbox = await sdk.sandbox.create();
                    log('API key test during status check: Key is valid');
                    
                    // Clean up the test sandbox
                    try {
                        await sandbox.hibernate();
                    } catch (cleanupError) {
                        log(`Failed to clean up test sandbox: ${cleanupError.message}`, 'warn');
                    }
                } catch (error) {
                    log(`API key test during status check failed: ${error.message}`, 'error');
                }
                
                testInProgress = false;
            }, 100);
        }
        
        // The status endpoint should return immediately
        // We'll just report on the key format validity
        if (process.env.CSB_API_KEY && 
            (process.env.CSB_API_KEY.startsWith('csb_') || process.env.CSB_API_KEY.startsWith('csb_v1_'))) {
            apiKeyStatus = 'valid format';
        } else {
            apiKeyStatus = 'invalid format';
        }
    } catch (error) {
        apiKeyStatus = 'error checking: ' + error.message;
    }
    
    res.json({
        status: 'ok',
        service: 'codesandbox-service',
        timestamp: new Date().toISOString(),
        sdk_version: '0.11.1',
        api_key_status: apiKeyStatus,
        help_url: 'http://localhost:3000/help',
        test_url: 'http://localhost:3000/test-api-key'
    });
});

// API key test endpoint - useful for troubleshooting
app.get('/test-api-key', async (req, res) => {
    const apiKey = req.query.key || process.env.CSB_API_KEY;
    log(`Testing API key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'none provided'}`);
    
    // First do a simple format check
    let formatValid = false;
    if (apiKey && (apiKey.startsWith('csb_') || apiKey.startsWith('csb_v1_'))) {
        formatValid = true;
    }
    
    try {
        // Create a temporary SDK instance with the provided key
        const tempSdk = new CodeSandbox(apiKey, {
            httpClient: {
                agent: httpsAgent,
                timeout: 30000 // Increased timeout for more reliable testing
            }
        });
        
        // Use sandbox creation as the test (most accurate test)
        log('Creating test sandbox to verify API key...');
        
        // Create a response that will stream updates to the client
        res.setHeader('Content-Type', 'text/html');
        res.write(`
        <html>
            <head>
                <title>CodeSandbox API Key Test</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
                    h1 { color: #333; }
                    .pending { background: #f0f0f0; padding: 10px; border-left: 4px solid #999; }
                    .success { background: #d4edda; padding: 10px; border-left: 4px solid #28a745; }
                    .error { background: #f8d7da; padding: 10px; border-left: 4px solid #dc3545; }
                    pre { background: #f4f4f4; padding: 15px; overflow-x: auto; }
                </style>
            </head>
            <body>
                <h1>CodeSandbox API Key Test</h1>
                <p>Testing API key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'none provided'}</p>
                
                <h2>Format Check</h2>
                <div class="${formatValid ? 'success' : 'error'}">
                    <p><strong>Key Format:</strong> ${formatValid ? 'Valid' : 'Invalid'}</p>
                    <p>API keys should start with 'csb_' or 'csb_v1_'</p>
                </div>
                
                <h2>API Authentication Check</h2>
                <div class="pending" id="auth-status">
                    <p>Testing authentication with CodeSandbox API...</p>
                </div>
                
                <script>
                    // This will be replaced with the actual test outcome
                    // Using JavaScript just for the page formatting
                </script>
        `);
        
        try {
            // Test the API key with a sandbox creation request
            const sandbox = await tempSdk.sandbox.create();
            
            // Authentication successful
            log(`API key test successful!`);
            
            // Clean up the test sandbox
            try {
                await sandbox.hibernate();
                log('Test sandbox cleaned up successfully');
            } catch (cleanupError) {
                log(`Failed to clean up test sandbox: ${cleanupError.message}`, 'warn');
            }
            
            res.write(`
                <script>
                    document.getElementById('auth-status').className = 'success';
                    document.getElementById('auth-status').innerHTML = '<p><strong>Authentication:</strong> Successful</p><p>Your API key is valid and working correctly!</p>';
                </script>
                
                <h2>What's Next?</h2>
                <p>Your API key is valid and working correctly. You can now use the CodeSandbox provider for benchmarking.</p>
                
                <p><a href="/help">Return to Help Page</a></p>
                </body>
                </html>
            `);
            res.end();
            
        } catch (error) {
            log(`API key test failed: ${error.message}`, 'error');
            
            let errorReason = 'Unknown error';
            let errorDetails = '';
            
            if (error.message.includes('403')) {
                errorReason = 'Authentication failed (403 Forbidden)';
                errorDetails = 'Your API key is invalid or has expired. Generate a new key at <a href="https://codesandbox.io/dashboard/settings/tokens" target="_blank">https://codesandbox.io/dashboard/settings/tokens</a>';
            } else if (error.message.includes('429')) {
                errorReason = 'Rate limit exceeded (429 Too Many Requests)';
                errorDetails = 'The CodeSandbox API is rate limiting requests. Please try again later.';
            } else if (error.message.includes('timeout')) {
                errorReason = 'Request timed out';
                errorDetails = 'The CodeSandbox API may be under high load or experiencing issues.';
            } else {
                errorDetails = error.message;
            }
            
            res.write(`
                <script>
                    document.getElementById('auth-status').className = 'error';
                    document.getElementById('auth-status').innerHTML = '<p><strong>Authentication:</strong> Failed</p><p><strong>Reason:</strong> ${errorReason}</p><p>${errorDetails}</p>';
                </script>
                
                <h2>Error Details</h2>
                <pre>${error.stack || error.message}</pre>
                
                <h2>How to Fix</h2>
                <ol>
                    <li>Go to <a href="https://codesandbox.io/dashboard/settings/tokens" target="_blank">https://codesandbox.io/dashboard/settings/tokens</a></li>
                    <li>Generate a new API key</li>
                    <li>Update your .env file with the new key</li>
                    <li>Restart this service</li>
                </ol>
                
                <p><a href="/help">Return to Help Page</a></p>
                </body>
                </html>
            `);
            res.end();
        }
    } catch (error) {
        log(`Error setting up API key test: ${error.message}`, 'error');
        
        res.status(500).send(`
        <html>
            <head>
                <title>CodeSandbox API Key Test Error</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
                    h1 { color: #333; }
                    .error { background: #f8d7da; padding: 10px; border-left: 4px solid #dc3545; }
                    pre { background: #f4f4f4; padding: 15px; overflow-x: auto; }
                </style>
            </head>
            <body>
                <h1>CodeSandbox API Key Test Error</h1>
                
                <div class="error">
                    <p>An error occurred while setting up the API key test.</p>
                    <p>${error.message}</p>
                </div>
                
                <pre>${error.stack || error.message}</pre>
                
                <p><a href="/help">Return to Help Page</a></p>
            </body>
        </html>
        `);
    }
});

app.post('/execute', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    log(`[${requestId}] Starting code execution request`);

    const { code, env_vars, test_config } = req.body;
    if (!code) {
        log(`[${requestId}] No code provided in request`, 'error');
        return res.status(400).json({ error: 'No code provided' });
    }

    log(`[${requestId}] Code to execute: ${code.substring(0, 100)}${code.length > 100 ? '...' : ''}`);
    
    if (env_vars) {
        log(`[${requestId}] Environment variables provided: ${Object.keys(env_vars).join(', ')}`);
    }
    
    if (test_config) {
        log(`[${requestId}] Test configuration provided: ${JSON.stringify(test_config)}`);
        if (test_config.packages) {
            log(`[${requestId}] Required packages from test config: ${test_config.packages.join(', ')}`);
        }
    }

    const startTime = Date.now();
    const metrics = {
        workspaceCreation: 0, // Renamed from initialization to workspaceCreation for consistency with Python script
        setupTime: 0,         // Track time spent on dependency installation and environment setup
        codeExecution: 0,
        cleanup: 0
    };

    let sandbox = null;

    try {
        const createStart = Date.now();
        log(`[${requestId}] Creating sandbox instance`);
        try {
            sandbox = await sdk.sandbox.create();
            metrics.workspaceCreation = Date.now() - createStart; // Measure workspace creation time
            log(`[${requestId}] Sandbox created successfully in ${metrics.workspaceCreation}ms`);
        } catch (createError) {
            // Enhanced error handling for sandbox creation
            log(`[${requestId}] Failed to create sandbox: ${createError.message}`, 'error');
            
            // Special handling for common error types
            if (createError.message.includes('403') || createError.message.includes('Forbidden')) {
                log(`[${requestId}] AUTHORIZATION ERROR: Please check your API key is valid and has proper permissions`, 'error');
                log(`[${requestId}] This may be due to v0.11.2+ of the SDK handling 403 errors differently`, 'error');
                log(`[${requestId}] Ensure your API key is formatted correctly (should start with 'csb_' or 'csb_v1_')`, 'error');
                log(`[${requestId}] Current API key format: ${process.env.CSB_API_KEY.substring(0, 10)}...`, 'error');
                log(`[${requestId}] Please regenerate your API key at https://codesandbox.io/dashboard/settings/tokens`, 'error');
            } else if (createError.message.includes('429') || createError.message.includes('Too Many Requests')) {
                log(`[${requestId}] RATE LIMIT ERROR: Too many requests. Please try again later`, 'error');
            }
            
            // Re-throw for normal error flow
            throw createError;
        }

        // Start measuring setup time
        const setupStart = Date.now();
        log(`[${requestId}] Beginning setup phase`);

        // Pass environment variables to the sandbox if provided
        if (env_vars && Object.keys(env_vars).length > 0) {
            log(`[${requestId}] Setting up environment variables in sandbox`);
            
            let envSetupCode = "import os;\n";
            for (const [key, value] of Object.entries(env_vars)) {
                log(`[${requestId}] Setting ${key} in sandbox`);
                envSetupCode += `os.environ['${key}'] = '${value}';\n`;
            }
            
            await sandbox.shells.python.run(envSetupCode);
        }
        
        // Check for dependencies and install them if needed
        log(`[${requestId}] Checking for dependencies in code...`);
        const dependencyCheckerCode = `
import sys
import os
import subprocess
import re
import importlib
from typing import List, Set, Optional, Dict, Any

# Directly define the utility functions in the script without trying to import from providers module
def is_standard_library(module_name: str) -> bool:
    # Standard approach to detect standard library modules
    try:
        path = getattr(importlib.import_module(module_name), "__file__", "")
        return path and ("site-packages" not in path and "dist-packages" not in path)
    except (ImportError, AttributeError):
        # If import fails, we'll assume it's not a standard library
        return False

def extract_imports(code: str) -> Set[str]:
    # This regex pattern captures both 'import x' and 'from x import y' style imports
    pattern = r'^(?:from|import)\\s+([a-zA-Z0-9_]+)'
    imports = set()
    
    for line in code.split('\\n'):
        match = re.match(pattern, line.strip())
        if match:
            imports.add(match.group(1))
    
    return imports

def check_and_install_dependencies(
    code: str,
    provider_context: Optional[Dict[str, Any]] = None,
    always_install: Optional[List[str]] = None
) -> List[str]:
    installed_packages = []
    
    # Install packages that should always be available
    if always_install:
        for package in always_install:
            try:
                importlib.import_module(package)
                print(f"Package {package} is already installed.")
            except ImportError:
                print(f"Installing required package: {package}")
                subprocess.check_call([sys.executable, "-m", "pip", "install", package])
                installed_packages.append(package)
    
    # Extract imports from the code
    imports = extract_imports(code)
    
    # Filter out standard library modules
    third_party_modules = {
        module for module in imports if not is_standard_library(module)
    }
    
    # Check each third-party module and install if missing
    for module in third_party_modules:
        # Skip "providers" module since it's not a PyPI package
        if module == "providers":
            continue
            
        try:
            importlib.import_module(module)
            print(f"Module {module} is already installed.")
        except ImportError:
            print(f"Installing missing dependency: {module}")
            # Use pip to install the package
            subprocess.check_call([sys.executable, "-m", "pip", "install", module])
            installed_packages.append(module)
    
    return installed_packages

# Get packages to install from test config if available
always_install_packages = []

${test_config && test_config.packages ? `
# Use packages from test configuration
always_install_packages = ${JSON.stringify(test_config.packages)}
print("Using packages from test config: " + str(always_install_packages))
` : `
# Default packages to install
always_install_packages = [
    'numpy',  # Required for FFT tests
    'scipy',  # Required for FFT tests
]
`}

# The code string is passed in with triple quotes to handle any internal quotes
installed_packages = check_and_install_dependencies(
    '''${code.replace(/'/g, "\\'")}''',
    always_install=always_install_packages
)
print(f"Installed packages: {installed_packages}")
`;

        const dependencyResult = await sandbox.shells.python.run(dependencyCheckerCode);
        log(`[${requestId}] Dependency check output: ${dependencyResult.output}`);
        
        // For FFT performance test, ensure packages are properly installed
        if (code.includes("from scipy import fft")) {
            log(`[${requestId}] FFT test detected, installing packages directly...`);
            const pipInstallCode = `
pip install --user numpy scipy
`;
            const pipResult = await sandbox.shells.python.run(pipInstallCode);
            log(`[${requestId}] Package installation output: ${pipResult.output}`);
        }
        
        // End setup time measurement
        metrics.setupTime = Date.now() - setupStart;
        log(`[${requestId}] Setup phase completed in ${metrics.setupTime}ms`);
        
        const execStart = Date.now();
        log(`[${requestId}] Executing code in sandbox`);
        const result = await sandbox.shells.python.run(code);
        metrics.codeExecution = Date.now() - execStart; // Measure code execution time
        log(`[${requestId}] Code execution completed in ${metrics.codeExecution}ms`);
        log(`[${requestId}] Execution output: ${JSON.stringify(result.output)}`);

        const cleanupStart = Date.now();
        log(`[${requestId}] Starting sandbox cleanup`);
        await sandbox.hibernate();
        metrics.cleanup = Date.now() - cleanupStart; // Measure cleanup time
        log(`[${requestId}] Cleanup completed in ${metrics.cleanup}ms`);

        const totalTime = Date.now() - startTime;
        log(`[${requestId}] Total request processing time: ${totalTime}ms`);

        res.json({
            requestId,
            output: result.output,
            metrics: metrics,
            totalTime
        });

    } catch (error) {
        log(`[${requestId}] Error during execution: ${error.message}`, 'error');
        log(`[${requestId}] Error stack: ${error.stack}`, 'error');
        
        // Enhanced diagnostic information for WebSocket errors
        if (error.message.includes('403') || error.message.includes('Forbidden')) {
            log(`[${requestId}] AUTHORIZATION ERROR: API key may be invalid or expired`, 'error');
            log(`[${requestId}] Try regenerating your CodeSandbox API key at https://codesandbox.io/dashboard/settings/tokens`, 'error');
            log(`[${requestId}] Make sure to update your .env file with the new API key`, 'error');
            log(`[${requestId}] API keys should start with 'csb_' or 'csb_v1_' - current format: ${process.env.CSB_API_KEY.substring(0, 10)}...`, 'error');
            log(`[${requestId}] Current SDK version may be handling 403 errors differently (v0.11.2+)`, 'error');
        } else if (error.message.includes('unable to get local issuer certificate')) {
            log(`[${requestId}] CERTIFICATE ERROR: SSL certificate validation failed`, 'error');
            log(`[${requestId}] This is likely due to network configuration or proxy settings`, 'error');
        } else if (error.message.includes('Unexpected server response')) {
            const statusCode = error.message.match(/\d+/) || 'unknown';
            log(`[${requestId}] CONNECTION ERROR: CodeSandbox API returned unexpected response: ${statusCode}`, 'error');
            log(`[${requestId}] This may be due to API changes or service disruption`, 'error');
            if (statusCode === '403') {
                log(`[${requestId}] Status 403 indicates an authentication or authorization issue`, 'error');
                log(`[${requestId}] Ensure your CSB_API_KEY is correct and has not expired`, 'error');
            }
        }

        // Attempt cleanup if sandbox exists
        if (sandbox) {
            try {
                log(`[${requestId}] Attempting cleanup after error`);
                const cleanupStart = Date.now();
                await sandbox.hibernate();
                metrics.cleanup = Date.now() - cleanupStart; // Measure cleanup time even in error case
                log(`[${requestId}] Cleanup after error successful in ${metrics.cleanup}ms`);
            } catch (cleanupError) {
                log(`[${requestId}] Cleanup after error failed: ${cleanupError.message}`, 'error');
            }
        }

        res.status(500).json({
            requestId,
            error: error.message,
            metrics: metrics,
            errorDetails: {
                name: error.name,
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
});

// Add a help endpoint with instructions
app.get('/help', (req, res) => {
    res.send(`
    <html>
        <head>
            <title>CodeSandbox Service Help</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
                h1 { color: #333; }
                pre { background: #f4f4f4; border-left: 3px solid #007bff; padding: 15px; overflow-x: auto; }
                .warning { background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; }
                .error { background: #f8d7da; padding: 10px; border-left: 4px solid #dc3545; }
                .success { background: #d4edda; padding: 10px; border-left: 4px solid #28a745; }
            </style>
        </head>
        <body>
            <h1>CodeSandbox Service</h1>
            <p>This service provides an API for executing Python code in isolated CodeSandbox environments.</p>
            
            <h2>API Endpoints</h2>
            <ul>
                <li><strong>GET /status</strong> - Check service status and API key validity</li>
                <li><strong>GET /test-api-key</strong> - Test your API key (use ?key=your_key to test a different key)</li>
                <li><strong>POST /execute</strong> - Execute Python code in a sandbox</li>
                <li><strong>GET /help</strong> - Show this help information</li>
            </ul>
            
            <h2>API Key Information</h2>
            <div class="${process.env.CSB_API_KEY ? 'success' : 'error'}">
                <p><strong>API Key Status:</strong> ${process.env.CSB_API_KEY ? 'Configured' : 'Not configured'}</p>
                ${process.env.CSB_API_KEY ? `<p><strong>Key Format:</strong> ${process.env.CSB_API_KEY.substring(0, 10)}...</p>` : ''}
            </div>
            
            <h2>Troubleshooting 403 Errors</h2>
            <div class="warning">
                <p>If you're seeing 403 Forbidden errors, your API key may have expired or been revoked.</p>
                <p>Steps to fix:</p>
                <ol>
                    <li>Go to <a href="https://codesandbox.io/dashboard/settings/tokens" target="_blank">https://codesandbox.io/dashboard/settings/tokens</a></li>
                    <li>Generate a new API key</li>
                    <li>Update your .env file with the new key</li>
                    <li>Restart this service</li>
                </ol>
            </div>
            
            <h2>Example Usage</h2>
            <pre>
curl -X POST http://localhost:3000/execute \\
  -H "Content-Type: application/json" \\
  -d '{
    "code": "print(\\"Hello from CodeSandbox!\\")"
  }'
            </pre>
        </body>
    </html>
    `);
});

// Error handling middleware
app.use((err, req, res, next) => {
    log(`Unhandled error: ${err.message}`, 'error');
    log(err.stack, 'error');
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log(`CodeSandbox service running on port ${PORT}`);
    log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    log('Server is ready to accept requests');
});

// Handle process termination
process.on('SIGTERM', () => {
    log('SIGTERM received. Shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('SIGINT received. Shutting down gracefully');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    log(`Uncaught Exception: ${err.message}`, 'error');
    log(err.stack, 'error');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log('Unhandled Rejection at:', 'error');
    log(`Promise: ${promise}`, 'error');
    log(`Reason: ${reason}`, 'error');
});