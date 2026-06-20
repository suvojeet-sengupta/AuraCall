# AuraCall - Adaptive Audio/Video Call Web App

A professional, ultra-performance WebRTC multi-party video calling web application. AuraCall is specifically optimized for low-bandwidth and unstable network environments. It features real-time network diagnostic overlays, automatic connection quality profiles, audio-only modes, and dual-layer bitrate caps (SDP munging + RTCRtpSender parameters).

---

## 🚀 Outdoor VPS Deployment Guide

WebRTC requires a **Secure Context (HTTPS)** to access user cameras and microphones when accessed over the public internet. If you try to open the app via `http://<your-vps-ip>:3001` in your browser, the camera/microphone APIs will be disabled.

Follow these steps to deploy AuraCall on your outdoor VPS with full HTTPS:

### Step 1: Copy Code & Install Dependencies
1. Transfer this folder to your VPS.
2. Ensure Node.js (v18+) is installed.
3. Install dependencies and start the app:
   ```bash
   npm install
   npm start
   ```
   *Note: If port 3000 is occupied, AuraCall will automatically fall back to port 3001 (or the next available port).*

### Step 2: Open VPS Firewalls
WebRTC and Signaling require specific port access:
- **Port 80 & 443 (TCP)**: Standard HTTP/HTTPS (served by Nginx reverse proxy).
- **Port 3001 (TCP)**: Node.js signaling port (if running directly or proxies).
- **UDP Ports (1024-65535)**: Used by WebRTC to establish direct peer-to-peer audio/video connection paths.
- Run the following commands (assuming UFW firewall is active on Ubuntu):
  ```bash
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 3001/tcp
  sudo ufw allow 49152:65535/udp
  sudo ufw reload
  ```

### Step 3: Configure Nginx Reverse Proxy with SSL (HTTPS)
To access the app securely, set up Nginx as a reverse proxy with Let's Encrypt:

1. Install Nginx:
   ```bash
   sudo apt update
   sudo apt install nginx -y
   ```
2. Create an Nginx site config:
   ```bash
   sudo nano /etc/nginx/sites-available/auracall
   ```
3. Paste the following configuration (replace `call.yourdomain.com` with your subdomain pointing to the VPS IP):
   ```nginx
   server {
       listen 80;
       server_name call.yourdomain.com;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
4. Enable the configuration and restart Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/auracall /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```
5. Install Let's Encrypt Certbot to acquire SSL:
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d call.yourdomain.com
   ```
6. Certbot will automatically rewrite your Nginx configuration to support HTTPS. Once completed, navigate to `https://call.yourdomain.com` to start calls!

---

## ⚡ Adaptive Low-Bandwidth Optimizations

AuraCall is built to handle poor internet connections (e.g., 3G or unstable outdoor data) seamlessly:

1. **Quality Presets**:
   - **Low Bandwidth**: Caps video resolution to 240p @ 15fps and restricts upload video bitrate to **150 Kbps** and audio to **20 Kbps**.
   - **Balanced**: Caps video to 480p @ 24fps and limits upload video to **500 Kbps** and audio to **32 Kbps**.
   - **High Quality**: Standard 720p @ 30fps HD call (1.5 Mbps).
   - **Audio Only**: Completely stops video capture (turns off camera hardware) and reduces bandwidth usage to a tiny **16 Kbps** audio channel.
2. **Dynamic Bandwidth Regulation**:
   - **RTCRtpSender Parameters**: Constrains actual track resolution scaling factor and bandwidth parameters dynamically at the browser hardware layer.
   - **SDP Munging**: Injects bandwidth constraints (`b=AS:` and `b=TIAS:`) into Session Description Protocols (SDP) to ensure remote peers also cap what they stream back to you.
3. **WebRTC Diagnostics Stats Panel**:
   - Tap the activity statistics button (<i data-lucide="activity"></i>) during a call to view real-time latency (RTT in ms), packet loss percentage, codec information, and bandwidth consumption for each connected peer.
4. **Resilient Group Chat**:
   - Built-in text chat overlay ensures users can continue communicating even if their internet drops so low that video/audio is disrupted.

---

## 📡 WebRTC NAT Traversal (STUN/TURN)
- **STUN (Session Traversal Utilities for NAT)**: Google's public STUN servers are configured in `app.js` to automatically resolve NAT mapping for standard residential connections.
- **TURN (Traversal Using Relays around NAT)**: In highly restrictive firewalls (e.g., corporate proxies or symmetric NATs on mobile networks), WebRTC direct connection can sometimes fail. If you experience connection failures, deploy a TURN server (like `coturn`) on your VPS, and add the credentials inside the `rtcConfig` block in `public/app.js`:
  ```javascript
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'your-username',
    credential: 'your-password'
  }
  ```
