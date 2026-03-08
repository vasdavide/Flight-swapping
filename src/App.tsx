import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Plane, 
  ArrowRightLeft, 
  Plus, 
  X, 
  ChevronLeft, 
  ChevronRight,
  Loader2,
  Image as ImageIcon,
  Camera,
  Sparkles,
  Trash2,
  User,
  LogOut,
  Save,
  FolderOpen,
  Search
} from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  eachDayOfInterval,
  parseISO
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Flight, SwapRequest, SwapProposal } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [loginId, setLoginId] = useState<string>(() => localStorage.getItem('skycrew_login_id') || '');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [flights, setFlights] = useState<Flight[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [incomingProposals, setIncomingProposals] = useState<SwapProposal[]>([]);
  const [outgoingProposals, setOutgoingProposals] = useState<SwapProposal[]>([]);
  
  const [isAddingFlight, setIsAddingFlight] = useState(false);
  const [isProposingSwap, setIsProposingSwap] = useState(false);
  const [selectedListing, setSelectedListing] = useState<SwapRequest | null>(null);
  const [offeredFlightId, setOfferedFlightId] = useState<number | null>(null);
  const [flightCode, setFlightCode] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'calendar' | 'swaps' | 'profile'>('calendar');
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Modals state
  const [flightToDelete, setFlightToDelete] = useState<number | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [candidatesModal, setCandidatesModal] = useState<{isOpen: boolean, date: string, flightCode: string, candidates: string[]}>({isOpen: false, date: '', flightCode: '', candidates: []});

  // Image Editing State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);

  const fetchProposals = async () => {
    if (!loginId) return;
    try {
      const [incoming, outgoing] = await Promise.all([
        fetch(`/api/proposals/incoming?email=${loginId}`).then(r => r.json()),
        fetch(`/api/proposals/outgoing?email=${loginId}`).then(r => r.json())
      ]);
      setIncomingProposals(incoming);
      setOutgoingProposals(outgoing);
    } catch (err) {
      console.error("Failed to fetch proposals", err);
    }
  };

  const fetchFlights = async () => {
    if (!loginId) return;
    try {
      const res = await fetch(`/api/flights?email=${loginId}`);
      const serverFlights = await res.json();
      setFlights(serverFlights);
    } catch (err) {
      console.error("Failed to fetch flights", err);
    }
  };

  const fetchSwaps = async () => {
    if (!loginId) return;
    try {
      const res = await fetch('/api/swaps');
      const data = await res.json();
      setSwaps(data);
    } catch (err) {
      console.error("Failed to fetch swaps", err);
    }
  };

  useEffect(() => {
    if (loginId) {
      fetchFlights();
      fetchSwaps();
      fetchProposals();
    }
  }, [loginId]);

  const handleFindCandidates = async (date: string, flightCode: string) => {
    if (!loginId) return;
    try {
      const res = await fetch(`/api/candidates?date=${date}&email=${loginId}`);
      const candidates = await res.json();
      setCandidatesModal({ isOpen: true, date, flightCode, candidates });
    } catch (err) {
      console.error("Failed to fetch candidates", err);
    }
  };

  const handleScanSchedule = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: file.type
            }
          },
          {
            text: `This is a picture of a written flight schedule. 
            Extract all flights where the crew member is on duty.
            For each flight, identify: flight_code, departure_city, arrival_city, departure_time (HH:mm), arrival_time (HH:mm), and date (YYYY-MM-DD).
            Return ONLY a JSON array of objects with these keys.`
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                flight_code: { type: Type.STRING },
                departure_city: { type: Type.STRING },
                arrival_city: { type: Type.STRING },
                departure_time: { type: Type.STRING },
                arrival_time: { type: Type.STRING },
                date: { type: Type.STRING },
              },
              required: ["flight_code", "departure_city", "arrival_city", "departure_time", "arrival_time", "date"]
            }
          }
        }
      });

      const extractedFlights: Flight[] = JSON.parse(response.text || '[]');
      
      if (extractedFlights.length === 0) {
        setAlertMessage("No flights detected in the image. Please try a clearer photo.");
        return;
      }

      let addedCount = 0;
      let duplicateCount = 0;
      const currentFlights = [...flights];

      // Save all extracted flights
      for (const flight of extractedFlights) {
        const isDuplicate = currentFlights.some(f => f.date === flight.date && f.flight_code.toUpperCase() === flight.flight_code.toUpperCase());
        
        if (!isDuplicate) {
          await fetch('/api/flights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...flight,
              user_email: loginId
            })
          });
          currentFlights.push(flight);
          addedCount++;
        } else {
          duplicateCount++;
        }
      }

      await fetchFlights();
      setAlertMessage(`Successfully imported ${addedCount} flights. ${duplicateCount > 0 ? `Skipped ${duplicateCount} duplicates.` : ''}`);
    } catch (err) {
      console.error("Failed to scan schedule", err);
      setAlertMessage("Failed to process the image. Please ensure it's a clear photo of a flight schedule.");
    } finally {
      setIsScanning(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleAddFlight = async () => {
    if (!flightCode || !selectedDate) return;
    
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const isDuplicate = flights.some(f => f.date === dateString && f.flight_code.toUpperCase() === flightCode.toUpperCase());
    
    if (isDuplicate) {
      setAlertMessage(`Flight ${flightCode.toUpperCase()} already exists on ${dateString}.`);
      return;
    }

    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Parse this flight code "${flightCode}" for the date ${format(selectedDate, 'yyyy-MM-dd')}. 
        If it's a real-looking code (like AA123, BA456), generate plausible flight details (departure city, arrival city, departure time, arrival time).
        Return ONLY a JSON object with these keys: departure_city, arrival_city, departure_time, arrival_time.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              departure_city: { type: Type.STRING },
              arrival_city: { type: Type.STRING },
              departure_time: { type: Type.STRING, description: "HH:mm" },
              arrival_time: { type: Type.STRING, description: "HH:mm" },
            },
            required: ["departure_city", "arrival_city", "departure_time", "arrival_time"]
          }
        }
      });

      const details = JSON.parse(response.text || '{}');
      const newFlight: Flight = {
        user_email: loginId,
        flight_code: flightCode.toUpperCase(),
        date: format(selectedDate, 'yyyy-MM-dd'),
        ...details
      };

      await fetch('/api/flights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFlight)
      });

      await fetchFlights();
      setIsAddingFlight(false);
      setFlightCode('');
      setSelectedDate(null);
    } catch (err) {
      console.error("Failed to add flight", err);
      setAlertMessage("Could not parse flight code. Please try a standard format like AA123.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearData = async () => {
    if (flights.length === 0) {
      setAlertMessage("No data to clear.");
      return;
    }
    setIsClearingAll(true);
  };

  const handleLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    try {
      const text = await file.text();
      const importedFlights = JSON.parse(text);
      if (!Array.isArray(importedFlights)) throw new Error("Invalid format");

      let addedCount = 0;
      let duplicateCount = 0;
      const currentFlights = [...flights];

      // Process in batches to avoid overwhelming the server
      const batchSize = 5;
      for (let i = 0; i < importedFlights.length; i += batchSize) {
        const batch = importedFlights.slice(i, i + batchSize);
        await Promise.all(batch.map(async (f) => {
          const isDuplicate = currentFlights.some(existing => 
            existing.date === f.date && 
            existing.flight_code.toUpperCase() === f.flight_code.toUpperCase()
          );
          
          if (!isDuplicate) {
            const { id, user_email, ...flightData } = f;
            // Force the user_email to be the current loginId
            await fetch('/api/flights', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...flightData, user_email: loginId })
            });
            currentFlights.push({ ...f, user_email: loginId });
            addedCount++;
          } else {
            duplicateCount++;
          }
        }));
      }
      
      await fetchFlights();
      setAlertMessage(`Schedule loaded successfully! Added ${addedCount} flights to your account (${loginId}). ${duplicateCount > 0 ? `Skipped ${duplicateCount} duplicates.` : ''}`);
    } catch (err) {
      console.error("Failed to load file", err);
      setAlertMessage("Failed to load schedule. Please ensure it's a valid JSON file.");
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  const handleExportFile = () => {
    if (flights.length === 0) {
      setAlertMessage("No data to export.");
      return;
    }
    
    // Ensure we only export flights belonging to the current user
    const userFlights = flights.filter(f => f.user_email === loginId);
    
    if (userFlights.length === 0) {
      setAlertMessage("No flights found for your account to export.");
      return;
    }

    const dataStr = JSON.stringify(userFlights, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `skycrew_schedule_${loginId}_${format(new Date(), 'yyyyMMdd')}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const executeClearData = async () => {
    setIsClearingAll(false);
    setIsLoading(true);
    try {
      // Delete all flights from the server
      for (const f of flights) {
        if (f.id) {
          await fetch(`/api/flights/${f.id}`, { method: 'DELETE' });
        }
      }
      setFlights([]);
      localStorage.removeItem('skycrew_flights');
      setAlertMessage("All data cleared successfully.");
    } catch (err) {
      console.error("Failed to clear data", err);
      setAlertMessage("Failed to clear some data.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteFlight = async (id: number) => {
    setFlightToDelete(id);
  };

  const executeDeleteFlight = async () => {
    if (flightToDelete === null) return;
    const id = flightToDelete;
    setFlightToDelete(null);
    try {
      await fetch(`/api/flights/${id}`, { method: 'DELETE' });
      const updatedFlights = flights.filter(f => f.id !== id);
      setFlights(updatedFlights);
    } catch (err) {
      console.error("Failed to delete flight", err);
    }
  };

  const handlePostSwap = async (flightId: number) => {
    try {
      const res = await fetch('/api/swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requester_email: loginId, flight_id: flightId })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to post swap");
      }
      alert("Swap request posted to the board!");
      fetchSwaps();
    } catch (err: any) {
      console.error("Failed to post swap", err);
      alert(err.message);
    }
  };

  const handleCancelSwap = async (swapId: number) => {
    try {
      const res = await fetch(`/api/swaps/${swapId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to cancel swap");
      alert("Swap request cancelled.");
      fetchSwaps();
    } catch (err: any) {
      console.error("Failed to cancel swap", err);
      alert(err.message);
    }
  };

  const handleProposeSwap = async () => {
    if (!selectedListing || !offeredFlightId) return;
    try {
      await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: selectedListing.id,
          proposer_email: loginId,
          proposer_flight_id: offeredFlightId
        })
      });
      alert("Proposal sent!");
      setIsProposingSwap(false);
      setSelectedListing(null);
      setOfferedFlightId(null);
      fetchProposals();
    } catch (err) {
      console.error("Failed to propose swap", err);
    }
  };

  const handleRespondToProposal = async (proposalId: number, status: 'accepted' | 'declined') => {
    try {
      await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      setAlertMessage(`Proposal ${status}!`);
      fetchProposals();
      fetchFlights();
      fetchSwaps();
    } catch (err) {
      console.error("Failed to respond to proposal", err);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEditImage = async () => {
    if (!selectedImage || !editPrompt) return;
    setIsEditingImage(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const base64Data = selectedImage.split(',')[1];
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/png' } },
            { text: editPrompt }
          ]
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setSelectedImage(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
      setEditPrompt('');
    } catch (err) {
      console.error("Failed to edit image", err);
      setAlertMessage("Image editing failed. Please try a different prompt.");
    } finally {
      setIsEditingImage(false);
    }
  };

  // Calendar Logic
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const flightsByDate = useMemo(() => {
    const map: Record<string, Flight[]> = {};
    flights.forEach(f => {
      if (!map[f.date]) map[f.date] = [];
      map[f.date].push(f);
    });
    return map;
  }, [flights]);

  if (!loginId) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4 font-sans text-[#1A1A1A]">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-6">
            <Plane size={32} />
          </div>
          <h1 className="text-2xl font-bold mb-2">Welcome to SkyCrew</h1>
          <p className="text-gray-500 mb-8">Enter your Login ID to access your schedule and swap board.</p>
          
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const id = formData.get('loginId') as string;
            if (id.trim()) {
              const email = id.trim();
              
              // Load from local drive (localStorage) when logging in
              const localDriveData = localStorage.getItem(`skycrew_local_drive_${email}`);
              if (localDriveData) {
                try {
                  const importedFlights = JSON.parse(localDriveData);
                  // Check if server is empty before restoring to avoid duplicates
                  const res = await fetch(`/api/flights?email=${email}`);
                  const serverFlights = await res.json();
                  
                  if (serverFlights.length === 0 && importedFlights.length > 0) {
                    for (const f of importedFlights) {
                      const { id, ...flightData } = f;
                      await fetch('/api/flights', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...flightData, user_email: email })
                      });
                    }
                  }
                } catch (err) {
                  console.error("Failed to load from local drive", err);
                }
              }

              setLoginId(email);
              localStorage.setItem('skycrew_login_id', email);
            }
          }}>
            <input 
              type="text" 
              name="loginId"
              placeholder="e.g. vasdavide@gmail.com" 
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4"
              required
            />
            <button 
              type="submit"
              className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Log In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans">
      {/* Modals */}
      <AnimatePresence>
        {candidatesModal.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Available Candidates</h3>
                <button 
                  onClick={() => setCandidatesModal({ ...candidatesModal, isOpen: false })}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>
              
              <p className="text-sm text-gray-600 mb-4">
                These crew members do not have a flight scheduled on <strong>{format(parseISO(candidatesModal.date), 'MMM d, yyyy')}</strong>. You can contact them to swap your flight <strong>{candidatesModal.flightCode}</strong>.
              </p>

              <div className="max-h-60 overflow-y-auto space-y-2">
                {candidatesModal.candidates.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No available candidates found for this date.
                  </div>
                ) : (
                  candidatesModal.candidates.map(email => (
                    <div key={email} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <span className="text-sm font-medium">{email}</span>
                      <a 
                        href={`mailto:${email}?subject=Flight Swap Request: ${candidatesModal.flightCode} on ${format(parseISO(candidatesModal.date), 'MMM d')}&body=Hi,%0D%0A%0D%0AI saw you are off on ${format(parseISO(candidatesModal.date), 'MMM d')}. Would you be interested in taking my flight ${candidatesModal.flightCode}?%0D%0A%0D%0AThanks!`}
                        className="text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        Email
                      </a>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {alertMessage && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white p-6 rounded-2xl max-w-sm w-full shadow-xl"
            >
              <h3 className="text-lg font-semibold mb-2">Notice</h3>
              <p className="text-gray-600 mb-6">{alertMessage}</p>
              <div className="flex justify-end">
                <button onClick={() => setAlertMessage(null)} className="px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl font-medium">OK</button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isClearingAll && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white p-6 rounded-2xl max-w-sm w-full shadow-xl"
            >
              <h3 className="text-lg font-semibold mb-2 text-red-600">Clear all data?</h3>
              <p className="text-gray-600 mb-6">Are you sure you want to clear all your flights? This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setIsClearingAll(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-medium">Cancel</button>
                <button onClick={executeClearData} className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-xl font-medium">Clear Data</button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {flightToDelete !== null && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white p-6 rounded-2xl max-w-sm w-full shadow-xl"
            >
              <h3 className="text-lg font-semibold mb-2 text-red-600">Remove Flight?</h3>
              <p className="text-gray-600 mb-6">Are you sure you want to remove this flight from your schedule?</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setFlightToDelete(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-medium">Cancel</button>
                <button onClick={executeDeleteFlight} className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-xl font-medium">Remove</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-black/5 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white">
            <Plane size={24} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Flight swapping search</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setActiveTab('calendar')}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors", activeTab === 'calendar' ? "bg-emerald-50 text-emerald-700" : "hover:bg-gray-100")}
          >
            Calendar
          </button>
          <button 
            onClick={() => setActiveTab('swaps')}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors", activeTab === 'swaps' ? "bg-emerald-50 text-emerald-700" : "hover:bg-gray-100")}
          >
            Swap Board
          </button>
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors", activeTab === 'profile' ? "bg-emerald-50 text-emerald-700" : "hover:bg-gray-100")}
          >
            Profile
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {activeTab === 'calendar' && (
            <motion.div 
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Calendar Controls */}
              <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-black/5">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-light">{format(currentDate, 'MMMM yyyy')}</h2>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft size={20}/></button>
                    <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight size={20}/></button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExportFile}
                    disabled={isLoading || isScanning || flights.length === 0}
                    className="bg-white hover:bg-gray-50 text-gray-700 border border-black/5 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    title="Export schedule to file"
                  >
                    <Save size={18} />
                  </button>
                  <label 
                    className={cn(
                      "relative bg-white hover:bg-gray-50 text-gray-700 border border-black/5 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 cursor-pointer",
                      (isScanning || isLoading) && "opacity-50 cursor-not-allowed pointer-events-none"
                    )}
                    title="Load schedule from file"
                  >
                    <FolderOpen size={18} />
                    <input 
                      type="file" 
                      accept=".json,application/json" 
                      className="hidden" 
                      onChange={handleLoadFile}
                      disabled={isScanning || isLoading}
                    />
                  </label>
                  <button 
                    onClick={handleClearData}
                    disabled={isLoading || isScanning}
                    className="bg-white hover:bg-red-50 text-red-600 border border-red-100 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    title="Clear all data"
                  >
                    {isLoading && flights.length > 0 ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                  </button>
                  <label 
                    className={cn(
                      "relative bg-white hover:bg-gray-50 text-gray-700 border border-black/5 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 cursor-pointer",
                      (isScanning || isLoading) && "opacity-50 cursor-not-allowed pointer-events-none"
                    )}
                    title="Scan Schedule"
                  >
                    {isScanning ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                    <input 
                      type="file" 
                      accept="image/*" 
                      capture="environment" 
                      className="hidden" 
                      onChange={handleScanSchedule}
                      disabled={isScanning || isLoading}
                    />
                  </label>
                  <button 
                    onClick={() => setIsAddingFlight(true)}
                    disabled={isLoading || isScanning}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-md active:scale-95 disabled:opacity-50"
                    title="Add Flight"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>

              {/* Calendar Grid */}
              <div className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden">
                <div className="grid grid-cols-7 border-b border-black/5">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400 border-r border-black/5 last:border-r-0">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {calendarDays.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayFlights = flightsByDate[dateStr] || [];
                    const isCurrentMonth = isSameMonth(day, monthStart);
                    
                    return (
                      <div 
                        key={i} 
                        onClick={() => {
                          setSelectedDate(day);
                          setIsAddingFlight(true);
                        }}
                        className={cn(
                          "min-h-[140px] p-2 border-r border-b border-black/5 last:border-r-0 relative group cursor-pointer hover:bg-gray-50/80 transition-colors",
                          !isCurrentMonth && "bg-gray-50/50"
                        )}
                      >
                        <span className={cn(
                          "text-sm font-medium",
                          !isCurrentMonth ? "text-gray-300" : "text-gray-500",
                          isSameDay(day, new Date()) && "bg-emerald-600 text-white w-6 h-6 flex items-center justify-center rounded-full"
                        )}>
                          {format(day, 'd')}
                        </span>
                        
                        <div className="mt-2 space-y-1">
                          {dayFlights.map(f => {
                            const isListed = swaps.some(s => s.flight_id === f.id);
                            return (
                            <div 
                              key={f.id} 
                              onClick={(e) => e.stopPropagation()}
                              className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-1.5 rounded-lg text-[10px] flex flex-col gap-0.5 group/flight relative"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold">{f.flight_code}</span>
                                <button 
                                  onClick={() => handleDeleteFlight(f.id!)}
                                  className="text-gray-400 hover:text-red-600 transition-colors"
                                  title="Remove flight"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                              <div className="flex items-center gap-1 opacity-80">
                                <span>{f.departure_city}</span>
                                <Plane size={8} className="rotate-90" />
                                <span>{f.arrival_city}</span>
                              </div>
                              <div className="font-medium">{f.departure_time} - {f.arrival_time}</div>
                              
                              <div className="flex items-center gap-1 mt-1">
                                <button 
                                  onClick={() => !isListed && handlePostSwap(f.id!)}
                                  disabled={isListed}
                                  className={cn(
                                    "flex-1 text-[9px] py-0.5 px-1 rounded border flex items-center justify-center gap-1 transition-colors",
                                    isListed 
                                      ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed" 
                                      : "bg-white/50 hover:bg-white text-emerald-700 border-emerald-200"
                                  )}
                                  title={isListed ? "Already posted" : "Post to Swap Board"}
                                >
                                  <ArrowRightLeft size={8} /> {isListed ? "Listed" : "Post"}
                                </button>
                                <button 
                                  onClick={() => handleFindCandidates(f.date, f.flight_code)}
                                  className="flex-1 text-[9px] bg-white/50 hover:bg-white text-blue-700 py-0.5 px-1 rounded border border-blue-200 flex items-center justify-center gap-1 transition-colors"
                                  title="Find Replacements"
                                >
                                  <Search size={8} /> Find
                                </button>
                              </div>
                            </div>
                          )})}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'swaps' && (
            <motion.div 
              key="swaps"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              {/* Incoming Proposals Section */}
              {incomingProposals.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <Sparkles size={20} />
                    <h3 className="text-lg font-semibold">Incoming Proposals</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {incomingProposals.map(prop => (
                      <div key={prop.id} className="bg-white p-5 rounded-2xl shadow-sm border-2 border-emerald-100">
                        <div className="text-xs font-bold text-emerald-600 mb-2 uppercase tracking-widest">Swap Offer</div>
                        <div className="flex items-center justify-between gap-4 mb-4">
                          <div className="flex-1 text-center">
                            <div className="text-sm font-bold">{prop.my_code}</div>
                            <div className="text-[10px] text-gray-400">Your Flight</div>
                          </div>
                          <ArrowRightLeft size={16} className="text-emerald-400" />
                          <div className="flex-1 text-center">
                            <div className="text-sm font-bold">{prop.offered_code}</div>
                            <div className="text-[10px] text-gray-400">Their Offer</div>
                          </div>
                        </div>
                        <div className="space-y-1 text-xs mb-4 p-2 bg-gray-50 rounded-lg">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Route</span>
                            <span className="font-medium">{prop.offered_dep} → {prop.offered_arr}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Date</span>
                            <span className="font-medium">{format(parseISO(prop.offered_date), 'MMM d')}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleRespondToProposal(prop.id, 'accepted')}
                            className="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors"
                          >
                            Accept
                          </button>
                          <button 
                            onClick={() => handleRespondToProposal(prop.id, 'declined')}
                            className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Outgoing Proposals Section */}
              {outgoingProposals.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-500">Your Sent Proposals</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {outgoingProposals.map(prop => (
                      <div key={prop.id} className="bg-white p-4 rounded-2xl shadow-sm border border-black/5 opacity-80">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Proposal Status</span>
                          <span className={cn(
                            "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                            prop.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                            prop.status === 'accepted' ? "bg-emerald-100 text-emerald-700" :
                            "bg-red-100 text-red-700"
                          )}>
                            {prop.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="text-center flex-1">
                            <div className="font-bold">{prop.offered_code}</div>
                            <div className="text-[9px] text-gray-400">Offered</div>
                          </div>
                          <ArrowRightLeft size={12} className="text-gray-300" />
                          <div className="text-center flex-1">
                            <div className="font-bold">{prop.target_code}</div>
                            <div className="text-[9px] text-gray-400">Target</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-light">Available Listings</h2>
                  <div className="text-sm text-gray-500">Flights posted by other crew members</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {swaps.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
                      <ArrowRightLeft size={48} className="mx-auto mb-4 opacity-20" />
                      <p>No active swap requests. Post one from your calendar!</p>
                    </div>
                  ) : (
                    swaps.map(swap => (
                      <div key={swap.id} className="bg-white p-5 rounded-2xl shadow-sm border border-black/5 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                              <User size={16} className="text-gray-500" />
                            </div>
                            <div className="text-xs font-medium text-gray-500 truncate max-w-[120px]">
                              {swap.requester_email === loginId ? "You" : swap.requester_email}
                            </div>
                          </div>
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full uppercase tracking-wider">
                            {swap.flight_code}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between mb-4">
                          <div className="text-center">
                            <div className="text-xl font-bold">{swap.departure_city}</div>
                            <div className="text-[10px] text-gray-400 uppercase tracking-widest">Departure</div>
                          </div>
                          <Plane size={20} className="text-gray-200 rotate-90" />
                          <div className="text-center">
                            <div className="text-xl font-bold">{swap.arrival_city}</div>
                            <div className="text-[10px] text-gray-400 uppercase tracking-widest">Arrival</div>
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-black/5 pt-4">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Date</span>
                            <span className="font-medium">{format(parseISO(swap.date), 'MMM d, yyyy')}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Time</span>
                            <span className="font-medium">{swap.departure_time}</span>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            if (swap.requester_email === loginId) {
                              handleCancelSwap(swap.id!);
                            } else {
                              setSelectedListing(swap);
                              setIsProposingSwap(true);
                            }
                          }}
                          className={cn(
                            "w-full mt-6 py-2.5 rounded-xl text-sm font-semibold transition-all",
                            swap.requester_email === loginId 
                              ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                              : "bg-black text-white hover:bg-gray-800 active:scale-[0.98]"
                          )}
                        >
                          {swap.requester_email === loginId ? "Cancel Request" : "Propose Swap"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 text-center">
                <div className="relative inline-block mb-6">
                  <div className="w-32 h-32 bg-gray-100 rounded-full overflow-hidden border-4 border-white shadow-lg mx-auto">
                    {selectedImage ? (
                      <img src={selectedImage} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <User size={64} />
                      </div>
                    )}
                  </div>
                  <label className="absolute bottom-0 right-0 bg-emerald-600 text-white p-2 rounded-full cursor-pointer hover:bg-emerald-700 transition-colors shadow-md">
                    <ImageIcon size={20} />
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </label>
                </div>
                
                <h2 className="text-2xl font-bold mb-1">{loginId.split('@')[0]}</h2>
                <p className="text-gray-400 text-sm mb-6">{loginId}</p>
                
                <div className="grid grid-cols-3 gap-4 border-t border-black/5 pt-6">
                  <div>
                    <div className="text-xl font-bold">{flights.length}</div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-widest">Flights</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold">{swaps.filter(s => s.requester_email === loginId).length}</div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-widest">Swaps</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold">4.9</div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-widest">Rating</div>
                  </div>
                </div>
              </div>

              {/* Nano Banana Image Editor */}
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="text-emerald-600" size={24} />
                  <h3 className="text-lg font-semibold">AI Profile Enhancer</h3>
                </div>
                
                <p className="text-sm text-gray-500 mb-6">
                  Use AI to touch up your profile photo. Try "Make it professional", "Add a sunset background", or "Apply a vintage filter".
                </p>

                <div className="space-y-4">
                  <textarea 
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="Describe how you want to edit your photo..."
                    className="w-full p-4 bg-gray-50 border border-black/5 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none h-24"
                  />
                  <button 
                    onClick={handleEditImage}
                    disabled={!selectedImage || !editPrompt || isEditingImage}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    {isEditingImage ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Enhancing...
                      </>
                    ) : (
                      <>
                        <Sparkles size={20} />
                        Apply AI Magic
                      </>
                    )}
                  </button>
                </div>
              </div>

              <button 
                onClick={() => {
                  // Save to local drive (localStorage) when signing out
                  if (flights.length > 0) {
                    localStorage.setItem(`skycrew_local_drive_${loginId}`, JSON.stringify(flights));
                  }
                  
                  localStorage.removeItem('skycrew_login_id');
                  setLoginId('');
                  setFlights([]);
                  setSwaps([]);
                  setIncomingProposals([]);
                  setOutgoingProposals([]);
                }}
                className="w-full flex items-center justify-center gap-2 text-red-500 font-medium py-4 hover:bg-red-50 rounded-2xl transition-colors"
              >
                <LogOut size={20} />
                Sign Out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Propose Swap Modal */}
      <AnimatePresence>
        {isProposingSwap && selectedListing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProposingSwap(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between">
                <h3 className="text-xl font-semibold">Propose a Swap</h3>
                <button onClick={() => setIsProposingSwap(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-black/5">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Target Flight</div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{selectedListing.flight_code}</span>
                    <span className="text-xs text-gray-500">{selectedListing.departure_city} → {selectedListing.arrival_city}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Offer one of your flights</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {flights.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No flights in your schedule to offer.</p>
                    ) : (
                      flights.map(f => (
                        <button 
                          key={f.id}
                          onClick={() => setOfferedFlightId(f.id!)}
                          className={cn(
                            "w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between",
                            offeredFlightId === f.id 
                              ? "bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500/20" 
                              : "bg-white border-black/5 hover:border-emerald-200"
                          )}
                        >
                          <div>
                            <div className="text-sm font-bold">{f.flight_code}</div>
                            <div className="text-[10px] text-gray-500">{f.departure_city} → {f.arrival_city}</div>
                          </div>
                          <div className="text-[10px] font-medium text-gray-400">{format(parseISO(f.date), 'MMM d')}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-gray-50 flex gap-3">
                <button 
                  onClick={() => setIsProposingSwap(false)}
                  className="flex-1 py-3 rounded-2xl font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleProposeSwap}
                  disabled={!offeredFlightId}
                  className="flex-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98]"
                >
                  Send Proposal
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isAddingFlight && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingFlight(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between">
                <h3 className="text-xl font-semibold">Add New Flight</h3>
                <button onClick={() => setIsAddingFlight(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Flight Code</label>
                  <div className="relative">
                    <Plane className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                    <input 
                      type="text" 
                      value={flightCode}
                      onChange={(e) => setFlightCode(e.target.value)}
                      placeholder="e.g. AA123, BA456"
                      className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Select Date</label>
                  <div className="grid grid-cols-7 gap-1">
                    {/* Simple date picker for current month */}
                    {eachDayOfInterval({ start: monthStart, end: monthEnd }).map(day => (
                      <button 
                        key={day.toISOString()}
                        onClick={() => setSelectedDate(day)}
                        className={cn(
                          "h-10 rounded-lg text-xs font-medium transition-all",
                          selectedDate && isSameDay(day, selectedDate) 
                            ? "bg-emerald-600 text-white shadow-md scale-110" 
                            : "hover:bg-gray-100 text-gray-600"
                        )}
                      >
                        {format(day, 'd')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <strong>Tip:</strong> Just enter the code. Our AI will automatically fetch the route and schedule for you.
                  </p>
                </div>
              </div>

              <div className="p-6 bg-gray-50 flex gap-3">
                <button 
                  onClick={() => setIsAddingFlight(false)}
                  className="flex-1 py-3 rounded-2xl font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddFlight}
                  disabled={!flightCode || !selectedDate || isLoading}
                  className="flex-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98]"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Parsing...
                    </>
                  ) : (
                    <>
                      <Sparkles size={20} />
                      Add to Schedule
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
