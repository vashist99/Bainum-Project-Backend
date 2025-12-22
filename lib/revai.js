/**
 * RevAI - Node.js SDK for Rev.ai ASR
 * 
 * A clean, promise-based wrapper for interacting with Rev.ai
 * Automatic Speech Recognition (ASR) service.
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

/**
 * RevAI Client Class
 * 
 * Provides methods to interact with Rev.ai ASR API
 */
class RevAI {
    constructor(options = {}) {
        // Configuration with defaults
        this.apiKey = options.apiKey || 
            process.env.REVAI_API_KEY || 
            '';
        
        this.apiBaseUrl = options.apiBaseUrl || 
            'https://api.rev.ai/speechtotext/v1';
        
        this.timeout = options.timeout || 300000; // 5 minutes default for async jobs
        this.pollInterval = options.pollInterval || 1000; // 1 second initial poll interval (optimized)
        this.maxPollAttempts = options.maxPollAttempts || 300; // ~5 minutes max wait (with faster polling)
        this.adaptivePolling = options.adaptivePolling !== false; // Enable adaptive polling by default
        
        if (!this.apiKey) {
            console.warn('RevAI API key not set. Set REVAI_API_KEY environment variable.');
        }
    }

    /**
     * Submit a transcription job from file path
     * 
     * @param {string} filePath - Path to the audio file
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Transcription result
     */
    async transcribeFromFile(filePath, options = {}) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Audio file not found: ${filePath}`);
        }

        const fileStream = fs.createReadStream(filePath);
        const filename = options.filename || filePath.split('/').pop();
        const mimetype = options.mimetype || 'audio/wav';

        return this.transcribeFromStream(fileStream, {
            filename,
            mimetype,
            ...options
        });
    }

    /**
     * Submit a transcription job from a readable stream
     * 
     * @param {Stream} stream - Readable stream of audio data
     * @param {Object} options - Additional options
     * @param {string} options.filename - Filename for the upload
     * @param {string} options.mimetype - MIME type of the audio
     * @returns {Promise<Object>} Transcription result
     */
    async transcribeFromStream(stream, options = {}) {
        if (!this.apiKey) {
            throw new Error('RevAI API key is required. Set REVAI_API_KEY environment variable.');
        }

        const filename = options.filename || 'audio.wav';
        const mimetype = options.mimetype || 'audio/wav';

        // Step 1: Submit the job
        const formData = new FormData();
        formData.append('media', stream, {
            filename: filename,
            contentType: mimetype
        });

        // Add optional parameters
        // Skip diarization by default for faster processing (unless explicitly requested)
        const skipDiarization = options.skipDiarization !== undefined 
            ? options.skipDiarization 
            : (options.enableDiarization !== true); // Default to skipping unless enabled
        
        if (options.skipPunctuation !== undefined) {
            formData.append('skip_punctuation', options.skipPunctuation);
        }
        if (skipDiarization) {
            formData.append('skip_diarization', 'true');
        }
        if (options.speakerChannelsCount) {
            formData.append('speaker_channels_count', options.speakerChannelsCount);
        }
        if (options.customVocabularyId) {
            formData.append('custom_vocabulary_id', options.customVocabularyId);
        }
        if (options.filterProfanity !== undefined) {
            formData.append('filter_profanity', options.filterProfanity);
        }
        if (options.removeDisfluencies !== undefined) {
            formData.append('remove_disfluencies', options.removeDisfluencies);
        }
        if (options.skipNumeralFormatting !== undefined) {
            formData.append('skip_numeral_formatting', options.skipNumeralFormatting);
        }
        if (options.language) {
            formData.append('language', options.language);
        }

        let jobId;
        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/jobs`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    timeout: 30000 // 30 seconds for job submission
                }
            );

            jobId = response.data.id;
            console.log(`RevAI job submitted: ${jobId}`);
        } catch (error) {
            console.error("RevAI Job Submission Error:", {
                hasResponse: !!error.response,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });

            if (error.response) {
                const errorData = error.response.data;
                const errorMessage = errorData?.error?.message || errorData?.message || error.message;
                throw new Error(
                    `RevAI API error (${error.response.status}): ${errorMessage}`
                );
            } else if (error.request) {
                throw new Error(
                    `RevAI API unreachable: ${error.message}. Check your internet connection and API key.`
                );
            } else {
                throw new Error(`RevAI transcription error: ${error.message}`);
            }
        }

        // Step 2: Poll for job completion
        const transcript = await this._pollForTranscript(jobId);
        
        return {
            text: transcript,
            raw: { jobId, transcript },
            jobId: jobId
        };
    }

    /**
     * Poll for job completion and retrieve transcript
     * Uses adaptive polling for faster completion detection
     * 
     * @private
     * @param {string} jobId - Job ID from submission
     * @returns {Promise<string>} Transcript text
     */
    async _pollForTranscript(jobId) {
        let attempts = 0;
        let currentPollInterval = this.pollInterval;
        let lastStatus = null;
        const startTime = Date.now();
        
        while (attempts < this.maxPollAttempts) {
            try {
                const response = await axios.get(
                    `${this.apiBaseUrl}/jobs/${jobId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        timeout: 10000
                    }
                );

                const status = response.data.status;
                const elapsedTime = Date.now() - startTime;
                
                // Log status every 5 seconds to avoid spam
                if (attempts % 5 === 0 || status !== lastStatus) {
                    console.log(`RevAI job ${jobId} status: ${status} (${Math.round(elapsedTime / 1000)}s elapsed)`);
                }
                lastStatus = status;

                if (status === 'transcribed') {
                    // Job is complete, get the transcript
                    console.log(`RevAI job ${jobId} completed in ${Math.round(elapsedTime / 1000)}s`);
                    return await this._getTranscript(jobId);
                } else if (status === 'failed') {
                    const failureReason = response.data.failure || response.data.failure_reason || 'Unknown error';
                    throw new Error(`RevAI transcription job failed: ${failureReason}`);
                } else if (status === 'in_progress') {
                    // Adaptive polling: poll more frequently initially, then back off
                    if (this.adaptivePolling) {
                        // For first 10 seconds, poll every 500ms
                        if (elapsedTime < 10000) {
                            currentPollInterval = 500;
                        }
                        // For next 30 seconds, poll every 1 second
                        else if (elapsedTime < 40000) {
                            currentPollInterval = 1000;
                        }
                        // After that, poll every 2 seconds
                        else {
                            currentPollInterval = 2000;
                        }
                    }
                    
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, currentPollInterval));
                } else {
                    // Unknown status, continue polling
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, currentPollInterval));
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    throw new Error(`RevAI job not found: ${jobId}`);
                }
                
                // For other errors, retry a few times
                if (attempts < 3) {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, currentPollInterval));
                    continue;
                }
                
                throw new Error(`Error polling RevAI job: ${error.message}`);
            }
        }

        throw new Error(`RevAI transcription timed out after ${this.maxPollAttempts} attempts`);
    }

    /**
     * Get transcript from completed job
     * 
     * @private
     * @param {string} jobId - Job ID
     * @returns {Promise<string>} Transcript text
     */
    async _getTranscript(jobId) {
        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/jobs/${jobId}/transcript`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Accept': 'application/vnd.rev.transcript.v1.0+json'
                    },
                    timeout: 30000
                }
            );

            // RevAI returns transcript in a structured format
            // Extract text from monologues
            const transcript = response.data;
            let transcriptText = '';

            if (transcript.monologues && Array.isArray(transcript.monologues)) {
                transcriptText = transcript.monologues
                    .map(monologue => {
                        if (monologue.elements && Array.isArray(monologue.elements)) {
                            return monologue.elements
                                .map(element => element.value || '')
                                .join('');
                        }
                        return '';
                    })
                    .join(' ')
                    .trim();
            }

            // Fallback: if no monologues, try to extract from other fields
            if (!transcriptText && transcript.text) {
                transcriptText = transcript.text;
            }

            return transcriptText || '';
        } catch (error) {
            console.error("RevAI Transcript Retrieval Error:", {
                jobId,
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });

            if (error.response) {
                const errorData = error.response.data;
                const errorMessage = errorData?.error?.message || errorData?.message || error.message;
                throw new Error(
                    `RevAI transcript retrieval error (${error.response.status}): ${errorMessage}`
                );
            }
            throw new Error(`Error retrieving RevAI transcript: ${error.message}`);
        }
    }

    /**
     * Transcribe audio from a Buffer
     * 
     * @param {Buffer} buffer - Audio file buffer
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Transcription result
     */
    async transcribeFromBuffer(buffer, options = {}) {
        const { Readable } = await import('stream');
        const stream = Readable.from(buffer);
        return this.transcribeFromStream(stream, options);
    }

    /**
     * Get transcript text from transcription result
     * 
     * @param {Object} result - Transcription result from API
     * @returns {string} Transcript text
     */
    getTranscript(result) {
        if (typeof result === 'string') {
            return result;
        }
        return result?.text || result?.transcript || result?.transcription || '';
    }

    /**
     * Update configuration
     * 
     * @param {Object} options - Configuration options to update
     */
    configure(options) {
        if (options.apiKey) this.apiKey = options.apiKey;
        if (options.apiBaseUrl) this.apiBaseUrl = options.apiBaseUrl;
        if (options.timeout) this.timeout = options.timeout;
        if (options.pollInterval) this.pollInterval = options.pollInterval;
        if (options.maxPollAttempts) this.maxPollAttempts = options.maxPollAttempts;
        if (options.adaptivePolling !== undefined) this.adaptivePolling = options.adaptivePolling;
    }

    /**
     * Get current configuration
     * 
     * @returns {Object} Current configuration (without sensitive data)
     */
    getConfig() {
        return {
            apiBaseUrl: this.apiBaseUrl,
            timeout: this.timeout,
            pollInterval: this.pollInterval,
            maxPollAttempts: this.maxPollAttempts,
            apiKeySet: !!this.apiKey
        };
    }

    /**
     * Check if the RevAI service is accessible
     * @returns {Promise<boolean>} True if service is available
     */
    async isHealthy() {
        try {
            // RevAI doesn't have a health endpoint, so we'll check by making a minimal request
            // We can check the API base URL or just verify the API key is set
            return !!this.apiKey;
        } catch (error) {
            console.warn('RevAI health check failed:', error.message);
            return false;
        }
    }
}

// Export default instance
const revai = new RevAI();

// Export class for custom instances
export { RevAI };

// Export default instance
export default revai;

