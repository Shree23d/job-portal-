# Use official Playwright Ubuntu image with pre-installed Chromium and dependencies
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

# Set working directory inside container
WORKDIR /app

# Copy package definitions
COPY package*.json ./

# Install project dependencies
RUN npm install

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
