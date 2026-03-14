import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Plane, 
  ArrowRightLeft, 
  ArrowUpDown,
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
  Search,
  CalendarCheck,
  CheckCircle2,
  Bell
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
import { parseFlight, scanSchedule, editImage } from './services/geminiService';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Flight, SwapRequest, SwapProposal } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const safeParseISO = (dateStr: string | null | undefined) => {
  if (!dateStr) return new Date();
  // Handle SQLite format YYYY-MM-DD HH:mm:ss by replacing space with T
  const isoStr = dateStr.includes(' ') && !dateStr.includes('T') 
    ? dateStr.replace(' ', 'T') 
    : dateStr;
  try {
    const parsed = parseISO(isoStr);
    if (!isNaN(parsed.getTime())) return parsed;
    
    // Fallback to native Date if parseISO fails
    const native = new Date(dateStr);
    if (!isNaN(native.getTime())) return native;
  } catch (e) {
    console.warn("Date parsing failed for:", dateStr, e);
  }
  return new Date();
};

const safeFormat = (date: Date | string | null | undefined, formatStr: string) => {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? safeParseISO(date) : date;
  try {
    return format(dateObj, formatStr);
  } catch (e) {
    console.warn("Date formatting failed", e);
    return '';
  }
};

const formatDateRange = (dateStr: string, returnDateStr?: string | null) => {
  if (!dateStr) return '';
  const date = safeParseISO(dateStr);
  if (!returnDateStr || returnDateStr === dateStr) {
    return safeFormat(date, 'MMM d').toUpperCase();
  }
  const returnDate = safeParseISO(returnDateStr);
  if (safeFormat(date, 'MMM') === safeFormat(returnDate, 'MMM')) {
    return `${safeFormat(date, 'MMM d')}-${safeFormat(returnDate, 'd')}`.toUpperCase();
  }
  return `${safeFormat(date, 'MMM d')}-${safeFormat(returnDate, 'MMM d')}`.toUpperCase();
};

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-10 text-center min-h-screen flex flex-col items-center justify-center bg-gray-50">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-red-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <X className="text-red-600" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-500 mb-6 text-sm">The application encountered an unexpected error.</p>
            <div className="bg-red-50 p-4 rounded-2xl text-left mb-6 overflow-auto max-h-40">
              <code className="text-[10px] text-red-700 break-all">
                {this.state.error?.toString()}
              </code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all active:scale-[0.98]"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  console.log("App component initializing...");
  const [loginId, setLoginId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('skycrew_login_id');
      return saved ? saved.trim() : '';
    } catch (e) {
      console.warn("LocalStorage access failed", e);
      return '';
    }
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [flights, setFlights] = useState<Flight[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [incomingProposals, setIncomingProposals] = useState<SwapProposal[]>([]);
  const [outgoingProposals, setOutgoingProposals] = useState<SwapProposal[]>([]);
  const [outgoingSortField, setOutgoingSortField] = useState<'status' | 'target_code' | 'target_date' | 'created_at'>('created_at');
  const [outgoingSortOrder, setOutgoingSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const sortedOutgoingProposals = useMemo(() => {
    return [...outgoingProposals].sort((a, b) => {
      let comparison = 0;
      if (outgoingSortField === 'status') {
        comparison = a.status.localeCompare(b.status);
      } else if (outgoingSortField === 'target_code') {
        comparison = (a.target_code || '').localeCompare(b.target_code || '');
      } else if (outgoingSortField === 'target_date') {
        comparison = (a.target_date || '').localeCompare(b.target_date || '');
      } else {
        comparison = a.created_at.localeCompare(b.created_at);
      }
      return outgoingSortOrder === 'asc' ? comparison : -comparison;
    });
  }, [outgoingProposals, outgoingSortField, outgoingSortOrder]);
  
  const [swapFilterDep, setSwapFilterDep] = useState('');
  const [swapFilterArr, setSwapFilterArr] = useState('');

  const filteredSwaps = useMemo(() => {
    return swaps.filter(swap => {
      const depMatch = !swapFilterDep || swap.departure_city.toLowerCase().includes(swapFilterDep.toLowerCase());
      const arrMatch = !swapFilterArr || swap.arrival_city.toLowerCase().includes(swapFilterArr.toLowerCase());
      return depMatch && arrMatch;
    });
  }, [swaps, swapFilterDep, swapFilterArr]);

  const [selectedFlightForDetails, setSelectedFlightForDetails] = useState<Flight | null>(null);
  const [isAddingFlight, setIsAddingFlight] = useState(false);
  const [isProposingSwap, setIsProposingSwap] = useState(false);
  const [selectedListing, setSelectedListing] = useState<SwapRequest | null>(null);
  const [offeredFlightId, setOfferedFlightId] = useState<number | null | undefined>(undefined);
  const [offeredReturnId, setOfferedReturnId] = useState<number | null>(null);
  const [flightCode, setFlightCode] = useState('');
  const [returnFlightCode, setReturnFlightCode] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [isSameDayReturn, setIsSameDayReturn] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'calendar' | 'swaps' | 'profile'>('calendar');
  const [isScanning, setIsScanning] = useState(false);
  const [annualLeaves, setAnnualLeaves] = useState<string[]>([]);
  const [availableCrew, setAvailableCrew] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Modals state
  const [flightToDelete, setFlightToDelete] = useState<number | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [candidatesModal, setCandidatesModal] = useState<{isOpen: boolean, date: string, flightCode: string, candidates: {email: string, is_al: boolean}[]}>({isOpen: false, date: '', flightCode: '', candidates: []});

  // Image Editing State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);

  const fetchProposals = async () => {
    if (!loginId) return;
    try {
      const [incoming, outgoing] = await Promise.all([
        fetch(`/api/proposals/incoming?email=${encodeURIComponent(loginId)}`).then(async r => {
          if (!r.ok) throw new Error(`Incoming proposals failed: ${r.status}`);
          const data = await r.json();
          return Array.isArray(data) ? data : [];
        }),
        fetch(`/api/proposals/outgoing?email=${encodeURIComponent(loginId)}`).then(async r => {
          if (!r.ok) throw new Error(`Outgoing proposals failed: ${r.status}`);
          const data = await r.json();
          return Array.isArray(data) ? data : [];
        })
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
      const res = await fetch(`/api/flights?email=${encodeURIComponent(loginId)}`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }
      const serverFlights = await res.json();
      if (Array.isArray(serverFlights)) {
        setFlights(serverFlights);
      } else {
        console.error("Flights data is not an array", serverFlights);
        setFlights([]);
      }
    } catch (err) {
      console.error("Failed to fetch flights", err);
      if (err instanceof Error) {
        setAlertMessage(`Failed to fetch flights: ${err.message}`);
      }
    }
  };

  const [debugInfo, setDebugInfo] = useState<any>(null);

  const fetchDebugInfo = async () => {
    try {
      const res = await fetch('/api/debug');
      if (!res.ok) {
        const text = await res.text();
        console.error(`Debug info fetch failed: ${res.status}`, text);
        return;
      }
      const data = await res.json();
      setDebugInfo(data);
    } catch (e: any) {
      console.error("Failed to fetch debug info", e.message || e);
    }
  };

  useEffect(() => {
    if (activeTab === 'profile') {
      fetchDebugInfo();
    }
  }, [activeTab]);

  const fetchSwaps = async () => {
    try {
      const [swapsRes, crewRes] = await Promise.all([
        fetch('/api/swaps').then(async r => {
          if (!r.ok) throw new Error(`Swaps fetch failed: ${r.status}`);
          const data = await r.json();
          return Array.isArray(data) ? data : [];
        }),
        fetch('/api/available-crew').then(async r => {
          if (!r.ok) throw new Error(`Crew fetch failed: ${r.status}`);
          const data = await r.json();
          return Array.isArray(data) ? data : [];
        })
      ]);
      setSwaps(swapsRes);
      setAvailableCrew(crewRes);
      fetchDebugInfo(); // Also refresh debug info
    } catch (err) {
      console.error("Failed to fetch swaps/crew", err);
    }
  };

  const fetchAnnualLeaves = async () => {
    if (!loginId) return;
    try {
      const res = await fetch(`/api/annual-leaves?email=${encodeURIComponent(loginId)}`);
      if (!res.ok) throw new Error(`Annual leaves fetch failed: ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAnnualLeaves(data);
      } else {
        setAnnualLeaves([]);
      }
    } catch (err) {
      console.error("Failed to fetch annual leaves", err);
    }
  };

  const fetchNotifications = async () => {
    if (!loginId) return;
    try {
      const res = await fetch(`/api/notifications?email=${encodeURIComponent(loginId)}`);
      if (!res.ok) {
        const text = await res.text();
        console.error(`Notifications fetch failed: ${res.status}`, text);
        return;
      }
      const data = await res.json();
      setNotifications(data);
    } catch (err: any) {
      console.error("Failed to fetch notifications", err.message || err);
    }
  };

  useEffect(() => {
    if (loginId) {
      fetchFlights();
      fetchSwaps();
      fetchProposals();
      fetchAnnualLeaves();
      fetchNotifications();
      
      // Poll for notifications every 30 seconds
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [loginId]);

  const handleToggleAL = async (date: string) => {
    if (!loginId) return;
    try {
      const res = await fetch('/api/annual-leaves/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginId, date })
      });
      if (res.ok) {
        fetchAnnualLeaves();
        fetchSwaps(); // Refresh available crew on board
      }
    } catch (err) {
      console.error("Failed to toggle AL", err);
    }
  };
  const handleFindCandidates = async (date: string, flightCode: string) => {
    if (!loginId) return;
    try {
      const res = await fetch(`/api/candidates?date=${date}&email=${encodeURIComponent(loginId)}`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }
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

      const extractedFlights: Flight[] = await scanSchedule(base64Data, file.type);
      
      if (extractedFlights.length === 0) {
        setAlertMessage("No flights detected in the image. Please try a clearer photo.");
        return;
      }

      let addedCount = 0;
      let duplicateCount = 0;
      const currentFlights = [...flights];

      // Use the currently viewed month in the calendar
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      // Save all extracted flights, mapping them to consecutive days
      for (let i = 0; i < extractedFlights.length; i++) {
        const flight = extractedFlights[i];
        
        // Don't exceed days in month
        if (i >= daysInMonth) break;
        
        // Skip empty flight codes
        if (!flight.flight_code || flight.flight_code.trim() === '') continue;

        const day = i + 1;
        const dateString = safeFormat(new Date(year, month, day), 'yyyy-MM-dd');

        const isDuplicate = currentFlights.some(f => f.date === dateString && f.flight_code.toUpperCase() === flight.flight_code.toUpperCase());
        
        if (!isDuplicate) {
          await fetch('/api/flights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...flight,
              date: dateString,
              user_email: loginId
            })
          });
          currentFlights.push({...flight, date: dateString});
          addedCount++;
        } else {
          duplicateCount++;
        }
      }

      await fetchFlights();
      setAlertMessage(`Successfully imported ${addedCount} flights. ${duplicateCount > 0 ? `Skipped ${duplicateCount} duplicates.` : ''}`);
    } catch (err: any) {
      console.error("Failed to scan schedule", err);
      if (err.message === "GEMINI_API_KEY_MISSING") {
        setAlertMessage("Gemini API Key is missing. Please set GEMINI_API_KEY in the project settings to enable schedule scanning.");
      } else {
        setAlertMessage("Failed to process the image. Please ensure it's a clear photo of a flight schedule.");
      }
    } finally {
      setIsScanning(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleAddFlight = async () => {
    if (!flightCode || !selectedDate) return;
    
    // Ensure there's a number in the flight code
    if (!/\d/.test(flightCode)) {
      setAlertMessage("Please enter a valid flight number (e.g. 100).");
      return;
    }
    
    const depDateStr = safeFormat(selectedDate, 'yyyy-MM-dd');
    const retDateStr = isSameDayReturn ? depDateStr : (returnDate ? safeFormat(returnDate, 'yyyy-MM-dd') : depDateStr);
    
    setIsLoading(true);
    try {
      const groupId = Date.now().toString();
      
      // 1. Add departing flight
      let depDetails: any = {};
      let parseFailed = false;
      try {
        depDetails = await parseFlight(flightCode, depDateStr);
        if (!depDetails.departure_city || depDetails.departure_city === 'Unknown') {
          parseFailed = true;
        }
      } catch (err) {
        console.warn("Failed to parse departing flight", err);
        parseFailed = true;
      }

      const depFlight: Flight = {
        user_email: loginId,
        flight_code: flightCode.toUpperCase(),
        date: depDateStr,
        group_id: groupId,
        departure_city: depDetails.departure_city || 'Unknown',
        arrival_city: depDetails.arrival_city || 'Unknown',
        departure_time: depDetails.departure_time || '00:00',
        arrival_time: depDetails.arrival_time || '00:00',
        ...depDetails
      };

      await fetch('/api/flights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(depFlight)
      });

      if (parseFailed) {
        setAlertMessage("Flight added, but we couldn't fetch the route details automatically. You can edit them in the flight details.");
      }

      // 2. Add return flight if provided
      if (returnFlightCode) {
        let retDetails: any = {};
        try {
          retDetails = await parseFlight(returnFlightCode, retDateStr);
        } catch (err) {
          console.warn("Failed to parse return flight", err);
        }

        const retFlight: Flight = {
          user_email: loginId,
          flight_code: returnFlightCode.toUpperCase(),
          date: retDateStr,
          group_id: groupId,
          departure_city: retDetails.departure_city || 'Unknown',
          arrival_city: retDetails.arrival_city || 'Unknown',
          departure_time: retDetails.departure_time || '00:00',
          arrival_time: retDetails.arrival_time || '00:00',
          ...retDetails
        };

        await fetch('/api/flights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retFlight)
        });
      }

      // 3. Handle blocking days (Duty)
      if (!isSameDayReturn && returnDate && selectedDate) {
        let current = addDays(selectedDate, 1);
        const actualReturnDate = returnDate;
        while (safeFormat(current, 'yyyy-MM-dd') < safeFormat(actualReturnDate, 'yyyy-MM-dd')) {
          const dutyDateStr = safeFormat(current, 'yyyy-MM-dd');
          const dutyEntry: Flight = {
            user_email: loginId,
            flight_code: 'ON DUTY',
            date: dutyDateStr,
            group_id: groupId,
            departure_city: 'N/A',
            arrival_city: 'N/A',
            departure_time: '00:00',
            arrival_time: '23:59',
            is_duty: true
          };
          await fetch('/api/flights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dutyEntry)
          });
          current = addDays(current, 1);
        }
      }

      await fetchFlights();
      setIsAddingFlight(false);
      setFlightCode('');
      setReturnFlightCode('');
      setSelectedDate(null);
      setReturnDate(null);
      setIsSameDayReturn(true);
    } catch (err: any) {
      console.error("Failed to add flight", err);
      setAlertMessage("Failed to add flight. Please check your connection.");
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
    
    const exportFileDefaultName = `skycrew_schedule_${loginId}_${safeFormat(new Date(), 'yyyyMMdd')}.json`;
    
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
    if (!loginId) {
      setAlertMessage("You must be logged in to post a swap.");
      return;
    }
    console.log("Attempting to post swap for flightId:", flightId);
    try {
      const mainFlight = flights.find(f => f.id === flightId);
      if (!mainFlight) {
        throw new Error("Flight not found in your schedule.");
      }

      const isListed = swaps.some(s => 
        (s.flight_id === mainFlight.id) || 
        (mainFlight.group_id && s.group_id === mainFlight.group_id)
      );
      if (isListed) {
        throw new Error("This flight is already listed on the swap board.");
      }

      let returnId = null;
      const returnLeg = flights.find(f => 
        f.id !== flightId && 
        f.departure_city === mainFlight.arrival_city &&
        (f.date === mainFlight.date || safeParseISO(f.date) > safeParseISO(mainFlight.date))
      );
      if (returnLeg) returnId = returnLeg.id;

      let payload: any = { requester_email: loginId };
      
      if (mainFlight.group_id) {
        payload.group_id = mainFlight.group_id;
      } else {
        payload.flight_id = flightId;
        payload.return_flight_id = returnId;
      }

      console.log("Posting swap with payload:", payload);
      const res = await fetch('/api/swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to post swap request.");
      }
      
      setAlertMessage("Swap request posted to the board!");
      fetchSwaps();
    } catch (err: any) {
      console.error("Detailed error in handlePostSwap:", err);
      // If it's a DOMException or similar, provide a cleaner message
      const errorMessage = err.name === 'DataError' || err.message.includes('pattern') 
        ? "There was a technical issue with the request format. Please try again or refresh the page."
        : err.message;
      setAlertMessage(errorMessage);
    }
  };

  const handleCancelSwap = async (swapId: number) => {
    try {
      const res = await fetch(`/api/swaps/${swapId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to cancel swap");
      setAlertMessage("Swap request cancelled.");
      fetchSwaps();
    } catch (err: any) {
      console.error("Failed to cancel swap", err);
      setAlertMessage(err.message);
    }
  };

  const handleProposeSwap = async () => {
    if (!selectedListing) return;
    try {
      await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: selectedListing.id,
          proposer_email: loginId,
          proposer_flight_id: offeredFlightId,
          proposer_flight_id_return: offeredReturnId
        })
      });
      setAlertMessage("Proposal sent!");
      setIsProposingSwap(false);
      setSelectedListing(null);
      setOfferedFlightId(null);
      setOfferedReturnId(null);
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
      const base64Data = selectedImage.split(',')[1];
      const editedImage = await editImage(base64Data, editPrompt);

      if (editedImage) {
        setSelectedImage(editedImage);
        setEditPrompt('');
      } else {
        throw new Error("Failed to edit image");
      }
    } catch (err: any) {
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
                  const res = await fetch(`/api/flights?email=${encodeURIComponent(email)}`);
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
    <ErrorBoundary>
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
                These crew members do not have a flight scheduled on <strong>{safeFormat(candidatesModal.date, 'MMM d, yyyy')}</strong>. You can contact them to swap your flight <strong>{candidatesModal.flightCode}</strong>.
              </p>

              <div className="max-h-60 overflow-y-auto space-y-2">
                {candidatesModal.candidates.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No available candidates found for this date.
                  </div>
                ) : (
                  candidatesModal.candidates.map(candidate => (
                    <div key={candidate.email} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                          candidate.is_al ? "bg-emerald-100 text-emerald-600" : "bg-gray-200 text-gray-500"
                        )}>
                          {candidate.email.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-bold flex items-center gap-1">
                            {candidate.email}
                            {candidate.is_al && <CalendarCheck size={10} className="text-emerald-600" />}
                          </div>
                          {candidate.is_al && <div className="text-[9px] text-emerald-600 font-medium uppercase tracking-wider">On Annual Leave</div>}
                        </div>
                      </div>
                      <button 
                        disabled={isSendingNotification === candidate.email}
                        onClick={async () => {
                          setIsSendingNotification(candidate.email);
                          try {
                            await fetch('/api/notifications', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                recipient_email: candidate.email,
                                sender_email: loginId,
                                message: `I'm interested in swapping my flight ${candidatesModal.flightCode} on ${safeFormat(candidatesModal.date, 'MMM d')} with you.`,
                                type: 'swap_interest'
                              })
                            });
                            setAlertMessage(`Request sent to ${candidate.email}!`);
                          } catch (err) {
                            console.error("Failed to send notification", err);
                          } finally {
                            setIsSendingNotification(null);
                          }
                        }}
                        className="text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {isSendingNotification === candidate.email ? 'Sending...' : 'Request Swap'}
                      </button>
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

        {showNotifications && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white p-6 rounded-2xl max-w-md w-full shadow-xl max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Notifications</h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={async () => {
                      await fetch('/api/notifications/read-all', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: loginId })
                      });
                      fetchNotifications();
                    }}
                    className="text-xs text-emerald-600 font-medium hover:underline"
                  >
                    Mark all as read
                  </button>
                  <button onClick={() => setShowNotifications(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                {notifications.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Bell size={40} className="mx-auto mb-3 opacity-20" />
                    <p>No notifications yet</p>
                  </div>
                ) : (
                  notifications.map(notif => (
                    <div 
                      key={notif.id} 
                      className={cn(
                        "p-4 rounded-xl border transition-colors",
                        notif.is_read ? "bg-white border-gray-100" : "bg-emerald-50/50 border-emerald-100"
                      )}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <div className="text-xs font-bold text-gray-900">{notif.sender_email}</div>
                        <div className="text-[10px] text-gray-400">{safeFormat(notif.created_at, 'MMM d, HH:mm')}</div>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{notif.message}</p>
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={async () => {
                            await fetch(`/api/notifications/${notif.id}`, { method: 'DELETE' });
                            fetchNotifications();
                          }}
                          className="px-3 py-1.5 text-[10px] font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          Dismiss
                        </button>
                        <button 
                          onClick={() => {
                            // Pre-fill email in profile or something?
                            // For now just dismiss and maybe show alert
                            setShowNotifications(false);
                            setAlertMessage(`You can contact ${notif.sender_email} to discuss the swap.`);
                          }}
                          className="px-3 py-1.5 text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors"
                        >
                          View Profile
                        </button>
                      </div>
                    </div>
                  ))
                )}
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
            onClick={() => setShowNotifications(true)}
            className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <Bell size={20} />
            {notifications.some(n => !n.is_read) && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            )}
          </button>
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
                  <h2 className="text-2xl font-light">{safeFormat(currentDate, 'MMMM yyyy')}</h2>
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
                      "relative bg-white hover:bg-gray-50 text-emerald-600 border border-emerald-200 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 cursor-pointer",
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
                    const dateStr = safeFormat(day, 'yyyy-MM-dd');
                    const dayFlights = flightsByDate[dateStr] || [];
                    const isCurrentMonth = isSameMonth(day, monthStart);
                    const isAL = annualLeaves.includes(dateStr);
                    
                    return (
                      <div 
                        key={i} 
                        onClick={() => {
                          setSelectedDate(day);
                          setIsAddingFlight(true);
                        }}
                        className={cn(
                          "min-h-[140px] p-2 border-r border-b border-black/5 last:border-r-0 relative group cursor-pointer hover:bg-gray-50/80 transition-colors",
                          !isCurrentMonth && "bg-gray-50/50",
                          isAL && "bg-emerald-50/30"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={cn(
                            "text-sm font-medium",
                            !isCurrentMonth ? "text-gray-300" : "text-gray-500",
                            isSameDay(day, new Date()) && "bg-emerald-600 text-white w-6 h-6 flex items-center justify-center rounded-full"
                          )}>
                            {safeFormat(day, 'd')}
                          </span>
                          {dayFlights.length === 0 && isCurrentMonth && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleAL(dateStr);
                              }}
                              className={cn(
                                "p-1.5 rounded-lg transition-all border shadow-sm",
                                isAL 
                                  ? "text-blue-600 bg-blue-50 border-blue-300" 
                                  : "text-slate-500 bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                              )}
                              title={isAL ? "On Annual Leave" : "Mark as Annual Leave"}
                            >
                              {isAL ? <CalendarCheck size={16} /> : <CheckCircle2 size={16} />}
                            </button>
                          )}
                        </div>
                        
                        <div className="space-y-1">
                          {isAL && dayFlights.length === 0 && (
                            <div className="bg-blue-100/50 border border-blue-200 text-blue-700 p-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                              <CalendarCheck size={10} />
                              Annual Leave
                            </div>
                          )}
                          {dayFlights.map(f => {
                            const isListed = swaps.some(s => 
                              (s.flight_id === f.id) || 
                              (f.group_id && s.group_id === f.group_id)
                            );

                            if (f.is_duty || f.flight_code === 'ON DUTY') {
                              return (
                                <div 
                                  key={f.id}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-gray-100 border border-gray-200 text-gray-400 p-2 rounded-lg text-[10px] flex items-center justify-between group/duty"
                                >
                                  <span className="font-bold tracking-widest uppercase opacity-60">On Duty</span>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteFlight(f.id!); }}
                                    className="opacity-0 group-hover/duty:opacity-100 text-gray-400 hover:text-red-600 transition-all"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              );
                            }

                            return (
                            <div 
                              key={f.id} 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFlightForDetails(f);
                              }}
                              className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-1.5 rounded-lg text-[10px] flex flex-col gap-0.5 group/flight relative cursor-pointer hover:bg-emerald-100 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold">{f.flight_code}</span>
                                <div className="flex items-center gap-1.5">
                                  <button 
                                    onClick={() => !isListed && handlePostSwap(f.id!)}
                                    disabled={isListed}
                                    className={cn(
                                      "flex items-center gap-0.5 transition-colors",
                                      isListed ? "text-emerald-600" : "text-gray-400 hover:text-emerald-600"
                                    )}
                                    title={isListed ? "Already posted" : "Post to Swap Board"}
                                  >
                                    <ArrowRightLeft size={10} />
                                    <span className="text-[8px] font-medium">{isListed ? "Listed" : "Swap"}</span>
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteFlight(f.id!)}
                                    className="text-gray-400 hover:text-red-600 transition-colors"
                                    title="Remove flight"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
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
                            {prop.my_ret_code && <div className="text-[10px] text-blue-600 font-bold">{prop.my_ret_code}</div>}
                            <div className="text-[10px] text-gray-400">Your Flight</div>
                          </div>
                          <ArrowRightLeft size={16} className="text-emerald-400" />
                          <div className="flex-1 text-center">
                            <div className="text-sm font-bold">{prop.offered_code}</div>
                            {prop.offered_ret_code && <div className="text-[10px] text-blue-600 font-bold">{prop.offered_ret_code}</div>}
                            <div className="text-[10px] text-gray-400">Their Offer</div>
                          </div>
                        </div>
                        <div className="space-y-1 text-xs mb-4 p-2 bg-gray-50 rounded-lg">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Your Flight</span>
                            <span className="font-medium">{formatDateRange(prop.my_date!, prop.my_ret_date)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Their Offer</span>
                            <span className="font-medium">{formatDateRange(prop.offered_date, prop.offered_ret_date)}</span>
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-500">Your Sent Proposals</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-gray-100 p-1 rounded-xl">
                        <button 
                          onClick={() => {
                            if (outgoingSortField === 'status') {
                              setOutgoingSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setOutgoingSortField('status');
                              setOutgoingSortOrder('asc');
                            }
                          }}
                          className={cn(
                            "px-3 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1",
                            outgoingSortField === 'status' ? "bg-white shadow-sm text-emerald-600" : "text-gray-400 hover:text-gray-600"
                          )}
                        >
                          Status {outgoingSortField === 'status' && <ArrowUpDown size={10} />}
                        </button>
                        <button 
                          onClick={() => {
                            if (outgoingSortField === 'target_code') {
                              setOutgoingSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setOutgoingSortField('target_code');
                              setOutgoingSortOrder('asc');
                            }
                          }}
                          className={cn(
                            "px-3 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1",
                            outgoingSortField === 'target_code' ? "bg-white shadow-sm text-emerald-600" : "text-gray-400 hover:text-gray-600"
                          )}
                        >
                          Target {outgoingSortField === 'target_code' && <ArrowUpDown size={10} />}
                        </button>
                        <button 
                          onClick={() => {
                            if (outgoingSortField === 'target_date') {
                              setOutgoingSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setOutgoingSortField('target_date');
                              setOutgoingSortOrder('asc');
                            }
                          }}
                          className={cn(
                            "px-3 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1",
                            outgoingSortField === 'target_date' ? "bg-white shadow-sm text-emerald-600" : "text-gray-400 hover:text-gray-600"
                          )}
                        >
                          Date {outgoingSortField === 'target_date' && <ArrowUpDown size={10} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sortedOutgoingProposals.map(prop => (
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
                            {prop.offered_ret_code && <div className="text-[10px] text-blue-600 font-bold">{prop.offered_ret_code}</div>}
                            <div className="text-[9px] text-gray-400">Offered</div>
                          </div>
                          <ArrowRightLeft size={12} className="text-gray-300" />
                          <div className="text-center flex-1">
                            <div className="font-bold">{prop.target_code}</div>
                            {prop.target_ret_code && <div className="text-[10px] text-blue-600 font-bold">{prop.target_ret_code}</div>}
                            <div className="text-[9px] text-gray-400">Target</div>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-black/5 flex justify-between items-center text-[9px]">
                          <div className="text-gray-400">Offered: <span className="text-gray-600 font-medium">{formatDateRange(prop.offered_date, prop.offered_ret_date)}</span></div>
                          <div className="text-gray-400">Target: <span className="text-gray-600 font-medium">{formatDateRange(prop.target_date!, prop.target_ret_date)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Available Crew Section */}
              {availableCrew.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-600">
                    <User size={20} />
                    <h3 className="text-lg font-semibold">Crew Available for Swaps</h3>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                    {availableCrew.map((crew, idx) => (
                      <div key={idx} className="flex-shrink-0 bg-white p-4 rounded-2xl shadow-sm border border-blue-100 w-64">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs">
                            {crew.user_email.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-gray-900 truncate w-32">{crew.user_email}</div>
                            <div className="text-[10px] text-blue-600 font-medium">On Annual Leave</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">Available</span>
                          <span className="font-bold">
                            {crew.startDate === crew.endDate 
                              ? safeFormat(crew.startDate, 'MMM d, yyyy')
                              : `${safeFormat(crew.startDate, 'MMM d')} - ${safeFormat(crew.endDate, 'MMM d, yyyy')}`
                            }
                          </span>
                        </div>
                        <button 
                          disabled={isSendingNotification === crew.user_email}
                          onClick={async () => {
                            const dateRange = crew.startDate === crew.endDate 
                              ? safeFormat(crew.startDate, 'MMM d')
                              : `${safeFormat(crew.startDate, 'MMM d')} - ${safeFormat(crew.endDate, 'MMM d')}`;
                            
                            setIsSendingNotification(crew.user_email);
                            try {
                              await fetch('/api/notifications', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  recipient_email: crew.user_email,
                                  sender_email: loginId,
                                  message: `I'm interested in swapping flights with you for ${dateRange}.`,
                                  type: 'swap_interest'
                                })
                              });
                              setAlertMessage(`Request sent to ${crew.user_email}! They will see it in their notifications.`);
                            } catch (err) {
                              console.error("Failed to send notification", err);
                            } finally {
                              setIsSendingNotification(null);
                            }
                          }}
                          className="w-full mt-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isSendingNotification === crew.user_email ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              Sending...
                            </>
                          ) : (
                            'Send Interest Request'
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-light">Available Listings</h2>
                    <div className="text-sm text-gray-500">Flights posted by other crew members</div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Filter Departure..." 
                        value={swapFilterDep}
                        onChange={(e) => setSwapFilterDep(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-white border border-black/5 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 w-40"
                      />
                    </div>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Filter Arrival..." 
                        value={swapFilterArr}
                        onChange={(e) => setSwapFilterArr(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-white border border-black/5 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 w-40"
                      />
                    </div>
                    {(swapFilterDep || swapFilterArr) && (
                      <button 
                        onClick={() => {
                          setSwapFilterDep('');
                          setSwapFilterArr('');
                        }}
                        className="px-3 py-2 text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredSwaps.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
                      <ArrowRightLeft size={48} className="mx-auto mb-4 opacity-20" />
                      <p>{swaps.length === 0 ? "No active swap requests. Post one from your calendar!" : "No listings match your filters."}</p>
                    </div>
                  ) : (
                    filteredSwaps.map(swap => (
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
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full uppercase tracking-wider">
                              {swap.flight_code}
                            </span>
                            {swap.return_code && (
                              <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                {swap.return_code}
                              </span>
                            )}
                            {swap.group_id && !swap.return_code && (
                              <span className="text-[8px] text-gray-400 italic">Grouped Trip</span>
                            )}
                          </div>
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
                            <span className="font-medium">{formatDateRange(swap.date, swap.return_date)}</span>
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
                              setOfferedFlightId(undefined);
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

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4">System Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">AI Engine (Gemini 3.1 Pro)</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                      process.env.GEMINI_API_KEY ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    )}>
                      {process.env.GEMINI_API_KEY ? "Ready" : "Missing API Key"}
                    </span>
                  </div>
                  {!process.env.GEMINI_API_KEY && (
                    <p className="text-[10px] text-red-500 italic">
                      Please configure your GEMINI_API_KEY in the AI Studio Secrets panel and re-share the app.
                    </p>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Database Connection</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700">
                      Connected
                    </span>
                  </div>
                </div>
                
                <div className="mt-6 pt-6 border-t border-black/5 space-y-3">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-400">
                    <span>Data Stats</span>
                    <button onClick={fetchSwaps} className="text-emerald-600 hover:underline">Refresh</button>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Active Swaps on Board</span>
                    <span className="font-bold">{swaps.length} {debugInfo && `(Raw: ${debugInfo.swaps})`}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Available Crew (Off)</span>
                    <span className="font-bold">{availableCrew.length} {debugInfo && `(Raw: ${debugInfo.crew})`}</span>
                  </div>
                  {debugInfo && (
                    <div className="text-[8px] text-gray-300 mt-2">
                      Server Time: {debugInfo.time} | DB Time: {debugInfo.sqlite_time?.now}
                    </div>
                  )}
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
                    <span className="text-xs font-medium text-emerald-600">{formatDateRange(selectedListing.date, selectedListing.return_date)}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{selectedListing.departure_city} → {selectedListing.arrival_city}</div>
                  {selectedListing.return_code && (
                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-black/5">
                      <span className="font-bold">{selectedListing.return_code}</span>
                      <span className="text-xs text-gray-500">{selectedListing.return_dep} → {selectedListing.return_arr}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Offer your flights</label>
                  <div className="space-y-4">
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                      <button 
                        onClick={() => {
                          setOfferedFlightId(null);
                          setOfferedReturnId(null);
                        }}
                        className={cn(
                          "w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between",
                          offeredFlightId === null
                            ? "bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500/20"
                            : "bg-white border-black/5 hover:border-emerald-200"
                        )}
                      >
                        <div className="text-sm font-bold">Day Off</div>
                      </button>
                      {flights.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">No flights in your schedule to offer.</p>
                      ) : (
                        flights.map(f => (
                          <button 
                            key={f.id}
                            onClick={() => {
                              setOfferedFlightId(f.id!);
                              // Auto-find return leg
                              const returnLeg = flights.find(rl => 
                                rl.id !== f.id && 
                                rl.departure_city === f.arrival_city &&
                                (rl.date === f.date || safeParseISO(rl.date) > safeParseISO(f.date))
                              );
                              setOfferedReturnId(returnLeg ? returnLeg.id! : null);
                            }}
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
                            <div className="text-[10px] font-medium text-gray-400">
                              {f.group_id ? (
                                (() => {
                                  const group = flights.filter(gf => gf.group_id === f.group_id).sort((a, b) => a.date.localeCompare(b.date));
                                  if (group.length > 1) {
                                    return formatDateRange(group[0].date, group[group.length - 1].date);
                                  }
                                  return formatDateRange(f.date);
                                })()
                              ) : formatDateRange(f.date)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>

                    {offeredFlightId && (
                      <div className="pt-4 border-t border-black/5">
                        <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Return Leg (Optional)</label>
                        <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
                          <button 
                            onClick={() => setOfferedReturnId(null)}
                            className={cn(
                              "w-full p-2 rounded-lg border text-left transition-all text-xs",
                              offeredReturnId === null ? "bg-emerald-50 border-emerald-600" : "bg-white border-black/5"
                            )}
                          >
                            No return leg
                          </button>
                          {flights.filter(f => f.id !== offeredFlightId).map(f => (
                            <button 
                              key={f.id}
                              onClick={() => setOfferedReturnId(f.id!)}
                              className={cn(
                                "w-full p-2 rounded-lg border text-left transition-all flex items-center justify-between",
                                offeredReturnId === f.id ? "bg-emerald-50 border-emerald-600" : "bg-white border-black/5"
                              )}
                            >
                              <div className="text-xs font-bold">{f.flight_code} ({f.departure_city} → {f.arrival_city})</div>
                              <div className="text-[10px] text-gray-400">{formatDateRange(f.date)}</div>
                            </button>
                          ))}
                        </div>
                      </div>
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
                  disabled={offeredFlightId === undefined}
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
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between sticky top-0 bg-white z-10">
                <h3 className="text-xl font-semibold">Add Flight Pair</h3>
                <button onClick={() => setIsAddingFlight(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-8">
                {/* Departing Flight */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <Plane size={18} />
                    <span className="text-sm font-bold uppercase tracking-widest">Departing Flight</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Flight Code</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold pointer-events-none">CI</span>
                        <input 
                          type="text" 
                          value={flightCode.startsWith('CI') ? flightCode.slice(2) : flightCode}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setFlightCode(val ? 'CI' + val : '');
                          }}
                          placeholder="100"
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Departure Date</label>
                      <input 
                        type="date" 
                        value={safeFormat(selectedDate, 'yyyy-MM-dd')}
                        onChange={(e) => setSelectedDate(e.target.value ? safeParseISO(e.target.value) : null)}
                        className="w-full px-4 py-3 bg-gray-50 border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="h-[1px] bg-gray-100" />

                {/* Return Flight */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-600">
                      <Plane size={18} className="rotate-180" />
                      <span className="text-sm font-bold uppercase tracking-widest">Return Flight</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={isSameDayReturn}
                        onChange={(e) => setIsSameDayReturn(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-xs font-medium text-gray-500 group-hover:text-gray-700">Same day return</span>
                    </label>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Flight Code</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold pointer-events-none">CI</span>
                        <input 
                          type="text" 
                          value={returnFlightCode.startsWith('CI') ? returnFlightCode.slice(2) : returnFlightCode}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setReturnFlightCode(val ? 'CI' + val : '');
                          }}
                          placeholder="101"
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        />
                      </div>
                    </div>
                    {!isSameDayReturn && (
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Return Date</label>
                        <input 
                          type="date" 
                          value={safeFormat(returnDate, 'yyyy-MM-dd')}
                          onChange={(e) => setReturnDate(e.target.value ? safeParseISO(e.target.value) : null)}
                          className="w-full px-4 py-3 bg-gray-50 border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <strong>Note:</strong> Days between departure and return will be automatically blocked as "ON DUTY".
                  </p>
                </div>
              </div>

              <div className="p-6 bg-gray-50 flex gap-3 sticky bottom-0 border-t border-black/5">
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
                      Adding...
                    </>
                  ) : (
                    <>
                      <Sparkles size={20} />
                      Add Flights
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedFlightForDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFlightForDetails(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">{selectedFlightForDetails.flight_code}</h2>
                    <p className="text-sm text-gray-500">{safeFormat(selectedFlightForDetails.date, 'EEEE, MMMM do')}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedFlightForDetails(null)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="text-center flex-1">
                      <div className="text-3xl font-bold mb-1">{selectedFlightForDetails.departure_city}</div>
                      <div className="text-sm text-gray-400 font-medium">{selectedFlightForDetails.departure_time}</div>
                    </div>
                    <div className="px-4 flex flex-col items-center">
                      <div className="w-12 h-[1px] bg-gray-200 relative">
                        <Plane className="w-4 h-4 text-emerald-500 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-1" />
                      </div>
                    </div>
                    <div className="text-center flex-1">
                      <div className="text-3xl font-bold mb-1">{selectedFlightForDetails.arrival_city}</div>
                      <div className="text-sm text-gray-400 font-medium">{selectedFlightForDetails.arrival_time}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-4 rounded-2xl">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Pilot</div>
                      <div className="font-bold text-gray-900">{selectedFlightForDetails.pilot || "Not assigned"}</div>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-2xl">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Aircraft</div>
                      <div className="font-bold text-gray-900">{selectedFlightForDetails.aircraft || "Unknown"}</div>
                    </div>
                  </div>

                  {selectedFlightForDetails.layover && (
                    <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                      <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Layover Details</div>
                      <div className="text-sm font-medium text-emerald-900 leading-relaxed">
                        {selectedFlightForDetails.layover}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    {(() => {
                      const isListed = swaps.some(s => 
                        (s.flight_id === selectedFlightForDetails.id) || 
                        (selectedFlightForDetails.group_id && s.group_id === selectedFlightForDetails.group_id)
                      );
                      return (
                        <button 
                          onClick={() => {
                            if (!isListed) {
                              handlePostSwap(selectedFlightForDetails.id!);
                              setSelectedFlightForDetails(null);
                            }
                          }}
                          disabled={isListed}
                          className={cn(
                            "flex-1 py-4 rounded-2xl font-bold transition-all active:scale-[0.98]",
                            isListed ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-black text-white hover:bg-gray-800"
                          )}
                        >
                          {isListed ? "Already Listed" : "List for Swap"}
                        </button>
                      );
                    })()}
                    <button 
                      onClick={() => {
                        setFlightToDelete(selectedFlightForDetails.id!);
                        setSelectedFlightForDetails(null);
                      }}
                      className="p-4 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100 transition-all active:scale-[0.98]"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </ErrorBoundary>
  );
}
