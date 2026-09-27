# Use official Playwright Ubuntu image matching version 1.63.0
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

# Set working directory inside container
WORKDIR /app

# Copy package definitions
COPY package*.json ./

# Install xvfb for virtual display support and matching Chromium browser binary
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*
RUN npm install && npx playwright install chromium

# Copy application source code
COPY . .

# Set default cloud environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true

# Expose server port
EXPOSE 3000

# Start server wrapped in xvfb-run virtual display buffer
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x800x24 -ac", "node", "server.js"]
