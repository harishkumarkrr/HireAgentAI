import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
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
  ChevronLeft,
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
  Volume2,
  TrendingUp,
  BarChart3,
  Zap,
  Sparkles,
  Layout,
  Target,
  Quote,
  Smile,
  Meh,
  Frown,
  BrainCircuit
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import { GoogleGenAI, Modality } from "@google/genai";
import { base64DecodeAudio, int16ToFloat32 } from './utils/audio';

const TEMPLATES = [
  {
    title: "Job Interview",
    description: "Screen candidates with standard interview questions.",
    questions: "Tell me about yourself.\nWhat are your strengths?\nWhy do you want this job?",
    icon: Briefcase,
    color: "bg-blue-50 text-blue-600"
  },
  {
    title: "Customer Feedback",
    description: "Collect honest feedback about your product or service.",
    questions: "How would you rate our service?\nWhat can we improve?\nWould you recommend us?",
    icon: MessageSquare,
    color: "bg-emerald-50 text-emerald-600"
  },
  {
    title: "Event RSVP",
    description: "Gather details for your upcoming event.",
    questions: "Will you be attending?\nDo you have any dietary restrictions?\nAre you bringing a guest?",
    icon: Globe,
    color: "bg-purple-50 text-purple-600"
  }
];

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
  const [view, setView] = useState<'home' | 'create' | 'respond' | 'dashboard' | 'responses' | 'response-detail' | 'profile'>('home');
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

  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoSlideIndex, setDemoSlideIndex] = useState(0);

  // Auth Modal State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Profile State
  const [totalResponses, setTotalResponses] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      
      const params = new URLSearchParams(window.location.search);
      const formId = params.get('f');
      
      if (u && !formId) {
        setView('dashboard');
      } else if (!u && !formId) {
        setView('home');
      }
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
    if (user && (view === 'dashboard' || view === 'profile')) {
      const unsubscribe = formService.subscribeToUserForms((data) => {
        setForms(data);
        if (view === 'profile') {
          responseService.getTotalResponsesForForms(data.map(f => f.id)).then(setTotalResponses);
        }
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

  const handleLogin = () => {
    setShowAuthModal(true);
    setAuthMode('login');
    setAuthError('');
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    setIsAuthenticating(true);
    setAuthError('');
    try {
      await signInWithPopup(auth, provider);
      setShowAuthModal(false);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/user-cancelled') {
        console.log("Sign-in was cancelled by the user.");
      } else {
        console.error("Login failed:", error);
        setAuthError("Login failed. Please ensure popups are allowed.");
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAuthError('');
    try {
      if (authMode === 'signup') {
        const userCredential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        if (authName) {
          await updateProfile(userCredential.user, { displayName: authName });
          // Force a re-render to show the new display name
          setUser({ ...userCredential.user, displayName: authName } as User);
        }
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthName('');
    } catch (error: any) {
      console.error("Auth failed:", error);
      setAuthError(error.message || "Authentication failed.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.title || !newForm.questions) return;
    
    if (forms.length >= 3) {
      setToast({ message: "You have reached the limit of 3 agents on the Starter plan. Upgrade to create more.", type: 'error' });
      return;
    }

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
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || (process.env as any).API_KEY;
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
        'ta-IN': "வணக்கம், நான் உங்கள் குரல் உதவியாளர். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?",
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
        const audioData = base64DecodeAudio(base64Audio);
        const floatData = int16ToFloat32(audioData);
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const buffer = audioContext.createBuffer(1, floatData.length, 24000);
        buffer.getChannelData(0).set(floatData);
        
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
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

  const exportToJSON = () => {
    if (!selectedForm || responses.length === 0) return;
    
    const data = {
      formTitle: selectedForm.title,
      generatedOn: new Date().toISOString(),
      responses: responses.map(r => ({
        respondentName: r.respondentName,
        respondentEmail: r.respondentEmail,
        date: r.createdAt?.toDate?.()?.toISOString() || null,
        answers: r.answers
      }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${selectedForm.title}_responses.json`);
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

  const handlePayment = () => {
    const isIndia = Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia/Calcutta') || Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia/Kolkata');
    
    if (isIndia) {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => {
        const options = {
          key: 'rzp_test_dummy_key', // Mock test key
          amount: '99900', // 999 INR in paise
          currency: 'INR',
          name: 'AI Studio Forms',
          description: 'Professional Plan Subscription',
          handler: function (response: any) {
            alert('Payment successful! Payment ID: ' + response.razorpay_payment_id);
          },
          theme: {
            color: '#059669' // emerald-600
          }
        };
        const rzp1 = new (window as any).Razorpay(options);
        rzp1.open();
      };
      document.body.appendChild(script);
    } else {
      alert("Redirecting to Stripe for international payment ($29/mo)...");
    }
  };

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
                <div className="relative group">
                  <div className="flex items-center gap-3 pl-4 border-l border-gray-200 cursor-pointer">
                    <img 
                      src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email || 'User')}&background=10b981&color=fff`} 
                      alt="" 
                      className="w-8 h-8 rounded-full border border-gray-200" 
                    />
                    <div className="hidden md:block text-sm text-left">
                      <p className="font-bold text-gray-900 leading-tight">{user.displayName || 'User'}</p>
                      <p className="text-xs text-gray-500 max-w-[120px] truncate">{user.email}</p>
                    </div>
                  </div>
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    <div className="p-4 border-b border-gray-50 md:hidden">
                      <p className="font-bold text-gray-900 truncate">{user.displayName || 'User'}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    </div>
                    <button 
                      onClick={() => setView('profile')} 
                      className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 font-semibold flex items-center gap-2 transition-colors"
                    >
                      <UserIcon className="w-4 h-4" />
                      Profile
                    </button>
                    <button 
                      onClick={() => signOut(auth)} 
                      className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 font-semibold flex items-center gap-2 rounded-b-xl transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </>
            ) : view !== 'respond' ? (
              <button 
                onClick={handleLogin}
                className="bg-gray-900 text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-gray-800 transition-all shadow-md active:scale-95"
              >
                Sign In
              </button>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold uppercase tracking-widest border border-emerald-100">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                Candidate Mode
              </div>
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
                  onClick={() => {
                    if (!user) {
                      handleLogin();
                    } else if (forms.length >= 3) {
                      setToast({ message: "You have reached the limit of 3 agents on the Starter plan. Upgrade to create more.", type: 'error' });
                    } else {
                      setView('create');
                    }
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 text-white px-10 py-5 rounded-2xl text-lg font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 active:scale-95"
                >
                  <Plus className="w-6 h-6" />
                  Create Your Agent
                </button>
                <button 
                  onClick={() => {
                    setDemoSlideIndex(0);
                    setShowDemoModal(true);
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-gray-900 px-10 py-5 rounded-2xl text-lg font-bold hover:bg-gray-50 transition-all border border-gray-200 active:scale-95"
                >
                  <Play className="w-6 h-6 text-emerald-600" />
                  Watch Demo
                </button>
              </div>

              {/* Trust Section */}
              <div className="pt-20 space-y-8">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-[0.3em]">Trusted by forward-thinking teams</p>
                <div className="flex flex-wrap justify-center items-center gap-12 grayscale opacity-50">
                  <div className="flex items-center gap-2 font-bold text-2xl">
                    <Zap className="w-8 h-8 text-emerald-600" />
                    FastCo
                  </div>
                  <div className="flex items-center gap-2 font-bold text-2xl">
                    <Target className="w-8 h-8 text-emerald-600" />
                    AimHigh
                  </div>
                  <div className="flex items-center gap-2 font-bold text-2xl">
                    <Globe className="w-8 h-8 text-emerald-600" />
                    GlobalX
                  </div>
                </div>
              </div>

              {/* Pricing Section */}
              <div className="pt-32 space-y-12">
                <div className="space-y-4">
                  <h2 className="text-4xl font-bold">Simple, Transparent Pricing</h2>
                  <p className="text-gray-500">Start for free, upgrade as you grow.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto gap-8 text-left">
                  {[
                    { 
                      name: "Starter", 
                      price: Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia/Calcutta') || Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia/Kolkata') ? "₹0" : "$0", 
                      features: ["3 AI Agents", "100 Responses/mo", "Basic Analytics", "Standard Voices"],
                      button: "Get Started",
                      popular: false
                    },
                    { 
                      name: "Professional", 
                      price: Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia/Calcutta') || Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia/Kolkata') ? "₹999" : "$29", 
                      features: ["Unlimited Agents", "1,000 Responses/mo", "AI Sentiment Analysis", "Premium Voices", "Custom Branding"],
                      button: "Upgrade Now",
                      popular: true
                    }
                  ].map((plan, i) => (
                    <div key={i} className={`p-8 rounded-3xl border ${plan.popular ? 'border-emerald-500 bg-white shadow-2xl shadow-emerald-100 relative scale-105 z-10' : 'border-gray-100 bg-white shadow-sm'} space-y-6`}>
                      {plan.popular && (
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-4 py-1 rounded-full text-xs font-bold">
                          MOST POPULAR
                        </div>
                      )}
                      <div className="space-y-1">
                        <h3 className="text-xl font-bold">{plan.name}</h3>
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold">{plan.price}</span>
                          {plan.price !== "Custom" && <span className="text-gray-500 text-sm">/mo</span>}
                        </div>
                      </div>
                      <ul className="space-y-4">
                        {plan.features.map((f, j) => (
                          <li key={j} className="flex items-center gap-3 text-sm text-gray-600">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <button 
                        onClick={() => plan.name === "Starter" ? (!user ? setShowAuthModal(true) : setView('dashboard')) : handlePayment()}
                        className={`w-full py-4 rounded-xl font-bold transition-all ${plan.popular ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-100' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}
                      >
                        {plan.button}
                      </button>
                    </div>
                  ))}
                </div>
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
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-6xl mx-auto"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Configuration Column */}
                <div className="lg:col-span-7 space-y-8">
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

                    <div className="space-y-4">
                      <label className="text-sm font-semibold text-gray-700">Quick Start Templates</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {TEMPLATES.map((t, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setNewForm({
                                ...newForm,
                                title: t.title,
                                description: t.description,
                                questions: t.questions
                              });
                            }}
                            className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all text-center group"
                          >
                            <div className={`p-2 rounded-xl ${t.color} group-hover:scale-110 transition-transform`}>
                              <t.icon className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-bold">{t.title}</span>
                          </button>
                        ))}
                      </div>
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
                            <option value="ta-IN">Tamil (தமிழ்)</option>
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
                        className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold text-xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                      >
                        {isDeploying ? (
                          <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            Deploying Agent...
                          </>
                        ) : (
                          <>
                            <Zap className="w-6 h-6" />
                            Deploy AI Agent
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                </div>

                {/* Preview Column */}
                <div className="lg:col-span-5 hidden lg:block">
                  <div className="sticky top-8 space-y-6">
                    <div className="bg-gray-900 rounded-[3rem] p-4 shadow-2xl border-[8px] border-gray-800 aspect-[9/19] relative overflow-hidden">
                      {/* Phone Notch */}
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-2xl z-20" />
                      
                      <div className="bg-white h-full rounded-[2rem] overflow-hidden flex flex-col">
                        {/* Preview Content */}
                        <div className="p-6 pt-12 space-y-6 flex-1">
                          <div className="space-y-2 text-center">
                            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <MessageSquare className="w-8 h-8 text-emerald-600" />
                            </div>
                            <h3 className="text-xl font-bold">{newForm.title || "Agent Title"}</h3>
                            <p className="text-xs text-gray-500 line-clamp-2">{newForm.description || "Agent description will appear here."}</p>
                          </div>

                          <div className="space-y-4">
                            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">AI Agent</p>
                              <p className="text-sm text-gray-700">
                                {newForm.questions.split('\n')[0] || "Hello! I'll be helping you fill out this form today."}
                              </p>
                            </div>
                            <div className="flex justify-end">
                              <div className="bg-emerald-600 p-4 rounded-2xl rounded-tr-none text-white max-w-[80%]">
                                <p className="text-sm">...</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Preview Controls */}
                        <div className="p-6 border-t border-gray-100 bg-gray-50 flex flex-col items-center gap-4">
                          <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center shadow-lg shadow-emerald-200">
                            <div className="w-8 h-8 bg-white/20 rounded-full animate-ping" />
                            <Volume2 className="w-6 h-6 text-white absolute" />
                          </div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Listening...</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-3">
                      <div className="flex items-center gap-2 text-emerald-700 font-bold">
                        <Sparkles className="w-5 h-5" />
                        Live Preview
                      </div>
                      <p className="text-sm text-emerald-600/80 leading-relaxed">
                        This is how your agent will appear to candidates. The agent will ask questions one by one using the <b>{newForm.voice}</b> voice.
                      </p>
                    </div>
                  </div>
                </div>
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
                    <div className="pt-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                        <CheckCircle2 className="w-3 h-3" />
                        No Sign-in Required
                      </span>
                    </div>
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

          {view === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="space-y-1">
                <h2 className="text-4xl font-extrabold tracking-tight">User Profile</h2>
                <p className="text-gray-500">Manage your account and view usage statistics.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Profile Card */}
                <div className="col-span-1 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                  <div className="flex flex-col items-center text-center space-y-4">
                    <img 
                      src={user?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName || user?.email || 'User')}&background=10b981&color=fff&size=128`} 
                      alt="" 
                      className="w-32 h-32 rounded-full border-4 border-emerald-50 shadow-lg" 
                    />
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900">{user?.displayName || 'User'}</h3>
                      <p className="text-gray-500">{user?.email}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-bold uppercase tracking-widest border border-emerald-100">
                      <CheckCircle2 className="w-4 h-4" />
                      Starter Tier
                    </div>
                  </div>
                </div>

                {/* Usage Dashboard */}
                <div className="col-span-1 md:col-span-2 space-y-6">
                  <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                    <h3 className="text-xl font-bold text-gray-900">Usage Dashboard</h3>
                    
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm font-bold">
                          <span className="text-gray-700">Agents Created</span>
                          <span className="text-emerald-600">{forms.length} / 3</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                          <div 
                            className="bg-emerald-500 h-3 rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min((forms.length / 3) * 100, 100)}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500">You can create up to 3 agents on the Starter plan.</p>
                      </div>

                      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-50">
                        <div className="p-4 bg-gray-50 rounded-2xl">
                          <p className="text-sm font-bold text-gray-500 mb-1">Total Agents</p>
                          <p className="text-3xl font-extrabold text-gray-900">{forms.length}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-2xl">
                          <p className="text-sm font-bold text-gray-500 mb-1">Total Responses</p>
                          <p className="text-3xl font-extrabold text-gray-900">{totalResponses}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-2xl">
                          <p className="text-sm font-bold text-gray-500 mb-1">Plan Status</p>
                          <p className="text-xl font-extrabold text-emerald-600">Active</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-8 rounded-3xl shadow-xl text-white flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="space-y-2 text-center sm:text-left">
                      <h3 className="text-2xl font-bold">Upgrade to Professional</h3>
                      <p className="text-gray-400 max-w-md">Get unlimited agents, custom branding, and advanced analytics.</p>
                    </div>
                    <button 
                      onClick={() => setToast({ message: "Upgrade functionality coming soon!", type: 'success' })}
                      className="whitespace-nowrap px-8 py-4 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/30"
                    >
                      Upgrade Now
                    </button>
                  </div>
                </div>
              </div>
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
                  <p className="text-gray-500">Manage your conversational forms and view responses. <span className="font-bold text-emerald-600">{forms.length}/3 Agents Used</span></p>
                </div>
                <div className="relative group">
                  <button 
                    onClick={() => {
                      if (forms.length >= 3) {
                        setToast({ message: "You have reached the limit of 3 agents on the Starter plan. Upgrade to create more.", type: 'error' });
                        return;
                      }
                      setView('create');
                    }}
                    disabled={forms.length >= 3}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-5 h-5" />
                    New Agent
                  </button>
                  {forms.length >= 3 && (
                    <div className="absolute top-full right-0 mt-2 w-64 bg-gray-900 text-white text-xs p-3 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                      Starter plan limit reached. Upgrade to Professional for unlimited agents.
                    </div>
                  )}
                </div>
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
                      className="p-3 hover:bg-gray-50 text-gray-600 border-r border-gray-100 flex items-center gap-2 text-sm font-semibold"
                      title="Export TXT"
                    >
                      <FileJson className="w-4 h-4 text-blue-500" />
                      TXT
                    </button>
                    <button 
                      onClick={exportToJSON}
                      className="p-3 hover:bg-gray-50 text-gray-600 flex items-center gap-2 text-sm font-semibold"
                      title="Export JSON"
                    >
                      <FileJson className="w-4 h-4 text-yellow-500" />
                      JSON
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
                  {/* AI Analysis Section */}
                  {(selectedResponse.sentiment || selectedResponse.aiSummary) && (
                    <div className="bg-emerald-50/50 rounded-3xl p-8 border border-emerald-100 space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-emerald-900">
                          <BrainCircuit className="w-6 h-6 text-emerald-600" />
                          AI Insights
                        </h3>
                        {selectedResponse.sentiment && (
                          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm ${
                            selectedResponse.sentiment === 'Positive' ? 'bg-emerald-100 text-emerald-700' :
                            selectedResponse.sentiment === 'Negative' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {selectedResponse.sentiment === 'Positive' && <Smile className="w-4 h-4" />}
                            {selectedResponse.sentiment === 'Neutral' && <Meh className="w-4 h-4" />}
                            {selectedResponse.sentiment === 'Negative' && <Frown className="w-4 h-4" />}
                            {selectedResponse.sentiment} Sentiment
                          </div>
                        )}
                      </div>
                      
                      {selectedResponse.aiSummary && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">AI Summary</p>
                          <p className="text-lg text-emerald-900 leading-relaxed italic">
                            "{selectedResponse.aiSummary}"
                          </p>
                        </div>
                      )}
                    </div>
                  )}

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

      {/* Demo Modal */}
      <AnimatePresence>
        {showDemoModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDemoModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl overflow-hidden max-w-4xl w-full flex flex-col md:flex-row h-[600px] max-h-[90vh]"
            >
              <button 
                onClick={() => setShowDemoModal(false)}
                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-gray-500 hover:text-gray-900 rounded-full transition-colors z-10"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex-1 bg-gray-50 relative flex items-center justify-center p-8">
                <AnimatePresence mode="wait">
                  {demoSlideIndex === 0 && (
                    <motion.div 
                      key="slide0"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="text-center space-y-6"
                    >
                      <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Sparkles className="w-12 h-12 text-emerald-600" />
                      </div>
                      <h3 className="text-3xl font-bold text-gray-900">Welcome to AI Studio Forms</h3>
                      <p className="text-xl text-gray-500 max-w-md mx-auto">
                        Transform your static forms into engaging, conversational AI agents that talk to your users.
                      </p>
                    </motion.div>
                  )}
                  {demoSlideIndex === 1 && (
                    <motion.div 
                      key="slide1"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="text-center space-y-6"
                    >
                      <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Edit2 className="w-12 h-12 text-blue-600" />
                      </div>
                      <h3 className="text-3xl font-bold text-gray-900">Create Agents in Seconds</h3>
                      <p className="text-xl text-gray-500 max-w-md mx-auto">
                        Just type your questions in plain text. Our AI automatically handles the conversation flow.
                      </p>
                    </motion.div>
                  )}
                  {demoSlideIndex === 2 && (
                    <motion.div 
                      key="slide2"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="text-center space-y-6"
                    >
                      <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Volume2 className="w-12 h-12 text-purple-600" />
                      </div>
                      <h3 className="text-3xl font-bold text-gray-900">Voice & Text Support</h3>
                      <p className="text-xl text-gray-500 max-w-md mx-auto">
                        Let your users talk to your forms using their microphone, or type their answers naturally.
                      </p>
                    </motion.div>
                  )}
                  {demoSlideIndex === 3 && (
                    <motion.div 
                      key="slide3"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="text-center space-y-6"
                    >
                      <div className="w-24 h-24 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <BarChart3 className="w-12 h-12 text-orange-600" />
                      </div>
                      <h3 className="text-3xl font-bold text-gray-900">Real-time Dashboard</h3>
                      <p className="text-xl text-gray-500 max-w-md mx-auto">
                        View transcripts, extract structured data, and analyze responses instantly in your dashboard.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <button 
                      key={i}
                      onClick={() => setDemoSlideIndex(i)}
                      className={`w-3 h-3 rounded-full transition-all ${demoSlideIndex === i ? 'bg-emerald-600 scale-125' : 'bg-gray-300 hover:bg-gray-400'}`}
                    />
                  ))}
                </div>

                <button 
                  onClick={() => setDemoSlideIndex(Math.max(0, demoSlideIndex - 1))}
                  disabled={demoSlideIndex === 0}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white rounded-full shadow-md text-gray-600 hover:text-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button 
                  onClick={() => setDemoSlideIndex(Math.min(3, demoSlideIndex + 1))}
                  disabled={demoSlideIndex === 3}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white rounded-full shadow-md text-gray-600 hover:text-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal */}
      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full space-y-6"
            >
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-gray-900">
                  {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
                </h3>
                <p className="text-gray-500">
                  {authMode === 'login' ? 'Sign in to manage your AI agents.' : 'Sign up to start building AI agents.'}
                </p>
              </div>

              {authError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {authError}
                </div>
              )}

              <form onSubmit={handleEmailAuth} className="space-y-4">
                {authMode === 'signup' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input 
                      type="text" 
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                      placeholder="John Doe"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                  <input 
                    type="email" 
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input 
                    type="password" 
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  {isAuthenticating ? 'Please wait...' : (authMode === 'login' ? 'Sign In' : 'Sign Up')}
                </button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">Or continue with</span>
                </div>
              </div>

              <button 
                onClick={handleGoogleSignIn}
                disabled={isAuthenticating}
                className="w-full py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>

              <div className="text-center text-sm text-gray-500">
                {authMode === 'login' ? (
                  <>Don't have an account? <button onClick={() => { setAuthMode('signup'); setAuthError(''); }} className="text-emerald-600 font-bold hover:underline">Sign up</button></>
                ) : (
                  <>Already have an account? <button onClick={() => { setAuthMode('login'); setAuthError(''); }} className="text-emerald-600 font-bold hover:underline">Sign in</button></>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
