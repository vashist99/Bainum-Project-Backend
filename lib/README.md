# RevAI - Node.js SDK for Rev.ai ASR

A clean, promise-based wrapper for interacting with Rev.ai Automatic Speech Recognition (ASR) service.

## Features

- ✅ Simple, clean API interface
- ✅ Support for file paths, streams, and buffers
- ✅ Automatic job polling and transcript retrieval
- ✅ Automatic response parsing
- ✅ Configurable timeout and polling intervals
- ✅ Comprehensive error handling
- ✅ Environment variable support

## Installation

RevAI is included in this project. All dependencies are already installed:
- `axios` - For HTTP requests
- `form-data` - For multipart form data

## Quick Start

### Basic Usage

```javascript
import revai from '../lib/revai.js';

// Transcribe from file path
const result = await revai.transcribeFromFile('/path/to/audio.wav');
const transcript = revai.getTranscript(result);
console.log(transcript);
```

### Advanced Usage

```javascript
import { RevAI } from '../lib/revai.js';

// Create custom instance
const revaiClient = new RevAI({
    apiKey: 'your-revai-api-key',
    apiBaseUrl: 'https://api.rev.ai/speechtotext/v1',
    timeout: 300000,
    pollInterval: 2000,
    maxPollAttempts: 150
});

// Transcribe from file
const result = await revaiClient.transcribeFromFile('audio.wav', {
    filename: 'my-audio.wav',
    mimetype: 'audio/wav',
    skipPunctuation: false,
    filterProfanity: true
});

// Get transcript
const transcript = revaiClient.getTranscript(result);
```

### Using with Streams

```javascript
import fs from 'fs';
import revai from '../lib/revai.js';

const fileStream = fs.createReadStream('audio.mp3');
const result = await revai.transcribeFromStream(fileStream, {
    filename: 'audio.mp3',
    mimetype: 'audio/mpeg'
});
```

### Using with Buffers

```javascript
import revai from '../lib/revai.js';

const audioBuffer = Buffer.from(/* audio data */);
const result = await revai.transcribeFromBuffer(audioBuffer, {
    filename: 'audio.wav',
    mimetype: 'audio/wav'
});
```

## Configuration

### Environment Variables

RevAI automatically reads from environment variables:

```bash
REVAI_API_KEY=your_revai_api_key_here
```

Get your API key from [Rev.ai Sign Up](https://www.rev.ai/auth/signup)

### Programmatic Configuration

```javascript
import revai from '../lib/revai.js';

// Update configuration
revai.configure({
    apiKey: 'new-key',
    timeout: 300000,
    pollInterval: 2000,
    maxPollAttempts: 150
});

// Get current configuration
const config = revai.getConfig();
console.log(config);
```

## Health Check

Check if the RevAI service is ready:

```javascript
const isHealthy = await revai.isHealthy();
if (!isHealthy) {
    console.error('RevAI API key is not set');
}
```

## API Reference

### Methods

#### `transcribeFromFile(filePath, options?)`
Transcribe audio from a file path.

**Parameters:**
- `filePath` (string): Path to the audio file
- `options` (object, optional):
  - `filename` (string): Filename for upload
  - `mimetype` (string): MIME type of audio
  - `skipPunctuation` (boolean): Skip automatic punctuation
  - `skipDiarization` (boolean): Skip speaker diarization
  - `filterProfanity` (boolean): Filter profanity from transcript
  - `removeDisfluencies` (boolean): Remove disfluencies (um, uh, etc.)
  - `language` (string): Language code (e.g., 'en', 'es', 'fr')
  - `customVocabularyId` (string): Custom vocabulary ID

**Returns:** Promise<Object> - Transcription result with `text`, `raw`, and `jobId`

#### `transcribeFromStream(stream, options?)`
Transcribe audio from a readable stream.

**Parameters:**
- `stream` (Stream): Readable stream of audio data
- `options` (object, optional): Same as `transcribeFromFile`

**Returns:** Promise<Object> - Transcription result

#### `transcribeFromBuffer(buffer, options?)`
Transcribe audio from a Buffer.

**Parameters:**
- `buffer` (Buffer): Audio file buffer
- `options` (object, optional): Same as `transcribeFromFile`

**Returns:** Promise<Object> - Transcription result

#### `getTranscript(result)`
Extract transcript text from transcription result.

**Parameters:**
- `result` (Object|string): Transcription result

**Returns:** string - Transcript text

#### `isHealthy()`
Check if RevAI API key is set.

**Returns:** Promise<boolean> - True if API key is set

#### `configure(options)`
Update configuration.

**Parameters:**
- `options` (object): Configuration options

#### `getConfig()`
Get current configuration.

**Returns:** Object - Current configuration (without sensitive data)

## Error Handling

RevAI provides detailed error messages:

```javascript
try {
    const result = await revai.transcribeFromFile('audio.wav');
} catch (error) {
    if (error.message.includes('unreachable')) {
        console.error('RevAI service is not reachable');
    } else if (error.message.includes('API key')) {
        console.error('RevAI API key is required');
    } else if (error.message.includes('not found')) {
        console.error('Audio file not found');
    } else if (error.message.includes('timed out')) {
        console.error('Transcription timed out');
    } else {
        console.error('Transcription error:', error.message);
    }
}
```

## How It Works

RevAI uses an asynchronous job-based API:

1. **Submit Job**: Audio file is uploaded and a job is created
2. **Poll Status**: The library automatically polls for job completion using adaptive polling
3. **Get Transcript**: Once complete, the transcript is retrieved

The library handles all polling automatically, so you can use it synchronously.

## Performance Optimizations

The library includes several optimizations for faster transcription:

### Adaptive Polling
- **Fast initial polling**: Polls every 500ms for the first 10 seconds
- **Medium polling**: Polls every 1 second for the next 30 seconds  
- **Standard polling**: Polls every 2 seconds after that
- This ensures jobs are detected as soon as they complete while minimizing API calls

### Speed Optimizations
- **Skip diarization by default**: Speaker identification is skipped unless explicitly enabled (faster processing)
- **Language specification**: Specify the language for faster processing
- **Optimized intervals**: Reduced initial poll interval from 2s to 1s

### Tips for Faster Transcription
1. **Specify language**: Always provide the `language` option (e.g., 'en', 'es')
2. **Skip unnecessary features**: Disable diarization, punctuation, etc. if not needed
3. **Optimize audio files**: Use compressed formats (MP3) for faster uploads
4. **Shorter audio**: Shorter audio files process faster

## Examples

See `controllers/whisperController.js` for a complete integration example.

## Requirements

- Node.js 14+
- RevAI API key (get one at https://www.rev.ai/auth/signup)
- Internet connection (RevAI is a cloud service)

## Supported Audio Formats

RevAI supports a wide range of audio formats including:
- WAV, MP3, M4A, FLAC, OGG, and more
- See [RevAI documentation](https://docs.rev.ai/) for full list

## License

Part of the Bainum Project.

