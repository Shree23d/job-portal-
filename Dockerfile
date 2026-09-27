# Use official Playwright Ubuntu image matching version 1.63.0
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

# Set working directory inside container
WORKDIR /app

# Copy package definitions
COPY package*.json ./

# Install project dependencies and ensure matching Chromium binary is downloaded
RUN npm install && npx playwright install chromium

# Copy application source code
COPY . .

# Set default cloud environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true

# Expose server port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
