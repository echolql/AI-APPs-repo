import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  BookOpen, 
  Library, 
  Play, 
  Pause, 
  RotateCcw, 
  Save, 
  Trash2, 
  ChevronLeft,
  Loader2,
  Moon,
  Star,
  Key,
  Heart,
  LogOut,
  User as UserIcon,
  Mail,
  Lock
} from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User } from "firebase/auth";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  orderBy, 
  getDocFromServer 
} from "firebase/firestore";
import { 
  ref, 
  uploadString, 
  getDownloadURL,
  uploadBytes,
  StorageReference
} from "firebase/storage";
import { auth, db, storage } from "./firebase";
import { generateStory, generateIllustration, generateNarration } from "./services/geminiService";
import { playPCM } from "./lib/audioUtils";
import { cn } from "./lib/utils";
import { Story } from "./types";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [theme, setTheme] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("English");
  const [generationMode, setGenerationMode] = useState<"story" | "story_image">("story_image");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [library, setLibrary] = useState<Story[]>([]);
  const [view, setView] = useState<"home" | "story" | "library">("home");
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [alert, setAlert] = useState<{ message: string; type: "error" | "success" } | null>(null);
  const audioRef = useRef<{ audioCtx: AudioContext; source: AudioBufferSourceNode } | null>(null);

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setLibrary([]);
      return;
    }

    const q = query(
      collection(db, "stories"),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const stories: Story[] = [];
      snapshot.forEach((doc) => {
        stories.push({ id: doc.id, ...doc.data() } as Story);
      });
      setLibrary(stories);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "stories");
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => setAlert(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  useEffect(() => {
    const checkApiKey = async () => {
      try {
        if (window.aistudio) {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } else {
          setHasApiKey(true); // Fallback for environments without the helper
        }
      } catch (e) {
        console.error("Failed to check API key status", e);
      }
    };
    checkApiKey();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setIsAuthLoading(true);
    try {
      if (authMode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
        setAlert({ message: "Welcome back!", type: "success" });
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        setAlert({ message: "Account created! Welcome to DreamWeaver.", type: "success" });
      }
    } catch (error: any) {
      console.error("Auth error", error);
      setAlert({ message: error.message || "Authentication failed", type: "error" });
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setAlert({ message: "Signed out successfully", type: "success" });
      setView("home");
    } catch (error) {
      console.error("Sign out error", error);
    }
  };

  const handleSelectKey = async () => {
    try {
      if (window.aistudio) {
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
      }
    } catch (e) {
      console.error("Failed to open key selection", e);
    }
  };

  const saveToLibrary = async () => {
    if (currentStory && user) {
      console.log("Starting saveToLibrary", { title: currentStory.title, uid: user.uid });
      
      // Check if already in library to prevent duplicate keys
      if (library.some(s => s.title === currentStory.title && s.createdAt === currentStory.createdAt)) {
        setAlert({ message: "This story is already in your library!", type: "success" });
        return;
      }

      setIsSaving(true);
      setAlert({ message: "Saving to cloud library... (Uploading assets)", type: "success" });

      try {
        let imageUrl = currentStory.imageUrl;
        let audioUrl = currentStory.audioUrl || "";

        console.log("Checking assets for upload...");

        // Helper for timeout
        function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
          return Promise.race([
            promise,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))
          ]);
        }

        // Helper to convert data URL to Blob without fetch
        const dataURLtoBlob = (dataurl: string) => {
          const arr = dataurl.split(',');
          const mimeMatch = arr[0].match(/:(.*?);/);
          if (!mimeMatch) throw new Error("Invalid data URL");
          const mime = mimeMatch[1];
          const bstr = atob(arr[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          return new Blob([u8arr], { type: mime });
        };

        // Upload image to Storage if it's base64
        if (imageUrl && imageUrl.startsWith('data:image')) {
          console.log("Uploading image to Storage...");
          const imageStorageRef = ref(storage, `stories/${user.uid}/${currentStory.createdAt}_image.png`);
          
          try {
            const blob = dataURLtoBlob(imageUrl);
            console.log(`Image size: ${Math.round(blob.size / 1024)} KB`);
            
            await withTimeout(
              uploadBytes(imageStorageRef, blob),
              120000, // Increased to 120s
              "Image upload timed out"
            );
          } catch (blobErr: any) {
            console.error("Failed to convert image to blob or upload failed", blobErr);
            // Fallback to uploadString if it wasn't a timeout
            if (!blobErr.message?.includes("timed out")) {
              await withTimeout(
                uploadString(imageStorageRef, imageUrl, 'data_url'),
                120000,
                "Image upload timed out (fallback)"
              );
            } else {
              throw blobErr;
            }
          }
          
          imageUrl = await getDownloadURL(imageStorageRef);
          console.log("Image uploaded successfully:", imageUrl);
        }

        // Upload audio to Storage if it's base64 (raw or data URL)
        if (audioUrl && !audioUrl.startsWith('http')) {
          console.log("Uploading audio to Storage...");
          const audioStorageRef = ref(storage, `stories/${user.uid}/${currentStory.createdAt}_audio.pcm`);
          
          try {
            // Prepend data URL prefix if it's raw base64
            const audioDataUrl = audioUrl.startsWith('data:') ? audioUrl : `data:audio/pcm;base64,${audioUrl}`;
            
            // Use fetch to convert to blob - more memory efficient for large strings
            const audioResponse = await fetch(audioDataUrl);
            const blob = await audioResponse.blob();
            
            console.log(`Audio size: ${Math.round(blob.size / 1024)} KB`);
            
            await withTimeout(
              uploadBytes(audioStorageRef, blob),
              300000, // Increased to 300s (5 minutes)
              "Audio upload timed out"
            );
          } catch (audioErr: any) {
            console.error("Failed to upload audio via blob, trying fallback", audioErr);
            if (!audioErr.message?.includes("timed out")) {
              const format = audioUrl.startsWith('data:') ? 'data_url' : 'base64';
              await withTimeout(
                uploadString(audioStorageRef, audioUrl, format),
                300000,
                "Audio upload timed out (fallback)"
              );
            } else {
              throw audioErr;
            }
          }
          
          audioUrl = await getDownloadURL(audioStorageRef);
          console.log("Audio uploaded successfully:", audioUrl);
        }

        const storyToSave = {
          title: currentStory.title,
          content: currentStory.content,
          theme: currentStory.theme,
          imageUrl: imageUrl,
          audioUrl: audioUrl,
          createdAt: currentStory.createdAt,
          isFavorite: false,
          uid: user.uid
        };

        console.log("Adding document to Firestore...");
        const docRef = await withTimeout(
          addDoc(collection(db, "stories"), storyToSave),
          15000,
          "Firestore save timed out"
        );
        console.log("Document added with ID:", docRef.id);
        
        setAlert({ message: "Story saved to cloud library!", type: "success" });
      } catch (e: any) {
        console.error("Detailed save error:", e);
        const message = e.message || "Unknown error during save";
        setAlert({ message: `Failed to save: ${message}`, type: "error" });
        
        try {
          handleFirestoreError(e, OperationType.CREATE, "stories");
        } catch (innerE) {
          // Ignore re-throw
        }
      } finally {
        console.log("Finishing saveToLibrary (setting isSaving to false)");
        setIsSaving(false);
      }
    } else {
      console.warn("saveToLibrary called but currentStory or user is missing", { currentStory: !!currentStory, user: !!user });
    }
  };

  const deleteFromLibrary = async (id: string) => {
    try {
      await deleteDoc(doc(db, "stories", id));
      setAlert({ message: "Story deleted", type: "success" });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `stories/${id}`);
    }
  };

  const toggleFavorite = async (id: string) => {
    try {
      const story = library.find(s => s.id === id);
      if (!story) return;

      await updateDoc(doc(db, "stories", id), {
        isFavorite: !story.isFavorite
      });

      if (currentStory && currentStory.id === id) {
        setCurrentStory({ ...currentStory, isFavorite: !story.isFavorite });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `stories/${id}`);
    }
  };

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    
    setIsGenerating(true);
    setView("story");
    setCurrentStory(null);
    setAudioBase64(null);
    stopAudio();

    try {
      // Step 1: Generate Story
      const storyData = await generateStory(theme, selectedLanguage);
      
      // Step 2: Generate Illustration (Optional)
      let imageUrl = "";
      if (generationMode === "story_image") {
        imageUrl = await generateIllustration(storyData.title + ": " + storyData.content.substring(0, 100));
      }
      
      // Step 3: Generate Narration
      const audioData = await generateNarration(storyData.content);
      setAudioBase64(audioData);

      const newStory: Story = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: storyData.title,
        content: storyData.content,
        imageUrl,
        audioUrl: audioData, // Store audio for library playback
        theme,
        createdAt: Date.now(),
        uid: user?.uid || "",
      };

      setCurrentStory(newStory);
    } catch (error: any) {
      console.error("Generation failed", error);
      // If permission denied, prompt for a new key
      if (error?.message?.includes("403") || error?.message?.includes("permission")) {
        setHasApiKey(false);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleAudio = () => {
    try {
      if (isPlaying) {
        stopAudio();
      } else if (audioBase64) {
        const result = playPCM(audioBase64);
        if (result) {
          const { audioCtx, source } = result;
          audioRef.current = { audioCtx, source };
          setIsPlaying(true);
          source.onended = () => setIsPlaying(false);
        }
      }
    } catch (e) {
      console.error("Audio toggle failed", e);
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    try {
      if (audioRef.current) {
        try {
          audioRef.current.source.stop();
        } catch (e) {
          // Ignore if already stopped
        }
        try {
          audioRef.current.audioCtx.close();
        } catch (e) {
          // Ignore if already closed
        }
        audioRef.current = null;
      }
      setIsPlaying(false);
    } catch (e) {
      console.error("Stop audio failed", e);
    }
  };

  const handleRemix = () => {
    setView("home");
    stopAudio();
  };

  return (
    <div className="min-h-screen bg-[#0a0a2e] text-indigo-50 font-sans selection:bg-amber-500/30">
      {/* Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-10 text-amber-200/20 animate-pulse">
          <Star size={24} />
        </div>
        <div className="absolute top-40 right-20 text-amber-200/10 animate-pulse delay-700">
          <Star size={16} />
        </div>
        <div className="absolute bottom-20 left-1/4 text-amber-200/15 animate-pulse delay-1000">
          <Star size={32} />
        </div>
        <div className="absolute top-1/2 right-1/3 text-amber-200/5 animate-pulse delay-300">
          <Star size={20} />
        </div>
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div 
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => setView("home")}
          >
            <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-110 transition-transform">
              <Sparkles className="text-indigo-900" />
            </div>
            <h1 className="text-3xl font-romantic font-medium tracking-tight bg-gradient-to-r from-amber-200 to-amber-500 bg-clip-text text-transparent">
              DreamWeaver
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView("library")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full transition-all",
                view === "library" 
                  ? "bg-amber-500 text-indigo-900 font-semibold" 
                  : "bg-indigo-900/50 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/50"
              )}
            >
              <Library size={18} />
              <span>Library</span>
            </button>

            {user && (
              <button 
                onClick={handleSignOut}
                className="p-2 rounded-full bg-indigo-900/50 hover:bg-red-500/20 text-indigo-300 hover:text-red-400 border border-indigo-700/50 transition-all"
                title="Sign Out"
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>

        {/* Alerts */}
        <AnimatePresence>
          {alert && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -20, x: "-50%" }}
              className={cn(
                "fixed top-6 left-1/2 z-50 px-6 py-3 rounded-2xl shadow-2xl font-semibold backdrop-blur-xl border",
                alert.type === "success" 
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                  : "bg-red-500/20 text-red-400 border-red-500/30"
              )}
            >
              {alert.message}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {isAuthLoading ? (
            <motion.div 
              key="auth-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center"
            >
              <Loader2 className="text-amber-500 animate-spin" size={48} />
            </motion.div>
          ) : !user ? (
            <motion.section
              key="auth"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full"
            >
              <div className="w-full bg-indigo-950/50 backdrop-blur-xl p-8 rounded-3xl border border-indigo-800 shadow-2xl space-y-8">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500 mx-auto mb-4">
                    <UserIcon size={32} />
                  </div>
                  <h2 className="text-3xl font-bold">{authMode === "signin" ? "Welcome Back" : "Join the Magic"}</h2>
                  <p className="text-indigo-400">
                    {authMode === "signin" ? "Sign in to access your magical library" : "Create an account to start weaving stories"}
                  </p>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-indigo-300 ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500" size={18} />
                      <input 
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="magic@dreamweaver.com"
                        className="w-full bg-indigo-900/30 border border-indigo-800 rounded-xl py-3 pl-12 pr-4 outline-none focus:border-amber-500/50 transition-colors"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-indigo-300 ml-1">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500" size={18} />
                      <input 
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-indigo-900/30 border border-indigo-800 rounded-xl py-3 pl-12 pr-4 outline-none focus:border-amber-500/50 transition-colors"
                        required
                      />
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={isAuthLoading}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-indigo-950 font-bold py-4 rounded-xl shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {authMode === "signin" ? "Sign In" : "Create Account"}
                  </button>
                </form>

                <div className="text-center">
                  <button 
                    onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
                    className="text-indigo-400 hover:text-amber-400 text-sm transition-colors"
                  >
                    {authMode === "signin" ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                  </button>
                </div>
              </div>
            </motion.section>
          ) : hasApiKey === false ? (
            <motion.section
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-8 max-w-md mx-auto"
            >
              <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center text-amber-500">
                <Key size={40} />
              </div>
              <div className="space-y-4">
                <h2 className="text-3xl font-bold">Connect Your Magic</h2>
                <p className="text-indigo-300">
                  To generate high-quality Disney-style illustrations, you'll need to connect a Google Cloud API key with billing enabled.
                </p>
                <div className="p-4 bg-indigo-900/30 rounded-xl border border-indigo-800 text-sm text-indigo-200 text-left">
                  <p className="font-semibold mb-1">Why is this needed?</p>
                  <p>Imagen 4 requires a paid API key from a Google Cloud project. You can learn more about billing <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-amber-400 underline">here</a>.</p>
                </div>
              </div>
              <button
                onClick={handleSelectKey}
                className="w-full bg-amber-500 hover:bg-amber-400 text-indigo-950 font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-amber-500/20"
              >
                <Sparkles size={20} />
                <span>Select API Key</span>
              </button>
            </motion.section>
          ) : view === "home" && (
            <motion.section
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-8"
            >
              <div className="space-y-4">
                <h2 className="text-3xl md:text-4xl font-playful font-bold tracking-wide leading-tight text-gold">
                  Where Every Night is a <br />
                  New Adventure
                </h2>
                <p className="text-indigo-300 text-lg max-w-lg mx-auto">
                  Enter a character, a place, or a dream, and we'll weave a magical story just for you.
                </p>
              </div>

              <div className="w-full max-w-xl space-y-4">
                <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
                  <div className="flex flex-col items-start gap-2 w-full md:w-auto">
                    <label className="text-xs font-bold text-indigo-400 uppercase tracking-wider ml-1">Language</label>
                    <select 
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      className="w-full md:w-40 bg-indigo-950/80 border border-indigo-800 rounded-xl px-4 py-3 outline-none text-indigo-50 focus:border-amber-500/50 transition-colors cursor-pointer"
                    >
                      {["English", "Chinese", "Spanish", "Italian", "French", "German", "Japanese", "Korean"].map(lang => (
                        <option key={lang} value={lang}>{lang}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col items-start gap-2 w-full md:w-auto">
                    <label className="text-xs font-bold text-indigo-400 uppercase tracking-wider ml-1">Mode</label>
                    <div className="flex bg-indigo-950/80 border border-indigo-800 rounded-xl p-1 w-full md:w-auto">
                      <button 
                        onClick={() => setGenerationMode("story")}
                        className={cn(
                          "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                          generationMode === "story" ? "bg-amber-500 text-indigo-950" : "text-indigo-400 hover:text-indigo-200"
                        )}
                      >
                        Story Only
                      </button>
                      <button 
                        onClick={() => setGenerationMode("story_image")}
                        className={cn(
                          "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                          generationMode === "story_image" ? "bg-amber-500 text-indigo-950" : "text-indigo-400 hover:text-indigo-200"
                        )}
                      >
                        Story + Image
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-purple-600 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-1000"></div>
                  <div className="relative flex flex-col md:flex-row gap-2 bg-indigo-950/80 p-2 rounded-2xl border border-indigo-800 backdrop-blur-xl">
                    <input
                      type="text"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                      placeholder="A brave squirrel named Pip..."
                      className="flex-1 bg-transparent px-4 py-4 outline-none text-indigo-50 placeholder:text-indigo-700"
                      onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                    />
                    <button
                      onClick={handleGenerate}
                      disabled={!theme.trim()}
                      className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 text-indigo-950 font-bold px-8 py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                      <Sparkles size={20} />
                      <span>Create Magic</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                {["A lost dragon", "The moon's secret", "A talking forest", "Underwater kingdom"].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setTheme(suggestion)}
                    className="px-4 py-2 rounded-full bg-indigo-900/30 border border-indigo-800 text-indigo-400 text-sm hover:bg-indigo-800 hover:text-indigo-200 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </motion.section>
          )}

          {view === "story" && (
            <motion.section
              key="story"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 space-y-8"
            >
              {isGenerating ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 space-y-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-amber-500 blur-2xl opacity-20 animate-pulse"></div>
                    <Loader2 size={64} className="text-amber-500 animate-spin relative" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold text-amber-200">Weaving your story...</h3>
                    <p className="text-indigo-400 animate-pulse">Consulting the magic stars</p>
                  </div>
                </div>
              ) : currentStory ? (
                <div className={cn(
                  "grid gap-12 items-start",
                  currentStory.imageUrl ? "md:grid-cols-2" : "max-w-2xl mx-auto"
                )}>
                  {currentStory.imageUrl && (
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="space-y-6"
                    >
                      <div className="aspect-square rounded-3xl overflow-hidden border-4 border-indigo-800 shadow-2xl shadow-indigo-950/50 relative group">
                        <img 
                          src={currentStory.imageUrl} 
                          alt="Story Illustration" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-indigo-950/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                          <p className="text-xs text-indigo-200 italic">Classic Disney Style Illustration</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={toggleAudio}
                          disabled={!audioBase64}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl font-bold transition-all active:scale-95",
                            isPlaying 
                              ? "bg-red-500/20 text-red-400 border border-red-500/30" 
                              : "bg-indigo-800 hover:bg-indigo-700 text-indigo-100"
                          )}
                        >
                          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                          <span>{isPlaying ? "Stop Narration" : "Listen to Story"}</span>
                        </button>
                        
                        <button 
                          onClick={saveToLibrary}
                          disabled={isSaving}
                          className="p-4 rounded-2xl bg-amber-500 text-indigo-950 hover:bg-amber-400 transition-all active:scale-95 disabled:opacity-50"
                          title="Save to Library"
                        >
                          {isSaving ? <Loader2 className="animate-spin" size={24} /> : <Save size={24} />}
                        </button>

                        {currentStory.id && library.some(s => s.id === currentStory.id) && (
                          <button 
                            onClick={() => toggleFavorite(currentStory.id)}
                            className={cn(
                              "p-4 rounded-2xl transition-all active:scale-95",
                              currentStory.isFavorite 
                                ? "bg-pink-500 text-white" 
                                : "bg-indigo-800 text-indigo-300 hover:bg-indigo-700"
                            )}
                            title={currentStory.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                          >
                            <Heart size={24} fill={currentStory.isFavorite ? "currentColor" : "none"} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}

                  <motion.div 
                    initial={{ opacity: 0, x: currentStory.imageUrl ? 20 : 0, y: currentStory.imageUrl ? 0 : 20 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-amber-500 text-sm font-bold uppercase tracking-widest">
                        <Moon size={14} />
                        <span>Bedtime Tale</span>
                      </div>
                      <h2 className="text-4xl font-bold font-serif text-amber-100 leading-tight">
                        {currentStory.title}
                      </h2>
                    </div>

                    <div className="prose prose-invert prose-indigo max-w-none">
                      <p className="text-indigo-100 text-lg leading-relaxed first-letter:text-5xl first-letter:font-bold first-letter:mr-3 first-letter:float-left first-letter:text-amber-400">
                        {currentStory.content}
                      </p>
                    </div>

                    {!currentStory.imageUrl && (
                      <div className="flex items-center gap-4 pt-4">
                        <button 
                          onClick={toggleAudio}
                          disabled={!audioBase64}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl font-bold transition-all active:scale-95",
                            isPlaying 
                              ? "bg-red-500/20 text-red-400 border border-red-500/30" 
                              : "bg-indigo-800 hover:bg-indigo-700 text-indigo-100"
                          )}
                        >
                          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                          <span>{isPlaying ? "Stop Narration" : "Listen to Story"}</span>
                        </button>
                        
                        <button 
                          onClick={saveToLibrary}
                          disabled={isSaving}
                          className="p-4 rounded-2xl bg-amber-500 text-indigo-950 hover:bg-amber-400 transition-all active:scale-95 disabled:opacity-50"
                          title="Save to Library"
                        >
                          {isSaving ? <Loader2 className="animate-spin" size={24} /> : <Save size={24} />}
                        </button>
                      </div>
                    )}

                    <div className="pt-8 flex items-center gap-4 border-t border-indigo-800/50">
                      <button 
                        onClick={handleRemix}
                        className="flex items-center gap-2 text-indigo-400 hover:text-amber-400 transition-colors"
                      >
                        <RotateCcw size={18} />
                        <span>Create Another</span>
                      </button>
                    </div>
                  </motion.div>
                </div>
              ) : (
                <div className="text-center py-20">
                  <p className="text-indigo-400">Something went wrong. Please try again.</p>
                  <button onClick={() => setView("home")} className="mt-4 text-amber-500 underline">Go Back</button>
                </div>
              )}
            </motion.section>
          )}

          {view === "library" && (
            <motion.section
              key="library"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold">Your Story Library</h2>
                <button 
                  onClick={() => setView("home")}
                  className="text-indigo-400 hover:text-indigo-200 flex items-center gap-1"
                >
                  <ChevronLeft size={18} />
                  <span>Back to Home</span>
                </button>
              </div>

              {library.length === 0 ? (
                <div className="text-center py-24 bg-indigo-950/30 rounded-3xl border border-indigo-900/50 border-dashed">
                  <BookOpen size={48} className="mx-auto text-indigo-800 mb-4" />
                  <p className="text-indigo-400 text-lg">Your library is empty. Start weaving some magic!</p>
                  <button 
                    onClick={() => setView("home")}
                    className="mt-6 px-8 py-3 bg-indigo-800 rounded-xl text-indigo-200 hover:bg-indigo-700 transition-colors"
                  >
                    Create Your First Story
                  </button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {library.map((story) => (
                    <motion.div
                      layout
                      key={story.id}
                      className="group bg-indigo-950/50 border border-indigo-800 rounded-2xl overflow-hidden hover:border-amber-500/50 transition-all"
                    >
                      <div className="aspect-video relative overflow-hidden">
                        <img 
                          src={story.imageUrl} 
                          alt={story.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-indigo-950 to-transparent opacity-60"></div>
                        
                        <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(story.id);
                            }}
                            className={cn(
                              "p-2 rounded-lg transition-colors",
                              story.isFavorite 
                                ? "bg-pink-500 text-white" 
                                : "bg-indigo-950/80 text-indigo-300 hover:bg-pink-500/20"
                            )}
                          >
                            <Heart size={16} fill={story.isFavorite ? "currentColor" : "none"} />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteFromLibrary(story.id);
                            }}
                            className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500 hover:text-white transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="p-5 space-y-3">
                        <h3 className="font-bold text-lg text-amber-100 line-clamp-1">{story.title}</h3>
                        <p className="text-indigo-400 text-sm line-clamp-2 leading-relaxed">
                          {story.content}
                        </p>
                        <button 
                          onClick={() => {
                            setCurrentStory(story);
                            setView("story");
                            setAudioBase64(story.audioUrl || null);
                          }}
                          className="w-full py-2 bg-indigo-800/50 hover:bg-indigo-800 text-indigo-200 rounded-xl text-sm font-semibold transition-colors"
                        >
                          Read Story
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-indigo-900/50 text-center text-indigo-700 text-sm">
        <p>© 2026 <span className="font-romantic italic">DreamWeaver</span> Bedtime Stories • Powered by Gemini AI</p>
      </footer>
    </div>
  );
}
