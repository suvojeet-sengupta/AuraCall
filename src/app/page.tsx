'use client';

import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import {
  Video,
  Keyboard,
  Link2,
  ShieldCheck,
  Zap,
  ChevronLeft,
  ChevronRight,
  Settings,
  Mic,
  MicOff,
  VideoOff,
  Sparkles,
  Ban,
  EyeOff,
  Palette,
  History,
  Sun,
  RefreshCw,
  Activity,
  X,
  Sliders,
  Volume2,
  Wifi,
  WifiOff,
  ZapOff,
  Copy,
  Hand,
  Smile,
  MessageSquare,
  PhoneOff,
  Send,
  ShieldAlert
} from 'lucide-react';

// Quality presets configuration matching original app constraints
const PRESET_CONSTRAINTS: Record<string, any> = {
  low: {
    video: {
      width: { ideal: 320, max: 480 },
      height: { ideal: 240, max: 360 },
      frameRate: { ideal: 15, max: 20 }
    },
    audio: { echoCancellation: true, noiseSuppression: true }
  },
  medium: {
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 24 }
    },
    audio: { echoCancellation: true, noiseSuppression: true }
  },
  high: {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    },
    audio: { echoCancellation: true, noiseSuppression: true }
  },
  'audio-only': {
    video: false,
    audio: { echoCancellation: true, noiseSuppression: true }
  }
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

interface Peer {
  socketId: string;
  username: string;
  stream: MediaStream | null;
  mediaState: { audio: boolean; video: boolean; screen: boolean };
  isRaised: boolean;
  filter: string;
  captionText?: string;
  stats?: {
    resolution?: string;
    fps?: number | null;
    rtt?: number | null;
    packetLoss?: string | null;
    bitrate?: number;
    remoteIp?: string;
  };
}

interface ChatMessage {
  socketId: string;
  username: string;
  text: string;
  timestamp: string;
}

