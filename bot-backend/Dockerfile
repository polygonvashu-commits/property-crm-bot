FROM node:18

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (removing lockfile to avoid Windows/Linux conflicts, and ignoring strict peer deps)
RUN rm -f package-lock.json && npm install --legacy-peer-deps

# Set environment
ENV NODE_ENV=production

# Copy application source code
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3001

# Start the bot
CMD ["npm", "start"]
