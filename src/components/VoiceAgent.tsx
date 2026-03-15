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
  const [isFinished, setIsFinished] = useState(false);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  const isActiveRef = useRef(false);
  
  useEffect(() => {
    isActiveRef.current = isActive;
    console.log("VoiceAgent state - isActive:", isActive, "isConnecting:", isConnecting, "isFinished:", isFinished);
  }, [isActive, isConnecting, isFinished]);

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
  }, []);

  const playNextInQueue = useCallback(() => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0 || isPlayingRef.current) {
      return;
    }

    isPlayingRef.current = true;
    setIsAgentSpeaking(true);
    const chunk = audioQueueRef.current.shift()!;
    const buffer = audioContextRef.current.createBuffer(1, chunk.length, 16000);
    buffer.getChannelData(0).set(chunk);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      if (audioQueueRef.current.length === 0) {
        setIsAgentSpeaking(false);
      }
      playNextInQueue();
    };
    source.start();
  }, []);

  const startSession = async () => {
    try {
      console.log("Starting voice session for form:", form.id, "Title:", form.title);
      console.log("Questions:", form.questions);
      setIsConnecting(true);
      setError(null);

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

      const apiKey = process.env.GEMINI_API_KEY || (process.env as any).API_KEY;
      console.log("API Key present:", !!apiKey);
      
      if (!apiKey) {
        console.error("API Key is missing");
        setError("API Key is missing. If you are accessing this outside of AI Studio, please ensure the agent is properly shared and configured.");
        setIsConnecting(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Use 16000Hz as recommended in the Live API examples
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      console.log("Requesting microphone access...");
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      // Ensure context is running
      if (audioContextRef.current.state === 'suspended') {
        console.log("Resuming suspended AudioContext...");
        await audioContextRef.current.resume();
      }
      
      console.log("Connecting to Gemini Live API...");
      const sessionPromise = ai.live.connect({
        model: import.meta.env.VITE_VOICE_MODEL || "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: form.voice || "Zephyr" } },
          },
          systemInstruction: `You are a helpful AI agent conducting a conversational form titled "${form.title}".
          Description: ${form.description}
          Respondent Name: ${respondentName}
          
          Language: ${
            {
              'en-US': 'English (US)',
              'en-IN': 'English (India)',
              'hi-IN': 'Hindi',
              'te-IN': 'Telugu',
              'kn-IN': 'Kannada',
              'ml-IN': 'Malayalam',
              'es-ES': 'Spanish',
              'zh-CN': 'Chinese',
              'ko-KR': 'Korean',
              'ja-JP': 'Japanese'
            }[form.language] || 'English'
          }

          Your goal is to ask the following questions one by one:
          ${form.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

          Guidelines:
          - Start the conversation immediately by greeting the user and asking the first question.
          - Be professional and warm.
          - Speak in the specified language.
          - Ask one question at a time.
          - Listen to the answer, acknowledge it briefly, and move to the next.
          - If the user's answer is unclear, politely ask them to repeat or clarify.
          - Use the 'save_answer' tool to save each answer as you collect it.
          - Once all questions are answered, thank the user and tell them the form is complete. Then use the 'finish_form' tool.`,
          tools: [{
            functionDeclarations: [
              {
                name: "save_answer",
                description: "Saves an answer to a specific question.",
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
            
            // Send an initial greeting to trigger the agent to start the conversation
            sessionPromise.then(session => {
              console.log("Sending initial greeting to start conversation...");
              session.sendRealtimeInput({
                text: "Hello! I am ready to start the form. Please introduce yourself and ask the first question."
              });
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              console.log("Received audio parts from agent");
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData) {
                  const audioData = base64DecodeAudio(part.inlineData.data);
                  const floatData = int16ToFloat32(audioData);
                  audioQueueRef.current.push(floatData);
                  playNextInQueue();
                }
              }
            }

            if (message.serverContent?.interrupted) {
              console.log("Session interrupted");
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setIsAgentSpeaking(false);
            }
            
            const toolCall = message.toolCall;
            if (toolCall?.functionCalls) {
              for (const fc of toolCall.functionCalls) {
                console.log("Function call received:", fc.name, fc.args);
                if (fc.name === 'save_answer') {
                  try {
                    const { question, answer } = fc.args as any;
                    // Fetch current response to merge answers safely
                    const currentResponse = await responseService.getResponse(responseId);
                    const currentAnswers = currentResponse?.answers || {};
                    
                    await responseService.updateResponse(responseId, {
                      answers: { ...currentAnswers, [question]: answer }
                    });
                    
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
                    setIsFinished(true);
                    cleanup();
                    
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
        if (isActiveRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Check if there's actual audio signal
          let hasSignal = false;
          for (let i = 0; i < inputData.length; i++) {
            if (Math.abs(inputData[i]) > 0.01) {
              hasSignal = true;
              break;
            }
          }

          const pcmData = float32ToInt16(inputData);
          const base64Data = base64EncodeAudio(pcmData);
          
          if (audioSentCount % 100 === 0) {
            console.log("Audio processor running. Sent chunks:", audioSentCount, "Signal detected:", hasSignal);
          }
          audioSentCount++;

          sessionPromise.then(session => {
            try {
              session.sendRealtimeInput({
                media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
              });
            } catch (sendErr) {
              // Ignore errors during transition/closing
            }
          });
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
            <Bot className={`w-20 h-20 text-emerald-600 ${isAgentSpeaking ? 'animate-pulse' : ''}`} />
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
              onComplete();
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
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Status</h3>
          <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
            {isActive ? 'Live' : 'Disconnected'}
          </span>
        </div>
        
        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 min-h-[100px] max-h-[200px] overflow-y-auto">
          {isActive ? (
            <p className="text-gray-600 italic text-center py-4">
              {isAgentSpeaking ? "Agent is speaking..." : "Listening to you..."}
            </p>
          ) : (
            <p className="text-gray-400 text-center py-4">Click start to begin the voice conversation.</p>
          )}
        </div>
      </div>
    </div>
  );
}
