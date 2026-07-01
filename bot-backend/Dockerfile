FROM node:18

# Set working directory
WORKDIR /usr/src/app

# Copy only package.json first to avoid copying package-lock.json
COPY package.json ./

# Install dependencies using yarn instead of npm
RUN yarn install

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
