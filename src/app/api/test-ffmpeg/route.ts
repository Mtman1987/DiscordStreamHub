import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    console.log('Testing FFmpeg availability...');
    
    // Test 1: Check if FFmpeg is installed
    try {
      const { stdout: ffmpegVersion } = await execAsync('ffmpeg -version');
      console.log('FFmpeg found:', ffmpegVersion.split('\n')[0]);
    } catch (error) {
      return NextResponse.json({ 
        success: false, 
        error: 'FFmpeg not installed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    // Test 2: Simple video to GIF conversion with sample video
    const testVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const timestamp = Date.now();
    const os = await import('os');
    const tempDir = os.tmpdir();
    const tempMp4 = `${tempDir}/test_${timestamp}.mp4`;
    const tempGif = `${tempDir}/test_${timestamp}.gif`;
    
    console.log('Downloading test video...');
    await execAsync(`curl -L -o "${tempMp4}" "${testVideoUrl}"`);
    
    console.log('Converting to GIF...');
    const paletteFile = `${tempDir}/palette_${timestamp}.png`;
    const ffmpegCmd = `ffmpeg -i "${tempMp4}" -t 5 -vf "fps=10,scale=320:180:flags=lanczos,palettegen" -frames:v 1 -y "${paletteFile}" && ffmpeg -i "${tempMp4}" -i "${paletteFile}" -t 5 -filter_complex "[0:v]fps=10,scale=320:180:flags=lanczos[v];[v][1:v]paletteuse" -y "${tempGif}"`;
    
    const { stdout, stderr } = await execAsync(ffmpegCmd);
    
    // Check if GIF was created
    const fs = await import('fs');
    if (!fs.existsSync(tempGif)) {
      return NextResponse.json({ 
        success: false, 
        error: 'GIF file not created',
        stdout,
        stderr
      });
    }
    
    const stats = fs.statSync(tempGif);
    const gifSize = stats.size;
    
    // Cleanup
    try {
      fs.unlinkSync(tempMp4);
      fs.unlinkSync(tempGif);
      fs.unlinkSync(paletteFile);
    } catch (e) {}
    
    return NextResponse.json({ 
      success: true, 
      message: 'FFmpeg working correctly!',
      gifSize: `${(gifSize / 1024).toFixed(2)} KB`,
      stdout: stdout.substring(0, 500),
      stderr: stderr.substring(0, 500)
    });
    
  } catch (error) {
    console.error('FFmpeg test failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'FFmpeg test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}