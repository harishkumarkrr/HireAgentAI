import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from "@google/genai";
import { Mic, MicOff, PhoneOff, User, Bot, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { float32ToInt16, base64EncodeAudio, base64DecodeAudio, int16ToFloat32 } from '../utils/audio';
import { responseService } from '../services/formService';
import { Form, TranscriptEntry } from '../types';

interface VoiceAgentProps {
  form: Form;
  responseId: string;
  respondentName: string;
  onComplete: () => void;
}

export default function VoiceAgent({ form, responseId, respondentName, onComplete }: VoiceAgentProps) {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [localTranscript, setLocalTranscript] = useState<TranscriptEntry[]>([]);
  const [currentQuestionNum, setCurrentQuestionNum] = useState(1);
  
  const [agentVolume, setAgentVolume] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const userVolumeRef = useRef(0);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const answersRef = useRef<Record<string, string>>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const lastAgentMessageRef = useRef<string>("");
  const lastAgentSpeakTimeRef = useRef<number>(0);
  const isAgentSpeakingRef = useRef(false);
  const lastUserTextRef = useRef<string>("");
  
  const isActiveRef = useRef(false);
  
  useEffect(() => {
    isActiveRef.current = isActive;
    isAgentSpeakingRef.current = isAgentSpeaking;
    if (isAgentSpeaking) {
      lastAgentSpeakTimeRef.current = Date.now();
    }
    console.log("VoiceAgent state - isActive:", isActive, "isConnecting:", isConnecting, "isFinished:", isFinished);
  }, [isActive, isConnecting, isFinished, isAgentSpeaking]);

  useEffect(() => {
    if (isFinished) {
      const timer = setTimeout(() => {
        onComplete();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isFinished, onComplete]);

  const cleanup = useCallback(() => {
    isActiveRef.current = false;
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsActive(false);
    setIsConnecting(false);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
  }, []);

  const debouncedSaveTranscript = useCallback(async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await responseService.updateResponse(responseId, {
          transcript: transcriptRef.current
        });
      } catch (err) {
        console.error("Debounced transcript save failed:", err);
      }
    }, 2000);
  }, [responseId]);

  const playNextInQueue = useCallback(() => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    setIsAgentSpeaking(true);
    isAgentSpeakingRef.current = true;
    lastAgentSpeakTimeRef.current = Date.now();
    
    // If we are falling behind, reset the play time
    if (nextPlayTimeRef.current < audioContextRef.current.currentTime) {
      nextPlayTimeRef.current = audioContextRef.current.currentTime + 0.02; // very small buffer
    }

      while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift()!;
        
        // Calculate volume for animation
        let sum = 0;
        for (let i = 0; i < chunk.length; i++) {
          sum += chunk[i] * chunk[i];
        }
        const rms = Math.sqrt(sum / chunk.length);
        setAgentVolume(rms);

        // Gemini Live API typically outputs at 24000Hz
        const buffer = audioContextRef.current.createBuffer(1, chunk.length, 24000);
        buffer.getChannelData(0).set(chunk);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;
      
      source.onended = () => {
        if (audioContextRef.current && audioContextRef.current.currentTime >= nextPlayTimeRef.current - 0.1) {
          setIsAgentSpeaking(false);
          isAgentSpeakingRef.current = false;
          lastAgentSpeakTimeRef.current = Date.now();
          setAgentVolume(0);
        }
      };
    }
  }, []);

  const startSession = async () => {
    try {
      console.log("Starting voice session for form:", form.id, "Title:", form.title, "Voice:", form.voice);
      console.log("Questions:", form.questions);
      setIsConnecting(true);
      setError(null);
      transcriptRef.current = [];
      answersRef.current = {};
      setCurrentQuestionNum(1);
      setLocalTranscript([]);

      // Check for API key selection if required by the platform
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await aistudio.openSelectKey();
          // After opening the dialog, we assume the user will select a key.
          // The platform will refresh or we can proceed.
        }
      }

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || (process.env as any).API_KEY;
      console.log("API Key present:", !!apiKey);
      
      if (!apiKey) {
        console.error("API Key is missing");
        setError("API Key is missing. If you are accessing this outside of AI Studio, please ensure the agent is properly shared and configured.");
        setIsConnecting(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Use 16000Hz for input as recommended, but we'll handle 24000Hz for output playback
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      console.log("Requesting microphone access...");
      streamRef.current = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
      // Reduced buffer size for lower latency (1024 samples @ 16kHz ~= 64ms)
      processorRef.current = audioContextRef.current.createScriptProcessor(1024, 1, 1);
      
      // Ensure context is running
      if (audioContextRef.current.state === 'suspended') {
        console.log("Resuming suspended AudioContext...");
        await audioContextRef.current.resume();
      }
      
      const modelName = import.meta.env.VITE_VOICE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025";
      const selectedVoice = form.voice || "Zephyr";
      
      console.log("--- Gemini Live API Connection ---");
      console.log("Model:", modelName);
      console.log("Voice:", selectedVoice);
      console.log("Form ID:", form.id);
      console.log("----------------------------------");

      const sessionPromise = ai.live.connect({
        model: modelName,
        config: {
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          temperature: 0.5, // Lower temperature for more focused responses
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a friendly and casual AI assistant conducting a chat for "${form.title}".
          Respondent: ${respondentName}
          
          Current Progress:
          - Questions Answered: ${Object.keys(answersRef.current).length}
          - Total Questions: ${form.questions.length}
          
          Tone & Style:
          - Talk naturally and casually, like a friend. 
          - Use phrases like "Got it!", "Cool," "That makes sense," or "Awesome."
          - Don't be too formal or robotic.
          
          Protocol:
          1. Greet the user casually and ask the first question.
          2. LISTEN carefully. Ignore any echoes of your own voice.
          3. When you get an answer, call 'save_answer' and then move to the next thing.
          4. IMPORTANT: NEVER ask the same question twice. If you've already asked it and got an answer, move on.
          5. After the last question, say something like "Thanks a ton for your time! Have a fantastic day!" and then call 'finish_form'.
          
          Questions:
          ${form.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
          
          CRITICAL RULES:
          - Do NOT answer your own questions.
          - Do NOT repeat questions that are already answered in the 'Current Progress'.
          - If the user is vague, just ask "Could you tell me a bit more about that?" in a friendly way.
          - You have full memory of this conversation.
          - WAIT for the user to finish speaking. Do not interrupt.`,
          tools: [{
            functionDeclarations: [
              {
                name: "save_answer",
                description: "Saves the answer to the CURRENT question being discussed. Call this ONLY after the user has provided a fresh answer to the question you just asked.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING, description: "The question being answered" },
                    answer: { type: Type.STRING, description: "The answer provided by the user" }
                  },
                  required: ["question", "answer"]
                }
              },
              {
                name: "finish_form",
                description: "Marks the form as completed.",
                parameters: { type: Type.OBJECT, properties: {} }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live session opened successfully");
            setIsConnecting(false);
            setIsActive(true);
            isActiveRef.current = true; // Set it immediately to be sure
            
            // Send a minimal trigger to start the conversation
            sessionPromise.then(session => {
              sessionRef.current = session; // Store session for faster access
              console.log("Sending start trigger...");
              session.sendRealtimeInput({
                text: "Please start the form now. Greet the user and ask the first question."
              });
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData) {
                  const audioData = base64DecodeAudio(part.inlineData.data);
                  const floatData = int16ToFloat32(audioData);
                  audioQueueRef.current.push(floatData);
                  playNextInQueue();
                }
                if (part.text) {
                  console.log("Agent Text Part:", part.text);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              console.log("Session interrupted");
              audioQueueRef.current = [];
              nextPlayTimeRef.current = 0;
              setIsAgentSpeaking(false);
            }

            // Handle Transcriptions and save to DB
            const serverContent = message.serverContent as any;
            
            // 1. Handle Agent Transcription
            const agentText = serverContent?.modelTurn?.parts?.find((p: any) => p.text)?.text;
            if (agentText) {
              console.log("Agent Transcription:", agentText);
              lastAgentMessageRef.current = agentText;
              
              setLocalTranscript(prev => [...prev.slice(-4), { role: 'agent', text: agentText, timestamp: new Date().toISOString() }]);
              
              const newEntry: TranscriptEntry = {
                role: 'agent',
                text: agentText,
                timestamp: new Date().toISOString()
              };
              
              const lastEntry = transcriptRef.current[transcriptRef.current.length - 1];
              if (!lastEntry || lastEntry.text !== agentText || lastEntry.role !== 'agent') {
                transcriptRef.current.push(newEntry);
                debouncedSaveTranscript();
              }
            }

            // 2. Handle User Transcription
            const userText = serverContent?.userTurn?.parts?.find((p: any) => p.text)?.text;
            if (userText) {
              console.log("User Transcription (Raw):", userText);
              
              // ECHO CANCELLATION: If agent is speaking or just finished, check if userText is just an echo
              const now = Date.now();
              const isAgentTalking = isAgentSpeakingRef.current || (now - lastAgentSpeakTimeRef.current < 2000);
              
              const isEcho = isAgentTalking && 
                            lastAgentMessageRef.current && 
                            (userText.toLowerCase().includes(lastAgentMessageRef.current.toLowerCase().substring(0, 10)) || 
                             lastAgentMessageRef.current.toLowerCase().includes(userText.toLowerCase()));

              if (isEcho) {
                console.log("Filtered out echo:", userText);
                return;
              }

              // If the agent is currently speaking, we ignore user input to prevent self-answering
              if (isAgentSpeakingRef.current) {
                console.log("Ignoring user input while agent is speaking:", userText);
                return;
              }

              // Avoid duplicate user transcriptions
              if (userText === lastUserTextRef.current) return;
              lastUserTextRef.current = userText;

              setLocalTranscript(prev => [...prev.slice(-4), { role: 'user', text: userText, timestamp: new Date().toISOString() }]);
              
              const newEntry: TranscriptEntry = {
                role: 'user',
                text: userText,
                timestamp: new Date().toISOString()
              };
              
              const lastEntry = transcriptRef.current[transcriptRef.current.length - 1];
              if (!lastEntry || lastEntry.text !== userText || lastEntry.role !== 'user') {
                transcriptRef.current.push(newEntry);
                debouncedSaveTranscript();
              }
            }
            
            const toolCall = message.toolCall;
            if (toolCall?.functionCalls) {
              for (const fc of toolCall.functionCalls) {
                console.log("Function call received:", fc.name, fc.args);
                if (fc.name === 'save_answer') {
                  try {
                    const { question, answer } = fc.args as any;
                    
                    if (!answer || answer.trim().length < 1) {
                      sessionPromise.then(session => {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            id: fc.id,
                            response: { success: false, error: "Answer cannot be blank." }
                          }]
                        });
                      });
                      continue;
                    }

                    // Update local cache and Firestore optimistically
                    answersRef.current[question] = answer;
                    responseService.updateResponse(responseId, {
                      answers: { ...answersRef.current }
                    }).catch(err => console.error("Background answer save failed:", err));
                    
                    const qIndex = form.questions.indexOf(question);
                    if (qIndex !== -1) {
                      setCurrentQuestionNum(Math.min(qIndex + 2, form.questions.length));
                    }

                    sessionPromise.then(session => {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          id: fc.id,
                          response: { success: true }
                        }]
                      });
                    });
                  } catch (saveErr) {
                    console.error("Error saving answer via tool:", saveErr);
                    // Inform the agent that saving failed
                    sessionPromise.then(session => {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          id: fc.id,
                          response: { success: false, error: "Failed to save answer to database." }
                        }]
                      });
                    });
                  }
                } else if (fc.name === 'finish_form') {
                  try {
                    await responseService.updateResponse(responseId, { status: 'completed' });
                    
                    // Perform AI analysis on the transcript
                    try {
                      const currentResponse = await responseService.getResponse(responseId);
                      if (currentResponse?.transcript && currentResponse.transcript.length > 0) {
                        const transcriptText = currentResponse.transcript
                          .map(t => `${t.role === 'user' ? 'Candidate' : 'AI Agent'}: ${t.text}`)
                          .join('\n');
                        
                        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                        
                        const analysisPrompt = `
                          Analyze the following interview/form transcript and provide:
                          1. A sentiment score (one word: Positive, Neutral, or Negative).
                          2. A concise AI summary of the candidate's responses (max 2 sentences).
                          
                          Transcript:
                          ${transcriptText}
                          
                          Return the result in JSON format:
                          {
                            "sentiment": "Positive/Neutral/Negative",
                            "aiSummary": "Summary text here"
                          }
                        `;
                        
                        const result = await ai.models.generateContent({
                          model: "gemini-3-flash-preview",
                          contents: [{ parts: [{ text: analysisPrompt }] }]
                        });
                        const responseText = result.text;
                        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                        
                        if (jsonMatch) {
                          const analysis = JSON.parse(jsonMatch[0]);
                          await responseService.updateResponse(responseId, {
                            sentiment: analysis.sentiment,
                            aiSummary: analysis.aiSummary
                          });
                        }
                      }
                    } catch (analysisErr) {
                      console.error("AI Analysis failed:", analysisErr);
                    }

                    // Delay finishing to allow the agent to finish its final "Thank you" sentence
                    setTimeout(() => {
                      if (isActiveRef.current) {
                        setIsFinished(true);
                        cleanup();
                      }
                    }, 6000);
                    
                    sessionPromise.then(session => {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          id: fc.id,
                          response: { success: true }
                        }]
                      });
                    });
                  } catch (finishErr) {
                    console.error("Error finishing form via tool:", finishErr);
                  }
                }
              }
            }
          },
          onclose: (event) => {
            console.log("Gemini Live session closed by server. Event:", event);
            cleanup();
          },
          onerror: (err) => {
            console.error("Gemini Live error details:", err);
            setError("Connection error: " + (err instanceof Error ? err.message : "Unknown error"));
            cleanup();
          }
        }
      });

      sessionRef.current = await sessionPromise;

      let audioSentCount = 0;
      processorRef.current.onaudioprocess = (e) => {
        if (isActiveRef.current && sessionRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Simple volume detection
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          userVolumeRef.current = rms;
          
          // Threshold for "speaking" with a small debounce
          // If agent is speaking, we raise the threshold to avoid echo triggering the indicator
          const threshold = isAgentSpeakingRef.current ? 0.08 : 0.01;
          const isLoud = rms > threshold;
          
          if (isLoud && !isUserSpeaking) {
            setIsUserSpeaking(true);
          } else if (!isLoud && isUserSpeaking) {
            // Wait a bit before setting to false to handle natural pauses
            setTimeout(() => {
              if (userVolumeRef.current <= threshold) {
                setIsUserSpeaking(false);
              }
            }, 500);
          }

          const pcmData = float32ToInt16(inputData);
          const base64Data = base64EncodeAudio(pcmData);
          
          try {
            sessionRef.current.sendRealtimeInput({
              media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
            });
            audioSentCount++;
          } catch (sendErr) {
            console.error("Error sending audio:", sendErr);
          }
        }
      };

      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      console.log("Audio nodes connected. Context state:", audioContextRef.current.state);

    } catch (err) {
      console.error("Failed to start session:", err);
      setError(err instanceof Error ? err.message : "Could not access microphone or connect to AI.");
      cleanup();
    }
  };

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  if (isFinished) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center p-12 space-y-6 bg-white rounded-3xl shadow-xl border border-emerald-100 text-center"
      >
        <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-gray-900">Thank You!</h2>
          <p className="text-gray-500">Your responses have been recorded successfully.</p>
          <p className="text-sm text-gray-400 mt-4">Redirecting to home in 5 seconds...</p>
        </div>
        <button
          onClick={onComplete}
          className="px-8 py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-all"
        >
          Close
        </button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-8 bg-white rounded-3xl shadow-xl border border-black/5 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-gray-900">{form.title}</h2>
        <p className="text-gray-500">Speaking with: <span className="font-semibold text-gray-700">{respondentName}</span></p>
      </div>

      <div className="relative flex items-center justify-center w-64 h-64">
        <AnimatePresence>
          {isActive && (
            <>
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: isAgentSpeaking ? 1.5 : 1.2, opacity: 0.1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 1, repeat: Infinity, repeatType: "reverse" }}
                className="absolute inset-0 bg-emerald-500 rounded-full"
              />
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: isAgentSpeaking ? 1.8 : 1.4, opacity: 0.05 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse", delay: 0.2 }}
                className="absolute inset-0 bg-emerald-500 rounded-full"
              />
            </>
          )}
        </AnimatePresence>

        <div className={`relative z-10 flex items-center justify-center w-48 h-48 rounded-full border-4 transition-all duration-500 ${isActive ? 'bg-emerald-50 border-emerald-500 shadow-emerald-200 shadow-2xl' : 'bg-gray-50 border-gray-200'}`}>
          {isConnecting ? (
            <Loader2 className="w-16 h-16 text-emerald-500 animate-spin" />
          ) : isActive ? (
            <div className="relative flex flex-col items-center">
              <svg width="120" height="120" viewBox="0 0 120 120" className="text-emerald-600">
                {/* Head */}
                <circle cx="60" cy="60" r="50" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" />
                {/* Eyes */}
                <circle cx="45" cy="50" r="4" fill="currentColor" />
                <circle cx="75" cy="50" r="4" fill="currentColor" />
                {/* Mouth (Option 1: SVG Morphing) */}
                <motion.path
                  d={isAgentSpeaking ? `M 40 80 Q 60 ${80 + agentVolume * 100} 80 80` : "M 45 80 Q 60 80 75 80"}
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  animate={{
                    d: isAgentSpeaking 
                      ? `M 40 80 Q 60 ${80 + Math.max(5, agentVolume * 150)} 80 80` 
                      : "M 45 80 Q 60 82 75 80"
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                />
              </svg>
              {isUserSpeaking && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute -top-4 -right-4 bg-emerald-500 text-white p-2 rounded-full shadow-lg"
                >
                  <Mic className="w-4 h-4 animate-pulse" />
                </motion.div>
              )}
            </div>
          ) : (
            <MicOff className="w-20 h-20 text-gray-300" />
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 text-red-700 bg-red-50 rounded-xl border border-red-100">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="flex gap-4">
        {!isActive && !isConnecting ? (
          <button
            onClick={startSession}
            className="flex items-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-semibold shadow-lg shadow-emerald-200 transition-all active:scale-95"
          >
            <Mic className="w-5 h-5" />
            Start Conversation
          </button>
        ) : (
          <button
            onClick={() => {
              cleanup();
              setIsFinished(true);
            }}
            className="flex items-center gap-2 px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold shadow-lg shadow-red-200 transition-all active:scale-95"
          >
            <PhoneOff className="w-5 h-5" />
            End Call
          </button>
        )}
      </div>

      <div className="w-full space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Conversation</h3>
            <button 
              onClick={() => setShowDebug(!showDebug)}
              className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-500 px-2 py-0.5 rounded transition-colors"
            >
              {showDebug ? 'Hide Logs' : 'Show Logs'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {isActive && (
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">
                Question {currentQuestionNum} of {form.questions.length}
              </span>
            )}
            <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
              {isActive ? 'Live' : 'Disconnected'}
            </span>
          </div>
        </div>
        
        <div className={`p-6 bg-gray-50 rounded-3xl border border-gray-100 transition-all duration-300 ${showDebug ? 'min-h-[300px] max-h-[500px]' : 'min-h-[160px] max-h-[300px]'} overflow-y-auto space-y-4`}>
          {isActive ? (
            localTranscript.length > 0 ? (
              <div className="space-y-3">
                {localTranscript.map((entry, idx) => (
                  <div key={idx} className={`flex flex-col ${entry.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <span className="text-[9px] text-gray-400 mb-1 px-2">
                      {entry.role === 'user' ? respondentName : 'AI Agent'}
                    </span>
                    <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                      entry.role === 'user' 
                        ? 'bg-emerald-600 text-white rounded-tr-none' 
                        : 'bg-white text-gray-900 border border-gray-200 rounded-tl-none shadow-sm'
                    }`}>
                      {entry.text}
                    </div>
                  </div>
                ))}
                {isAgentSpeaking && (
                  <div className="flex justify-start">
                    <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-gray-200 shadow-sm">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                {isUserSpeaking && !isAgentSpeaking && (
                  <div className="flex justify-end">
                    <div className="bg-emerald-50 p-3 rounded-2xl rounded-tr-none border border-emerald-100 italic text-xs text-emerald-600">
                      User is speaking...
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-600 italic text-center py-8">
                {isAgentSpeaking ? "Agent is introducing..." : isUserSpeaking ? "User is speaking..." : "Waiting for conversation to start..."}
              </p>
            )
          ) : (
            <p className="text-gray-400 text-center py-8">Click start to begin the voice conversation.</p>
          )}
        </div>
      </div>
    </div>
  );
}
