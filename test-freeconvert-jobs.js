require('dotenv').config();
const fetch = require('node-fetch');

// Test the new FreeConvert Jobs API
async function testJobsAPI() {
    // Use a real Twitch clip URL for testing - replace with actual clip
    const testClipUrl = 'https://clips-media-assets2.twitch.tv/vod-2345678901-offset-1234.mp4';
    
    const apiKey = process.env.FREE_CONVERT_API_KEY;
    
    if (!apiKey) {
        console.error('FREE_CONVERT_API_KEY not found in environment');
        return;
    }
    
    console.log('Using API key:', apiKey.substring(0, 20) + '...');
    
    const inputBody = {
        "tasks": {
            "import-1": {
                "operation": "import/url",
                "url": testClipUrl
            },
            "convert-1": {
                "operation": "convert",
                "input": "import-1",
                "input_format": "mp4",
                "output_format": "gif",
                "options": {
                    "cut_start_video_to_gif": "00:00:00.00",
                    "cut_end_gif": "00:00:10.00",
                    "video_custom_width_gif": 400,
                    "video_to_gif_transparency": false,
                    "gif_fps": "15",
                    "video_to_gif_compression": "15",
                    "video_to_gif_optimize_static_bg": false
                }
            },
            "export-1": {
                "operation": "export/url",
                "input": ["convert-1"],
                "filename": "test_conversion.gif"
            }
        }
    };

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    console.log('\nStarting FreeConvert Jobs API test...');
    console.log('Test clip URL:', testClipUrl);
    console.log('Job payload:', JSON.stringify(inputBody, null, 2));
    
    const startTime = Date.now();

    try {
        // Create job
        console.log('\n1. Creating job...');
        const response = await fetch('https://api.freeconvert.com/v1/process/jobs', {
            method: 'POST',
            body: JSON.stringify(inputBody),
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const job = await response.json();
        console.log('Job created:', job.id);
        console.log('Initial status:', job.status);

        // Poll for completion
        console.log('\n2. Polling for completion...');
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
            attempts++;
            
            const statusResponse = await fetch(`https://api.freeconvert.com/v1/process/jobs/${job.id}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            
            const statusJob = await statusResponse.json();
            console.log(`Attempt ${attempts}: Status = ${statusJob.status}`);
            
            if (statusJob.status === 'completed') {
                const endTime = Date.now();
                const totalTime = (endTime - startTime) / 1000;
                
                console.log('\n✅ Job completed successfully!');
                console.log(`Total time: ${totalTime} seconds`);
                console.log('Tasks:', Object.keys(statusJob.tasks || {}));
                
                const exportTask = statusJob.tasks?.['export-1'];
                if (exportTask?.result?.url) {
                    console.log('GIF URL:', exportTask.result.url);
                }
                
                return {
                    success: true,
                    totalTime,
                    gifUrl: exportTask?.result?.url
                };
            }
            
            if (statusJob.status === 'failed' || statusJob.status === 'error') {
                console.log('\n❌ Job failed:', statusJob.message || 'Unknown error');
                return { success: false, error: statusJob.message };
            }
        }
        
        console.log('\n⏰ Job timed out after 30 attempts');
        return { success: false, error: 'Timeout' };
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

// Test multiple concurrent jobs to see blocking behavior
async function testConcurrentJobs() {
    console.log('\n=== Testing Concurrent Jobs ===');
    
    const job1Promise = testJobsAPI();
    
    // Start second job after 5 seconds
    setTimeout(() => {
        console.log('\n--- Starting second job ---');
        testJobsAPI().then(result => {
            console.log('Second job result:', result);
        });
    }, 5000);
    
    const result1 = await job1Promise;
    console.log('First job result:', result1);
}

// Run the test
if (require.main === module) {
    testJobsAPI().then(result => {
        console.log('\nFinal result:', result);
    });
}

module.exports = { testJobsAPI, testConcurrentJobs };