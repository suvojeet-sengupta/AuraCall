// AuraCall - Client Side Application Logic
const socket = io();

// Pipe browser errors to server logs for remote debugging
window.addEventListener('error', (event) => {
  try {
    socket.emit('client-error', {
      message: event.message,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error ? event.error.stack : null
    });
  } catch (e) {
    console.warn("Failed to send error details:", e);
  }
});

// Pipe unhandled promise rejections to server logs
window.addEventListener('unhandledrejection', (event) => {
  try {
    socket.emit('client-error', {
      message: event.reason ? event.reason.message || String(event.reason) : 'Unhandled Rejection',
      stack: event.reason && event.reason.stack ? event.reason.stack : null
    });
  } catch (e) {
    console.warn("Failed to send rejection details:", e);
  }
});

// Application State
let localStream = null;
let screenStream = null;
let currentPreset = 'low'; // Default to low bandwidth
let username = '';
let roomId = '';
let isMuted = false;
let isCamOff = false;
let isScreenSharing = false;

// Advanced Features State
let isHandRaised = false;
let isCaptionsOn = false;
let currentFilter = 'none';

// Peer Connections Store
// Structure: { [socketId]: { socketId, username, pc, stream, statsInterval, statsData: {} } }
const peers = {};

// Device constraints configuration based on presets
const PRESET_CONSTRAINTS = {
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

// WebRTC ICE Servers Configuration (Google public STUN servers for NAT traversal)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

// DOM Elements - Home Screen
const homeScreen = document.getElementById('home-screen');
const homeJoinForm = document.getElementById('home-join-form');
const homeRoomInput = document.getElementById('home-room-input');
const homeJoinBtn = document.getElementById('home-join-btn');
const newMeetingBtn = document.getElementById('new-meeting-btn');
const newMeetingDropdown = document.getElementById('new-meeting-dropdown');
const optCreateLater = document.getElementById('opt-create-later');
const optStartInstant = document.getElementById('opt-start-instant');
const createMeetingModal = document.getElementById('create-meeting-modal');
const closeCreateModalBtn = document.getElementById('close-create-modal-btn');
const generatedMeetingLink = document.getElementById('generated-meeting-link');
const copyGeneratedLinkBtn = document.getElementById('copy-generated-link-btn');
const currentTimeDisplay = document.getElementById('current-time-display');

// DOM Elements - Lobby Screen
const lobbyScreen = document.getElementById('lobby-screen');
const lobbyRoomDisplay = document.getElementById('lobby-room-display');
const lobbyBackToHome = document.getElementById('lobby-back-to-home');
const joinForm = document.getElementById('join-form');
const usernameInput = document.getElementById('username');
const micSelect = document.getElementById('mic-select');
const camSelect = document.getElementById('cam-select');
const localPreview = document.getElementById('local-preview');
const previewPlaceholder = document.getElementById('preview-placeholder');
const previewToggleMicBtn = document.getElementById('preview-toggle-mic');
const previewToggleCamBtn = document.getElementById('preview-toggle-cam');
const previewBtnFilters = document.getElementById('preview-btn-filters');
const previewFiltersMenu = document.getElementById('preview-filters-menu');
const previewFilterOverlay = document.getElementById('preview-filter-overlay');

// DOM Elements - Call Screen
const callScreen = document.getElementById('call-screen');
const currentRoomName = document.getElementById('current-room-name');
const copyRoomLink = document.getElementById('copy-room-link');
const activePresetLabel = document.getElementById('active-preset-label');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');
const videoCardLocal = document.getElementById('video-card-local');
const localMicIndicator = document.getElementById('local-mic-indicator');
const localStatsTag = document.getElementById('local-stats-tag');

// DOM Elements - Footer Controls
const btnToggleMic = document.getElementById('btn-toggle-mic');
const btnToggleCam = document.getElementById('btn-toggle-cam');
const btnShareScreen = document.getElementById('btn-share-screen');
const btnRaiseHand = document.getElementById('btn-raise-hand');
const btnToggleCaptions = document.getElementById('btn-toggle-captions');
const btnReactionsTrigger = document.getElementById('btn-reactions-trigger');
const reactionsPalette = document.getElementById('reactions-palette');
const btnFiltersTrigger = document.getElementById('btn-filters-trigger');
const filtersMenu = document.getElementById('filters-menu');
const btnPresetTrigger = document.getElementById('btn-preset-trigger');
const activeDropdownLabel = document.getElementById('active-dropdown-label');
const presetDropdown = document.getElementById('preset-dropdown');
const btnStats = document.getElementById('btn-stats');
const btnToggleChat = document.getElementById('btn-toggle-chat');
const chatBadge = document.querySelector('.chat-badge');
const btnLeave = document.getElementById('btn-leave');

// DOM Elements - Chat Sidebar
const chatSidebar = document.getElementById('chat-sidebar');
const btnCloseChat = document.getElementById('btn-close-chat');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// DOM Elements - Stats Modal
const statsModal = document.getElementById('stats-modal');
const closeStatsBtn = document.getElementById('close-stats-btn');
const statRtt = document.getElementById('stat-rtt');
const statLoss = document.getElementById('stat-loss');
const statIp = document.getElementById('stat-ip');
const peersStatsContainer = document.getElementById('peers-stats-container');

// DOM Elements - Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Carousel Elements
const carouselPrev = document.getElementById('carousel-prev');
const carouselNext = document.getElementById('carousel-next');
const slides = document.querySelectorAll('.carousel-slide');
const dots = document.querySelectorAll('.carousel-dots .dot');
let currentSlideIndex = 0;
let carouselInterval = null;

// Audio Context Variables for Volume Level checking
let micVolumeInterval = null;
let micAnalyser = null;
let micAudioContext = null;
let micSource = null;

// Speech Recognition Variable
let speechRecognition = null;
let captionTimeout = null;

// Initialize App
async function init() {
  // Check for HTTPS / Secure Context (WebRTC requirement on public domains)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const secureAlert = document.getElementById('secure-context-alert');
    if (secureAlert) secureAlert.classList.remove('hidden');
    console.error("Secure Context (HTTPS) is required for camera/microphone access on remote hosts.");
    showToast("HTTPS is required for Camera/Mic access.", true);
  }

  setupDeviceSelection();
  setupEventListeners();
  setupSpeechRecognition();
  
  // Date & Time logic
  updateHomeTime();
  setInterval(updateHomeTime, 30000); // update every 30s
  
  // Carousel Auto rotation
  startCarouselTimer();
  
  // Check browser URL path for instant SPA joins
  checkUrlAndLoadScreen();
}