export default function Page() {
  const [step, setStep] = useState<'home' | 'lobby' | 'call'>('home');
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [preset, setPreset] = useState<'low' | 'medium' | 'high' | 'audio-only'>('low');

  // Input bindings
  const [homeInput, setHomeInput] = useState('');
  
  // Settings & Toggles
  const [isMuted, setIsMuted] = useState(true);
  const [isCamOff, setIsCamOff] = useState(true);
  const [currentFilter, setCurrentFilter] = useState('none');
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isCaptionsOn, setIsCaptionsOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Lists
  const [peersList, setPeersList] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(false);
  const [chatInput, setChatInput] = useState('');

  // Device selectors
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({ mics: [], cams: [] });
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCam, setSelectedCam] = useState('');

  // Modals & Banner
  const [secureContextWarning, setSecureContextWarning] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);
  const [localLobbyVolume, setLocalLobbyVolume] = useState(0);

  // Carousel
  const [activeSlide, setActiveSlide] = useState(0);

  // References to keep persistent WebRTC instances alive across state updates
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, { pc: RTCPeerConnection; statsInterval?: any; iceQueue: any[] }>>({});
  const micAnalyserIntervalRef = useRef<any>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Video Ref bindings
  const localPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const localCallVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // -------------------------------------------------------------
  // TOAST HANDLER
  // -------------------------------------------------------------
  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // -------------------------------------------------------------
  // INITIALIZATION AND ROUTING CHECK
  // -------------------------------------------------------------
  useEffect(() => {
    // Check for Secure Context
    if (typeof window !== 'undefined') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setSecureContextWarning(true);
        showToast("HTTPS is required for Camera/Mic access.", true);
      }

      // Read initial path for instant SPA joins
      const path = window.location.pathname.replace(/^\/room\//, '/').replace(/^\//, '');
      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      const targetRoom = roomParam || path;

      if (targetRoom && targetRoom.trim()) {
        const cleanRoom = targetRoom.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        setRoomId(cleanRoom);
        setStep('lobby');
      }

      // Enumerate hardware devices
      navigator.mediaDevices.enumerateDevices().then(deviceInfos => {
        const mics = deviceInfos.filter(d => d.kind === 'audioinput');
        const cams = deviceInfos.filter(d => d.kind === 'videoinput');
        setDevices({ mics, cams });
        if (mics.length > 0) setSelectedMic(mics[0].deviceId);
        if (cams.length > 0) setSelectedCam(cams[0].deviceId);
      }).catch(err => {
        console.warn("Could not query devices:", err);
      });
    }

    // Auto rotate home carousel slides
    const interval = setInterval(() => {
      setActiveSlide(prev => (prev + 1) % 3);
    }, 4500);

    return () => {
      clearInterval(interval);
      stopLobbyMicMeter();
      stopSpeechRecognition();
      cleanupAllWebRTC();
    };
  }, []);

  // Update HTML Document title on room switch
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (step === 'call' && roomId) {
        document.title = `AuraCall | Room: ${roomId}`;
      } else {
        document.title = "AuraCall - Google Meet Style Calling";
      }
    }
  }, [step, roomId]);

  // Bind local preview stream when transitioning to lobby screen
  useEffect(() => {
    if (step === 'lobby') {
      startLobbyPreviewStream();
      startLobbyMicMeter();
    } else {
      stopLobbyMicMeter();
    }
  }, [step, selectedMic, selectedCam, isMuted, isCamOff, preset]);

  // Bind local stream to call screen local video element
  useEffect(() => {
    if (step === 'call' && localCallVideoRef.current && localStreamRef.current) {
      localCallVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [step, peersList]);

  // -------------------------------------------------------------
  // HOME SCREEN LOGIC
  // -------------------------------------------------------------
  const handleCreateMeetingLater = (e: React.MouseEvent) => {
    e.stopPropagation();
    const randomCode = generateRandomRoomCode();
    const link = `${window.location.origin}/${randomCode}`;
    setGeneratedLink(link);
  };

  const handleStartInstantMeeting = () => {
    const randomCode = generateRandomRoomCode();
    navigateToRoom(randomCode);
  };

  const handleHomeJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (homeInput.trim()) {
      const code = homeInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      navigateToRoom(code);
    }
  };

  const navigateToRoom = (code: string) => {
    if (code) {
      setRoomId(code);
      setStep('lobby');
      window.history.pushState(null, '', `/${code}`);
    } else {
      setRoomId('');
      setStep('home');
      window.history.pushState(null, '', '/');
    }
  };

  const generateRandomRoomCode = () => {
    const parts = [];
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    for (let p = 0; p < 3; p++) {
      let segment = '';
      const len = p === 1 ? 4 : 3;
      for (let i = 0; i < len; i++) {
        segment += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      parts.push(segment);
    }
    return parts.join('-');
  };

  // -------------------------------------------------------------
  // LOBBY / PREVIEW HARDWARE INTERFACES
  // -------------------------------------------------------------
  const startLobbyPreviewStream = async () => {
    if (typeof window === 'undefined') return;
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }

      if (preset === 'audio-only') {
        localStreamRef.current = null;
        if (localPreviewVideoRef.current) localPreviewVideoRef.current.srcObject = null;
        return;
      }

      const constraints: MediaStreamConstraints = {
        audio: isMuted ? false : { deviceId: selectedMic ? { exact: selectedMic } : undefined },
        video: isCamOff ? false : {
          deviceId: selectedCam ? { exact: selectedCam } : undefined,
          width: PRESET_CONSTRAINTS[preset].video.width,
          height: PRESET_CONSTRAINTS[preset].video.height,
          frameRate: PRESET_CONSTRAINTS[preset].video.frameRate
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (localPreviewVideoRef.current) {
        localPreviewVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn("Lobby preview camera/mic access failed:", err);
    }
  };

  const startLobbyMicMeter = async () => {
    if (typeof window === 'undefined' || isMuted) {
      setLocalLobbyVolume(0);
      return;
    }
    try {
      const audioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: selectedMic ? { deviceId: { exact: selectedMic } } : true });
      
      const audioCtx = new audioCtxClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      micAudioContextRef.current = audioCtx;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      micAnalyserIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        setLocalLobbyVolume(level);
      }, 100);

    } catch (e) {
      console.warn("Could not start local mic visualizer:", e);
    }
  };

  const stopLobbyMicMeter = () => {
    if (micAnalyserIntervalRef.current) {
      clearInterval(micAnalyserIntervalRef.current);
    }
    if (micAudioContextRef.current) {
      micAudioContextRef.current.close().catch(() => {});
    }
    setLocalLobbyVolume(0);
  };

  // -------------------------------------------------------------
  // WEBRTC SIGNALING AND MAIN CALL CYCLE
  // -------------------------------------------------------------
  const handleJoinCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !roomId.trim()) return;

    try {
      // 1. Build local media stream with selected profile constraints
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      stopLobbyMicMeter();

      const selectedConstraints = PRESET_CONSTRAINTS[preset];
      const audioConfig = isMuted ? false : {
        deviceId: selectedMic ? { exact: selectedMic } : undefined,
        echoCancellation: true,
        noiseSuppression: true
      };

      const videoConfig = (isCamOff || preset === 'audio-only') ? false : {
        deviceId: selectedCam ? { exact: selectedCam } : undefined,
        width: selectedConstraints.video.width,
        height: selectedConstraints.video.height,
        frameRate: selectedConstraints.video.frameRate
      };

      if (audioConfig || videoConfig) {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: audioConfig,
          video: videoConfig
        });
      } else {
        localStreamRef.current = new MediaStream();
      }

      // 2. Initialize Socket.io Connection
      const socket = io();
      socketRef.current = socket;

      registerSocketEvents(socket);

      // Join Room
      socket.emit('join-room', {
        roomId,
        username,
        mediaState: {
          audio: !isMuted,
          video: !isCamOff && preset !== 'audio-only',
          screen: isScreenSharing
        }
      });

      // Synchronize client video filter choice if not default
      if (currentFilter && currentFilter !== 'none') {
        setTimeout(() => {
          socket.emit('change-filter', currentFilter);
        }, 1000);
      }

      setStep('call');
    } catch (err) {
      console.error('Failed to configure call stream:', err);
      showToast('Camera or Microphone hardware access denied.', true);
    }
  };

  const registerSocketEvents = (socket: Socket) => {
    // 1. Recieve list of users already in call
    socket.on('room-users', async ({ users: existingPeers }: { users: any[] }) => {
      console.log(`Discovered ${existingPeers.length} existing call peers.`);
      for (const peer of existingPeers) {
        await initiatePeerConnection(peer.socketId, peer.username, true, peer.mediaState);
      }
    });

    // 2. A new peer joined the room
    socket.on('user-joined', async ({ socketId, username: peerName, mediaState }) => {
      console.log(`Peer joined: ${peerName} (${socketId})`);
      showToast(`${peerName} joined the call.`);
      await initiatePeerConnection(socketId, peerName, false, mediaState);
    });

    // 3. Coordinate ICE Signalling data
    socket.on('signal', async ({ senderSocketId, senderUsername, signalData }) => {
      const peer = peersRef.current[senderSocketId];
      if (!peer) return;

      try {
        if (signalData.sdp) {
          const sdpType = signalData.sdp.type;
          console.log(`[SIGNAL] Recieved [${sdpType}] from ${senderUsername} (${senderSocketId})`);

          await peer.pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));

          if (sdpType === 'offer') {
            const answer = await peer.pc.createAnswer();
            const mungedAnswerSdp = mungeLocalSDP(answer.sdp || '', preset);
            const mungedAnswer = { type: 'answer', sdp: mungedAnswerSdp } as RTCSessionDescriptionInit;
            
            await peer.pc.setLocalDescription(mungedAnswer);

            socket.emit('signal', {
              targetSocketId: senderSocketId,
              signalData: { sdp: mungedAnswer }
            });
          }

          // Process queued ICE candidates buffered during setup
          while (peer.iceQueue.length > 0) {
            const cand = peer.iceQueue.shift();
            try {
              await peer.pc.addIceCandidate(cand);
            } catch (e) {
              console.warn("Buffered ICE candidate addition failed:", e);
            }
          }

        } else if (signalData.candidate) {
          const candidate = new RTCIceCandidate(signalData.candidate);
          if (peer.pc.remoteDescription) {
            await peer.pc.addIceCandidate(candidate);
          } else {
            // Buffer candidate if remote desc isn't loaded yet
            peer.iceQueue.push(candidate);
          }
        }
      } catch (err) {
        console.error(`Signaling error with peer ${senderUsername}:`, err);
      }
    });

    // 4. Remote peer media toggle update
    socket.on('peer-media-toggled', ({ socketId, type, enabled }) => {
      setPeersList(prev => prev.map(p => {
        if (p.socketId === socketId) {
          const newMediaState = { ...p.mediaState, [type]: enabled };
          return { ...p, mediaState: newMediaState };
        }
        return p;
      }));
    });

    // 5. Remote peer text chat message
    socket.on('receive-message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      if (!isChatOpen) {
        setUnreadChat(true);
      }
    });

    // 6. Emoji reactions
    socket.on('peer-reaction', ({ socketId, emoji }) => {
      triggerReactionAnimation(socketId, emoji);
    });

    // 7. Live speech captions
    socket.on('peer-caption', ({ socketId, text }) => {
      setPeersList(prev => prev.map(p => {
        if (p.socketId === socketId) {
          return { ...p, captionText: text };
        }
        return p;
      }));

      // Clear caption after 4s
      setTimeout(() => {
        setPeersList(prev => prev.map(p => {
          if (p.socketId === socketId && p.captionText === text) {
            return { ...p, captionText: '' };
          }
          return p;
        }));
      }, 4000);
    });

    // 8. Hand raise indicator
    socket.on('peer-raised-hand', ({ socketId, isRaised }) => {
      setPeersList(prev => prev.map(p => {
        if (p.socketId === socketId) {
          return { ...p, isRaised };
        }
        return p;
      }));
    });

    // 9. Filter toggling
    socket.on('peer-filter-changed', ({ socketId, filterClass }) => {
      setPeersList(prev => prev.map(p => {
        if (p.socketId === socketId) {
          return { ...p, filter: filterClass };
        }
        return p;
      }));
    });

    // 10. Peer left
    socket.on('user-left', ({ socketId, username: peerName }) => {
      showToast(`${peerName} left the call.`);
      cleanupPeerConnection(socketId);
    });

    // Remote Debugging logs
    socket.on('client-error', (err) => {
      console.error("[REMOTE DEBUG] Client encountered error:", err);
    });

    socket.on('error-message', (err) => {
      showToast(err, true);
      handleLeaveCall();
    });
  };

  const initiatePeerConnection = async (targetSocketId: string, peerUsername: string, createOffer = false, initialMediaState = null) => {
    console.log(`Creating RTCPeerConnection to ${peerUsername} (${targetSocketId})`);

    const pc = new RTCPeerConnection(RTC_CONFIG);

    peersRef.current[targetSocketId] = {
      pc,
      iceQueue: []
    };

    // Stage internal peer details list to trigger React re-renders
    setPeersList(prev => {
      const exists = prev.some(p => p.socketId === targetSocketId);
      if (exists) return prev;
      return [...prev, {
        socketId: targetSocketId,
        username: peerUsername,
        stream: null,
        mediaState: initialMediaState || { audio: false, video: false, screen: false },
        isRaised: false,
        filter: 'none'
      }];
    });

    // 1. Append our local tracks to connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => {
        pc.addTrack(t, localStreamRef.current!);
      });
    }

    // 2. Recieve remote tracks
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setPeersList(prev => prev.map(p => {
        if (p.socketId === targetSocketId) {
          return { ...p, stream: remoteStream };
        }
        return p;
      }));
    };

    // 3. Feed ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal', {
          targetSocketId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    // 4. State updates
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`WebRTC Connection State with ${peerUsername}: ${state}`);
      
      setPeersList(prev => prev.map(p => {
        if (p.socketId === targetSocketId) {
          return {
            ...p,
            stats: {
              ...p.stats,
              remoteIp: state === 'connected' ? p.stats?.remoteIp || 'Locating...' : state.toUpperCase()
            }
          };
        }
        return p;
      }));

      if (state === 'disconnected') {
        setTimeout(() => {
          const peer = peersRef.current[targetSocketId];
          if (peer && (peer.pc.connectionState === 'disconnected' || peer.pc.connectionState === 'failed')) {
            cleanupPeerConnection(targetSocketId);
          }
        }, 5000);
      } else if (state === 'failed') {
        showToast(`Connection to ${peerUsername} failed. Re-initiating...`);
        reconnectPeer(targetSocketId);
      }
    };

    // Start stats monitoring
    startMonitoringStats(targetSocketId);

    // 5. Generate SDP offer if initiator
    if (createOffer && socketRef.current) {
      try {
        const offer = await pc.createOffer();
        const mungedOfferSdp = mungeLocalSDP(offer.sdp || '', preset);
        const mungedOffer = { type: 'offer', sdp: mungedOfferSdp } as RTCSessionDescriptionInit;

        await pc.setLocalDescription(mungedOffer);

        socketRef.current.emit('signal', {
          targetSocketId,
          signalData: { sdp: mungedOffer }
        });
      } catch (err) {
        console.error(`Failed to generate SDP offer for ${peerUsername}:`, err);
      }
    }
  };

  const reconnectPeer = async (socketId: string) => {
    const peer = peersRef.current[socketId];
    const peerInfo = peersList.find(p => p.socketId === socketId);
    if (!peer || !peerInfo) return;

    try {
      peer.pc.close();
    } catch (e) {}

    const isInitiator = socketRef.current ? socketRef.current.id! < socketId : false;
    await initiatePeerConnection(socketId, peerInfo.username, isInitiator, peerInfo.mediaState as any);
  };

  const cleanupPeerConnection = (socketId: string) => {
    const peer = peersRef.current[socketId];
    if (peer) {
      if (peer.statsInterval) clearInterval(peer.statsInterval);
      try {
        peer.pc.close();
      } catch (e) {}
      delete peersRef.current[socketId];
    }
    setPeersList(prev => prev.filter(p => p.socketId !== socketId));
  };

  const cleanupAllWebRTC = () => {
    for (const socketId in peersRef.current) {
      cleanupPeerConnection(socketId);
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  // -------------------------------------------------------------
  // DYNAMIC SENDER BITRATES & SDP MUNGER
  // -------------------------------------------------------------
  const mungeLocalSDP = (sdp: string, presetVal: string) => {
    let videoKbps = 150;
    let audioKbps = 20;

    if (presetVal === 'medium') {
      videoKbps = 500;
      audioKbps = 32;
    } else if (presetVal === 'high') {
      videoKbps = 1500;
      audioKbps = 64;
    } else if (presetVal === 'audio-only') {
      videoKbps = 1;
      audioKbps = 16;
    }

    const lines = sdp.split('\r\n');
    const munged = [];
    let inVideoBlock = false;
    let inAudioBlock = false;

    for (let line of lines) {
      if (line.startsWith('m=audio')) {
        inAudioBlock = true;
        inVideoBlock = false;
        munged.push(line);
        munged.push(`b=AS:${audioKbps}`);
        munged.push(`b=TIAS:${audioKbps * 1000}`);
        continue;
      }
      if (line.startsWith('m=video')) {
        inVideoBlock = true;
        inAudioBlock = false;
        munged.push(line);
        munged.push(`b=AS:${videoKbps}`);
        munged.push(`b=TIAS:${videoKbps * 1000}`);
        continue;
      }

      if (line.startsWith('b=AS:') || line.startsWith('b=TIAS:')) {
        if (inAudioBlock || inVideoBlock) continue;
      }

      if (inAudioBlock && line.startsWith('a=fmtp:')) {
        if (line.includes('maxaveragebitrate=')) {
          line = line.replace(/maxaveragebitrate=\d+/, `maxaveragebitrate=${audioKbps * 1000}`);
        } else {
          line = line + `;maxaveragebitrate=${audioKbps * 1000}`;
        }
        if (!line.includes('useinbandfec=1')) {
          line = line + ';useinbandfec=1';
        }
      }
      munged.push(line);
    }
    return munged.join('\r\n');
  };

  const updateSenderBitrates = async (pc: RTCPeerConnection, targetPreset: string) => {
    let videoMaxBps = 150000;
    let audioMaxBps = 20000;

    if (targetPreset === 'medium') {
      videoMaxBps = 500000;
      audioMaxBps = 32000;
    } else if (targetPreset === 'high') {
      videoMaxBps = 1500000;
      audioMaxBps = 64000;
    } else if (targetPreset === 'audio-only') {
      videoMaxBps = 1;
      audioMaxBps = 16000;
    }

    try {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (!sender.track) continue;
        if (sender.track.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = videoMaxBps;
          params.encodings[0].scaleResolutionDownBy = targetPreset === 'low' ? 2.0 : 1.0;
          await sender.setParameters(params);
        } else if (sender.track.kind === 'audio') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = audioMaxBps;
          await sender.setParameters(params);
        }
      }
    } catch (e) {
      console.warn("Could not change sender bitrate parameters dynamically:", e);
    }
  };

  // -------------------------------------------------------------
  // CONNECTION STATS MONITORING
  // -------------------------------------------------------------
  const startMonitoringStats = (socketId: string) => {
    const peer = peersRef.current[socketId];
    if (!peer) return;

    let prevBytes = 0;
    let prevTimestamp = 0;

    peer.statsInterval = setInterval(async () => {
      try {
        const statsReport = await peer.pc.getStats();
        let rtt: number | null = null;
        let packetLoss: string | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let fps: number | null = null;
        let bitrate = 0;
        let remoteIp = '';

        statsReport.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime !== undefined) {
              rtt = Math.round(report.currentRoundTripTime * 1000);
            }
            remoteIp = report.remoteCandidateId;
          }

          if (report.type === 'remote-candidate' && remoteIp === report.id) {
            remoteIp = `${report.ipAddress || report.ip}:${report.port} (${report.candidateType})`;
          }

          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            width = report.frameWidth || null;
            height = report.frameHeight || null;
            fps = report.framesPerSecond || null;

            const lost = report.packetsLost || 0;
            const rec = report.packetsReceived || 0;
            const total = lost + rec;
            if (total > 0) {
              packetLoss = ((lost / total) * 100).toFixed(1);
            }

            const bytes = report.bytesReceived;
            const now = report.timestamp;
            if (prevBytes && prevTimestamp) {
              const diffBytes = bytes - prevBytes;
              const diffTime = (now - prevTimestamp) / 1000;
              bitrate = Math.round((diffBytes * 8) / (diffTime * 1024));
            }
            prevBytes = bytes;
            prevTimestamp = now;
          }
        });

        // Set metrics state in React
        setPeersList(prev => prev.map(p => {
          if (p.socketId === socketId) {
            return {
              ...p,
              stats: {
                resolution: width && height ? `${width}x${height}` : 'No Feed',
                fps,
                rtt,
                packetLoss,
                bitrate,
                remoteIp: remoteIp || p.stats?.remoteIp || 'Locating...'
              }
            };
          }
          return p;
        }));

      } catch (err) {
        console.warn(`Error capturing WebRTC stats for peer ${socketId}:`, err);
      }
    }, 2500);
  };

  // -------------------------------------------------------------
  // CONTROLS INTERACTION LOGIC
  // -------------------------------------------------------------
  const handleToggleMic = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !nextMute);
    }
    if (socketRef.current) {
      socketRef.current.emit('toggle-media', { type: 'audio', enabled: !nextMute });
    }
  };

  const handleToggleCam = async () => {
    const nextCam = !isCamOff;
    setIsCamOff(nextCam);

    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (nextCam) {
        if (videoTrack) {
          videoTrack.enabled = false;
          videoTrack.stop();
        }
        if (localCallVideoRef.current) localCallVideoRef.current.srcObject = null;
      } else {
        await rebuildCallStream();
      }
    }

    if (socketRef.current) {
      socketRef.current.emit('toggle-media', { type: 'video', enabled: !nextCam && preset !== 'audio-only' });
    }
  };

  const rebuildCallStream = async () => {
    const selectedConstraints = PRESET_CONSTRAINTS[preset];
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: isMuted ? false : { deviceId: selectedMic ? { exact: selectedMic } : undefined },
        video: isCamOff ? false : {
          deviceId: selectedCam ? { exact: selectedCam } : undefined,
          width: selectedConstraints.video.width,
          height: selectedConstraints.video.height,
          frameRate: selectedConstraints.video.frameRate
        }
      });

      // Swap out tracks dynamically for all connections
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack && localStreamRef.current) {
        const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldVideoTrack) {
          localStreamRef.current.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
        }
        localStreamRef.current.addTrack(newVideoTrack);

        for (const socketId in peersRef.current) {
          const senders = peersRef.current[socketId].pc.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(newVideoTrack);
          }
        }
      }

      if (localCallVideoRef.current) {
        localCallVideoRef.current.srcObject = localStreamRef.current;
      }
    } catch (e) {
      console.error("Could not rebuild call stream:", e);
    }
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop sharing screen
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      await rebuildCallStream();
    } else {
      // Start sharing screen
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always', width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 10 } } as any,
          audio: false
        });
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);

        const screenTrack = screenStream.getVideoTracks()[0];
        if (localStreamRef.current) {
          const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
          if (oldVideoTrack) {
            localStreamRef.current.removeTrack(oldVideoTrack);
            oldVideoTrack.stop();
          }
          localStreamRef.current.addTrack(screenTrack);
        }

        if (localCallVideoRef.current) {
          localCallVideoRef.current.srcObject = screenStream;
        }

        // Swap out RTC tracks
        for (const socketId in peersRef.current) {
          const senders = peersRef.current[socketId].pc.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          }
        }

        screenTrack.onended = () => {
          handleToggleScreenShare(); // Reset layout when user stops sharing via browser bar
        };

        if (socketRef.current) {
          socketRef.current.emit('toggle-media', { type: 'video', enabled: true });
        }
      } catch (err) {
        console.warn("Screen share cancel or failure:", err);
      }
    }
  };

  const handleToggleRaiseHand = () => {
    const nextHand = !isHandRaised;
    setIsHandRaised(nextHand);
    if (socketRef.current) {
      socketRef.current.emit('raise-hand', nextHand);
    }
  };

  const handleToggleCaptions = () => {
    const nextCaptions = !isCaptionsOn;
    setIsCaptionsOn(nextCaptions);

    if (nextCaptions) {
      startSpeechRecognition();
    } else {
      stopSpeechRecognition();
    }
  };

  const startSpeechRecognition = () => {
    if (typeof window === 'undefined') return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Speech recognition is not supported in this browser.", true);
      setIsCaptionsOn(false);
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      const caption = final || interim;
      if (caption.trim() && socketRef.current) {
        socketRef.current.emit('send-caption', caption);
        
        // Show captions on Me
        const localCap = document.getElementById('subtitle-local');
        if (localCap) {
          localCap.innerText = caption;
          localCap.classList.remove('hidden');
        }
      }
    };

    rec.onend = () => {
      if (isCaptionsOn) {
        try {
          rec.start();
        } catch (e) {}
      }
    };

    speechRecognitionRef.current = rec;
    rec.start();
  };

  const stopSpeechRecognition = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
    }
    const localCap = document.getElementById('subtitle-local');
    if (localCap) {
      localCap.classList.add('hidden');
    }
  };

  const handleSendReaction = (emoji: string) => {
    if (socketRef.current) {
      socketRef.current.emit('send-reaction', emoji);
      triggerReactionAnimation('local', emoji);
    }
    // Hide reactions popup menu
    const reactionsEl = document.getElementById('reactions-palette');
    if (reactionsEl) reactionsEl.classList.add('hidden');
  };

  const triggerReactionAnimation = (senderId: string, emoji: string) => {
    const parentId = senderId === 'local' ? 'video-card-local' : `video-card-${senderId}`;
    const parent = document.getElementById(parentId);
    if (!parent) return;

    const reactionEl = document.createElement('div');
    reactionEl.className = 'floating-reaction-bubble';
    reactionEl.innerText = emoji;
    parent.appendChild(reactionEl);

    // Fade and float out
    setTimeout(() => {
      reactionEl.remove();
    }, 2000);
  };

  const handleFilterSelect = (filter: string) => {
    setCurrentFilter(filter);
    if (socketRef.current) {
      socketRef.current.emit('change-filter', filter);
    }
    // Close dropdowns
    const menuLobby = document.getElementById('preview-filters-menu');
    if (menuLobby) menuLobby.classList.add('hidden');
    const menuCall = document.getElementById('filters-menu');
    if (menuCall) menuCall.classList.add('hidden');
  };

  const handlePresetSelect = async (presetVal: 'low' | 'medium' | 'high' | 'audio-only') => {
    setPreset(presetVal);
    
    // Close presets dropdown menu
    const menu = document.getElementById('preset-dropdown');
    if (menu) menu.classList.add('hidden');

    if (localStreamRef.current) {
      const constraints = PRESET_CONSTRAINTS[presetVal];
      const videoTrack = localStreamRef.current.getVideoTracks()[0];

      if (videoTrack) {
        if (presetVal === 'audio-only') {
          videoTrack.enabled = false;
          videoTrack.stop();
          if (localCallVideoRef.current) localCallVideoRef.current.srcObject = null;
          if (socketRef.current) {
            socketRef.current.emit('toggle-media', { type: 'video', enabled: false });
          }
        } else {
          try {
            await videoTrack.applyConstraints(constraints.video);
            videoTrack.enabled = !isCamOff;
            if (socketRef.current) {
              socketRef.current.emit('toggle-media', { type: 'video', enabled: !isCamOff });
            }
            if (localCallVideoRef.current && localCallVideoRef.current.srcObject === null) {
              await rebuildCallStream();
            }
          } catch (e) {
            console.warn('Track apply constraints failed:', e);
          }
        }
      } else if (presetVal !== 'audio-only' && !isCamOff) {
        await rebuildCallStream();
      }
    }

    // Dynamic quality adjustments for all peer senders
    for (const socketId in peersRef.current) {
      await updateSenderBitrates(peersRef.current[socketId].pc, presetVal);
      // Trigger WebRTC renegotiation offer
      try {
        const peer = peersRef.current[socketId];
        const offer = await peer.pc.createOffer();
        const mungedOfferSdp = mungeLocalSDP(offer.sdp || '', presetVal);
        const mungedOffer = { type: 'offer', sdp: mungedOfferSdp } as RTCSessionDescriptionInit;
        
        await peer.pc.setLocalDescription(mungedOffer);
        if (socketRef.current) {
          socketRef.current.emit('signal', {
            targetSocketId: socketId,
            signalData: { sdp: mungedOffer }
          });
        }
      } catch (err) {
        console.warn("Dynamic renegotiation offer failed:", err);
      }
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim() && socketRef.current) {
      socketRef.current.emit('send-message', chatInput.trim());
      setChatInput('');
    }
  };

  const handleLeaveCall = () => {
    cleanupAllWebRTC();
    setStep('home');
    setRoomId('');
    setHomeInput('');
    setMessages([]);
    setIsChatOpen(false);
    setUnreadChat(false);
    setPeersList([]);
    setIsHandRaised(false);
    setIsCaptionsOn(false);
    setIsScreenSharing(false);
    setCurrentFilter('none');
    window.history.pushState(null, '', '/');
  };

  const handleCopyLink = (url: string) => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(url).then(() => {
        showToast("Joining link copied to clipboard!");
      }).catch(err => {
        console.warn("Could not copy:", err);
      });
    }
  };

  const toggleDropdown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const list = ['new-meeting-dropdown', 'preview-filters-menu', 'reactions-palette', 'filters-menu', 'preset-dropdown'];
    list.forEach(item => {
      const el = document.getElementById(item);
      if (el) {
        if (item === id) {
          el.classList.toggle('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });
  };

  // Close dropdowns on body clicks
  useEffect(() => {
    const handleBodyClick = () => {
      const list = ['new-meeting-dropdown', 'preview-filters-menu', 'reactions-palette', 'filters-menu', 'preset-dropdown'];
      list.forEach(item => {
        const el = document.getElementById(item);
        if (el) el.classList.add('hidden');
      });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('click', handleBodyClick);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('click', handleBodyClick);
      }
    };
  }, []);

  return (
    <div id="app">
      {/* 1. Secure Context SSL warning banner */}
      {secureContextWarning && (
        <div id="secure-context-alert" className="alert-banner">
          <div className="alert-banner-content">
            <ShieldAlert className="alert-icon" size={20} />
            <span><strong>Security Warning:</strong> Camera & Mic access requires a secure connection (HTTPS). Please load this app via SSL or localhost.</span>
          </div>
        </div>
      )}

      {/* STEP 1: HOME SCREEN */}
      {step === 'home' && (
        <main id="home-screen" className="screen-container">
          <header className="home-header">
            <div className="logo-area">
              <span className="logo-sparkle">✦</span>
              <h2>AuraCall</h2>
            </div>
            <div className="header-right">
              <div className="time-display">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              <button className="icon-btn" title="Settings"><Settings size={20} /></button>
            </div>
          </header>

          <div className="home-main-layout">
            <div className="home-left-content">
              <h1 className="main-heading">Premium video calls.<br />Now free for everyone.</h1>
              <p className="main-subheading">We re-engineered the service we built for secure meetings, AuraCall, to make it free and accessible on any device, optimized for low internet bandwidth.</p>
              
              <div className="home-actions-area">
                <div className="new-meeting-wrapper">
                  <button id="new-meeting-btn" className="meet-primary-btn flex-btn" onClick={(e) => toggleDropdown('new-meeting-dropdown', e)}>
                    <Video size={18} className="icon-inline" />
                    <span>New meeting</span>
                  </button>
                  
                  <ul id="new-meeting-dropdown" className="meet-popup-menu hidden">
                    <li onClick={handleCreateMeetingLater}><Link2 size={16} /> Create a meeting for later</li>
                    <li onClick={handleStartInstantMeeting}><Sliders size={16} /> Start an instant meeting</li>
                  </ul>
                </div>

                <form id="home-join-form" className="home-join-form" onSubmit={handleHomeJoinSubmit}>
                  <div className="room-input-container">
                    <Keyboard className="keyboard-icon" size={18} />
                    <input
                      type="text"
                      id="home-room-input"
                      placeholder="Enter a code or link"
                      required
                      autoComplete="off"
                      value={homeInput}
                      onChange={(e) => setHomeInput(e.target.value)}
                    />
                  </div>
                  <button type="submit" id="home-join-btn" className="meet-link-btn-flat" disabled={!homeInput.trim()}>Join</button>
                </form>
              </div>

              <div className="action-divider"></div>
              <p className="action-footer-text">
                <span className="footer-hint">Safe, secure, and responsive calling.</span>
              </p>
            </div>

            <div className="home-right-showcase">
              <div className="showcase-carousel">
                <div className="carousel-slides">
                  {activeSlide === 0 && (
                    <div className="carousel-slide active">
                      <div className="slide-image-wrapper">
                        <div className="glowing-orb"></div>
                        <Link2 className="slide-icon" size={48} />
                      </div>
                      <h3>Get a link you can share</h3>
                      <p>Click <strong>New meeting</strong> to get a link you can send to people you want to meet with</p>
                    </div>
                  )}
                  {activeSlide === 1 && (
                    <div className="carousel-slide active">
                      <div className="slide-image-wrapper">
                        <div className="glowing-orb blue"></div>
                        <ShieldCheck className="slide-icon" size={48} />
                      </div>
                      <h3>Your meeting is secure</h3>
                      <p>No one can join a meeting unless they are invited or admitted by the host</p>
                    </div>
                  )}
                  {activeSlide === 2 && (
                    <div className="carousel-slide active">
                      <div className="slide-image-wrapper">
                        <div className="glowing-orb green"></div>
                        <Zap className="slide-icon" size={48} />
                      </div>
                      <h3>Adaptive Presets</h3>
                      <p>Dynamically switch profiles (Low Bandwidth, Balanced, HD) to survive flaky connections</p>
                    </div>
                  )}
                </div>
                
                <div className="carousel-controls">
                  <button className="carousel-arrow" onClick={() => setActiveSlide(prev => (prev - 1 + 3) % 3)}><ChevronLeft size={16} /></button>
                  <div className="carousel-dots">
                    {[0, 1, 2].map(idx => (
                      <span key={idx} className={`dot ${activeSlide === idx ? 'active' : ''}`} onClick={() => setActiveSlide(idx)}></span>
                    ))}
                  </div>
                  <button className="carousel-arrow" onClick={() => setActiveSlide(prev => (prev + 1) % 3)}><ChevronRight size={16} /></button>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* STEP 2: LOBBY SCREEN */}
      {step === 'lobby' && (
        <main id="lobby-screen" className="screen-container">
          <header className="lobby-header">
            <div className="logo-area" style={{ cursor: 'pointer' }} onClick={() => navigateToRoom('')}>
              <span className="logo-sparkle">✦</span>
              <h2>AuraCall</h2>
            </div>
          </header>

          <div className="lobby-meet-layout">
            <div className="lobby-left-preview">
              <div className="meet-preview-card">
                <video
                  ref={localPreviewVideoRef}
                  id="local-preview"
                  autoPlay
                  playsInline
                  muted
                  className={currentFilter !== 'none' ? `filter-${currentFilter}` : ''}
                ></video>
                
                {isCamOff && (
                  <div id="preview-placeholder" className="preview-placeholder-avatar">
                    <div className="placeholder-circle">{username ? username.charAt(0).toUpperCase() : 'A'}</div>
                    <p>Camera is off</p>
                  </div>
                )}
                
                {currentFilter !== 'none' && (
                  <div id="preview-filter-overlay" className={`filter-overlay-effect filter-${currentFilter}`}></div>
                )}
                
                <div className="preview-controls-overlay">
                  <button className={`preview-action-btn ${!isMuted ? 'active' : ''}`} title="Toggle Mic" onClick={handleToggleMic}>
                    {!isMuted ? <Mic size={18} className="on-icon" /> : <MicOff size={18} className="off-icon" />}
                  </button>
                  
                  <button className={`preview-action-btn ${!isCamOff ? 'active' : ''}`} title="Toggle Cam" onClick={handleToggleCam}>
                    {!isCamOff ? <Video size={18} className="on-icon" /> : <VideoOff size={18} className="off-icon" />}
                  </button>
                  
                  <div className="preview-dropdown-wrapper">
                    <button id="preview-btn-filters" className="preview-action-btn" title="Video Filters" onClick={(e) => toggleDropdown('preview-filters-menu', e)}>
                      <Sparkles size={18} />
                    </button>
                    <ul id="preview-filters-menu" className="meet-popup-menu hidden">
                      <li onClick={() => handleFilterSelect('none')} className={currentFilter === 'none' ? 'active-item' : ''}><Ban size={16} /> No Filter</li>
                      <li onClick={() => handleFilterSelect('blur')} className={currentFilter === 'blur' ? 'active-item' : ''}><EyeOff size={16} /> Blur Video</li>
                      <li onClick={() => handleFilterSelect('grayscale')} className={currentFilter === 'grayscale' ? 'active-item' : ''}><Palette size={16} /> Black & White</li>
                      <li onClick={() => handleFilterSelect('sepia')} className={currentFilter === 'sepia' ? 'active-item' : ''}><History size={16} /> Vintage (Sepia)</li>
                      <li onClick={() => handleFilterSelect('warm')} className={currentFilter === 'warm' ? 'active-item' : ''}><Sun size={16} /> Warm Glow</li>
                      <li onClick={() => handleFilterSelect('invert')} className={currentFilter === 'invert' ? 'active-item' : ''}><RefreshCw size={16} /> Invert</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <div className="mic-visualizer-container">
                <span className="visualizer-label"><Mic size={14} className="icon-inline" /> Mic test:</span>
                <div className="mic-visualizer-bar" id="mic-level-bar">
                  <div className="mic-level-fill" id="mic-level-fill" style={{ width: `${localLobbyVolume}%` }}></div>
                </div>
              </div>
            </div>

            <div className="lobby-right-content">
              <div className="lobby-info-header">
                <h1 className="lobby-title">Ready to join?</h1>
                <p className="lobby-subtitle">Meeting Room: <strong id="lobby-room-display">{roomId}</strong></p>
              </div>

              <form id="join-form" className="meet-join-form" onSubmit={handleJoinCallSubmit}>
                <div className="lobby-input-group">
                  <label htmlFor="username" className="section-label">Your Name</label>
                  <input
                    type="text"
                    id="username"
                    placeholder="Enter your name"
                    required
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="lobby-preset-area">
                  <p className="section-label">Connection Profile</p>
                  <div className="meet-presets-grid">
                    <label className="meet-preset-option">
                      <input type="radio" name="preset" value="low" checked={preset === 'low'} onChange={() => setPreset('low')} />
                      <div className="preset-indicator">
                        <span className="preset-name">Low Bandwidth</span>
                        <span className="preset-sub">240p, 15fps (Survive 3G networks)</span>
                      </div>
                    </label>
                    
                    <label className="meet-preset-option">
                      <input type="radio" name="preset" value="medium" checked={preset === 'medium'} onChange={() => setPreset('medium')} />
                      <div className="preset-indicator">
                        <span className="preset-name">Balanced</span>
                        <span className="preset-sub">480p, 24fps (Weak WiFi)</span>
                      </div>
                    </label>
                    
                    <label className="meet-preset-option">
                      <input type="radio" name="preset" value="high" checked={preset === 'high'} onChange={() => setPreset('high')} />
                      <div className="preset-indicator">
                        <span className="preset-name">High Quality</span>
                        <span className="preset-sub">720p, 30fps (HD Call)</span>
                      </div>
                    </label>
                    
                    <label className="meet-preset-option">
                      <input type="radio" name="preset" value="audio-only" checked={preset === 'audio-only'} onChange={() => setPreset('audio-only')} />
                      <div className="preset-indicator">
                        <span className="preset-name">Audio Only</span>
                        <span className="preset-sub">Camera Off, extreme low data usage</span>
                      </div>
                    </label>
                  </div>
                </div>

                <details className="meet-details-collapse">
                  <summary><Settings size={14} /> Audio & Video Hardware</summary>
                  <div className="hardware-dropdowns">
                    <div className="dropdown-group">
                      <label htmlFor="mic-select">Microphone</label>
                      <select id="mic-select" value={selectedMic} onChange={(e) => setSelectedMic(e.target.value)}>
                        {devices.mics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 5)}`}</option>)}
                      </select>
                    </div>
                    <div className="dropdown-group">
                      <label htmlFor="cam-select">Camera</label>
                      <select id="cam-select" value={selectedCam} onChange={(e) => setSelectedCam(e.target.value)}>
                        {devices.cams.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 5)}`}</option>)}
                      </select>
                    </div>
                  </div>
                </details>

                <button type="submit" id="join-btn" className="meet-primary-btn join-call-action-btn">
                  <span>Join call</span>
                </button>
              </form>
            </div>
          </div>
        </main>
      )}

      {/* STEP 3: CALL SCREEN */}
      {step === 'call' && (
        <main id="call-screen" className="screen-container">
          <div className="meet-call-layout">
            
            {/* Top info bar */}
            <div className="meet-top-bar">
              <div className="meet-room-info">
                <span className="room-code-label">Room: <strong>{roomId}</strong></span>
                <span className="divider">|</span>
                <button id="copy-room-link" className="meet-link-btn" title="Copy meeting link" onClick={() => handleCopyLink(`${window.location.origin}/${roomId}`)}>
                  <Copy className="icon-inline" size={14} />
                  <span>Copy joining link</span>
                </button>
              </div>
              
              <div className="meet-profile-indicator">
                <div className="connection-quality-indicator">
                  <span className="connection-status-dot"></span>
                  <span id="active-preset-label">
                    {preset === 'low' && 'Low Bandwidth Profile'}
                    {preset === 'medium' && 'Balanced Profile'}
                    {preset === 'high' && 'High Quality Profile'}
                    {preset === 'audio-only' && 'Audio Only Profile'}
                  </span>
                </div>
              </div>
            </div>

            {/* Video grid */}
            <div className="meet-video-workspace">
              <div id="video-grid" className="meet-video-grid">
                
                {/* Local Video Card */}
                <div className="meet-video-tile local-peer" id="video-card-local">
                  <video
                    ref={localCallVideoRef}
                    id="local-video"
                    autoPlay
                    playsInline
                    muted
                    className={currentFilter !== 'none' ? `filter-${currentFilter} local-peer` : 'local-peer'}
                  ></video>

                  {(isCamOff || preset === 'audio-only') && (
                    <div className="video-placeholder">
                      <div className="placeholder-circle-call">Me</div>
                    </div>
                  )}

                  {currentFilter !== 'none' && (
                    <div className={`filter-overlay-effect filter-${currentFilter}`}></div>
                  )}

                  <div className="tile-overlay-bottom">
                    <span className="user-label">You (Host)</span>
                    <span id="local-mic-indicator" className={`tile-mic-indicator ${isMuted ? '' : 'hidden'}`}>
                      <MicOff size={12} />
                    </span>
                  </div>

                  <div className="tile-overlay-top">
                    <span className="quality-badge" id="local-stats-tag">{preset.toUpperCase()}</span>
                  </div>

                  {isHandRaised && (
                    <div className="tile-indicators">
                      <span className="tile-hand-indicator"><Hand size={14} /></span>
                    </div>
                  )}

                  {/* Subtitles Overlay */}
                  <div className="subtitle-overlay hidden" id="subtitle-local"></div>
                </div>

                {/* Remote Video Cards */}
                {peersList.map(peer => (
                  <div key={peer.socketId} className="meet-video-tile" id={`video-card-${peer.socketId}`}>
                    <video
                      ref={el => { peerVideoRefs.current[peer.socketId] = el; }}
                      autoPlay
                      playsInline
                      className={peer.filter !== 'none' ? `filter-${peer.filter}` : ''}
                      onLoadedMetadata={() => {
                        if (peerVideoRefs.current[peer.socketId] && peer.stream) {
                          peerVideoRefs.current[peer.socketId]!.srcObject = peer.stream;
                        }
                      }}
                    ></video>

                    {(!peer.mediaState.video || !peer.stream) && (
                      <div className="video-placeholder">
                        <div className="placeholder-circle-call">{peer.username ? peer.username.charAt(0).toUpperCase() : 'P'}</div>
                      </div>
                    )}

                    {peer.filter !== 'none' && (
                      <div className={`filter-overlay-effect filter-${peer.filter}`}></div>
                    )}

                    <div className="tile-overlay-bottom">
                      <span className="user-label">{peer.username}</span>
                      <span className={`tile-mic-indicator ${!peer.mediaState.audio ? '' : 'hidden'}`}>
                        <MicOff size={12} />
                      </span>
                    </div>

                    <div className="tile-overlay-top">
                      <span className="quality-badge quality-tag">
                        {peer.stats?.resolution && peer.stats.resolution !== 'No Feed' ? (
                          `${peer.stats.resolution} | ${peer.stats.fps || 0}fps`
                        ) : 'Connecting'}
                      </span>
                    </div>

                    {(peer.isRaised || peer.captionText) && (
                      <div className="tile-indicators">
                        {peer.isRaised && <span className="tile-hand-indicator"><Hand size={14} /></span>}
                      </div>
                    )}

                    {peer.captionText && (
                      <div className="subtitle-overlay">{peer.captionText}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom floating meeting controls toolbar */}
            <div className="meet-controls-bar">
              <div className="controls-wrapper">
                <button className={`meet-btn ${!isMuted ? 'active' : ''}`} title="Toggle Mic" onClick={handleToggleMic}>
                  {!isMuted ? <Mic size={18} className="on-icon" /> : <MicOff size={18} className="off-icon" />}
                </button>
                
                <button className={`meet-btn ${!isCamOff ? 'active' : ''}`} title="Toggle Cam" onClick={handleToggleCam}>
                  {!isCamOff ? <Video size={18} className="on-icon" /> : <VideoOff size={18} className="off-icon" />}
                </button>
                
                <button className={`meet-btn ${isScreenSharing ? 'active' : ''}`} title="Share Screen" onClick={handleToggleScreenShare}>
                  <Sliders size={18} />
                </button>

                <button className={`meet-btn ${isHandRaised ? 'active' : ''}`} title="Raise Hand" onClick={handleToggleRaiseHand}>
                  <Hand size={18} />
                </button>

                <button className={`meet-btn ${isCaptionsOn ? 'active' : ''}`} title="Toggle Captions" onClick={handleToggleCaptions}>
                  <Smile size={18} />
                </button>

                <div className="meet-dropdown-wrapper">
                  <button id="btn-reactions-trigger" className="meet-btn" title="Send Reaction" onClick={(e) => toggleDropdown('reactions-palette', e)}>
                    <Smile size={18} />
                  </button>
                  <div id="reactions-palette" className="meet-popup-menu hidden emoji-palette">
                    {['👍', '❤️', '😂', '😮', '👏', '🎉'].map(emoji => (
                      <button key={emoji} type="button" onClick={() => handleSendReaction(emoji)}>{emoji}</button>
                    ))}
                  </div>
                </div>

                <div className="meet-dropdown-wrapper">
                  <button id="btn-filters-trigger" className="meet-btn" title="Video Filters" onClick={(e) => toggleDropdown('filters-menu', e)}>
                    <Sparkles size={18} />
                  </button>
                  <ul id="filters-menu" className="meet-popup-menu hidden">
                    <li onClick={() => handleFilterSelect('none')} className={currentFilter === 'none' ? 'active-item' : ''}><Ban size={16} /> No Filter</li>
                    <li onClick={() => handleFilterSelect('blur')} className={currentFilter === 'blur' ? 'active-item' : ''}><EyeOff size={16} /> Blur Video</li>
                    <li onClick={() => handleFilterSelect('grayscale')} className={currentFilter === 'grayscale' ? 'active-item' : ''}><Palette size={16} /> Black & White</li>
                    <li onClick={() => handleFilterSelect('sepia')} className={currentFilter === 'sepia' ? 'active-item' : ''}><History size={16} /> Vintage (Sepia)</li>
                    <li onClick={() => handleFilterSelect('warm')} className={currentFilter === 'warm' ? 'active-item' : ''}><Sun size={16} /> Warm Glow</li>
                    <li onClick={() => handleFilterSelect('invert')} className={currentFilter === 'invert' ? 'active-item' : ''}><RefreshCw size={16} /> Invert</li>
                  </ul>
                </div>
                
                <div className="meet-dropdown-wrapper">
                  <button id="btn-preset-trigger" className="meet-btn text-btn-preset" title="Connection Profile" onClick={(e) => toggleDropdown('preset-dropdown', e)}>
                    <Sliders size={18} />
                    <span id="active-dropdown-label">{preset.toUpperCase()}</span>
                  </button>
                  
                  <ul id="preset-dropdown" className="meet-popup-menu hidden">
                    <li onClick={() => handlePresetSelect('low')} className={preset === 'low' ? 'active-item' : ''}><ZapOff size={16} /> Low Bandwidth</li>
                    <li onClick={() => handlePresetSelect('medium')} className={preset === 'medium' ? 'active-item' : ''}><WifiOff size={16} /> Balanced</li>
                    <li onClick={() => handlePresetSelect('high')} className={preset === 'high' ? 'active-item' : ''}><Wifi size={16} /> High Quality</li>
                    <li onClick={() => handlePresetSelect('audio-only')} className={preset === 'audio-only' ? 'active-item' : ''}><Volume2 size={16} /> Audio Only</li>
                  </ul>
                </div>

                <button id="btn-stats" className="meet-btn" title="Call Statistics" onClick={() => setShowStatsModal(true)}>
                  <Activity size={18} />
                </button>
                
                <button id="btn-toggle-chat" className={`meet-btn ${isChatOpen ? 'active' : ''}`} title="Meeting Chat" onClick={() => { setIsChatOpen(prev => !prev); setUnreadChat(false); }}>
                  <MessageSquare size={18} />
                  {unreadChat && <span className="chat-badge"></span>}
                </button>
                
                <button id="btn-leave" className="meet-btn leave-call-btn" title="Leave Call" onClick={handleLeaveCall}>
                  <PhoneOff size={18} />
                </button>
              </div>
            </div>

            {/* Chat side panel */}
            {isChatOpen && (
              <aside id="chat-sidebar" className="meet-chat-sidebar">
                <div className="chat-header">
                  <h3>Meeting Chat</h3>
                  <button id="btn-close-chat" className="chat-close-btn" onClick={() => setIsChatOpen(false)}><X size={18} /></button>
                </div>
                
                <div className="chat-messages" id="chat-messages">
                  <div className="system-message">Chat messages are visible to everyone in the call. Swap to "Audio Only" if your video lag is high.</div>
                  {messages.map((msg, i) => (
                    <div key={i} className="chat-message-row">
                      <span className="chat-sender">{msg.username}</span>
                      <span className="chat-time">{msg.timestamp}</span>
                      <p className="chat-text">{msg.text}</p>
                    </div>
                  ))}
                </div>

                <form id="chat-form" className="chat-form-area" onSubmit={handleSendMessage}>
                  <input
                    type="text"
                    id="chat-input"
                    placeholder="Send a message..."
                    required
                    autoComplete="off"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button type="submit" className="chat-send-btn"><Send size={14} /></button>
                </form>
              </aside>
            )}

          </div>
        </main>
      )}

      {/* STATISTICS MODAL */}
      {showStatsModal && (
        <div id="stats-modal" className="modal-overlay" onClick={() => setShowStatsModal(false)}>
          <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Activity className="icon-inline" size={18} /> Call Diagnostics</h2>
              <button id="close-stats-btn" className="icon-btn" onClick={() => setShowStatsModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="stats-cards-grid">
                <div className="stat-card glass-dark">
                  <span className="stat-label">RTT (Latency)</span>
                  <span className="stat-value" id="stat-rtt">
                    {peersList.length > 0 && peersList[0].stats?.rtt ? `${peersList[0].stats.rtt} ms` : '-- ms'}
                  </span>
                </div>
                <div className="stat-card glass-dark">
                  <span className="stat-label">Loss Rate</span>
                  <span className="stat-value" id="stat-loss">
                    {peersList.length > 0 && peersList[0].stats?.packetLoss ? `${peersList[0].stats.packetLoss} %` : '-- %'}
                  </span>
                </div>
                <div className="stat-card glass-dark">
                  <span className="stat-label">IP Address</span>
                  <span className="stat-value" id="stat-ip" style={{ fontSize: '0.85rem' }}>
                    {peersList.length > 0 && peersList[0].stats?.remoteIp ? peersList[0].stats.remoteIp : 'Connecting...'}
                  </span>
                </div>
              </div>

              <div className="peers-stats-list">
                <h3>Active Peer Feeds</h3>
                <div id="peers-stats-container">
                  {peersList.length === 0 ? (
                    <p className="no-peers-msg">No remote participants connected.</p>
                  ) : (
                    peersList.map(peer => (
                      <div key={peer.socketId} className="peer-stat-row">
                        <div className="peer-stat-info">
                          <span className="peer-stat-name">{peer.username}</span>
                          <span className="peer-stat-metrics">{peer.stats?.remoteIp || 'Locating...'}</span>
                        </div>
                        <div className="peer-stat-values" style={{ fontSize: '0.8rem', color: 'var(--meet-text-secondary)' }}>
                          {peer.stats?.resolution && `Res: ${peer.stats.resolution}`}
                          {peer.stats?.bitrate !== undefined && ` | Speed: ${peer.stats.bitrate} kbps`}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE MEETING POPUP */}
      {generatedLink && (
        <div id="create-meeting-modal" className="modal-overlay" onClick={() => setGeneratedLink('')}>
          <div className="modal-content glass shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Here is the link to your meeting</h2>
              <button id="close-create-modal-btn" className="icon-btn" onClick={() => setGeneratedLink('')}><X size={18} /></button>
            </div>
            <div className="modal-body text-center">
              <p className="modal-desc">Copy this link and send it to people you want to meet with. Be sure to save it so you can use it later.</p>
              <div className="link-display-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', padding: '10px 16px', borderRadius: '8px' }}>
                <span id="generated-meeting-link">{generatedLink}</span>
                <button id="copy-generated-link-btn" className="icon-btn-accent" title="Copy Link" onClick={() => handleCopyLink(generatedLink)}>
                  <Copy size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Notification */}
      {toast && (
        <div id="toast" className={`toast ${toast.isError ? 'error-toast' : ''}`}>
          <span id="toast-message">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
