# AuraCall

A professional, ultra-performance WebRTC video calling web application built with Next.js, TypeScript, and Socket.io.

## Prerequisites

- Node.js (version 20 or higher)
- NPM
- Or Docker and Docker Compose

## Running Locally

### Option 1: Using Node and NPM

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run in development mode:
   ```bash
   npm run dev
   ```

3. Open http://localhost:3001 in your browser.

4. To run in production mode:
   ```bash
   npm run build
   ```
   ```bash
   npm run start
   ```

### Option 2: Using Docker

1. Build and run containers:
   ```bash
   docker compose build
   docker compose up -d
   ```

2. The application will be accessible at http://localhost:3001.

## VPS Deployment

To deploy this application on a VPS (such as DigitalOcean, Linode, AWS EC2):

1. Clone the repository:
   ```bash
   git clone https://github.com/suvojeet-sengupta/AuraCall.git
   cd AuraCall
   ```

2. Run using Docker Compose:
   ```bash
   docker compose build
   docker compose up -d
   ```

3. Set up an Nginx reverse proxy to forward traffic to port 3001 and configure SSL (HTTPS). Secure context (HTTPS) is required by web browsers for camera and microphone access.

   Example Nginx Configuration:
   ```nginx
   server {
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

## Cloudflare Deployment Notes

Please note the deployment constraints for serverless/edge environments:

1. **Frontend**: The Next.js frontend can be deployed to Cloudflare Pages using `@cloudflare/next-on-pages`.

2. **Signaling Server**: The application uses a custom Express and Socket.io server (`server.ts`) for WebRTC signaling. Standard Cloudflare Workers are serverless and do not support persistent long-running Socket.io servers.
   - You must host the signaling backend separately on a VPS or a container hosting service (like Render, Railway, or Fly.io) that supports Node.js and WebSockets.
   - After hosting the backend, configure the socket client in the frontend to point to the hosted backend URL.