// -------------------------------------------------------------
// EVENT LISTENERS & SETUP
// -------------------------------------------------------------
function setupEventListeners() {
  // --- HOME SCREEN ACTIONS ---

  // New Meeting Button Dropdown Toggle
  newMeetingBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    newMeetingDropdown.classList.toggle('hidden');
  });

  // Create Meeting for Later
  optCreateLater.addEventListener('click', (e) => {
    e.stopPropagation();
    newMeetingDropdown.classList.add('hidden');
    const randomCode = generateRandomRoomCode();
    const meetingLink = `${window.location.origin}/${randomCode}`;
    generatedMeetingLink.innerText = meetingLink;
    createMeetingModal.classList.remove('hidden');
  });

  // Start Instant Meeting
  optStartInstant.addEventListener('click', (e) => {
    e.stopPropagation();
    newMeetingDropdown.classList.add('hidden');
    const randomCode = generateRandomRoomCode();
    navigateToRoom(randomCode);
  });

  // Close Create Modal
  closeCreateModalBtn.addEventListener('click', () => {
    createMeetingModal.classList.add('hidden');
  });

  // Copy Generated Meeting Link
  copyGeneratedLinkBtn.addEventListener('click', () => {
    const link = generatedMeetingLink.innerText;
    navigator.clipboard.writeText(link).then(() => {
      showToast('Meeting link copied!');
      createMeetingModal.classList.add('hidden');
    }).catch(err => {
      console.error('Could not copy link:', err);
    });
  });

  // Input Field validation on Home page (Google Meet style)
  homeRoomInput.addEventListener('input', () => {
    const val = homeRoomInput.value.trim();
    homeJoinBtn.disabled = val.length === 0;
  });

  // Home Page Join Form Submit
  homeJoinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const inputVal = homeRoomInput.value.trim();
    if (!inputVal) return;
    
    // Parse room code (supports pasting full links like http://localhost:3000/abc-defg-hij or just abc-defg-hij)
    const code = extractRoomCode(inputVal);
    if (code) {
      navigateToRoom(code);
    } else {
      showToast('Invalid meeting link or code.', true);
    }
  });

  // Back to Home screen from Lobby Screen
  lobbyBackToHome.addEventListener('click', () => {
    navigateToRoom('');
  });

  // --- LOBBY WAITING SCREEN ACTIONS ---

  // Lobby Preview buttons
  previewToggleMicBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    toggleButtonState(previewToggleMicBtn, !isMuted);
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    }
  });

  previewToggleCamBtn.addEventListener('click', async () => {
    isCamOff = !isCamOff;
    toggleButtonState(previewToggleCamBtn, !isCamOff);
    
    if (isCamOff) {
      if (localStream) {
        localStream.getVideoTracks().forEach(track => {
          track.enabled = false;
          track.stop();
        });
      }
      localPreview.srcObject = null;
      previewPlaceholder.classList.remove('hidden');
    } else {
      await getLocalPreviewStream();
      startMicLevelMeter();
    }
  });

  // Lobby Preview Video Filter Menu Trigger
  previewBtnFilters.addEventListener('click', (e) => {
    e.stopPropagation();
    previewFiltersMenu.classList.toggle('hidden');
  });

  // Preview Filters Menu Option Clicks
  previewFiltersMenu.querySelectorAll('li').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const filter = item.getAttribute('data-filter');
      
      // Update UI classes
      previewFiltersMenu.querySelectorAll('li').forEach(li => li.classList.remove('active-item'));
      item.classList.add('active-item');
      previewFiltersMenu.classList.add('hidden');
      
      applyFilterToVideo(localPreview, previewFilterOverlay, filter);
      currentFilter = filter;
    });
  });

  // Device selections change
  micSelect.addEventListener('change', async () => {
    await getLocalPreviewStream();
    startMicLevelMeter();
  });
  camSelect.addEventListener('change', async () => {
    await getLocalPreviewStream();
    startMicLevelMeter();
  });

  // Lobby Join Form Submit (Triggers call screen)
  joinForm.addEventListener('submit', handleJoinSubmit);

  // --- IN-CALL BUTTON CONTROLS ---
  
  btnToggleMic.addEventListener('click', handleToggleMic);
  btnToggleCam.addEventListener('click', handleToggleCam);
  btnShareScreen.addEventListener('click', handleToggleScreenShare);
  btnRaiseHand.addEventListener('click', handleToggleRaiseHand);
  btnToggleCaptions.addEventListener('click', handleToggleCaptions);
  btnLeave.addEventListener('click', leaveCall);

  // Emoji Reactions Palette Trigger
  btnReactionsTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    reactionsPalette.classList.toggle('hidden');
  });

  // Send Emoji Reaction Click
  reactionsPalette.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.getAttribute('data-emoji');
      reactionsPalette.classList.add('hidden');
      
      showFloatingEmoji(socket.id, emoji);
      socket.emit('send-reaction', emoji);
    });
  });

  // Video Call Filters Menu Trigger
  btnFiltersTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    filtersMenu.classList.toggle('hidden');
  });

  // Call Filters Menu Option Clicks
  filtersMenu.querySelectorAll('li').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const filter = item.getAttribute('data-filter');
      
      filtersMenu.querySelectorAll('li').forEach(li => li.classList.remove('active-item'));
      item.classList.add('active-item');
      filtersMenu.classList.add('hidden');
      
      applyLocalCallFilter(filter);
    });
  });

  // Preset Selector Dropdown
  btnPresetTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    presetDropdown.classList.toggle('hidden');
  });

  // Copy Invite Link in call
  copyRoomLink.addEventListener('click', () => {
    const inviteUrl = `${window.location.origin}/${roomId}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('Invite link copied to clipboard!');
    }).catch(err => {
      console.error('Could not copy invite link: ', err);
    });
  });

  // Stats Modal triggers
  btnStats.addEventListener('click', () => {
    statsModal.classList.remove('hidden');
    updateStatsModalContent();
  });
  closeStatsBtn.addEventListener('click', () => statsModal.classList.add('hidden'));
  statsModal.addEventListener('click', (e) => {
    if (e.target === statsModal) statsModal.classList.add('hidden');
  });

  // Chat Panel Toggle
  btnToggleChat.addEventListener('click', () => {
    chatSidebar.classList.toggle('hidden');
    btnToggleChat.classList.toggle('active-state');
    
    // Reset notification badge
    if (!chatSidebar.classList.contains('hidden')) {
      chatBadge.classList.add('hidden');
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  });

  btnCloseChat.addEventListener('click', () => {
    chatSidebar.classList.add('hidden');
    btnToggleChat.classList.remove('active-state');
  });

  // Send Chat message
  chatForm.addEventListener('submit', handleSendChatMessage);

  // --- CAROUSEL SLIDE ACTIONS ---
  carouselPrev.addEventListener('click', () => {
    resetCarouselTimer();
    showPreviousSlide();
  });

  carouselNext.addEventListener('click', () => {
    resetCarouselTimer();
    showNextSlide();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      resetCarouselTimer();
      goToSlide(index);
    });
  });

  // Global document click to close dropdown menus
  document.addEventListener('click', () => {
    newMeetingDropdown.classList.add('hidden');
    previewFiltersMenu.classList.add('hidden');
    reactionsPalette.classList.add('hidden');
    filtersMenu.classList.add('hidden');
    presetDropdown.classList.add('hidden');
  });

  // Preset switch bindings
  presetDropdown.querySelectorAll('li').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const presetVal = item.getAttribute('data-preset-val');
      
      presetDropdown.querySelectorAll('li').forEach(li => li.classList.remove('active-item'));
      item.classList.add('active-item');
      presetDropdown.classList.add('hidden');
      
      changeQualityPreset(presetVal);
    });
  });
}

// -------------------------------------------------------------
// HARDWARE DEVICE ACQUISITION & PREVIEW
// -------------------------------------------------------------
async function setupDeviceSelection() {
  try {
    // Request permission first to list device details
    await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    micSelect.innerHTML = '';
    camSelect.innerHTML = '';
    
    let audioCount = 1;
    let videoCount = 1;

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      
      if (device.kind === 'audioinput') {
        option.text = device.label || `Microphone ${audioCount++}`;
        micSelect.appendChild(option);
      } else if (device.kind === 'videoinput') {
        option.text = device.label || `Camera ${videoCount++}`;
        camSelect.appendChild(option);
      }
    });
  } catch (err) {
    console.error('Error fetching device list:', err);
    showToast('Failed to access camera/mic permission.', true);
  }
}

async function getLocalPreviewStream() {
  if (isCamOff && localStream) {
    return;
  }

  // Stop previous local preview streams
  stopStreamTracks(localStream);

  const constraints = {
    audio: { deviceId: micSelect.value ? { exact: micSelect.value } : undefined },
    video: {
      deviceId: camSelect.value ? { exact: camSelect.value } : undefined,
      width: { ideal: 640 },
      height: { ideal: 480 }
    }
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localPreview.srcObject = localStream;
    previewPlaceholder.classList.add('hidden');
    
    // Apply initial mute states
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
  } catch (err) {
    console.error('Error opening media device preview:', err);
    previewPlaceholder.classList.remove('hidden');
  }
}

// -------------------------------------------------------------
// SIGNALING SERVER INTEGRATION (SOCKET.IO)
// -------------------------------------------------------------
function registerSocketEvents() {
  // Listen for existing room members
  socket.on('room-users', async ({ roomId: joinedRoomId, users: existingPeers }) => {
    roomId = joinedRoomId;
    console.log(`Joined room ${roomId} with peers:`, existingPeers);
    showToast(`Joined Room: ${roomId}`);
    playAudioFeedback('join');
    
    // Connect to each peer already in the room
    for (const peer of existingPeers) {
      await initiatePeerConnection(peer.socketId, peer.username, true, peer.mediaState);
    }
  });

  // Listen for new users joining our room
  socket.on('user-joined', async ({ socketId, username: peerName, mediaState }) => {
    console.log(`User joined: ${peerName} (${socketId}) with mediaState:`, mediaState);
    showToast(`${peerName} joined the room`);
    playAudioFeedback('join');
    
    // Initialize WebRTC connection, but don't start the offer.
    // In our mesh signaling model, the client joining makes the offer to existing peers.
    // So here, we just create the RTCPeerConnection and wait for their offer.
    await initiatePeerConnection(socketId, peerName, false, mediaState);
  });

  // Listen for remote media toggles via websockets
  socket.on('peer-media-toggled', ({ socketId, type, enabled }) => {
    const peer = peers[socketId];
    if (!peer) return;

    if (!peer.mediaState) {
      peer.mediaState = { audio: true, video: true, screen: false };
    }
    
    peer.mediaState[type] = enabled;
    
    const card = document.getElementById(`video-card-${socketId}`);
    if (!card) return;

    if (type === 'audio') {
      const micIndicator = card.querySelector(`#mic-indicator-${socketId}`);
      if (micIndicator) {
        micIndicator.classList.toggle('hidden', enabled);
      }
    } else if (type === 'video') {
      const placeholder = card.querySelector('.video-placeholder');
      if (placeholder) {
        placeholder.classList.toggle('hidden', enabled);
      }
      const video = card.querySelector('video');
      if (video) {
        video.style.opacity = enabled ? '1' : '0';
      }
    } else if (type === 'screen') {
      const peerNameEl = card.querySelector('.peer-name');
      if (peerNameEl) {
        peerNameEl.innerText = enabled ? `${peer.username} (Screen)` : peer.username;
      }
    }
  });

  // Handle incoming WebRTC signaling data
  socket.on('signal', async ({ senderSocketId, senderUsername, signalData }) => {
    const peer = peers[senderSocketId];
    if (!peer) return;

    const { sdp, candidate } = signalData;

    try {
      if (sdp) {
        console.log(`Received ${sdp.type} signal from ${senderUsername}`);
        
        // Munge remote SDP before setting (redundancy check for bandwidth restrictions)
        if (sdp.type === 'offer') {
          // If we receive an offer, set remote desc, then create/send answer
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          
          // Process queued ICE candidates now that remote description is set
          if (peer.iceQueue && peer.iceQueue.length > 0) {
            console.log(`Processing ${peer.iceQueue.length} queued ICE candidates for ${senderUsername}`);
            for (const cand of peer.iceQueue) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn("Failed to add queued candidate:", e));
            }
            peer.iceQueue = [];
          }
          
          const answer = await peer.pc.createAnswer();
          
          // Munge local answer SDP to restrict bandwidth
          const mungedAnswerSdp = mungeLocalSDP(answer.sdp, currentPreset);
          const mungedAnswer = { type: 'answer', sdp: mungedAnswerSdp };
          
          await peer.pc.setLocalDescription(mungedAnswer);
          
          // Update RTCRtpSender settings for connection
          await updateSenderBitrates(peer.pc, currentPreset);

          socket.emit('signal', {
            targetSocketId: senderSocketId,
            signalData: { sdp: mungedAnswer }
          });
        } else if (sdp.type === 'answer') {
          // If we receive an answer, just set it
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          
          // Process queued ICE candidates now that remote description is set
          if (peer.iceQueue && peer.iceQueue.length > 0) {
            console.log(`Processing ${peer.iceQueue.length} queued ICE candidates for ${senderUsername}`);
            for (const cand of peer.iceQueue) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn("Failed to add queued candidate:", e));
            }
            peer.iceQueue = [];
          }

          // Update RTCRtpSender parameters
          await updateSenderBitrates(peer.pc, currentPreset);
        }
      } else if (candidate) {
        // Handle incoming ICE candidate
        console.log(`Received ICE candidate from ${senderUsername}`);
        
        // Queue candidates if remote description is not set yet to avoid WebRTC exceptions
        if (!peer.pc.remoteDescription || !peer.pc.remoteDescription.type) {
          if (!peer.iceQueue) peer.iceQueue = [];
          peer.iceQueue.push(candidate);
          console.log(`Queued ICE candidate from ${senderUsername} (Remote description not set yet)`);
        } else {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn("Failed to add candidate:", e));
        }
      }
    } catch (err) {
      console.error(`Signaling error from peer ${senderUsername}:`, err);
    }
  });

  // Listen for peer disconnection
  socket.on('user-left', ({ socketId, username: peerName }) => {
    console.log(`User left: ${peerName} (${socketId})`);
    showToast(`${peerName} left the room`);
    playAudioFeedback('leave');
    cleanupPeerConnection(socketId);
  });

  // Handle text message receipt
  socket.on('receive-message', ({ senderSocketId, senderUsername, text, timestamp }) => {
    appendChatMessage(senderUsername, text, senderSocketId === socket.id, timestamp);
    playAudioFeedback('message');
    
    // Show indicator if chat is closed
    if (chatSidebar.classList.contains('hidden')) {
      chatBadge.classList.remove('hidden');
    }
  });

  // Handle peer reactions
  socket.on('peer-reaction', ({ socketId, emoji }) => {
    showFloatingEmoji(socketId, emoji);
  });

  // Handle peer captions subtitles
  socket.on('peer-caption', ({ socketId, text }) => {
    const subtitleEl = document.getElementById(`subtitle-${socketId}`);
    if (!subtitleEl) return;
    subtitleEl.innerText = text;
    subtitleEl.classList.remove('hidden');
    
    if (peers[socketId]) {
      clearTimeout(peers[socketId].captionTimeout);
      peers[socketId].captionTimeout = setTimeout(() => {
        subtitleEl.classList.add('hidden');
      }, 4000);
    }
  });

  // Handle peer hand raise
  socket.on('peer-raised-hand', ({ socketId, isRaised }) => {
    const card = document.getElementById(`video-card-${socketId}`);
    if (!card) return;
    
    const handIndicator = card.querySelector(`#hand-indicator-${socketId}`);
    if (handIndicator) {
      handIndicator.classList.toggle('hidden', !isRaised);
    }
    
    if (isRaised) {
      const peer = peers[socketId];
      showToast(`${peer ? peer.username : 'A participant'} raised their hand ✋`);
      playAudioFeedback('hand');
    }
  });

  // Handle peer filter change
  socket.on('peer-filter-changed', ({ socketId, filterClass }) => {
    const card = document.getElementById(`video-card-${socketId}`);
    if (!card) return;
    
    const video = card.querySelector('video');
    const overlay = card.querySelector('.filter-overlay-effect') || card.querySelector('.video-placeholder');
    
    // Remove all previous filters
    const filterClasses = ['filter-blur', 'filter-grayscale', 'filter-sepia', 'filter-warm', 'filter-invert'];
    filterClasses.forEach(c => {
      video.classList.remove(c);
      if (overlay) overlay.classList.remove(c);
    });
    
    if (filterClass && filterClass !== 'none') {
      video.classList.add(`filter-${filterClass}`);
      if (overlay) overlay.classList.add(`filter-${filterClass}`);
    }
  });

  // Error handles
  socket.on('error-message', (err) => {
    showToast(err, true);
    leaveCall();
  });
}

