"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Mic, Plus, MoreVertical, Search, Moon, Sun, Loader2, Download, MessageSquare, X, Menu } from "lucide-react";

/* ===== Waveform tuning ===== */
const HALF_BARS = 20;
const FLOOR = 4;
const MAX = 56;
const GAIN = 2.2;
const SMOOTHING = 0.14;
/* =========================== */

export default function Home() {
  /* ---------- NOTES ---------- */
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);

  // IMPORTANT: avoid stale state inside MediaRecorder callbacks
  const activeIdRef = useRef(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const sessionsRef = useRef([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const [menuOpenId, setMenuOpenId] = useState(null);
  const [sidebarEditId, setSidebarEditId] = useState(null);
  const [sidebarEditValue, setSidebarEditValue] = useState("");

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  /* ---------- NEW FEATURES STATE ---------- */
  const [darkMode, setDarkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [generatingTitleForId, setGeneratingTitleForId] = useState(null);
  const [newBlockIndex, setNewBlockIndex] = useState(null); // For fade-in animation
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("idle"); // idle, sending, sent, error
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  /* ---------- RECORDING + WAVES ---------- */
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Tap to speak");
  const [levels, setLevels] = useState(new Array(HALF_BARS).fill(FLOOR));

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const freqDataRef = useRef(null);
  const animationRef = useRef(null);
  const smoothRef = useRef(new Array(HALF_BARS).fill(FLOOR));
  const maxEnergyRef = useRef(0);

  const skipEditResetRef = useRef(false);
  const recordingRef = useRef(false);
  const micButtonRef = useRef(null);

  // Keep recordingRef in sync
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  /* ---------- LOAD / SAVE ---------- */
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("scribe_sessions") || "[]");
    const migrated = saved.map((s) => ({
      id: s.id ?? crypto.randomUUID(),
      title: typeof s.title === "string" ? s.title : "New note",
      content:
        typeof s.content === "string"
          ? s.content
          : Array.isArray(s.entries)
          ? s.entries.join("\n\n")
          : "",
      createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
    }));

    setSessions(migrated);

    // Remember last opened note
    const lastActiveId = localStorage.getItem("scribe_last_active");
    if (lastActiveId && migrated.find((s) => s.id === lastActiveId)) {
      setActiveId(lastActiveId);
    } else {
      setActiveId(null);
    }

    // Load dark mode preference
    const savedDarkMode = localStorage.getItem("scribe_dark_mode");
    if (savedDarkMode === "true") setDarkMode(true);

    // Auto-focus mic button so spacebar works immediately
    setTimeout(() => micButtonRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    localStorage.setItem("scribe_sessions", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem("scribe_dark_mode", darkMode.toString());
  }, [darkMode]);

  // Save last active note
  useEffect(() => {
    if (activeId) {
      localStorage.setItem("scribe_last_active", activeId);
    }
  }, [activeId]);

  // Mobile swipe gestures for sidebar
  useEffect(() => {
    const minSwipeDistance = 30;

    function handleTouchStart(e) {
      touchStartX.current = e.touches[0].clientX;
    }

    function handleTouchEnd(e) {
      touchEndX.current = e.changedTouches[0].clientX;
      const distance = touchEndX.current - touchStartX.current;

      // Swipe right to open (from anywhere)
      if (distance > minSwipeDistance && !sidebarOpen) {
        setSidebarOpen(true);
      }
      
      // Swipe left to close
      if (distance < -minSwipeDistance && sidebarOpen) {
        setSidebarOpen(false);
      }
    }

    document.addEventListener("touchstart", handleTouchStart);
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [sidebarOpen]);

  /* ---------- KEYBOARD SHORTCUTS ---------- */
  const toggleRecordingRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(e) {
      // Esc to deselect note and go back to landing
      if (e.code === "Escape") {
        if (editingTitle) {
          setEditingTitle(false);
          setTitleValue(sessionsRef.current.find((s) => s.id === activeIdRef.current)?.title || "");
        } else if (sidebarEditId) {
          setSidebarEditId(null);
        } else if (activeIdRef.current) {
          setActiveId(null);
        }
        return;
      }

      // Only trigger spacebar if not typing in an input/textarea
      const tag = e.target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.code === "Space") {
        e.preventDefault();
        toggleRecordingRef.current?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editingTitle, sidebarEditId]);

  /* ---------- SWIPE GESTURE FOR MOBILE SIDEBAR ---------- */
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;

    function handleTouchStart(e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }

    function handleTouchEnd(e) {
      touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);
      
      // Only trigger if horizontal swipe is dominant (not scrolling)
      if (Math.abs(deltaX) > 50 && deltaY < 100) {
        // Swipe right from left edge (within 30px) opens sidebar
        if (deltaX > 0 && touchStartX < 30 && !sidebarOpen) {
          setSidebarOpen(true);
        }
        // Swipe left anywhere closes sidebar
        if (deltaX < 0 && sidebarOpen) {
          setSidebarOpen(false);
        }
      }
    }

    document.addEventListener("touchstart", handleTouchStart);
    document.addEventListener("touchend", handleTouchEnd);
    
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [sidebarOpen]);

  /* ---------- CLICK OUTSIDE MENU CLOSE ---------- */
  useEffect(() => {
    function onPointerDown(e) {
      const inMenu = e.target.closest("[data-menu-root='true']");
      const inBtn = e.target.closest("[data-menu-btn='true']");
      const isMenuItem = e.target.closest("[data-menu-item='true']");
      const inConfirm = e.target.closest("[data-confirm-dialog='true']");
      if (inMenu || inBtn || isMenuItem || inConfirm) return;
      setMenuOpenId(null);
      setDeleteConfirmId(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  /* ---------- DERIVED ---------- */
  const note = useMemo(
    () => sessions.find((s) => s.id === activeId) || null,
    [sessions, activeId]
  );

  // Filtered and sorted sessions
  const filteredSessions = useMemo(() => {
    let result = sessions;

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q)
      );
    }

    // Sort by updatedAt (most recent first)
    return [...result].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }, [sessions, searchQuery]);

  // Word and character count for active note
  const wordCount = useMemo(() => {
    if (!note) return { words: 0, chars: 0 };
    const text = note.content || "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, chars: text.length };
  }, [note]);

  // Count blocks for animation
  const blockCount = useMemo(() => {
    if (!note) return 0;
    return note.content.split(/\n\n/).filter((b) => b.trim()).length;
  }, [note]);

  // Keep title input synced with active note
  useEffect(() => {
    if (!note) return;
    setTitleValue(note.title);
    if (skipEditResetRef.current) {
      skipEditResetRef.current = false;
    } else {
      setEditingTitle(false);
    }
  }, [note?.id]);

  /* ---------- HELPERS ---------- */
  function formatTimestamp(date) {
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).toLowerCase();
  }

  function formatTimestampForEntry(date) {
    const d = new Date(date);
    const time = d.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).toLowerCase();
    const dateStr = d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${dateStr} · ${time}`;
  }

  function createSession({ focusTitleEdit = true, initialContent = "" } = {}) {
    const now = Date.now();
    const s = {
      id: crypto.randomUUID(),
      title: "New note",
      content: initialContent,
      createdAt: now,
      updatedAt: now,
    };

    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setStatus("Tap to speak");

    if (focusTitleEdit) {
      setEditingTitle(true);
      setTitleValue(s.title);
      setTimeout(() => document.getElementById("note-title-input")?.focus(), 0);
    }

    return s;
  }

  function updateTitleFor(id, title) {
    const nextTitle = (title || "").trim() || "New note";
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, title: nextTitle, updatedAt: Date.now() } : s
      )
    );
  }

  function updateContentFor(id, text) {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, content: text, updatedAt: Date.now() } : s
      )
    );
  }

  function appendToContentFor(id, text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;

    const timestamp = formatTimestampForEntry(Date.now());
    const entry = `${timestamp}\n${trimmed}`;

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        const sep = s.content.trim() ? "\n\n" : "";
        const nextContent = s.content + sep + entry;
        const newBlockCount = nextContent.split(/\n\n/).filter((b) => b.trim()).length;

        // Trigger fade-in animation for new block
        setNewBlockIndex(newBlockCount - 1);
        setTimeout(() => setNewBlockIndex(null), 500);

        return { ...s, content: nextContent, updatedAt: Date.now() };
      })
    );
  }

  function deleteSession(id) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === activeIdRef.current) setActiveId(null);
    setMenuOpenId(null);
    setDeleteConfirmId(null);
  }

  function confirmDelete(id) {
    setMenuOpenId(null);
    setDeleteConfirmId(id);
  }

  function renameFromSidebar(s) {
    setMenuOpenId(null);
    setSidebarEditId(s.id);
    setSidebarEditValue(s.title);
    setTimeout(() => document.getElementById("sidebar-title-input")?.focus(), 0);
  }

  function saveSidebarEdit(id) {
    const nextTitle = (sidebarEditValue || "").trim() || "New note";
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, title: nextTitle, updatedAt: Date.now() } : s
      )
    );
    if (id === activeId) {
      setTitleValue(nextTitle);
    }
    setSidebarEditId(null);
  }

  // Export note as .txt
  function exportNote() {
    if (!note) return;
    const content = `${note.title}\n\n${note.content}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${note.title.replace(/[^a-z0-9]/gi, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Submit feedback to Formspree
  async function submitFeedback(e) {
    e.preventDefault();
    if (!feedbackText.trim()) return;
    
    setFeedbackStatus("sending");
    
    try {
      const res = await fetch("https://formspree.io/f/mkonrrna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: feedbackText }),
      });
      
      if (res.ok) {
        setFeedbackStatus("sent");
        setFeedbackText("");
        setTimeout(() => {
          setFeedbackOpen(false);
          setFeedbackStatus("idle");
        }, 2000);
      } else {
        setFeedbackStatus("error");
      }
    } catch {
      setFeedbackStatus("error");
    }
  }

  /* ---------- WAVEFORM ---------- */
  function resetWave() {
    smoothRef.current.fill(FLOOR);
    setLevels(new Array(HALF_BARS).fill(FLOOR));
  }

  function computeRMS(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  function startVisualiser() {
    const analyser = analyserRef.current;
    const data = freqDataRef.current;

    const draw = () => {
      if (!analyser || !data) return;

      analyser.getByteFrequencyData(data);

      // Track RMS energy for speech detection
      const rms = computeRMS(data);
      maxEnergyRef.current = Math.max(maxEnergyRef.current, rms);

      const bins = Math.max(1, Math.floor(data.length / HALF_BARS));
      const next = [];

      for (let i = 0; i < HALF_BARS; i++) {
        let sum = 0;
        for (let j = 0; j < bins; j++) sum += data[i * bins + j];

        let v = (sum / bins) * GAIN;
        v = Math.min(MAX, Math.max(FLOOR, v));

        const prev = smoothRef.current[i];
        const sm = prev + (v - prev) * SMOOTHING;
        smoothRef.current[i] = sm;
        next.push(sm);
      }

      setLevels(next);
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
  }

  /* ---------- RECORD ---------- */
  const toggleRecording = useCallback(async () => {
    if (!recordingRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const recorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        });

        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        maxEnergyRef.current = 0;

        recorder.ondataavailable = (e) => {
          if (e.data?.size) chunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          streamRef.current?.getTracks()?.forEach((t) => t.stop());

          if (animationRef.current) cancelAnimationFrame(animationRef.current);
          try {
            await audioContextRef.current?.close();
          } catch {}

          resetWave();

          // Gate: reject if no real audio energy detected
          if (maxEnergyRef.current < 0.02) {
            setStatus("No speech detected — try again");
            return;
          }

          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const fd = new FormData();
          fd.append("file", new File([blob], "recording.webm"));

          setStatus("Transcribing…");
          setIsTranscribing(true);

          let text = "";
          try {
            const res = await fetch("/api/transcribe", {
              method: "POST",
              body: fd,
            });
            const data = await res.json();
            
            if (!res.ok) {
              setStatus(data.error || "Transcription failed");
              setIsTranscribing(false);
              return;
            }
            
            text = (data?.text || "").trim();
          } catch {
            setStatus("Transcription failed — please try again");
            setIsTranscribing(false);
            return;
          }

          setIsTranscribing(false);

          let targetId = activeIdRef.current;
          let isNewNote = false;

          if (!targetId) {
            const s = createSession({ focusTitleEdit: false, initialContent: "" });
            targetId = s.id;
            setActiveId(targetId);
            isNewNote = true;
          }

          if (text) {
            const currentNote = sessionsRef.current.find((s) => s.id === targetId);
            const needsTitle = isNewNote || (currentNote && currentNote.title === "New note");

            appendToContentFor(targetId, text);

            if (needsTitle) {
              setStatus("Generating title…");
              setIsGeneratingTitle(true);
              setGeneratingTitleForId(targetId);
              try {
                const titleRes = await fetch("/api/generate-title", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ transcript: text }),
                });
                const titleData = await titleRes.json();
                if (titleData.title && titleData.title !== "New note") {
                  updateTitleFor(targetId, titleData.title);
                  setTitleValue(titleData.title);
                }
              } catch (err) {
                console.error("Title generation failed:", err);
              }
              setIsGeneratingTitle(false);
              setGeneratingTitleForId(null);
            }

            setStatus("Tap to speak");
          } else {
            setStatus("Transcription failed");
          }
        };

        const ctx = new AudioContext();
        await ctx.resume();
        audioContextRef.current = ctx;

        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;

        analyserRef.current = analyser;
        freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);

        src.connect(analyser);

        const silent = ctx.createGain();
        silent.gain.value = 0;
        analyser.connect(silent);
        silent.connect(ctx.destination);

        recorder.start();
        setRecording(true);
        setStatus("Recording…");
        startVisualiser();
      } catch {
        setStatus("Mic permission blocked");
      }
    } else {
      setRecording(false);
      try {
        mediaRecorderRef.current?.stop();
      } catch {}
    }
  }, []);

  // Keep toggleRecordingRef updated
  useEffect(() => {
    toggleRecordingRef.current = toggleRecording;
  }, [toggleRecording]);

  /* ---------- THEME CLASSES ---------- */
  const theme = {
    bg: darkMode ? "bg-gray-900" : "bg-gray-100",
    sidebar: darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200",
    text: darkMode ? "text-gray-100" : "text-black",
    textMuted: darkMode ? "text-gray-400" : "text-gray-600",
    textMuted2: darkMode ? "text-gray-500" : "text-gray-500",
    input: darkMode ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-black",
    hover: darkMode ? "hover:bg-gray-700" : "hover:bg-gray-100",
    active: darkMode ? "bg-gray-700" : "bg-gray-200",
    menu: darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200",
    micBtn: darkMode
      ? "bg-gray-700 border-gray-600 text-white"
      : "bg-white border-gray-300 text-black",
    micBtnActive: darkMode ? "bg-white text-black" : "bg-gray-900 text-white",
    bar: darkMode ? "bg-white" : "bg-black",
  };

  /* ---------- MIC BLOCK ---------- */
  const MicBlock = (
    <div className="w-full flex flex-col items-center">
      <div className="relative group">
        <button
          ref={micButtonRef}
          onClick={toggleRecording}
          disabled={isTranscribing}
          className={`w-20 h-20 rounded-full flex items-center justify-center shadow-md transition ${
            recording ? theme.micBtnActive : theme.micBtn
          } border disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 ${darkMode ? 'focus:ring-gray-500' : 'focus:ring-gray-400'}`}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {isTranscribing ? (
            <Loader2 size={34} className="animate-spin" />
          ) : (
            <Mic size={34} />
          )}
        </button>
        
        {/* Tooltip */}
        {!recording && !isTranscribing && (
          <div className={`absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-800 text-white'}`}>
            Press Space to record
          </div>
        )}
      </div>

      {recording && (
        <div className="mt-4 flex h-14 items-center justify-center">
          {[...levels].reverse().concat(levels).map((h, i) => (
            <div
              key={i}
              className={`w-[3px] ${theme.bar} mx-[2px] rounded-full`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
      )}

      <p className={`mt-3 ${theme.textMuted} text-sm text-center max-w-md flex items-center gap-2 justify-center`}>
        {(isTranscribing || isGeneratingTitle) && (
          <Loader2 size={14} className="animate-spin" />
        )}
        {status}
      </p>
    </div>
  );

  /* ---------- EMPTY STATE ---------- */
  const EmptyState = (
    <div className="flex flex-col items-center justify-center text-center">
      <h3 className={`text-lg font-medium mb-1 ${theme.text}`}>No notes yet</h3>
      <p className={`text-sm ${theme.textMuted} mb-6`}>Record your first voice note to get started</p>
      {MicBlock}
    </div>
  );

  /* ---------- UI ---------- */
  return (
    <div className={`flex min-h-screen ${theme.bg} ${theme.text}`}>
      {/* CSS for fade-in animation */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>

      {/* Mobile Header */}
      <div className={`fixed top-0 left-0 right-0 z-40 md:hidden flex items-center justify-between px-4 py-3 ${theme.sidebar} border-b`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className={`p-2 rounded ${theme.hover}`}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h2 className="text-lg font-semibold">Scribe</h2>
        <button
          onClick={() => setDarkMode(!darkMode)}
          className={`p-2 rounded ${theme.hover}`}
          aria-label="Toggle dark mode"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      <div 
        className={`fixed inset-0 z-40 md:hidden bg-black transition-opacity duration-300 ${sidebarOpen ? 'opacity-50' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* SIDEBAR */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-72 md:w-64 
        ${theme.sidebar} border-r p-4 flex flex-col
        transform transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Scribe</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded ${theme.hover} hidden md:block`}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className={`p-2 rounded ${theme.hover} md:hidden`}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            createSession({ focusTitleEdit: true });
            setSidebarOpen(false); // Close on mobile
          }}
          className={`flex items-center gap-2 text-sm mb-4 ${theme.text}`}
        >
          <Plus size={16} /> New note
        </button>

        {/* Search */}
        <div className={`flex items-center gap-2 mb-4 px-2 py-1.5 rounded border ${theme.input}`}>
          <Search size={14} className={theme.textMuted} />
          <input
            type="text"
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={() => setSearchQuery("")}
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </div>

        <div className="space-y-1 flex-1 overflow-y-auto">
          {filteredSessions.map((s) => (
            <div
              key={s.id}
              className={`relative flex items-center px-2 py-1.5 rounded ${
                s.id === activeId ? theme.active : theme.hover
              }`}
            >
              {sidebarEditId === s.id ? (
                <input
                  id="sidebar-title-input"
                  value={sidebarEditValue}
                  onChange={(e) => setSidebarEditValue(e.target.value)}
                  onBlur={() => saveSidebarEdit(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveSidebarEdit(s.id);
                    if (e.key === "Escape") setSidebarEditId(null);
                  }}
                  className={`text-sm flex-1 rounded px-1 py-0.5 outline-none ${theme.input}`}
                />
              ) : (
                <button
                  onClick={() => {
                    setActiveId(s.id);
                    setSidebarOpen(false); // Close on mobile
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setSidebarEditId(s.id);
                    setSidebarEditValue(s.title);
                    setTimeout(() => document.getElementById("sidebar-title-input")?.focus(), 0);
                  }}
                  className="text-sm truncate flex-1 text-left flex items-center gap-2"
                >
                  {generatingTitleForId === s.id ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span className={theme.textMuted}>Generating…</span>
                    </>
                  ) : (
                    s.title
                  )}
                </button>
              )}

              <button
                data-menu-btn="true"
                onClick={() => setMenuOpenId(menuOpenId === s.id ? null : s.id)}
                className={`ml-2 ${theme.textMuted} hover:${theme.text}`}
                aria-label="Note options"
              >
                <MoreVertical size={16} />
              </button>

              {menuOpenId === s.id && (
                <div
                  data-menu-root="true"
                  className={`absolute right-2 top-8 ${theme.menu} border rounded shadow text-sm z-20 min-w-[120px]`}
                >
                  <button
                    data-menu-item="true"
                    onClick={() => renameFromSidebar(s)}
                    className={`block px-3 py-2 w-full text-left ${theme.hover}`}
                  >
                    Rename
                  </button>
                  <button
                    data-menu-item="true"
                    onClick={() => confirmDelete(s.id)}
                    className={`block px-3 py-2 w-full text-left text-red-500 ${theme.hover}`}
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Delete confirmation dialog */}
              {deleteConfirmId === s.id && (
                <div
                  data-confirm-dialog="true"
                  className={`absolute right-0 top-8 ${theme.menu} border rounded shadow p-3 z-30 min-w-[200px]`}
                >
                  <p className="text-sm mb-3">Delete this note?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className={`flex-1 px-3 py-1.5 text-sm rounded border ${theme.input}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      className="flex-1 px-3 py-1.5 text-sm rounded bg-red-500 text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filteredSessions.length === 0 && sessions.length > 0 && (
            <p className={`text-sm ${theme.textMuted} px-2`}>
              No notes found
            </p>
          )}
        </div>

        {/* Footer with storage notice and disclaimer */}
        <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button
            onClick={() => setFeedbackOpen(true)}
            className={`flex items-center gap-2 text-sm ${theme.textMuted} ${theme.hover} w-full px-2 py-1.5 rounded mb-3`}
          >
            <MessageSquare size={14} />
            Send feedback
          </button>
          <p className={`text-xs ${theme.textMuted2} leading-relaxed`}>
            Notes stored locally in your browser.
          </p>
          <p className={`text-xs ${theme.textMuted2} leading-relaxed mt-2 italic`}>
            Experimental voice notes — avoid recording sensitive information.
          </p>
        </div>
      </aside>

      {/* Feedback Modal */}
      {feedbackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              if (feedbackStatus !== "sending") {
                setFeedbackOpen(false);
                setFeedbackStatus("idle");
              }
            }}
          />
          
          {/* Modal */}
          <div className={`relative w-full max-w-md rounded-lg shadow-xl p-6 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <button
              onClick={() => {
                setFeedbackOpen(false);
                setFeedbackStatus("idle");
              }}
              className={`absolute top-4 right-4 ${theme.textMuted} hover:${theme.text}`}
            >
              <X size={20} />
            </button>
            
            <h3 className={`text-lg font-semibold mb-2 ${theme.text}`}>Send Feedback</h3>
            <p className={`text-sm ${theme.textMuted} mb-4`}>
              Bug reports, feature requests, or just say hi!
            </p>
            
            {feedbackStatus === "sent" ? (
              <div className={`text-center py-8 ${theme.text}`}>
                <p className="text-lg mb-1">Thanks for your feedback! 🎉</p>
                <p className={`text-sm ${theme.textMuted}`}>We appreciate you taking the time.</p>
              </div>
            ) : (
              <form onSubmit={submitFeedback}>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={4}
                  className={`w-full p-3 rounded-lg border resize-none outline-none text-sm ${theme.input} ${darkMode ? 'placeholder:text-gray-500' : 'placeholder:text-gray-400'}`}
                  disabled={feedbackStatus === "sending"}
                />
                
                {feedbackStatus === "error" && (
                  <p className="text-red-500 text-sm mt-2">Something went wrong. Please try again.</p>
                )}
                
                <button
                  type="submit"
                  disabled={!feedbackText.trim() || feedbackStatus === "sending"}
                  className={`mt-4 w-full py-2 px-4 rounded-lg text-sm font-medium transition disabled:opacity-50 ${
                    darkMode 
                      ? 'bg-white text-gray-900 hover:bg-gray-100' 
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                >
                  {feedbackStatus === "sending" ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Sending...
                    </span>
                  ) : (
                    "Send Feedback"
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MAIN */}
      <main className="flex-1 px-4 md:px-12 pt-16 md:pt-10 pb-10 relative flex flex-col items-center">
        {!note ? (
          <div className="min-h-[70vh] flex items-center justify-center w-full">
            <div className="w-full max-w-xl">
              {sessions.length === 0 ? EmptyState : MicBlock}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-3xl pb-44">
            {/* Title row with export button */}
            <div className="flex items-start justify-between gap-4 group">
              {editingTitle ? (
                <input
                  id="note-title-input"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={() => {
                    updateTitleFor(note.id, titleValue);
                    setEditingTitle(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateTitleFor(note.id, titleValue);
                      setEditingTitle(false);
                    }
                    if (e.key === "Escape") {
                      setTitleValue(note.title);
                      setEditingTitle(false);
                    }
                  }}
                  className={`text-3xl font-semibold mb-2 bg-transparent outline-none flex-1 ${theme.text}`}
                />
              ) : (
                <h1
                  onClick={() => setEditingTitle(true)}
                  className={`text-3xl font-semibold mb-2 cursor-text flex-1 ${theme.text}`}
                >
                  {note.title}
                </h1>
              )}
              
              {/* Export button - always visible */}
              <button
                onClick={exportNote}
                className={`p-2 rounded ${theme.hover} ${theme.textMuted}`}
                aria-label="Export as .txt"
                title="Export as .txt"
              >
                <Download size={18} />
              </button>
            </div>

            {/* Meta info: word count and last updated */}
            <div className={`flex items-center gap-4 text-xs ${theme.textMuted2} mb-4`}>
              <span>{wordCount.words} words · {wordCount.chars} characters</span>
              <span>Updated {formatTimestamp(note.updatedAt || note.createdAt)}</span>
            </div>

            {/* Body */}
            <div className="min-h-[46vh] w-full text-lg leading-relaxed">
              {note.content.split(/\n\n/).map((block, i, arr) => {
                // Check for timestamp patterns at start of block
                const timestampMatch = block.match(/^([A-Za-z]{3} \d{1,2} · \d{1,2}:\d{2} [ap]m)(\s*\(edited\))?\n([\s\S]*)$/);
                const legacyMatch = block.match(/^\[(.+?)\](\s*\(edited\))?\n?([\s\S]*)$/);
                const dotMatch = block.match(/^· (.+?)(\s*\(edited\))?\n([\s\S]*)$/);
                
                let timestamp = null;
                let isEdited = false;
                let content = block;
                
                if (timestampMatch) {
                  timestamp = timestampMatch[1];
                  isEdited = !!timestampMatch[2];
                  content = timestampMatch[3];
                } else if (legacyMatch) {
                  timestamp = legacyMatch[1];
                  isEdited = !!legacyMatch[2];
                  content = legacyMatch[3];
                } else if (dotMatch) {
                  timestamp = dotMatch[1];
                  isEdited = !!dotMatch[2];
                  content = dotMatch[3];
                }
                
                if (!content.trim() && !timestamp) return null;
                
                const isNewBlock = i === newBlockIndex;
                
                return (
                  <div key={i} className={`mb-4 ${isNewBlock ? 'animate-fade-in' : ''}`}>
                    {timestamp && (
                      <p className={`text-sm mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        <span className="italic">{timestamp}</span>
                        {isEdited && (
                          <span className="text-xs ml-1 italic">(edited)</span>
                        )}
                      </p>
                    )}
                    <textarea
                      value={content}
                      onChange={(e) => {
                        // Rebuild the full content
                        const blocks = note.content.split(/\n\n/);
                        if (timestamp) {
                          // Mark as edited if content changed
                          blocks[i] = `${timestamp} (edited)\n${e.target.value}`;
                        } else {
                          blocks[i] = e.target.value;
                        }
                        updateContentFor(note.id, blocks.join('\n\n'));
                        
                        // Auto-resize
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onInput={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      ref={(el) => {
                        if (el) {
                          el.style.height = 'auto';
                          el.style.height = el.scrollHeight + 'px';
                        }
                      }}
                      className={`w-full resize-none bg-transparent outline-none leading-relaxed ${theme.text} overflow-hidden`}
                    />
                  </div>
                );
              })}
              
              {!note.content && (
                <textarea
                  value=""
                  onChange={(e) => updateContentFor(note.id, e.target.value)}
                  className={`w-full min-h-[20vh] resize-none bg-transparent outline-none leading-relaxed ${theme.text} placeholder:${theme.textMuted}`}
                  placeholder="Start typing or use voice…"
                />
              )}
            </div>
          </div>
        )}

        {note && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl flex justify-center pointer-events-none">
            <div className="pointer-events-auto">{MicBlock}</div>
          </div>
        )}
      </main>
    </div>
  );
}
