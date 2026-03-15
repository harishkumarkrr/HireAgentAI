import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import { auth } from './firebase';
import { formService, responseService } from './services/formService';
import { Form, FormResponse } from './types';
import VoiceAgent from './components/VoiceAgent';
import ErrorBoundary from './components/ErrorBoundary';
import { 
  LogOut, 
  Plus, 
  ClipboardList, 
  ChevronRight, 
  CheckCircle2, 
  Clock, 
  User as UserIcon,
  Briefcase,
  Mail,
  ArrowLeft,
  Share2,
  Copy,
  Globe,
  Settings,
  MessageSquare,
  FileText,
  Trash2,
  Download,
  FileSpreadsheet,
  FileJson,
  Edit2,
  Save,
  X,
  Loader2,
  AlertCircle,
  Play,
  Volume2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import { GoogleGenAI, Modality } from "@google/genai";

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'home' | 'create' | 'respond' | 'dashboard' | 'responses' | 'response-detail'>('home');
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [selectedResponse, setSelectedResponse] = useState<FormResponse | null>(null);
  const [isEditingResponse, setIsEditingResponse] = useState(false);
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  const [isDeploying, setIsDeploying] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [showConfirm, setShowConfirm] = useState<{ type: 'agent' | 'response', id: string } | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  
  // Form Creation State
  const [newForm, setNewForm] = useState({
    title: '',
    description: '',
    questions: '',
    language: 'en-US',
    voice: 'Zephyr'
  });

  // Respondent State
  const [respondentInfo, setRespondentInfo] = useState({ name: '', email: '' });
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Handle URL parameters for direct form access
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const formId = params.get('f');
    if (formId) {
      formService.getForm(formId).then(f => {
        if (f) {
          setSelectedForm(f);
          setView('respond');
        }
      });
    }
  }, []);

  useEffect(() => {
    if (user && view === 'dashboard') {
      const unsubscribe = formService.subscribeToUserForms((data) => {
        setForms(data);
      });
      return () => unsubscribe();
    }
  }, [user, view]);

  useEffect(() => {
    if (user && view === 'responses' && selectedForm) {
      const unsubscribe = responseService.subscribeToFormResponses(selectedForm.id, (data) => {
        setResponses(data);
      });
      return () => unsubscribe();
    }
  }, [user, view, selectedForm]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/user-cancelled') {
        console.log("Sign-in was cancelled by the user.");
        // We don't necessarily need to show an alert, just log it and let the user try again
      } else {
        console.error("Login failed:", error);
        setToast({ message: "Login failed. Please ensure popups are allowed.", type: 'error' });
      }
    }
  };

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.title || !newForm.questions) return;
    
    setIsDeploying(true);
    try {
      const questionsList = newForm.questions.split('\n').filter(q => q.trim() !== '');
      const id = await formService.createForm(
        newForm.title, 
        newForm.description, 
        questionsList, 
        newForm.language, 
        newForm.voice
      );
      
      if (id) {
        setNewForm({ title: '', description: '', questions: '', language: 'en-US', voice: 'Zephyr' });
        setView('dashboard');
        setToast({ message: "Agent deployed successfully!", type: 'success' });
      } else {
        setToast({ message: "Failed to create agent. Please try again.", type: 'error' });
      }
    } catch (err) {
      console.error("Error deploying agent:", err);
      setToast({ message: "An error occurred while deploying the agent.", type: 'error' });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleDeleteForm = async (formId: string) => {
    await formService.deleteForm(formId);
    if (selectedForm?.id === formId) {
      setSelectedForm(null);
      setView('dashboard');
    }
    setShowConfirm(null);
    setToast({ message: "Agent deleted successfully.", type: 'success' });
  };

  const handleDeleteResponse = async (responseId: string) => {
    await responseService.deleteResponse(responseId);
    if (selectedResponse?.id === responseId) {
      setSelectedResponse(null);
      if (view === 'response-detail') {
        setView('responses');
      }
    }
    setShowConfirm(null);
    setToast({ message: "Response deleted successfully.", type: 'success' });
  };

  const handleUpdateResponse = async () => {
    if (!selectedResponse) return;
    await responseService.updateResponse(selectedResponse.id, { answers: editedAnswers });
    setIsEditingResponse(false);
    const updated = await responseService.getResponse(selectedResponse.id);
    if (updated) setSelectedResponse(updated);
  };

  const handleTestVoice = async () => {
    if (isTestingVoice) return;
    setIsTestingVoice(true);
    
    try {
      const apiKey = process.env.GEMINI_API_KEY || (process.env as any).API_KEY;
      if (!apiKey) {
        setToast({ message: "API Key missing. Cannot test voice.", type: 'error' });
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const sampleText = {
        'en-US': "Hello, I am your voice assistant. How can I help you today?",
        'en-IN': "Namaste, I am your voice assistant. How can I help you today?",
        'hi-IN': "नमस्ते, मैं आपका वॉयस असिस्टेंट हूं। मैं आज आपकी कैसे मदद कर सकता हूं?",
        'te-IN': "నమస్కారం, నేను మీ వాయిస్ అసిస్టెంట్. నేను మీకు ఎలా సహాయపడగలను?",
        'kn-IN': "ನಮಸ್ಕಾರ, ನಾನು ನಿಮ್ಮ ಧ್ವನಿ ಸಹಾಯಕ. ನಾನು ನಿಮಗೆ ಇಂದು ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?",
        'ml-IN': "നമസ്കാരം, ഞാൻ നിങ്ങളുടെ വോയിസ് അസിസ്റ്റന്റ് ആണ്. എനിക്ക് ഇന്ന് നിങ്ങളെ എങ്ങനെ സഹായിക്കാനാകും?",
        'es-ES': "Hola, soy tu asistente de voz. ¿Cómo puedo ayudarte hoy?",
        'zh-CN': "你好，我是你的语音助手。今天我能帮你什么忙？",
        'ko-KR': "안녕하세요, 저는 당신의 음성 비서입니다. 오늘 어떻게 도와드릴까요?",
        'ja-JP': "こんにちは、私はあなたの音声アシスタントです。今日はどのようなお手伝いができますか？"
      }[newForm.language] || "Hello, I am your voice assistant.";

      const response = await ai.models.generateContent({
        model: import.meta.env.VITE_TTS_MODEL || "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: sampleText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: newForm.voice as any },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        await audio.play();
      }
    } catch (err) {
      console.error("Voice test failed:", err);
      setToast({ message: "Voice test failed. Please try again.", type: 'error' });
    } finally {
      setIsTestingVoice(false);
    }
  };

  const exportToCSV = () => {
    if (!selectedForm || responses.length === 0) return;
    
    const data = responses.map(r => ({
      Respondent: r.respondentName,
      Email: r.respondentEmail,
      Status: r.status,
      Date: r.createdAt?.toDate?.()?.toLocaleString() || 'N/A',
      ...r.answers
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${selectedForm.title}_responses.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToPDF = () => {
    if (!selectedForm || responses.length === 0) return;
    
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text(selectedForm.title, 20, 20);
    doc.setFontSize(12);
    doc.text(`Responses Report - ${new Date().toLocaleDateString()}`, 20, 30);
    
    let y = 45;
    responses.forEach((r, i) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text(`${i + 1}. ${r.respondentName} (${r.respondentEmail})`, 20, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      Object.entries(r.answers).forEach(([q, a]) => {
        const text = `${q}: ${a}`;
        const splitText = doc.splitTextToSize(text, 170);
        doc.text(splitText, 25, y);
        y += (splitText.length * 7);
      });
      y += 10;
    });

    doc.save(`${selectedForm.title}_report.pdf`);
  };

  const exportToTXT = () => {
    if (!selectedForm || responses.length === 0) return;
    
    let content = `${selectedForm.title}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n\n`;
    
    responses.forEach((r, i) => {
      content += `------------------------------------------\n`;
      content += `Respondent: ${r.respondentName}\n`;
      content += `Email: ${r.respondentEmail}\n`;
      content += `Date: ${r.createdAt?.toDate?.()?.toLocaleString() || 'N/A'}\n\n`;
      Object.entries(r.answers).forEach(([q, a]) => {
        content += `${q}\nAnswer: ${a}\n\n`;
      });
      content += `\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${selectedForm.title}_responses.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleStartResponding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForm || !respondentInfo.name || !respondentInfo.email) return;

    const id = await responseService.createResponse(selectedForm.id, respondentInfo.name, respondentInfo.email);
    if (id) {
      setActiveResponseId(id);
    }
  };

  const copyShareLink = (formId: string) => {
    const link = `${window.location.origin}${window.location.pathname}?f=${formId}`;
    navigator.clipboard.writeText(link);
    setToast({ message: "Link copied to clipboard!", type: 'success' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-gray-900 font-sans">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
            <div className="bg-emerald-600 p-2 rounded-xl shadow-lg shadow-emerald-100">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">HireAgent <span className="text-emerald-600">AI</span></span>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <button 
                  onClick={() => setView('dashboard')}
                  className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${view === 'dashboard' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  My Agents
                </button>
                <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                  <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-gray-200" />
                  <button onClick={() => signOut(auth)} className="text-gray-400 hover:text-red-500 transition-colors">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </>
            ) : (
              <button 
                onClick={handleLogin}
                className="bg-gray-900 text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-gray-800 transition-all shadow-md active:scale-95"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center space-y-8 max-w-3xl mx-auto py-12"
            >
              <div className="space-y-4">
                <h1 className="text-6xl font-extrabold tracking-tight text-gray-900 leading-tight">
                  Google Forms, but <span className="text-emerald-600">Voice-Based</span>.
                </h1>
                <p className="text-xl text-gray-500 max-w-2xl mx-auto">
                  Create conversational agents that collect data through natural voice interaction. No app install, multilingual, and accessible to everyone.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
                <button 
                  onClick={() => user ? setView('create') : handleLogin()}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 text-white px-10 py-5 rounded-2xl text-lg font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 active:scale-95"
                >
                  <Plus className="w-6 h-6" />
                  Create Your Agent
                </button>
                <button 
                  onClick={() => user ? setView('dashboard') : handleLogin()}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-gray-900 border border-gray-200 px-10 py-5 rounded-2xl text-lg font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
                >
                  <ClipboardList className="w-6 h-6" />
                  Manage Agents
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-20">
                {[
                  { icon: Globe, title: "Multilingual", desc: "Collect data in any regional language effortlessly." },
                  { icon: CheckCircle2, title: "Structured Data", desc: "Get clean reports and full transcripts automatically." },
                  { icon: UserIcon, title: "Accessible", desc: "Perfect for low-literacy users and hands-free scenarios." }
                ].map((feature, i) => (
                  <div key={i} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow text-left space-y-4">
                    <div className="bg-emerald-50 w-12 h-12 rounded-2xl flex items-center justify-center">
                      <feature.icon className="w-6 h-6 text-emerald-600" />
                    </div>
                    <h3 className="text-xl font-bold">{feature.title}</h3>
                    <p className="text-gray-500 leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'create' && (
            <motion.div 
              key="create"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl mx-auto"
            >
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 space-y-8">
                <div className="flex justify-between items-center">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-bold tracking-tight">Create New Agent</h2>
                    <p className="text-gray-500">Configure your conversational form.</p>
                  </div>
                  <button onClick={() => setView('dashboard')} className="text-gray-400 hover:text-gray-600">
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleCreateForm} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Agent Title</label>
                    <input 
                      required
                      type="text" 
                      placeholder="e.g., Patient Intake Form"
                      className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      value={newForm.title}
                      onChange={e => setNewForm({...newForm, title: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Description (Optional)</label>
                    <textarea 
                      placeholder="What is this form for?"
                      className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all h-24 resize-none"
                      value={newForm.description}
                      onChange={e => setNewForm({...newForm, description: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Questions (One per line)</label>
                    <textarea 
                      required
                      placeholder="What is your name?&#10;How are you feeling today?&#10;What is your age?"
                      className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all h-48 resize-none font-mono text-sm"
                      value={newForm.questions}
                      onChange={e => setNewForm({...newForm, questions: e.target.value})}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">Language</label>
                      <select 
                        className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        value={newForm.language}
                        onChange={e => setNewForm({...newForm, language: e.target.value})}
                      >
                        <option value="en-US">English (US)</option>
                        <option value="en-IN">English (India)</option>
                        <option value="hi-IN">Hindi (हिंदी)</option>
                        <option value="te-IN">Telugu (తెలుగు)</option>
                        <option value="kn-IN">Kannada (ಕನ್ನಡ)</option>
                        <option value="ml-IN">Malayalam (മലയാളം)</option>
                        <option value="es-ES">Spanish (Español)</option>
                        <option value="zh-CN">Chinese (中文)</option>
                        <option value="ko-KR">Korean (한국어)</option>
                        <option value="ja-JP">Japanese (日本語)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-sm font-semibold text-gray-700">Voice</label>
                        <button 
                          type="button"
                          onClick={handleTestVoice}
                          disabled={isTestingVoice}
                          className="text-xs font-bold text-emerald-600 flex items-center gap-1 hover:underline disabled:opacity-50"
                        >
                          {isTestingVoice ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                          Test Voice
                        </button>
                      </div>
                      <select 
                        className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        value={newForm.voice}
                        onChange={e => setNewForm({...newForm, voice: e.target.value})}
                      >
                        <option value="Zephyr">Zephyr (Neutral)</option>
                        <option value="Puck">Puck (Friendly)</option>
                        <option value="Charon">Charon (Deep)</option>
                        <option value="Kore">Kore (Warm)</option>
                        <option value="Fenrir">Fenrir (Bold)</option>
                      </select>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={isDeploying}
                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isDeploying ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Deploying...
                      </>
                    ) : (
                      'Deploy Agent'
                    )}
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {view === 'respond' && selectedForm && (
            <motion.div 
              key="respond"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-2xl mx-auto"
            >
              {!activeResponseId ? (
                <div className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 space-y-8">
                  <div className="text-center space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">{selectedForm.title}</h2>
                    <p className="text-gray-500">{selectedForm.description}</p>
                  </div>

                  <form onSubmit={handleStartResponding} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">Your Name</label>
                      <input 
                        required
                        type="text" 
                        className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        value={respondentInfo.name}
                        onChange={e => setRespondentInfo({...respondentInfo, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">Your Email</label>
                      <input 
                        required
                        type="email" 
                        className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        value={respondentInfo.email}
                        onChange={e => setRespondentInfo({...respondentInfo, email: e.target.value})}
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95"
                    >
                      Start Voice Conversation
                    </button>
                  </form>
                </div>
              ) : (
                <VoiceAgent 
                  form={selectedForm}
                  responseId={activeResponseId}
                  respondentName={respondentInfo.name}
                  onComplete={() => setView('home')}
                />
              )}
            </motion.div>
          )}

          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <h2 className="text-4xl font-extrabold tracking-tight">My Agents</h2>
                  <p className="text-gray-500">Manage your conversational forms and view responses.</p>
                </div>
                <button 
                  onClick={() => setView('create')}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95"
                >
                  <Plus className="w-5 h-5" />
                  New Agent
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {forms.length === 0 ? (
                  <div className="col-span-full bg-white p-12 rounded-3xl border border-dashed border-gray-300 text-center space-y-4">
                    <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                      <MessageSquare className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-gray-500 font-medium">No agents created yet.</p>
                    <button 
                      onClick={() => setView('create')}
                      className="text-emerald-600 font-bold hover:underline"
                    >
                      Create your first conversational agent
                    </button>
                  </div>
                ) : (
                  forms.map((form) => (
                    <div key={form.id} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all group space-y-6">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <h3 className="text-2xl font-bold group-hover:text-emerald-600 transition-colors">{form.title}</h3>
                          <p className="text-gray-500 text-sm line-clamp-1">{form.description || 'No description'}</p>
                        </div>
                        <div className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-lg text-xs font-bold">
                          {form.questions.length} Questions
                        </div>
                      </div>

                        <div className="flex items-center gap-2 pt-4 border-t border-gray-50">
                          <button 
                            onClick={() => {
                              setSelectedForm(form);
                              setView('responses');
                            }}
                            className="flex-1 flex items-center justify-center gap-2 bg-gray-50 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-100 transition-all"
                          >
                            <FileText className="w-4 h-4" />
                            View Responses
                          </button>
                          <button 
                            onClick={() => copyShareLink(form.id)}
                            className="p-3 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-all"
                            title="Copy Share Link"
                          >
                            <Share2 className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => setShowConfirm({ type: 'agent', id: form.id })}
                            className="p-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-all"
                            title="Delete Agent"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {view === 'responses' && selectedForm && (
            <motion.div 
              key="responses"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div className="space-y-1">
                  <h2 className="text-4xl font-extrabold tracking-tight">Responses</h2>
                  <p className="text-gray-500">Data collected for: <span className="font-bold text-gray-900">{selectedForm.title}</span></p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    <button 
                      onClick={exportToCSV}
                      className="p-3 hover:bg-gray-50 text-gray-600 border-r border-gray-100 flex items-center gap-2 text-sm font-semibold"
                      title="Export CSV"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      CSV
                    </button>
                    <button 
                      onClick={exportToPDF}
                      className="p-3 hover:bg-gray-50 text-gray-600 border-r border-gray-100 flex items-center gap-2 text-sm font-semibold"
                      title="Export PDF"
                    >
                      <FileText className="w-4 h-4 text-red-500" />
                      PDF
                    </button>
                    <button 
                      onClick={exportToTXT}
                      className="p-3 hover:bg-gray-50 text-gray-600 flex items-center gap-2 text-sm font-semibold"
                      title="Export TXT"
                    >
                      <FileJson className="w-4 h-4 text-blue-500" />
                      TXT
                    </button>
                  </div>
                  <button 
                    onClick={() => setView('dashboard')}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-900 font-semibold transition-colors px-4 py-2"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    Back
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {responses.length === 0 ? (
                  <div className="bg-white p-12 rounded-3xl border border-dashed border-gray-300 text-center space-y-4">
                    <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                      <ClipboardList className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-gray-500 font-medium">No responses yet.</p>
                    <button 
                      onClick={() => copyShareLink(selectedForm.id)}
                      className="text-emerald-600 font-bold hover:underline"
                    >
                      Share your agent link to get responses
                    </button>
                  </div>
                ) : (
                  responses.map((resp) => (
                    <div 
                      key={resp.id} 
                      className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all group cursor-pointer"
                      onClick={() => {
                        setSelectedResponse(resp);
                        setEditedAnswers(resp.answers);
                        setView('response-detail');
                      }}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <div className="bg-gray-100 w-14 h-14 rounded-2xl flex items-center justify-center group-hover:bg-emerald-50 transition-colors">
                            <UserIcon className="w-7 h-7 text-gray-400 group-hover:text-emerald-600 transition-colors" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold">{resp.respondentName}</h3>
                            <p className="text-gray-500 text-sm">{resp.respondentEmail}</p>
                          </div>
                        </div>

                        <div className="flex-1 flex flex-wrap gap-3 items-center">
                          {Object.entries(resp.answers).slice(0, 3).map(([q, a]) => (
                            <div key={q} className="bg-gray-50 px-4 py-2 rounded-xl border border-gray-100 max-w-[200px]">
                              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider truncate">{q}</p>
                              <p className="text-sm font-semibold text-gray-700 truncate">{a}</p>
                            </div>
                          ))}
                          {Object.keys(resp.answers).length > 3 && (
                            <div className="text-xs font-bold text-gray-400 bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                              +{Object.keys(resp.answers).length - 3} more
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-4">
                          <span className={`px-4 py-1.5 rounded-full text-xs font-bold ${resp.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {resp.status.toUpperCase()}
                          </span>
                          <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {view === 'response-detail' && selectedResponse && selectedForm && (
            <motion.div 
              key="response-detail"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="flex justify-between items-center">
                <button 
                  onClick={() => setView('responses')}
                  className="flex items-center gap-2 text-gray-500 hover:text-gray-900 font-semibold transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                  Back to Responses
                </button>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowConfirm({ type: 'response', id: selectedResponse.id })}
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
                <div className="bg-gray-900 p-8 text-white">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="bg-white/10 p-3 rounded-2xl">
                          <UserIcon className="w-8 h-8 text-emerald-400" />
                        </div>
                        <div>
                          <h2 className="text-3xl font-bold">{selectedResponse.respondentName}</h2>
                          <p className="text-gray-400">{selectedResponse.respondentEmail}</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`px-4 py-1.5 rounded-full text-xs font-bold ${selectedResponse.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {selectedResponse.status.toUpperCase()}
                      </span>
                      <p className="text-gray-500 text-xs mt-2">Submitted: {selectedResponse.createdAt?.toDate?.()?.toLocaleString() || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <ClipboardList className="w-5 h-5 text-emerald-600" />
                      Answers
                    </h3>
                    {!isEditingResponse ? (
                      <button 
                        onClick={() => setIsEditingResponse(true)}
                        className="flex items-center gap-2 text-emerald-600 font-bold hover:underline"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit Answers
                      </button>
                    ) : (
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setIsEditingResponse(false)}
                          className="flex items-center gap-2 text-gray-400 font-bold hover:underline"
                        >
                          <X className="w-4 h-4" />
                          Cancel
                        </button>
                        <button 
                          onClick={handleUpdateResponse}
                          className="flex items-center gap-2 text-emerald-600 font-bold hover:underline"
                        >
                          <Save className="w-4 h-4" />
                          Save Changes
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    {selectedForm.questions.map((q, i) => (
                      <div key={i} className="space-y-2 p-6 bg-gray-50 rounded-2xl border border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Question {i + 1}</p>
                        <p className="text-lg font-bold text-gray-900">{q}</p>
                        <div className="pt-4 border-t border-gray-200/50">
                          {isEditingResponse ? (
                            <textarea
                              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                              value={editedAnswers[q] || ''}
                              onChange={(e) => setEditedAnswers({ ...editedAnswers, [q]: e.target.value })}
                            />
                          ) : (
                            <p className="text-gray-600 leading-relaxed">
                              {selectedResponse.answers[q] || <span className="text-gray-300 italic">No answer provided</span>}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirm(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full space-y-6"
            >
              <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto">
                <Trash2 className="w-8 h-8 text-red-600" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-gray-900">Are you sure?</h3>
                <p className="text-gray-500">
                  {showConfirm.type === 'agent' 
                    ? "This will delete the agent and hide all its responses. This action cannot be undone."
                    : "This will permanently delete this response from your records."}
                </p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowConfirm(null)}
                  className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => showConfirm.type === 'agent' ? handleDeleteForm(showConfirm.id) : handleDeleteResponse(showConfirm.id)}
                  className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-100"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className={`fixed bottom-8 left-1/2 z-[110] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-red-600 border-red-500 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="font-bold text-sm">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="mt-20 border-t border-gray-200 py-12 px-6 bg-white">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 grayscale opacity-50">
            <MessageSquare className="w-5 h-5" />
            <span className="font-bold">HireAgent AI</span>
          </div>
          <p className="text-gray-400 text-sm">© 2026 HireAgent AI. All rights reserved.</p>
          <div className="flex gap-6 text-sm font-medium text-gray-400">
            <a href="#" className="hover:text-gray-600">Privacy</a>
            <a href="#" className="hover:text-gray-600">Terms</a>
            <a href="#" className="hover:text-gray-600">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