// -------------------------------------------------------------
// WEBRTC CONNECTION CYCLE
// -------------------------------------------------------------
async function initiatePeerConnection(targetSocketId, peerUsername, createOffer = false, initialMediaState = null) {
  console.log(`Initiating WebRTC connection to ${peerUsername} (${targetSocketId}), createOffer=${createOffer}`);

  const pc = new RTCPeerConnection(rtcConfig);

  // Create state track
  peers[targetSocketId] = {
    socketId: targetSocketId,
    username: peerUsername,
    pc,
    stream: null,
    videoElement: null,
    statsData: {},
    mediaState: initialMediaState || { audio: true, video: true, screen: false },
    iceQueue: [] // Queue to buffer remote candidates during setup
  };

  // 1. Add our active stream tracks to the connection
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // 2. Handle remote stream tracks arriving
  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    peers[targetSocketId].stream = remoteStream;
    
    // Add remote video element to grid if not exists
    createRemoteVideoCard(targetSocketId, peerUsername, remoteStream, peers[targetSocketId].mediaState);
  };

  // 3. Coordinate ICE Candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        targetSocketId,
        signalData: { candidate: event.candidate }
      });
    }
  };

  // 4. Peer Connection State monitoring
  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${peerUsername}: ${pc.connectionState}`);
    
    const card = document.getElementById(`video-card-${targetSocketId}`);
    const badge = card ? card.querySelector('.quality-badge') : null;
    
    if (pc.connectionState === 'connecting') {
      if (badge) badge.innerText = 'Connecting...';
    } else if (pc.connectionState === 'connected') {
      if (badge) badge.innerText = 'Connected';
    } else if (pc.connectionState === 'disconnected') {
      if (badge) badge.innerText = 'Disconnected';
      
      // Let it try to reconnect naturally for 5 seconds before removing
      setTimeout(() => {
        const currentPeer = peers[targetSocketId];
        if (currentPeer && (currentPeer.pc.connectionState === 'disconnected' || currentPeer.pc.connectionState === 'failed')) {
          cleanupPeerConnection(targetSocketId);
        }
      }, 5000);
    } else if (pc.connectionState === 'failed') {
      if (badge) badge.innerText = 'Failed';
      showToast(`Connection to ${peerUsername} failed. Reconnecting...`);
      attemptReconnect(targetSocketId);
    }
  };

  // Helper to re-establish connection dynamically
  async function attemptReconnect(socketId) {
    const peer = peers[socketId];
    if (!peer) return;

    console.log(`Attempting dynamic WebRTC reconnection to ${peer.username} (${socketId})`);
    
    try {
      peer.pc.close();
    } catch (e) {}

    // Deterministic tiebreaker (who makes the offer) to avoid collisions during double reconnects
    const isInitiator = socket.id < socketId;
    await initiatePeerConnection(socketId, peer.username, isInitiator, peer.mediaState);
  }

  // 5. If chosen initiator, negotiate offer
  if (createOffer) {
    try {
      const offer = await pc.createOffer();
      
      // Munge local offer SDP to cap bitrates
      const mungedOfferSdp = mungeLocalSDP(offer.sdp, currentPreset);
      const mungedOffer = { type: 'offer', sdp: mungedOfferSdp };
      
      await pc.setLocalDescription(mungedOffer);
      
      socket.emit('signal', {
        targetSocketId,
        signalData: { sdp: mungedOffer }
      });
    } catch (err) {
      console.error(`Failed to generate offer for ${peerUsername}:`, err);
    }
  }

  // Start polling connection quality stats for this peer
  startMonitoringStats(targetSocketId);
}

function cleanupPeerConnection(socketId) {
  const peer = peers[socketId];
  if (!peer) return;

  console.log(`Cleaning up connection with ${peer.username} (${socketId})`);

  // Cancel stats intervals
  if (peer.statsInterval) {
    clearInterval(peer.statsInterval);
  }

  // Close RTC peer
  try {
    peer.pc.close();
  } catch (err) {
    console.warn(err);
  }

  // Remove video card from UI
  const peerCard = document.getElementById(`video-card-${socketId}`);
  if (peerCard) {
    peerCard.remove();
  }

  delete peers[socketId];
  recalculateVideoGridLayout();
}

// -------------------------------------------------------------
// ADAPTIVE BANDWIDTH OPTIMIZATION (SDP & SENDER PARAMS)
// -------------------------------------------------------------

// SDP Munging function
function mungeLocalSDP(sdp, preset) {
  let videoKbps = 150;
  let audioKbps = 20;

  if (preset === 'medium') {
    videoKbps = 500;
    audioKbps = 32;
  } else if (preset === 'high') {
    videoKbps = 1500;
    audioKbps = 64;
  } else if (preset === 'audio-only') {
    videoKbps = 1; // Limit video payload to almost nothing
    audioKbps = 16;
  }

  let lines = sdp.split('\r\n');
  let munged = [];
  let inVideoBlock = false;
  let inAudioBlock = false;

  for (let line of lines) {
    if (line.startsWith('m=audio')) {
      inAudioBlock = true;
      inVideoBlock = false;
      munged.push(line);
      
      // Inject audio bandwith limits
      munged.push(`b=AS:${audioKbps}`);
      munged.push(`b=TIAS:${audioKbps * 1000}`);
      continue;
    }
    
    if (line.startsWith('m=video')) {
      inVideoBlock = true;
      inAudioBlock = false;
      munged.push(line);
      
      // Inject video bandwidth limits
      munged.push(`b=AS:${videoKbps}`);
      munged.push(`b=TIAS:${videoKbps * 1000}`);
      continue;
    }

    // Skip existing bandwidth markers within specific media blocks so we don't duplicate
    if (line.startsWith('b=AS:') || line.startsWith('b=TIAS:')) {
      if (inAudioBlock || inVideoBlock) continue;
    }

    // Adjust Opus codec settings inside SDP fmtp attribute
    if (inAudioBlock && line.startsWith('a=fmtp:')) {
      if (line.includes('maxaveragebitrate=')) {
        line = line.replace(/maxaveragebitrate=\d+/, `maxaveragebitrate=${audioKbps * 1000}`);
      } else {
        // Appending maxaveragebitrate attribute
        line = line + `;maxaveragebitrate=${audioKbps * 1000}`;
      }
      
      // Force stereo off and enable FEC/DRED inside Opus configurations for low internet robust audio
      if (!line.includes('useinbandfec=1')) {
        line = line + ';useinbandfec=1';
      }
    }

    munged.push(line);
  }

  return munged.join('\r\n');
}

// RTCRtpSender Dynamic Parameter Configuration
async function updateSenderBitrates(pc, preset) {
  let videoMaxBps = 150000; // Low preset: 150 kbps
  let audioMaxBps = 20000;

  if (preset === 'medium') {
    videoMaxBps = 500000;  // 500 kbps
    audioMaxBps = 32000;
  } else if (preset === 'high') {
    videoMaxBps = 1500000; // 1.5 Mbps
    audioMaxBps = 64000;
  } else if (preset === 'audio-only') {
    videoMaxBps = 1;       // Almost zero bandwidth
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
        
        // Also add scaleResolutionDownBy on low preset to force camera sensor scaling down
        if (preset === 'low') {
          params.encodings[0].scaleResolutionDownBy = 2.0; // Scale resolution down to 1/2 height/width
        } else {
          params.encodings[0].scaleResolutionDownBy = 1.0;
        }

        await sender.setParameters(params);
        console.log(`RTP Video Sender bitrate configured to ${videoMaxBps} bps`);
      } else if (sender.track.kind === 'audio') {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = audioMaxBps;
        await sender.setParameters(params);
        console.log(`RTP Audio Sender bitrate configured to ${audioMaxBps} bps`);
      }
    }
  } catch (err) {
    console.warn('Failed to update RTCRtpSender parameters:', err);
  }
}

// Dynamic Preset change handler
async function changeQualityPreset(preset) {
  if (preset === currentPreset) return;
  console.log(`Changing connection preset to: ${preset}`);
  currentPreset = preset;

  // 1. Update UI Labels
  const presetLabels = {
    low: 'Low Bandwidth Mode',
    medium: 'Balanced Mode',
    high: 'High Quality Mode',
    'audio-only': 'Audio Only Mode'
  };
  
  activePresetLabel.innerText = presetLabels[preset];
  activeDropdownLabel.innerText = itemTitleForPreset(preset);

  // 2. Adjust local media tracks according to the preset
  if (localStream) {
    const constraints = PRESET_CONSTRAINTS[preset];
    
    // Video Track modifications
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      if (preset === 'audio-only') {
        videoTrack.enabled = false;
        videoTrack.stop();
        videoCardLocal.querySelector('.video-placeholder').classList.remove('hidden');
        localStatsTag.innerText = 'Audio Only';
        socket.emit('toggle-media', { type: 'video', enabled: false });
      } else {
        // Re-enable/request camera if it was stopped by audio-only
        if (videoTrack.readyState === 'ended' || isCamOff) {
          await rebuildLocalStream();
        } else {
          try {
            await videoTrack.applyConstraints(constraints.video);
            videoCardLocal.querySelector('.video-placeholder').classList.add('hidden');
            videoTrack.enabled = !isCamOff;
            localStatsTag.innerText = preset.toUpperCase();
            socket.emit('toggle-media', { type: 'video', enabled: !isCamOff });
          } catch (e) {
            console.warn('Could not apply track constraints:', e);
          }
        }
      }
    } else if (preset !== 'audio-only' && !isCamOff) {
      // Re-trigger camera stream if no video track exists
      await rebuildLocalStream();
    }
  }

  // 3. Renegotiate or update all active RTC peer senders on-the-fly
  for (const socketId in peers) {
    const peer = peers[socketId];
    await updateSenderBitrates(peer.pc, preset);
    
    // Trigger standard WebRTC renegotiation via WebRTC SDP modification
    try {
      const offer = await peer.pc.createOffer();
      const mungedOfferSdp = mungeLocalSDP(offer.sdp, preset);
      const mungedOffer = { type: 'offer', sdp: mungedOfferSdp };
      
      await peer.pc.setLocalDescription(mungedOffer);
      socket.emit('signal', {
        targetSocketId: socketId,
        signalData: { sdp: mungedOffer }
      });
    } catch (err) {
      console.warn(`Renegotiation failed for peer ${peer.username}:`, err);
    }
  }

  showToast(`Switched profile to: ${itemTitleForPreset(preset)}`);
}

// -------------------------------------------------------------
// CALL ACTION HANDLERS (JOIN, LEAVE, TOGGLES)
// -------------------------------------------------------------
async function handleJoinSubmit(e) {
  e.preventDefault();
  
  username = usernameInput.value.trim();
  
  // Fetch checked radio button value
  const presetRadio = document.querySelector('input[name="preset"]:checked');
  currentPreset = presetRadio ? presetRadio.value : 'low';

  if (!username || !roomId) return;

  // Configure transition buttons
  const joinBtn = document.getElementById('join-btn');
  joinBtn.disabled = true;
  joinBtn.innerText = 'Connecting...';

  try {
    // Stop mic check meter
    stopMicLevelMeter();

    // 1. Rebuild stream applying constraints of selected preset
    await rebuildLocalStream();
    
    // Apply local video filter if active
    if (currentFilter && currentFilter !== 'none') {
      applyFilterToVideo(localVideo, null, currentFilter);
    }
    
    // 2. Set up Local Video Screen Elements
    localVideo.srcObject = localStream;
    currentRoomName.innerText = roomId;
    
    const presetLabels = {
      low: 'Low Bandwidth Mode',
      medium: 'Balanced Mode',
      high: 'High Quality Mode',
      'audio-only': 'Audio Only Mode'
    };
    activePresetLabel.innerText = presetLabels[currentPreset];
    activeDropdownLabel.innerText = itemTitleForPreset(currentPreset);
    localStatsTag.innerText = currentPreset.toUpperCase();
    
    // Configure default audio mute states
    localMicIndicator.classList.toggle('hidden', !isMuted);
    toggleButtonState(btnToggleMic, !isMuted);
    toggleButtonState(btnToggleCam, !isCamOff);

    // Setup local subtitles container dynamically
    const localCard = document.getElementById('video-card-local');
    if (localCard && !document.getElementById('subtitle-local')) {
      const subDiv = document.createElement('div');
      subDiv.className = 'subtitle-overlay hidden';
      subDiv.id = 'subtitle-local';
      localCard.appendChild(subDiv);
    }

    // 3. Register Signaling Callbacks & Connect
    registerSocketEvents();
    socket.emit('join-room', { 
      roomId, 
      username,
      mediaState: {
        audio: !isMuted,
        video: !isCamOff && currentPreset !== 'audio-only',
        screen: isScreenSharing
      }
    });

    // Send local filter choice to signaling room if not none
    if (currentFilter && currentFilter !== 'none') {
      setTimeout(() => {
        socket.emit('change-filter', currentFilter);
      }, 1000);
    }

    // 4. Reveal Screen
    lobbyScreen.classList.add('hidden');
    callScreen.classList.remove('hidden');
    
    // Clean up lobby preview camera
    stopStreamTracks(localPreview.srcObject);
    localPreview.srcObject = null;
    
    recalculateVideoGridLayout();
  } catch (err) {
    console.error('Failed to join call:', err);
    showToast('Failed to access camera/mic hardware.', true);
    joinBtn.disabled = false;
    joinBtn.innerText = 'Join call';
  }
}

async function rebuildLocalStream() {
  stopStreamTracks(localStream);
  
  const selectedPresetConstraints = PRESET_CONSTRAINTS[currentPreset];
  const constraints = {
    audio: {
      deviceId: micSelect.value ? { exact: micSelect.value } : undefined,
      echoCancellation: true,
      noiseSuppression: true
    },
    video: false
  };

  if (currentPreset !== 'audio-only' && !isCamOff) {
    constraints.video = {
      deviceId: camSelect.value ? { exact: camSelect.value } : undefined,
      width: selectedPresetConstraints.video.width,
      height: selectedPresetConstraints.video.height,
      frameRate: selectedPresetConstraints.video.frameRate
    };
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn("Primary media acquisition failed, trying fallbacks:", err);
    
    if (constraints.video) {
      // Fallback 1: Try audio only if camera is blocked/unavailable
      showToast("Camera blocked or unavailable. Joining with microphone only.");
      isCamOff = true;
      constraints.video = false;
      
      try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (errAudioOnly) {
        console.warn("Audio-only fallback failed, trying device-free:", errAudioOnly);
        // Fallback 2: Join without any inputs (receive/listen only)
        showToast("Mic & Camera blocked. Joining as listen-only.");
        localStream = null;
      }
    } else {
      // If audio constraints failed directly (mic blocked/busy)
      showToast("Microphone blocked or busy. Joining as listen-only.");
      localStream = null;
    }
  }
  
  // Set enabled toggles on tracks
  if (localStream) {
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    if (constraints.video) {
      localStream.getVideoTracks().forEach(track => track.enabled = !isCamOff);
      videoCardLocal.querySelector('.video-placeholder').classList.add('hidden');
    } else {
      videoCardLocal.querySelector('.video-placeholder').classList.remove('hidden');
    }
  } else {
    // If no stream acquired (listen-only)
    videoCardLocal.querySelector('.video-placeholder').classList.remove('hidden');
  }

  // Update in-call video stream source
  if (callScreen.classList.contains('hidden') === false) {
    localVideo.srcObject = localStream;
    
    // Dynamically inject new track to active peers
    for (const socketId in peers) {
      const pc = peers[socketId].pc;
      const senders = pc.getSenders();
      
      const audioTrack = localStream && localStream.getAudioTracks().length > 0 ? localStream.getAudioTracks()[0] : null;
      const videoTrack = localStream && localStream.getVideoTracks().length > 0 ? localStream.getVideoTracks()[0] : null;

      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'audio' && audioTrack) {
          await sender.replaceTrack(audioTrack);
        } else if (sender.track && sender.track.kind === 'video' && videoTrack) {
          await sender.replaceTrack(videoTrack);
        }
      }
    }
  }
}

function handleToggleMic() {
  isMuted = !isMuted;
  toggleButtonState(btnToggleMic, !isMuted);
  
  if (localStream) {
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
  }
  
  localMicIndicator.classList.toggle('hidden', !isMuted);
  
  // Synchronize audio mute state via websocket
  socket.emit('toggle-media', { type: 'audio', enabled: !isMuted });
}

async function handleToggleCam() {
  isCamOff = !isCamOff;
  toggleButtonState(btnToggleCam, !isCamOff);

  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    
    if (isCamOff) {
      if (videoTrack) {
        videoTrack.enabled = false;
        videoTrack.stop();
      }
      localVideo.srcObject = null;
      videoCardLocal.querySelector('.video-placeholder').classList.remove('hidden');
    } else {
      await rebuildLocalStream();
      localVideo.srcObject = localStream;
    }
  }

  // Synchronize video state via websocket
  socket.emit('toggle-media', { type: 'video', enabled: !isCamOff && currentPreset !== 'audio-only' });
}

async function handleToggleScreenShare() {
  if (isScreenSharing) {
    // Stop Screen share
    stopScreenShare();
  } else {
    // Start Screen share
    try {
      // In low-bandwidth settings, restrict screen share parameters to be light on packets
      const screenConstraints = {
        video: {
          cursor: "always",
          width: { max: 1280 },
          height: { max: 720 },
          frameRate: { max: 10 } // low FPS is fine for presentations
        },
        audio: false
      };
      
      screenStream = await navigator.mediaDevices.getDisplayMedia(screenConstraints);
      const screenTrack = screenStream.getVideoTracks()[0];
      
      // Update senders for peers
      for (const id in peers) {
        const senders = peers[id].pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        }
      }

      // Update Local preview
      localVideo.srcObject = screenStream;
      videoCardLocal.classList.remove('local-peer'); // Turn off mirroring for screen share
      
      isScreenSharing = true;
      btnShareScreen.classList.add('active-state');
      
      // Synchronize screen state via websocket
      socket.emit('toggle-media', { type: 'screen', enabled: true });
      socket.emit('toggle-media', { type: 'video', enabled: true });

      // Listen for screen share cancellation from browser bar
      screenTrack.onended = () => {
        stopScreenShare();
      };
      
    } catch (err) {
      console.error('Error starting screen share:', err);
      showToast('Screen sharing cancelled.');
    }
  }
}

async function stopScreenShare() {
  if (!isScreenSharing) return;

  stopStreamTracks(screenStream);
  screenStream = null;
  
  // Revert video card mirroring
  videoCardLocal.classList.add('local-peer');

  // Re-acquire camera
  await rebuildLocalStream();
  localVideo.srcObject = localStream;

  isScreenSharing = false;
  btnShareScreen.classList.remove('active-state');

  // Synchronize screen states via websocket
  socket.emit('toggle-media', { type: 'screen', enabled: false });
  socket.emit('toggle-media', { type: 'video', enabled: !isCamOff });

  showToast('Screen sharing stopped.');
}

function leaveCall() {
  console.log('Leaving current call...');
  
  // Stop Captions if active
  if (isCaptionsOn) {
    isCaptionsOn = false;
    toggleButtonState(btnToggleCaptions, false);
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (e) {}
    }
  }

  // Reset local hand raised indicator
  if (isHandRaised) {
    isHandRaised = false;
    toggleButtonState(btnRaiseHand, false);
    const localHand = videoCardLocal.querySelector('#local-hand-indicator');
    if (localHand) localHand.classList.add('hidden');
  }

  // Reset video filter classes
  const filterClasses = ['filter-blur', 'filter-grayscale', 'filter-sepia', 'filter-warm', 'filter-invert'];
  filterClasses.forEach(c => {
    localVideo.classList.remove(c);
    localPreview.classList.remove(c);
    previewFilterOverlay.className = 'filter-overlay-effect';
  });

  // 1. Tell server we left
  socket.emit('leave-room');

  // 2. Cleanup peers
  for (const socketId in peers) {
    cleanupPeerConnection(socketId);
  }

  // 3. Stop local streams
  stopStreamTracks(localStream);
  stopStreamTracks(screenStream);
  localStream = null;
  screenStream = null;

  // 4. Reset states
  isScreenSharing = false;
  isCamOff = false;
  isMuted = false;
  currentFilter = 'none';

  // Remove active filters classes in dropdowns
  filtersMenu.querySelectorAll('li').forEach(li => li.classList.remove('active-item'));
  const callNoFilterLi = filtersMenu.querySelector('li[data-filter="none"]');
  if (callNoFilterLi) callNoFilterLi.classList.add('active-item');

  previewFiltersMenu.querySelectorAll('li').forEach(li => li.classList.remove('active-item'));
  const prevNoFilterLi = previewFiltersMenu.querySelector('li[data-filter="none"]');
  if (prevNoFilterLi) prevNoFilterLi.classList.add('active-item');

  // 5. Interface transitions
  callScreen.classList.add('hidden');
  
  // Clear remote videos (fix selector bug: it's .meet-video-tile, not .video-card!)
  const remoteCards = videoGrid.querySelectorAll('.meet-video-tile:not(.local-peer)');
  remoteCards.forEach(card => card.remove());

  // Restore Lobby Join button
  const joinBtn = document.getElementById('join-btn');
  joinBtn.disabled = false;
  joinBtn.innerText = 'Join call';

  // Navigate back to home screen (updates URL and shows home screen)
  navigateToRoom('');
}

// -------------------------------------------------------------
// WEBRTC CONNECTION STATISTICS POLLING (getStats)
// -------------------------------------------------------------
function startMonitoringStats(socketId) {
  const peer = peers[socketId];
  if (!peer) return;

  peer.statsInterval = setInterval(async () => {
    try {
      const statsReport = await peer.pc.getStats();
      let rtt = null;
      let packetLoss = null;
      let width = null;
      let height = null;
      let fps = null;
      let bitrate = 0;

      statsReport.forEach(report => {
        // 1. Latency & Candidate details
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000); // convert to ms
          }
          peer.statsData.ip = report.remoteCandidateId; // Keep candidate ref
        }

        // Find candidate details to fetch IP
        if (report.type === 'remote-candidate' && peer.statsData.ip === report.id) {
          peer.statsData.remoteIp = `${report.ipAddress || report.ip}:${report.port} (${report.candidateType})`;
        }

        // 2. Incoming Video stats (Packet loss, resolution)
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          width = report.frameWidth || null;
          height = report.frameHeight || null;
          fps = report.framesPerSecond || null;

          // Packet Loss calculation
          const packetsLost = report.packetsLost || 0;
          const packetsReceived = report.packetsReceived || 0;
          const totalPackets = packetsLost + packetsReceived;
          if (totalPackets > 0) {
            packetLoss = ((packetsLost / totalPackets) * 100).toFixed(1);
          }

          // Bitrate calculation
          const bytes = report.bytesReceived;
          const now = report.timestamp;
          if (peer.statsData.prevBytes && peer.statsData.prevTimestamp) {
            const bytesDiff = bytes - peer.statsData.prevBytes;
            const timeDiff = (now - peer.statsData.prevTimestamp) / 1000; // secs
            bitrate = Math.round((bytesDiff * 8) / (timeDiff * 1024)); // kbps
          }
          peer.statsData.prevBytes = bytes;
          peer.statsData.prevTimestamp = now;
        }
      });

      // Save calculated metrics
      peer.statsData.rtt = rtt;
      peer.statsData.packetLoss = packetLoss;
      peer.statsData.resolution = width && height ? `${width}x${height}` : 'No Feed';
      peer.statsData.fps = fps;
      peer.statsData.bitrate = bitrate;

      // Update overlay diagnostics tag on the peer's video card
      updatePeerCardOverlayStats(socketId);

    } catch (e) {
      console.warn(`Error compiling stats for ${peer.username}:`, e);
    }
  }, 2500); // Poll metrics every 2.5s
}

function updatePeerCardOverlayStats(socketId) {
  const peer = peers[socketId];
  if (!peer) return;

  const card = document.getElementById(`video-card-${socketId}`);
  if (!card) return;

  const statsTag = card.querySelector('.quality-tag');
  if (!statsTag) return;

  const s = peer.statsData;
  const parts = [];
  
  if (s.resolution && s.resolution !== 'No Feed') parts.push(s.resolution);
  if (s.fps) parts.push(`${s.fps}fps`);
  if (s.rtt) parts.push(`${s.rtt}ms`);
  if (s.packetLoss && s.packetLoss > 0) parts.push(`Loss: ${s.packetLoss}%`);
  
  statsTag.innerText = parts.length > 0 ? parts.join(' | ') : 'Connected';
}

function updateStatsModalContent() {
  if (statsModal.classList.contains('hidden')) return;

  let rttSum = 0;
  let rttCount = 0;
  let maxLoss = 0;
  let currentIp = 'Not connected';

  peersStatsContainer.innerHTML = '';

  const activePeers = Object.values(peers);
  
  if (activePeers.length === 0) {
    peersStatsContainer.innerHTML = '<p class="no-peers-msg">No active remote connections. Join a call with other users to view stats.</p>';
    statRtt.innerText = '-- ms';
    statLoss.innerText = '-- %';
    statIp.innerText = 'Checking...';
    return;
  }

  activePeers.forEach(peer => {
    const s = peer.statsData;
    
    if (s.rtt) {
      rttSum += s.rtt;
      rttCount++;
    }
    if (s.packetLoss) {
      const val = parseFloat(s.packetLoss);
      if (val > maxLoss) maxLoss = val;
    }
    if (s.remoteIp) {
      currentIp = s.remoteIp;
    }

    // Append peer card info
    const row = document.createElement('div');
    row.className = 'peer-stat-row';
    row.innerHTML = `
      <div class="peer-stat-info">
        <span class="peer-stat-name">${peer.username}</span>
        <span class="peer-stat-metrics">${s.remoteIp || 'Connecting...'}</span>
      </div>
      <div class="peer-stat-values">
        <strong>${s.resolution || '--'}</strong> @ ${s.fps || '--'}fps | <strong>${s.bitrate || 0} kbps</strong>
      </div>
    `;
    peersStatsContainer.appendChild(row);
  });

  // Calculate averages
  statRtt.innerText = rttCount > 0 ? `${Math.round(rttSum / rttCount)} ms` : '-- ms';
  statLoss.innerText = `${maxLoss.toFixed(1)} %`;
  statIp.innerText = currentIp;

  // Poll again in 2.5s if modal is open
  setTimeout(updateStatsModalContent, 2500);
}

// -------------------------------------------------------------
// TEXT CHAT SYSTEM
// -------------------------------------------------------------
function handleSendChatMessage(e) {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit('send-message', text);
  chatInput.value = '';
}

function appendChatMessage(senderName, text, isSelf, timestamp) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${isSelf ? 'outgoing' : 'incoming'}`;
  
  msgDiv.innerHTML = `
    <div class="message-meta">
      <span class="message-sender">${isSelf ? 'Me' : senderName}</span>
      <span class="message-time">${timestamp}</span>
    </div>
    <div class="message-bubble">
      ${escapeHTML(text)}
    </div>
  `;
  
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// -------------------------------------------------------------
// UI LAYOUT HELPERS & MISC
// -------------------------------------------------------------
function createRemoteVideoCard(socketId, peerName, stream, mediaState = null) {
  // If card already exists, update source
  let card = document.getElementById(`video-card-${socketId}`);
  if (card) {
    const video = card.querySelector('video');
    video.srcObject = stream;
    return;
  }

  const isAudioMuted = mediaState && mediaState.audio === false;
  const isVideoOff = mediaState && mediaState.video === false;
  const isScreenSharingPeer = mediaState && mediaState.screen === true;

  card = document.createElement('div');
  card.className = 'meet-video-tile';
  card.id = `video-card-${socketId}`;
  
  card.innerHTML = `
    <video autoplay playsinline style="opacity: ${isVideoOff ? '0' : '1'};"></video>
    <div class="video-placeholder ${isVideoOff ? '' : 'hidden'}">
      <div class="placeholder-circle-call">${peerName.charAt(0).toUpperCase()}</div>
    </div>
    
    <!-- Video Filter Overlay -->
    <div class="filter-overlay-effect"></div>

    <div class="tile-overlay-top">
      <span class="quality-badge">Connecting...</span>
    </div>
    <div class="tile-overlay-bottom">
      <span class="user-label peer-name">${isScreenSharingPeer ? peerName + ' (Screen)' : peerName}</span>
      <div class="tile-indicators">
        <span class="tile-mic-indicator ${isAudioMuted ? '' : 'hidden'}" id="mic-indicator-${socketId}"><i data-lucide="mic-off"></i></span>
        <span class="tile-hand-indicator hidden" id="hand-indicator-${socketId}"><i data-lucide="hand"></i></span>
      </div>
    </div>

    <!-- Live captions subtitles overlay -->
    <div class="subtitle-overlay hidden" id="subtitle-${socketId}"></div>
  `;

  // Attach Stream
  const video = card.querySelector('video');
  video.srcObject = stream;
  
  // Track mute events or stream alterations
  stream.onremovetrack = () => {
    console.log(`Track removed on stream from ${peerName}`);
  };

  videoGrid.appendChild(card);
  
  // Redo SVG Icons initialization on newly appended children
  lucide.createIcons();
  
  recalculateVideoGridLayout();
}

