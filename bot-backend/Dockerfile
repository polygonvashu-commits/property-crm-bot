FROM node:18-slim

# Install build tools and git which might be required for some npm packages (like Baileys dependencies)
RUN apt-get update && apt-get install -y git python3 build-essential && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Set environment
ENV NODE_ENV=production

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3001

# Start the bot
CMD ["npm", "start"]