function recalculateVideoGridLayout() {
  const cards = videoGrid.children.length;
  // CSS handles auto sizing via grid-template-columns with `:has` triggers
  console.log(`Recalculated layout for ${cards} feeds.`);
}

function stopStreamTracks(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

function toggleButtonState(btn, isActive) {
  if (isActive) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

function showToast(message, isError = false) {
  toastMessage.innerText = message;
  toast.className = isError ? 'toast error-toast' : 'toast';
  toast.classList.remove('hidden');
  
  // Hide after 3.5s
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// Helpers & Advanced Features Functions

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomRoomCode() {
  return `${generateRandomString(3)}-${generateRandomString(4)}-${generateRandomString(3)}`;
}

function extractRoomCode(str) {
  const trimmed = str.trim();
  try {
    const url = new URL(trimmed);
    let path = url.pathname.replace(/^\/room\//, '/').replace(/^\//, '');
    if (path) return path.toLowerCase();
    const roomQ = url.searchParams.get('room');
    if (roomQ) return roomQ.trim().toLowerCase();
  } catch (e) {
    return trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '');
  }
  return null;
}

function navigateToRoom(targetRoomId) {
  const targetPath = targetRoomId ? `/${targetRoomId}` : '/';
  history.pushState(null, '', targetPath);
  checkUrlAndLoadScreen();
}

function checkUrlAndLoadScreen() {
  const path = window.location.pathname.replace(/^\/room\//, '/').replace(/^\//, '');
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  
  let targetRoom = null;
  if (roomParam && roomParam.trim()) {
    targetRoom = roomParam.trim().toLowerCase();
  } else if (path && path !== 'index.html' && !path.includes('.') && !path.includes('/')) {
    targetRoom = path.trim().toLowerCase();
  }

  if (targetRoom) {
    roomId = targetRoom;
    lobbyRoomDisplay.innerText = roomId;
    
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    callScreen.classList.add('hidden');
    
    getLocalPreviewStream();
    startMicLevelMeter();
  } else {
    roomId = '';
    homeScreen.classList.remove('hidden');
    lobbyScreen.classList.add('hidden');
    callScreen.classList.add('hidden');
    
    stopMicLevelMeter();
    stopStreamTracks(localStream);
    localStream = null;
    
    homeRoomInput.value = '';
    homeJoinBtn.disabled = true;
  }
}

function updateHomeTime() {
  const now = new Date();
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  const dateStr = now.toLocaleDateString('en-US', options);
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (currentTimeDisplay) {
    currentTimeDisplay.innerText = `${timeStr} • ${dateStr}`;
  }
}

// Carousel Functions
function startCarouselTimer() {
  stopCarouselTimer();
  carouselInterval = setInterval(showNextSlide, 6000);
}

function stopCarouselTimer() {
  if (carouselInterval) clearInterval(carouselInterval);
}

function resetCarouselTimer() {
  stopCarouselTimer();
  startCarouselTimer();
}

function goToSlide(index) {
  if (slides.length === 0) return;
  slides.forEach(slide => slide.classList.remove('active'));
  dots.forEach(dot => dot.classList.remove('active'));
  
  currentSlideIndex = index;
  slides[currentSlideIndex].classList.add('active');
  dots[currentSlideIndex].classList.add('active');
}

function showNextSlide() {
  if (slides.length === 0) return;
  let next = (currentSlideIndex + 1) % slides.length;
  goToSlide(next);
}

function showPreviousSlide() {
  if (slides.length === 0) return;
  let prev = (currentSlideIndex - 1 + slides.length) % slides.length;
  goToSlide(prev);
}

// Mic Level checking via AudioAnalyser
function startMicLevelMeter() {
  stopMicLevelMeter();
  
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    micAudioContext = new AudioContextClass();
    micAnalyser = micAudioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    
    micSource = micAudioContext.createMediaStreamSource(new MediaStream(audioTracks));
    micSource.connect(micAnalyser);
    
    const bufferLength = micAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const fillEl = document.getElementById('mic-level-fill');
    
    micVolumeInterval = setInterval(() => {
      if (isMuted || !localStream || localStream.getAudioTracks().length === 0 || localStream.getAudioTracks()[0].enabled === false) {
        if (fillEl) fillEl.style.width = '0%';
        return;
      }
      
      micAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      // Calculate level percentage
      const level = Math.min(Math.round((average / 128) * 100), 100);
      if (fillEl) {
        fillEl.style.width = `${level}%`;
      }
    }, 100);
  } catch (err) {
    console.warn("Failed to start mic check volume visualizer:", err);
  }
}

function stopMicLevelMeter() {
  if (micVolumeInterval) {
    clearInterval(micVolumeInterval);
    micVolumeInterval = null;
  }
  if (micSource) {
    try {
      micSource.disconnect();
    } catch (e) {}
    micSource = null;
  }
  if (micAudioContext) {
    if (micAudioContext.state !== 'closed') {
      try {
        micAudioContext.close();
      } catch (e) {}
    }
    micAudioContext = null;
  }
  const fillEl = document.getElementById('mic-level-fill');
  if (fillEl) fillEl.style.width = '0%';
}

// Live speech recognition captions (Speech-to-Text API)
function setupSpeechRecognition() {
  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionClass) {
    console.warn("SpeechRecognition is not supported in this browser.");
    return;
  }

  speechRecognition = new SpeechRecognitionClass();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = 'en-US';

  speechRecognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const text = finalTranscript || interimTranscript;
    if (text.trim()) {
      showLocalCaption(text);
      socket.emit('send-caption', text);
    }
  };

  speechRecognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    if (event.error === 'not-allowed') {
      isCaptionsOn = false;
      toggleButtonState(btnToggleCaptions, false);
      showToast("Speech captions permission denied.", true);
    }
  };

  speechRecognition.onend = () => {
    if (isCaptionsOn) {
      try {
        speechRecognition.start();
      } catch (e) {
        console.warn("Failed to restart speech captions:", e);
      }
    }
  };
}

function showLocalCaption(text) {
  const localSubtitle = document.getElementById('subtitle-local');
  if (!localSubtitle) return;

  localSubtitle.innerText = text;
  localSubtitle.classList.remove('hidden');

  clearTimeout(captionTimeout);
  captionTimeout = setTimeout(() => {
    localSubtitle.classList.add('hidden');
  }, 4000);
}

function handleToggleCaptions() {
  isCaptionsOn = !isCaptionsOn;
  toggleButtonState(btnToggleCaptions, isCaptionsOn);

  if (isCaptionsOn) {
    if (speechRecognition) {
      try {
        speechRecognition.start();
        showToast("Live captions turned on");
      } catch (e) {
        console.warn(e);
      }
    } else {
      showToast("Speech recognition is not supported in this browser.", true);
      isCaptionsOn = false;
      toggleButtonState(btnToggleCaptions, false);
    }
  } else {
    if (speechRecognition) {
      try {
        speechRecognition.stop();
        showToast("Live captions turned off");
      } catch (e) {}
    }
    const localSubtitle = document.getElementById('subtitle-local');
    if (localSubtitle) localSubtitle.classList.add('hidden');
  }
}

// Raise Hand Feature
function handleToggleRaiseHand() {
  isHandRaised = !isHandRaised;
  toggleButtonState(btnRaiseHand, isHandRaised);

  // Toggle local raised hand icon inside indicators
  const localHand = videoCardLocal.querySelector('#local-hand-indicator');
  if (!localHand) {
    const overlayBottom = videoCardLocal.querySelector('.tile-overlay-bottom');
    let indicators = videoCardLocal.querySelector('.tile-indicators');
    
    if (!indicators && overlayBottom) {
      indicators = document.createElement('div');
      indicators.className = 'tile-indicators';
      overlayBottom.appendChild(indicators);
    }
    
    if (indicators) {
      const handSpan = document.createElement('span');
      handSpan.className = 'tile-hand-indicator';
      handSpan.id = 'local-hand-indicator';
      handSpan.innerHTML = '<i data-lucide="hand"></i>';
      indicators.appendChild(handSpan);
      lucide.createIcons();
    }
  }

  const handEl = document.getElementById('local-hand-indicator');
  if (handEl) {
    handEl.classList.toggle('hidden', !isHandRaised);
  }

  if (isHandRaised) {
    showToast("You raised your hand ✋");
    playAudioFeedback('hand');
  }

  socket.emit('raise-hand', isHandRaised);
}

// CSS Filters Helpers
function applyFilterToVideo(videoEl, overlayEl, filter) {
  if (!videoEl) return;

  const filterClasses = ['filter-blur', 'filter-grayscale', 'filter-sepia', 'filter-warm', 'filter-invert'];
  filterClasses.forEach(c => {
    videoEl.classList.remove(c);
    if (overlayEl) overlayEl.classList.remove(c);
  });

  if (filter !== 'none') {
    videoEl.classList.add(`filter-${filter}`);
    if (overlayEl) overlayEl.classList.add(`filter-${filter}`);
  }
}

function applyLocalCallFilter(filter) {
  currentFilter = filter;
  applyFilterToVideo(localVideo, null, filter);
  showToast(`Video filter applied: ${filter}`);
  socket.emit('change-filter', filter);
}

// Floating Emoji Reaction System
function showFloatingEmoji(senderSocketId, emoji) {
  const cardId = senderSocketId === socket.id ? 'video-card-local' : `video-card-${senderSocketId}`;
  const card = document.getElementById(cardId);
  if (!card) return;

  const emojiEl = document.createElement('div');
  emojiEl.className = 'floating-emoji';
  emojiEl.innerText = emoji;

  // Set random horizontal position between 20% and 80% inside video card
  const randX = Math.floor(Math.random() * 60) + 20;
  emojiEl.style.left = `${randX}%`;

  card.appendChild(emojiEl);
  playAudioFeedback('reaction');

  // Remove after animation finishes (2 seconds)
  setTimeout(() => {
    emojiEl.remove();
  }, 2000);
}

// Audio Feedback Synthesis (Oscillators API)
function playAudioFeedback(type) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    
    if (type === 'join') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'leave') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.3);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'reaction') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'hand') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      
      osc1.type = 'sine';
      osc2.type = 'sine';
      
      const now = ctx.currentTime;
      osc1.frequency.setValueAtTime(523.25, now);
      osc2.frequency.setValueAtTime(659.25, now);
      
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.55);
      osc2.stop(now + 0.55);
    } else if (type === 'message') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(550, now);
      osc.frequency.setValueAtTime(700, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (err) {
    console.log("Audio feedback play blocked:", err);
  }
}

function itemTitleForPreset(preset) {
  if (preset === 'low') return 'Low Bandwidth';
  if (preset === 'medium') return 'Balanced';
  if (preset === 'high') return 'High Quality';
  if (preset === 'audio-only') return 'Audio Only';
  return 'Low Bandwidth';
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Start trigger
window.addEventListener('DOMContentLoaded', init);

// Handle back/forward browser routing for SPA
window.addEventListener('popstate', checkUrlAndLoadScreen);

// Cleanup on page refresh or close to avoid ghost connections
window.addEventListener('beforeunload', () => {
  leaveCall();
});

